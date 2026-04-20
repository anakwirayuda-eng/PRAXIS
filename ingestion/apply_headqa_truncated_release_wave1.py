from __future__ import annotations

import json
import os
import sqlite3
import sys
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parent.parent
JSON_FILE = ROOT / "public" / "data" / "compiled_cases.json"
REPORT_FILE = ROOT / "ingestion" / "output" / "headqa_truncated_release_wave1_report.json"
BASIS = "deterministic:headqa-stale-truncated-release-wave1"


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


DB_FILE = resolve_db_file()


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


def get_narrative(case_data: dict[str, Any]) -> str:
    vignette = case_data.get("vignette")
    if isinstance(vignette, dict):
        return str(vignette.get("narrative") or "")
    return str(vignette or "")


def rationale_text(case_data: dict[str, Any]) -> str:
    rationale = case_data.get("rationale")
    if isinstance(rationale, dict):
        return normalize_text(rationale.get("correct"))
    return normalize_text(rationale)


def load_headqa_cases(connection: sqlite3.Connection) -> list[dict[str, Any]]:
    rows = connection.execute(
        """
        SELECT
          case_id,
          case_code,
          title,
          prompt,
          q_type,
          source,
          meta_status,
          vignette_json,
          rationale_json,
          meta_json,
          validation_json
        FROM cases
        WHERE source = 'headqa'
        """
    ).fetchall()
    option_rows = connection.execute(
        """
        SELECT case_id, option_id, sort_order, option_text, is_correct
        FROM case_options
        WHERE case_id IN (SELECT case_id FROM cases WHERE source = 'headqa')
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

    cases: list[dict[str, Any]] = []
    for row in rows:
        meta = parse_json(row["meta_json"], {})
        if row["meta_status"]:
            meta["status"] = row["meta_status"]
        case_id = int(row["case_id"])
        cases.append(
            {
                "_id": case_id,
                "case_code": row["case_code"] or "",
                "title": row["title"] or "",
                "prompt": row["prompt"] or "",
                "q_type": row["q_type"] or "",
                "source": row["source"] or "",
                "vignette": parse_json(row["vignette_json"], {}),
                "rationale": parse_json(row["rationale_json"], {}),
                "meta": meta,
                "validation": parse_json(row["validation_json"], {}),
                "options": options_by_case.get(case_id, []),
            }
        )
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


def is_safe_release_candidate(case_data: dict[str, Any]) -> bool:
    meta = case_data.get("meta") or {}
    prompt = normalize_text(case_data.get("prompt"))
    narrative = normalize_text(get_narrative(case_data))
    rationale = rationale_text(case_data)
    options = case_data.get("options") or []

    if case_data.get("q_type") != "MCQ":
        return False
    if meta.get("needs_review"):
        return False
    if not meta.get("truncated"):
        return False
    if not prompt or len(prompt) < 15:
        return False
    if not narrative or len(narrative) < 15:
        return False
    if not rationale or len(rationale) < 40:
        return False
    if len(options) < 4:
        return False
    if any(not normalize_text(option.get("text")) for option in options):
        return False
    if not (prompt.endswith("?") or prompt.endswith(":")):
        return False
    return True


def main() -> None:
    timestamp = datetime.now(timezone.utc).isoformat()
    json_cases = read_json(JSON_FILE, [])

    connection = sqlite3.connect(DB_FILE)
    connection.row_factory = sqlite3.Row
    cases = load_headqa_cases(connection)

    updates: dict[int, dict[str, Any]] = {}
    applied: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []

    for case_data in cases:
        if not (case_data.get("meta") or {}).get("truncated"):
            continue
        if not is_safe_release_candidate(case_data):
            skipped.append(
                {
                    "case_id": case_data["_id"],
                    "case_code": case_data.get("case_code"),
                    "prompt": summarize_text(case_data.get("prompt") or ""),
                }
            )
            continue

        updated = deepcopy(case_data)
        meta = deepcopy(updated.get("meta") or {})
        meta.pop("truncated", None)
        meta.pop("readability_ai_hold", None)
        meta.pop("readability_ai_hold_at", None)
        meta.pop("readability_ai_hold_basis", None)
        meta.pop("readability_ai_hold_notes", None)
        meta["avg_option_length"] = compute_avg_option_length(updated.get("options") or [])
        meta["readability_truncated_release_at"] = timestamp
        meta["readability_truncated_release_basis"] = BASIS
        with_quality_flag(meta, "readability_truncated_release")
        updated["meta"] = meta

        updates[updated["_id"]] = updated
        applied.append(
            {
                "case_id": updated["_id"],
                "case_code": updated.get("case_code"),
                "prompt": summarize_text(updated.get("prompt") or ""),
                "narrative": summarize_text(get_narrative(updated)),
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
        "target_count": sum(1 for case_data in cases if (case_data.get("meta") or {}).get("truncated")),
        "applied_count": len(applied),
        "skipped_count": len(skipped),
        "applied": applied,
        "skipped": skipped,
    }
    write_json_atomic(REPORT_FILE, report)
    sys.stdout.buffer.write((json.dumps(report, ensure_ascii=False, indent=2) + "\n").encode("utf-8", errors="replace"))


if __name__ == "__main__":
    main()
