from __future__ import annotations

import json
import os
import sqlite3
import re
from collections import Counter
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parent.parent
DB_FILE = Path(os.environ["CASEBANK_DB_PATH"]) if os.environ.get("CASEBANK_DB_PATH") else ROOT / "server" / "data" / "casebank.db"
JSON_FILE = ROOT / "public" / "data" / "compiled_cases.json"
REPORT_FILE = ROOT / "ingestion" / "output" / "medmcqa_truncated_false_positive_clear_report.json"


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


def get_source(case_data: dict[str, Any]) -> str:
    meta = case_data.get("meta") or {}
    return str(meta.get("source") or case_data.get("source") or "").strip()


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


def rationale_text(case_data: dict[str, Any]) -> str:
    rationale = case_data.get("rationale")
    if isinstance(rationale, dict):
        return normalize_text(rationale.get("correct"))
    return normalize_text(rationale)


def is_safe_option_text(text: Any) -> bool:
    normalized = normalize_text(text)
    if not normalized:
        return False
    if any(marker in normalized for marker in ("[", "]", "?")):
        return False
    if re.fullmatch(r"\d+-[A-Za-z]{3}", normalized):
        return False
    if len(normalized) >= 3:
        return True
    if re.fullmatch(r"[IVXLCM]+", normalized):
        return True
    if re.fullmatch(r"[A-Z]{2,5}", normalized):
        return True
    if re.fullmatch(r"[A-Z][0-9]{1,2}[a-z]?", normalized):
        return True
    if re.fullmatch(r"[0-9]{1,3}(?:\.[0-9]+)?%?", normalized):
        return True
    return False


def has_complete_options(case_data: dict[str, Any]) -> bool:
    options = case_data.get("options") or []
    if len(options) < 4:
        return False
    if sum(1 for option in options if option.get("is_correct") is True) != 1:
        return False
    return all(is_safe_option_text(option.get("text")) for option in options)


def load_case_rows(connection: sqlite3.Connection) -> dict[int, dict[str, Any]]:
    rows = connection.execute(
        """
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
        """
    ).fetchall()
    option_rows = connection.execute(
        """
        SELECT case_id, option_id, sort_order, option_text, is_correct
        FROM case_options
        ORDER BY case_id, sort_order
        """
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


def classify_candidate(case_data: dict[str, Any]) -> tuple[bool, str]:
    meta = case_data.get("meta") or {}
    if get_source(case_data) != "medmcqa":
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
    stem = prompt or narrative or normalize_text(case_data.get("title"))
    if len(stem) < 18:
        return False, "short_stem"
    if "..." in stem or stem.endswith(".."):
        return False, "ellipsis_stem"
    return True, "candidate"


def apply_case_update(case_data: dict[str, Any]) -> dict[str, Any]:
    updated = deepcopy(case_data)
    meta = updated.setdefault("meta", {})

    updated["prompt"] = normalize_text(updated.get("prompt"))
    updated["title"] = normalize_text(updated.get("title")) or updated["prompt"]
    set_narrative(updated, normalize_text(get_narrative(updated)))

    meta["truncated"] = False
    with_quality_flag(meta, "truncated_false_positive_cleared")
    return updated


def case_changed(before: dict[str, Any], after: dict[str, Any]) -> bool:
    for key in ("title", "prompt", "vignette", "meta"):
        if before.get(key) != after.get(key):
            return True
    return False


def main() -> None:
    connection = sqlite3.connect(DB_FILE)
    connection.row_factory = sqlite3.Row
    try:
        case_map = load_case_rows(connection)
        json_cases = read_json(JSON_FILE, [])

        changed_cases: dict[int, dict[str, Any]] = {}
        report: dict[str, Any] = {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "target_source": "medmcqa",
            "scanned_cases": 0,
            "changed_cases": 0,
            "skipped_cases": {},
            "samples": [],
        }
        skipped = Counter()

        for case_id, current in case_map.items():
            if get_source(current) != "medmcqa":
                continue
            meta = current.get("meta") or {}
            if meta.get("truncated") is not True:
                continue
            report["scanned_cases"] += 1

            safe, reason = classify_candidate(current)
            if not safe:
                skipped[reason] += 1
                continue

            updated = apply_case_update(current)
            if not case_changed(current, updated):
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
            write_json(JSON_FILE, json_cases)
        write_json(REPORT_FILE, report)

        print("MEDMCQA TRUNCATED FALSE POSITIVE CLEAR")
        print(f"  Scanned cases:  {report['scanned_cases']:,}")
        print(f"  Changed cases:  {report['changed_cases']:,}")
        if report["skipped_cases"]:
            print("  Skipped:")
            for reason, count in report["skipped_cases"].items():
                print(f"    - {reason}: {count:,}")
        print(f"  Report:         {REPORT_FILE}")
    finally:
        connection.close()


if __name__ == "__main__":
    main()
