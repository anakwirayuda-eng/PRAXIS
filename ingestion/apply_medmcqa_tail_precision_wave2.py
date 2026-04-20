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
REPORT_FILE = ROOT / "ingestion" / "output" / "medmcqa_tail_precision_wave2_report.json"
BASIS = "deterministic:medmcqa-tail-precision-wave2"

FIXES: dict[int, dict[str, Any]] = {
    30938: {
        "playbook": "truncated_text_recovery",
        "prompt": "What is the most likely diagnosis?",
        "narrative": (
            "A young patient presents with headache, epiphora, and bilateral nasal obstruction without fever. "
            "What is the most likely diagnosis?"
        ),
        "rationale": (
            "Juvenile angiofibroma is the best answer because it classically presents in young patients with nasal obstruction "
            "and epistaxis-related symptoms from a vascular nasopharyngeal mass. The alternatives are less consistent with "
            "this presentation."
        ),
        "notes": "Expanded the minimal stem into a complete diagnosis question and released the false-positive truncated/dissonance hold.",
    },
    38528: {
        "playbook": "clinical_rewrite",
        "prompt": "According to McKeown's theory, the decline in tuberculosis prevalence is primarily attributed to which of the following?",
        "narrative": "According to McKeown's theory, the decline in tuberculosis prevalence is primarily attributed to which of the following?",
        "options": [
            {"id": "A", "text": "Enhanced knowledge and awareness", "is_correct": False},
            {"id": "B", "text": "Medical advancements", "is_correct": False},
            {"id": "C", "text": "Behavioural modification", "is_correct": False},
            {"id": "D", "text": "Social and environmental factors", "is_correct": True},
        ],
        "rationale": (
            "McKeown argued that the long-term decline in tuberculosis was driven mainly by broad social and environmental "
            "improvements, especially better nutrition and living conditions, rather than by direct medical treatment."
        ),
        "notes": "Corrected the misspelled stem and aligned the answer key with the existing rationale.",
    },
    3289: {
        "playbook": "answer_key_adjudication",
        "prompt": "Which vitamin acts as a hormone?",
        "narrative": "Which vitamin acts as a hormone?",
        "options": [
            {"id": "A", "text": "Vitamin A", "is_correct": False},
            {"id": "B", "text": "Vitamin C", "is_correct": False},
            {"id": "C", "text": "Vitamin D", "is_correct": True},
            {"id": "D", "text": "Vitamin E", "is_correct": False},
        ],
        "rationale": (
            "Vitamin D is the best answer because it functions as a secosteroid hormone, regulating calcium and phosphate "
            "homeostasis through endocrine signaling."
        ),
        "notes": "Recovered the lost option texts from the existing answer-key rationale.",
    },
    29161: {
        "playbook": "image_context_recovery",
        "prompt": "Which osteoporosis drug is most likely being described?",
        "narrative": (
            "A drug used in osteoporosis acts by binding RANK ligand and inhibiting osteoclast activation. "
            "Which osteoporosis drug is most likely being described?"
        ),
        "rationale": (
            "Denosumab is the correct answer because it is a monoclonal antibody against RANK ligand, thereby reducing "
            "osteoclast formation and bone resorption."
        ),
        "notes": "Detached the missing figure by rewriting the stem around the mechanism already stated in the rationale.",
    },
    32757: {
        "playbook": "image_context_recovery",
        "prompt": "What is the cardiac rhythm?",
        "narrative": (
            "A 70-year-old man presents with dyspnea, orthopnea, and paroxysmal nocturnal dyspnea. "
            "The ECG shows a regular narrow-complex tachycardia at about 150/min with flutter waves and 2:1 atrioventricular conduction. "
            "What is the cardiac rhythm?"
        ),
        "rationale": (
            "Atrial flutter with 2:1 atrioventricular conduction is the best answer because the tracing is described as a "
            "regular narrow-complex tachycardia near 150/min with visible flutter waves."
        ),
        "notes": "Recovered the missing ECG context from the existing rationale so the question is self-contained.",
    },
    37645: {
        "playbook": "image_context_recovery",
        "prompt": "This reaction is most likely due to which drug?",
        "narrative": (
            "A patient previously received radiotherapy for head and neck cancer. Six months later, chemotherapy is started, "
            "and the patient develops an acute inflammatory reaction confined to the previously irradiated area, consistent with "
            "radiation recall syndrome. This reaction is most likely due to which drug?"
        ),
        "rationale": (
            "Doxorubicin is the best answer because anthracyclines are classic triggers of radiation recall syndrome in "
            "previously irradiated tissue."
        ),
        "notes": "Removed the missing figure dependency by stating the syndrome explicitly in the stem.",
    },
    43951: {
        "playbook": "image_context_recovery",
        "prompt": "Which of the following surgical procedures is most likely to cause her current anemia?",
        "narrative": (
            "A 94-year-old female nursing home resident is referred for evaluation of anemia with hemoglobin 8 g/dL. "
            "She has dementia, a well-healed midline abdominal scar, and a peripheral blood film showing macrocytosis with "
            "hypersegmented neutrophils. Which of the following surgical procedures is most likely to cause her current anemia?"
        ),
        "rationale": (
            "Gastrectomy is the correct answer because loss of intrinsic factor can lead to vitamin B12 deficiency and "
            "megaloblastic anemia with macrocytosis and hypersegmented neutrophils."
        ),
        "notes": "Replaced the missing blood-film image with the hematologic description already supported by the rationale.",
    },
    8232: {
        "playbook": "clinical_rewrite",
        "prompt": "Occipital lobe tumors may produce which of the following visual field defects?",
        "narrative": "Occipital lobe tumors may produce which of the following visual field defects?",
        "options": [
            {"id": "A", "text": "Crossed homonymous quadrantanopia", "is_correct": False},
            {"id": "B", "text": "Crossed homonymous hemianopia", "is_correct": False},
            {"id": "C", "text": "Either crossed homonymous quadrantanopia or crossed homonymous hemianopia, depending on lesion extent", "is_correct": True},
            {"id": "D", "text": "Neither visual field defect is typical of an occipital lobe tumor", "is_correct": False},
        ],
        "rationale": (
            "Option C is the best answer because occipital lobe tumors can cause either crossed homonymous quadrantanopia "
            "or crossed homonymous hemianopia depending on the size and location of the lesion."
        ),
        "notes": "Replaced the 'both of the above' trap with an explicit combined statement.",
    },
    37457: {
        "playbook": "clinical_rewrite",
        "prompt": "Which of the following describes the pathognomonic features of a trachoma follicle?",
        "narrative": "Which of the following describes the pathognomonic features of a trachoma follicle?",
        "options": [
            {"id": "A", "text": "Presence of Leber's cells", "is_correct": False},
            {"id": "B", "text": "Areas of necrosis", "is_correct": False},
            {"id": "C", "text": "Presence of Leber's cells together with areas of necrosis", "is_correct": True},
            {"id": "D", "text": "Neither of these findings is characteristic", "is_correct": False},
        ],
        "rationale": (
            "The best answer is the combined option because trachoma follicles are characterized by Leber's cells together "
            "with areas of necrosis."
        ),
        "notes": "Replaced the 'both of the above' trap with the explicit pathognomonic combination.",
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
            connection.execute("DELETE FROM case_options WHERE case_id = ?", (case_data["_id"],))
            for sort_order, option in enumerate(options):
                connection.execute(
                    """
                    INSERT INTO case_options (case_id, option_id, sort_order, option_text, is_correct)
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    (
                        case_data["_id"],
                        str(option.get("id") or chr(65 + sort_order)),
                        sort_order,
                        str(option.get("text") or ""),
                        1 if option.get("is_correct") is True else 0,
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
        item["validation"] = updated.get("validation")
        item["options"] = updated.get("options")


def ensure_quality_flag(meta: dict[str, Any], flag: str) -> None:
    flags = meta.get("quality_flags")
    if not isinstance(flags, list):
        flags = []
    if flag not in flags:
        flags.append(flag)
    meta["quality_flags"] = flags


def clear_hold_flags(meta: dict[str, Any]) -> None:
    for key in (
        "readability_ai_hold",
        "readability_ai_hold_basis",
        "readability_ai_hold_at",
        "readability_ai_hold_reasoning",
        "readability_ai_hold_notes",
    ):
        meta.pop(key, None)


def clear_review_flags(meta: dict[str, Any]) -> None:
    meta["needs_review"] = False
    for key in ("needs_review_reason", "needs_review_reasons", "review_queue"):
        meta.pop(key, None)


def clear_quarantine_flags(meta: dict[str, Any]) -> None:
    meta["quarantined"] = False
    meta["truncated"] = False
    for key in ("status", "quarantine_reason", "radar_tokens"):
        meta.pop(key, None)


def set_readability_pass(meta: dict[str, Any], now: str, rationale: str, notes: str, answer_anchor: str, playbook: str) -> None:
    meta["review_confidence"] = "HIGH"
    meta["review_source"] = BASIS
    meta["reviewed_at"] = now
    meta["reviewed"] = True
    meta["ai_audited"] = True
    meta["readability_ai_batch"] = BASIS
    meta["readability_ai_playbook"] = playbook
    meta["readability_ai_pass"] = True
    meta["readability_ai_basis"] = BASIS
    meta["readability_ai_pass_at"] = now
    meta["review_rationale"] = rationale
    meta["readability_ai_rewrite_notes"] = notes
    meta["answer_anchor_text"] = answer_anchor


def apply_fix(case_data: dict[str, Any], fix: dict[str, Any], now: str) -> dict[str, Any]:
    updated = deepcopy(case_data)
    meta = updated.setdefault("meta", {})

    prompt = normalize_text(fix["prompt"])
    narrative = normalize_text(fix["narrative"])
    updated["prompt"] = prompt
    updated["title"] = prompt

    vignette = updated.get("vignette")
    if not isinstance(vignette, dict):
        vignette = {}
        updated["vignette"] = vignette
    vignette["narrative"] = narrative

    if "options" in fix:
        updated["options"] = [
            {
                "id": option["id"],
                "text": normalize_text(option["text"]),
                "is_correct": option["is_correct"] is True,
            }
            for option in fix["options"]
        ]

    rationale = updated.get("rationale")
    if not isinstance(rationale, dict):
        rationale = {"correct": "", "distractors": {}, "pearl": ""}
        updated["rationale"] = rationale
    rationale["correct"] = normalize_text(fix["rationale"])
    if not isinstance(rationale.get("distractors"), dict):
        rationale["distractors"] = {}
    if not isinstance(rationale.get("pearl"), str):
        rationale["pearl"] = ""

    clear_hold_flags(meta)
    clear_review_flags(meta)
    clear_quarantine_flags(meta)

    meta["option_count"] = len(updated.get("options") or [])
    meta["avg_option_length"] = compute_avg_option_length(updated.get("options") or [])
    answer_anchor = rebuild_answer_anchor_text(updated.get("options") or [])
    set_readability_pass(meta, now, normalize_text(fix["rationale"]), fix["notes"], answer_anchor, fix["playbook"])
    ensure_quality_flag(meta, "medmcqa_tail_precision_wave2")
    return updated


def main() -> None:
    connection = sqlite3.connect(DB_FILE)
    connection.row_factory = sqlite3.Row
    try:
        case_map = load_case_rows(connection, list(FIXES))
        json_cases = read_json(JSON_FILE, [])
        now = datetime.now(timezone.utc).isoformat()

        changed_cases: dict[int, dict[str, Any]] = {}
        report: dict[str, Any] = {
            "generated_at": now,
            "target_source": "medmcqa",
            "changed_cases": 0,
            "samples": [],
        }

        for case_id, fix in FIXES.items():
            current = case_map.get(case_id)
            if current is None:
                continue
            updated = apply_fix(current, fix, now)
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

        print("MEDMCQA TAIL PRECISION WAVE2")
        print(f"  Changed cases:  {report['changed_cases']:,}")
        print(f"  Report:         {REPORT_FILE}")
    finally:
        connection.close()


if __name__ == "__main__":
    main()
