from __future__ import annotations

import json
import os
import sqlite3
import sys
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4


ROOT = Path(__file__).resolve().parent.parent
JSON_FILE = ROOT / "public" / "data" / "compiled_cases.json"
REPORT_FILE = ROOT / "ingestion" / "output" / "worldmedqa_image_wave1_report.json"
BASIS = "deterministic:worldmedqa-image-wave1"


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
    990014: {
        "prompt": "What are the diagnosis, cause of shock, and initial treatment?",
        "narrative": (
            "A 54-year-old man with dyslipidemia, hypertension, and early familial cardiovascular disease has 5 hours of "
            "severe epigastric tightness with nausea and vomiting. He is pale, sweaty, drowsy, hypotensive (80/50 mm Hg), "
            "tachycardic, has jugular venous distension, and has clear lungs. ECG shows inferior ST-segment elevation with "
            "right-ventricular involvement. Given the clinical condition, what are the diagnosis, cause of shock, and initial treatment?"
        ),
        "notes": "Encoded ECG as inferior STEMI with right-ventricular involvement.",
    },
    990020: {
        "prompt": "What are the infant's diagnosis and treatment?",
        "narrative": (
            "A 6-month-old infant has irritability, fever, and diffuse reddish vesicular lesions over the head and "
            "oropharynx. The grandmother who lives with the family has unilateral vesicular lesions on the left face "
            "consistent with herpes zoster. What are the infant's diagnosis and treatment?"
        ),
        "notes": "Replaced grandmother figure with textual shingles exposure.",
    },
    990022: {
        "prompt": "Clear, stretchy egg-white cervical mucus is clinically compatible with which phase?",
        "narrative": (
            "A 25-year-old woman with regular 28- to 30-day menstrual cycles comes for preventive gynecologic care. "
            "Speculum examination shows abundant clear, stretchy, egg-white cervical mucus. This finding is clinically "
            "compatible with which phase?"
        ),
        "notes": "Encoded speculum image as egg-white cervical mucus.",
    },
    990031: {
        "prompt": "What are the likely etiologic agent and treatment for this severe pneumonia?",
        "narrative": (
            "A malnourished 3-year-old child recently hospitalized has fever, cough, severe dyspnea, vomiting, oxygen "
            "saturation of 91%, crackles, and decreased breath sounds over the left hemithorax. Chest radiography is "
            "consistent with severe necrotizing pneumonia/empyema. What are the likely etiologic agent and treatment?"
        ),
        "notes": "Encoded chest x-ray as severe necrotizing pneumonia/empyema.",
    },
    990038: {
        "prompt": "What is the most likely cause of this child's short stature?",
        "narrative": (
            "A 7-year-9-month-old boy is evaluated for short stature. He has no chronic illness, eats well, and has a "
            "normal physical examination. Bone age is delayed at 5 years 9 months, and growth tracking shows proportionate "
            "short stature with preserved growth velocity. What is the most likely cause?"
        ),
        "notes": "Replaced growth-chart figure with delayed bone age and preserved growth velocity.",
    },
    990045: {
        "prompt": "What should the primary-care physician do for this melanoma-suspicious pigmented lesion?",
        "narrative": (
            "A 29-year-old woman reports a dorsal pigmented lesion that has changed over 2 months, itches, and occasionally "
            "bleeds. Her mother had melanoma at age 45. Examination shows an asymmetric irregular pigmented lesion with "
            "color variation. What should the primary-care physician do?"
        ),
        "notes": "Encoded skin image as ABCDE-suspicious pigmented lesion.",
    },
    990074: {
        "prompt": "What central-line complication occurred and what immediate intervention is required?",
        "narrative": (
            "A 20-year-old burn patient has failed femoral venous access followed by successful right subclavian central "
            "venous catheterization. Shortly afterward, respiratory status worsens and chest imaging shows pneumothorax. "
            "What complication occurred and what immediate intervention is required?"
        ),
        "notes": "Encoded post-subclavian image as pneumothorax.",
    },
    990077: {
        "prompt": "What is the most likely diagnosis for this evolving irregular facial pigmented lesion?",
        "narrative": (
            "A 58-year-old construction worker has a facial pigmented lesion present for 4 years with recent growth over "
            "2 months. The lesion is asymmetric with irregular borders and color variation. What is the most likely diagnosis?"
        ),
        "notes": "Encoded facial lesion photograph as melanoma-suspicious ABCDE features.",
    },
    990092: {
        "prompt": "What physical examination finding is most likely with this tamponade physiology?",
        "narrative": (
            "A 60-year-old heavy smoker has acute shortness of breath and hypotension. Echocardiography shows a large "
            "pericardial effusion with diastolic chamber collapse, consistent with cardiac tamponade. What physical "
            "examination finding is most likely?"
        ),
        "notes": "Encoded echo image as tamponade physiology.",
    },
    990095: {
        "prompt": "Which disease corresponds to reversible obstructive spirometry?",
        "narrative": (
            "A 40-year-old man with a 5 pack-year smoking history has spirometry showing an obstructive pattern that "
            "significantly improves after bronchodilator administration. Which disease does this spirometry correspond to?"
        ),
        "notes": "Encoded spirometry image as reversible obstruction.",
    },
    990152: {
        "prompt": "Which phenomenon could result from bilateral frontal/mesial frontal injury?",
        "narrative": (
            "A 45-year-old man is awake but lies in bed staring into space, does not respond to his name, and does not "
            "initiate movement 2 years after severe head injury. CT shows bilateral frontal/mesial frontal injury. Which "
            "phenomenon could result from this injury?"
        ),
        "notes": "Encoded CT finding as frontal/mesial frontal injury causing akinetic mutism.",
    },
    990155: {
        "prompt": "Which electrolyte or metabolite complication causes osmotic demyelination syndrome?",
        "narrative": (
            "An alcoholic hospitalized patient receiving intravenous treatment develops quadriparesis with swallowing and "
            "chewing difficulty. Brain MRI is consistent with central pontine myelinolysis/osmotic demyelination syndrome. "
            "A complication involving which electrolyte or metabolite causes this syndrome?"
        ),
        "notes": "Encoded MRI as osmotic demyelination and clarified sodium as the relevant electrolyte.",
    },
    990161: {
        "prompt": "What characterizes the malignant cells in this pathology specimen?",
        "narrative": (
            "A pathology specimen from a pigmented skin malignancy shows atypical melanocytic proliferation throughout the "
            "epidermis and dermis. What characterizes the malignant cells in this pathology specimen?"
        ),
        "notes": "Encoded melanoma pathology image as diffuse atypical melanocytic proliferation.",
    },
    990183: {
        "prompt": "Which microorganism is identified by mites from human hair follicles on microscopy?",
        "narrative": (
            "Microscopy of material from human facial hair follicles shows elongated mites compatible with Demodex species. "
            "Which microorganism is being identified?"
        ),
        "notes": "Converted image-only mite identification into a text microscopy question.",
    },
    990184: {
        "prompt": "What is the presumed etiology of this melanoma-like skin disease?",
        "narrative": (
            "A pigmented skin lesion is clinically and pathologically consistent with melanoma. What is the presumed major "
            "etiologic risk factor for this disease?"
        ),
        "notes": "Replaced disease image with melanoma diagnosis so etiology question is answerable.",
    },
    990185: {
        "prompt": "What corneal dystrophy shows small clear epithelial microcysts on slit-lamp examination?",
        "narrative": (
            "Slit-lamp examination shows numerous small, clear epithelial microcysts in the cornea, consistent with an "
            "epithelial corneal dystrophy. What can be seen in this condition?"
        ),
        "notes": "Encoded slit-lamp image as epithelial microcysts.",
    },
    990188: {
        "prompt": "What is the most likely diagnosis one day after LASIK with diffuse interface inflammation?",
        "narrative": (
            "One day after LASIK, a patient has blurred vision. Slit-lamp examination shows diffuse granular inflammatory "
            "cells in the lamellar interface, the classic 'sands of the Sahara' appearance. What is the most likely diagnosis?"
        ),
        "notes": "Encoded slit-lamp image as diffuse lamellar keratitis.",
    },
    990196: {
        "prompt": "Which dermatome corresponds to painful zoster lesions around the umbilical level?",
        "narrative": (
            "A 47-year-old man has painful vesicular herpes zoster lesions distributed around the umbilical level of the "
            "abdomen and back. Which dermatome is most likely affected?"
        ),
        "notes": "Replaced distribution-map supplement with umbilical-level dermatomal distribution.",
    },
}


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


def without_quality_flags(meta: dict[str, Any], remove: set[str]) -> None:
    flags = meta.get("quality_flags")
    if not isinstance(flags, list):
        return
    remaining = [flag for flag in flags if flag not in remove]
    if remaining:
        meta["quality_flags"] = remaining
    else:
        meta.pop("quality_flags", None)


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
            connection.execute("DELETE FROM case_options WHERE case_id = ?", (case_data["_id"],))
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


def apply_fix(current: dict[str, Any], fix: dict[str, Any], timestamp: str) -> dict[str, Any]:
    updated = deepcopy(current)

    if fix.get("prompt"):
        updated["prompt"] = normalize_text(fix["prompt"])
        updated["title"] = normalize_text(fix.get("title") or fix["prompt"])
    if fix.get("narrative"):
        vignette = updated.get("vignette")
        if isinstance(vignette, dict):
            vignette["narrative"] = normalize_text(fix["narrative"])
        else:
            updated["vignette"] = {"narrative": normalize_text(fix["narrative"])}

    meta = deepcopy(updated.get("meta") or {})
    meta["image_dependency_reviewed"] = True
    meta["image_dependency_reviewed_at"] = timestamp
    meta["image_dependency_review_basis"] = BASIS
    meta["needs_review"] = False
    meta["truncated"] = False
    meta["quarantined"] = False
    for key in (
        "status",
        "quarantine_reason",
        "radar_tokens",
        "needs_review_reason",
        "needs_review_reasons",
        "readability_ai_hold",
        "readability_ai_hold_at",
        "readability_ai_hold_basis",
        "readability_ai_hold_notes",
        "readability_integrity_hold",
    ):
        meta.pop(key, None)
    without_quality_flags(meta, {"readability_batch_salvage_hold", "image_dependency_detected"})
    meta["avg_option_length"] = compute_avg_option_length(updated.get("options") or [])
    meta["readability_ai_pass"] = True
    meta["readability_ai_pass_basis"] = BASIS
    with_quality_flag(meta, "image_dependency_detached")
    updated["meta"] = meta
    return updated


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

        updated = apply_fix(current, fix, timestamp)
        updates[case_id] = updated
        report_rows.append(
            {
                "case_id": case_id,
                "case_code": updated.get("case_code"),
                "source": updated.get("source"),
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
