from __future__ import annotations

import json
import re
import sqlite3
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parent.parent
JSON_DATA_FILE = ROOT / "public" / "data" / "compiled_cases.json"
DB_FILE = ROOT / "server" / "data" / "casebank.db"
QUARANTINE_MANIFEST_FILE = ROOT / "public" / "data" / "quarantine_manifest.json"
OUTPUT_DIR = ROOT / "ingestion" / "output"
SUMMARY_FILE = OUTPUT_DIR / "readability_audit_summary.json"
AUTO_FIX_FILE = OUTPUT_DIR / "readability_auto_fix_queue.json"
MANUAL_REVIEW_FILE = OUTPUT_DIR / "readability_manual_review_queue.json"

WATCHMAN_REPORT_FILE = OUTPUT_DIR / "watchman_report.json"
CATEGORY_REVIEW_QUEUE_FILE = OUTPUT_DIR / "category_review_queue.json"
AI_CONFLICT_LANE_SUMMARY_FILE = OUTPUT_DIR / "ai_conflict_lane_summary.json"

WATERMARK_RE = re.compile(
    r"(?:future\s*doctor\s*indonesia|futuredoctorindonesia\.com|platform\s+try\s*out\s+ukmppd)",
    re.IGNORECASE,
)
MOJIBAKE_RE = re.compile(r"(?:Ã.|Â|â€|â€¢|â€“|â€”|â€œ|â€|â€˜|â€™)")
ORPHAN_LINEBREAK_RE = re.compile(r"[a-z0-9,;:]\s*\n\s*[a-z]", re.IGNORECASE)
LEADING_OPTION_ARTIFACT_RE = re.compile(r"^(?:[A-E][\.\)]\s+)")
INITIALS_OPENING_RE = re.compile(r"^([A-E])\.\s+([A-Z])\.\s+")
GENERIC_PROMPT_RE = re.compile(
    r"^(?:review this case and choose the best answer\.?|pilih jawaban yang paling tepat\.?)$",
    re.IGNORECASE,
)
AOTA_RE = re.compile(r"\b(?:all of the above|none of the above|semua jawaban benar|semua di atas|tidak satupun)\b", re.IGNORECASE)
IMAGE_DEPENDENT_RE = re.compile(
    r"\b(?:gambar(?:\s+berikut|\s+di\s+bawah)?|foto\s+(?:toraks|thorax)|ct\s*scan.*gambar|mri.*gambar|ekg.*gambar)\b",
    re.IGNORECASE,
)
HALLUCINATION_RE = re.compile(
    r"(?:\[auto-analysis\]|more commonly indicated|is not a valid treatment|is not a common diagnosis)",
    re.IGNORECASE,
)
NEGATION_RE = re.compile(
    r"\b(?:except|not true|false regarding|least likely|incorrect|kecuali|bukan|tidak benar|yang salah)\b",
    re.IGNORECASE,
)
ABSOLUTE_RE = re.compile(
    r"\b(?:always|never|only|must|all|none|selalu|tidak pernah|harus|semua|tidak satupun)\b",
    re.IGNORECASE,
)
UNIT_COLLISION_RE = re.compile(
    r"\b(?:mg\/ml|mg\/l|mmhg|mm hg|mcg\/ml|microgram\/ml|iu\/ml|meq\/l|mmol\/l)\b",
    re.IGNORECASE,
)


REASON_INFO: dict[str, dict[str, Any]] = {
    "mojibake": {
        "bucket": "auto_fix",
        "severity": 35,
        "label": "Broken typography / mojibake",
        "action": "Normalize text encoding, punctuation, and line-level artifacts.",
        "scripts": ["ingestion/vignette-cleanup.cjs", "ingestion/data-quality-phase2.mjs"],
    },
    "watermark_noise": {
        "bucket": "auto_fix",
        "severity": 30,
        "label": "Watermark / promo noise in text",
        "action": "Strip watermark or promo fragments from stem, narrative, or rationale.",
        "scripts": ["ingestion/vignette-cleanup.cjs", "ingestion/remediate-fdi-tryout.mjs"],
    },
    "orphan_linebreak": {
        "bucket": "auto_fix",
        "severity": 20,
        "label": "Broken line joins",
        "action": "Join line-broken sentences and normalize whitespace.",
        "scripts": ["ingestion/vignette-cleanup.cjs"],
    },
    "leading_option_artifact": {
        "bucket": "auto_fix",
        "severity": 20,
        "label": "Option-label artifact inside stem",
        "action": "Remove stray option label tokens from prompt or vignette.",
        "scripts": ["ingestion/vignette-cleanup.cjs", "ingestion/normalize-options.mjs"],
    },
    "duplicate_options": {
        "bucket": "auto_fix",
        "severity": 45,
        "label": "Duplicate option text",
        "action": "Deduplicate and re-letter repeated options.",
        "scripts": ["ingestion/normalize-options.mjs", "ingestion/fix_duplicate_options.auto.mjs", "ingestion/fix_same_options.auto.mjs"],
    },
    "hallucinated_rationale": {
        "bucket": "auto_fix",
        "severity": 35,
        "label": "Hallucinated or synthetic rationale wrapper",
        "action": "Strip synthetic rationale text and recover the best grounded explanation.",
        "scripts": ["ingestion/data-quality-audit.mjs", "ingestion/auto-fix-quality.mjs"],
    },
    "generic_prompt_candidate": {
        "bucket": "auto_fix",
        "severity": 40,
        "label": "Generic prompt likely recoverable from vignette/options",
        "action": "Recover the real question text from narrative or leaked option text.",
        "scripts": ["ingestion/remediate-fdi-tryout.mjs"],
    },
    "needs_review": {
        "bucket": "manual_review",
        "severity": 55,
        "label": "Explicit review flag",
        "action": "Clinical adjudication required before the case should be treated as clean.",
        "scripts": ["ingestion/extract-needs-review.mjs", "ingestion/apply-review-results.mjs"],
    },
    "truncated": {
        "bucket": "manual_review",
        "severity": 70,
        "label": "Truncated stem or content",
        "action": "Recover missing text from source material or rewrite the stem manually.",
        "scripts": ["ingestion/remediate-ukmppd-pdf.mjs", "ingestion/ocr-pipeline.cjs"],
    },
    "quarantined": {
        "bucket": "manual_review",
        "severity": 80,
        "label": "Quarantined case",
        "action": "Inspect quarantine reason and salvage or retire the case explicitly.",
        "scripts": ["ingestion/batch-remediate-answer-keys.mjs", "ingestion/ai-triage-quarantined.mjs"],
    },
    "quarantine_manifest": {
        "bucket": "manual_review",
        "severity": 80,
        "label": "Listed in quarantine manifest",
        "action": "Treat as blocked until contradiction or answer-key issue is resolved.",
        "scripts": ["ingestion/batch-remediate-answer-keys.mjs", "ingestion/ai-triage-quarantined.mjs"],
    },
    "image_dependency": {
        "bucket": "manual_review",
        "severity": 75,
        "label": "Image-dependent question text",
        "action": "Recover image/context or rewrite the case into a self-contained question.",
        "scripts": ["ingestion/extract-images.cjs", "ingestion/wire-pdf-images.cjs"],
    },
    "no_options": {
        "bucket": "manual_review",
        "severity": 90,
        "label": "Missing options",
        "action": "Rebuild answer options from source material before publishing.",
        "scripts": ["ingestion/final-cleanup.mjs", "ingestion/build-answer-audit-batch.mjs"],
    },
    "no_correct_answer": {
        "bucket": "manual_review",
        "severity": 95,
        "label": "No correct answer marked",
        "action": "Reconstruct the answer key from source and reviewer adjudication.",
        "scripts": ["ingestion/build-answer-audit-batch.mjs", "ingestion/apply-review-results.mjs"],
    },
    "multi_correct": {
        "bucket": "manual_review",
        "severity": 95,
        "label": "Multiple correct answers marked",
        "action": "Resolve answer-key ambiguity and normalize options manually.",
        "scripts": ["ingestion/build-answer-audit-batch.mjs", "ingestion/apply-review-results.mjs"],
    },
    "aota_suspect": {
        "bucket": "manual_review",
        "severity": 45,
        "label": "All-of-the-above style ambiguity",
        "action": "Rewrite the item to avoid option-set ambiguity.",
        "scripts": ["ingestion/data-quality-audit.mjs", "ingestion/vignette-cleanup.cjs"],
    },
    "negation_blindspot": {
        "bucket": "manual_review",
        "severity": 60,
        "label": "Negative-stem / except logic blindspot",
        "action": "Rewrite the stem into a positive, less error-prone question.",
        "scripts": ["ingestion/output/watchman_report.json"],
    },
    "clinical_decay": {
        "bucket": "manual_review",
        "severity": 65,
        "label": "Clinical content drift / decay",
        "action": "Re-check clinical correctness against current guidance and rewrite if needed.",
        "scripts": ["ingestion/output/watchman_report.json"],
    },
    "metric_collision": {
        "bucket": "manual_review",
        "severity": 60,
        "label": "Metric or unit collision",
        "action": "Rewrite the stem/rationale to remove numeric or unit ambiguity.",
        "scripts": ["ingestion/output/watchman_report.json"],
    },
    "length_bias": {
        "bucket": "manual_review",
        "severity": 40,
        "label": "Length-bias candidate",
        "action": "Review whether the correct answer is exposed by option-length imbalance.",
        "scripts": ["ingestion/output/watchman_report.json"],
    },
    "absolute_trap": {
        "bucket": "manual_review",
        "severity": 40,
        "label": "Absolute wording trap",
        "action": "Rewrite absolutes like always/never unless they are clinically exact.",
        "scripts": ["ingestion/vignette-cleanup.cjs", "ingestion/output/watchman_report.json"],
    },
}

PRIMARY_MANUAL_CODES = {
    "needs_review",
    "truncated",
    "quarantined",
    "image_dependency",
    "no_options",
    "no_correct_answer",
    "multi_correct",
    "aota_suspect",
    "metric_collision",
    "clinical_decay",
}

ADVISORY_MANUAL_CODES = {
    "negation_blindspot",
    "length_bias",
    "absolute_trap",
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


def parse_json(value: Any, fallback: Any) -> Any:
    if value in (None, ""):
        return fallback
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return fallback


def has_leading_option_artifact(text: str) -> bool:
    normalized = str(text or "").strip()
    if not normalized:
        return False
    if INITIALS_OPENING_RE.match(normalized):
        return False
    return LEADING_OPTION_ARTIFACT_RE.match(normalized) is not None


def read_cases_from_sqlite(path: Path) -> list[dict[str, Any]]:
    connection = sqlite3.connect(path)
    try:
        case_rows = connection.execute(
            """
            SELECT
              case_id,
              case_code,
              hash_id,
              q_type,
              confidence,
              category,
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
            ORDER BY case_id
            """
        ).fetchall()
        option_rows = connection.execute(
            """
            SELECT case_id, option_id, sort_order, option_text, is_correct
            FROM case_options
            ORDER BY case_id, sort_order
            """
        ).fetchall()
    finally:
        connection.close()

    options_by_case: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for case_id, option_id, sort_order, option_text, is_correct in option_rows:
        options_by_case[int(case_id)].append(
            {
                "id": option_id,
                "sort_order": sort_order,
                "text": option_text,
                "is_correct": bool(is_correct),
            }
        )

    cases: list[dict[str, Any]] = []
    for (
        case_id,
        case_code,
        hash_id,
        q_type,
        confidence,
        category,
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
        validation_json,
    ) in case_rows:
        meta = parse_json(meta_json, {})
        meta.setdefault("source", source or "")
        if meta_status:
            meta["status"] = meta_status
        if clinical_consensus:
            meta["clinical_consensus"] = clinical_consensus
        if t9_verified:
            meta["_openclaw_t9_v2"] = True
        if t10_verified:
            meta["_openclaw_t10_verified"] = True
        cases.append(
            {
                "_id": case_id,
                "case_code": case_code or "",
                "hash_id": hash_id,
                "q_type": q_type,
                "confidence": confidence,
                "category": category,
                "title": title,
                "prompt": prompt or "",
                "source": source or "",
                "options": options_by_case.get(int(case_id), []),
                "vignette": parse_json(vignette_json, {}),
                "rationale": parse_json(rationale_json, {}),
                "meta": meta,
                "validation": parse_json(validation_json, {}),
            }
        )
    return cases


def load_cases() -> tuple[list[dict[str, Any]], dict[str, str]]:
    if DB_FILE.exists():
        return read_cases_from_sqlite(DB_FILE), {"type": "sqlite", "path": str(DB_FILE)}
    return read_json(JSON_DATA_FILE, []), {"type": "json", "path": str(JSON_DATA_FILE)}


def normalize_whitespace(value: Any) -> str:
    return re.sub(r"\n{3,}", "\n\n", re.sub(r"[ \t]+", " ", str(value or "").replace("\r\n", "\n"))).strip()


def excerpt(value: Any, limit: int = 180) -> str:
    text = normalize_whitespace(value)
    if len(text) <= limit:
        return text
    return text[: limit - 1].rstrip() + "…"


def case_keys(case_data: dict[str, Any]) -> list[str]:
    keys: list[str] = []
    for raw in (case_data.get("_id"), case_data.get("hash_id"), case_data.get("case_code")):
        if raw is None:
            continue
        text = str(raw).strip()
        if text:
            keys.append(text)
    return keys


def option_texts(case_data: dict[str, Any]) -> list[str]:
    return [normalize_whitespace(option.get("text")) for option in (case_data.get("options") or []) if normalize_whitespace(option.get("text"))]


def has_duplicate_options(case_data: dict[str, Any]) -> bool:
    seen: set[str] = set()
    for text in option_texts(case_data):
        lowered = text.lower()
        if lowered in seen:
            return True
        seen.add(lowered)
    return False


def is_quarantined(case_data: dict[str, Any]) -> bool:
    meta = case_data.get("meta") or {}
    status = str(meta.get("status") or "")
    return meta.get("quarantined") is True or status.startswith("QUARANTINED")


def correct_count(case_data: dict[str, Any]) -> int:
    return sum(1 for option in (case_data.get("options") or []) if option.get("is_correct") is True)


def option_lengths(case_data: dict[str, Any]) -> list[int]:
    return [len(text) for text in option_texts(case_data) if text]


def has_length_bias(case_data: dict[str, Any]) -> bool:
    lengths = sorted(option_lengths(case_data))
    if len(lengths) < 3:
        return False
    median = lengths[len(lengths) // 2]
    if median <= 0:
        return False
    return lengths[-1] >= max(24, int(median * 1.8))


def extract_narrative(case_data: dict[str, Any]) -> str:
    vignette = case_data.get("vignette")
    if isinstance(vignette, dict):
        return normalize_whitespace(case_data.get("question") or vignette.get("narrative"))
    return normalize_whitespace(case_data.get("question") or vignette)


def extract_rationale(case_data: dict[str, Any]) -> str:
    rationale = case_data.get("rationale")
    if isinstance(rationale, dict):
        return normalize_whitespace(rationale.get("correct"))
    return normalize_whitespace(rationale)


def source_scripts(source: str) -> list[str]:
    scripts: list[str] = []
    lowered = source.lower()
    if lowered == "fdi-tryout":
        scripts.append("ingestion/remediate-fdi-tryout.mjs")
    if "ukmppd" in lowered or "pdf" in lowered or "ocr" in lowered:
        scripts.extend(["ingestion/remediate-ukmppd-pdf.mjs", "ingestion/ocr-pipeline.cjs"])
    if lowered in {"medmcqa", "headqa", "nano1337-mcqs"}:
        scripts.append("ingestion/vignette-cleanup.cjs")
    return scripts


def attach_signal(signal_map: dict[str, list[dict[str, Any]]], key: str, code: str, origin: str, evidence: str | None = None) -> None:
    if not key:
        return
    signal_map[key].append({"code": code, "origin": origin, "evidence": evidence})


def build_external_signal_map(
    watchman_report: dict[str, Any],
) -> dict[str, list[dict[str, Any]]]:
    signal_map: dict[str, list[dict[str, Any]]] = defaultdict(list)

    watchman_reason_map = {
        "clinicalDecay": "clinical_decay",
        "metricCollision": "metric_collision",
    }
    details = watchman_report.get("details") or {}
    for detail_key, reason_code in watchman_reason_map.items():
        entries = details.get(detail_key)
        if not isinstance(entries, list):
            continue
        for entry in entries:
            if isinstance(entry, dict):
                key = entry.get("id") or entry.get("code")
                evidence = entry.get("q") or entry.get("ratSnippet")
            else:
                key = entry
                evidence = None
            if key is not None:
                attach_signal(signal_map, str(key), reason_code, f"watchman:{detail_key}", evidence=excerpt(evidence, 100))

    return signal_map


def push_reason(target: list[dict[str, Any]], seen: set[str], code: str, origin: str, evidence: str | None = None) -> None:
    if code not in REASON_INFO or code in seen:
        return
    seen.add(code)
    target.append({"code": code, "origin": origin, "evidence": evidence})


def enrich_reason(reason: dict[str, Any]) -> dict[str, Any]:
    info = REASON_INFO[reason["code"]]
    return {
        "code": reason["code"],
        "label": info["label"],
        "origin": reason["origin"],
        "evidence": reason.get("evidence"),
        "action": info["action"],
    }


def enrich_reasons(reasons: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [enrich_reason(reason) for reason in reasons]


def classify_case(case_data: dict[str, Any], external_signal_map: dict[str, list[dict[str, Any]]]) -> dict[str, Any] | None:
    source = normalize_whitespace((case_data.get("meta") or {}).get("source") or case_data.get("source"))
    prompt = normalize_whitespace(case_data.get("prompt"))
    narrative = extract_narrative(case_data)
    rationale_text = extract_rationale(case_data)
    joined_text = "\n".join(filter(None, [case_data.get("title"), prompt, narrative, rationale_text]))
    meta = case_data.get("meta") or {}
    option_preview = [excerpt(option.get("text"), 90) for option in (case_data.get("options") or [])[:5]]
    all_keys = case_keys(case_data)

    auto_reasons: list[dict[str, Any]] = []
    manual_reasons: list[dict[str, Any]] = []
    advisory_reasons: list[dict[str, Any]] = []
    seen_auto: set[str] = set()
    seen_manual: set[str] = set()
    seen_advisory: set[str] = set()

    for key in all_keys:
        for signal in external_signal_map.get(key, []):
            bucket = REASON_INFO.get(signal["code"], {}).get("bucket")
            if bucket == "manual_review":
                target = manual_reasons if signal["code"] in PRIMARY_MANUAL_CODES else advisory_reasons
                seen = seen_manual if signal["code"] in PRIMARY_MANUAL_CODES else seen_advisory
                push_reason(target, seen, signal["code"], signal["origin"], signal.get("evidence"))
            elif bucket == "auto_fix":
                push_reason(auto_reasons, seen_auto, signal["code"], signal["origin"], signal.get("evidence"))

    if meta.get("needs_review") is True:
        push_reason(manual_reasons, seen_manual, "needs_review", "meta.needs_review")
    if meta.get("truncated") is True:
        push_reason(manual_reasons, seen_manual, "truncated", "meta.truncated")
    if is_quarantined(case_data):
        push_reason(manual_reasons, seen_manual, "quarantined", "meta.status" if str(meta.get("status") or "").startswith("QUARANTINED") else "meta.quarantined", str(meta.get("status") or meta.get("quarantine_reason") or ""))

    current_correct_count = correct_count(case_data)
    if len(case_data.get("options") or []) == 0:
        push_reason(manual_reasons, seen_manual, "no_options", "heuristic")
    elif current_correct_count == 0:
        push_reason(manual_reasons, seen_manual, "no_correct_answer", "heuristic")
    elif current_correct_count > 1:
        push_reason(manual_reasons, seen_manual, "multi_correct", "heuristic")

    if IMAGE_DEPENDENT_RE.search(joined_text):
        push_reason(manual_reasons, seen_manual, "image_dependency", "heuristic")
    if AOTA_RE.search(joined_text):
        push_reason(manual_reasons, seen_manual, "aota_suspect", "heuristic")
    if NEGATION_RE.search(prompt):
        push_reason(advisory_reasons, seen_advisory, "negation_blindspot", "heuristic", excerpt(prompt, 120))
    option_blob = "\n".join(option_texts(case_data))
    if ABSOLUTE_RE.search(option_blob):
        push_reason(advisory_reasons, seen_advisory, "absolute_trap", "heuristic")
    if has_length_bias(case_data):
        push_reason(advisory_reasons, seen_advisory, "length_bias", "heuristic")
    if UNIT_COLLISION_RE.findall(joined_text):
        unique_units = sorted({match.lower() for match in UNIT_COLLISION_RE.findall(joined_text)})
        if len(unique_units) > 1:
            push_reason(manual_reasons, seen_manual, "metric_collision", "heuristic", ", ".join(unique_units))

    if MOJIBAKE_RE.search(joined_text):
        push_reason(auto_reasons, seen_auto, "mojibake", "heuristic")
    if WATERMARK_RE.search(joined_text):
        push_reason(auto_reasons, seen_auto, "watermark_noise", "heuristic")
    if ORPHAN_LINEBREAK_RE.search(prompt) or ORPHAN_LINEBREAK_RE.search(narrative):
        push_reason(auto_reasons, seen_auto, "orphan_linebreak", "heuristic")
    if has_leading_option_artifact(prompt) or has_leading_option_artifact(narrative):
        push_reason(auto_reasons, seen_auto, "leading_option_artifact", "heuristic")
    if has_duplicate_options(case_data):
        push_reason(auto_reasons, seen_auto, "duplicate_options", "heuristic")
    if source.lower() == "fdi-tryout" and GENERIC_PROMPT_RE.match(prompt):
        push_reason(auto_reasons, seen_auto, "generic_prompt_candidate", "heuristic")
    if HALLUCINATION_RE.search(rationale_text):
        push_reason(auto_reasons, seen_auto, "hallucinated_rationale", "heuristic")

    bucket = "manual_review" if manual_reasons else "auto_fix" if auto_reasons else None
    if bucket is None:
        return None

    if bucket == "manual_review":
        active_reasons = manual_reasons + [reason for reason in advisory_reasons if reason["code"] not in seen_manual]
    else:
        active_reasons = auto_reasons
    enriched_reasons = enrich_reasons(active_reasons)
    priority = sum(REASON_INFO[reason["code"]]["severity"] for reason in active_reasons)
    scripts = []
    for reason in active_reasons:
        scripts.extend(REASON_INFO[reason["code"]]["scripts"])
    scripts.extend(source_scripts(source))

    unique_scripts: list[str] = []
    seen_scripts: set[str] = set()
    for script in scripts:
        if script in seen_scripts:
            continue
        seen_scripts.add(script)
        unique_scripts.append(script)

    return {
        "_id": case_data.get("_id"),
        "case_code": case_data.get("case_code"),
        "hash_id": case_data.get("hash_id"),
        "source": source,
        "category": case_data.get("category"),
        "title": normalize_whitespace(case_data.get("title")),
        "priority": priority,
        "reasons": enriched_reasons,
        "suggested_scripts": unique_scripts,
        "preview": {
            "prompt": excerpt(prompt),
            "narrative": excerpt(narrative),
            "options": option_preview,
        },
        "metrics": {
            "option_count": len(case_data.get("options") or []),
            "correct_count": current_correct_count,
        },
        "meta": {
            "needs_review": meta.get("needs_review") is True,
            "truncated": meta.get("truncated") is True,
            "quarantined": is_quarantined(case_data),
            "status": meta.get("status") or "",
            "category_review_needed": meta.get("category_review_needed") is True,
        },
    }


def sort_queue(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return sorted(
        items,
        key=lambda item: (-item["priority"], item["source"], item["case_code"] or "", item["_id"] or 0),
    )


def build_summary(
    source_descriptor: dict[str, str],
    total_cases: int,
    auto_fix_queue: list[dict[str, Any]],
    manual_review_queue: list[dict[str, Any]],
    watchman_report: dict[str, Any],
    quarantine_manifest: list[dict[str, Any]],
    category_review_queue: list[dict[str, Any]],
    ai_conflict_lane_summary: dict[str, Any],
    all_cases: list[dict[str, Any]],
) -> dict[str, Any]:
    def summarize_queue(items: list[dict[str, Any]]) -> dict[str, Any]:
        by_reason = Counter()
        by_source = Counter()
        suggested_scripts = Counter()
        for item in items:
            by_source[item["source"] or "unknown"] += 1
            for reason in item["reasons"]:
                by_reason[reason["code"]] += 1
            for script in item["suggested_scripts"]:
                suggested_scripts[script] += 1
        return {
            "count": len(items),
            "by_reason": dict(by_reason.most_common()),
            "by_source": dict(by_source.most_common(25)),
            "top_suggested_scripts": dict(suggested_scripts.most_common(15)),
        }

    clinical_consensus = Counter()
    t9_verified = 0
    t10_verified = 0
    for case_data in all_cases:
        meta = case_data.get("meta") or {}
        if meta.get("_openclaw_t9_v2") or meta.get("_openclaw_t9_verified"):
            t9_verified += 1
        if meta.get("_openclaw_t10_verified"):
            t10_verified += 1
        consensus = normalize_whitespace(meta.get("clinical_consensus"))
        if consensus:
            clinical_consensus[consensus] += 1

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "case_source": source_descriptor,
        "total_cases": total_cases,
        "classified_clean": total_cases - len(auto_fix_queue) - len(manual_review_queue),
        "auto_fix": summarize_queue(auto_fix_queue),
        "manual_review": summarize_queue(manual_review_queue),
        "current_quality_state": {
            "t9_verified": t9_verified,
            "t10_verified": t10_verified,
            "clinical_consensus_top": dict(clinical_consensus.most_common(12)),
            "ai_conflict_lanes": ai_conflict_lane_summary,
        },
        "historical_context": {
            "watchman": {
                "timestamp": watchman_report.get("timestamp"),
                "findings": watchman_report.get("findings"),
            }
        },
        "supporting_context": {
            "quarantine_manifest_entries": len(quarantine_manifest),
            "category_review_queue_entries": len(category_review_queue),
        },
        "notes": [
            "Manual review takes precedence over auto-fix when a case has both signal types.",
            "Status-based quarantines are treated as manual-review blockers even if meta.quarantined is false.",
            "SQLite casebank is used as the source of truth when available so recent T9/T10 work is preserved in the audit.",
            "Historical reports are treated as supporting hints; current DB state and current-text heuristics drive the queue.",
            "Category review queue is reported as supporting context but does not by itself push a case into readability rewrite.",
        ],
    }


def main() -> None:
    cases, source_descriptor = load_cases()
    quarantine_manifest = read_json(QUARANTINE_MANIFEST_FILE, [])
    watchman_report = read_json(WATCHMAN_REPORT_FILE, {})
    category_review_queue = read_json(CATEGORY_REVIEW_QUEUE_FILE, [])
    ai_conflict_lane_summary = read_json(AI_CONFLICT_LANE_SUMMARY_FILE, {})

    external_signal_map = build_external_signal_map(
        watchman_report=watchman_report,
    )

    auto_fix_queue: list[dict[str, Any]] = []
    manual_review_queue: list[dict[str, Any]] = []

    for case_data in cases:
        classified = classify_case(case_data, external_signal_map)
        if not classified:
            continue
        if classified["reasons"] and classified["reasons"][0]["code"] in REASON_INFO:
            bucket = REASON_INFO[classified["reasons"][0]["code"]]["bucket"]
        else:
            bucket = "manual_review" if classified["meta"]["quarantined"] else "auto_fix"
        if bucket == "manual_review":
            manual_review_queue.append(classified)
        else:
            auto_fix_queue.append(classified)

    auto_fix_queue = sort_queue(auto_fix_queue)
    manual_review_queue = sort_queue(manual_review_queue)

    summary = build_summary(
        source_descriptor=source_descriptor,
        total_cases=len(cases),
        auto_fix_queue=auto_fix_queue,
        manual_review_queue=manual_review_queue,
        watchman_report=watchman_report,
        quarantine_manifest=quarantine_manifest,
        category_review_queue=category_review_queue,
        ai_conflict_lane_summary=ai_conflict_lane_summary,
        all_cases=cases,
    )

    write_json(SUMMARY_FILE, summary)
    write_json(AUTO_FIX_FILE, auto_fix_queue)
    write_json(MANUAL_REVIEW_FILE, manual_review_queue)

    print("Readability audit complete")
    print(f"  Total cases:     {len(cases):,}")
    print(f"  Auto-fix queue:  {len(auto_fix_queue):,}")
    print(f"  Manual review:   {len(manual_review_queue):,}")
    print(f"  Clean remainder: {summary['classified_clean']:,}")
    print(f"  Summary file:    {SUMMARY_FILE}")
    print(f"  Auto-fix file:   {AUTO_FIX_FILE}")
    print(f"  Manual file:     {MANUAL_REVIEW_FILE}")


if __name__ == "__main__":
    main()
