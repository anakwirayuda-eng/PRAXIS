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
REPORT_FILE = ROOT / "ingestion" / "output" / "pedmedqa_wave1_report.json"
BASIS = "deterministic:pedmedqa-wave1"


FIXES: dict[int, dict[str, Any]] = {
    992857: {
        "prompt": "Which diagnosis best explains bowel obstruction with a tender irreducible groin mass?",
        "narrative": "A 5-year-old boy with Down syndrome is brought in because he is lethargic, not eating well, and appears dehydrated. He has abdominal distention, and examination shows a tender irreducible groin mass. Abdominal radiography shows obstructed bowel loops. Which of the following is the most likely diagnosis?",
        "rationale": "A tender irreducible groin mass with bowel obstruction is most consistent with an incarcerated hernia. Pyloric stenosis would present in early infancy with nonbilious projectile vomiting, ulcerative colitis causes chronic bloody diarrhea, and anal atresia presents in the newborn period.",
    },
    992376: {
        "prompt": "Which statement about appendiceal lymphoid follicles is correct?",
        "narrative": "A 13-year-old boy undergoes laparoscopic appendectomy for acute appendicitis. Histology of the appendix shows prominent lymphoid follicles in the mucosa/submucosa. Which statement about these structures is correct?",
    },
    993490: {
        "prompt": "What is the most appropriate next step for multiple fractures with bruises and retinal hemorrhages?",
        "narrative": "A 3-year-old boy has multiple healed fractures and bruises at different stages. Fundoscopic examination shows retinal hemorrhages. Although blue-appearing irises are noted, the pattern of injuries is concerning for inflicted trauma. What is the most appropriate next step in care?",
    },
    993553: {
        "prompt": "What is the pathogenesis of acute bruising and epistaxis from immune thrombocytopenia?",
        "narrative": "A previously healthy 12-year-old boy presents with 2 weeks of frequent nosebleeds and lower-extremity petechiae/purpura after a recent immunization. Vital signs are stable and he is otherwise well. Which of the following best describes the pathogenesis of this condition?",
    },
    994307: {
        "prompt": "What is the best treatment for symptomatic pediatric lead poisoning with venous lead level 60 mcg/dL?",
        "narrative": "A 4-year-old boy living in a house built in 1950 has abdominal cramps, fatigue, microcytic anemia, venous blood lead level of 60 mcg/dL, and basophilic stippling on peripheral smear. Which treatment option is best?",
    },
    992918: {
        "prompt": "Which factor is associated with poor prognosis in pediatric neuroblastoma?",
        "narrative": "A 7-year-old girl has a neck mass, left ptosis, and miosis consistent with Horner syndrome. Imaging shows a posterior mediastinal mass, and biopsy shows a neuroblastic tumor with scattered ganglion cells. Which factor is associated with poor prognosis for the most likely diagnosis?",
    },
    994068: {
        "prompt": "What may a physician do after parents persistently refuse all vaccines despite counseling?",
        "narrative": "A well 2-week-old infant is brought for first pediatric care. The parents state that they plan to refuse all vaccines. The physician explains vaccine risks and benefits, addresses concerns, and offers continued counseling, but the parents remain adamant. If the practice has a clear policy and provides appropriate notice and emergency coverage, which course of action is permissible from the options below?",
        "rationale": "Physicians should counsel, document informed refusal, and continue addressing vaccine hesitancy when possible. If a family persistently refuses vaccination and the practice has a clear policy, dismissal from the practice can be permissible only with appropriate notice and continuity safeguards. The physician should not call child protective services, obtain a court order, or vaccinate against parental refusal for routine immunizations.",
    },
    992514: {
        "prompt": "What is the diagnosis of a true ileal outpouching containing all bowel wall layers?",
        "narrative": "A 2-year-old girl with abdominal pain undergoes laparoscopy. A blind-ending outpouching is excised from the ileum. Pathology shows mucosa, submucosa, and muscularis propria in the wall, indicating a true diverticulum. Which diagnosis best fits this specimen?",
        "options": [
            {"id": "A", "text": "Appendicitis", "is_correct": False},
            {"id": "B", "text": "Henoch-Schonlein purpura", "is_correct": False},
            {"id": "C", "text": "Meckel diverticulum", "is_correct": True},
            {"id": "D", "text": "Intussusception", "is_correct": False},
        ],
        "rationale": "A true diverticulum of the ileum containing all bowel wall layers is Meckel diverticulum, a remnant of the vitelline duct. Appendicitis involves the appendix, Henoch-Schonlein purpura is an IgA vasculitis, and intussusception is telescoping of bowel rather than a true ileal diverticulum.",
    },
    991851: {
        "prompt": "Failure of which enzymatic reaction causes refractory megaloblastic anemia in this infant?",
        "narrative": "A 2-month-old boy has poor weight gain, irritability, macrocytosis, hypersegmented neutrophils, and megaloblastic anemia that does not improve after folate and cobalamin supplementation. The condition is most likely caused by failure of which enzymatic reaction?",
    },
    991902: {
        "prompt": "What is the most likely direct cause of morning vomiting with visual field narrowing?",
        "narrative": "An 11-year-old boy has 1 week of vomiting that is worse in the morning, intermittent headaches, and mild narrowing of visual fields. Gastroenteritis symptoms in siblings have resolved, but his morning emesis and visual symptoms suggest increased intracranial pressure from a posterior fossa lesion. Which of the following is the most likely direct cause?",
        "options": [
            {"id": "A", "text": "Non-enveloped, positive-sense ssRNA virus", "is_correct": False},
            {"id": "B", "text": "Gram-negative microaerophilic bacteria", "is_correct": False},
            {"id": "C", "text": "Gram-positive enterotoxin", "is_correct": False},
            {"id": "D", "text": "Intracerebellar mass", "is_correct": True},
        ],
        "rationale": "Morning vomiting, headaches, and visual field changes are red flags for increased intracranial pressure. In a child, a posterior fossa/intracerebellar mass can directly obstruct CSF flow or increase pressure and produce this presentation. Infectious gastroenteritis would not explain persistent morning emesis with visual field narrowing.",
    },
    993402: {
        "prompt": "Which statement best interprets the observational afterschool programming study?",
        "narrative": "An 8-year-old boy from a low-income family is considering high-quality afterschool programming. A study of socioeconomically disadvantaged children ages 5-10 found an association between participation and lower adult ADHD risk, but the design does not prove causation. Which statement best addresses the mother's question?",
        "options": [
            {"id": "A", "text": "High-quality afterschool programming has a greater effect on reducing ADHD risk in adults than major depressive disorder risk.", "is_correct": False},
            {"id": "B", "text": "High-quality afterschool programming has a greater effect on reducing psychotic disorder risk in adults than bipolar disorder risk.", "is_correct": False},
            {"id": "C", "text": "High-quality afterschool programming for low-income 8-year-olds may correlate with decreased ADHD risk in adults.", "is_correct": True},
        ],
    },
    991824: {
        "prompt": "Which congenital heart defect is associated with congenital rubella?",
        "narrative": "A neonate is born after the mother had fever, rash, myalgias, and tender lymphadenopathy during the second month of pregnancy. Retinal/ocular findings support congenital rubella infection. Which congenital heart defect is most likely?",
    },
    992011: {
        "prompt": "The chromosome involved in hereditary retinoblastoma/osteosarcoma also contains a gene linked to which pathology?",
        "narrative": "A 13-year-old boy has progressive pain and swelling near the distal femur consistent with osteosarcoma. Several relatives had the same disorder, and others had eye tumors near birth, suggesting hereditary retinoblastoma due to a chromosome 13 abnormality. That chromosome also contains a gene associated with which pathology?",
    },
    992129: {
        "prompt": "What causes recurrent fractures with jagged cafe-au-lait macules?",
        "narrative": "A 5-year-old boy has multiple fractures after minor trauma, normal development, and irregular jagged cafe-au-lait macules on examination. The findings suggest McCune-Albright syndrome with polyostotic fibrous dysplasia. Which mechanism best explains the fractures?",
    },
    992373: {
        "prompt": "Which maternal medication is associated with Ebstein anomaly?",
        "narrative": "A 3-month-old infant was born cyanotic with a congenital heart malformation characterized by apical displacement of the septal and posterior tricuspid valve leaflets, consistent with Ebstein anomaly. The mother took a mood-stabilizing medication during pregnancy. Which medication was most likely used?",
    },
    992570: {
        "prompt": "Which organism requires both X and V factors for growth?",
        "narrative": "A 6-month-old unimmunized infant has fever, poor feeding, lethargy, and bacterial meningitis. CSF culture grows a gram-negative encapsulated organism that grows on chocolate agar and requires both X (hemin) and V (NAD) factors. Which organism does this best describe?",
    },
    992827: {
        "prompt": "A child with Down syndrome and GATA1 mutation is at increased risk for which condition?",
        "narrative": "A 2-month-old boy has generalized hypotonia, upslanting palpebral fissures, small dysplastic ears, a flat facial profile, clinodactyly, single palmar creases, and karyotype findings consistent with trisomy 21. If he also inherited a GATA1 mutation, which condition is he at increased risk for?",
    },
    993015: {
        "prompt": "What diagnosis explains recurrent bronchopneumonia, emphysema, hepatitis labs, and a low alpha-1 band?",
        "narrative": "A 13-year-old boy has recurrent bronchopneumonia, failure to thrive, hypoxemia, diffuse emphysema on chest radiograph, elevated transaminases, normal sweat chloride test, normal nitroblue tetrazolium test, and serum protein electrophoresis showing a decreased alpha-1 globulin band. Which diagnosis is most likely?",
    },
    993450: {
        "prompt": "Which exposure contributed to this infant's acute otitis media?",
        "narrative": "An 11-month-old boy has fever, irritability, ear tugging, and otoscopy showing a bulging erythematous tympanic membrane consistent with acute otitis media. He lives with family members, and his father smokes cigarettes on the balcony. Which factor most likely contributed to this condition?",
    },
    993464: {
        "prompt": "What is the benefit of adding clavulanic acid to amoxicillin?",
        "narrative": "A 7-year-old boy has recurrent acute otitis media with a bulging erythematous tympanic membrane. He is treated with amoxicillin-clavulanate. Which term best describes the benefit of adding clavulanic acid to amoxicillin?",
    },
    994327: {
        "prompt": "What treatment is appropriate for trachoma in this child?",
        "narrative": "A 5-year-old Syrian immigrant has photophobia, bilateral lacrimation, eye itching, eyelid swelling, and conjunctival findings consistent with trachoma. She has a cephalosporin allergy. Which statement about treatment is true?",
    },
    992428: {
        "prompt": "Which finding is most likely in abusive head trauma with subdural bleeding?",
        "narrative": "A 10-month-old infant is brought after a seizure. The history is inconsistent for age and mechanism, neurologic examination is initially nonfocal, and head CT shows subdural hemorrhage concerning for abusive head trauma. Which finding is most likely present?",
    },
    992815: {
        "prompt": "What diagnosis explains multiple fractures with blue sclerae?",
        "narrative": "A 5-year-old boy has multiple fractures in various stages of healing. Physical examination shows blue sclerae and other features of a collagen disorder rather than a pattern of inflicted trauma. What is the most likely diagnosis?",
    },
    993682: {
        "prompt": "What causes bleeding gums, petechiae, poor wound healing, and fracture risk in this child?",
        "narrative": "A 6-year-old boy has bleeding gums, diffuse petechiae, a recent supracondylar fracture after minor trauma, and a swollen/bleeding tongue and gingiva. Which deficiency or disorder most likely causes this condition?",
    },
    992662: {
        "prompt": "What is the best treatment for tinea capitis with alopecia and cervical lymphadenopathy?",
        "narrative": "A 10-year-old girl has a circular itchy scalp rash with hair loss for 3 weeks, a tender posterior cervical lymph node, and exam findings consistent with tinea capitis. Which treatment is best?",
    },
    992430: {
        "prompt": "Which cells predominate several hours after an acute urticarial/anaphylactic skin lesion?",
        "narrative": "A 10-year-old boy develops abdominal pain, vomiting, diffuse rash, tachypnea, and wheezing after outdoor exposure. The rash is urticarial and consistent with an acute IgE-mediated reaction. Which cells will mainly be found in a skin biopsy from the lesion 4 hours later?",
    },
    992772: {
        "prompt": "Which neoplasm is associated with cafe-au-lait macules and Lisch nodules?",
        "narrative": "A 13-year-old boy has multiple cafe-au-lait macules on the trunk, a mother with similar skin findings, and ophthalmic examination showing Lisch nodules. What neoplasm is he most likely to develop?",
    },
    993339: {
        "prompt": "Which congenital infection causes microcephaly, jaundice, hepatosplenomegaly, and periventricular calcifications?",
        "narrative": "A 2-day-old boy born at term has jaundice, microcephaly, hepatosplenomegaly, and head imaging showing periventricular calcifications. Which infection acquired during pregnancy is the most likely cause?",
    },
    993349: {
        "prompt": "Which storage material accumulates in Niemann-Pick disease?",
        "narrative": "An infant has hypotonia, hepatosplenomegaly, developmental delay, and cherry-red macula. Laboratory testing shows deficient sphingomyelinase activity. Which pathologic mechanism is involved?",
    },
    992288: {
        "prompt": "Which left-hand sensory deficit fits lower brachial plexus involvement with Horner syndrome?",
        "narrative": "A 16-year-old girl has progressive sharp pain from the left neck/upper limb down to the hand, worse with activity, plus left ptosis and miosis. Imaging shows an apical/upper thoracic lesion involving the lower brachial plexus. Which focal neurologic deficit would most likely be seen in the left hand?",
    },
    992197: {
        "prompt": "What mutation mechanism causes sickle cell disease?",
        "narrative": "An 8-year-old African-American boy has severe pain in both hands after a febrile respiratory illness, family history of a fatal blood disease, and a peripheral smear with sickled red blood cells. What is the most likely mutation mechanism?",
    },
    992517: {
        "prompt": "Where does antigen-stimulated B-cell proliferation occur in a lymph node follicle?",
        "narrative": "A 3-year-old child is exposed to an antigen that is presented by a CD4+ T helper cell. A mature B cell in the lymph node proliferates and differentiates to produce antibodies. On the labeled lymph-node diagram, section 3 corresponds to the germinal center of a secondary follicle. Where does this process most likely occur?",
    },
    992627: {
        "prompt": "Which statement is true about infectious mononucleosis due to EBV?",
        "narrative": "A 17-year-old boy has fever, sore throat, cervical lymphadenopathy, atypical reactive T cells, and exudative tonsillitis consistent with infectious mononucleosis due to Epstein-Barr virus. Which statement is true about this condition?",
    },
    992697: {
        "prompt": "Which culture medium is used for suspected Corynebacterium diphtheriae?",
        "narrative": "A 12-year-old unimmunized boy from Eastern Europe has severe sore throat, cervical lymphadenopathy, extensive neck edema, respiratory difficulty, and a gray pharyngeal pseudomembrane. The suspected bacterium produces an AB exotoxin. Which medium is appropriate to culture the most likely organism?",
        "options": [
            {"id": "A", "text": "Bordet-Gengou agar", "is_correct": False},
            {"id": "B", "text": "Charcoal yeast extract agar", "is_correct": False},
            {"id": "C", "text": "Tellurite agar", "is_correct": True},
            {"id": "D", "text": "Thayer-Martin agar", "is_correct": False},
        ],
        "rationale": "Corynebacterium diphtheriae causes pharyngitis with a gray pseudomembrane and a toxin-mediated disease due to an AB exotoxin. It is classically grown on tellurite-containing media. Thayer-Martin agar is used for Neisseria gonorrhoeae, Bordet-Gengou for Bordetella pertussis, and charcoal yeast extract agar for Legionella.",
    },
    994213: {
        "prompt": "What is the best management for croup with inspiratory stridor and steeple sign?",
        "narrative": "An 18-month-old girl has rhinorrhea, low-grade fever, hoarseness, barking cough, inspiratory stridor that worsens with crying, and frontal airway radiograph showing subglottic narrowing (steeple sign). What is the best step in management?",
    },
    993230: {
        "prompt": "What is the mechanism of the most common CFTR mutation in cystic fibrosis?",
        "narrative": "An 11-month-old boy has recurrent cough and wheezing, diarrhea, neonatal meconium ileus, elevated sweat chloride, and genetic testing confirming cystic fibrosis. Which mechanism is associated with the most common mutation causing this disorder?",
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
            "prompt_recovered_from_narrative",
            "orphan_linebreak_fixed",
        },
    )
    meta["avg_option_length"] = compute_avg_option_length(updated.get("options") or [])
    meta["readability_ai_pass"] = True
    meta["readability_ai_pass_basis"] = BASIS
    meta["pedmedqa_release_at"] = timestamp
    with_quality_flag(meta, "pedmedqa_repaired")
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
