from __future__ import annotations

import json
import sqlite3
import sys
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

try:
    from ingestion.apply_medqa_image_detach_wave2 import (
        DB_FILE,
        JSON_FILE,
        compute_avg_option_length,
        load_case_rows,
        persist_sqlite,
        read_json,
        rebuild_answer_anchor_text,
        summarize_text,
        update_json_cases,
        with_quality_flag,
        write_json_atomic,
    )
except ModuleNotFoundError:
    sys.path.append(str(Path(__file__).resolve().parent.parent))
    from ingestion.apply_medqa_image_detach_wave2 import (
        DB_FILE,
        JSON_FILE,
        compute_avg_option_length,
        load_case_rows,
        persist_sqlite,
        read_json,
        rebuild_answer_anchor_text,
        summarize_text,
        update_json_cases,
        with_quality_flag,
        write_json_atomic,
    )


ROOT = Path(__file__).resolve().parent.parent
REPORT_FILE = ROOT / "ingestion" / "output" / "polish_ldek_false_positive_wave1_report.json"
BASIS = "deterministic:polish-ldek-false-positive-wave1"

TARGET_IDS = [
    61405,
    60324,
    61848,
    60486,
    60695,
    61911,
    62449,
    60565,
    60629,
    61058,
    59964,
    60941,
    61009,
    61732,
    60684,
]


def without_quality_flags(meta: dict[str, Any], remove: set[str]) -> None:
    flags = meta.get("quality_flags")
    if not isinstance(flags, list):
        return
    remaining = [flag for flag in flags if flag not in remove]
    if remaining:
        meta["quality_flags"] = remaining
    else:
        meta.pop("quality_flags", None)


def apply_release(current: dict[str, Any], timestamp: str) -> dict[str, Any]:
    updated = deepcopy(current)
    meta = deepcopy(updated.get("meta") or {})
    meta["needs_review"] = False
    meta["truncated"] = False
    meta["quarantined"] = False
    for key in (
        "status",
        "quarantine_reason",
        "needs_review_reason",
        "needs_review_reasons",
        "readability_ai_hold",
        "readability_ai_hold_at",
        "readability_ai_hold_basis",
        "readability_ai_hold_notes",
        "readability_integrity_hold",
        "radar_tokens",
    ):
        meta.pop(key, None)
    without_quality_flags(meta, {"readability_batch_salvage_hold"})
    meta["avg_option_length"] = compute_avg_option_length(updated.get("options") or [])
    meta["readability_ai_pass"] = True
    meta["readability_ai_pass_basis"] = BASIS
    meta["readability_false_positive_reason"] = "Valid LDEK combination/AOTA option format; not unreadable source corruption."
    meta["polish_ldek_false_positive_release_at"] = timestamp
    with_quality_flag(meta, "readability_false_positive_released")
    updated["meta"] = meta
    return updated


def main() -> None:
    timestamp = datetime.now(timezone.utc).isoformat()
    json_cases = read_json(JSON_FILE, [])
    connection = sqlite3.connect(DB_FILE)
    connection.row_factory = sqlite3.Row
    cases_by_id = load_case_rows(connection, TARGET_IDS)
    updates: dict[int, dict[str, Any]] = {}
    rows: list[dict[str, Any]] = []

    for case_id in TARGET_IDS:
        current = cases_by_id.get(case_id)
        if not current:
            rows.append({"case_id": case_id, "status": "missing_case"})
            continue
        updated = apply_release(current, timestamp)
        updates[case_id] = updated
        rows.append(
            {
                "case_id": case_id,
                "case_code": updated.get("case_code"),
                "source": updated.get("source"),
                "status": "released_false_positive",
                "prompt": summarize_text(updated.get("prompt") or ""),
                "answer_anchor_text": rebuild_answer_anchor_text(updated.get("options") or []),
            }
        )

    persist_sqlite(connection, list(updates.values()))
    connection.close()
    update_json_cases(json_cases, updates)
    write_json_atomic(JSON_FILE, json_cases)
    report = {
        "generated_at": timestamp,
        "basis": BASIS,
        "db_file": str(DB_FILE),
        "applied_count": len(updates),
        "rows": rows,
    }
    write_json_atomic(REPORT_FILE, report)
    sys.stdout.buffer.write((json.dumps(report, ensure_ascii=False, indent=2) + "\n").encode("utf-8", errors="replace"))


if __name__ == "__main__":
    main()
