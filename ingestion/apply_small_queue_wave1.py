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
REPORT_FILE = ROOT / "ingestion" / "output" / "small_queue_wave1_report.json"
BASIS = "deterministic:small-queue-wave1"


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
    63815: {
        "lane": "batch_salvage",
        "playbook": "image_detach_allergy",
        "prompt": (
            "Seorang pria 30 tahun mengalami biduran gatal dan rasa panas mendadak setelah minum alkohol "
            "serta makan makanan laut. Tidak ada sesak napas, mengi, hipotensi, atau angioedema. "
            "Pernyataan mana yang paling tidak tepat?"
        ),
        "narrative": (
            "Seorang pria 30 tahun mengalami biduran gatal dan rasa panas mendadak setelah minum alkohol "
            "serta makan makanan laut. Tidak ada sesak napas, mengi, hipotensi, atau angioedema. "
            "Pernyataan mana yang paling tidak tepat?"
        ),
        "options": [
            {
                "id": "A",
                "text": "Diagnosis yang mungkin adalah urtikaria akut akibat reaksi alergi.",
                "is_correct": False,
            },
            {
                "id": "B",
                "text": "Antihistamin H1 dapat diberikan untuk mengurangi gatal dan wheal.",
                "is_correct": False,
            },
            {
                "id": "C",
                "text": "Kortikosteroid oral dapat dipertimbangkan sebagai terapi tambahan pada gejala berat atau persisten.",
                "is_correct": False,
            },
            {
                "id": "D",
                "text": "Antagonis reseptor H2 seperti ranitidin sebaiknya dipakai sebagai terapi utama tunggal.",
                "is_correct": True,
            },
        ],
        "rationale": (
            "Pernyataan D paling tidak tepat. Pada urtikaria akut, antihistamin H1 adalah terapi simptomatik utama "
            "untuk keluhan kulit. Antagonis H2 dapat dipakai sebagai tambahan pada sebagian skenario, tetapi bukan "
            "terapi utama tunggal dan tidak menggantikan penilaian anafilaksis maupun epinefrin bila ada gejala sistemik."
        ),
        "notes": "Removed missing-image dependency and softened the absolute H2-blocker claim.",
    },
    970024: {
        "lane": "batch_salvage",
        "playbook": "stale_truncated_release",
        "prompt": (
            "Among the following anti-ulcer agents, which one inhibits cytochrome P450 enzymes at therapeutic concentrations?"
        ),
        "narrative": (
            "Among the following anti-ulcer agents, which one inhibits cytochrome P450 enzymes at therapeutic concentrations?"
        ),
        "rationale": (
            "Cimetidine is the best answer because, among H2-receptor antagonists, it is clinically notable for inhibiting "
            "several cytochrome P450 enzymes and causing drug interactions. Nizatidine, ranitidine, famotidine, and "
            "sucralfate do not share this interaction profile to the same extent."
        ),
        "notes": "Content was complete; released stale truncated flag and made the stem self-contained.",
    },
    970404: {
        "lane": "batch_salvage",
        "playbook": "ambiguity_remove_distractor",
        "prompt": "Among the following medications, which one is not classically associated with torsades de pointes?",
        "narrative": "Among the following medications, which one is not classically associated with torsades de pointes?",
        "options": [
            {"id": "A", "text": "Quinidine", "is_correct": False},
            {"id": "B", "text": "Amisulpride", "is_correct": False},
            {"id": "C", "text": "Cisapride", "is_correct": False},
            {"id": "D", "text": "Sotalol", "is_correct": False},
            {"id": "E", "text": "Allopurinol", "is_correct": True},
        ],
        "rationale": (
            "Allopurinol is the best answer because it is a xanthine oxidase inhibitor and is not classically associated "
            "with QT prolongation or torsades de pointes. Quinidine, amisulpride, cisapride, and sotalol are recognized "
            "QT-prolonging or torsadogenic drugs."
        ),
        "notes": "Replaced corticosteroids with a clear torsadogenic distractor to remove dual-answer ambiguity.",
    },
    990062: {
        "lane": "batch_salvage",
        "playbook": "stale_truncated_release",
        "notes": "WorldMedQA item was already readable and self-contained; released stale hold/truncated flags.",
    },
    990070: {
        "lane": "batch_salvage",
        "playbook": "stale_truncated_release",
        "notes": "WorldMedQA item was already readable and self-contained; released stale hold/truncated flags.",
    },
    990076: {
        "lane": "batch_salvage",
        "playbook": "generic_prompt_recovery",
        "prompt": (
            "A 19-year-old military man serving in the Amazon has a painless firm papule on the right hand that "
            "has enlarged over several weeks. What are the most likely diagnosis and treatment?"
        ),
        "title": (
            "A 19-year-old military man serving in the Amazon has a painless firm papule on the right hand that "
            "has enlarged over several weeks. What are the most likely diagnosis and treatment?"
        ),
        "notes": "Recovered the real question from the narrative so the player no longer shows a generic prompt.",
    },
    990199: {
        "lane": "batch_salvage",
        "playbook": "stale_truncated_release",
        "notes": "WorldMedQA item was already readable and self-contained; recalculated option length and released stale hold.",
    },
    991623: {
        "lane": "batch_salvage",
        "playbook": "mechanism_reconstruction",
        "prompt": (
            "Which anti-obesity medication acts primarily by inhibiting gastrointestinal lipases and decreasing intestinal fat absorption?"
        ),
        "title": (
            "Which anti-obesity medication acts primarily by inhibiting gastrointestinal lipases and decreasing intestinal fat absorption?"
        ),
        "narrative": (
            "Which anti-obesity medication acts primarily by inhibiting gastrointestinal lipases and decreasing intestinal fat absorption?"
        ),
        "rationale": (
            "Orlistat is the best answer because it inhibits gastric and pancreatic lipases in the gastrointestinal tract, "
            "thereby reducing digestion and absorption of dietary fat. Topiramate, liraglutide, metformin, and withdrawn "
            "agents such as sibutramine do not primarily work by intestinal lipase inhibition."
        ),
        "notes": "Rebuilt missing stem from the surviving rationale and removed the outdated only-approved-drug wording.",
    },
    67149: {
        "lane": "ai_adjudication",
        "playbook": "needs_review_release",
        "notes": "Metabolic syndrome answer key and rationale are coherent; released explicit review flag.",
    },
    67246: {
        "lane": "ai_adjudication",
        "playbook": "needs_review_release",
        "notes": "Antacid constipation item is coherent; released explicit review flag.",
    },
    67247: {
        "lane": "ai_adjudication",
        "playbook": "needs_review_release",
        "notes": "GERD follow-up item is coherent; released explicit review flag.",
    },
    67988: {
        "lane": "ai_adjudication",
        "playbook": "needs_review_release",
        "notes": "GERD lifestyle item is coherent; released explicit review flag.",
    },
    67992: {
        "lane": "ai_adjudication",
        "playbook": "option_typo_and_rationale_completion",
        "options": [
            {"id": "A", "text": "Domperidon", "is_correct": True},
            {"id": "B", "text": "Antasida", "is_correct": False},
            {"id": "C", "text": "Proton pump inhibitor", "is_correct": False},
            {"id": "D", "text": "Sucralfate", "is_correct": False},
            {"id": "E", "text": "Ranitidine", "is_correct": False},
        ],
        "rationale": (
            "Domperidon is the best answer because the dominant symptoms are postprandial fullness, early satiety, "
            "and belching with normal endoscopy, consistent with functional dyspepsia with a motility component. "
            "Antacids, H2 blockers, PPIs, and sucralfate are more directed at acid neutralization or mucosal disease."
        ),
        "notes": "Fixed option typo Antasidac -> Antasida and completed the truncated rationale.",
    },
    67993: {
        "lane": "ai_adjudication",
        "playbook": "rationale_completion",
        "rationale": (
            "Antasida is the best answer because this patient has short-duration epigastric pain without alarm features "
            "and with normal endoscopy, so symptomatic acid neutralization is reasonable as initial therapy. Domperidone "
            "is more useful for motility-predominant symptoms, while sucralfate and stronger acid suppression are reserved "
            "for ulcer disease or persistent symptoms."
        ),
        "notes": "Completed the truncated rationale and released explicit review flag.",
    },
    67994: {
        "lane": "ai_adjudication",
        "playbook": "rationale_completion",
        "rationale": (
            "Omeprazole plus domperidone is the best answer because the patient has dyspepsia with epigastric pain, "
            "early satiety, bloating, and frequent belching. A PPI addresses acid-related epigastric symptoms, while "
            "domperidone addresses the motility/early-satiety component. Combining multiple acid suppressants is less useful."
        ),
        "notes": "Completed the truncated rationale and released explicit review flag.",
    },
    67996: {
        "lane": "ai_adjudication",
        "playbook": "needs_review_release",
        "notes": "PPI-based dyspepsia/ulcer therapy item is coherent; released explicit review flag.",
    },
    68004: {
        "lane": "ai_adjudication",
        "playbook": "rationale_completion",
        "rationale": (
            "Omeprazole is the best answer because epigastric pain radiating to the back with nausea and NSAID-like "
            "herbal medication exposure is compatible with gastritis or peptic ulcer disease. A proton pump inhibitor "
            "provides stronger acid suppression than ranitidine or antacids; sucralfate and domperidone are adjunctive."
        ),
        "notes": "Completed the truncated rationale and released explicit review flag.",
    },
    68013: {
        "lane": "ai_adjudication",
        "playbook": "rationale_completion",
        "rationale": (
            "Rehydration plus injected omeprazole is the best answer because hematemesis and melena after NSAID use suggest "
            "upper gastrointestinal bleeding from peptic ulcer disease. Initial management includes resuscitation and PPI "
            "therapy to support clot stability while definitive evaluation and endoscopic therapy are arranged when indicated."
        ),
        "notes": "Completed the truncated rationale and released explicit review flag.",
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
    without_quality_flags(meta, {"readability_batch_salvage_hold"})
    meta["avg_option_length"] = compute_avg_option_length(updated.get("options") or [])
    meta["readability_release_at"] = timestamp
    meta["readability_release_basis"] = BASIS
    meta["readability_release_lane"] = fix.get("lane")
    meta["readability_release_playbook"] = fix.get("playbook")
    with_quality_flag(meta, "readability_release")
    if fix.get("lane") == "ai_adjudication":
        meta["readability_ai_pass"] = True
        meta["readability_ai_pass_basis"] = BASIS
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
                "lane": fix.get("lane"),
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
