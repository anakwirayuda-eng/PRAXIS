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
REPORT_FILE = ROOT / "ingestion" / "output" / "medmcqa_residual_wave4_report.json"
BASIS = "micro-editorial:medmcqa-wave4"


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
    11540: {
        "playbook": "answer_key_reframe",
        "prompt": "Which nutrient is present in breast milk but often in low concentration relative to infant requirements?",
        "narrative": (
            "Human breast milk contains many micronutrients. Which nutrient is present in breast milk "
            "but is often too low to meet an infant's full daily requirement without supplementation?"
        ),
        "options": [
            {"id": "A", "text": "Iron", "is_correct": False},
            {"id": "B", "text": "Vitamin A", "is_correct": False},
            {"id": "C", "text": "Vitamin D", "is_correct": True},
            {"id": "D", "text": "Vitamin C", "is_correct": False},
        ],
        "rationale": (
            "Vitamin D is the best answer because it is present in human milk but usually in low concentration, "
            "which is why breastfed infants commonly need vitamin D supplementation. Iron, vitamin A, and vitamin C "
            "are also present in breast milk."
        ),
        "notes": "Reframed the outdated absent-in-milk stem into a supported vitamin D sufficiency question.",
    },
    41200: {
        "playbook": "image_detach_rewrite",
        "prompt": (
            "A screening mammogram in a 45-year-old woman shows an irregular spiculated mass with clustered "
            "microcalcifications and architectural distortion. These findings are most suggestive of:"
        ),
        "narrative": (
            "A 45-year-old woman undergoes screening mammography. The study shows an irregular spiculated mass "
            "with clustered microcalcifications and architectural distortion. These findings are most suggestive of:"
        ),
        "options": [
            {"id": "A", "text": "Benign lesion", "is_correct": False},
            {"id": "B", "text": "Malignant lesion", "is_correct": True},
            {"id": "C", "text": "Indeterminate lesion", "is_correct": False},
            {"id": "D", "text": "Normal variant", "is_correct": False},
        ],
        "rationale": (
            "A malignant lesion is the best answer because irregular or spiculated margins, suspicious "
            "microcalcifications, and architectural distortion are classic mammographic features of malignancy."
        ),
        "notes": "Detached the missing mammography image by encoding the malignant descriptors directly in the stem.",
    },
    35719: {
        "playbook": "association_cleanup",
        "prompt": (
            "Which additional association is more characteristic of dense deposit disease (MPGN type II) "
            "than of type I membranoproliferative glomerulonephritis?"
        ),
        "narrative": (
            "Type I membranoproliferative glomerulonephritis is classically associated with conditions such as "
            "systemic lupus erythematosus, persistent hepatitis C infection, and some neoplastic disorders. "
            "Which additional association below is more characteristic of dense deposit disease (MPGN type II) "
            "than of type I disease?"
        ),
        "options": [
            {"id": "A", "text": "Systemic lupus erythematosus", "is_correct": False},
            {"id": "B", "text": "Persistent hepatitis C infection", "is_correct": False},
            {"id": "C", "text": "Partial lipodystrophy", "is_correct": True},
            {"id": "D", "text": "Neoplastic diseases", "is_correct": False},
        ],
        "rationale": (
            "Partial lipodystrophy is the best answer because it is classically linked to dense deposit disease "
            "(MPGN type II), whereas SLE, persistent hepatitis C infection, and some neoplastic disorders are more "
            "typical associations of type I MPGN."
        ),
        "notes": "Removed the awkward except-style phrasing and anchored the distinction to type II MPGN.",
    },
    41535: {
        "playbook": "interaction_cleanup",
        "prompt": "Among the following concomitant drugs, which is most likely to increase ciprofloxacin-related seizure risk?",
        "narrative": (
            "Fluoroquinolones can lower the seizure threshold. Among the following concomitant drugs, which is most "
            "likely to increase ciprofloxacin-related seizure risk?"
        ),
        "options": [
            {"id": "A", "text": "Nifedipine", "is_correct": False},
            {"id": "B", "text": "Corticosteroids", "is_correct": False},
            {"id": "C", "text": "Aspirin", "is_correct": True},
            {"id": "D", "text": "Metformin", "is_correct": False},
        ],
        "rationale": (
            "Aspirin is the best answer because quinolones can have pro-convulsant CNS effects, and this risk is "
            "classically worsened by concomitant NSAIDs. Among these options, aspirin is the only NSAID."
        ),
        "notes": "Converted the vague concomitant-drug item into a focused NSAID interaction question.",
    },
    13814: {
        "playbook": "histology_reconstruction",
        "prompt": "Interglobular dentin is best described as:",
        "narrative": "Interglobular dentin is best described as:",
        "options": [
            {
                "id": "A",
                "text": "A hypomineralized dentin area caused by failure of calcospherites to fuse",
                "is_correct": True,
            },
            {"id": "B", "text": "A PAS-positive zone of unmineralized predentin", "is_correct": False},
            {"id": "C", "text": "A hypermineralized line at the dentinoenamel junction", "is_correct": False},
            {"id": "D", "text": "Normal peritubular dentin", "is_correct": False},
        ],
        "rationale": (
            "Interglobular dentin is the best answer because it represents poorly mineralized or hypomineralized "
            "dentin formed when mineralization globules fail to fuse completely."
        ),
        "notes": "Replaced the placeholder both/none options with a single supported histology definition.",
    },
    45195: {
        "playbook": "microbiology_reconstruction",
        "prompt": "Which of the following organisms is commonly reported in acute apical abscesses?",
        "narrative": "Which of the following organisms is commonly reported in acute apical abscesses?",
        "options": [
            {"id": "A", "text": "Streptococcus mutans", "is_correct": False},
            {"id": "B", "text": "Dialister invisus", "is_correct": True},
            {"id": "C", "text": "Enterococcus faecalis", "is_correct": False},
            {"id": "D", "text": "Candida albicans", "is_correct": False},
        ],
        "rationale": (
            "Dialister invisus is the best answer because acute apical abscesses are polymicrobial anaerobic "
            "infections and molecular studies report Dialister invisus among the common organisms isolated in this "
            "setting. Enterococcus faecalis is more characteristic of persistent secondary endodontic infection."
        ),
        "notes": "Rebuilt the option set around organisms that separate acute apical abscess from persistent infection.",
    },
    8616: {
        "playbook": "syndrome_feature_reframe",
        "prompt": "Which finding is the hallmark hearing abnormality in Pendred syndrome?",
        "narrative": "Which finding is the hallmark hearing abnormality in Pendred syndrome?",
        "options": [
            {"id": "A", "text": "Diffuse colloid goitre", "is_correct": False},
            {"id": "B", "text": "Intellectual disability", "is_correct": False},
            {"id": "C", "text": "Bilateral sensorineural deafness", "is_correct": True},
            {"id": "D", "text": "Unilateral conductive hearing loss", "is_correct": False},
        ],
        "rationale": (
            "Bilateral sensorineural deafness is the best answer because Pendred syndrome classically presents with "
            "sensorineural hearing loss and thyroid involvement such as goiter. Intellectual disability is not a "
            "defining feature."
        ),
        "notes": "Removed the all-of-the-above trap and focused the stem on the hallmark otologic feature.",
    },
    28553: {
        "playbook": "dental_term_cleanup",
        "prompt": "Gross linear enamel caries affecting the labial surfaces of anterior maxillary teeth in infancy is called:",
        "narrative": "Gross linear enamel caries affecting the labial surfaces of anterior maxillary teeth in infancy is called:",
        "options": [
            {"id": "A", "text": "Odontoclasia", "is_correct": True},
            {"id": "B", "text": "Occult caries", "is_correct": False},
            {"id": "C", "text": "Fluoride bomb", "is_correct": False},
            {"id": "D", "text": "Pit and fissure caries", "is_correct": False},
        ],
        "rationale": (
            "Odontoclasia is the best answer because it refers to severe destructive linear caries involving the "
            "labial surfaces of the maxillary anterior teeth."
        ),
        "notes": "Kept the original concept but removed the none-of-the-above trap and clarified the stem.",
    },
    12513: {
        "playbook": "terminology_salvage",
        "prompt": "Which of the following conditions can produce a hemorrhagic pleural effusion?",
        "narrative": "Which of the following conditions can produce a hemorrhagic pleural effusion?",
        "options": [
            {"id": "A", "text": "Myxoma", "is_correct": False},
            {"id": "B", "text": "Congestive heart failure", "is_correct": False},
            {"id": "C", "text": "Rheumatoid arthritis", "is_correct": False},
            {"id": "D", "text": "Uremia", "is_correct": True},
        ],
        "rationale": (
            "Uremia is the best answer because uremic pleuritis can produce a hemorrhagic pleural effusion, "
            "especially in advanced kidney disease or dialysis patients."
        ),
        "notes": "Converted the mismatched hemothorax wording into the clinically supported hemorrhagic pleural effusion concept.",
    },
    28690: {
        "playbook": "infection_option_reconstruction",
        "prompt": "Hairy cell leukemia is especially associated with susceptibility to which opportunistic infection?",
        "narrative": "Hairy cell leukemia is especially associated with susceptibility to which opportunistic infection?",
        "options": [
            {"id": "A", "text": "Parvovirus B19 infection", "is_correct": False},
            {"id": "B", "text": "Mycoplasma pneumoniae infection", "is_correct": False},
            {"id": "C", "text": "Mycobacterium avium-intracellulare infection", "is_correct": True},
            {"id": "D", "text": "Salmonella typhi infection", "is_correct": False},
        ],
        "rationale": (
            "Mycobacterium avium-intracellulare infection is the best answer because hairy cell leukemia is associated "
            "with profound monocytopenia and impaired cellular immunity, predisposing patients to atypical "
            "mycobacterial infections."
        ),
        "notes": "Rebuilt the option set around the atypical mycobacterial association already implied by the existing rationale.",
    },
    37196: {
        "playbook": "answer_key_correction",
        "prompt": "Which of the following is a recognized cause of secondary autoimmune hemolytic anemia?",
        "narrative": "Which of the following is a recognized cause of secondary autoimmune hemolytic anemia?",
        "options": [
            {"id": "A", "text": "Chronic lymphocytic leukemia", "is_correct": True},
            {"id": "B", "text": "Idiopathic membranous nephropathy", "is_correct": False},
            {"id": "C", "text": "Sickle cell anemia", "is_correct": False},
            {"id": "D", "text": "Iron deficiency anemia", "is_correct": False},
        ],
        "rationale": (
            "Chronic lymphocytic leukemia is the best answer because secondary autoimmune hemolytic anemia is classically "
            "associated with lymphoproliferative disorders, especially CLL."
        ),
        "notes": "Corrected the answer key and removed the spurious membranous-nephropathy linkage.",
    },
    13243: {
        "playbook": "sequence_reconstruction",
        "prompt": "In the WHO hand-washing sequence, which step follows palm-to-palm rubbing with fingers interlaced?",
        "narrative": "In the WHO hand-washing sequence, which step follows palm-to-palm rubbing with fingers interlaced?",
        "options": [
            {
                "id": "A",
                "text": "Rub backs of fingers to opposing palms with fingers interlocked",
                "is_correct": True,
            },
            {"id": "B", "text": "Rinse hands under running water", "is_correct": False},
            {"id": "C", "text": "Dry hands with a single-use towel", "is_correct": False},
            {"id": "D", "text": "Turn off the tap", "is_correct": False},
        ],
        "rationale": (
            "In the WHO hand-hygiene technique, palm-to-palm rubbing with fingers interlaced is followed by rubbing "
            "the backs of fingers to opposing palms with fingers interlocked."
        ),
        "notes": "Replaced the missing letter-only sequence item with an explicit WHO hand-hygiene step question.",
    },
    1864: {
        "playbook": "time_anchor_rewrite",
        "prompt": "The 2006 Nobel Prize in Physiology or Medicine recognized discoveries related to:",
        "narrative": "The 2006 Nobel Prize in Physiology or Medicine recognized discoveries related to:",
        "options": [
            {"id": "A", "text": "RNA interference", "is_correct": True},
            {"id": "B", "text": "Lipoxins", "is_correct": False},
            {"id": "C", "text": "T-beta transcription factor", "is_correct": False},
            {"id": "D", "text": "Mitochondrial DNA", "is_correct": False},
        ],
        "rationale": (
            "RNA interference is the best answer because the 2006 Nobel Prize in Physiology or Medicine was awarded "
            "to Andrew Fire and Craig Mello for the discovery of RNA interference."
        ),
        "notes": "Anchored the vague recent Nobel prompt to the specific 2006 award.",
    },
    31277: {
        "playbook": "image_free_reconstruction",
        "prompt": "Which ascending tract carries pain and temperature sensation to the thalamus?",
        "narrative": "Which ascending tract carries pain and temperature sensation to the thalamus?",
        "options": [
            {"id": "A", "text": "Spinothalamic tract", "is_correct": True},
            {"id": "B", "text": "Spinocerebellar tract", "is_correct": False},
            {"id": "C", "text": "Corticospinal tract", "is_correct": False},
            {"id": "D", "text": "Dorsal column-medial lemniscus pathway", "is_correct": False},
        ],
        "rationale": (
            "Pain and temperature ascend mainly in the spinothalamic tract, especially the lateral spinothalamic tract, "
            "toward the ventral posterolateral nucleus of the thalamus."
        ),
        "notes": "Removed the missing labeled image and rebuilt the question around the underlying neuroanatomy concept.",
    },
    45914: {
        "playbook": "distractor_cleanup",
        "prompt": "Which pontic design best preserves the papilla in a fresh extraction socket?",
        "narrative": (
            "Immediately after tooth extraction, which pontic design best preserves the papilla by extending into the "
            "healing socket and maintaining the contact point and embrasure support?"
        ),
        "options": [
            {"id": "A", "text": "Ovate pontic", "is_correct": True},
            {"id": "B", "text": "Modified ridge lap pontic", "is_correct": False},
            {"id": "C", "text": "Sanitary pontic", "is_correct": False},
            {"id": "D", "text": "Conical pontic", "is_correct": False},
        ],
        "rationale": (
            "Ovate pontics are used when the ridge is defective or incompletely healed, and they help preserve the "
            "papilla by extending into the extraction socket."
        ),
        "notes": "Removed the none-of-the-above option that kept retriggering ambiguity heuristics.",
    },
    6505: {
        "playbook": "distractor_cleanup",
        "prompt": "Which finding most strongly supports a diagnosis of hanging?",
        "narrative": "Which finding most strongly supports a diagnosis of hanging?",
        "options": [
            {"id": "A", "text": "Fracture of the hyoid cartilage", "is_correct": False},
            {"id": "B", "text": "Fracture of the thyroid cartilage", "is_correct": False},
            {"id": "C", "text": "Dribbling or staining of saliva", "is_correct": True},
            {"id": "D", "text": "Cervical vertebral fracture", "is_correct": False},
        ],
        "rationale": (
            "Dribbling or staining of saliva is the best answer because it is a classic external sign supporting "
            "ante-mortem hanging."
        ),
        "notes": "Removed the all-of-the-above distractor that was still retriggering AOTA heuristics.",
    },
    35017: {
        "playbook": "placeholder_option_reconstruction",
        "prompt": "Which of the following is most strongly associated with increased infant mortality?",
        "narrative": "Which of the following is most strongly associated with increased infant mortality?",
        "options": [
            {"id": "A", "text": "Low birth weight", "is_correct": True},
            {"id": "B", "text": "Injury", "is_correct": False},
            {"id": "C", "text": "Upper respiratory tract infection", "is_correct": False},
            {"id": "D", "text": "Tetanus", "is_correct": False},
        ],
        "rationale": (
            "Low birth weight is the best answer because it is one of the strongest determinants of infant mortality, "
            "closely linked to prematurity, infection, and neonatal complications."
        ),
        "notes": "Replaced the placeholder option text and corrected the mortality concept to the supported LBW risk factor.",
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
        updated["prompt"] = normalize_text(fix["prompt"])
        updated["title"] = normalize_text(fix["prompt"])

        vignette = updated.get("vignette")
        if isinstance(vignette, dict):
            vignette["narrative"] = normalize_text(fix["narrative"])
        else:
            updated["vignette"] = {"narrative": normalize_text(fix["narrative"])}

        updated["options"] = deepcopy(fix["options"])

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
