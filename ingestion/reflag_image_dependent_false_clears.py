from __future__ import annotations

import json
import sqlite3
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

try:
    from ingestion.readability_rules import is_explicit_image_dependent, normalize_compact_text
except ModuleNotFoundError:
    sys.path.append(str(Path(__file__).resolve().parent.parent))
    from ingestion.readability_rules import is_explicit_image_dependent, normalize_compact_text


ROOT = Path(__file__).resolve().parent.parent
DB_FILE = ROOT / "server" / "data" / "casebank.db"
JSON_FILE = ROOT / "public" / "data" / "compiled_cases.json"
REPORT_FILE = ROOT / "ingestion" / "output" / "image_dependent_false_clear_report.json"

SYNTHETIC_REASON = "image_dependency_detected"
SYNC_ANCHOR_FLAG = "truncated_false_positive_cleared"
SYNTHETIC_FLAG = "image_dependency_detected"


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


def get_reason_list(meta: dict[str, Any]) -> list[str]:
    reasons = meta.get("needs_review_reasons")
    if isinstance(reasons, list):
        return [str(reason).strip() for reason in reasons if str(reason).strip()]
    return []


def set_reason_list(meta: dict[str, Any], reasons: list[str]) -> None:
    if reasons:
        meta["needs_review_reasons"] = reasons
    else:
        meta.pop("needs_review_reasons", None)


def with_quality_flag(meta: dict[str, Any], flag: str) -> None:
    flags = meta.get("quality_flags")
    if not isinstance(flags, list):
        flags = []
    if flag not in flags:
        flags.append(flag)
    meta["quality_flags"] = flags


def without_quality_flag(meta: dict[str, Any], flag: str) -> None:
    flags = meta.get("quality_flags")
    if not isinstance(flags, list):
        return
    filtered = [item for item in flags if item != flag]
    if filtered:
        meta["quality_flags"] = filtered
    else:
        meta.pop("quality_flags", None)


def add_needs_review(meta: dict[str, Any], reason: str) -> None:
    meta["needs_review"] = True
    reasons = get_reason_list(meta)
    if reason not in reasons:
        reasons.append(reason)
        set_reason_list(meta, reasons)
    primary_reason = str(meta.get("needs_review_reason") or "").strip()
    if not primary_reason:
        meta["needs_review_reason"] = reason


def remove_needs_review(meta: dict[str, Any], reason: str) -> None:
    reasons = [item for item in get_reason_list(meta) if item != reason]
    set_reason_list(meta, reasons)

    primary_reason = str(meta.get("needs_review_reason") or "").strip()
    if primary_reason == reason:
        if reasons:
            meta["needs_review_reason"] = reasons[0]
        else:
            meta.pop("needs_review_reason", None)

    still_blocked = False
    if reasons:
        still_blocked = True
    elif str(meta.get("needs_review_reason") or "").strip():
        still_blocked = True
    elif meta.get("truncated") is True:
        still_blocked = True
    else:
        status = str(meta.get("status") or "")
        still_blocked = meta.get("quarantined") is True or status.startswith("QUARANTINED")

    if still_blocked:
        meta["needs_review"] = True
    else:
        meta["needs_review"] = False


def get_narrative(case_data: dict[str, Any]) -> str:
    vignette = case_data.get("vignette")
    if isinstance(vignette, dict):
        return str(vignette.get("narrative") or "")
    return str(vignette or "")


def persist_sqlite(connection: sqlite3.Connection, cases: list[dict[str, Any]]) -> None:
    with connection:
        for case_data in cases:
            connection.execute(
                """
                UPDATE cases
                SET
                  meta_status = ?,
                  meta_json = ?
                WHERE case_id = ?
                """,
                (
                    str((case_data.get("meta") or {}).get("status") or ""),
                    json.dumps(case_data.get("meta") or {}, ensure_ascii=False),
                    int(case_data["_id"]),
                ),
            )


def update_json_cases(json_cases: list[dict[str, Any]], updates: dict[int, dict[str, Any]]) -> None:
    for item in json_cases:
        case_id = item.get("_id")
        if case_id not in updates:
            continue
        item["meta"] = updates[case_id]["meta"]


def is_sync_candidate(meta: dict[str, Any]) -> bool:
    flags = meta.get("quality_flags")
    if isinstance(flags, list) and (SYNC_ANCHOR_FLAG in flags or SYNTHETIC_FLAG in flags):
        return True
    if str(meta.get("needs_review_reason") or "").strip() == SYNTHETIC_REASON:
        return True
    return SYNTHETIC_REASON in get_reason_list(meta)


def has_synthetic_marker(meta: dict[str, Any]) -> bool:
    flags = meta.get("quality_flags")
    if isinstance(flags, list) and SYNTHETIC_FLAG in flags:
        return True
    if str(meta.get("needs_review_reason") or "").strip() == SYNTHETIC_REASON:
        return True
    return SYNTHETIC_REASON in get_reason_list(meta)


def clear_redundant_false_state(meta: dict[str, Any]) -> None:
    if meta.get("needs_review") is not False:
        return
    if get_reason_list(meta):
        return
    if str(meta.get("needs_review_reason") or "").strip():
        return
    if meta.get("truncated") is True:
        return
    status = str(meta.get("status") or "")
    if meta.get("quarantined") is True or status.startswith("QUARANTINED"):
        return
    meta.pop("needs_review", None)


def main() -> None:
    connection = sqlite3.connect(DB_FILE)
    connection.row_factory = sqlite3.Row
    try:
        rows = connection.execute(
            """
            SELECT case_id, source, title, prompt, vignette_json, meta_json
            FROM cases
            """
        ).fetchall()

        updates: dict[int, dict[str, Any]] = {}
        report: dict[str, Any] = {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "evaluated_candidates": 0,
            "flagged_cases": 0,
            "cleared_cases": 0,
            "unchanged_cases": 0,
            "by_source_flagged": Counter(),
            "by_source_cleared": Counter(),
            "samples_flagged": [],
            "samples_cleared": [],
        }

        for row in rows:
            meta = parse_json(row["meta_json"], {})
            if not is_sync_candidate(meta):
                continue

            report["evaluated_candidates"] += 1
            prompt = row["prompt"] or ""
            title = row["title"] or ""
            narrative = get_narrative({"vignette": parse_json(row["vignette_json"], {})})
            should_flag = is_explicit_image_dependent(title, prompt, narrative)

            updated_meta = dict(meta)
            before_meta = json.dumps(meta, ensure_ascii=False, sort_keys=True)
            source = row["source"] or "unknown"
            synthetic_marker_present = has_synthetic_marker(updated_meta)

            if should_flag:
                add_needs_review(updated_meta, SYNTHETIC_REASON)
                with_quality_flag(updated_meta, SYNTHETIC_FLAG)
            else:
                if synthetic_marker_present:
                    remove_needs_review(updated_meta, SYNTHETIC_REASON)
                    without_quality_flag(updated_meta, SYNTHETIC_FLAG)
                clear_redundant_false_state(updated_meta)

            after_meta = json.dumps(updated_meta, ensure_ascii=False, sort_keys=True)
            if before_meta == after_meta:
                report["unchanged_cases"] += 1
                continue

            case_id = int(row["case_id"])
            updates[case_id] = {
                "_id": case_id,
                "meta": updated_meta,
            }

            sample = {
                "_id": case_id,
                "source": source,
                "prompt": normalize_compact_text(prompt)[:220],
            }
            if should_flag:
                report["flagged_cases"] += 1
                report["by_source_flagged"][source] += 1
                if len(report["samples_flagged"]) < 20:
                    report["samples_flagged"].append(sample)
            else:
                report["cleared_cases"] += 1
                report["by_source_cleared"][source] += 1
                if len(report["samples_cleared"]) < 20:
                    report["samples_cleared"].append(sample)

        if updates:
            persist_sqlite(connection, list(updates.values()))
            json_cases = read_json(JSON_FILE, [])
            update_json_cases(json_cases, updates)
            write_json(JSON_FILE, json_cases)

        report["by_source_flagged"] = dict(report["by_source_flagged"].most_common())
        report["by_source_cleared"] = dict(report["by_source_cleared"].most_common())
        write_json(REPORT_FILE, report)

        print("IMAGE-DEPENDENT FALSE-CLEAR SYNC")
        print(f"  Evaluated:      {report['evaluated_candidates']:,}")
        print(f"  Flagged cases:  {report['flagged_cases']:,}")
        print(f"  Cleared cases:  {report['cleared_cases']:,}")
        print(f"  Unchanged:      {report['unchanged_cases']:,}")
        if report["by_source_flagged"]:
            print("  Flagged by source:")
            for source, count in report["by_source_flagged"].items():
                print(f"    - {source}: {count:,}")
        if report["by_source_cleared"]:
            print("  Cleared by source:")
            for source, count in report["by_source_cleared"].items():
                print(f"    - {source}: {count:,}")
        print(f"  Report:         {REPORT_FILE}")
    finally:
        connection.close()


if __name__ == "__main__":
    main()
