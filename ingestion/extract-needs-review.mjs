import { mkdirSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DATA_FILE = join(__dirname, '..', 'public', 'data', 'compiled_cases.json');
const REPORT_FILE = join(__dirname, 'output', 'quality_report.json');
const OUTPUT_DIR = join(__dirname, 'output', 'needs_review_batches');
const BATCH_SIZE = 20;
const MODEL = process.env.OPENAI_BATCH_MODEL || 'gpt-4.1-mini';
const JSON_RESPONSE_FORMAT =
  '{"_id": "...", "correct_option_id": "...", "confidence": "HIGH|MEDIUM|LOW", "rationale": "..."}';
const SYSTEM_PROMPTS = {
  no_correct_answer:
    `You are a medical exam expert. Determine the single best answer for this question when the source data does not contain a reliable marked correct answer. Return JSON: ${JSON_RESPONSE_FORMAT}`,
  truncated_options:
    `You are a medical exam expert. One or more answer options may be incomplete because of parsing issues. Verify the best supported answer from the available context and options. Return JSON: ${JSON_RESPONSE_FORMAT}`,
  aota_suspect:
    `You are a medical exam expert. Check whether an "All of the Above" or "None of the Above" option is truly correct, then return the single best answer. Return JSON: ${JSON_RESPONSE_FORMAT}`,
  duplicate_options:
    `You are a medical exam expert. Some answer options may be duplicated. Determine the single best unique answer despite the duplication. Return JSON: ${JSON_RESPONSE_FORMAT}`,
  truncated_question:
    `You are a medical exam expert. The question stem may be truncated. Use the available context to determine the most likely single best answer. Return JSON: ${JSON_RESPONSE_FORMAT}`,
  no_options:
    `You are a medical exam expert. The case may be missing answer options. If there is not enough information to map a valid option id, return LOW confidence and an empty correct_option_id. Return JSON: ${JSON_RESPONSE_FORMAT}`,
  needs_review:
    `You are a medical exam expert. Review this question and determine the single best answer based on the available clinical context. Return JSON: ${JSON_RESPONSE_FORMAT}`,
};
const ISSUE_PRIORITY = [
  'no_correct_answer',
  'no_options',
  'duplicate_options',
  'aota_suspect',
  'truncated_options',
  'truncated_question',
];
const QUARANTINE_REASON_TO_ISSUE = {
  duplicate: 'duplicate_options',
  no_option_text: 'no_options',
};

function normalizeWhitespace(value) {
  return String(value ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function writeTextAtomically(filePath, value) {
  const tempFile = `${filePath}.tmp`;
  writeFileSync(tempFile, value, 'utf8');
  renameSync(tempFile, filePath);
}

function clearBatchOutput(directory) {
  mkdirSync(directory, { recursive: true });

  for (const entry of readdirSync(directory)) {
    if (/^batch_\d+\.jsonl$/i.test(entry)) {
      unlinkSync(join(directory, entry));
    }
  }
}

function getQuestionText(caseRecord) {
  const candidates = [
    caseRecord.question,
    caseRecord.vignette?.narrative,
    caseRecord.title,
    caseRecord.prompt,
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

function getOptions(caseRecord) {
  return Array.isArray(caseRecord.options) ? caseRecord.options : [];
}

function hasNoMarkedCorrectAnswer(caseRecord) {
  const options = getOptions(caseRecord);
  return options.length > 0 && !options.some((option) => option?.is_correct === true);
}

function hasNoOptions(caseRecord) {
  return getOptions(caseRecord).length === 0;
}

function hasDuplicateOptions(caseRecord) {
  const seen = new Set();

  for (const option of getOptions(caseRecord)) {
    const text = normalizeWhitespace(option?.text).toLowerCase();
    if (!text) {
      continue;
    }

    if (seen.has(text)) {
      return true;
    }

    seen.add(text);
  }

  return false;
}

function hasAotaOption(caseRecord) {
  return getOptions(caseRecord).some((option) =>
    /^(?:all|none) of the above\b/i.test(normalizeWhitespace(option?.text)),
  );
}

function hasTruncatedOptions(caseRecord) {
  if (caseRecord?.q_type === 'SCT') {
    return false;
  }

  return getOptions(caseRecord).some((option) => {
    const text = normalizeWhitespace(option?.text);
    return Boolean(text) && text.length < 3;
  });
}

function looksLikeTruncatedQuestion(caseRecord) {
  const questionText = getQuestionText(caseRecord);
  if (!questionText) {
    return false;
  }

  return questionText.length < 30 || /(?:\.\.\.|…)$/.test(questionText);
}

function buildIssueSets(report) {
  return Object.fromEntries(
    ISSUE_PRIORITY.map((issueType) => [issueType, new Set(report[issueType] ?? [])]),
  );
}

function getComparableIds(caseRecord) {
  return [caseRecord.hash_id, caseRecord._id, String(caseRecord._id)].filter(Boolean);
}

function resolveIssueType(caseRecord, issueSets) {
  const comparableIds = getComparableIds(caseRecord);

  for (const issueType of ISSUE_PRIORITY) {
    const issueSet = issueSets[issueType];
    if (comparableIds.some((candidate) => issueSet.has(candidate))) {
      return issueType;
    }
  }

  const quarantineReason = normalizeWhitespace(caseRecord?.meta?.quarantine_reason).toLowerCase();
  if (QUARANTINE_REASON_TO_ISSUE[quarantineReason]) {
    return QUARANTINE_REASON_TO_ISSUE[quarantineReason];
  }

  if (hasNoOptions(caseRecord)) {
    return 'no_options';
  }
  if (hasNoMarkedCorrectAnswer(caseRecord)) {
    return 'no_correct_answer';
  }
  if (hasDuplicateOptions(caseRecord)) {
    return 'duplicate_options';
  }
  if (hasAotaOption(caseRecord)) {
    return 'aota_suspect';
  }
  if (hasTruncatedOptions(caseRecord)) {
    return 'truncated_options';
  }
  if (looksLikeTruncatedQuestion(caseRecord)) {
    return 'truncated_question';
  }

  return 'needs_review';
}

function getSystemPrompt(issueType) {
  return SYSTEM_PROMPTS[issueType] ?? SYSTEM_PROMPTS.needs_review;
}

function buildUserMessage(caseRecord, issueType) {
  const payload = {
    _id: String(caseRecord.hash_id ?? caseRecord._id),
    numeric_id: caseRecord._id,
    hash_id: caseRecord.hash_id ?? null,
    issue_type: issueType,
    q_type: caseRecord.q_type ?? 'MCQ',
    category: caseRecord.category ?? null,
    title: normalizeWhitespace(caseRecord.title),
    question: getQuestionText(caseRecord),
    options: Array.isArray(caseRecord.options)
      ? caseRecord.options.map((option) => ({
          id: String(option?.id ?? ''),
          text: normalizeWhitespace(option?.text),
        }))
      : [],
    rationale: getRationaleText(caseRecord),
    meta: {
      truncated: caseRecord.meta?.truncated === true,
      needs_review: caseRecord.meta?.needs_review === true,
      quarantine_reason: caseRecord.meta?.quarantine_reason ?? null,
    },
  };

  return [
    `Issue focus: ${issueType}.`,
    'Review this medical exam item and choose the single best answer for the issue described above.',
    'Ignore any current answer markers in the source data; they may be missing or incorrect.',
    'Return only the JSON object requested by the system prompt.',
    '',
    JSON.stringify(payload, null, 2),
  ].join('\n');
}

function formatCount(value) {
  return value.toLocaleString('en-US');
}

function chunkItems(items, size) {
  const chunks = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

async function main() {
  const [rawCases, rawReport] = await Promise.all([
    readFile(DATA_FILE, 'utf8'),
    readFile(REPORT_FILE, 'utf8'),
  ]);

  const cases = JSON.parse(rawCases);
  const report = JSON.parse(rawReport);
  const issueSets = buildIssueSets(report);
  const reviewCases = cases.filter((caseRecord) => caseRecord?.meta?.needs_review === true);

  const grouped = new Map();
  for (const issueType of [...ISSUE_PRIORITY, 'needs_review']) {
    grouped.set(issueType, []);
  }

  for (const caseRecord of reviewCases) {
    const issueType = resolveIssueType(caseRecord, issueSets);
    grouped.get(issueType).push(caseRecord);
  }

  clearBatchOutput(OUTPUT_DIR);

  let batchIndex = 0;
  const summary = {
    total_cases: reviewCases.length,
    total_batches: 0,
    model: MODEL,
    batch_size: BATCH_SIZE,
    by_issue_type: {},
  };

  for (const issueType of [...ISSUE_PRIORITY, 'needs_review']) {
    const casesForIssue = grouped.get(issueType) ?? [];
    if (casesForIssue.length === 0) {
      continue;
    }

    casesForIssue.sort((left, right) =>
      String(left.hash_id ?? left._id).localeCompare(String(right.hash_id ?? right._id)),
    );

    const chunks = chunkItems(casesForIssue, BATCH_SIZE);
    summary.by_issue_type[issueType] = {
      cases: casesForIssue.length,
      batches: chunks.length,
    };

    for (const chunk of chunks) {
      batchIndex += 1;
      const fileName = `batch_${String(batchIndex).padStart(3, '0')}.jsonl`;
      const filePath = join(OUTPUT_DIR, fileName);
      const lines = chunk.map((caseRecord) =>
        JSON.stringify({
          custom_id: `needs-review|${issueType}|${caseRecord.hash_id ?? caseRecord._id}`,
          method: 'POST',
          url: '/v1/chat/completions',
          body: {
            model: MODEL,
            temperature: 0,
            response_format: { type: 'json_object' },
            messages: [
              { role: 'system', content: getSystemPrompt(issueType) },
              { role: 'user', content: buildUserMessage(caseRecord, issueType) },
            ],
          },
        }),
      );

      writeTextAtomically(filePath, `${lines.join('\n')}\n`);
    }
  }

  summary.total_batches = batchIndex;

  console.log(`Extracted ${formatCount(summary.total_cases)} cases into ${formatCount(summary.total_batches)} batch files.`);
  for (const issueType of Object.keys(summary.by_issue_type)) {
    const issueSummary = summary.by_issue_type[issueType];
    console.log(
      `  ${issueType}: ${formatCount(issueSummary.cases)} cases across ${formatCount(issueSummary.batches)} batch files`,
    );
  }
}

main().catch((error) => {
  console.error('[needs-review extractor] Failed:', error);
  process.exitCode = 1;
});
