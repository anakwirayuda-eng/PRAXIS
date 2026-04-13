import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');

const DATA_FILE = join(ROOT, 'public', 'data', 'compiled_cases.json');
const IMAGE_QUEUE_FILE = join(__dirname, 'output', 'source_text_image_rewrite_queue.json');
const OCR_QUEUE_FILE = join(__dirname, 'output', 'source_text_medmcqa_ocr_queue.json');
const COMBINED_QUEUE_FILE = join(__dirname, 'output', 'source_text_ai_salvage_queue.json');
const SUMMARY_FILE = join(__dirname, 'output', 'source_text_ai_salvage_summary.json');

const IMAGE_DEPENDENT_RE = /\b(?:according to (?:the )?(?:image|figure|photograph|x-ray|scan)|question linked to image|as shown in (?:the )?(?:image|figure)|see (?:the )?(?:image|figure)|given (?:image|figure|x-ray)|based on the image)\b/i;
const OCR_PUNCT_RE = /\b[A-Za-z]\.[A-Za-z]{3,}\b/g;
const OCR_CITATION_CUE_RE = /\b(?:ref|reference|edition|textbook|page|pg\b|ed\b)\b/i;
const SAFE_OCR_TOKENS = new Set([
  'B.virus',
  'C.albicans',
  'C.difficile',
  'C.diphtheriae',
  'C.tetani',
  'C.ulcerans',
  'E.Coli',
  'E.coli',
  'H.influenzae',
  'H.PYLORI',
  'H.Pylori',
  'H.pylori',
  'M.canis',
  'M.gypseum',
  'M.tuberculosis',
  'N.meningitides',
  'P.falciparum',
  'P.malariae',
  'P.vivax',
  'S.Granulosum',
  'S.Spinosum',
  'S.aureus',
  'S.flexineri',
  'S.pneumoniae',
  'S.pyogenes',
  'S.shaped',
  'S.typhi',
  'T.cruzi',
  'T.saginata',
  'T.schoenleinii',
  'T.solium',
  'V.cholerae',
]);

function writeJson(filePath, value) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function normalizeWhitespace(value) {
  return String(value ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function compactText(value, limit = 180) {
  const text = normalizeWhitespace(value);
  if (text.length <= limit) {
    return text;
  }
  return `${text.slice(0, limit - 3).trimEnd()}...`;
}

function getNarrative(caseRecord) {
  if (typeof caseRecord.question === 'string' && normalizeWhitespace(caseRecord.question)) {
    return normalizeWhitespace(caseRecord.question);
  }
  if (typeof caseRecord.vignette === 'string') {
    return normalizeWhitespace(caseRecord.vignette);
  }
  if (caseRecord.vignette && typeof caseRecord.vignette === 'object') {
    return normalizeWhitespace(caseRecord.vignette.narrative);
  }
  return '';
}

function getPrompt(caseRecord) {
  return normalizeWhitespace(caseRecord.prompt || caseRecord.title || getNarrative(caseRecord));
}

function getFieldEntries(caseRecord) {
  const entries = [
    ['title', caseRecord.title ?? ''],
    ['prompt', caseRecord.prompt ?? ''],
    ['question', caseRecord.question ?? ''],
  ];

  if (typeof caseRecord.vignette === 'string') {
    entries.push(['vignette', caseRecord.vignette]);
  } else if (caseRecord.vignette && typeof caseRecord.vignette === 'object') {
    entries.push(['vignette.narrative', caseRecord.vignette.narrative ?? '']);
    entries.push(['vignette.labFindings', caseRecord.vignette.labFindings ?? '']);
  }

  if (typeof caseRecord.rationale === 'string') {
    entries.push(['rationale', caseRecord.rationale]);
  } else if (caseRecord.rationale && typeof caseRecord.rationale === 'object') {
    entries.push(['rationale.correct', caseRecord.rationale.correct ?? '']);
    entries.push(['rationale.pearl', caseRecord.rationale.pearl ?? '']);
    for (const [key, value] of Object.entries(caseRecord.rationale.distractors ?? {})) {
      entries.push([`rationale.distractors.${key}`, value ?? '']);
    }
  }

  for (let index = 0; index < (caseRecord.options ?? []).length; index += 1) {
    entries.push([`options.${index}.text`, caseRecord.options[index]?.text ?? '']);
  }

  return entries.filter(([, value]) => normalizeWhitespace(value).length > 0);
}

function createQueueRecord(caseRecord, reasonCode, reasonLabel, reasonEvidence, laneRationale, priority) {
  return {
    _id: caseRecord._id,
    case_code: caseRecord.case_code ?? '',
    hash_id: caseRecord.hash_id ?? null,
    source: normalizeWhitespace(caseRecord?.meta?.source || caseRecord?.source || ''),
    category: caseRecord.category ?? '',
    priority,
    lane: 'ai_adjudication',
    playbook: 'clinical_rewrite',
    lane_rationale: laneRationale,
    next_lane_if_unresolved: 'human_shortlist',
    reason_codes: [reasonCode],
    reasons: [
      {
        code: reasonCode,
        label: reasonLabel,
        origin: 'source_text_artifact_audit',
        evidence: reasonEvidence,
        action: 'Rewrite the visible stem/narrative into a clean self-contained item without relying on noisy source text.',
      },
    ],
    suggested_scripts: [
      'ingestion/export_readability_ai_pack.mjs',
      'ingestion/apply_readability_ai_pack.mjs',
    ],
    meta: {
      needs_review: true,
      truncated: Boolean(caseRecord?.meta?.truncated),
      quarantined: Boolean(caseRecord?.meta?.quarantined),
      status: caseRecord?.meta?.status || '',
      category_review_needed: Boolean(caseRecord?.meta?.category_review_needed),
    },
    preview: {
      prompt: compactText(getPrompt(caseRecord)),
      narrative: compactText(getNarrative(caseRecord)),
      options: (caseRecord.options ?? []).slice(0, 5).map((option) => compactText(option?.text ?? '', 100)),
    },
  };
}

function collectImageQueue(cases) {
  const records = [];

  for (const caseRecord of cases) {
    const matches = [];
    for (const [field, value] of getFieldEntries(caseRecord)) {
      const text = normalizeWhitespace(value);
      const match = text.match(IMAGE_DEPENDENT_RE);
      if (match) {
        matches.push({ field, token: match[0], sample: compactText(text) });
      }
    }

    if (matches.length === 0) {
      continue;
    }

    records.push(
      createQueueRecord(
        caseRecord,
        'image_dependent_phrase',
        'Image-dependent visible text',
        `${matches[0].field}: ${matches[0].token}`,
        'Image-linked wording still leaks into visible text; rewrite the item into a self-contained stem or rationale.',
        220 + Math.min(matches.length, 20),
      ),
    );
  }

  return records;
}

function isSafeSpeciesToken(token) {
  return SAFE_OCR_TOKENS.has(token) || /^[A-Z]\.[a-z]{2,}$/.test(token);
}

function isSuspiciousOcrToken(token, text) {
  if (isSafeSpeciesToken(token)) {
    return false;
  }
  if (OCR_CITATION_CUE_RE.test(text) && /^[A-Z]\.[A-Za-z]+$/.test(token)) {
    return false;
  }

  const suffix = token.split('.')[1] || '';
  return /^[a-z]\./.test(token)
    || /[A-Z].*[A-Z]/.test(suffix)
    || /(The|Anterior|Posterior|Ruptured|Fluoride|Carnitine|Tumbling|Auditory|Nervus|Mole|Therefore|Gluteus|Adductor|Sartorius|Pectineus|Facial|Anabolic|Meningeal|Motor|Sensory|Inferior|Lingual|Auriculotemporal|Indeterminate|DNA|Other|Elevated|ambercoloured|darbepoeitin|positive)/.test(suffix);
}

function collectMedmcqaOcrQueue(cases) {
  const records = [];

  for (const caseRecord of cases) {
    const source = normalizeWhitespace(caseRecord?.meta?.source || caseRecord?.source || '');
    if (source !== 'medmcqa') {
      continue;
    }

    const hits = [];
    for (const [field, value] of getFieldEntries(caseRecord)) {
      if (field.startsWith('options.')) {
        continue;
      }

      const text = normalizeWhitespace(value);
      let match;
      while ((match = OCR_PUNCT_RE.exec(text)) !== null) {
        const token = match[0];
        if (!isSuspiciousOcrToken(token, text)) {
          continue;
        }
        hits.push({ field, token, sample: compactText(text) });
      }
      OCR_PUNCT_RE.lastIndex = 0;
    }

    if (hits.length === 0) {
      continue;
    }

    records.push(
      createQueueRecord(
        caseRecord,
        'ocr_source_roughness',
        'OCR/source roughness shortlist',
        `${hits[0].field}: ${hits[0].token}`,
        'Residual OCR/source-splicing roughness still degrades readability; rewrite the visible explanation or stem into clean prose.',
        160 + Math.min(hits.length, 30),
      ),
    );
  }

  return records;
}

function sortQueue(items) {
  return [...items].sort((left, right) => {
    if (right.priority !== left.priority) {
      return right.priority - left.priority;
    }
    if (left.source !== right.source) {
      return left.source.localeCompare(right.source);
    }
    return Number(left._id) - Number(right._id);
  });
}

function summarize(items) {
  const bySource = {};
  const byReason = {};
  for (const item of items) {
    bySource[item.source] = (bySource[item.source] || 0) + 1;
    for (const code of item.reason_codes ?? []) {
      byReason[code] = (byReason[code] || 0) + 1;
    }
  }

  return {
    count: items.length,
    by_source: Object.fromEntries(Object.entries(bySource).sort((left, right) => right[1] - left[1])),
    by_reason: byReason,
    sample_ids: items.slice(0, 20).map((item) => item._id),
  };
}

function main() {
  const cases = JSON.parse(readFileSync(DATA_FILE, 'utf8'));
  const imageQueue = sortQueue(collectImageQueue(cases));
  const ocrQueue = sortQueue(collectMedmcqaOcrQueue(cases));

  const combinedMap = new Map();
  for (const item of [...imageQueue, ...ocrQueue]) {
    const existing = combinedMap.get(String(item._id));
    if (!existing) {
      combinedMap.set(String(item._id), item);
      continue;
    }

    existing.priority = Math.max(existing.priority, item.priority);
    existing.reason_codes = [...new Set([...(existing.reason_codes ?? []), ...(item.reason_codes ?? [])])];
    existing.reasons = [...(existing.reasons ?? []), ...(item.reasons ?? [])];
    existing.lane_rationale = `${existing.lane_rationale} ${item.lane_rationale}`.trim();
  }

  const combinedQueue = sortQueue([...combinedMap.values()]);
  const summary = {
    generated_at: new Date().toISOString(),
    total_cases: cases.length,
    image_queue: summarize(imageQueue),
    medmcqa_ocr_queue: summarize(ocrQueue),
    combined_queue: summarize(combinedQueue),
    notes: [
      'All records are mapped to the `clinical_rewrite` playbook because they need self-contained text repair rather than pure answer-key adjudication.',
      'The medmcqa OCR queue is a shortlist, not the entire heuristic bucket; obvious citation/species tokens are excluded.',
      'Combined queue de-duplicates cases that appear in both the image and OCR lanes.',
    ],
  };

  writeJson(IMAGE_QUEUE_FILE, imageQueue);
  writeJson(OCR_QUEUE_FILE, ocrQueue);
  writeJson(COMBINED_QUEUE_FILE, combinedQueue);
  writeJson(SUMMARY_FILE, summary);

  console.log('Source-text salvage queues built');
  console.log(`  Image queue:       ${imageQueue.length}`);
  console.log(`  MedMCQA OCR queue: ${ocrQueue.length}`);
  console.log(`  Combined queue:    ${combinedQueue.length}`);
  console.log(`  Summary:           ${SUMMARY_FILE}`);
}

main();
