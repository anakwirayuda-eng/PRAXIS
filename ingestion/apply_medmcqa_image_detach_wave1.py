from __future__ import annotations

import json
import os
import sqlite3
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parent.parent
DB_FILE = Path(os.environ["CASEBANK_DB_PATH"]) if os.environ.get("CASEBANK_DB_PATH") else ROOT / "server" / "data" / "casebank.db"
JSON_FILE = ROOT / "public" / "data" / "compiled_cases.json"
REPORT_FILE = ROOT / "ingestion" / "output" / "medmcqa_image_detach_wave1_report.json"

FIXES: dict[int, dict[str, str]] = {
    37596: {
        "prompt": "Which of the following is the most likely injury?",
        "narrative": (
            "A 25-year-old man twists his right knee while skiing and falls to the ground. "
            "His knee is swollen, he cannot bear full weight, and he cannot fully extend or bend the leg. "
            "There is tenderness over the medial joint line. Emergency-room x-ray findings are normal, "
            "and the knee remains stable to varus and valgus stress. Straight-leg raise is unrestricted. "
            "Which of the following is the most likely injury?"
        ),
        "notes": "Removed the figure reference and detached the stray anatomy caption because the vignette already supports a medial meniscus tear clinically.",
    },
    40822: {
        "prompt": "Which of the following is the most appropriate initial diagnostic test?",
        "narrative": (
            "A 21-year-old man is seen in the clinic for assessment of a nonproductive cough, shortness of breath, "
            "and pleuritic chest pain. He also complains of pain in the left arm. On physical examination, "
            "there is tenderness over the left shoulder, heart sounds are normal, and the lungs are clear. "
            "A chest x-ray reveals a lytic lesion in the left humerus and reticulonodular opacities in the upper "
            "and middle lobes. The eosinophil count is normal. Which of the following is the most appropriate initial diagnostic test?"
        ),
        "notes": "Removed the image dependency marker because the written stem and radiographic description already justify CT chest as the next diagnostic step.",
    },
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


def load_case_rows(connection: sqlite3.Connection, ids: list[int]) -> dict[int, dict[str, Any]]:
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


def with_quality_flag(meta: dict[str, Any], flag: str) -> None:
    flags = meta.get("quality_flags")
    if not isinstance(flags, list):
        flags = []
    if flag not in flags:
        flags.append(flag)
    meta["quality_flags"] = flags


def apply_fix(case_data: dict[str, Any], fix: dict[str, str]) -> dict[str, Any]:
    updated = deepcopy(case_data)
    meta = updated.setdefault("meta", {})

    prompt = normalize_text(fix["prompt"])
    narrative = normalize_text(fix["narrative"])
    updated["prompt"] = prompt
    updated["title"] = prompt
    if not isinstance(updated.get("vignette"), dict):
        updated["vignette"] = {}
    updated["vignette"]["narrative"] = narrative

    meta["needs_review"] = False
    meta["truncated"] = False
    if meta.get("quarantined") is not False:
        meta["quarantined"] = False
    for key in ("status", "quarantine_reason", "radar_tokens", "needs_review_reason", "needs_review_reasons"):
        if key in meta:
            del meta[key]
    meta["option_count"] = len(updated.get("options") or [])
    meta["avg_option_length"] = compute_avg_option_length(updated.get("options") or [])
    meta["answer_anchor_text"] = rebuild_answer_anchor_text(updated.get("options") or [])
    with_quality_flag(meta, "medmcqa_image_dependency_detached")
    return updated


def main() -> None:
    connection = sqlite3.connect(DB_FILE)
    connection.row_factory = sqlite3.Row
    try:
        case_map = load_case_rows(connection, list(FIXES))
        json_cases = read_json(JSON_FILE, [])

        changed_cases: dict[int, dict[str, Any]] = {}
        report: dict[str, Any] = {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "target_source": "medmcqa",
            "changed_cases": 0,
            "samples": [],
        }

        for case_id, fix in FIXES.items():
            current = case_map.get(case_id)
            if current is None:
                continue
            updated = apply_fix(current, fix)
            changed_cases[case_id] = updated
            report["changed_cases"] += 1
            report["samples"].append(
                {
                    "_id": case_id,
                    "case_code": current.get("case_code"),
                    "prompt": summarize_text(updated.get("prompt") or ""),
                    "narrative": summarize_text(updated.get("vignette", {}).get("narrative") or ""),
                    "notes": fix["notes"],
                }
            )

        if changed_cases:
            persist_sqlite(connection, list(changed_cases.values()))
            update_json_cases(json_cases, changed_cases)
            write_json_atomic(JSON_FILE, json_cases)

        write_json_atomic(REPORT_FILE, report)

        print("MEDMCQA IMAGE DETACH WAVE1")
        print(f"  Changed cases:  {report['changed_cases']:,}")
        print(f"  Report:         {REPORT_FILE}")
    finally:
        connection.close()


if __name__ == "__main__":
    main()
