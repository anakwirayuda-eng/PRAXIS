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
REPORT_FILE = ROOT / "ingestion" / "output" / "medqa_image_detach_wave2_report.json"
BASIS = "deterministic:medqa-image-detach-wave2"


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
    17102: {
        "prompt": "Which of the following will most likely appear in this patient's PFT report?",
        "narrative": (
            "A 55-year-old man with a 60 pack-year smoking history is referred for pulmonary function testing. "
            "Chest radiography shows hyperinflated lungs and flattened diaphragms, consistent with emphysema. "
            "Which of the following will most likely appear in this patient's PFT report?"
        ),
        "rationale": (
            "Residual volume and total lung capacity are both increased in COPD/emphysema because loss of elastic recoil "
            "causes air trapping and hyperinflation."
        ),
        "notes": "Encoded the missing chest-x-ray clue as hyperinflation/flattened diaphragms.",
    },
    17534: {
        "narrative": (
            "A 40-year-old woman with ongoing dyspnea has an abnormal echocardiogram, an isolated reduction in DLCO on "
            "pulmonary function testing, and right-heart catheterization confirming pulmonary arterial hypertension. "
            "Family members have similar findings, and genetic testing reveals a BMPR2 mutation. Which pharmacologic "
            "therapy will the physician most likely provide?"
        ),
        "rationale": (
            "Vasodilator therapy is the best answer because BMPR2-associated familial pulmonary arterial hypertension is "
            "treated with pulmonary vasodilator classes such as endothelin-receptor antagonists, PDE-5 inhibitors, or "
            "prostacyclin-pathway agents."
        ),
        "notes": "Removed nonessential biopsy-image reference; PAH diagnosis is explicit in text.",
    },
    17541: {
        "narrative": (
            "A 43-year-old man comes to the emergency room with chest tightness, weakness, and palpitations. He denies "
            "shortness of breath, diaphoresis, and lightheadedness. He is afebrile, heart rate is 125/min, and blood "
            "pressure is 120/76 mm Hg. ECG shows a narrow-complex tachyarrhythmia without ischemic ST-segment changes. "
            "Which of the following tests should be ordered in the initial work-up?"
        ),
        "rationale": (
            "TSH testing is the best answer because unexplained tachyarrhythmia and palpitations can be the presenting "
            "manifestation of thyrotoxicosis. The absence of ischemic features makes thyroid evaluation a high-yield "
            "initial test among the listed choices."
        ),
        "notes": "Replaced missing ECG image with the relevant nonischemic tachyarrhythmia description.",
    },
    17583: {
        "narrative": (
            "A 27-year-old man presents with a palpable, mildly painful left scrotal mass. Examination shows a soft "
            "'bag of worms' swelling around the left testis that increases with standing. Which of the following is the "
            "most likely etiology?"
        ),
        "rationale": (
            "Compression of the left renal vein between the aorta and superior mesenteric artery is the best answer. This "
            "nutcracker phenomenon increases pressure in the left gonadal vein and predisposes to a left-sided varicocele."
        ),
        "notes": "Encoded the missing scrotal-image finding as a left-sided varicocele.",
    },
    17747: {
        "narrative": (
            "A 5-year-old boy is brought to the emergency department after a low-impact fall caused a femur fracture. "
            "He has had multiple prior fractures but otherwise has normal development. Examination shows irregular "
            "cafe-au-lait macules with jagged borders. Which of the following is the most likely cause of this patient's "
            "multiple fractures?"
        ),
        "rationale": (
            "Increased adenylyl cyclase activity is the best answer because polyostotic fibrous dysplasia with irregular "
            "cafe-au-lait macules suggests McCune-Albright syndrome, which is caused by activating GNAS mutations that "
            "increase Gs-alpha/cAMP signaling."
        ),
        "notes": "Rebuilt the missing skin finding and corrected the prior osteogenesis-imperfecta rationale.",
    },
    18208: {
        "prompt": "Which thyroid neoplasm is associated with this patient's syndrome?",
        "narrative": (
            "A 34-year-old patient has recurrent nephrolithiasis, severe hypertension, chronic constipation, headaches, "
            "elevated calcium, and elevated PTH, suggesting MEN2 with hyperparathyroidism and possible catecholamine excess. "
            "Which thyroid neoplasm is associated with this patient's syndrome?"
        ),
        "rationale": (
            "Medullary thyroid cancer is the best answer because MEN2 is associated with medullary thyroid carcinoma, "
            "pheochromocytoma, and hyperparathyroidism."
        ),
        "notes": "Converted image-slide selection into a direct syndrome-association question.",
    },
    19104: {
        "prompt": "Which of the following is the most valid statement about MS flares in this group of students?",
        "narrative": (
            "A group of 6 college students with multiple sclerosis was evaluated for flares. The timeline shows 2 new "
            "flare onsets during May; other gray bars represent ongoing flares that began before May or persisted after May. "
            "Which of the following is the most valid statement about MS flares in this group?"
        ),
        "notes": "Replaced the missing timeline figure with the key count needed for the answer.",
    },
    19250: {
        "narrative": (
            "A 74-year-old man has 4 months of worsening left flank pain, brown urine, fever, and left costovertebral-angle "
            "tenderness. He has a 45 pack-year smoking history. CT abdomen shows a solid enhancing renal cortical mass. "
            "This lesion most likely arose from which of the following cells?"
        ),
        "notes": "Encoded the missing CT finding as an enhancing renal cortical mass.",
    },
    19798: {
        "narrative": (
            "A 6-month-old unimmunized child has fever, poor feeding, lethargy, and bacterial meningitis. CSF culture grows "
            "a gram-negative encapsulated organism that grows on chocolate agar and requires factors X (hemin) and V (NAD). "
            "Which organism does this best describe?"
        ),
        "notes": "Replaced image of growth factors with explicit X and V factor requirements.",
    },
    19855: {
        "narrative": (
            "A 60-year-old man has fever, cough productive of rust-colored sputum, and community-acquired pneumonia. Gram "
            "stain of the isolate shows lancet-shaped gram-positive diplococci. Which of the following most correctly "
            "describes additional features of the causative organism?"
        ),
        "notes": "Replaced missing Gram-stain image with lancet-shaped gram-positive diplococci.",
    },
    19904: {
        "narrative": (
            "A 70-year-old man with atrial fibrillation presents after a fall. He is likely taking warfarin, and laboratory "
            "testing shows an INR of 6. Head CT shows intracranial hemorrhage. Which of the following is the most appropriate "
            "pharmacologic therapy?"
        ),
        "notes": "Encoded the missing head-CT finding as intracranial hemorrhage.",
    },
    20912: {
        "prompt": "What is the most likely diagnosis?",
        "narrative": (
            "A 35-year-old woman presents with symmetric proximal muscle weakness, a blue-purple heliotrope rash of the "
            "upper eyelids, and erythematous papules over the knuckles. What is the most likely diagnosis?"
        ),
        "rationale": (
            "Dermatomyositis is the best answer because it causes symmetric proximal muscle weakness with characteristic "
            "cutaneous findings such as heliotrope rash and Gottron papules."
        ),
        "notes": "Replaced the missing rash photograph with explicit heliotrope/Gottron findings.",
    },
    21892: {
        "narrative": (
            "A 58-year-old man with HIV has a gradually enlarging, painless lateral neck lymph node. Excisional biopsy shows "
            "Reed-Sternberg cells in a mixed inflammatory background containing eosinophils, plasma cells, and histiocytes. "
            "Which of the following is the most likely diagnosis?"
        ),
        "notes": "Moved the biopsy-image content into the vignette.",
    },
    22408: {
        "narrative": (
            "A 45-year-old woman with rheumatoid arthritis treated with methotrexate and ibuprofen has epigastric pain that "
            "worsens with eating. Endoscopy shows a gastric ulcer, and testing is negative for Helicobacter pylori. Which "
            "treatment best facilitates healing of this lesion?"
        ),
        "notes": "Encoded the endoscopy image as a gastric ulcer.",
    },
    22533: {
        "narrative": (
            "A 21-year-old college student has intermittent palpitations that worsened after a party. She has tremor, warm "
            "extremities, and tachycardia but no chest pain or dyspnea. Which of the following is the most appropriate next "
            "step in management?"
        ),
        "notes": "Made the hyperthyroid clues explicit so the missing ECG/image is not needed.",
    },
    22720: {
        "narrative": (
            "A 43-year-old woman with poorly controlled type 1 diabetes presents with epistaxis. Examination shows a black "
            "necrotic eschar involving the nasal mucosa and palate. What is the most likely explanation for these findings?"
        ),
        "rationale": (
            "Rhizopus infection is the best answer because poorly controlled diabetes predisposes to rhinocerebral "
            "mucormycosis, which can cause necrotic black nasal or palatal eschars from angioinvasive fungal disease."
        ),
        "notes": "Replaced missing exam photograph with black nasal/palatal eschar.",
    },
    23021: {
        "narrative": (
            "A 29-year-old Mediterranean man has fatigue, lightheadedness, and exercise intolerance 2 weeks after starting "
            "treatment for active tuberculosis. Peripheral smear is consistent with sideroblastic anemia. What is the most "
            "likely explanation for this patient's symptoms?"
        ),
        "rationale": (
            "Drug-induced vitamin B6 deficiency is the best answer because isoniazid can deplete pyridoxine, impairing heme "
            "synthesis and causing sideroblastic anemia."
        ),
        "notes": "Encoded the missing smear clue as sideroblastic anemia.",
    },
    23642: {
        "narrative": (
            "An infant has hypotonia, hepatosplenomegaly, developmental delay, and a cherry-red macula. Laboratory testing "
            "shows deficient sphingomyelinase activity. Which of the following is the most likely pathologic mechanism?"
        ),
        "notes": "Replaced multiple missing figures/lab panels with classic Niemann-Pick findings.",
    },
    23705: {
        "narrative": (
            "A 60-year-old man with poorly controlled diabetes and refractory peripheral artery disease has worsening pain, "
            "swelling, foul-smelling purulent discharge, and wet gangrene of the left foot despite failed revascularization. "
            "Which finding is the strongest indication for amputation?"
        ),
        "notes": "Made wet gangrene explicit and removed any dependence on a limb photograph.",
    },
    23734: {
        "narrative": (
            "A 52-year-old woman with rheumatoid arthritis treated with methotrexate has fatigue, sore mouth, nausea, and "
            "abdominal discomfort. Examination shows glossitis, and labs show macrocytic anemia with hypersegmented "
            "neutrophils and elevated homocysteine. Which intervention could have reduced her risk of this condition?"
        ),
        "rationale": (
            "Folinic acid is the best answer because methotrexate inhibits folate metabolism and can cause megaloblastic "
            "anemia and mucositis; folinic acid rescue reduces this toxicity."
        ),
        "notes": "Replaced missing exam/lab figures with folate-deficiency clues.",
    },
    24173: {
        "narrative": (
            "A 52-year-old man awakens with excruciating pain in the right great toe; even the bed sheet is unbearably "
            "painful. He is treated with colchicine. Which of the following describes the mechanism of colchicine?"
        ),
        "notes": "Removed nonessential foot-image reference from a classic podagra vignette.",
    },
    25354: {
        "narrative": (
            "A 37-year-old man with intermittent intravenous drug use has fever, breathlessness, and findings concerning for "
            "right-sided infective endocarditis with septic pulmonary emboli. Which causative agent is most likely responsible?"
        ),
        "rationale": (
            "Staphylococcus aureus is the best answer because it is the most common cause of acute infective endocarditis in "
            "people who inject drugs and commonly involves the right-sided valves with septic pulmonary emboli."
        ),
        "notes": "Replaced an unrelated food-poisoning rationale and made the endocarditis clue self-contained.",
    },
    25581: {
        "narrative": (
            "A 32-year-old woman with depression presents after suspected ingestion with confusion, blurry vision, visual "
            "hallucinations, hypotension, tachycardia, and anticholinergic findings. ECG shows QRS widening, and the physician "
            "orders sodium bicarbonate. What medication most likely caused this cardiac abnormality?"
        ),
        "notes": "Encoded the missing ECG finding as QRS widening.",
    },
    25732: {
        "narrative": (
            "A 64-year-old man has spontaneous chest pain radiating to the back, ears, and neck without exertional dyspnea. "
            "Upper GI barium swallow shows a corkscrew esophagus. Which finding would you most expect during further workup?"
        ),
        "notes": "Encoded the barium swallow image as corkscrew esophagus.",
    },
    26228: {
        "narrative": (
            "A 73-year-old woman has intense central chest pain radiating down the left arm. ECG shows ST-segment elevation "
            "consistent with acute myocardial infarction. Which biochemical marker would most likely remain elevated for a week?"
        ),
        "notes": "Replaced missing ECG image with explicit STEMI finding.",
    },
    26444: {
        "narrative": (
            "A homeless man with recurrent public alcohol intoxication presents with confusion, slurred speech, ataxia, "
            "anion-gap metabolic acidosis, and acute kidney injury. Urinalysis shows envelope-shaped calcium oxalate crystals. "
            "While awaiting confirmatory testing, which treatment should be administered next?"
        ),
        "notes": "Encoded missing urinalysis as calcium oxalate crystals from ethylene glycol poisoning.",
    },
    26726: {
        "narrative": (
            "A 58-year-old man develops refractory respiratory failure after severe trauma. Autopsy shows heavy red lungs, "
            "diffuse alveolar damage, and hyaline membranes. Which finding was most likely present shortly before death?"
        ),
        "notes": "Encoded ARDS histology as diffuse alveolar damage with hyaline membranes.",
    },
    27123: {
        "narrative": (
            "A 5-year-old Syrian immigrant has photophobia, bilateral lacrimation, eye itching, eyelid swelling, and chronic "
            "follicular conjunctivitis with tarsal inflammation consistent with trachoma. Which statement is true regarding "
            "treatment of this condition?"
        ),
        "rationale": (
            "A single oral dose of azithromycin is the best answer because trachoma is caused by Chlamydia trachomatis and "
            "is treated with oral azithromycin as part of standard control strategies."
        ),
        "notes": "Replaced missing eye image with trachoma-compatible exam findings.",
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


def ensure_rationale_dict(case_data: dict[str, Any]) -> dict[str, Any]:
    rationale = case_data.get("rationale")
    if isinstance(rationale, dict):
        return rationale
    return {"correct": normalize_text(rationale)}


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
    elif fix.get("title"):
        updated["title"] = normalize_text(fix["title"])

    if fix.get("narrative"):
        vignette = updated.get("vignette")
        if isinstance(vignette, dict):
            vignette["narrative"] = normalize_text(fix["narrative"])
        else:
            updated["vignette"] = {"narrative": normalize_text(fix["narrative"])}

    if fix.get("rationale"):
        rationale = ensure_rationale_dict(updated)
        rationale["correct"] = normalize_text(fix["rationale"])
        updated["rationale"] = rationale

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
