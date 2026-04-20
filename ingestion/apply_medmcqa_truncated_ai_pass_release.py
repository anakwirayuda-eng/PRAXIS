from __future__ import annotations

import json
import os
import sqlite3
import sys
from collections import Counter
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

try:
    from ingestion.readability_rules import EXPLICIT_IMAGE_DEPENDENT_RE
except ModuleNotFoundError:
    sys.path.append(str(Path(__file__).resolve().parent.parent))
    from ingestion.readability_rules import EXPLICIT_IMAGE_DEPENDENT_RE


ROOT = Path(__file__).resolve().parent.parent
DB_FILE = Path(os.environ["CASEBANK_DB_PATH"]) if os.environ.get("CASEBANK_DB_PATH") else ROOT / "server" / "data" / "casebank.db"
JSON_FILE = ROOT / "public" / "data" / "compiled_cases.json"
QUEUE_FILE = ROOT / "ingestion" / "output" / "readability_manual_review_queue.json"
REPORT_FILE = ROOT / "ingestion" / "output" / "medmcqa_truncated_ai_pass_release_report.json"

GENERIC_PROMPTS = {
    "diagnosis is",
    "the finding is suggestive of",
    "x is likely to",
    "what is the diagnosis",
    "what is the finding",
}


def read_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def write_json_atomic(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = path.with_suffix(path.suffix + ".tmp")
    payload = json.dumps(value, ensure_ascii=False, indent=2) + "\n"
    try:
        with temp_path.open("w", encoding="utf-8", newline="\n") as handle:
            handle.write(payload)
        temp_path.replace(path)
    except OSError:
        temp_path.unlink(missing_ok=True)
        with path.open("w", encoding="utf-8", newline="\n") as handle:
            handle.write(payload)


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


def with_quality_flag(meta: dict[str, Any], flag: str) -> None:
    flags = meta.get("quality_flags")
    if not isinstance(flags, list):
        flags = []
    if flag not in flags:
        flags.append(flag)
    meta["quality_flags"] = flags


def option_texts(case_data: dict[str, Any]) -> list[str]:
    return [normalize_text(option.get("text")) for option in case_data.get("options") or []]


def compute_avg_option_length(options: list[dict[str, Any]]) -> float:
    if not options:
        return 0.0
    total = sum(len(normalize_text(option.get("text"))) for option in options)
    return round(total / len(options), 1)


def rebuild_answer_anchor_text(options: list[dict[str, Any]]) -> str:
    for option in options:
        if option.get("is_correct") is True:
            return normalize_text(option.get("text"))
    return ""


def rationale_text(case_data: dict[str, Any]) -> str:
    rationale = case_data.get("rationale")
    if isinstance(rationale, dict):
        return normalize_text(rationale.get("correct"))
    return normalize_text(rationale)


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
          quality_score,
          clinical_consensus,
          t9_verified,
          t10_verified,
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

    options_by_case: dict[int, list[dict[str, Any]]] = {}
    for row in option_rows:
        case_id = int(row["case_id"])
        options_by_case.setdefault(case_id, []).append(
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
        case_id = int(row["case_id"])
        cases[case_id] = {
            "_id": case_id,
            "case_code": row["case_code"] or "",
            "hash_id": row["hash_id"],
            "title": row["title"] or "",
            "prompt": row["prompt"] or "",
            "source": row["source"] or "",
            "quality_score": row["quality_score"],
            "vignette": parse_json(row["vignette_json"], {}),
            "rationale": parse_json(row["rationale_json"], {}),
            "meta": meta,
            "validation": parse_json(row["validation_json"], {}),
            "options": options_by_case.get(case_id, []),
        }
    return cases


def persist_sqlite(connection: sqlite3.Connection, cases: list[dict[str, Any]]) -> None:
    with connection:
        for case_data in cases:
            meta = case_data.get("meta") or {}
            options = case_data.get("options") or []
            connection.execute(
                """
                UPDATE cases
                SET
                  title = ?,
                  prompt = ?,
                  option_count = ?,
                  answer_anchor_text = ?,
                  meta_status = ?,
                  clinical_consensus = ?,
                  t9_verified = ?,
                  t10_verified = ?,
                  vignette_json = ?,
                  rationale_json = ?,
                  meta_json = ?,
                  validation_json = ?
                WHERE case_id = ?
                """,
                (
                    case_data.get("title") or "",
                    case_data.get("prompt") or "",
                    len(options),
                    rebuild_answer_anchor_text(options),
                    meta.get("status") or "",
                    meta.get("clinical_consensus") or "",
                    1 if (meta.get("_openclaw_t9_v2") or meta.get("_openclaw_t9_verified")) else 0,
                    1 if meta.get("_openclaw_t10_verified") else 0,
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


def case_payload_changed(before: dict[str, Any], after: dict[str, Any]) -> bool:
    keys = ("title", "prompt", "vignette", "meta")
    return any(before.get(key) != after.get(key) for key in keys)


def classify_candidate(case_data: dict[str, Any], queue_item: dict[str, Any]) -> tuple[bool, str]:
    meta = case_data.get("meta") or {}
    reason_codes = {reason.get("code") for reason in queue_item.get("reasons", [])}
    if case_data.get("source") != "medmcqa":
        return False, "unsupported_source"
    if reason_codes != {"truncated"}:
        return False, "mixed_reason_codes"
    if meta.get("truncated") is not True:
        return False, "not_truncated"
    if meta.get("readability_ai_pass") is not True:
        return False, "ai_pass_missing"
    if meta.get("needs_review") is True:
        return False, "needs_review_true"
    status = str(meta.get("status") or "")
    if status and status != "QUARANTINED_DISSONANCE":
        return False, "unsupported_status"

    prompt = normalize_text(case_data.get("prompt"))
    narrative = normalize_text(get_narrative(case_data))
    if len(prompt) < 12:
        return False, "short_prompt"
    if prompt.lower().rstrip(":?") in GENERIC_PROMPTS:
        return False, "generic_prompt"
    if EXPLICIT_IMAGE_DEPENDENT_RE.search("\n".join(part for part in (prompt, narrative) if part)):
        return False, "image_dependency"

    options = case_data.get("options") or []
    if len(options) < 4:
        return False, "incomplete_options"
    if sum(1 for option in options if option.get("is_correct") is True) != 1:
        return False, "invalid_correct_count"
    if len(rationale_text(case_data)) < 80:
        return False, "weak_rationale"
    return True, "candidate"


def apply_case_update(case_data: dict[str, Any]) -> dict[str, Any]:
    updated = deepcopy(case_data)
    meta = updated.setdefault("meta", {})

    prompt = normalize_text(updated.get("prompt"))
    narrative = normalize_text(get_narrative(updated))
    updated["prompt"] = prompt
    updated["title"] = normalize_text(updated.get("title")) or prompt
    if narrative == prompt:
        set_narrative(updated, "")
    else:
        set_narrative(updated, narrative)

    meta["truncated"] = False
    if meta.get("quarantined") is not False:
        meta["quarantined"] = False
    for key in ("status", "quarantine_reason", "radar_tokens"):
        if key in meta:
            del meta[key]
    meta["option_count"] = len(updated.get("options") or [])
    meta["avg_option_length"] = compute_avg_option_length(updated.get("options") or [])
    meta["answer_anchor_text"] = rebuild_answer_anchor_text(updated.get("options") or [])
    with_quality_flag(meta, "medmcqa_truncated_ai_pass_released")
    return updated


def main() -> None:
    queue = read_json(QUEUE_FILE, [])
    target_items = [item for item in queue if item.get("source") == "medmcqa"]
    target_ids = [int(item["_id"]) for item in target_items]

    connection = sqlite3.connect(DB_FILE)
    connection.row_factory = sqlite3.Row
    try:
        case_map = load_case_rows(connection, target_ids)
        json_cases = read_json(JSON_FILE, [])
        json_ids = {item.get("_id") for item in json_cases}

        changed_cases: dict[int, dict[str, Any]] = {}
        skipped = Counter()
        report: dict[str, Any] = {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "target_source": "medmcqa",
            "queue_targets": len(target_items),
            "changed_cases": 0,
            "missing_in_sqlite": [],
            "missing_in_json": [],
            "skipped_cases": {},
            "samples": [],
        }

        for queue_item in target_items:
            case_id = int(queue_item["_id"])
            current = case_map.get(case_id)
            if current is None:
                report["missing_in_sqlite"].append(case_id)
                continue
            if case_id not in json_ids:
                report["missing_in_json"].append(case_id)

            safe, reason = classify_candidate(current, queue_item)
            if not safe:
                skipped[reason] += 1
                continue

            updated = apply_case_update(current)
            if not case_payload_changed(current, updated):
                skipped["unchanged_after_apply"] += 1
                continue

            changed_cases[case_id] = updated
            report["changed_cases"] += 1
            if len(report["samples"]) < 20:
                report["samples"].append(
                    {
                        "_id": case_id,
                        "case_code": updated.get("case_code"),
                        "prompt": summarize_text(updated.get("prompt") or ""),
                        "narrative": summarize_text(get_narrative(updated)),
                    }
                )

        report["skipped_cases"] = dict(skipped.most_common())

        if changed_cases:
            persist_sqlite(connection, list(changed_cases.values()))
            update_json_cases(json_cases, changed_cases)
            write_json_atomic(JSON_FILE, json_cases)

        write_json_atomic(REPORT_FILE, report)

        print("MEDMCQA TRUNCATED AI-PASS RELEASE")
        print(f"  Queue targets:  {report['queue_targets']:,}")
        print(f"  Changed cases:  {report['changed_cases']:,}")
        print(f"  Report:         {REPORT_FILE}")
        if report["skipped_cases"]:
            print("  Skipped:")
            for reason, count in report["skipped_cases"].items():
                print(f"    - {reason}: {count:,}")
    finally:
        connection.close()


if __name__ == "__main__":
    main()
