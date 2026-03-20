import { existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DATA_FILE = join(__dirname, '..', 'public', 'data', 'compiled_cases.json');
const RESULTS_DIR = join(__dirname, 'output', 'needs_review_results');
const TRUSTED_ID_FAMILIES = new Set([
  'answer_audit',
  'contradict',
  'contradiction_audit_medexpqa',
  'contradiction_v2',
  'enrich',
  'fase2',
  'fix_trunc',
  'quality',
  'triangulate',
  'ukmppd_pdf_oracle',
]);
const RATIONALE_FAMILIES = new Set([
  'contradict',
  'enrich',
  'fix_trunc',
  'quality',
  'triangulate',
  'ukmppd_pdf_oracle',
]);

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
    .replace(/[^\p{L}\p{N}+-]+/gu, ' ')
    .replace(/\s+/g, ' ')
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

function ensureRationale(caseRecord) {
  if (!caseRecord.rationale || typeof caseRecord.rationale !== 'object' || Array.isArray(caseRecord.rationale)) {
    const correct = typeof caseRecord.rationale === 'string' ? caseRecord.rationale : '';
    caseRecord.rationale = {
      correct,
      distractors: {},
      pearl: '',
    };
  }

  if (!caseRecord.rationale.distractors || typeof caseRecord.rationale.distractors !== 'object') {
    caseRecord.rationale.distractors = {};
  }

  if (typeof caseRecord.rationale.correct !== 'string') {
    caseRecord.rationale.correct = caseRecord.rationale.correct == null ? '' : String(caseRecord.rationale.correct);
  }

  if (typeof caseRecord.rationale.pearl !== 'string') {
    caseRecord.rationale.pearl = caseRecord.rationale.pearl == null ? '' : String(caseRecord.rationale.pearl);
  }

  return caseRecord.rationale;
}

function ensureVignette(caseRecord) {
  if (!caseRecord.vignette || typeof caseRecord.vignette !== 'object') {
    caseRecord.vignette = {
      demographics: { age: null, sex: null },
      narrative: '',
      vitalSigns: null,
      labFindings: null,
    };
  }

  return caseRecord.vignette;
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
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

function extractFirstJsonObject(text) {
  const stripped = stripCodeFence(text);
  const direct = safeJsonParse(stripped);
  if (direct && typeof direct === 'object') {
    return direct;
  }

  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    return null;
  }

  return safeJsonParse(stripped.slice(start, end + 1));
}

function extractResponseText(entry) {
  const chatContent = entry?.response?.body?.choices?.[0]?.message?.content;
  if (typeof chatContent === 'string') {
    return normalizeWhitespace(chatContent);
  }

  if (Array.isArray(chatContent)) {
    return chatContent
      .map((part) => normalizeWhitespace(part?.text ?? part?.content ?? ''))
      .filter(Boolean)
      .join('\n');
  }

  const outputText = entry?.response?.body?.output_text;
  if (typeof outputText === 'string') {
    return normalizeWhitespace(outputText);
  }

  const output = entry?.response?.body?.output;
  if (Array.isArray(output)) {
    return output
      .flatMap((item) => item?.content ?? [])
      .map((part) => normalizeWhitespace(part?.text ?? part?.content ?? ''))
      .filter(Boolean)
      .join('\n');
  }

  return '';
}

function parseCustomId(customId, parsedPayload) {
  const normalized = normalizeWhitespace(customId);
  const parsedId = normalizeWhitespace(parsedPayload?._id);
  if (parsedId) {
    const family = normalized.includes('|')
      ? normalized.split('|')[0]
      : normalized.replace(/[|_-]?[A-Za-z]*\d*$/, '').replace(/[_-]$/, '') || normalized;
    return { customId: normalized, family, caseId: parsedId };
  }

  if (normalized.includes('|')) {
    const parts = normalized.split('|').map((part) => normalizeWhitespace(part));
    return {
      customId: normalized,
      family: parts[0] || 'pipe',
      caseId: parts[parts.length - 1] || '',
    };
  }

  const suffixIdMatch = normalized.match(/^(.*?)[_-]((?:[a-z]+qa_\d+)|(?:medexpqa_\d+)|(?:headqa_\d+)|(?:\d+))$/i);
  if (suffixIdMatch) {
    return {
      customId: normalized,
      family: suffixIdMatch[1] || normalized,
      caseId: suffixIdMatch[2],
    };
  }

  const numericTailMatch = normalized.match(/(\d+)\s*$/);
  if (numericTailMatch) {
    const family = normalized.slice(0, numericTailMatch.index).replace(/[_-]+$/, '') || normalized;
    return {
      customId: normalized,
      family,
      caseId: numericTailMatch[1],
    };
  }

  return { customId: normalized, family: normalized, caseId: '' };
}

function getPrimaryStem(caseRecord) {
  return normalizeWhitespace(
    caseRecord.question
    || caseRecord.prompt
    || caseRecord.vignette?.narrative
    || caseRecord.title,
  );
}

function tokenizeComparable(value) {
  return normalizeComparable(value)
    .split(' ')
    .filter((token) => token.length >= 3);
}

function stemsLookAligned(caseStem, payloadStem) {
  const normalizedCaseStem = normalizeComparable(caseStem);
  const normalizedPayloadStem = normalizeComparable(payloadStem);
  if (!normalizedCaseStem || !normalizedPayloadStem) {
    return false;
  }

  const shorter = normalizedCaseStem.length <= normalizedPayloadStem.length
    ? normalizedCaseStem
    : normalizedPayloadStem;
  const longer = shorter === normalizedCaseStem ? normalizedPayloadStem : normalizedCaseStem;

  if (shorter.length >= 24 && longer.includes(shorter)) {
    return true;
  }

  const caseTokens = new Set(tokenizeComparable(normalizedCaseStem));
  const payloadTokens = new Set(tokenizeComparable(normalizedPayloadStem));
  if (caseTokens.size === 0 || payloadTokens.size === 0) {
    return false;
  }

  let overlap = 0;
  for (const token of caseTokens) {
    if (payloadTokens.has(token)) {
      overlap += 1;
    }
  }

  const smallerSetSize = Math.min(caseTokens.size, payloadTokens.size);
  return smallerSetSize > 0 && overlap / smallerSetSize >= 0.6;
}

function getPayloadStem(payload) {
  return normalizeWhitespace(
    payload?.question
    || payload?.reconstructed_vignette
    || payload?.improved_vignette
    || payload?.scenario,
  );
}

function hasExplicitPayloadId(payload) {
  return Boolean(normalizeWhitespace(payload?._id));
}

function isTrustedFamily(family) {
  return TRUSTED_ID_FAMILIES.has(family);
}

function isPayloadAligned(caseRecord, family, payload) {
  if (hasExplicitPayloadId(payload)) {
    return true;
  }

  if (isTrustedFamily(family)) {
    return true;
  }

  const payloadStem = getPayloadStem(payload);
  if (!payloadStem) {
    return false;
  }

  return stemsLookAligned(getPrimaryStem(caseRecord), payloadStem);
}

function normalizeConfidence(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value >= 4) return 'HIGH';
    if (value >= 2) return 'MEDIUM';
    return 'LOW';
  }

  const normalized = normalizeWhitespace(value).toUpperCase();
  if (normalized === 'HIGH' || normalized === 'MEDIUM' || normalized === 'LOW') {
    return normalized;
  }

  return '';
}

function hasHighEnoughConfidence(payload) {
  const confidence = normalizeConfidence(payload?.confidence);
  if (!confidence) {
    return true;
  }

  return confidence === 'HIGH';
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

function deriveTitle(text) {
  const normalized = normalizeWhitespace(text);
  if (!normalized) {
    return '';
  }

  return normalized.length > 80 ? `${normalized.slice(0, 77).trimEnd()}...` : normalized;
}

function resolveOptionIndex(caseRecord, rawAnswer) {
  if (!Array.isArray(caseRecord.options) || caseRecord.options.length === 0) {
    return -1;
  }

  const normalizedAnswer = normalizeWhitespace(rawAnswer);
  if (!normalizedAnswer) {
    return -1;
  }

  const comparableAnswer = normalizeComparable(normalizedAnswer);
  const uppercaseAnswer = normalizedAnswer.toUpperCase();

  let index = caseRecord.options.findIndex(
    (option) => normalizeWhitespace(option?.id).toUpperCase() === uppercaseAnswer,
  );
  if (index >= 0) {
    return index;
  }

  if (/^[A-Z]$/.test(uppercaseAnswer)) {
    index = uppercaseAnswer.charCodeAt(0) - 65;
    if (index >= 0 && index < caseRecord.options.length) {
      return index;
    }
  }

  if (/^\d+$/.test(normalizedAnswer)) {
    index = Number.parseInt(normalizedAnswer, 10) - 1;
    if (index >= 0 && index < caseRecord.options.length) {
      return index;
    }
  }

  index = caseRecord.options.findIndex(
    (option) => normalizeComparable(option?.text) === comparableAnswer,
  );
  if (index >= 0) {
    return index;
  }

  return -1;
}

function mergeDistractors(target, incoming) {
  if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
    return false;
  }

  let changed = false;
  for (const [key, value] of Object.entries(incoming)) {
    const normalizedKey = normalizeWhitespace(key);
    const normalizedValue = normalizeWhitespace(value);
    if (!normalizedKey) {
      continue;
    }

    if (target[normalizedKey] !== normalizedValue) {
      target[normalizedKey] = normalizedValue;
      changed = true;
    }
  }

  return changed;
}

function getSupportedActions(caseRecord, family, payload) {
  const actions = [];
  const rationaleTextCandidates = [
    payload?.correct_rationale,
    payload?.correctRationale,
    payload?.explanation,
    RATIONALE_FAMILIES.has(family) ? payload?.rationale : '',
  ];
  const rationaleText = rationaleTextCandidates
    .map((value) => normalizeWhitespace(value))
    .find((value) => value);
  if (rationaleText) {
    actions.push({ type: 'rationale.correct', value: rationaleText });
  }

  if (payload?.distractors && typeof payload.distractors === 'object' && !Array.isArray(payload.distractors)) {
    actions.push({ type: 'rationale.distractors', value: payload.distractors });
  }

  const pearl = normalizeWhitespace(payload?.clinical_pearl || payload?.pearl);
  if (pearl) {
    actions.push({ type: 'rationale.pearl', value: pearl });
  }

  const answerCandidates = [
    payload?.resolved_answer,
    payload?.correct_option_id,
    payload?.correct_answer,
    payload?.answer,
  ];
  if (caseRecord.q_type === 'SCT') {
    answerCandidates.push(payload?.correct_direction);
  }

  const answerValue = answerCandidates
    .map((value) => normalizeWhitespace(value))
    .find((value) => value);
  if (answerValue) {
    actions.push({ type: 'answer', value: answerValue });
  }

  const reconstructedVignette = normalizeWhitespace(payload?.reconstructed_vignette);
  if (reconstructedVignette && payload?.is_recoverable === true) {
    actions.push({ type: 'vignette', value: reconstructedVignette });
  }

  const improvedVignette = normalizeWhitespace(payload?.improved_vignette);
  if (improvedVignette) {
    actions.push({ type: 'vignette', value: improvedVignette });
  }

  return actions;
}

function applyActions(caseRecord, family, payload, stats) {
  const actions = getSupportedActions(caseRecord, family, payload);
  if (actions.length === 0) {
    return { changed: false, reason: 'no_supported_fields' };
  }

  if (!hasHighEnoughConfidence(payload)) {
    return { changed: false, reason: 'low_confidence' };
  }

  let changed = false;
  const meta = ensureMeta(caseRecord);
  let rationale;

  for (const action of actions) {
    if (action.type.startsWith('rationale.')) {
      rationale = rationale || ensureRationale(caseRecord);
    }

    if (action.type === 'rationale.correct') {
      if (normalizeWhitespace(rationale.correct) !== action.value) {
        rationale.correct = action.value;
        changed = true;
        stats.by_action.rationale_correct += 1;
      }
      continue;
    }

    if (action.type === 'rationale.distractors') {
      if (mergeDistractors(rationale.distractors, action.value)) {
        changed = true;
        stats.by_action.rationale_distractors += 1;
      }
      continue;
    }

    if (action.type === 'rationale.pearl') {
      if (normalizeWhitespace(rationale.pearl) !== action.value) {
        rationale.pearl = action.value;
        changed = true;
        stats.by_action.rationale_pearl += 1;
      }
      continue;
    }

    if (action.type === 'answer') {
      const optionIndex = resolveOptionIndex(caseRecord, action.value);
      if (optionIndex === -1) {
        stats.skipped.invalid_answer += 1;
        continue;
      }

      if (setSingleCorrectOption(caseRecord.options, optionIndex)) {
        changed = true;
        stats.by_action.answer += 1;
      }
      continue;
    }

    if (action.type === 'vignette') {
      const vignette = ensureVignette(caseRecord);
      const nextText = action.value;
      const currentNarrative = normalizeWhitespace(vignette.narrative);
      const currentPrompt = normalizeWhitespace(caseRecord.prompt);
      const currentQuestion = normalizeWhitespace(caseRecord.question);

      if (currentNarrative !== nextText) {
        vignette.narrative = nextText;
        changed = true;
      }
      if (!currentPrompt || meta.truncated === true) {
        if (currentPrompt !== nextText) {
          caseRecord.prompt = nextText;
          changed = true;
        }
      }
      if (!currentQuestion || meta.truncated === true) {
        if (currentQuestion !== nextText) {
          caseRecord.question = nextText;
          changed = true;
        }
      }

      const nextTitle = deriveTitle(nextText);
      if (nextTitle && normalizeWhitespace(caseRecord.title) !== nextTitle) {
        caseRecord.title = nextTitle;
        changed = true;
      }

      if (meta.truncated === true) {
        meta.truncated = false;
        changed = true;
      }

      if (changed) {
        meta.truncated_recovered = true;
        stats.by_action.vignette += 1;
      }
    }
  }

  if (!changed) {
    return { changed: false, reason: 'already_applied' };
  }

  meta.batch_review_applied = true;
  meta.batch_review_source = family;

  return { changed: true, reason: 'applied' };
}

function main() {
  if (!existsSync(RESULTS_DIR)) {
    console.log(`Result directory not found: ${RESULTS_DIR}`);
    return;
  }

  const resultFiles = readdirSync(RESULTS_DIR)
    .filter((name) => extname(name).toLowerCase() === '.jsonl')
    .sort((left, right) => left.localeCompare(right));

  if (resultFiles.length === 0) {
    console.log(`No result files found in ${RESULTS_DIR}`);
    return;
  }

  const cases = JSON.parse(readFileSync(DATA_FILE, 'utf8'));
  const caseMap = new Map();
  for (const caseRecord of cases) {
    caseMap.set(String(caseRecord._id), caseRecord);
    if (caseRecord.hash_id) {
      caseMap.set(String(caseRecord.hash_id), caseRecord);
    }
  }

  const stats = {
    files_scanned: resultFiles.length,
    lines_scanned: 0,
    parsed_payloads: 0,
    applied_cases: 0,
    skipped_cases: 0,
    errors: 0,
    unknown_case: 0,
    skipped: {
      no_supported_fields: 0,
      low_confidence: 0,
      mismatched_prompt: 0,
      already_applied: 0,
      invalid_answer: 0,
    },
    by_action: {
      rationale_correct: 0,
      rationale_distractors: 0,
      rationale_pearl: 0,
      answer: 0,
      vignette: 0,
    },
    by_batch: {},
  };

  let mutated = false;

  for (const fileName of resultFiles) {
    const lines = readFileSync(join(RESULTS_DIR, fileName), 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    stats.lines_scanned += lines.length;

    for (const line of lines) {
      const entry = safeJsonParse(line);
      if (!entry) {
        stats.errors += 1;
        continue;
      }

      const responseText = extractResponseText(entry);
      if (!responseText) {
        stats.skipped_cases += 1;
        stats.skipped.no_supported_fields += 1;
        continue;
      }

      const payload = extractFirstJsonObject(responseText);
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        stats.errors += 1;
        continue;
      }

      stats.parsed_payloads += 1;

      const parsedId = parseCustomId(entry.custom_id, payload);
      const family = parsedId.family || 'unknown';

      if (!stats.by_batch[family]) {
        stats.by_batch[family] = {
          lines: 0,
          applied: 0,
          skipped: 0,
          unknown_case: 0,
          errors: 0,
        };
      }
      stats.by_batch[family].lines += 1;

      const caseRecord = caseMap.get(parsedId.caseId);
      if (!caseRecord) {
        stats.unknown_case += 1;
        stats.by_batch[family].unknown_case += 1;
        continue;
      }

      if (!isPayloadAligned(caseRecord, family, payload)) {
        stats.skipped_cases += 1;
        stats.skipped.mismatched_prompt += 1;
        stats.by_batch[family].skipped += 1;
        continue;
      }

      const beforeInvalidAnswer = stats.skipped.invalid_answer;
      const result = applyActions(caseRecord, family, payload, stats);
      if (result.changed) {
        mutated = true;
        stats.applied_cases += 1;
        stats.by_batch[family].applied += 1;
        continue;
      }

      stats.skipped_cases += 1;
      if (Object.prototype.hasOwnProperty.call(stats.skipped, result.reason)) {
        stats.skipped[result.reason] += 1;
      }
      if (stats.skipped.invalid_answer > beforeInvalidAnswer && result.reason === 'already_applied') {
        // invalid answer was already counted inside applyActions; keep the result summary stable.
      }
      stats.by_batch[family].skipped += 1;
    }
  }

  if (mutated) {
    writeJsonAtomically(DATA_FILE, cases);
  }

  console.log('=== FLEXIBLE BATCH APPLY ===');
  console.log(`Files scanned: ${stats.files_scanned.toLocaleString('en-US')}`);
  console.log(`Lines scanned: ${stats.lines_scanned.toLocaleString('en-US')}`);
  console.log(`Parsed payloads: ${stats.parsed_payloads.toLocaleString('en-US')}`);
  console.log(`Applied cases: ${stats.applied_cases.toLocaleString('en-US')}`);
  console.log(`Skipped cases: ${stats.skipped_cases.toLocaleString('en-US')}`);
  console.log(`Unknown cases: ${stats.unknown_case.toLocaleString('en-US')}`);
  console.log(`Errors: ${stats.errors.toLocaleString('en-US')}`);
  console.log('Applied actions:');
  console.log(`  rationale.correct: ${stats.by_action.rationale_correct.toLocaleString('en-US')}`);
  console.log(`  rationale.distractors: ${stats.by_action.rationale_distractors.toLocaleString('en-US')}`);
  console.log(`  rationale.pearl: ${stats.by_action.rationale_pearl.toLocaleString('en-US')}`);
  console.log(`  answer fixes: ${stats.by_action.answer.toLocaleString('en-US')}`);
  console.log(`  vignette fixes: ${stats.by_action.vignette.toLocaleString('en-US')}`);
  console.log('Skipped reasons:');
  console.log(`  no supported fields: ${stats.skipped.no_supported_fields.toLocaleString('en-US')}`);
  console.log(`  low confidence: ${stats.skipped.low_confidence.toLocaleString('en-US')}`);
  console.log(`  mismatched prompt: ${stats.skipped.mismatched_prompt.toLocaleString('en-US')}`);
  console.log(`  already applied: ${stats.skipped.already_applied.toLocaleString('en-US')}`);
  console.log(`  invalid answer target: ${stats.skipped.invalid_answer.toLocaleString('en-US')}`);
  console.log('By batch family:');
  for (const [family, familyStats] of Object.entries(stats.by_batch).sort((left, right) => right[1].applied - left[1].applied)) {
    console.log(
      `  ${family}: lines=${familyStats.lines.toLocaleString('en-US')}, applied=${familyStats.applied.toLocaleString('en-US')}, skipped=${familyStats.skipped.toLocaleString('en-US')}, unknown=${familyStats.unknown_case.toLocaleString('en-US')}`,
    );
  }
}

main();
