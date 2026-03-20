import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DATA_FILE = join(__dirname, '..', 'public', 'data', 'compiled_cases.json');
const NEGATIVE_STEM_REGEX = /\b(?:except|false|incorrect|not|least|wrong|not true|not correct)\b/i;
const LANGUAGE_KEYWORDS = {
  es: ['paciente', 'años', 'tratamiento', 'diagnóstico', 'embarazo', 'mujer', 'hombre', 'fiebre'],
  id: ['pasien', 'tahun', 'pemeriksaan', 'diagnosis', 'keluhan', 'nyeri', 'hamil', 'demam'],
  fr: ['traitement', 'douleur', 'fièvre', 'grossesse', 'antécédents', 'depuis'],
};
const QUALITY_BUCKETS = [
  ['0-20', 0, 20],
  ['21-40', 21, 40],
  ['41-60', 41, 60],
  ['61-80', 61, 80],
  ['81-100', 81, 100],
];

function normalizeWhitespace(value) {
  return String(value ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizeComparable(value) {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function ensureMeta(caseRecord) {
  if (!caseRecord.meta || typeof caseRecord.meta !== 'object') {
    caseRecord.meta = {};
  }

  return caseRecord.meta;
}

function writeJsonAtomically(filePath, value) {
  mkdirSync(dirname(filePath), { recursive: true });
  const tempFile = `${filePath}.tmp`;
  writeFileSync(tempFile, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(tempFile, filePath);
}

function formatCount(value) {
  return value.toLocaleString('en-US');
}

function getStemText(caseRecord) {
  const candidates = [
    caseRecord.question,
    caseRecord.vignette?.narrative,
    caseRecord.prompt,
    caseRecord.title,
  ];

  for (const candidate of candidates) {
    const normalized = normalizeWhitespace(candidate);
    if (normalized) {
      return normalized;
    }
  }

  return '';
}

function getRationaleText(caseRecord) {
  if (typeof caseRecord.rationale === 'string') {
    return normalizeWhitespace(caseRecord.rationale);
  }

  if (
    caseRecord.rationale &&
    typeof caseRecord.rationale === 'object' &&
    typeof caseRecord.rationale.correct === 'string'
  ) {
    return normalizeWhitespace(caseRecord.rationale.correct);
  }

  return '';
}

function getVignetteLengthBucket(length) {
  if (length < 100) {
    return 'short';
  }
  if (length <= 500) {
    return 'medium';
  }
  return 'long';
}

function countKeywordHits(text, keywords) {
  const paddedText = ` ${normalizeComparable(text)} `;
  let hits = 0;

  for (const keyword of keywords) {
    const normalizedKeyword = normalizeComparable(keyword);
    if (normalizedKeyword && paddedText.includes(` ${normalizedKeyword} `)) {
      hits += 1;
    }
  }

  return hits;
}

function detectLanguage(caseRecord) {
  const combinedText = [
    caseRecord.question,
    caseRecord.vignette?.narrative,
    caseRecord.prompt,
    ...(Array.isArray(caseRecord.options) ? caseRecord.options.map((option) => option?.text) : []),
  ].filter(Boolean).join(' ');

  const scores = Object.fromEntries(
    Object.entries(LANGUAGE_KEYWORDS).map(([language, keywords]) => [
      language,
      countKeywordHits(combinedText, keywords),
    ]),
  );

  const nonZeroLanguages = Object.entries(scores).filter(([, score]) => score > 0);
  if (nonZeroLanguages.length === 0) {
    return 'en';
  }

  if (nonZeroLanguages.length > 1) {
    return 'mixed';
  }

  return nonZeroLanguages[0][0];
}

function hasCorrectAnswer(caseRecord) {
  return Array.isArray(caseRecord.options) && caseRecord.options.some((option) => option?.is_correct === true);
}

function hasDemographics(caseRecord) {
  const demographics = caseRecord?.vignette?.demographics;
  if (!demographics || typeof demographics !== 'object') {
    return false;
  }

  return Object.values(demographics).some((value) => normalizeWhitespace(value));
}

function hasTopicTags(meta) {
  return (
    (typeof meta.organ_system === 'string' && meta.organ_system !== 'general') ||
    (Array.isArray(meta.topic_keywords) && meta.topic_keywords.length > 0) ||
    Boolean(normalizeWhitespace(meta.topic))
  );
}

function calculateQualityScore(caseRecord, meta, stemLength, rationaleLength, optionCount) {
  let score = 0;

  if (hasCorrectAnswer(caseRecord)) score += 25;
  if (rationaleLength > 50) score += 25;
  if (meta.truncated !== true) score += 15;
  if (optionCount >= 4 && optionCount <= 5) score += 10;
  if (stemLength > 100) score += 10;
  if (hasDemographics(caseRecord)) score += 5;
  if (hasTopicTags(meta)) score += 5;
  if (meta.needs_review !== true) score += 5;

  return score;
}

function main() {
  const cases = JSON.parse(readFileSync(DATA_FILE, 'utf8'));
  const histogram = Object.fromEntries(QUALITY_BUCKETS.map(([label]) => [label, 0]));
  const languageDistribution = { en: 0, es: 0, id: 0, fr: 0, mixed: 0 };

  for (const caseRecord of cases) {
    const meta = ensureMeta(caseRecord);
    const stemText = getStemText(caseRecord);
    const rationaleText = getRationaleText(caseRecord);
    const optionCount = Array.isArray(caseRecord.options) ? caseRecord.options.length : 0;
    const language = detectLanguage(caseRecord);
    const qualityScore = calculateQualityScore(
      caseRecord,
      meta,
      stemText.length,
      rationaleText.length,
      optionCount,
    );

    meta.vignette_length = getVignetteLengthBucket(stemText.length);
    meta.language = language;
    meta.option_count = optionCount;
    meta.negative_stem = NEGATIVE_STEM_REGEX.test(stemText);
    meta.quality_score = qualityScore;

    for (const [label, min, max] of QUALITY_BUCKETS) {
      if (qualityScore >= min && qualityScore <= max) {
        histogram[label] += 1;
        break;
      }
    }

    languageDistribution[language] += 1;
  }

  writeJsonAtomically(DATA_FILE, cases);

  console.log('=== METADATA ENRICHMENT ===');
  console.log(`Cases scanned: ${formatCount(cases.length)}`);
  console.log('Quality score histogram:');
  for (const [label] of QUALITY_BUCKETS) {
    console.log(`  ${label}: ${formatCount(histogram[label])}`);
  }
  console.log('Language distribution:');
  for (const [language, count] of Object.entries(languageDistribution)) {
    console.log(`  ${language}: ${formatCount(count)}`);
  }
}

main();
