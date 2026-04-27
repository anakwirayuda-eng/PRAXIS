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
from uuid import uuid4


ROOT = Path(__file__).resolve().parent.parent
JSON_FILE = ROOT / "public" / "data" / "compiled_cases.json"
REPORT_FILE = ROOT / "ingestion" / "output" / "igakuqa_multiselect_collapse_wave2_report.json"
BASIS = "editorial:igakuqa-multiselect-collapse-wave2"
MULTI_SELECT_TAIL_RE = re.compile(r"\s*(?:choose|select)\s+(?:the\s+)?(?:best\s+)?(?:two|2)\.?\s*$", re.IGNORECASE)


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
    temp_path = path.with_name(f"{path.name}.{uuid4().hex}.tmp")
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


def with_quality_flag(meta: dict[str, Any], flag: str) -> None:
    flags = meta.get("quality_flags")
    if not isinstance(flags, list):
        flags = []
    if flag not in flags:
        flags.append(flag)
    meta["quality_flags"] = flags


def load_case_rows(connection: sqlite3.Connection, ids: list[int]) -> dict[int, dict[str, Any]]:
    if not ids:
        return {}
    placeholders = ",".join("?" for _ in ids)
    rows = connection.execute(
        f"""
        SELECT case_id, case_code, title, prompt, meta_status, vignette_json, rationale_json, meta_json, validation_json
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
    data: dict[int, dict[str, Any]] = {}
    for row in rows:
        meta = parse_json(row["meta_json"], {})
        if row["meta_status"]:
            meta["status"] = row["meta_status"]
        case_id = int(row["case_id"])
        data[case_id] = {
            "_id": case_id,
            "case_code": row["case_code"] or "",
            "title": row["title"] or "",
            "prompt": row["prompt"] or "",
            "vignette": parse_json(row["vignette_json"], {}),
            "rationale": parse_json(row["rationale_json"], {}),
            "meta": meta,
            "validation": parse_json(row["validation_json"], {}),
            "options": options_by_case.get(case_id, []),
        }
    return data


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
                  vignette_json = ?,
                  rationale_json = ?,
                  meta_json = ?,
                  validation_json = ?
                WHERE case_id = ?
                """,
                (
                    case_data.get("title") or "",
                    case_data.get("prompt") or "",
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


def collapse_question(question: str) -> tuple[str, str]:
    source_question = normalize_text(question)
    stripped = MULTI_SELECT_TAIL_RE.sub("", source_question).strip()
    if stripped.endswith("?"):
        stripped = stripped[:-1].rstrip()
    prompt = "Which option is best supported?"
    if len(stripped) <= 120 and stripped:
        prompt = f"{stripped}?"
    narrative = f"{stripped}?" if stripped else source_question
    return prompt, narrative


def main() -> None:
    source_rows = read_json(SOURCE_FILE, [])
    source_by_case_code = {normalize_text(row.get("case_code")): row for row in source_rows if normalize_text(row.get("case_code"))}
    connection = sqlite3.connect(DB_FILE)
    connection.row_factory = sqlite3.Row
    rows = connection.execute(
        """
        SELECT case_id, case_code
        FROM cases
        WHERE source = 'igakuqa'
          AND json_extract(meta_json, '$.needs_review') = 1
        ORDER BY case_id
        """
    ).fetchall()
    sync_existing = False
    if not rows:
        rows = connection.execute(
            """
            SELECT case_id, case_code
            FROM cases
            WHERE source = 'igakuqa'
              AND json_extract(meta_json, '$.igakuqa_multiselect_collapse_basis') = ?
            ORDER BY case_id
            """,
            (BASIS,),
        ).fetchall()
        sync_existing = True
    target_ids = [int(row["case_id"]) for row in rows]
    cases_by_id = load_case_rows(connection, target_ids)
    json_cases = read_json(JSON_FILE, [])
    timestamp = datetime.now(timezone.utc).isoformat()

    updates: dict[int, dict[str, Any]] = {}
    report_rows: list[dict[str, Any]] = []

    for row in rows:
        case_id = int(row["case_id"])
        case_code = normalize_text(row["case_code"])
        current = cases_by_id.get(case_id)
        if sync_existing:
            if not current:
                report_rows.append({"case_id": case_id, "case_code": case_code, "status": "missing_case_for_sync"})
                continue
            updates[case_id] = deepcopy(current)
            report_rows.append({"case_id": case_id, "case_code": case_code, "status": "synced_existing"})
            continue

        source_row = source_by_case_code.get(case_code)
        if not current or not source_row:
            report_rows.append({"case_id": case_id, "case_code": case_code, "status": "missing_source_or_case"})
            continue

        source_question = normalize_text(source_row.get("question"))
        if not MULTI_SELECT_TAIL_RE.search(source_question):
            report_rows.append({"case_id": case_id, "case_code": case_code, "status": "not_multiselect"})
            continue

        updated = deepcopy(current)
        prompt, narrative = collapse_question(source_question)
        updated["prompt"] = prompt
        updated["title"] = narrative
        set_narrative(updated, narrative)

        source_rationale = source_row.get("rationale")
        if isinstance(source_rationale, dict):
            correct_text = normalize_text(source_rationale.get("correct"))
        else:
            correct_text = normalize_text(source_rationale)
        rationale = updated.get("rationale")
        if isinstance(rationale, dict):
            if correct_text:
                rationale["correct"] = correct_text
        else:
            updated["rationale"] = {"correct": correct_text}

        meta = deepcopy(updated.get("meta") or {})
        meta.pop("needs_review", None)
        meta.pop("needs_review_reason", None)
        meta.pop("truncated", None)
        meta.pop("readability_ai_hold", None)
        meta.pop("readability_ai_hold_at", None)
        meta.pop("readability_ai_hold_basis", None)
        meta.pop("readability_ai_hold_notes", None)
        meta["avg_option_length"] = compute_avg_option_length(updated.get("options") or [])
        meta["igakuqa_multiselect_collapse_at"] = timestamp
        meta["igakuqa_multiselect_collapse_basis"] = BASIS
        with_quality_flag(meta, "igakuqa_multiselect_collapse")
        updated["meta"] = meta

        updates[case_id] = updated
        report_rows.append(
            {
                "case_id": case_id,
                "case_code": case_code,
                "status": "applied",
                "source_question": summarize_text(source_question),
                "prompt": summarize_text(prompt),
            }
        )

    persist_sqlite(connection, list(updates.values()))
    connection.close()
    update_json_cases(json_cases, updates)
    write_json_atomic(JSON_FILE, json_cases)

    report = {
        "generated_at": timestamp,
        "basis": BASIS,
        "sync_existing": sync_existing,
        "db_file": str(DB_FILE),
        "source_file": str(SOURCE_FILE),
        "applied_count": len(updates),
        "rows": report_rows,
    }
    write_json_atomic(REPORT_FILE, report)
    sys.stdout.buffer.write((json.dumps(report, ensure_ascii=False, indent=2) + "\n").encode("utf-8", errors="replace"))


if __name__ == "__main__":
    main()
