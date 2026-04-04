from __future__ import annotations

import json
import re
import sqlite3
import sys
from collections import Counter, defaultdict
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

try:
    from ingestion.readability_rules import is_explicit_image_dependent
except ModuleNotFoundError:
    sys.path.append(str(Path(__file__).resolve().parent.parent))
    from ingestion.readability_rules import is_explicit_image_dependent


ROOT = Path(__file__).resolve().parent.parent
DB_FILE = ROOT / "server" / "data" / "casebank.db"
JSON_FILE = ROOT / "public" / "data" / "compiled_cases.json"
QUEUE_FILE = ROOT / "ingestion" / "output" / "readability_batch_salvage_queue.json"
REPORT_FILE = ROOT / "ingestion" / "output" / "truncated_false_positive_clear_report.json"

TARGET_SOURCES = {"medmcqa", "frenchmedmcqa", "medqa", "nano1337-mcqs", "ukmppd-scribd", "ukmppd-ukdicorner", "worldmedqa", "headqa", "sct-alchemist-v3"}
TARGET_SOURCE_PREFIXES = ("mmlu-",)
GENERIC_PROMPTS = {
    "choose the correct answer.",
    "pilih jawaban yang paling tepat.",
}
PROMOTE_NARRATIVE_SOURCES = {"frenchmedmcqa", "nano1337-mcqs", "ukmppd-scribd", "ukmppd-ukdicorner", "worldmedqa"}
SHORT_PROMPT_PROMOTE_SOURCES = {"headqa"}
SAFE_TEMPLATE_ELLIPSIS_RE = re.compile(
    r"^(?:jika\s+ditemukan|bila\s+ditemukan|when\s+finding|if\s+there\s+is).+(?:apakah\s+hipotesis\s+menjadi|does\s+the\s+hypothesis\s+become)\.\.\.$",
    re.IGNORECASE,
)
def read_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = path.with_suffix(path.suffix + ".tmp")
    with temp_path.open("w", encoding="utf-8", newline="\n") as handle:
        json.dump(value, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
    temp_path.replace(path)


def parse_json(value: Any, fallback: Any) -> Any:
    if value in (None, ""):
        return fallback
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return fallback


def normalize_text(value: Any) -> str:
    text = str(value or "")
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = text.replace("\u00a0", " ")
    text = " ".join(text.split())
    return text.strip()


def summarize_text(text: str, limit: int = 160) -> str:
    compact = normalize_text(text)
    if len(compact) <= limit:
        return compact
    return compact[: limit - 3].rstrip() + "..."


def with_quality_flag(meta: dict[str, Any], flag: str) -> None:
    flags = meta.get("quality_flags")
    if not isinstance(flags, list):
        flags = []
    if flag not in flags:
        flags.append(flag)
    meta["quality_flags"] = flags


def get_narrative(case_data: dict[str, Any]) -> str:
    vignette = case_data.get("vignette")
    if isinstance(vignette, dict):
        return str(vignette.get("narrative") or "")
    return str(vignette or "")


def set_narrative(case_data: dict[str, Any], narrative: str) -> None:
    if isinstance(case_data.get("vignette"), dict):
        case_data["vignette"]["narrative"] = narrative
    else:
        case_data["vignette"] = {"narrative": narrative}


def load_case_rows(connection: sqlite3.Connection, ids: list[int]) -> dict[int, dict[str, Any]]:
    if not ids:
        return {}
    placeholders = ",".join("?" for _ in ids)
    rows = connection.execute(
        f"""
        SELECT
          case_id,
          case_code,
          hash_id,
          title,
          prompt,
          source,
          meta_status,
          vignette_json,
          rationale_json,
          meta_json,
          validation_json
        FROM cases
        WHERE case_id IN ({placeholders})
        """,
        ids,
    ).fetchall()
    option_rows = connection.execute(
        f"""
        SELECT case_id, option_id, sort_order, option_text, is_correct
        FROM case_options
        WHERE case_id IN ({placeholders})
        ORDER BY case_id, sort_order
        """,
        ids,
    ).fetchall()

    options_by_case: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for row in option_rows:
        options_by_case[int(row["case_id"])].append(
            {
                "id": row["option_id"],
                "text": row["option_text"],
                "is_correct": bool(row["is_correct"]),
            }
        )

    cases: dict[int, dict[str, Any]] = {}
    for row in rows:
        meta = parse_json(row["meta_json"], {})
        if row["meta_status"]:
            meta["status"] = row["meta_status"]
        cases[int(row["case_id"])] = {
            "_id": int(row["case_id"]),
            "case_code": row["case_code"] or "",
            "hash_id": row["hash_id"],
            "title": row["title"] or "",
            "prompt": row["prompt"] or "",
            "source": row["source"] or "",
            "vignette": parse_json(row["vignette_json"], {}),
            "rationale": parse_json(row["rationale_json"], {}),
            "meta": meta,
            "validation": parse_json(row["validation_json"], {}),
            "options": options_by_case.get(int(row["case_id"]), []),
        }
    return cases


def persist_sqlite(connection: sqlite3.Connection, cases: list[dict[str, Any]]) -> None:
    with connection:
        for case_data in cases:
            meta = case_data.get("meta") or {}
            connection.execute(
                """
                UPDATE cases
                SET
                  title = ?,
                  prompt = ?,
                  meta_status = ?,
                  vignette_json = ?,
                  rationale_json = ?,
                  meta_json = ?,
                  validation_json = ?
                WHERE case_id = ?
                """,
                (
                    case_data.get("title") or "",
                    case_data.get("prompt") or "",
                    meta.get("status") or "",
                    json.dumps(case_data.get("vignette") or {}, ensure_ascii=False),
                    json.dumps(case_data.get("rationale") or {}, ensure_ascii=False),
                    json.dumps(meta, ensure_ascii=False),
                    json.dumps(case_data.get("validation") or {}, ensure_ascii=False),
                    case_data["_id"],
                ),
            )


def update_json_cases(json_cases: list[dict[str, Any]], updates: dict[int, dict[str, Any]]) -> None:
    for item in json_cases:
        case_id = item.get("_id")
        if case_id not in updates:
            continue
        updated = updates[case_id]
        item["title"] = updated.get("title")
        item["prompt"] = updated.get("prompt")
        item["vignette"] = updated.get("vignette")
        item["rationale"] = updated.get("rationale")
        item["meta"] = updated.get("meta")
        item["options"] = updated.get("options")


def is_generic_prompt(prompt: str) -> bool:
    return normalize_text(prompt).lower() in GENERIC_PROMPTS


def rationale_text(case_data: dict[str, Any]) -> str:
    rationale = case_data.get("rationale")
    if isinstance(rationale, dict):
        return normalize_text(rationale.get("correct"))
    return normalize_text(rationale)


def has_complete_options(case_data: dict[str, Any]) -> bool:
    options = case_data.get("options") or []
    if len(options) < 4:
        return False
    if sum(1 for option in options if option.get("is_correct") is True) != 1:
        return False
    return sum(1 for option in options if len(normalize_text(option.get("text"))) >= 3) >= 4


def is_target_source(source: str) -> bool:
    return source in TARGET_SOURCES or source.startswith(TARGET_SOURCE_PREFIXES)


def has_safe_terminal_ellipsis(case_data: dict[str, Any], stem: str) -> bool:
    source = str(case_data.get("source") or "")
    if source != "sct-alchemist-v3":
        return False
    normalized = normalize_text(stem)
    return SAFE_TEMPLATE_ELLIPSIS_RE.match(normalized) is not None


def is_safe_candidate(case_data: dict[str, Any]) -> tuple[bool, str]:
    meta = case_data.get("meta") or {}
    source = str(case_data.get("source") or "")
    if not is_target_source(source):
        return False, "unsupported_source"
    if meta.get("truncated") is not True:
        return False, "not_truncated"
    status = str(meta.get("status") or "")
    if status.startswith("QUARANTINED"):
        return False, "quarantined_status"
    if not has_complete_options(case_data):
        return False, "incomplete_options"
    if len(rationale_text(case_data)) < 80:
        return False, "weak_rationale"

    prompt = normalize_text(case_data.get("prompt"))
    narrative = normalize_text(get_narrative(case_data))
    stem = narrative if is_generic_prompt(prompt) and narrative else prompt or narrative or normalize_text(case_data.get("title"))
    if len(stem) < 18:
        return False, "short_stem"
    if ("..." in stem or stem.endswith("..")) and not has_safe_terminal_ellipsis(case_data, stem):
        return False, "ellipsis_stem"
    if source in PROMOTE_NARRATIVE_SOURCES and is_generic_prompt(prompt):
        if not narrative or len(narrative) < 30:
            return False, "short_narrative"
        if is_explicit_image_dependent(prompt, narrative):
            return False, "image_dependent_prompt"
    if source in SHORT_PROMPT_PROMOTE_SOURCES:
        if len(prompt) >= 30:
            return False, "prompt_not_short"
        if not narrative or len(narrative) < 30:
            return False, "short_narrative"
        if is_explicit_image_dependent(prompt, narrative):
            return False, "image_dependent_prompt"
    return True, "candidate"


def apply_case_update(case_data: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
    updated = deepcopy(case_data)
    meta = updated.setdefault("meta", {})
    fix_kinds: list[str] = ["truncated_false_positive_cleared"]
    meta["truncated"] = False
    with_quality_flag(meta, "truncated_false_positive_cleared")

    prompt = normalize_text(updated.get("prompt"))
    narrative = normalize_text(get_narrative(updated))
    if updated.get("source") in PROMOTE_NARRATIVE_SOURCES and is_generic_prompt(prompt) and narrative:
        updated["prompt"] = narrative
        if normalize_text(updated.get("title")) == narrative:
            set_narrative(updated, "")
        else:
            set_narrative(updated, narrative)
        with_quality_flag(meta, "prompt_promoted_from_narrative")
        fix_kinds.append("prompt_promoted_from_narrative")
    elif updated.get("source") in SHORT_PROMPT_PROMOTE_SOURCES and len(prompt) < 30 and narrative:
        updated["prompt"] = narrative
        if normalize_text(updated.get("title")) == narrative:
            set_narrative(updated, "")
        else:
            set_narrative(updated, narrative)
        with_quality_flag(meta, "prompt_promoted_from_narrative")
        fix_kinds.append("prompt_promoted_from_narrative")
    else:
        updated["prompt"] = prompt
        set_narrative(updated, narrative)

    updated["title"] = normalize_text(updated.get("title"))
    return updated, fix_kinds


def case_changed(before: dict[str, Any], after: dict[str, Any]) -> bool:
    keys = ("title", "prompt", "vignette", "rationale", "meta")
    return any(before.get(key) != after.get(key) for key in keys)


def main() -> None:
    queue = read_json(QUEUE_FILE, [])
    target_ids = [
        int(item["_id"])
        for item in queue
        if item.get("playbook") == "truncated_text_recovery" and is_target_source(str(item.get("source") or ""))
    ]

    connection = sqlite3.connect(DB_FILE)
    connection.row_factory = sqlite3.Row
    try:
        case_map = load_case_rows(connection, target_ids)
        json_cases = read_json(JSON_FILE, [])

        changed_cases: dict[int, dict[str, Any]] = {}
        report: dict[str, Any] = {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "target_sources": sorted(TARGET_SOURCES),
            "queue_targets": len(target_ids),
            "changed_cases": 0,
            "skipped_cases": Counter(),
            "by_source": Counter(),
            "fix_kinds": Counter(),
            "samples": [],
        }

        for case_id in target_ids:
            current = case_map.get(case_id)
            if current is None:
                report["skipped_cases"]["missing_in_sqlite"] += 1
                continue

            safe, reason = is_safe_candidate(current)
            if not safe:
                report["skipped_cases"][reason] += 1
                continue

            updated, fix_kinds = apply_case_update(current)
            if not case_changed(current, updated):
                report["skipped_cases"]["unchanged_after_apply"] += 1
                continue

            changed_cases[case_id] = updated
            report["changed_cases"] += 1
            report["by_source"][updated.get("source") or "unknown"] += 1
            for fix_kind in fix_kinds:
                report["fix_kinds"][fix_kind] += 1
            if len(report["samples"]) < 12:
                report["samples"].append(
                    {
                        "_id": case_id,
                        "source": updated.get("source"),
                        "before_prompt": summarize_text(current.get("prompt") or ""),
                        "after_prompt": summarize_text(updated.get("prompt") or ""),
                        "fix_kinds": fix_kinds,
                    }
                )

        report["skipped_cases"] = dict(report["skipped_cases"].most_common())
        report["by_source"] = dict(report["by_source"].most_common())
        report["fix_kinds"] = dict(report["fix_kinds"].most_common())

        if changed_cases:
            persist_sqlite(connection, list(changed_cases.values()))
            update_json_cases(json_cases, changed_cases)
            write_json(JSON_FILE, json_cases)
        write_json(REPORT_FILE, report)

        print("TRUNCATED FALSE POSITIVE CLEAR")
        print(f"  Queue targets:  {len(target_ids):,}")
        print(f"  Changed cases:  {report['changed_cases']:,}")
        if report["by_source"]:
            print("  By source:")
            for source, count in report["by_source"].items():
                print(f"    - {source}: {count:,}")
        if report["skipped_cases"]:
            print("  Skipped:")
            for reason, count in report["skipped_cases"].items():
                print(f"    - {reason}: {count:,}")
        print(f"  Report:         {REPORT_FILE}")
    finally:
        connection.close()


if __name__ == "__main__":
    main()
