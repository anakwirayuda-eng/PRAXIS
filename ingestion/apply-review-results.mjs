import { existsSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DATA_FILE = join(__dirname, '..', 'public', 'data', 'compiled_cases.json');
const RESULTS_DIR = join(__dirname, 'output', 'needs_review_results');
const HIGH = 'HIGH';
const CONFIDENCE_RANK = {
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
};

function normalizeWhitespace(value) {
  return String(value ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function writeJsonAtomically(filePath, value) {
  const tempFile = `${filePath}.tmp`;
  writeFileSync(tempFile, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(tempFile, filePath);
}

function ensureMeta(caseRecord) {
  if (!caseRecord.meta || typeof caseRecord.meta !== 'object') {
    caseRecord.meta = {};
  }

  return caseRecord.meta;
}

function extractCustomId(entry) {
  return normalizeWhitespace(entry?.custom_id ?? entry?.customId);
}

function extractResponseText(entry) {
  const chatContent = entry?.response?.body?.choices?.[0]?.message?.content;
  if (typeof chatContent === 'string') {
    return normalizeWhitespace(chatContent);
  }

  if (Array.isArray(chatContent)) {
    const combined = chatContent
      .map((part) => normalizeWhitespace(part?.text ?? part?.content ?? ''))
      .filter(Boolean)
      .join('\n');
    if (combined) {
      return combined;
    }
  }

  const responseOutput = entry?.response?.body?.output;
  if (Array.isArray(responseOutput)) {
    const combined = responseOutput
      .flatMap((item) => item?.content ?? [])
      .map((part) => normalizeWhitespace(part?.text ?? part?.content ?? ''))
      .filter(Boolean)
      .join('\n');
    if (combined) {
      return combined;
    }
  }

  const outputText = entry?.response?.body?.output_text;
  if (typeof outputText === 'string') {
    return normalizeWhitespace(outputText);
  }

  return '';
}

function stripCodeFence(text) {
  const trimmed = normalizeWhitespace(text);
  if (!trimmed.startsWith('```')) {
    return trimmed;
  }

  return trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function extractFirstJsonObject(text) {
  const stripped = stripCodeFence(text);
  const direct = safeJsonParse(stripped);
  if (direct) {
    return direct;
  }

  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    return null;
  }

  return safeJsonParse(stripped.slice(start, end + 1));
}

function normalizeConfidence(value) {
  const normalized = String(value ?? '').trim().toUpperCase();
  return normalized === 'HIGH' || normalized === 'MEDIUM' || normalized === 'LOW'
    ? normalized
    : null;
}

function parseCaseIdFromCustomId(customId) {
  const parts = String(customId ?? '').split('|');
  return parts.length >= 3 ? parts[parts.length - 1] : null;
}

function normalizeResult(entry, fileName) {
  const customId = extractCustomId(entry);
  if (entry?.error) {
    return { status: 'error', customId, fileName, reason: 'batch_error' };
  }

  const responseText = extractResponseText(entry);
  if (!responseText) {
    return { status: 'error', customId, fileName, reason: 'empty_response' };
  }

  const parsed = extractFirstJsonObject(responseText);
  if (!parsed || typeof parsed !== 'object') {
    return { status: 'error', customId, fileName, reason: 'invalid_json' };
  }

  const confidence = normalizeConfidence(parsed.confidence);
  const caseId = normalizeWhitespace(parsed._id) || parseCaseIdFromCustomId(customId);
  const correctOptionId = normalizeWhitespace(parsed.correct_option_id);
  const rationale = normalizeWhitespace(parsed.rationale);

  if (!caseId) {
    return { status: 'error', customId, fileName, reason: 'missing_case_id' };
  }

  if (!confidence) {
    return { status: 'error', customId, fileName, reason: 'invalid_confidence', caseId };
  }

  return {
    status: 'ok',
    customId,
    fileName,
    caseId,
    correctOptionId,
    confidence,
    rationale,
  };
}

function pickReviewVerdict(results) {
  const highResults = results.filter((result) => result.confidence === HIGH);
  if (highResults.length === 0) {
    return { action: 'keep_review', confidence: results[0]?.confidence ?? null };
  }

  const distinctOptionIds = [...new Set(highResults.map((result) => result.correctOptionId.toUpperCase()))];
  if (distinctOptionIds.length > 1) {
    return {
      action: 'conflict',
      confidence: HIGH,
      optionIds: distinctOptionIds,
    };
  }

  const winner = [...highResults].sort((left, right) => {
    const leftScore = CONFIDENCE_RANK[left.confidence] ?? 0;
    const rightScore = CONFIDENCE_RANK[right.confidence] ?? 0;
    return rightScore - leftScore || left.fileName.localeCompare(right.fileName);
  })[0];

  return {
    action: 'apply',
    confidence: HIGH,
    result: winner,
  };
}

function setSingleCorrectOption(options, correctIndex) {
  let changed = false;

  for (let index = 0; index < options.length; index += 1) {
    const shouldBeCorrect = index === correctIndex;
    if (Boolean(options[index]?.is_correct) !== shouldBeCorrect) {
      options[index].is_correct = shouldBeCorrect;
      changed = true;
    }
  }

  return changed;
}

async function main() {
  if (!existsSync(RESULTS_DIR)) {
    console.log(`Result directory not found: ${RESULTS_DIR}. Nothing to apply.`);
    return;
  }

  const resultFiles = readdirSync(RESULTS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && extname(entry.name).toLowerCase() === '.jsonl')
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));

  if (resultFiles.length === 0) {
    console.log(`No batch result files found in ${RESULTS_DIR}. Nothing to apply.`);
    return;
  }

  const rawCases = await readFile(DATA_FILE, 'utf8');
  const cases = JSON.parse(rawCases);
  const caseMap = new Map();

  for (const caseRecord of cases) {
    caseMap.set(String(caseRecord._id), caseRecord);
    if (caseRecord.hash_id) {
      caseMap.set(String(caseRecord.hash_id), caseRecord);
    }
  }

  const parsedResults = [];
  const stats = {
    files_scanned: resultFiles.length,
    lines_scanned: 0,
    parsed_ok: 0,
    parse_errors: 0,
    applied: 0,
    kept_for_review: 0,
    conflicts: 0,
    unknown_cases: 0,
    invalid_option_ids: 0,
  };

  for (const fileName of resultFiles) {
    const raw = await readFile(join(RESULTS_DIR, fileName), 'utf8');
    const lines = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    stats.lines_scanned += lines.length;

    for (const line of lines) {
      const entry = safeJsonParse(line);
      if (!entry) {
        stats.parse_errors += 1;
        continue;
      }

      const normalized = normalizeResult(entry, fileName);
      if (normalized.status !== 'ok') {
        stats.parse_errors += 1;
        continue;
      }

      stats.parsed_ok += 1;
      parsedResults.push(normalized);
    }
  }

  const resultsByCaseId = new Map();
  for (const result of parsedResults) {
    if (!resultsByCaseId.has(result.caseId)) {
      resultsByCaseId.set(result.caseId, []);
    }

    resultsByCaseId.get(result.caseId).push(result);
  }

  let mutated = false;

  for (const [caseId, results] of resultsByCaseId.entries()) {
    const caseRecord = caseMap.get(caseId);
    if (!caseRecord) {
      stats.unknown_cases += 1;
      continue;
    }

    const meta = ensureMeta(caseRecord);
    const verdict = pickReviewVerdict(results);

    if (verdict.action === 'keep_review') {
      meta.needs_review = true;
      meta.review_confidence = verdict.confidence;
      mutated = true;
      stats.kept_for_review += 1;
      continue;
    }

    if (verdict.action === 'conflict') {
      meta.needs_review = true;
      meta.review_confidence = verdict.confidence;
      meta.review_conflict = true;
      meta.review_source = 'openai-batch';
      mutated = true;
      stats.conflicts += 1;
      continue;
    }

    const winningResult = verdict.result;
    const optionIndex = Array.isArray(caseRecord.options)
      ? caseRecord.options.findIndex(
          (option) => String(option?.id ?? '').toUpperCase() === winningResult.correctOptionId.toUpperCase(),
        )
      : -1;

    if (optionIndex === -1) {
      meta.needs_review = true;
      meta.review_confidence = winningResult.confidence;
      meta.review_source = 'openai-batch';
      mutated = true;
      stats.invalid_option_ids += 1;
      continue;
    }

    const changedOptions = setSingleCorrectOption(caseRecord.options, optionIndex);
    const previousNeedsReview = meta.needs_review === true;
    meta.needs_review = false;
    meta.review_confidence = winningResult.confidence;
    meta.review_source = 'openai-batch';
    meta.reviewed_at = new Date().toISOString();
    if (winningResult.rationale) {
      meta.review_rationale = winningResult.rationale;
    }
    delete meta.review_conflict;

    if (changedOptions || previousNeedsReview) {
      mutated = true;
    }

    stats.applied += 1;
  }

  if (mutated) {
    writeJsonAtomically(DATA_FILE, cases);
  }

  console.log('=== APPLY REVIEW RESULTS ===');
  console.log(`Result files scanned: ${stats.files_scanned}`);
  console.log(`JSONL lines scanned: ${stats.lines_scanned}`);
  console.log(`Parsed responses: ${stats.parsed_ok}`);
  console.log(`Parse errors: ${stats.parse_errors}`);
  console.log(`Applied HIGH-confidence fixes: ${stats.applied}`);
  console.log(`Kept for review: ${stats.kept_for_review}`);
  console.log(`Conflicts: ${stats.conflicts}`);
  console.log(`Unknown cases: ${stats.unknown_cases}`);
  console.log(`Invalid option IDs: ${stats.invalid_option_ids}`);
  console.log(mutated ? 'compiled_cases.json updated.' : 'No case changes were written.');
}

main().catch((error) => {
  console.error('[apply-review-results] Failed:', error);
  process.exitCode = 1;
});
