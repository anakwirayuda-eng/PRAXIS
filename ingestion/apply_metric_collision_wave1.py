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
REPORT_FILE = ROOT / "ingestion" / "output" / "metric_collision_wave1_report.json"
BASIS = "deterministic:metric-collision-wave1"


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
    68089: {
        "prompt": "Apa penyebab anemia yang paling mungkin pada pasien ini?",
        "title": "Apa penyebab anemia yang paling mungkin pada pasien ini?",
        "rationale": (
            "Defisiensi eritropoietin adalah jawaban terbaik. Riwayat diabetes lama, sesak dengan edema, kreatinin tinggi, "
            "dan anemia mengarah ke penyakit ginjal kronik; pada kondisi ini produksi eritropoietin ginjal menurun sehingga "
            "terjadi anemia normositik normokrom. Defisiensi besi, hemolisis, dan gangguan globin tidak menjadi mekanisme "
            "paling spesifik dari vignette ini."
        ),
        "notes": "Released reviewed unit collision and promoted the real question over the generic prompt.",
    },
    68342: {
        "prompt": "Kondisi asam-basa yang paling tepat pada pasien ini adalah:",
        "title": "Kondisi asam-basa yang paling tepat pada pasien ini adalah:",
        "replace": [
            ["HCO3 - 20 mM", "HCO3- 10 mEq/L"],
            ["pCO2 40 mm Hg", "pCO2 40 mm Hg"],
            ["TD 90/60 mmHg", "TD 90/60 mm Hg"],
        ],
        "rationale": (
            "Asidosis metabolik belum terkompensasi adalah jawaban terbaik. pH 7,05 menunjukkan asidemia dan HCO3- yang "
            "rendah menunjukkan komponen metabolik. pCO2 sekitar 40 mm Hg belum menurun sebagaimana kompensasi respiratorik "
            "yang diharapkan, sehingga gambaran ini paling sesuai dengan asidosis metabolik yang belum terkompensasi."
        ),
        "notes": "Corrected the internally inconsistent bicarbonate value and normalized blood-pressure units.",
    },
    17913: {
        "prompt": "Which of the following is the most likely explanation for this patient's laboratory changes?",
        "replace": [["changes?\"", "changes?"]],
        "rationale": (
            "Accumulation of NADH is the best answer. Cardiogenic shock from an acute myocardial infarction causes tissue "
            "hypoperfusion and anaerobic metabolism. Pyruvate is reduced to lactate, regenerating NAD+ from NADH, which "
            "explains the lactic acidosis and low bicarbonate."
        ),
        "notes": "Removed stray quote artifact and reviewed legitimate mixed laboratory units.",
    },
    18070: {
        "prompt": "Which of the following is the most likely diagnosis?",
        "title": "Which of the following is the most likely diagnosis?",
        "rationale": (
            "Acute pancreatitis is the best answer because the patient has severe epigastric pain radiating to the back, "
            "elevated lipase, and marked hypertriglyceridemia. Gallstone disease and heavy alcohol use are not supported, "
            "and vascular catastrophes such as SMA embolism or abdominal aortic aneurysm do not fit the laboratory pattern."
        ),
        "notes": "Replaced unrelated pancreatitis-sign rationale with a direct diagnosis explanation.",
    },
    20102: {
        "rationale": (
            "The zone closest to the central vein, zone 3, is the best answer. Centrilobular hepatocytes have relatively lower "
            "oxygen tension and higher cytochrome P450 activity, making them vulnerable to ischemic and toxic injury. This "
            "matches liver dysfunction in a patient with metabolic risk factors and decompensated chronic liver disease."
        ),
        "notes": "Reviewed legitimate laboratory units and tightened the zone 3 rationale.",
    },
    23403: {
        "options": [
            {"id": "A", "text": "Na+ 137 mEq/L", "is_correct": False},
            {"id": "B", "text": "K+ 2.6 mEq/L", "is_correct": False},
            {"id": "C", "text": "Plasma triglycerides 230 mg/dL (2.6 mmol/L)", "is_correct": True},
            {"id": "D", "text": "Na+ 148 mEq/L", "is_correct": False},
        ],
        "rationale": (
            "An increase in triglycerides is the best answer. Traditional beta-blockers such as atenolol can adversely affect "
            "lipid metabolism, most classically by increasing triglycerides and lowering HDL cholesterol. Atenolol is not a "
            "typical cause of marked hypokalemia or clinically meaningful sodium shifts."
        ),
        "notes": "Corrected the answer key and option text for atenolol's expected metabolic effect.",
    },
    23483: {
        "prompt": (
            "The lab test results are as follows: Blood urea nitrogen 12 mg/dL, serum creatinine 1.1 mg/dL, random serum "
            "glucose 88 mg/dL, chloride 107 mmol/L, potassium 4.5 mEq/L, sodium 140 mEq/L, calcium 10.9 mg/dL, albumin "
            "4.4 g/dL, PTH 70 pg/mL (normal 10-65), and 24-hour urinary calcium 85 mg/day (normal 100-300). Which of the "
            "following is the next best step in management?"
        ),
        "title": "Which of the following is the next best step in management?",
        "narrative": (
            "A 20-year-old woman visits the clinic for her annual physical examination. She has no complaints. Her past "
            "medical history is unremarkable, and she does not take medications. Her family history is significant for a "
            "grandfather and uncle who had parathyroid glands removed. Vital signs and physical examination are normal. "
            "Laboratory testing shows blood urea nitrogen 12 mg/dL, serum creatinine 1.1 mg/dL, random serum glucose "
            "88 mg/dL, chloride 107 mmol/L, potassium 4.5 mEq/L, sodium 140 mEq/L, calcium 10.9 mg/dL, albumin 4.4 g/dL, "
            "PTH 70 pg/mL (normal 10-65), and 24-hour urinary calcium 85 mg/day (normal 100-300). Which of the following "
            "is the next best step in management?"
        ),
        "rationale": (
            "No treatment is necessary because the findings are most consistent with familial hypocalciuric hypercalcemia: "
            "mild hypercalcemia, nonsuppressed PTH, low urinary calcium excretion, and a family history suggesting prior "
            "unhelpful parathyroid surgery. Familial hypocalciuric hypercalcemia is usually benign and is managed with "
            "reassurance rather than IV fluids, bisphosphonates, glucocorticoids, or parathyroidectomy."
        ),
        "notes": "Corrected impossible calcium units/value and rewrote the rationale around FHH.",
    },
    24247: {
        "rationale": (
            "Cyanide poisoning is the best answer. Smoke inhalation in a closed-space fire can expose patients to cyanide, "
            "which blocks oxidative phosphorylation and causes histotoxic hypoxia with severe lactic acidosis despite a "
            "normal arterial oxygen tension. Carbon monoxide poisoning can also occur in fires, but the markedly elevated "
            "lactate points strongly toward cyanide toxicity."
        ),
        "notes": "Replaced unrelated alcohol-intoxication rationale with smoke-inhalation/cyanide explanation.",
    },
    25578: {
        "replace": [["95/60 mmHg", "95/60 mm Hg"]],
        "notes": "Reviewed ARDS ventilator unit collision and normalized blood-pressure formatting.",
    },
    26258: {
        "replace": [["160/80 mmHg", "160/80 mm Hg"], ["170/80 mmHg", "170/80 mm Hg"]],
        "notes": "Reviewed isolated systolic hypertension unit collision and normalized blood-pressure formatting.",
    },
    27111: {
        "replace": [["145/95 mm Hg", "145/95 mm Hg"]],
        "rationale": (
            "Amlodipine is the best answer. Dihydropyridine calcium-channel blockers preferentially dilate precapillary "
            "arterioles, which can increase hydrostatic pressure in capillary beds and cause bilateral dependent peripheral "
            "edema despite otherwise normal laboratory studies."
        ),
        "notes": "Replaced contaminated perioperative-diabetes rationale with amlodipine edema explanation.",
    },
    27257: {
        "replace": [["100/60 mmHg", "100/60 mm Hg"], ["82/50 mm hg", "82/50 mm Hg"]],
        "notes": "Reviewed trauma/shock unit collision and normalized blood-pressure formatting.",
    },
    27561: {
        "notes": "Reviewed broad laboratory panel; unit variety is legitimate and does not reflect a readability defect.",
    },
    992500: {
        "replace": [["140/50 mmHg", "140/50 mm Hg"]],
        "notes": "Reviewed Marfan/aortic regurgitation unit collision and normalized blood-pressure formatting.",
    },
    993788: {
        "replace": [["pO2 52 mmHg", "pO2 52 mm Hg"]],
        "notes": "Reviewed neonatal diaphragmatic hernia blood gas units and normalized oxygen-pressure formatting.",
    },
    47296: {
        "replace": [["140/90 mmHg", "140/90 mm Hg"]],
        "notes": "Reviewed PubMedQA abstract units and normalized blood-pressure formatting.",
    },
    62954: {
        "options": [
            {"id": "-2", "text": "Sangat menyingkirkan", "is_correct": True},
            {"id": "-1", "text": "Menyingkirkan", "is_correct": False},
            {"id": "0", "text": "Tidak berpengaruh", "is_correct": False},
            {"id": "+1", "text": "Mendukung", "is_correct": False},
            {"id": "+2", "text": "Sangat mendukung", "is_correct": False},
        ],
        "rationale": (
            "Temuan ekokardiografi berupa stenosis mitral dengan gradien diastolik dan regurgitasi mitral sangat "
            "menyingkirkan hipotesis aortic valve insufficiency. Bukti baru tersebut lebih kuat mendukung kelainan katup "
            "mitral daripada insufisiensi katup aorta."
        ),
        "notes": "Fixed inverted SCT answer key: mitral-valve evidence rules out the aortic-insufficiency hypothesis.",
    },
    55622: {
        "replace": [["210/110 mmHg", "210/110 mm Hg"]],
        "notes": "Reviewed hemorrhagic-stroke initial fluid item and normalized blood-pressure formatting.",
    },
    951133: {
        "replace": [["160/90 mmHg", "160/90 mm Hg"]],
        "notes": "Reviewed CKD-anemia unit collision and normalized blood-pressure formatting.",
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


def apply_replacements(updated: dict[str, Any], replacements: list[list[str]]) -> None:
    targets: list[tuple[dict[str, Any], str]] = [(updated, "title"), (updated, "prompt")]
    vignette = updated.get("vignette")
    if isinstance(vignette, dict):
        targets.append((vignette, "narrative"))
    rationale = updated.get("rationale")
    if isinstance(rationale, dict):
        targets.extend((rationale, key) for key in ("correct", "pearl") if key in rationale)
        distractors = rationale.get("distractors")
        if isinstance(distractors, dict):
            targets.extend((distractors, key) for key in list(distractors))

    for container, key in targets:
        value = container.get(key)
        if not isinstance(value, str):
            continue
        text = value
        for old, new in replacements:
            text = text.replace(old, new)
        container[key] = text


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

    if fix.get("options"):
        updated["options"] = deepcopy(fix["options"])

    if fix.get("rationale"):
        rationale = ensure_rationale_dict(updated)
        rationale["correct"] = normalize_text(fix["rationale"])
        updated["rationale"] = rationale

    if fix.get("replace"):
        apply_replacements(updated, fix["replace"])

    meta = deepcopy(updated.get("meta") or {})
    meta["metric_collision_reviewed"] = True
    meta["metric_collision_reviewed_at"] = timestamp
    meta["metric_collision_review_basis"] = BASIS
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
    with_quality_flag(meta, "metric_collision_reviewed")
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
