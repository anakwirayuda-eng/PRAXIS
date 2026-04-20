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
REPORT_FILE = ROOT / "ingestion" / "output" / "medmcqa_micro_editorial_wave3_report.json"
BASIS = "micro-editorial:medmcqa-wave3"


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


FIXES: dict[int, dict[str, Any]] = {
    32872: {
        "playbook": "option_reconstruction",
        "prompt": "Based on this presentation, which organ is most likely to be affected?",
        "narrative": (
            "A 48-year-old man has had constant upper mid-abdominal pain for 6 months, especially after meals. "
            "He reports heartburn and now has intermittently dark, tarry stools suggestive of an upper gastrointestinal bleed. "
            "Based on this presentation, which organ is most likely to be affected?"
        ),
        "options": [
            {"id": "A", "text": "Stomach", "is_correct": True},
            {"id": "B", "text": "Gallbladder", "is_correct": False},
            {"id": "C", "text": "Distal ileum and caecum", "is_correct": False},
        ],
        "rationale": (
            "The stomach is the best answer because the history is most consistent with peptic ulcer disease and upper gastrointestinal bleeding, "
            "as suggested by postprandial epigastric pain and melena."
        ),
        "notes": "Reconstructed the placeholder options directly from the labeled organ key embedded in the existing rationale.",
    },
    28721: {
        "playbook": "combined_option_rewrite",
        "options": [
            {"id": "A", "text": "Scleroderma", "is_correct": False},
            {"id": "B", "text": "Trypanosoma cruzi infection", "is_correct": False},
            {"id": "C", "text": "Dermatomyositis", "is_correct": False},
            {
                "id": "D",
                "text": "Both Trypanosoma cruzi infection and dermatomyositis",
                "is_correct": True,
            },
        ],
        "rationale": (
            "Uniform dilatation of the esophagus is classically associated with both Trypanosoma cruzi infection and dermatomyositis, "
            "so the combined option is the best answer."
        ),
        "notes": "Expanded the placeholder 'BD' into the combined option already implied by the rationale.",
    },
    40950: {
        "playbook": "all_of_the_above_rewrite",
        "options": [
            {"id": "A", "text": "Irradiation", "is_correct": False},
            {"id": "B", "text": "Thyroglossal cyst", "is_correct": False},
            {"id": "C", "text": "Hashimoto thyroiditis", "is_correct": False},
            {
                "id": "D",
                "text": "Irradiation, thyroglossal cyst, and Hashimoto thyroiditis",
                "is_correct": True,
            },
        ],
        "notes": "Replaced the all-of-the-above trap with the explicit combined risk-factor statement already justified by the rationale.",
    },
    45914: {
        "playbook": "image_context_recovery",
        "prompt": "Which pontic design best preserves the papilla in a fresh extraction socket?",
        "narrative": (
            "Immediately after tooth extraction, which pontic design best preserves the papilla by extending into the healing socket "
            "and maintaining the contact point and embrasure support?"
        ),
        "options": [
            {"id": "A", "text": "Ovate pontic", "is_correct": True},
            {"id": "B", "text": "Modified ridge lap pontic", "is_correct": False},
            {"id": "C", "text": "Sanitary pontic", "is_correct": False},
            {"id": "D", "text": "None of the above", "is_correct": False},
        ],
        "rationale": (
            "Ovate pontics are used when the ridge is defective or incompletely healed, and they help preserve the papilla by extending into the extraction socket."
        ),
        "notes": "Detached the missing figure by rewriting the extraction-socket context from the existing rationale and removed the all-of-the-above trap.",
    },
    33894: {
        "playbook": "all_of_the_above_rewrite",
        "options": [
            {"id": "A", "text": "Cloudy swelling", "is_correct": False},
            {"id": "B", "text": "Cellular swelling", "is_correct": False},
            {"id": "C", "text": "Albuminous degeneration", "is_correct": False},
            {
                "id": "D",
                "text": "Cloudy swelling / cellular swelling (albuminous degeneration)",
                "is_correct": True,
            },
        ],
        "rationale": (
            "Cellular swelling is the earliest common reversible cell injury and is also referred to as cloudy swelling or albuminous degeneration."
        ),
        "notes": "Collapsed the all-of-the-above trap into the explicit synonymous description supported by the rationale.",
    },
    29370: {
        "playbook": "negative_stem_cleanup",
        "prompt": "Which maneuver should be avoided during laryngoscopy and endotracheal intubation?",
        "narrative": "Which maneuver should be avoided during laryngoscopy and endotracheal intubation?",
        "options": [
            {"id": "A", "text": "Applying slight cricoid pressure when indicated", "is_correct": False},
            {"id": "B", "text": "Holding the laryngoscope in the left hand and introducing it from the right side of the mouth", "is_correct": False},
            {"id": "C", "text": "Positioning the patient in a sniffing position with neck flexion and atlanto-occipital extension", "is_correct": False},
            {
                "id": "D",
                "text": "Levering the laryngoscope on the upper incisors to lift the tongue and visualize the cords",
                "is_correct": True,
            },
        ],
        "rationale": (
            "The laryngoscope should never be leveraged on the upper incisors. Proper laryngoscopy uses lifting force along the handle axis with the patient in the sniffing position."
        ),
        "notes": "Converted the negative except-style item into a direct safety question and corrected the hand/position wording.",
    },
    6505: {
        "playbook": "micro_stem_recovery",
        "prompt": "Which finding most strongly supports a diagnosis of hanging?",
        "narrative": "Which finding most strongly supports a diagnosis of hanging?",
        "options": [
            {"id": "A", "text": "Fracture of the hyoid cartilage", "is_correct": False},
            {"id": "B", "text": "Fracture of the thyroid cartilage", "is_correct": False},
            {"id": "C", "text": "Dribbling or staining of saliva", "is_correct": True},
            {"id": "D", "text": "All of the above", "is_correct": False},
        ],
        "rationale": (
            "Dribbling or staining of saliva is a classic external sign favoring ante-mortem hanging and is the best answer here."
        ),
        "notes": "Expanded the terse stem into a complete forensic question and normalized the correct answer wording.",
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


def with_quality_flag(meta: dict[str, Any], flag: str) -> None:
    flags = meta.get("quality_flags")
    if not isinstance(flags, list):
        flags = []
    if flag not in flags:
        flags.append(flag)
    meta["quality_flags"] = flags


def load_case_rows(connection: sqlite3.Connection, ids: list[int]) -> dict[int, dict[str, Any]]:
    placeholders = ",".join("?" for _ in ids)
    rows = connection.execute(
        f"""
        SELECT
          case_id,
          case_code,
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
                "DELETE FROM case_options WHERE case_id = ?",
                (case_data["_id"],),
            )
            for sort_order, option in enumerate(options):
                connection.execute(
                    """
                    INSERT INTO case_options (case_id, option_id, option_text, is_correct, sort_order)
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    (
                        case_data["_id"],
                        option.get("id"),
                        option.get("text"),
                        1 if option.get("is_correct") else 0,
                        sort_order,
                    ),
                )

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


def ensure_rationale_dict(case_data: dict[str, Any]) -> dict[str, Any]:
    rationale = case_data.get("rationale")
    if isinstance(rationale, dict):
        return rationale
    return {"correct": normalize_text(rationale)}


def main() -> None:
    timestamp = datetime.now(timezone.utc).isoformat()
    target_ids = list(FIXES.keys())
    json_cases = read_json(JSON_FILE, [])

    connection = sqlite3.connect(DB_FILE)
    connection.row_factory = sqlite3.Row
    cases_by_id = load_case_rows(connection, target_ids)

    updates: dict[int, dict[str, Any]] = {}
    report_rows: list[dict[str, Any]] = []

    for case_id, fix in FIXES.items():
        current = cases_by_id.get(case_id)
        if not current:
            report_rows.append({"case_id": case_id, "status": "missing_case"})
            continue

        updated = deepcopy(current)

        prompt = fix.get("prompt")
        if prompt:
            updated["prompt"] = prompt
            updated["title"] = prompt

        narrative = fix.get("narrative")
        if narrative is not None:
            vignette = updated.get("vignette")
            if isinstance(vignette, dict):
                vignette["narrative"] = narrative
            else:
                updated["vignette"] = {"narrative": narrative}

        if fix.get("options"):
            updated["options"] = deepcopy(fix["options"])

        rationale = ensure_rationale_dict(updated)
        if fix.get("rationale"):
            rationale["correct"] = fix["rationale"]
        updated["rationale"] = rationale

        meta = deepcopy(updated.get("meta") or {})
        meta.pop("needs_review", None)
        meta.pop("needs_review_reason", None)
        meta.pop("truncated", None)
        meta.pop("readability_ai_hold", None)
        meta.pop("readability_ai_hold_at", None)
        meta.pop("readability_ai_hold_basis", None)
        meta.pop("readability_ai_hold_notes", None)
        meta.pop("readability_integrity_hold", None)
        meta.pop("status", None)
        meta["avg_option_length"] = compute_avg_option_length(updated.get("options") or [])
        meta["micro_editorial_release_at"] = timestamp
        meta["micro_editorial_release_basis"] = BASIS
        with_quality_flag(meta, "micro_editorial_release")
        updated["meta"] = meta

        updates[case_id] = updated
        report_rows.append(
            {
                "case_id": case_id,
                "case_code": updated.get("case_code"),
                "playbook": fix.get("playbook"),
                "status": "applied",
                "prompt": summarize_text(updated.get("prompt") or ""),
                "answer_anchor_text": rebuild_answer_anchor_text(updated.get("options") or []),
                "notes": fix.get("notes"),
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
        "rows": report_rows,
    }
    write_json_atomic(REPORT_FILE, report)
    sys.stdout.buffer.write((json.dumps(report, ensure_ascii=False, indent=2) + "\n").encode("utf-8", errors="replace"))


if __name__ == "__main__":
    main()
