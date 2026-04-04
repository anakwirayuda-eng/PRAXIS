from __future__ import annotations

import argparse
import json
import re
import sqlite3
from collections import Counter, defaultdict
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parent.parent
DB_FILE = ROOT / "server" / "data" / "casebank.db"
JSON_FILE = ROOT / "public" / "data" / "compiled_cases.json"
QUEUE_FILE = ROOT / "ingestion" / "output" / "readability_auto_fix_queue.json"
REPORT_FILE = ROOT / "ingestion" / "output" / "readability_auto_fix_apply_report.json"

DEFAULT_SOURCES = ("fdi-tryout", "medqa", "pedmedqa")
GENERIC_PROMPT_RE = re.compile(r"^(?:pilih jawaban yang paling tepat\.?|review this case and choose the best answer\.?)$", re.IGNORECASE)
QUESTIONISH_RE = re.compile(
    r"\b(apakah|diagnosis|terapi|tatalaksana|komplikasi|gambaran|pemeriksaan|temuan|penanganan|penyebab|patofisiologi|definitif|which of the following|what is|what should|what would|what best|most likely|next step|causal organism|diagnosis|management)\b",
    re.IGNORECASE,
)
NARRATIVE_PROMPT_TRIGGER_RE = re.compile(
    r"\b(apakah|diagnosis|terapi|tatalaksana|komplikasi|etiologi|patofisiologi|pemeriksaan|temuan|penanganan|tindakan|interpretasi|nervus|lokasi|penyebab|yang paling tepat|yang tepat|yang sesuai|yang mungkin|apa diagnosis|apa terapi|apa tatalaksana|apa temuan|apa penanganan|which of the following|what is|what should|what would|most likely|best describes|next step|diagnosis)\b",
    re.IGNORECASE,
)
WATERMARK_RE = re.compile(
    r"(?:F\s*U\s*T\s*U\s*R\s*E\s*D\s*O\s*C\s*T\s*O\s*R\s*I\s*N\s*D\s*O\s*N\s*E\s*S\s*I\s*A\s*\.?\s*C\s*O\s*M|FUTUREDOCTORINDONESIA\.COM|PLATFORM\s+TRY\s*OUT\s+UKMPPD\s+ONLINE\s+TERBAIK\s+DAN\s+TERMURAH\s+DI\s+INDONESIA\s*\d*)",
    re.IGNORECASE,
)
IMAGE_DEPENDENT_RE = re.compile(
    r"\b(gambar\s+seperti\s+berikut|gambar\s+berikut|hasil\s+ekg\s+ditemukan\s+gambaran\s+seperti\s+ini|foto\s+thorax|foto\s+toraks|ct\s+scan.*gambar|mri.*gambar)\b",
    re.IGNORECASE,
)
EMBEDDED_OPTION_RE = re.compile(r"^(.*?)(?:\s+|^)([A-E])[\.\)]\s*(.+)$", re.IGNORECASE)
LEADING_OPTION_ARTIFACT_RE = re.compile(r"^(?:\(?[A-E]\)?[\.\):\-]\s+)")
CASE_OPENER_RE = re.compile(r"\b(?:Seorang|Laki-laki|Perempuan|Wanita|Pria|Anak|Pasien|Ny\.|Tn\.)\b", re.IGNORECASE)
INLINE_CHOICE_RE = re.compile(r"\b[a-e][\.\)]\s+", re.IGNORECASE)
SOURCE_DUMP_RE = re.compile(
    r"(?:Disclaimer|Daftar Referensi|Sumber Pustaka|Budayakan|Hak Cipta|INGENIO INDONESIA|PT INGENIO|Batch\s+\d|UKMPPD|Kekayaan intelektual)",
    re.IGNORECASE,
)
INITIALS_OPENING_RE = re.compile(r"^([A-E])\.\s+([A-Z])\.\s+")


def read_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def write_json_atomic(path: Path, value: Any) -> None:
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


def normalize_text(value: Any, *, flatten: bool = False, remove_watermark: bool = False) -> str:
    text = str(value or "")
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = text.replace("\u00a0", " ").replace("\u2028", "\n").replace("\u2029", "\n")
    text = text.replace("\u2010", "-").replace("\u2011", "-").replace("\u2012", "-").replace("\u2013", "-").replace("\u2014", "-")
    text = text.replace("…", "...")
    if remove_watermark:
        text = WATERMARK_RE.sub(" ", text)
    text = re.sub(r"[•●▪■]", " ", text)
    text = re.sub(r"(\d)\s*\.\s*(\d)", r"\1.\2", text)
    text = re.sub(r"\b([A-Za-z]+)\s*-\s*([A-Za-z]+)\b", r"\1-\2", text)
    text = re.sub(r"\s+([,;:!?])", r"\1", text)
    text = re.sub(r"([,;:!?])(?=[A-Za-z(])", r"\1 ", text)
    text = re.sub(r"\.(?=[A-Za-z(])", ". ", text)
    text = re.sub(r"\s*\.\s*\.\s*\.", "...", text)
    text = re.sub(r"\.\.\.\s*\.", "...", text)
    text = re.sub(r"\.{4,}", "...", text)
    if flatten:
        text = re.sub(r"\s*\n+\s*", " ", text)
    else:
        text = re.sub(r"\n{3,}", "\n\n", text)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r" ?\n ?", "\n", text)
    text = re.sub(r"\s{2,}", " ", text)
    return text.strip()


def case_keys(case_data: dict[str, Any]) -> list[str]:
    keys: list[str] = []
    for raw in (case_data.get("_id"), case_data.get("case_code"), case_data.get("hash_id")):
        if raw is None:
            continue
        text = str(raw).strip()
        if text:
            keys.append(text)
    return keys


def get_narrative(case_data: dict[str, Any]) -> str:
    vignette = case_data.get("vignette")
    if isinstance(vignette, dict):
        return str(vignette.get("narrative") or "")
    return str(vignette or "")


def set_narrative(case_data: dict[str, Any], narrative: str) -> None:
    if isinstance(case_data.get("vignette"), dict):
        case_data["vignette"]["narrative"] = narrative
    else:
        case_data["vignette"] = {"narrative": narrative}


def with_quality_flag(meta: dict[str, Any], flag: str) -> None:
    flags = meta.get("quality_flags")
    if not isinstance(flags, list):
        flags = []
    if flag not in flags:
        flags.append(flag)
    meta["quality_flags"] = flags


def add_needs_review(meta: dict[str, Any], reason: str, flag: str | None = None) -> None:
    meta["needs_review"] = True
    if not meta.get("needs_review_reason"):
        meta["needs_review_reason"] = reason
    reasons = meta.get("needs_review_reasons")
    if not isinstance(reasons, list):
        reasons = []
    if reason not in reasons:
        reasons.append(reason)
    meta["needs_review_reasons"] = reasons
    if flag:
        with_quality_flag(meta, flag)


def summarize_text(text: str, limit: int = 160) -> str:
    compact = re.sub(r"\s+", " ", text).strip()
    if len(compact) <= limit:
        return compact
    return compact[: limit - 3].rstrip() + "..."


def is_generic_prompt(prompt: str) -> bool:
    return GENERIC_PROMPT_RE.match(normalize_text(prompt, flatten=True)) is not None


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
          quality_score,
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

    options_by_case: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for row in option_rows:
        options_by_case[int(row["case_id"])].append(
            {
                "id": row["option_id"],
                "text": row["option_text"],
                "is_correct": bool(row["is_correct"]),
            }
        )

    cases: dict[int, dict[str, Any]] = {}
    for row in rows:
        meta = parse_json(row["meta_json"], {})
        meta.setdefault("source", row["source"] or "")
        if row["meta_status"]:
            meta["status"] = row["meta_status"]
        if row["clinical_consensus"]:
            meta["clinical_consensus"] = row["clinical_consensus"]
        if row["t9_verified"]:
            meta["_openclaw_t9_v2"] = True
        if row["t10_verified"]:
            meta["_openclaw_t10_verified"] = True
        cases[int(row["case_id"])] = {
            "_id": int(row["case_id"]),
            "case_code": row["case_code"] or "",
            "hash_id": row["hash_id"],
            "title": row["title"] or "",
            "prompt": row["prompt"] or "",
            "source": row["source"] or "",
            "quality_score": row["quality_score"],
            "vignette": parse_json(row["vignette_json"], {}),
            "rationale": parse_json(row["rationale_json"], {}),
            "meta": meta,
            "validation": parse_json(row["validation_json"], {}),
            "options": options_by_case.get(int(row["case_id"]), []),
        }
    return cases


def option_texts(case_data: dict[str, Any]) -> list[str]:
    return [normalize_text(option.get("text"), flatten=True) for option in case_data.get("options", [])]


def normalize_case_text_fields(case_data: dict[str, Any], *, remove_watermark: bool = False) -> None:
    case_data["title"] = normalize_text(case_data.get("title"), flatten=True, remove_watermark=remove_watermark)
    case_data["prompt"] = normalize_text(case_data.get("prompt"), flatten=True, remove_watermark=remove_watermark)
    set_narrative(case_data, normalize_text(get_narrative(case_data), flatten=True, remove_watermark=remove_watermark))
    rationale = case_data.get("rationale")
    if isinstance(rationale, dict):
        rationale["correct"] = normalize_text(rationale.get("correct"), flatten=True, remove_watermark=remove_watermark)
    elif isinstance(rationale, str):
        case_data["rationale"] = normalize_text(rationale, flatten=True, remove_watermark=remove_watermark)
    for option in case_data.get("options", []):
        option["text"] = normalize_text(option.get("text"), flatten=True, remove_watermark=remove_watermark)


def option_contains_embedded_content(text: str) -> bool:
    cleaned = normalize_text(text, flatten=True)
    if len(cleaned) > 140:
        return True
    if "?" in cleaned:
        return True
    if SOURCE_DUMP_RE.search(cleaned):
        return True
    if len(INLINE_CHOICE_RE.findall(cleaned)) >= 2:
        return True
    if CASE_OPENER_RE.search(cleaned):
        return True
    return False


def case_has_source_contamination(case_data: dict[str, Any]) -> bool:
    narrative = normalize_text(get_narrative(case_data), flatten=True)
    title = normalize_text(case_data.get("title"), flatten=True)
    prompt = normalize_text(case_data.get("prompt"), flatten=True)
    joined = "\n".join([title, prompt, narrative])
    if SOURCE_DUMP_RE.search(joined):
        return True
    if len(CASE_OPENER_RE.findall(narrative)) >= 2:
        return True
    if len(re.findall(r"\b\d{1,3}\s*\*?[A-E]?\s*(?:Seorang|Laki-laki|Perempuan|Wanita|Anak|Pasien)", narrative, re.IGNORECASE)) >= 1:
        return True
    return any(option_contains_embedded_content(option.get("text")) for option in case_data.get("options", []))


def has_compact_option_set(case_data: dict[str, Any]) -> bool:
    options = case_data.get("options") or []
    if len(options) < 4:
        return False
    return all(not option_contains_embedded_content(option.get("text")) for option in options)


def strip_to_first_case_opener(text: str) -> str:
    cleaned = normalize_text(text, flatten=True)
    match = CASE_OPENER_RE.search(cleaned)
    if match:
        return cleaned[match.start() :].strip()
    return LEADING_OPTION_ARTIFACT_RE.sub("", cleaned).strip()


def rewrite_hallucinated_rationale(text: str) -> str:
    cleaned = normalize_text(text, flatten=True)
    replacements = {
        "more commonly indicated": "more suggestive",
        "is not a valid treatment": "is not the best treatment choice",
        "is not a common diagnosis": "is not the most likely diagnosis",
        "[auto-analysis]": "",
    }
    for needle, replacement in replacements.items():
        cleaned = cleaned.replace(needle, replacement)
    return normalize_text(cleaned, flatten=True)


def compute_avg_option_length(options: list[dict[str, Any]]) -> float:
    if not options:
        return 0.0
    total = sum(len(str(option.get("text") or "").strip()) for option in options)
    return round(total / len(options), 1)


def rebuild_answer_anchor_text(options: list[dict[str, Any]]) -> str:
    for option in options:
        if option.get("is_correct") is True:
            return str(option.get("text") or "")
    return ""


def find_leaked_prompt_option(case_data: dict[str, Any]) -> dict[str, Any] | None:
    if not GENERIC_PROMPT_RE.match(normalize_text(case_data.get("prompt"), flatten=True)):
        return None
    options = case_data.get("options") or []
    if len(options) < 4:
        return None
    ranked = sorted(
        (
            {
                "id": option.get("id"),
                "text": normalize_text(option.get("text"), flatten=True, remove_watermark=True),
                "is_correct": option.get("is_correct") is True,
            }
            for option in options
        ),
        key=lambda item: len(item["text"]),
        reverse=True,
    )
    candidate = ranked[0]
    second_length = len(ranked[1]["text"]) if len(ranked) > 1 else 0
    if len(candidate["text"]) < 35:
        return None
    if second_length and len(candidate["text"]) < second_length * 1.1:
        return None
    lower_text = candidate["text"].lower()
    if not QUESTIONISH_RE.search(candidate["text"]) and "?" not in candidate["text"] and not lower_text.endswith("...") and "adalah" not in lower_text:
        return None
    return candidate


def extract_prompt_from_narrative_with_option_a(narrative: str) -> tuple[str, str, dict[str, Any]] | None:
    cleaned = normalize_text(narrative, flatten=True, remove_watermark=True)
    match = re.search(r"(.+?)\s+A\.\s+(.+)$", cleaned)
    if not match:
        return None
    prefix = normalize_text(match.group(1), flatten=True)
    option_text = normalize_text(match.group(2), flatten=True)
    extracted = extract_question_tail(prefix)
    if extracted:
        prompt_text, narrative_text = extracted
    else:
        prompt_match = re.search(r"([^.!?]{12,}(?:\?|\.{3}|:))\s*$", prefix)
        if not prompt_match:
            return None
        prompt_text = normalize_text(prompt_match.group(1), flatten=True)
        narrative_text = normalize_text(prefix[: prompt_match.start(1)], flatten=True)
    if len(prompt_text) < 12 or len(option_text) < 2 or len(narrative_text) < 20:
        return None
    return prompt_text, narrative_text, {"id": "A", "text": option_text, "is_correct": False}


def extract_prompt_and_embedded_option_from_narrative(narrative: str) -> tuple[str, str, dict[str, Any]] | None:
    cleaned = normalize_text(narrative, flatten=True, remove_watermark=True)
    match = re.search(r"(.+?)\s+([A-E])[\.\)]\s+(.+)$", cleaned)
    if not match:
        return None
    prefix = normalize_text(match.group(1), flatten=True)
    extracted = extract_question_tail(prefix)
    if extracted:
        prompt_text, narrative_text = extracted
    else:
        prompt_text = prefix
        narrative_text = re.sub(r"\s+[A-E][\.\)]\s+.+$", "", cleaned).strip()
    option_text = normalize_text(match.group(3), flatten=True)
    if len(prompt_text) < 12 or len(prompt_text) > 260 or len(option_text) < 2:
        return None
    if not QUESTIONISH_RE.search(prompt_text) and "?" not in prompt_text and "adalah" not in prompt_text.lower():
        return None
    return prompt_text, narrative_text, {"id": match.group(2).upper(), "text": option_text, "is_correct": False}


def extract_prompt_from_narrative(narrative: str, prompt: str) -> tuple[str, str] | None:
    if not GENERIC_PROMPT_RE.match(normalize_text(prompt, flatten=True)):
        return None
    cleaned = normalize_text(narrative, remove_watermark=True)
    if len(cleaned) < 80:
        return None
    matches = list(NARRATIVE_PROMPT_TRIGGER_RE.finditer(cleaned))
    if not matches:
        return None
    trigger_index = matches[-1].start()
    if trigger_index < len(cleaned) * 0.45:
        return None
    boundary = max(
        cleaned.rfind(". ", 0, trigger_index),
        cleaned.rfind("? ", 0, trigger_index),
        cleaned.rfind("! ", 0, trigger_index),
        cleaned.rfind("; ", 0, trigger_index),
        cleaned.rfind(": ", 0, trigger_index),
    )
    split_index = boundary + 1 if boundary >= 0 else trigger_index
    narrative_text = normalize_text(cleaned[:split_index], flatten=True)
    prompt_text = normalize_text(cleaned[split_index:], flatten=True)
    if not prompt_text or not narrative_text:
        return None
    if len(prompt_text) < 20 or len(prompt_text) > 260:
        return None
    if len(narrative_text) < 40:
        return None
    if not QUESTIONISH_RE.search(prompt_text) and "?" not in prompt_text:
        return None
    return prompt_text, narrative_text


def extract_question_tail(narrative: str) -> tuple[str, str] | None:
    cleaned = normalize_text(narrative)
    boundary_positions = [-1]
    boundary_positions.extend(match.start() for match in re.finditer(r"(?:\.\.\.|[.?!;:])\s+", cleaned))
    for boundary in reversed(boundary_positions):
        candidate = normalize_text(cleaned[boundary + 1 :], flatten=True)
        stem = normalize_text(cleaned[: boundary + 1], flatten=True)
        if len(candidate) < 12 or len(candidate) > 280 or len(stem) < 40:
            continue
        heuristic_tail = candidate.lower().endswith("...") or "yang paling tepat" in candidate.lower() or "adalah" in candidate.lower()
        if not QUESTIONISH_RE.search(candidate) and "?" not in candidate and not heuristic_tail:
            continue
        return candidate, stem
    return None


def dedupe_narrative_suffix(narrative: str, prompt: str) -> tuple[str, bool]:
    cleaned_narrative = normalize_text(narrative, flatten=True)
    cleaned_prompt = normalize_text(prompt, flatten=True)
    if not cleaned_prompt:
        return cleaned_narrative, False
    if cleaned_narrative.endswith(cleaned_prompt):
        trimmed = normalize_text(cleaned_narrative[: -len(cleaned_prompt)], flatten=True)
        return trimmed, trimmed != cleaned_narrative
    return cleaned_narrative, False


def apply_fdi_fix(case_data: dict[str, Any], reason_codes: set[str]) -> tuple[dict[str, Any], list[str]]:
    updated = deepcopy(case_data)
    fix_kinds: list[str] = []
    normalize_case_text_fields(updated, remove_watermark=True)

    if "watermark_noise" in reason_codes:
        with_quality_flag(updated["meta"], "readability_watermark_removed")
        fix_kinds.append("watermark_removed")

    if "generic_prompt_candidate" in reason_codes:
        leaked = find_leaked_prompt_option(updated)
        if leaked:
            leaked_text = leaked["text"]
            if IMAGE_DEPENDENT_RE.search(leaked_text):
                return updated, fix_kinds
            prompt_text = leaked_text
            embedded_option = None
            embedded = EMBEDDED_OPTION_RE.match(leaked_text)
            if embedded and embedded.group(3):
                prompt_text = normalize_text(embedded.group(1), flatten=True, remove_watermark=True)
                embedded_option = {
                    "id": embedded.group(2).upper(),
                    "text": normalize_text(embedded.group(3), flatten=True, remove_watermark=True),
                    "is_correct": leaked["is_correct"],
                }
            survivors = [deepcopy(option) for option in updated["options"] if str(option.get("id")) != str(leaked["id"])]
            if embedded_option:
                survivors.append(embedded_option)
            survivors = sorted(survivors, key=lambda option: str(option.get("id") or ""))
            relabeled: list[dict[str, Any]] = []
            for index, option in enumerate(survivors):
                relabeled.append(
                    {
                        "id": chr(65 + index),
                        "text": normalize_text(option.get("text"), flatten=True, remove_watermark=True),
                        "is_correct": option.get("is_correct") is True,
                    }
                )
            updated["prompt"] = prompt_text
            updated["options"] = relabeled
            updated["meta"]["truncated"] = False
            updated["meta"]["option_count"] = len(relabeled)
            updated["meta"]["avg_option_length"] = compute_avg_option_length(relabeled)
            with_quality_flag(updated["meta"], "fdi_prompt_leak_fixed")
            fix_kinds.append("prompt_recovered_from_option")
        else:
            narrative = ""
            if isinstance(updated.get("vignette"), dict):
                narrative = updated["vignette"].get("narrative") or ""
            elif isinstance(updated.get("vignette"), str):
                narrative = updated.get("vignette") or ""
            missing_a = extract_prompt_from_narrative_with_option_a(narrative)
            if missing_a:
                prompt_text, narrative_text, extra_option = missing_a
                updated["prompt"] = normalize_text(prompt_text, flatten=True, remove_watermark=True)
                set_narrative(updated, normalize_text(narrative_text, flatten=True, remove_watermark=True))
                survivors = [extra_option]
                survivors.extend(deepcopy(option) for option in updated["options"])
                relabeled = []
                for index, option in enumerate(survivors):
                    relabeled.append(
                        {
                            "id": chr(65 + index),
                            "text": normalize_text(option.get("text"), flatten=True, remove_watermark=True),
                            "is_correct": option.get("is_correct") is True,
                        }
                    )
                updated["options"] = relabeled
                updated["meta"]["truncated"] = False
                updated["meta"]["option_count"] = len(relabeled)
                updated["meta"]["avg_option_length"] = compute_avg_option_length(relabeled)
                with_quality_flag(updated["meta"], "fdi_prompt_extracted")
                fix_kinds.append("prompt_extracted_from_narrative")
                return updated, fix_kinds
            embedded_narrative = extract_prompt_and_embedded_option_from_narrative(narrative)
            if embedded_narrative:
                prompt_text, narrative_text, extra_option = embedded_narrative
                updated["prompt"] = normalize_text(prompt_text, flatten=True, remove_watermark=True)
                if isinstance(updated.get("vignette"), dict):
                    updated["vignette"]["narrative"] = normalize_text(narrative_text, flatten=True, remove_watermark=True)
                else:
                    updated["vignette"] = {"narrative": normalize_text(narrative_text, flatten=True, remove_watermark=True)}
                survivors = [deepcopy(option) for option in updated["options"]]
                survivors.insert(0, extra_option)
                relabeled = []
                for index, option in enumerate(survivors):
                    relabeled.append(
                        {
                            "id": chr(65 + index),
                            "text": normalize_text(option.get("text"), flatten=True, remove_watermark=True),
                            "is_correct": option.get("is_correct") is True,
                        }
                    )
                updated["options"] = relabeled
                updated["meta"]["truncated"] = False
                updated["meta"]["option_count"] = len(relabeled)
                updated["meta"]["avg_option_length"] = compute_avg_option_length(relabeled)
                with_quality_flag(updated["meta"], "fdi_prompt_extracted")
                fix_kinds.append("prompt_extracted_from_narrative")
            else:
                extracted = extract_question_tail(narrative)
                if extracted is None:
                    extracted = extract_prompt_from_narrative(narrative, updated.get("prompt") or "")
                if extracted:
                    prompt_text, narrative_text = extracted
                    if not IMAGE_DEPENDENT_RE.search(prompt_text):
                        updated["prompt"] = normalize_text(prompt_text, flatten=True, remove_watermark=True)
                        if isinstance(updated.get("vignette"), dict):
                            updated["vignette"]["narrative"] = normalize_text(narrative_text, flatten=True, remove_watermark=True)
                        else:
                            updated["vignette"] = {"narrative": normalize_text(narrative_text, flatten=True, remove_watermark=True)}
                        updated["meta"]["truncated"] = False
                        with_quality_flag(updated["meta"], "fdi_prompt_extracted")
                        fix_kinds.append("prompt_extracted_from_narrative")

    updated["meta"]["option_count"] = len(updated.get("options") or [])
    updated["meta"]["avg_option_length"] = compute_avg_option_length(updated.get("options") or [])
    return updated, fix_kinds


def apply_medqa_family_fix(case_data: dict[str, Any], source: str, reason_codes: set[str]) -> tuple[dict[str, Any], list[str]]:
    updated = deepcopy(case_data)
    fix_kinds: list[str] = []
    normalize_case_text_fields(updated)
    narrative = get_narrative(updated)

    if not updated["prompt"]:
        extracted = extract_question_tail(narrative)
        if extracted:
            updated["prompt"], narrative = extracted
            with_quality_flag(updated["meta"], "prompt_recovered_from_narrative")
            fix_kinds.append("prompt_recovered")

    deduped_narrative, removed_suffix = dedupe_narrative_suffix(narrative, updated["prompt"])
    if removed_suffix:
        narrative = deduped_narrative
        with_quality_flag(updated["meta"], "prompt_removed_from_narrative")
        fix_kinds.append("narrative_prompt_deduped")

    updated["prompt"] = LEADING_OPTION_ARTIFACT_RE.sub("", updated["prompt"]).strip()
    narrative = LEADING_OPTION_ARTIFACT_RE.sub("", narrative).strip()

    updated["prompt"] = normalize_text(updated["prompt"], flatten=True)
    narrative = normalize_text(narrative, flatten=True)
    set_narrative(updated, narrative)

    if "orphan_linebreak" in reason_codes:
        with_quality_flag(updated["meta"], "orphan_linebreak_fixed")
        fix_kinds.append("linebreaks_flattened")
    if "leading_option_artifact" in reason_codes:
        with_quality_flag(updated["meta"], "leading_option_artifact_fixed")
        fix_kinds.append("leading_option_artifact_fixed")

    updated["meta"]["option_count"] = len(updated.get("options") or [])
    updated["meta"]["avg_option_length"] = compute_avg_option_length(updated.get("options") or [])
    return updated, fix_kinds


def apply_generic_prompt_source_fix(case_data: dict[str, Any], *, remove_watermark: bool = False) -> tuple[dict[str, Any], list[str]]:
    updated = deepcopy(case_data)
    fix_kinds: list[str] = []
    normalize_case_text_fields(updated, remove_watermark=remove_watermark)
    narrative = get_narrative(updated)

    if remove_watermark:
        with_quality_flag(updated["meta"], "readability_watermark_removed")
        fix_kinds.append("watermark_removed")

    if is_generic_prompt(updated.get("prompt") or ""):
        extracted = extract_question_tail(narrative)
        if extracted:
            prompt_text, narrative_text = extracted
            updated["prompt"] = normalize_text(prompt_text, flatten=True, remove_watermark=remove_watermark)
            set_narrative(updated, normalize_text(narrative_text, flatten=True, remove_watermark=remove_watermark))
            fix_kinds.append("prompt_extracted_from_narrative")
        elif QUESTIONISH_RE.search(narrative) or "?" in narrative or narrative.endswith(":"):
            updated["prompt"] = normalize_text(narrative, flatten=True, remove_watermark=remove_watermark)
            set_narrative(updated, "")
            fix_kinds.append("prompt_promoted_from_narrative")
        elif narrative and len(narrative) <= 180:
            updated["prompt"] = normalize_text(narrative, flatten=True, remove_watermark=remove_watermark)
            set_narrative(updated, "")
            fix_kinds.append("prompt_promoted_from_narrative")
        elif QUESTIONISH_RE.search(updated.get("title") or "") or "?" in (updated.get("title") or ""):
            updated["prompt"] = normalize_text(updated.get("title"), flatten=True, remove_watermark=remove_watermark)
            fix_kinds.append("prompt_promoted_from_title")

    updated["meta"]["option_count"] = len(updated.get("options") or [])
    updated["meta"]["avg_option_length"] = compute_avg_option_length(updated.get("options") or [])
    return updated, fix_kinds


def apply_headqa_fix(case_data: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
    updated = deepcopy(case_data)
    fix_kinds: list[str] = []
    normalize_case_text_fields(updated)

    cleaned_title = LEADING_OPTION_ARTIFACT_RE.sub("", updated.get("title") or "").strip()
    if re.fullmatch(r"[A-E]", cleaned_title or ""):
        cleaned_title = summarize_text(updated.get("prompt") or "", 72)
    if cleaned_title != (updated.get("title") or ""):
        updated["title"] = cleaned_title
        fix_kinds.append("title_artifact_removed")

    narrative = get_narrative(updated)
    initials_match = INITIALS_OPENING_RE.match(narrative)
    if initials_match:
        narrative = f"{initials_match.group(1)}.{initials_match.group(2)}. {narrative[initials_match.end():].lstrip()}"
    else:
        narrative = LEADING_OPTION_ARTIFACT_RE.sub("", narrative).strip()
    deduped_narrative, removed_suffix = dedupe_narrative_suffix(narrative, updated.get("prompt") or "")
    if removed_suffix:
        narrative = deduped_narrative
        fix_kinds.append("narrative_prompt_deduped")
    if normalize_text(narrative, flatten=True) == normalize_text(updated.get("prompt"), flatten=True):
        narrative = ""
        fix_kinds.append("narrative_prompt_deduped")
    elif narrative != get_narrative(updated):
        fix_kinds.append("leading_option_artifact_fixed")
    set_narrative(updated, narrative)

    updated["meta"]["option_count"] = len(updated.get("options") or [])
    updated["meta"]["avg_option_length"] = compute_avg_option_length(updated.get("options") or [])
    if "leading_option_artifact_fixed" not in fix_kinds:
        fix_kinds.append("leading_option_artifact_fixed")
    with_quality_flag(updated["meta"], "leading_option_artifact_fixed")
    return updated, fix_kinds


def apply_generic_cleanup_fix(case_data: dict[str, Any], reason_codes: set[str]) -> tuple[dict[str, Any], list[str]]:
    updated = deepcopy(case_data)
    fix_kinds: list[str] = []
    normalize_case_text_fields(updated)
    narrative = get_narrative(updated)

    if "hallucinated_rationale" in reason_codes:
        rationale = updated.get("rationale")
        if isinstance(rationale, dict):
            rationale["correct"] = rewrite_hallucinated_rationale(rationale.get("correct"))
        elif isinstance(rationale, str):
            updated["rationale"] = rewrite_hallucinated_rationale(rationale)
        with_quality_flag(updated["meta"], "hallucinated_rationale_fixed")
        fix_kinds.append("hallucinated_rationale_fixed")

    if "orphan_linebreak" in reason_codes:
        deduped_narrative, removed_suffix = dedupe_narrative_suffix(narrative, updated.get("prompt") or "")
        if removed_suffix:
            narrative = deduped_narrative
            fix_kinds.append("narrative_prompt_deduped")
        set_narrative(updated, normalize_text(narrative, flatten=True))
        updated["prompt"] = normalize_text(updated.get("prompt"), flatten=True)
        with_quality_flag(updated["meta"], "orphan_linebreak_fixed")
        fix_kinds.append("linebreaks_flattened")

    updated["meta"]["option_count"] = len(updated.get("options") or [])
    updated["meta"]["avg_option_length"] = compute_avg_option_length(updated.get("options") or [])
    return updated, fix_kinds


def apply_ingenio_fix(case_data: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
    updated = deepcopy(case_data)
    fix_kinds: list[str] = []
    normalize_case_text_fields(updated)
    narrative = get_narrative(updated)

    if has_compact_option_set(updated) and is_generic_prompt(updated.get("prompt") or ""):
        stripped_narrative = strip_to_first_case_opener(narrative)
        extracted = extract_question_tail(stripped_narrative)
        if extracted:
            prompt_text, narrative_text = extracted
            updated["prompt"] = prompt_text
            set_narrative(updated, narrative_text)
            cleaned_title = strip_to_first_case_opener(updated.get("title") or "")
            if not cleaned_title or cleaned_title == updated["prompt"]:
                cleaned_title = summarize_text(updated["prompt"], 72)
            updated["title"] = cleaned_title
            with_quality_flag(updated["meta"], "ingenio_prompt_extracted")
            with_quality_flag(updated["meta"], "leading_option_artifact_fixed")
            fix_kinds.extend(["prompt_extracted_from_narrative", "leading_option_artifact_fixed"])
            updated["meta"]["option_count"] = len(updated.get("options") or [])
            updated["meta"]["avg_option_length"] = compute_avg_option_length(updated.get("options") or [])
            return updated, fix_kinds

    if case_has_source_contamination(updated):
        add_needs_review(updated["meta"], "source_contamination_detected", "source_contamination_detected")
        fix_kinds.append("triaged_to_manual_review")

    updated["meta"]["option_count"] = len(updated.get("options") or [])
    updated["meta"]["avg_option_length"] = compute_avg_option_length(updated.get("options") or [])
    return updated, fix_kinds


def apply_contamination_triage_fix(case_data: dict[str, Any], source_flag: str) -> tuple[dict[str, Any], list[str]]:
    updated = deepcopy(case_data)
    normalize_case_text_fields(updated)
    add_needs_review(updated["meta"], "source_contamination_detected", source_flag)
    updated["meta"]["option_count"] = len(updated.get("options") or [])
    updated["meta"]["avg_option_length"] = compute_avg_option_length(updated.get("options") or [])
    return updated, ["triaged_to_manual_review"]


def apply_case_fix(case_data: dict[str, Any], queue_item: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
    reason_codes = {reason["code"] for reason in queue_item.get("reasons", [])}
    source = queue_item.get("source") or case_data.get("meta", {}).get("source") or case_data.get("source")
    if source == "fdi-tryout":
        return apply_fdi_fix(case_data, reason_codes)
    if source in {"medqa", "pedmedqa"}:
        return apply_medqa_family_fix(case_data, source, reason_codes)
    if source in {"greek-mcqa", "ukmppd-rekapan-2021-ocr"}:
        return apply_generic_prompt_source_fix(case_data, remove_watermark=True)
    if source == "headqa":
        return apply_headqa_fix(case_data)
    if source in {"medmcqa", "mmlu-college_medicine"}:
        return apply_generic_cleanup_fix(case_data, reason_codes)
    if source == "ingenio-tryout":
        return apply_ingenio_fix(case_data)
    if source in {"aipki-tryout", "ukdi-tryout", "medsense-tryout"}:
        return apply_contamination_triage_fix(case_data, f"{source}_contamination")
    return deepcopy(case_data), []


def case_payload_changed(before: dict[str, Any], after: dict[str, Any]) -> bool:
    keys = ("title", "prompt", "vignette", "rationale", "meta", "options")
    return any(before.get(key) != after.get(key) for key in keys)


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


def update_json_cases(json_cases: list[dict[str, Any]], updates: dict[int, dict[str, Any]]) -> tuple[list[dict[str, Any]], int]:
    changed = 0
    for item in json_cases:
        case_id = item.get("_id")
        if case_id not in updates:
            continue
        updated = updates[case_id]
        if item.get("title") != updated.get("title"):
            item["title"] = updated.get("title")
            changed += 1
        item["prompt"] = updated.get("prompt")
        item["vignette"] = updated.get("vignette")
        item["rationale"] = updated.get("rationale")
        item["meta"] = updated.get("meta")
        item["options"] = updated.get("options")
    return json_cases, changed


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser()
    parser.add_argument("--sources", default=",".join(DEFAULT_SOURCES))
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--dry-run", action="store_true")
    return parser


def main() -> None:
    parser = build_arg_parser()
    args = parser.parse_args()
    sources = [value.strip() for value in args.sources.split(",") if value.strip()]

    queue = read_json(QUEUE_FILE, [])
    selected_queue = [item for item in queue if item.get("source") in sources]
    if args.limit > 0:
        selected_queue = selected_queue[: args.limit]
    target_ids = [int(item["_id"]) for item in selected_queue]

    connection = sqlite3.connect(DB_FILE)
    connection.row_factory = sqlite3.Row
    try:
        case_map = load_case_rows(connection, target_ids)
        json_cases = read_json(JSON_FILE, [])

        changed_cases: dict[int, dict[str, Any]] = {}
        report: dict[str, Any] = {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "sources": sources,
            "dry_run": args.dry_run,
            "queue_targets": len(selected_queue),
            "changed_cases": 0,
            "unchanged_cases": 0,
            "missing_in_sqlite": [],
            "missing_in_json": [],
            "by_source": Counter(),
            "fix_kinds": Counter(),
            "samples": [],
        }

        json_ids = {item.get("_id") for item in json_cases}

        for queue_item in selected_queue:
            case_id = int(queue_item["_id"])
            source = queue_item.get("source") or "unknown"
            current = case_map.get(case_id)
            if current is None:
                report["missing_in_sqlite"].append(case_id)
                continue
            if case_id not in json_ids:
                report["missing_in_json"].append(case_id)

            updated, fix_kinds = apply_case_fix(current, queue_item)
            if not case_payload_changed(current, updated):
                report["unchanged_cases"] += 1
                continue

            changed_cases[case_id] = updated
            report["changed_cases"] += 1
            report["by_source"][source] += 1
            for kind in fix_kinds or ["content_normalized"]:
                report["fix_kinds"][kind] += 1
            if len(report["samples"]) < 12:
                report["samples"].append(
                    {
                        "_id": case_id,
                        "source": source,
                        "reasons": [reason["code"] for reason in queue_item.get("reasons", [])],
                        "fix_kinds": fix_kinds,
                        "before_prompt": summarize_text(current.get("prompt") or ""),
                        "after_prompt": summarize_text(updated.get("prompt") or ""),
                    }
                )

        report["by_source"] = dict(report["by_source"].most_common())
        report["fix_kinds"] = dict(report["fix_kinds"].most_common())

        if not args.dry_run and changed_cases:
            persist_sqlite(connection, list(changed_cases.values()))
            update_json_cases(json_cases, changed_cases)
            write_json_atomic(JSON_FILE, json_cases)

        write_json_atomic(REPORT_FILE, report)

        print("READABILITY AUTO-FIX APPLY")
        print(f"  Sources:        {', '.join(sources)}")
        print(f"  Queue targets:  {len(selected_queue):,}")
        print(f"  Changed cases:  {report['changed_cases']:,}")
        print(f"  Unchanged:      {report['unchanged_cases']:,}")
        print(f"  Report:         {REPORT_FILE}")
        if report["by_source"]:
            print("  By source:")
            for source, count in report["by_source"].items():
                print(f"    - {source}: {count:,}")
        if report["fix_kinds"]:
            print("  Fix kinds:")
            for kind, count in report["fix_kinds"].items():
                print(f"    - {kind}: {count:,}")
    finally:
        connection.close()


if __name__ == "__main__":
    main()
