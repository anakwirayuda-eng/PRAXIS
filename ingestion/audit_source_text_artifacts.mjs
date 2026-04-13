import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');

const DATA_FILE = join(ROOT, 'public', 'data', 'compiled_cases.json');
const REPORT_FILE = join(ROOT, 'ingestion', 'output', 'source_text_artifact_audit.json');

const BUCKETS = {
  restored_source_wrapper: {
    lane: 'auto_fix',
    confidence: 'high',
    description: 'Raw `[RESTORED SOURCE]` wrapper still present in display text.',
    regex: /\[RESTORED SOURCE\]/i,
  },
  html_wrapper: {
    lane: 'auto_fix',
    confidence: 'high',
    description: 'Residual HTML wrappers such as `<p>` or `<br>` still present in display text.',
    regex: /<\/p\b|<\\p>|<p(?:\s[^>]*)?>|<br\s*\/?>/i,
  },
  amp_semi_residual: {
    lane: 'auto_fix',
    confidence: 'high',
    description: 'Residual broken `&;` artifact that escaped the main text normalizer.',
    regex: /&;/,
  },
  image_dependent_phrase: {
    lane: 'manual_or_ai',
    confidence: 'high',
    description: 'Stem or explanation still depends on an image/figure/x-ray reference.',
    regex: /\b(?:according to (?:the )?(?:image|figure|photograph|x-ray|scan)|question linked to image|as shown in (?:the )?(?:image|figure)|see (?:the )?(?:image|figure)|given (?:image|figure|x-ray)|based on the image)\b/i,
  },
  ocr_punctuation_candidate: {
    lane: 'manual_or_ai',
    confidence: 'low',
    description: 'Likely OCR punctuation or source-splicing artifact inside narrative/rationale text.',
    regex: /\b[A-Za-z]\.[A-Za-z]{3,}\b/,
  },
};

const OCR_SKIP_TOKENS = new Set([
  'E.coli',
  'H.influenza',
  'M.bovis',
  'M.furfur',
  'P.versicolor',
  'S.dysenteriae',
  'V.cholerae',
]);

function ensureDir(dirPath) {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
  }
}

function writeJson(filePath, value) {
  ensureDir(dirname(filePath));
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function compactText(value, limit = 180) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit);
}

function collectFields(caseRecord) {
  const fields = [
    ['title', caseRecord.title ?? ''],
    ['prompt', caseRecord.prompt ?? ''],
    ['question', caseRecord.question ?? ''],
  ];

  const vignette = caseRecord.vignette;
  if (typeof vignette === 'string') {
    fields.push(['vignette', vignette]);
  } else if (vignette && typeof vignette === 'object') {
    fields.push(['vignette.narrative', vignette.narrative ?? '']);
    fields.push(['vignette.labFindings', vignette.labFindings ?? '']);
  }

  if (typeof caseRecord.rationale === 'string') {
    fields.push(['rationale', caseRecord.rationale]);
  } else if (caseRecord.rationale && typeof caseRecord.rationale === 'object') {
    fields.push(['rationale.correct', caseRecord.rationale.correct ?? '']);
    fields.push(['rationale.pearl', caseRecord.rationale.pearl ?? '']);
    for (const [key, value] of Object.entries(caseRecord.rationale.distractors ?? {})) {
      fields.push([`rationale.distractors.${key}`, value ?? '']);
    }
  }

  for (let index = 0; index < (caseRecord.options ?? []).length; index += 1) {
    fields.push([`options.${index}.text`, caseRecord.options[index]?.text ?? '']);
  }

  return fields.filter(([, value]) => typeof value === 'string' && value.trim().length > 0);
}

function shouldSkipOcrCandidate(fieldPath, token) {
  if (fieldPath.startsWith('options.')) {
    return true;
  }
  return OCR_SKIP_TOKENS.has(token);
}

function summarizeBucket(items) {
  const bySource = {};
  const affectedCases = new Set();

  for (const item of items) {
    affectedCases.add(String(item._id));
    bySource[item.source] = (bySource[item.source] || 0) + 1;
  }

  return {
    field_hits: items.length,
    affected_cases: affectedCases.size,
    by_source: Object.fromEntries(
      Object.entries(bySource)
        .sort((left, right) => right[1] - left[1])
        .slice(0, 12),
    ),
    samples: items.slice(0, 20),
  };
}

function main() {
  const cases = JSON.parse(readFileSync(DATA_FILE, 'utf8'));
  const hits = Object.fromEntries(Object.keys(BUCKETS).map((name) => [name, []]));

  for (const caseRecord of cases) {
    const source = compactText(caseRecord?.meta?.source || caseRecord?.source || 'unknown', 64);
    for (const [fieldPath, text] of collectFields(caseRecord)) {
      for (const [bucketName, bucket] of Object.entries(BUCKETS)) {
        const match = text.match(bucket.regex);
        if (!match) {
          continue;
        }

        const token = match[0];
        if (bucketName === 'ocr_punctuation_candidate' && shouldSkipOcrCandidate(fieldPath, token)) {
          continue;
        }

        hits[bucketName].push({
          _id: caseRecord._id,
          case_code: caseRecord.case_code ?? '',
          source,
          field: fieldPath,
          token,
          sample: compactText(text),
        });
      }
    }
  }

  const report = {
    generated_at: new Date().toISOString(),
    total_cases: cases.length,
    notes: [
      'This audit focuses on post-normalization source-text roughness outside the main `&;` runtime fix.',
      'Auto-fix buckets are suitable for deterministic cleanup. Manual/AI buckets still need content-aware rewriting or image recovery.',
      'The OCR punctuation bucket is heuristic and intentionally marked low-confidence; use it as a shortlist, not an automatic rewrite target.',
    ],
    buckets: Object.fromEntries(
      Object.entries(BUCKETS).map(([name, bucket]) => [
        name,
        {
          lane: bucket.lane,
          confidence: bucket.confidence,
          description: bucket.description,
          ...summarizeBucket(hits[name]),
        },
      ]),
    ),
  };

  writeJson(REPORT_FILE, report);

  console.log('Source text artifact audit complete');
  console.log(`  Total cases: ${cases.length}`);
  for (const [name, bucket] of Object.entries(report.buckets)) {
    console.log(`  ${name}: ${bucket.affected_cases} cases`);
  }
  console.log(`  Report: ${REPORT_FILE}`);
}

main();
