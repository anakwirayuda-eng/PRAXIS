from __future__ import annotations

import json
import os
import re
import sqlite3
import sys
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parent.parent
JSON_FILE = ROOT / "public" / "data" / "compiled_cases.json"
QUEUE_FILE = ROOT / "ingestion" / "output" / "readability_manual_review_queue.json"
REPORT_FILE = ROOT / "ingestion" / "output" / "igakuqa_stem_restore_wave1_report.json"
BASIS = "deterministic:igakuqa-source-stem-restore-wave1"
MULTI_SELECT_RE = re.compile(
    r"\b(select|choose)\s+(?:the\s+)?(?:best\s+)?(?:two|2)\b|\btwo of the following\b",
    re.IGNORECASE,
)


def infer_primary_workspace(root: Path) -> Path | None:
    suffix = "_main_release"
    if not root.name.endswith(suffix):
        return None
    sibling = root.with_name(root.name[: -len(suffix)])
    return sibling if sibling.exists() else None


def resolve_db_file() -> Path:
    explicit = os.environ.get("CASEBANK_DB_PATH")
    if explicit:
        return Path(explicit)
    local = ROOT / "server" / "data" / "casebank.db"
    if local.exists() and local.stat().st_size > 0:
        return local
    sibling = infer_primary_workspace(ROOT)
    if sibling:
        candidate = sibling / "server" / "data" / "casebank.db"
        if candidate.exists() and candidate.stat().st_size > 0:
            return candidate
    raise FileNotFoundError("Unable to resolve CASEBANK_DB_PATH or a non-empty casebank.db")


def resolve_source_file() -> Path:
    explicit = os.environ.get("IGAKUQA_SOURCE_PATH")
    if explicit:
        return Path(explicit)
    local = ROOT / "ingestion" / "output" / "igakuqa_translated.json"
    if local.exists():
        return local
    sibling = infer_primary_workspace(ROOT)
    if sibling:
        candidate = sibling / "ingestion" / "output" / "igakuqa_translated.json"
        if candidate.exists():
            return candidate
    raise FileNotFoundError("Unable to resolve IGAKUQA_SOURCE_PATH or igakuqa_translated.json")


DB_FILE = resolve_db_file()
SOURCE_FILE = resolve_source_file()


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


def with_quality_flag(meta: dict[str, Any], flag: str) -> None:
    flags = meta.get("quality_flags")
    if not isinstance(flags, list):
        flags = []
    if flag not in flags:
        flags.append(flag)
    meta["quality_flags"] = flags


def clear_readability_holds(meta: dict[str, Any]) -> None:
    for key in (
        "needs_review",
        "needs_review_reason",
        "truncated",
        "readability_ai_hold",
        "readability_ai_hold_at",
        "readability_ai_hold_basis",
        "readability_ai_hold_notes",
        "readability_integrity_hold",
    ):
        meta.pop(key, None)


def option_texts(options: list[dict[str, Any]]) -> list[str]:
    return [normalize_text(option.get("text")) for option in options]


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


def main() -> None:
    queue_rows = read_json(QUEUE_FILE, [])
    source_rows = read_json(SOURCE_FILE, [])
    json_cases = read_json(JSON_FILE, [])

    targets = [row for row in queue_rows if row.get("source") == "igakuqa"]
    target_ids = [int(row["_id"]) for row in targets]
    source_by_case_code = {
        normalize_text(row.get("case_code")): row
        for row in source_rows
        if normalize_text(row.get("case_code"))
    }

    connection = sqlite3.connect(DB_FILE)
    connection.row_factory = sqlite3.Row
    cases_by_id = load_case_rows(connection, target_ids)

    applied: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []
    updates: dict[int, dict[str, Any]] = {}
    timestamp = datetime.now(timezone.utc).isoformat()

    for queue_row in targets:
        case_id = int(queue_row["_id"])
        case_data = cases_by_id.get(case_id)
        if not case_data:
            skipped.append({"case_id": case_id, "case_code": queue_row.get("case_code"), "reason": "missing_case"})
            continue

        case_code = normalize_text(case_data.get("case_code"))
        source_row = source_by_case_code.get(case_code)
        if not source_row:
            skipped.append({"case_id": case_id, "case_code": case_code, "reason": "missing_source"})
            continue

        question = normalize_text(source_row.get("question"))
        if not question:
            skipped.append({"case_id": case_id, "case_code": case_code, "reason": "missing_source_question"})
            continue

        if normalize_text(case_data.get("prompt")) or normalize_text(get_narrative(case_data)):
            skipped.append({"case_id": case_id, "case_code": case_code, "reason": "already_has_text"})
            continue

        if MULTI_SELECT_RE.search(question):
            skipped.append(
                {
                    "case_id": case_id,
                    "case_code": case_code,
                    "reason": "multi_select_source",
                    "source_question": summarize_text(question),
                }
            )
            continue

        current_options = option_texts(case_data.get("options") or [])
        source_options = option_texts(source_row.get("options") or [])
        if current_options != source_options:
            skipped.append(
                {
                    "case_id": case_id,
                    "case_code": case_code,
                    "reason": "option_mismatch",
                    "current_options": current_options,
                    "source_options": source_options,
                }
            )
            continue

        updated = deepcopy(case_data)
        updated["title"] = question
        updated["prompt"] = question
        set_narrative(updated, question)

        source_rationale = source_row.get("rationale")
        source_correct = ""
        if isinstance(source_rationale, dict):
            source_correct = normalize_text(source_rationale.get("correct"))
        else:
            source_correct = normalize_text(source_rationale)
        if source_correct:
            rationale = updated.get("rationale")
            if isinstance(rationale, dict):
                rationale["correct"] = source_correct
            else:
                updated["rationale"] = {"correct": source_correct}

        meta = deepcopy(updated.get("meta") or {})
        clear_readability_holds(meta)
        meta["avg_option_length"] = compute_avg_option_length(updated.get("options") or [])
        meta["readability_source_restore_at"] = timestamp
        meta["readability_source_restore_basis"] = BASIS
        with_quality_flag(meta, "readability_source_restore")
        updated["meta"] = meta

        updates[case_id] = updated
        applied.append(
            {
                "case_id": case_id,
                "case_code": case_code,
                "original_id": meta.get("original_id"),
                "source_question": summarize_text(question),
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
        "source_file": str(SOURCE_FILE),
        "queue_file": str(QUEUE_FILE),
        "target_count": len(targets),
        "applied_count": len(applied),
        "skipped_count": len(skipped),
        "applied": applied,
        "skipped": skipped,
    }
    write_json_atomic(REPORT_FILE, report)
    sys.stdout.buffer.write((json.dumps(report, ensure_ascii=False, indent=2) + "\n").encode("utf-8", errors="replace"))


if __name__ == "__main__":
    main()
