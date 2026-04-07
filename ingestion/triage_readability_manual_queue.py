from __future__ import annotations

import json
import sqlite3
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parent.parent
OUTPUT_DIR = ROOT / "ingestion" / "output"
DB_FILE = ROOT / "server" / "data" / "casebank.db"
MANUAL_REVIEW_FILE = OUTPUT_DIR / "readability_manual_review_queue.json"
SUMMARY_FILE = OUTPUT_DIR / "readability_manual_lane_summary.json"
BATCH_SALVAGE_FILE = OUTPUT_DIR / "readability_batch_salvage_queue.json"
AI_ADJUDICATION_FILE = OUTPUT_DIR / "readability_ai_adjudication_queue.json"
HUMAN_SHORTLIST_FILE = OUTPUT_DIR / "readability_human_shortlist.json"

LANE_ORDER = ("batch_salvage", "ai_adjudication", "human_shortlist")
PLAYBOOK_ORDER = (
    "truncated_text_recovery",
    "image_context_recovery",
    "answer_key_adjudication",
    "needs_review_adjudication",
    "ambiguity_rewrite",
    "contaminated_source_rewrite",
    "clinical_rewrite",
)

IMAGE_BATCH_SOURCES = {
    "fdi-tryout",
    "fk-leaked-ukmppd",
    "pedmedqa",
    "sct-alchemist-v3",
    "sct-factory-v1",
    "sinauyuk-tryout",
    "tw-medqa",
    "ukmppd-pdf",
    "ukmppd-pdf-scribd",
    "ukmppd-rekapan-2021-ocr",
    "ukmppd-ukdicorner",
}

PLAYBOOKS: dict[str, dict[str, Any]] = {
    "truncated_text_recovery": {
        "lane": "batch_salvage",
        "label": "Truncated Text Recovery",
        "description": "Run source-text recovery and prompt reconstruction before any deeper adjudication.",
        "scripts": [
            "ingestion/extract-needs-review.mjs",
            "ingestion/apply-batch-flexible.mjs",
            "ingestion/recover-rationales.mjs",
            "ingestion/remediate-ukmppd-pdf.mjs",
        ],
        "next_lane_if_unresolved": "ai_adjudication",
    },
    "image_context_recovery": {
        "lane": "batch_salvage",
        "label": "Image Context Recovery",
        "description": "Recover missing image context or wire source images in batch before escalating to rewrite.",
        "scripts": [
            "ingestion/extract-images.cjs",
            "ingestion/wire-pdf-images.cjs",
            "ingestion/remediate-ukmppd-pdf.mjs",
        ],
        "next_lane_if_unresolved": "human_shortlist",
    },
    "answer_key_adjudication": {
        "lane": "ai_adjudication",
        "label": "Answer-Key Adjudication",
        "description": "Use batch answer-key and contradiction tooling to reconstruct or adjudicate the single best answer.",
        "scripts": [
            "ingestion/build-answer-audit-batch.mjs",
            "ingestion/batch-remediate-answer-keys.mjs",
            "ingestion/ai-triage-quarantined.mjs",
            "ingestion/apply-answer-audit.mjs",
        ],
        "next_lane_if_unresolved": "human_shortlist",
    },
    "needs_review_adjudication": {
        "lane": "ai_adjudication",
        "label": "Needs-Review Adjudication",
        "description": "Route explicit needs-review items through structured adjudication batches instead of manual reading.",
        "scripts": [
            "ingestion/extract-needs-review.mjs",
            "ingestion/apply-review-results.mjs",
            "ingestion/apply-batch-flexible.mjs",
        ],
        "next_lane_if_unresolved": "human_shortlist",
    },
    "ambiguity_rewrite": {
        "lane": "ai_adjudication",
        "label": "Ambiguity Rewrite",
        "description": "Use AI-assisted rewrite/adjudication for ambiguity, unit collisions, and logic traps after structural cleanup is done.",
        "scripts": [
            "ingestion/extract-needs-review.mjs",
            "ingestion/apply-review-results.mjs",
            "ingestion/build-contradiction-batch-v2.mjs",
        ],
        "next_lane_if_unresolved": "human_shortlist",
    },
    "contaminated_source_rewrite": {
        "lane": "human_shortlist",
        "label": "Contaminated Source Rewrite",
        "description": "Source-dump or multi-question contamination needs selective human salvage or retirement.",
        "scripts": [],
        "next_lane_if_unresolved": None,
    },
    "clinical_rewrite": {
        "lane": "human_shortlist",
        "label": "Clinical Rewrite",
        "description": "Clinical decay or unresolved semantic risk needs a final clinician/editor pass.",
        "scripts": [
            "ingestion/output/watchman_report.json",
        ],
        "next_lane_if_unresolved": None,
    },
}


def read_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = path.with_suffix(path.suffix + ".tmp")
    with temp_path.open("w", encoding="utf-8", newline="\n") as handle:
        json.dump(value, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
    temp_path.replace(path)


def summarize_text(text: str, limit: int = 160) -> str:
    compact = " ".join(str(text or "").split())
    if len(compact) <= limit:
        return compact
    return compact[: limit - 3].rstrip() + "..."


def dedupe_strings(values: list[str]) -> list[str]:
    unique: list[str] = []
    seen: set[str] = set()
    for value in values:
        if not value or value in seen:
            continue
        unique.append(value)
        seen.add(value)
    return unique


def parse_json(value: Any, fallback: Any) -> Any:
    if value in (None, ""):
        return fallback
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return fallback


def load_meta_overrides(case_ids: list[int]) -> dict[int, dict[str, Any]]:
    if not case_ids:
        return {}
    placeholders = ",".join("?" for _ in case_ids)
    connection = sqlite3.connect(DB_FILE)
    connection.row_factory = sqlite3.Row
    try:
        rows = connection.execute(
            f"""
            SELECT case_id, meta_json
            FROM cases
            WHERE case_id IN ({placeholders})
            """,
            case_ids,
        ).fetchall()
    finally:
        connection.close()
    overrides: dict[int, dict[str, Any]] = {}
    for row in rows:
        overrides[int(row["case_id"])] = parse_json(row["meta_json"], {})
    return overrides


def classify_item(item: dict[str, Any], meta: dict[str, Any]) -> tuple[str, str, str]:
    reason_codes = {reason["code"] for reason in item.get("reasons", [])}
    source = str(item.get("source") or "").strip()
    needs_review_reason = str(meta.get("needs_review_reason") or "").strip()
    readability_ai_hold = str(meta.get("readability_ai_hold") or "").strip()
    readability_ai_pass = meta.get("readability_ai_pass") is True

    if readability_ai_hold:
        return "human_shortlist", "clinical_rewrite", "AI adjudication already exhausted the automated lane and needs a final editor pass"
    if readability_ai_pass and reason_codes == {"no_options"}:
        return "human_shortlist", "clinical_rewrite", "answer adjudication is already settled, but the option text still needs source recovery or editor repair"
    if readability_ai_pass and reason_codes == {"metric_collision"}:
        return "human_shortlist", "clinical_rewrite", "answer adjudication is already settled; the remaining unit collision now needs an editor rewrite pass"

    if needs_review_reason == "source_contamination_detected":
        return "human_shortlist", "contaminated_source_rewrite", "source contamination needs selective salvage or retirement"
    if "clinical_decay" in reason_codes:
        return "human_shortlist", "clinical_rewrite", "clinical content drift is the limiting risk"
    if "image_dependency" in reason_codes and source in IMAGE_BATCH_SOURCES:
        return "batch_salvage", "image_context_recovery", "recover image context before escalating to rewrite"
    if "truncated" in reason_codes:
        return "batch_salvage", "truncated_text_recovery", "recover missing stem or rationale text first"
    if reason_codes.intersection({"quarantined", "no_options", "no_correct_answer", "multi_correct"}):
        return "ai_adjudication", "answer_key_adjudication", "answer-key reconstruction is the next best pass"
    if "needs_review" in reason_codes:
        return "ai_adjudication", "needs_review_adjudication", "explicit review flags can be re-batched through adjudication tooling"
    if reason_codes.intersection({"metric_collision", "aota_suspect", "negation_blindspot", "absolute_trap", "length_bias"}):
        return "ai_adjudication", "ambiguity_rewrite", "ambiguity and logic traps fit an AI-assisted rewrite lane"
    return "human_shortlist", "clinical_rewrite", "unmapped manual risk kept for human shortlist"


def build_lane_record(item: dict[str, Any], meta_override: dict[str, Any] | None = None) -> dict[str, Any]:
    queue_meta = item.get("meta") or {}
    db_meta = meta_override or {}
    resolved_source = str(item.get("source") or db_meta.get("source") or queue_meta.get("source") or "").strip()
    meta = {
        **queue_meta,
        **db_meta,
        "needs_review": db_meta.get("needs_review", queue_meta.get("needs_review")) is True,
        "truncated": db_meta.get("truncated", queue_meta.get("truncated")) is True,
        "quarantined": db_meta.get("quarantined", queue_meta.get("quarantined")) is True,
        "status": db_meta.get("status", queue_meta.get("status")) or "",
        "category_review_needed": db_meta.get("category_review_needed", queue_meta.get("category_review_needed")) is True,
    }
    lane, playbook, rationale = classify_item(item, meta)
    playbook_info = PLAYBOOKS[playbook]
    combined_scripts = dedupe_strings(
        list(playbook_info.get("scripts") or []) + list(item.get("suggested_scripts") or [])
    )
    record = {
        "_id": item.get("_id"),
        "case_code": item.get("case_code"),
        "hash_id": item.get("hash_id"),
        "source": resolved_source,
        "category": item.get("category"),
        "priority": item.get("priority", 0),
        "lane": lane,
        "playbook": playbook,
        "lane_rationale": rationale,
        "next_lane_if_unresolved": playbook_info.get("next_lane_if_unresolved"),
        "reasons": item.get("reasons") or [],
        "reason_codes": [reason["code"] for reason in item.get("reasons", [])],
        "suggested_scripts": combined_scripts,
        "meta": {
            "needs_review": meta.get("needs_review") is True,
            "needs_review_reason": meta.get("needs_review_reason"),
            "needs_review_reasons": meta.get("needs_review_reasons") if isinstance(meta.get("needs_review_reasons"), list) else [],
            "truncated": meta.get("truncated") is True,
            "quarantined": meta.get("quarantined") is True,
            "status": meta.get("status") or "",
            "quarantine_reason": meta.get("quarantine_reason") or "",
        },
        "preview": {
            "prompt": summarize_text((item.get("preview") or {}).get("prompt") or ""),
            "narrative": summarize_text((item.get("preview") or {}).get("narrative") or ""),
            "options": [summarize_text(option, 100) for option in ((item.get("preview") or {}).get("options") or [])[:5]],
        },
    }
    return record


def sort_records(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return sorted(
        records,
        key=lambda item: (
            -int(item.get("priority") or 0),
            PLAYBOOK_ORDER.index(item["playbook"]) if item["playbook"] in PLAYBOOK_ORDER else len(PLAYBOOK_ORDER),
            str(item.get("source") or ""),
            int(item.get("_id") or 0),
        ),
    )


def summarize_lane(records: list[dict[str, Any]], lane: str) -> dict[str, Any]:
    by_playbook = Counter(record["playbook"] for record in records)
    by_source = Counter(record["source"] for record in records)
    by_reason = Counter()
    next_lanes = Counter()
    scripts = Counter()

    for record in records:
        for code in record.get("reason_codes") or []:
            by_reason[code] += 1
        if record.get("next_lane_if_unresolved"):
            next_lanes[str(record["next_lane_if_unresolved"])] += 1
        for script in record.get("suggested_scripts") or []:
            scripts[script] += 1

    return {
        "count": len(records),
        "by_playbook": dict(by_playbook.most_common()),
        "by_source": dict(by_source.most_common(20)),
        "by_reason": dict(by_reason.most_common(20)),
        "top_suggested_scripts": dict(scripts.most_common(10)),
        "next_lane_if_unresolved": dict(next_lanes.most_common()),
        "playbooks": {
            key: {
                "label": PLAYBOOKS[key]["label"],
                "description": PLAYBOOKS[key]["description"],
                "scripts": PLAYBOOKS[key]["scripts"],
            }
            for key in PLAYBOOK_ORDER
            if key in by_playbook and PLAYBOOKS[key]["lane"] == lane
        },
    }


def build_summary(records_by_lane: dict[str, list[dict[str, Any]]], input_count: int) -> dict[str, Any]:
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "input_file": str(MANUAL_REVIEW_FILE),
        "total_manual_cases": input_count,
        "notes": [
            "Lane assignment reflects the recommended next operational pass, not the final disposition.",
            "Advisory signals like absolute_trap and length_bias do not by themselves force a human lane.",
            "Image-dependent cases stay in batch_salvage when the source has a plausible image extraction path.",
            "Source contamination and clinical decay stay in the human shortlist because automation is unlikely to salvage them safely.",
        ],
        "lanes": {
            lane: summarize_lane(records_by_lane.get(lane, []), lane)
            for lane in LANE_ORDER
        },
    }


def main() -> None:
    manual_queue = read_json(MANUAL_REVIEW_FILE, [])
    meta_overrides = load_meta_overrides([int(item["_id"]) for item in manual_queue if item.get("_id") is not None])
    lane_records = [
        build_lane_record(item, meta_overrides.get(int(item["_id"])))
        for item in manual_queue
    ]

    records_by_lane: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for record in lane_records:
        records_by_lane[record["lane"]].append(record)

    for lane in list(records_by_lane):
        records_by_lane[lane] = sort_records(records_by_lane[lane])

    summary = build_summary(records_by_lane, len(manual_queue))

    write_json(BATCH_SALVAGE_FILE, records_by_lane.get("batch_salvage", []))
    write_json(AI_ADJUDICATION_FILE, records_by_lane.get("ai_adjudication", []))
    write_json(HUMAN_SHORTLIST_FILE, records_by_lane.get("human_shortlist", []))
    write_json(SUMMARY_FILE, summary)

    print("READABILITY MANUAL TRIAGE")
    print(f"  Input queue:      {len(manual_queue):,}")
    for lane in LANE_ORDER:
        print(f"  {lane}:".ljust(19) + f"{len(records_by_lane.get(lane, [])):,}")
    print(f"  Summary file:     {SUMMARY_FILE}")
    print(f"  Batch salvage:    {BATCH_SALVAGE_FILE}")
    print(f"  AI adjudication:  {AI_ADJUDICATION_FILE}")
    print(f"  Human shortlist:  {HUMAN_SHORTLIST_FILE}")


if __name__ == "__main__":
    main()
