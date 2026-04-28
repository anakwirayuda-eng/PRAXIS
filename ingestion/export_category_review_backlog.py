from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import sqlite3
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parent.parent
OUTPUT_ROOT = ROOT / "ingestion" / "output" / "category_ai_packs"
DEFAULT_MODEL = "gpt-4.1-mini"
DEFAULT_SOURCES = "medqa,pubmedqa,headqa"

RESPONSE_SCHEMA_HINT = {
    "_id": "numeric case id copied from payload",
    "decision": "PROMOTE_RUNNER_UP | KEEP_CURRENT | MANUAL_REVIEW",
    "recommended_category": "must be one of current_category, runner_up_category, or target_category when provided",
    "confidence": "HIGH | MEDIUM | LOW",
    "reasoning": "brief explanation grounded in stem semantics and metadata quality",
    "evidence": ["flat list of short supporting points"],
}

CATEGORY_ADJUDICATION_SYSTEM = "\n".join(
    [
        "You are adjudicating noisy medical exam category labels.",
        "Prefer semantic meaning of the stem over stale source labels.",
        "Do not invent a new category.",
        "Use current_category or runner_up_category as recommended_category, or target_category when it is provided.",
        "Choose PROMOTE_RUNNER_UP when the stem clearly belongs to runner_up_category or target_category.",
        "Choose KEEP_CURRENT when current_category is still more defensible.",
        "Choose MANUAL_REVIEW when evidence remains mixed.",
        f"Return strict JSON only using this shape: {json.dumps(RESPONSE_SCHEMA_HINT, ensure_ascii=False)}",
    ]
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Export active category_review_needed cases into source-scoped AI adjudication packs."
    )
    parser.add_argument(
        "--sources",
        default=DEFAULT_SOURCES,
        help="Comma-separated sources to export, or 'all'. Default: medqa,pubmedqa,headqa.",
    )
    parser.add_argument(
        "--pack-prefix",
        default="category-review-backlog",
        help="Prefix for generated pack directories.",
    )
    parser.add_argument(
        "--max-items-per-bucket",
        type=int,
        default=80,
        help="Maximum requests per bucket shard.",
    )
    parser.add_argument(
        "--max-items-per-source",
        type=int,
        default=0,
        help="Optional cap per source. 0 means no cap.",
    )
    parser.add_argument("--model", default=DEFAULT_MODEL, help="OpenAI chat model for batch requests.")
    return parser.parse_args()


def db_path() -> Path:
    configured = os.environ.get("CASEBANK_DB_PATH")
    if configured:
        return Path(configured)
    return ROOT / "server" / "data" / "casebank.db"


def slugify(value: Any) -> str:
    text = str(value or "").strip().lower()
    text = re.sub(r"[^a-z0-9]+", "-", text)
    return text.strip("-") or "unknown"


def normalize(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def read_json(value: str | None, default: Any) -> Any:
    if not value:
        return default
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return default


def ensure_dir(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)


def write_json(path: Path, value: Any) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")


def write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    payload = "\n".join(json.dumps(row, ensure_ascii=False) for row in rows)
    path.write_text((payload + "\n") if payload else "", encoding="utf-8", newline="\n")


def rel(path: Path) -> str:
    return path.relative_to(ROOT).as_posix()


def chunked(items: list[dict[str, Any]], size: int) -> list[list[dict[str, Any]]]:
    return [items[index : index + size] for index in range(0, len(items), size)]


def get_target_category(case_record: dict[str, Any]) -> str | None:
    resolution = case_record.get("meta", {}).get("category_resolution", {}) or {}
    resolved = normalize(resolution.get("resolved_category"))
    current = normalize(case_record.get("category"))
    runner_up = normalize(resolution.get("runner_up_category"))
    if not resolved or resolved in {current, runner_up}:
        return None
    return resolution.get("resolved_category")


def get_narrative(case_record: dict[str, Any]) -> str:
    vignette = case_record.get("vignette") or {}
    if isinstance(vignette, dict):
        return normalize(vignette.get("narrative"))
    return ""


def build_payload(case_record: dict[str, Any], bucket: dict[str, Any]) -> dict[str, Any]:
    meta = case_record.get("meta") or {}
    resolution = meta.get("category_resolution") or {}
    return {
        "_id": case_record["_id"],
        "case_code": case_record.get("case_code"),
        "source": case_record.get("source"),
        "bucket_id": bucket["id"],
        "bucket_label": bucket["label"],
        "bucket_rationale": bucket["rationale"],
        "current_category": case_record.get("category"),
        "raw_category": resolution.get("raw_category"),
        "raw_normalized_category": resolution.get("raw_normalized_category"),
        "current_resolved_category": resolution.get("resolved_category"),
        "target_category": get_target_category(case_record),
        "runner_up_category": resolution.get("runner_up_category"),
        "runner_up_score": resolution.get("runner_up_score"),
        "confidence": resolution.get("confidence"),
        "winning_signals": resolution.get("winning_signals") if isinstance(resolution.get("winning_signals"), list) else [],
        "subject": case_record.get("subject") or meta.get("subject") or "",
        "topic": case_record.get("topic") or meta.get("topic") or "",
        "tags": meta.get("tags") if isinstance(meta.get("tags"), list) else [],
        "organ_system": meta.get("organ_system") or "",
        "topic_keywords": meta.get("topic_keywords") if isinstance(meta.get("topic_keywords"), list) else [],
        "title": case_record.get("title") or "",
        "prompt": case_record.get("prompt") or "",
        "narrative": get_narrative(case_record),
        "options": [
            {
                "id": option.get("id"),
                "text": option.get("text"),
            }
            for option in case_record.get("options", [])
        ],
    }


def build_user_prompt(payload: dict[str, Any], bucket: dict[str, Any]) -> str:
    return "\n".join(
        [
            "Playbook: category_adjudication",
            f"Bucket: {bucket['id']}",
            f"Focus: {bucket['focus']}",
            "Task: decide whether the item should keep the current category, promote to the runner-up/target category, or stay manual-review only.",
            "",
            json.dumps(payload, ensure_ascii=False, indent=2),
        ]
    )


def build_openai_request(case_record: dict[str, Any], payload: dict[str, Any], bucket: dict[str, Any], model: str) -> dict[str, Any]:
    return {
        "custom_id": f"category_ai|{bucket['id']}|{case_record['source']}|{case_record['_id']}",
        "method": "POST",
        "url": "/v1/chat/completions",
        "body": {
            "model": model,
            "temperature": 0,
            "response_format": {"type": "json_object"},
            "messages": [
                {"role": "system", "content": CATEGORY_ADJUDICATION_SYSTEM},
                {"role": "user", "content": build_user_prompt(payload, bucket)},
            ],
        },
    }


def build_gemini_request(case_record: dict[str, Any], payload: dict[str, Any], bucket: dict[str, Any]) -> dict[str, Any]:
    return {
        "custom_id": f"category_ai|{bucket['id']}|{case_record['source']}|{case_record['_id']}",
        "playbook": "category_adjudication",
        "bucket_id": bucket["id"],
        "source": case_record["source"],
        "model": "gemini-2.5-pro",
        "response_mime_type": "application/json",
        "response_schema_hint": RESPONSE_SCHEMA_HINT,
        "system_instruction": CATEGORY_ADJUDICATION_SYSTEM,
        "user_prompt": build_user_prompt(payload, bucket),
    }


def build_claude_request(case_record: dict[str, Any], payload: dict[str, Any], bucket: dict[str, Any]) -> dict[str, Any]:
    return {
        "custom_id": f"category_ai|{bucket['id']}|{case_record['source']}|{case_record['_id']}",
        "playbook": "category_adjudication",
        "bucket_id": bucket["id"],
        "source": case_record["source"],
        "model_hint": "claude-4.7",
        "response_schema_hint": RESPONSE_SCHEMA_HINT,
        "system": CATEGORY_ADJUDICATION_SYSTEM,
        "prompt": build_user_prompt(payload, bucket),
    }


def hydrate_cases(connection: sqlite3.Connection) -> list[dict[str, Any]]:
    rows = connection.execute(
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
          subject,
          topic,
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

    options_by_case: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for row in option_rows:
        options_by_case[int(row["case_id"])].append(
            {
                "id": str(row["option_id"] or ""),
                "text": row["option_text"] or "",
                "is_correct": bool(row["is_correct"]),
            }
        )

    cases: list[dict[str, Any]] = []
    for row in rows:
        meta = read_json(row["meta_json"], {})
        source = normalize(row["source"] or meta.get("source"))
        cases.append(
            {
                "_id": int(row["case_id"]),
                "case_code": row["case_code"],
                "hash_id": row["hash_id"],
                "q_type": row["q_type"],
                "confidence": row["confidence"],
                "category": row["category"],
                "title": row["title"],
                "prompt": row["prompt"],
                "source": source,
                "subject": row["subject"] or meta.get("subject") or "",
                "topic": row["topic"] or meta.get("topic") or "",
                "vignette": read_json(row["vignette_json"], {}),
                "rationale": read_json(row["rationale_json"], {}),
                "meta": meta,
                "validation": read_json(row["validation_json"], {}),
                "options": options_by_case.get(int(row["case_id"]), []),
            }
        )
    return cases


def bucket_key(case_record: dict[str, Any]) -> tuple[str, str, str]:
    resolution = case_record.get("meta", {}).get("category_resolution", {}) or {}
    current = normalize(case_record.get("category")) or "unknown"
    target = normalize(get_target_category(case_record))
    runner_up = normalize(resolution.get("runner_up_category"))
    candidate = target or runner_up or normalize(resolution.get("resolved_category")) or "unknown"
    confidence = normalize(resolution.get("confidence")) or "unknown"
    return confidence, current, candidate


def make_bucket(source: str, confidence: str, current: str, candidate: str, part: int) -> dict[str, Any]:
    base = f"{slugify(source)}-{slugify(confidence)}-{slugify(current)}-vs-{slugify(candidate)}"
    bucket_id = f"{base}-{part:02d}"
    return {
        "id": bucket_id,
        "label": f"{source}: {current} vs {candidate} ({confidence}) shard {part}",
        "rationale": "Active category_review_needed item grouped by source, resolver confidence, current category, and nearest candidate category.",
        "focus": (
            f"Decide whether each {source} item should keep {current} or move to {candidate}. "
            "If the stem evidence is mixed, choose MANUAL_REVIEW."
        ),
    }


def export_source_pack(
    source: str,
    items: list[dict[str, Any]],
    args: argparse.Namespace,
    db_file: Path,
) -> dict[str, Any]:
    pack_name = f"{args.pack_prefix}-{slugify(source)}"
    pack_dir = OUTPUT_ROOT / slugify(pack_name)
    if pack_dir.exists():
        shutil.rmtree(pack_dir)
    ensure_dir(pack_dir)
    shortlist_dir = pack_dir / "shortlists"
    openai_dir = pack_dir / "openai"
    gemini_dir = pack_dir / "gemini"
    claude_dir = pack_dir / "claude"
    for directory in [shortlist_dir, openai_dir, gemini_dir, claude_dir]:
        ensure_dir(directory)

    grouped: dict[tuple[str, str, str], list[dict[str, Any]]] = defaultdict(list)
    for item in items:
        grouped[bucket_key(item)].append(item)

    manifest_buckets: list[dict[str, Any]] = []
    for (confidence, current, candidate), group in sorted(grouped.items(), key=lambda entry: (-len(entry[1]), entry[0])):
        group.sort(key=lambda record: (record["_id"], record.get("case_code") or ""))
        for part, selected in enumerate(chunked(group, max(1, args.max_items_per_bucket)), start=1):
            bucket = make_bucket(source, confidence, current, candidate, part)
            shortlist = []
            openai_rows = []
            gemini_rows = []
            claude_rows = []
            for case_record in selected:
                resolution = case_record.get("meta", {}).get("category_resolution", {}) or {}
                shortlist.append(
                    {
                        "_id": case_record["_id"],
                        "case_code": case_record.get("case_code"),
                        "current_category": case_record.get("category"),
                        "target_category": get_target_category(case_record),
                        "runner_up_category": resolution.get("runner_up_category"),
                        "runner_up_score": resolution.get("runner_up_score"),
                        "subject": case_record.get("subject") or "",
                        "tags": case_record.get("meta", {}).get("tags") if isinstance(case_record.get("meta", {}).get("tags"), list) else [],
                        "organ_system": case_record.get("meta", {}).get("organ_system") or "",
                        "title": case_record.get("title") or "",
                        "prompt": case_record.get("prompt") or "",
                    }
                )
                payload = build_payload(case_record, bucket)
                openai_rows.append(build_openai_request(case_record, payload, bucket, args.model))
                gemini_rows.append(build_gemini_request(case_record, payload, bucket))
                claude_rows.append(build_claude_request(case_record, payload, bucket))

            shortlist_path = shortlist_dir / f"{bucket['id']}.json"
            openai_path = openai_dir / f"{bucket['id']}.jsonl"
            gemini_path = gemini_dir / f"{bucket['id']}.jsonl"
            claude_path = claude_dir / f"{bucket['id']}.jsonl"
            write_json(shortlist_path, shortlist)
            write_jsonl(openai_path, openai_rows)
            write_jsonl(gemini_path, gemini_rows)
            write_jsonl(claude_path, claude_rows)

            manifest_buckets.append(
                {
                    "id": bucket["id"],
                    "label": bucket["label"],
                    "rationale": bucket["rationale"],
                    "focus": bucket["focus"],
                    "total_items": len(selected),
                    "files": {
                        "shortlist": rel(shortlist_path),
                        "openai": rel(openai_path),
                        "gemini": rel(gemini_path),
                        "claude": rel(claude_path),
                    },
                }
            )

    manifest = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "pack_name": pack_name,
        "db_path": str(db_file),
        "source": source,
        "playbook": "category_adjudication",
        "profile": "source_backlog",
        "model": args.model,
        "response_schema_hint": RESPONSE_SCHEMA_HINT,
        "total_items": len(items),
        "buckets": manifest_buckets,
        "notes": [
            "OpenAI files are ready for /v1/batches submission with submit-category-adjudication-pack.mjs.",
            "Gemini and Claude files are provider-neutral prompt packs; convert responses to the same custom_id JSONL shape before applying.",
            "recommended_category must stay within current_category, runner_up_category, or target_category when provided.",
        ],
    }
    write_json(pack_dir / "manifest.json", manifest)
    return manifest


def main() -> None:
    args = parse_args()
    selected_sources = None
    if args.sources.strip().lower() != "all":
        selected_sources = {normalize(item) for item in args.sources.split(",") if normalize(item)}

    db_file = db_path()
    connection = sqlite3.connect(db_file)
    connection.row_factory = sqlite3.Row
    try:
        cases = hydrate_cases(connection)
    finally:
        connection.close()

    active = []
    for case_record in cases:
        if case_record.get("meta", {}).get("category_review_needed") is not True:
            continue
        if selected_sources is not None and case_record.get("source") not in selected_sources:
            continue
        active.append(case_record)

    by_source: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for case_record in active:
        by_source[case_record["source"]].append(case_record)

    manifests = []
    for source, items in sorted(by_source.items(), key=lambda entry: (-len(entry[1]), entry[0])):
        items.sort(key=lambda record: (bucket_key(record), record["_id"]))
        if args.max_items_per_source > 0:
            items = items[: args.max_items_per_source]
        manifests.append(export_source_pack(source, items, args, db_file))

    summary = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "db_path": str(db_file),
        "sources": "all" if selected_sources is None else sorted(selected_sources),
        "total_items": sum(item["total_items"] for item in manifests),
        "source_counts": Counter({item["source"]: item["total_items"] for item in manifests}),
        "packs": [
            {
                "pack_name": item["pack_name"],
                "source": item["source"],
                "total_items": item["total_items"],
                "manifest": rel(OUTPUT_ROOT / slugify(item["pack_name"]) / "manifest.json"),
            }
            for item in manifests
        ],
    }
    summary_path = OUTPUT_ROOT / f"{slugify(args.pack_prefix)}-summary.json"
    write_json(summary_path, summary)

    print("Category review backlog export complete")
    print(f"  DB:          {db_file}")
    print(f"  Sources:     {', '.join(summary['source_counts'].keys()) or '(none)'}")
    print(f"  Total items: {summary['total_items']}")
    print(f"  Summary:     {summary_path}")
    for pack in summary["packs"]:
        print(f"  {pack['pack_name']}: {pack['total_items']} items")


if __name__ == "__main__":
    main()
