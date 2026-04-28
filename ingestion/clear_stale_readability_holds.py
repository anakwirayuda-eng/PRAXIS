from __future__ import annotations

import json
import os
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parent.parent
DB_FILE = Path(os.environ["CASEBANK_DB_PATH"]) if os.environ.get("CASEBANK_DB_PATH") else ROOT / "server" / "data" / "casebank.db"
JSON_FILE = ROOT / "public" / "data" / "compiled_cases.json"
REPORT_FILE = ROOT / "ingestion" / "output" / "stale_readability_holds_clear_report.json"

HOLD_KEYS = {
    "readability_ai_hold",
    "readability_ai_hold_basis",
    "readability_ai_hold_at",
    "readability_ai_hold_reasoning",
    "readability_ai_hold_notes",
    "readability_integrity_hold",
}
STALE_QUALITY_FLAGS = {
    "readability_batch_salvage_hold",
}


def read_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def write_json_atomic(path: Path, value: Any) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    tmp.replace(path)


def correct_count(connection: sqlite3.Connection, case_id: int) -> int:
    row = connection.execute(
        "SELECT COALESCE(SUM(is_correct), 0) AS count FROM case_options WHERE case_id = ?",
        (case_id,),
    ).fetchone()
    return int(row["count"] or 0)


def primary_stem_length(row: sqlite3.Row) -> int:
    return len(" ".join([str(row["title"] or ""), str(row["prompt"] or "")]).strip())


def is_quarantined(row: sqlite3.Row, meta: dict[str, Any]) -> bool:
    status = str(row["meta_status"] or meta.get("status") or "")
    return meta.get("quarantined") is True or status.startswith("QUARANTINED")


def clean_meta(meta: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
    updated = dict(meta)
    removed: list[str] = []
    for key in HOLD_KEYS:
        if key in updated:
            updated.pop(key, None)
            removed.append(key)

    flags = updated.get("quality_flags")
    if isinstance(flags, list):
        remaining = [flag for flag in flags if flag not in STALE_QUALITY_FLAGS]
        if len(remaining) != len(flags):
            removed.append("quality_flags.readability_batch_salvage_hold")
            if remaining:
                updated["quality_flags"] = remaining
            else:
                updated.pop("quality_flags", None)

    return updated, removed


def main() -> None:
    timestamp = datetime.now(timezone.utc).isoformat()
    connection = sqlite3.connect(DB_FILE)
    connection.row_factory = sqlite3.Row
    rows = connection.execute(
        """
        SELECT case_id, case_code, source, title, prompt, meta_status, meta_json
        FROM cases
        WHERE meta_json LIKE '%readability_ai_hold%'
           OR meta_json LIKE '%readability_integrity_hold%'
           OR meta_json LIKE '%readability_batch_salvage_hold%'
        ORDER BY case_id
        """
    ).fetchall()

    updates: dict[int, dict[str, Any]] = {}
    report_rows: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []

    for row in rows:
        case_id = int(row["case_id"])
        meta = json.loads(row["meta_json"] or "{}")
        has_current_integrity_problem = (
            not is_quarantined(row, meta)
            and (correct_count(connection, case_id) != 1 or primary_stem_length(row) < 10)
        )
        if has_current_integrity_problem:
            skipped.append(
                {
                    "case_id": case_id,
                    "case_code": row["case_code"],
                    "source": row["source"],
                    "reason": "current_integrity_problem_still_present",
                }
            )
            continue

        cleaned, removed = clean_meta(meta)
        if not removed:
            continue
        updates[case_id] = cleaned
        report_rows.append(
            {
                "case_id": case_id,
                "case_code": row["case_code"],
                "source": row["source"],
                "removed": removed,
            }
        )

    with connection:
        for case_id, meta in updates.items():
            connection.execute(
                """
                UPDATE cases
                SET meta_json = ?,
                    meta_status = ?
                WHERE case_id = ?
                """,
                (json.dumps(meta, ensure_ascii=False), meta.get("status") or "", case_id),
            )
    connection.close()

    json_cases = read_json(JSON_FILE, [])
    json_updates = 0
    for case_data in json_cases:
        case_id = case_data.get("_id")
        if case_id not in updates:
            continue
        case_data["meta"] = updates[case_id]
        json_updates += 1
    if updates:
        write_json_atomic(JSON_FILE, json_cases)

    report = {
        "generated_at": timestamp,
        "db_file": str(DB_FILE),
        "json_file": str(JSON_FILE),
        "scanned_rows": len(rows),
        "updated_rows": len(updates),
        "json_updates": json_updates,
        "skipped_rows": skipped,
        "rows": report_rows,
    }
    write_json_atomic(REPORT_FILE, report)
    sys.stdout.buffer.write((json.dumps(report, ensure_ascii=False, indent=2) + "\n").encode("utf-8"))


if __name__ == "__main__":
    main()
