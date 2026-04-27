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
        normalize_text,
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
        normalize_text,
        persist_sqlite,
        read_json,
        rebuild_answer_anchor_text,
        summarize_text,
        update_json_cases,
        with_quality_flag,
        write_json_atomic,
    )


ROOT = Path(__file__).resolve().parent.parent
REPORT_FILE = ROOT / "ingestion" / "output" / "worldmedqa_wave1_report.json"
BASIS = "deterministic:worldmedqa-wave1"


FIXES: dict[int, dict[str, Any]] = {
    990037: {
        "prompt": "What is the best initial treatment sequence for HIV with clinically suspected active tuberculosis?",
        "narrative": "A 42-year-old homeless man who injects drugs has 2 months of productive cough, evening fever, night sweats, anorexia, and 20 kg weight loss. HIV rapid test is positive, blood count shows anemia and leukopenia, and chest imaging is compatible with active pulmonary tuberculosis despite negative sputum AFB samples. What is the best treatment sequence?",
    },
    990055: {
        "prompt": "What are the diagnosis and management for a pediatric distal radius Salter-Harris II fracture?",
        "narrative": "A 6-year-old boy fell from a bunk bed and has intense right wrist pain with functional limitation. Wrist radiograph shows fracture of the distal radius extending through the growth plate and metaphysis while sparing the epiphysis. What are the diagnosis and management?",
    },
    990057: {
        "prompt": "What is the appropriate management for acute ischemic stroke within the thrombolysis window and no CT hemorrhage?",
        "narrative": "A 62-year-old man develops abrupt right upper-limb monoparesis and nonfluent aphasia. Symptoms persist and worsen slightly. He has atrial fibrillation, blood pressure 160/100 mm Hg, glucose 300 mg/dL, and noncontrast head CT performed about 2.5 hours after onset shows no intracranial hemorrhage. What is the appropriate diagnosis and management?",
    },
    990059: {
        "prompt": "What is the best management for stable blunt liver trauma with contrast extravasation?",
        "narrative": "A 34-year-old patient has blunt abdominal trauma after a car accident. After crystalloid resuscitation, vital signs normalize. CT abdomen with IV contrast shows an isolated liver injury with active contrast extravasation and no other abdominal injury. What management is most appropriate?",
    },
    990061: {
        "prompt": "What is the appropriate management for a stable premenstrual simple ovarian cyst?",
        "narrative": "A 25-year-old woman has 24 hours of pelvic pain, stable vital signs, last menstrual period 3 weeks ago, and transvaginal ultrasound showing a 7.0 x 6.5 cm simple cystic structure in the left ovary without suspicious solid components. What should be the medical conduct?",
    },
    990069: {
        "prompt": "What is the initial approach to suspected adhesive small bowel obstruction without peritonitis?",
        "narrative": "A 55-year-old man has bilious vomiting, colicky abdominal pain, and no flatus or stool for 3 hours. He had laparotomy for perforated peptic ulcer 5 years ago. Abdomen is mildly distended without peritoneal irritation, and abdominal x-ray supports small bowel obstruction. Besides fluid and electrolyte replacement, what is the most appropriate approach?",
    },
    990087: {
        "prompt": "What is recommended for lung abscess that persists despite 20 days of appropriate IV antibiotics?",
        "narrative": "A 37-year-old homeless man with poor hygiene and substance use has 3 weeks of foul-smelling green sputum streaked with blood, low-grade fever, weight loss, and chest x-ray consistent with lung abscess. Molecular testing for mycobacteria is negative. After 20 days of IV ceftriaxone plus metronidazole, symptoms and radiographic lesion persist. What is recommended?",
    },
    990140: {
        "prompt": "Which statement correctly describes Nocardia seen in sputum of an immunosuppressed patient?",
        "narrative": "A patient on long-term high-dose steroids has right upper-lobe pulmonary infiltrate. Sputum Gram stain shows branching filamentous gram-positive organisms that are weakly/partially acid-fast, consistent with Nocardia. Which statement correctly describes the pathogen?",
        "options": [
            {"id": "A", "text": "The organism grows equally well on Sabouraud and Lowenstein-Jensen media as a routine finding.", "is_correct": False},
            {"id": "B", "text": "Initial treatment never includes cotrimoxazole or sulfonamides.", "is_correct": False},
            {"id": "C", "text": "The agent grows within a few days only under anaerobic conditions.", "is_correct": False},
            {"id": "D", "text": "The agent is partially acid-fast.", "is_correct": True},
        ],
        "rationale": "Nocardia causes pulmonary disease in immunosuppressed patients and appears as branching filamentous gram-positive organisms that are weakly or partially acid-fast. It is aerobic and classically treated with trimethoprim-sulfamethoxazole; anaerobic growth would fit Actinomyces rather than Nocardia.",
    },
    990165: {
        "prompt": "What type of pathogen causes a vesicular lesion with viral cytopathic changes?",
        "narrative": "A skin/mucosal lesion is vesicular and shows viral cytopathic changes such as multinucleation and epithelial ballooning. What could cause this lesion?",
    },
    990189: {
        "prompt": "Which medication is associated with cystoid macular edema after cataract surgery?",
        "narrative": "A patient presents 7 weeks after routine cataract surgery with decreased vision. OCT shows cystoid macular edema. Which medication could cause or worsen the described condition?",
    },
    990025: {
        "prompt": "How should a suspicious cardiotocography pattern in preterm labor be managed?",
        "narrative": "A primigravida at 36 weeks presents in labor with 3-4 moderate contractions every 10 minutes, fetal heart tones present, 4 cm dilation, intact membranes, and cephalic presentation. Cardiotocography is suspicious rather than clearly normal or pathological. What interpretation and conduct are appropriate?",
    },
    990064: {
        "prompt": "What conclusion follows from male proportional mortality data by age group?",
        "narrative": "A proportional mortality dataset for males by age group shows that assaults and external causes of undetermined intent account for at least half of deaths in the 15-29-year age group. Based on the data, which conclusion is correct?",
    },
    990046: {
        "prompt": "What explains the increasing incidence of congenital syphilis in Brazil from 2004 to 2013?",
        "narrative": "A time-series graph of congenital syphilis incidence in children under 1 year in Brazil and its regions from 2004 to 2013 shows increasing rates. Considering the epidemiological data and Brazilian prenatal-care reality during the period, what is correct?",
    },
    990049: {
        "prompt": "Which analysis is correct for the tuberculosis incidence trend from 1990 to 2013?",
        "narrative": "A graph compares tuberculosis incidence rates from 1990 to 2013 in Brazil and several other countries, evaluating progress toward the Millennium Development Goal target. The correct interpretation is that Brazil and 5 other countries reached the target, with Ecuador showing the highest percentage reduction.",
    },
    990120: {
        "prompt": "What is the odds ratio for HCV infection and B-cell NHL in the combined study population?",
        "narrative": "A case-control study evaluated whether hepatitis C virus infection increases B-cell non-Hodgkin lymphoma risk. In the combined population, 48 cases and 15 controls were HCV-positive, while 552 cases and 552 controls were HCV-negative. What is the odds ratio for the association?",
    },
    990226: {
        "prompt": "Where is the apical impulse typically found in severe COPD?",
        "narrative": "In severe COPD, lung hyperinflation and a low flattened diaphragm can make the apical impulse difficult to palpate or shift it inferiorly toward the epigastric/subxiphoid region. Where is the apical heartbeat most likely found?",
        "options": [
            {"id": "A", "text": "Normal left 5th intercostal space at the midclavicular line", "is_correct": False},
            {"id": "B", "text": "Left anterior axillary line", "is_correct": False},
            {"id": "C", "text": "Right parasternal area", "is_correct": False},
            {"id": "D", "text": "Epigastric or subxiphoid area", "is_correct": True},
        ],
    },
    990231: {
        "prompt": "Which lung volume represents residual air volume?",
        "narrative": "A lung-volume diagram separates tidal volume, inspiratory reserve volume, residual volume, and vital capacity. Which option represents the residual air volume that remains after maximal expiration?",
        "options": [
            {"id": "A", "text": "Tidal volume", "is_correct": False},
            {"id": "B", "text": "Inspiratory reserve volume", "is_correct": False},
            {"id": "C", "text": "Residual volume", "is_correct": True},
            {"id": "D", "text": "Vital capacity", "is_correct": False},
        ],
    },
    990023: {
        "prompt": "What are the diagnosis and management for mild pre-eclampsia at 37 weeks?",
        "narrative": "A primigravida at 37 weeks has lower-limb edema, blood pressure 150/90 mm Hg, fetal heart rate 140 bpm without decelerations, no uterine contractions, closed thick cervix, and urine dipstick protein +/4+. What are the correct diagnosis and management?",
        "metric_collision_reviewed": True,
    },
    990039: {
        "prompt": "How should the death certificate be completed for postpartum eclampsia leading to coma and death?",
        "narrative": "A 23-year-old woman at 40 weeks presents in labor with blood pressure 170/100 mm Hg. Two hours after delivery she has a seizure, then another seizure progresses to coma, irreversible cardiac arrest, and death. How should the death certificate be completed?",
        "options": [
            {"id": "A", "text": "Part I: a - coma; b - convulsive crisis; c - hypertensive crisis. Part II: unfilled.", "is_correct": False},
            {"id": "B", "text": "Part I: a - cardiac arrest; b - coma; c - cerebral edema; d - convulsive crisis. Part II: eclampsia.", "is_correct": False},
            {"id": "C", "text": "Part I: a - cardiac arrest; b - coma; c - convulsive crisis; d - hypertensive crisis. Part II: hypertension.", "is_correct": False},
            {"id": "D", "text": "Part I: a - coma; b - cerebral edema; c - convulsive crisis; d - eclampsia in the postpartum period. Part II: 40-week gestation.", "is_correct": True},
        ],
    },
    990048: {
        "prompt": "Where should cutting instruments be positioned on the laparotomy instrument table?",
        "narrative": "Several victims of a bus accident require emergency laparotomy. The physician must assemble the instrument table in the standard sequence for the procedure. In this setup, the scrub doctor should position:",
    },
    990067: {
        "prompt": "What are the fetal lie, presentation, and position when the back is right and the cephalic pole is in the pelvis?",
        "narrative": "A 24-year-old primigravida at 38 weeks has contractions. Leopold maneuvers identify the fetal back on the right and the cephalic pole in the pelvis, with the occiput directed posteriorly. What are the fetal lie, presentation, and position?",
    },
    990068: {
        "prompt": "What treatment is needed for recurrent syncope with bradycardia, cannon a waves, and complete AV block?",
        "narrative": "A 64-year-old patient has recurrent syncope preceded by dizziness and dimming of vision. Examination shows bradycardia at 42/min, regular rhythm, intermittent cannon a waves in the jugular venous pulse, and ECG consistent with complete atrioventricular block. What treatment is necessary?",
    },
}


def ensure_rationale_dict(case_data: dict[str, Any]) -> dict[str, Any]:
    rationale = case_data.get("rationale")
    if isinstance(rationale, dict):
        return deepcopy(rationale)
    return {"correct": normalize_text(rationale)}


def without_quality_flags(meta: dict[str, Any], remove: set[str]) -> None:
    flags = meta.get("quality_flags")
    if not isinstance(flags, list):
        return
    remaining = [flag for flag in flags if flag not in remove]
    if remaining:
        meta["quality_flags"] = remaining
    else:
        meta.pop("quality_flags", None)


def apply_fix(current: dict[str, Any], fix: dict[str, Any], timestamp: str) -> dict[str, Any]:
    updated = deepcopy(current)
    updated["prompt"] = normalize_text(fix["prompt"])
    updated["title"] = normalize_text(fix["prompt"])

    vignette = updated.get("vignette")
    if isinstance(vignette, dict):
        vignette["narrative"] = normalize_text(fix["narrative"])
    else:
        updated["vignette"] = {"narrative": normalize_text(fix["narrative"])}

    if fix.get("options"):
        updated["options"] = deepcopy(fix["options"])

    if fix.get("rationale"):
        rationale = ensure_rationale_dict(updated)
        rationale["correct"] = normalize_text(fix["rationale"])
        updated["rationale"] = rationale

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
    without_quality_flags(
        meta,
        {
            "readability_batch_salvage_hold",
            "truncated_false_positive_cleared",
            "prompt_promoted_from_narrative",
            "image_dependency_detected",
        },
    )
    meta["avg_option_length"] = compute_avg_option_length(updated.get("options") or [])
    meta["readability_ai_pass"] = True
    meta["readability_ai_pass_basis"] = BASIS
    meta["worldmedqa_release_at"] = timestamp
    if fix.get("metric_collision_reviewed"):
        meta["metric_collision_reviewed"] = True
        meta["metric_collision_reviewed_at"] = timestamp
        meta["metric_collision_reviewed_basis"] = BASIS
    with_quality_flag(meta, "worldmedqa_repaired")
    updated["meta"] = meta
    return updated


def main() -> None:
    timestamp = datetime.now(timezone.utc).isoformat()
    target_ids = list(FIXES)
    json_cases = read_json(JSON_FILE, [])
    connection = sqlite3.connect(DB_FILE)
    connection.row_factory = sqlite3.Row
    cases_by_id = load_case_rows(connection, target_ids)
    updates: dict[int, dict[str, Any]] = {}
    rows: list[dict[str, Any]] = []

    for case_id, fix in FIXES.items():
        current = cases_by_id.get(case_id)
        if not current:
            rows.append({"case_id": case_id, "status": "missing_case"})
            continue
        updated = apply_fix(current, fix, timestamp)
        updates[case_id] = updated
        rows.append(
            {
                "case_id": case_id,
                "case_code": updated.get("case_code"),
                "source": updated.get("source"),
                "status": "applied",
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
