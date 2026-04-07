import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createCasebankRepository } from '../server/casebank-repository.js';
import { openCasebankDb } from '../server/casebank-db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DATA_FILE = join(__dirname, '..', 'public', 'data', 'compiled_cases.json');
const PACK_DIR = join(__dirname, 'output', 'readability_ai_packs', 'readability-ai-adjudication-wave1');
const MANIFEST_FILE = join(PACK_DIR, 'manifest.json');
const RESULTS_DIR = join(PACK_DIR, 'results');
const NORMALIZED_RESULTS_DIR = join(PACK_DIR, 'results_normalized');
const REPORT_FILE = join(__dirname, 'output', 'readability_ai_wave1_apply_report.json');

const TARGET_SOURCES = new Set(['aipki-ugm', 'medqa', 'polish-ldek-en']);
const ACCEPTED_DECISIONS = new Set(['PASS', 'HOLD']);
const ACCEPTED_CONFIDENCE = new Set(['HIGH', 'MEDIUM']);
const RESULT_FILE_NAMES = [
  'answer_key_adjudication.jsonl',
  'needs_review_adjudication.jsonl',
  'ambiguity_rewrite.jsonl',
];

const PLACEHOLDER_PATTERNS = [
  /^see reference/i,
  /^explanation unavailable/i,
  /^no explanation available/i,
  /^refer to textbook/i,
  /^not available/i,
  /^n\/a$/i,
  /^-$/,
  /^\.$/,
  /^none$/i,
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
    .replace(/[^\p{L}\p{N}+-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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
  if (direct && typeof direct === 'object' && !Array.isArray(direct)) {
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
    const combined = chatContent
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

  const output = entry?.response?.body?.output;
  if (Array.isArray(output)) {
    const combined = output
      .flatMap((item) => item?.content ?? [])
      .map((part) => normalizeWhitespace(part?.text ?? part?.content ?? ''))
      .filter(Boolean)
      .join('\n');
    if (combined) {
      return combined;
    }
  }

  return '';
}

function writeJsonAtomically(filePath, value, pretty = true) {
  const tempFile = `${filePath}.tmp`;
  const payload = pretty
    ? `${JSON.stringify(value, null, 2)}\n`
    : JSON.stringify(value);
  writeFileSync(tempFile, payload, 'utf8');
  renameSync(tempFile, filePath);
}

function decodeMaybeDigitDump(rawText) {
  const trimmed = String(rawText ?? '').trim();
  if (!trimmed) {
    return '';
  }

  if (!/^[0-9\s]+$/.test(trimmed)) {
    return String(rawText ?? '');
  }

  const numbers = trimmed.split(/\s+/).filter(Boolean);
  const bytes = Buffer.from(numbers.map((value) => Number(value)));
  return bytes.toString('utf8');
}

function ensureMeta(caseRecord) {
  if (!caseRecord.meta || typeof caseRecord.meta !== 'object' || Array.isArray(caseRecord.meta)) {
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
    caseRecord.rationale.correct = caseRecord.rationale.correct == null
      ? ''
      : String(caseRecord.rationale.correct);
  }

  if (typeof caseRecord.rationale.pearl !== 'string') {
    caseRecord.rationale.pearl = caseRecord.rationale.pearl == null
      ? ''
      : String(caseRecord.rationale.pearl);
  }

  return caseRecord.rationale;
}

function getNarrative(caseRecord) {
  if (typeof caseRecord?.vignette === 'string') {
    return normalizeWhitespace(caseRecord.vignette);
  }
  if (caseRecord?.vignette && typeof caseRecord.vignette === 'object' && !Array.isArray(caseRecord.vignette)) {
    return normalizeWhitespace(caseRecord.vignette.narrative);
  }
  return '';
}

function setNarrative(caseRecord, nextNarrative) {
  const normalized = normalizeWhitespace(nextNarrative);
  if (typeof caseRecord?.vignette === 'string') {
    if (normalizeWhitespace(caseRecord.vignette) === normalized) {
      return false;
    }
    caseRecord.vignette = normalized;
    return true;
  }

  if (!caseRecord.vignette || typeof caseRecord.vignette !== 'object' || Array.isArray(caseRecord.vignette)) {
    caseRecord.vignette = {};
  }

  if (normalizeWhitespace(caseRecord.vignette.narrative) === normalized) {
    return false;
  }

  caseRecord.vignette.narrative = normalized;
  return true;
}

function resolveOptionIndex(options, rawAnswer) {
  if (!Array.isArray(options) || options.length === 0) {
    return -1;
  }

  const normalizedAnswer = normalizeWhitespace(rawAnswer);
  if (!normalizedAnswer) {
    return -1;
  }

  const uppercaseAnswer = normalizedAnswer.toUpperCase();
  const letter = uppercaseAnswer.startsWith('OP') ? uppercaseAnswer.slice(2) : uppercaseAnswer;

  let index = options.findIndex((option) => {
    const optionId = normalizeWhitespace(option?.id).toUpperCase();
    return optionId === uppercaseAnswer || optionId === letter || optionId === `OP${letter}`;
  });
  if (index >= 0) {
    return index;
  }

  if (/^[A-Z]$/.test(letter)) {
    index = letter.charCodeAt(0) - 65;
    if (index >= 0 && index < options.length) {
      return index;
    }
  }

  const comparableAnswer = normalizeComparable(normalizedAnswer);
  return options.findIndex((option) => normalizeComparable(option?.text) === comparableAnswer);
}

function setSingleCorrectOption(options, targetIndex) {
  let changed = false;
  for (let index = 0; index < options.length; index += 1) {
    const shouldBeCorrect = index === targetIndex;
    if (Boolean(options[index]?.is_correct) !== shouldBeCorrect) {
      options[index].is_correct = shouldBeCorrect;
      changed = true;
    }
  }
  return changed;
}

function clearReviewFlags(meta) {
  let changed = false;
  const removals = ['review_conflict', 'needs_review_reason', 'needs_review_reasons', 'review_queue'];
  if (meta.needs_review !== false) {
    meta.needs_review = false;
    changed = true;
  }
  for (const key of removals) {
    if (key in meta) {
      delete meta[key];
      changed = true;
    }
  }
  return changed;
}

function isRationaleStub(value) {
  const normalized = normalizeWhitespace(value);
  if (!normalized) {
    return true;
  }

  if (PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return true;
  }

  return normalized.length < 80
    || /^ans(?:wer)?[\s:.]/i.test(normalized)
    || /^s\s*['"`(]?[a-e]['"`)]?\s*i\.?e\.?/i.test(normalized)
    || /^\[restored source\]\s*ans/i.test(normalized);
}

function refreshRationaleIfNeeded(caseRecord, candidateText, meta, stats, sourceKey, countStats = true) {
  const rationale = ensureRationale(caseRecord);
  const normalizedCandidate = normalizeWhitespace(candidateText);
  if (!normalizedCandidate || !isRationaleStub(rationale.correct)) {
    return false;
  }

  if (normalizeWhitespace(rationale.correct) === normalizedCandidate) {
    return false;
  }

  rationale.correct = normalizedCandidate;
  meta.readability_ai_rationale_refreshed = true;
  meta.readability_ai_rationale_source = sourceKey;
  if (countStats) {
    stats.rationales_refreshed += 1;
  }
  return true;
}

function setReadabilityPass(meta, basis, now) {
  let changed = false;
  if (meta.readability_ai_pass !== true) {
    meta.readability_ai_pass = true;
    changed = true;
  }
  if (meta.readability_ai_basis !== basis) {
    meta.readability_ai_basis = basis;
    changed = true;
  }
  if (meta.readability_ai_pass_at !== now) {
    meta.readability_ai_pass_at = now;
    changed = true;
  }

  for (const key of [
    'readability_ai_hold',
    'readability_ai_hold_basis',
    'readability_ai_hold_at',
    'readability_ai_hold_reasoning',
    'readability_ai_hold_notes',
  ]) {
    if (key in meta) {
      delete meta[key];
      changed = true;
    }
  }

  return changed;
}

function setReadabilityHold(meta, hold, basis, reasoning, notes, now) {
  let changed = false;
  if (meta.readability_ai_hold !== hold) {
    meta.readability_ai_hold = hold;
    changed = true;
  }
  if (meta.readability_ai_hold_basis !== basis) {
    meta.readability_ai_hold_basis = basis;
    changed = true;
  }
  if (meta.readability_ai_hold_at !== now) {
    meta.readability_ai_hold_at = now;
    changed = true;
  }
  if (normalizeWhitespace(reasoning) && meta.readability_ai_hold_reasoning !== normalizeWhitespace(reasoning)) {
    meta.readability_ai_hold_reasoning = normalizeWhitespace(reasoning);
    changed = true;
  }
  if (normalizeWhitespace(notes) && meta.readability_ai_hold_notes !== normalizeWhitespace(notes)) {
    meta.readability_ai_hold_notes = normalizeWhitespace(notes);
    changed = true;
  }

  for (const key of ['readability_ai_pass', 'readability_ai_basis', 'readability_ai_pass_at']) {
    if (key in meta) {
      delete meta[key];
      changed = true;
    }
  }

  return changed;
}

function applyAnswer(caseRecord, answerValue, meta, stats, answerSource, countStats = true) {
  const targetIndex = resolveOptionIndex(caseRecord.options, answerValue);
  if (targetIndex === -1) {
    return { changed: false, invalid: true };
  }

  const changed = setSingleCorrectOption(caseRecord.options, targetIndex);
  if (changed) {
    meta.readability_ai_answer_source = answerSource;
    if (countStats) {
      stats.answer_fixes += 1;
    }
  }

  return { changed, invalid: false };
}

function mutateCasePair(dbCase, jsonCase, mutator) {
  let changed = false;
  changed = mutator(dbCase, true) || changed;
  changed = mutator(jsonCase, false) || changed;
  return changed;
}

function buildBasis(result) {
  return `openai-batch-wave1:${result.playbook}:${result.confidence.toLowerCase()}`;
}

function detectContamination(reasoning) {
  const normalized = normalizeWhitespace(reasoning).toLowerCase();
  return /merged into one question|two separate|source contamination|overlapping option ids|multiple vignettes/.test(normalized);
}

function determineHoldType(result) {
  if (result.playbook === 'answer_key_adjudication') {
    return detectContamination(result.reasoning) ? 'source_contamination' : 'answer_key_unresolved';
  }
  if (result.playbook === 'ambiguity_rewrite') {
    return 'rewrite_required';
  }
  return 'needs_editor_review';
}

function applyRewrite(caseRecord, result, stats, countStats = true) {
  let changed = false;
  const rewrittenPrompt = normalizeWhitespace(result.rewritten_prompt);
  if (rewrittenPrompt && normalizeWhitespace(caseRecord.prompt) !== rewrittenPrompt) {
    caseRecord.prompt = rewrittenPrompt;
    if (countStats) {
      stats.prompt_rewrites += 1;
    }
    changed = true;
  }

  const rewrittenNarrative = normalizeWhitespace(result.rewritten_narrative);
  if (rewrittenNarrative && getNarrative(caseRecord) !== rewrittenNarrative) {
    if (setNarrative(caseRecord, rewrittenNarrative)) {
      if (countStats) {
        stats.narrative_rewrites += 1;
      }
      changed = true;
    }
  }

  return changed;
}

function touchReviewMeta(meta, result, now) {
  let changed = false;
  const updates = {
    review_confidence: result.confidence,
    review_source: 'openai-batch-wave1',
    reviewed_at: now,
    readability_ai_batch: 'wave1',
    readability_ai_playbook: result.playbook,
    ai_audited: true,
    reviewed: true,
  };

  for (const [key, value] of Object.entries(updates)) {
    if (meta[key] !== value) {
      meta[key] = value;
      changed = true;
    }
  }

  if (normalizeWhitespace(result.reasoning) && meta.review_rationale !== normalizeWhitespace(result.reasoning)) {
    meta.review_rationale = normalizeWhitespace(result.reasoning);
    changed = true;
  }
  if (normalizeWhitespace(result.rewrite_notes) && meta.readability_ai_rewrite_notes !== normalizeWhitespace(result.rewrite_notes)) {
    meta.readability_ai_rewrite_notes = normalizeWhitespace(result.rewrite_notes);
    changed = true;
  }

  return changed;
}

function normalizeResultEntry(entry, fileName) {
  const customId = normalizeWhitespace(entry?.custom_id);
  const parts = customId.split('|');
  if (parts.length < 4) {
    return null;
  }

  const [, playbook, source, customCaseId] = parts;
  if (!TARGET_SOURCES.has(source)) {
    return null;
  }

  const payload = extractFirstJsonObject(extractResponseText(entry));
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null;
  }

  const caseId = normalizeWhitespace(payload._id || customCaseId);
  const decision = normalizeWhitespace(payload.decision).toUpperCase();
  const confidence = normalizeWhitespace(payload.confidence).toUpperCase();
  if (!caseId || !ACCEPTED_DECISIONS.has(decision) || !ACCEPTED_CONFIDENCE.has(confidence)) {
    return null;
  }

  return {
    caseId,
    source,
    playbook,
    decision,
    confidence,
    correct_option_id: normalizeWhitespace(payload.correct_option_id),
    reasoning: normalizeWhitespace(payload.reasoning),
    rewritten_prompt: normalizeWhitespace(payload.rewritten_prompt),
    rewritten_narrative: normalizeWhitespace(payload.rewritten_narrative),
    rewrite_notes: normalizeWhitespace(payload.rewrite_notes),
    source_file: fileName,
  };
}

function readBatchResults(stats) {
  if (!existsSync(RESULTS_DIR)) {
    throw new Error(`Missing results directory: ${RESULTS_DIR}`);
  }

  mkdirSync(NORMALIZED_RESULTS_DIR, { recursive: true });
  const entries = [];

  for (const fileName of RESULT_FILE_NAMES) {
    const filePath = join(RESULTS_DIR, fileName);
    if (!existsSync(filePath)) {
      stats.files_missing.push(fileName);
      continue;
    }

    const raw = readFileSync(filePath, 'utf8');
    const decoded = decodeMaybeDigitDump(raw);
    writeFileSync(join(NORMALIZED_RESULTS_DIR, fileName), decoded, 'utf8');
    stats.files_scanned += 1;

    const lines = decoded
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

      const normalized = normalizeResultEntry(entry, fileName);
      if (!normalized) {
        stats.skipped_invalid_payload += 1;
        continue;
      }

      entries.push(normalized);
    }
  }

  return entries;
}

function main() {
  const manifest = safeJsonParse(readFileSync(MANIFEST_FILE, 'utf8')) || {};
  const now = new Date().toISOString();

  const stats = {
    generated_at: now,
    manifest_pack: manifest.pack_name || 'readability-ai-adjudication-wave1',
    files_scanned: 0,
    lines_scanned: 0,
    parse_errors: 0,
    skipped_invalid_payload: 0,
    files_missing: [],
    results_loaded: 0,
    pass_results: 0,
    hold_results: 0,
    answer_fixes: 0,
    prompt_rewrites: 0,
    narrative_rewrites: 0,
    rationales_refreshed: 0,
    pass_applied: 0,
    hold_marked: 0,
    invalid_option_ids: 0,
    missing_cases: 0,
    source_mismatches: 0,
    modified_json_cases: 0,
    modified_db_cases: 0,
    unchanged_results: 0,
    by_source: {},
    by_playbook: {},
    by_decision: {},
    unresolved_sample: [],
  };

  const results = readBatchResults(stats);
  stats.results_loaded = results.length;

  const jsonCases = safeJsonParse(readFileSync(DATA_FILE, 'utf8')) || [];
  const jsonCaseMap = new Map(jsonCases.map((caseRecord) => [String(caseRecord._id), caseRecord]));

  const repo = createCasebankRepository(openCasebankDb());
  const dbCases = repo.getAllCases();
  const dbCaseMap = new Map(dbCases.map((caseRecord) => [String(caseRecord._id), caseRecord]));

  const modifiedDbIds = new Set();
  const modifiedJsonIds = new Set();

  for (const result of results) {
    stats.by_source[result.source] = (stats.by_source[result.source] || 0) + 1;
    stats.by_playbook[result.playbook] = (stats.by_playbook[result.playbook] || 0) + 1;
    stats.by_decision[result.decision] = (stats.by_decision[result.decision] || 0) + 1;

    if (result.decision === 'PASS') {
      stats.pass_results += 1;
    } else if (result.decision === 'HOLD') {
      stats.hold_results += 1;
    }

    const jsonCase = jsonCaseMap.get(result.caseId);
    const dbCase = dbCaseMap.get(result.caseId);
    if (!jsonCase || !dbCase) {
      stats.missing_cases += 1;
      stats.unresolved_sample.push({ _id: result.caseId, source: result.source, reason: 'case_missing_in_one_backend' });
      continue;
    }

    const jsonSource = normalizeWhitespace(jsonCase.meta?.source || jsonCase.source);
    const dbSource = normalizeWhitespace(dbCase.meta?.source || dbCase.source);
    if ((jsonSource && jsonSource !== result.source) || (dbSource && dbSource !== result.source)) {
      stats.source_mismatches += 1;
      stats.unresolved_sample.push({
        _id: result.caseId,
        source: result.source,
        reason: 'source_mismatch',
        json_source: jsonSource,
        db_source: dbSource,
      });
      continue;
    }

    let caseChanged = false;
    if (result.decision === 'PASS') {
      caseChanged = mutateCasePair(dbCase, jsonCase, (caseRecord, countStats) => {
        const meta = ensureMeta(caseRecord);
        let changed = false;

        const answerResult = applyAnswer(caseRecord, result.correct_option_id, meta, stats, 'openai-batch-wave1', countStats);
        if (answerResult.invalid) {
          return false;
        }

        changed = answerResult.changed || changed;
        changed = clearReviewFlags(meta) || changed;
        changed = touchReviewMeta(meta, result, now) || changed;
        changed = setReadabilityPass(meta, buildBasis(result), now) || changed;
        changed = applyRewrite(caseRecord, result, stats, countStats) || changed;
        changed = refreshRationaleIfNeeded(caseRecord, result.reasoning, meta, stats, 'openai-batch-wave1', countStats) || changed;
        return changed;
      }) || caseChanged;

      if (!caseChanged && resolveOptionIndex(jsonCase.options, result.correct_option_id) === -1) {
        stats.invalid_option_ids += 1;
        stats.unresolved_sample.push({
          _id: result.caseId,
          source: result.source,
          playbook: result.playbook,
          reason: 'invalid_option_id',
          correct_option_id: result.correct_option_id,
        });
        continue;
      }

      if (caseChanged) {
        stats.pass_applied += 1;
      } else {
        stats.unchanged_results += 1;
      }
    } else {
      caseChanged = mutateCasePair(dbCase, jsonCase, (caseRecord) => {
        const meta = ensureMeta(caseRecord);
        let changed = false;
        const holdType = determineHoldType(result);

        if (meta.needs_review !== true) {
          meta.needs_review = true;
          changed = true;
        }
        if (detectContamination(result.reasoning) && meta.needs_review_reason !== 'source_contamination_detected') {
          meta.needs_review_reason = 'source_contamination_detected';
          changed = true;
        }

        changed = touchReviewMeta(meta, result, now) || changed;
        changed = setReadabilityHold(meta, holdType, buildBasis(result), result.reasoning, result.rewrite_notes, now) || changed;
        return changed;
      }) || caseChanged;

      if (caseChanged) {
        stats.hold_marked += 1;
      } else {
        stats.unchanged_results += 1;
      }
    }

    if (caseChanged) {
      modifiedDbIds.add(result.caseId);
      modifiedJsonIds.add(result.caseId);
    }
  }

  const modifiedDbCases = [...modifiedDbIds]
    .map((caseId) => dbCaseMap.get(caseId))
    .filter(Boolean);
  if (modifiedDbCases.length > 0) {
    repo.updateCaseSnapshots(modifiedDbCases);
  }
  repo.close();

  if (modifiedJsonIds.size > 0) {
    writeJsonAtomically(DATA_FILE, jsonCases, true);
  }

  stats.modified_db_cases = modifiedDbCases.length;
  stats.modified_json_cases = modifiedJsonIds.size;
  stats.unresolved_sample = stats.unresolved_sample.slice(0, 50);

  writeJsonAtomically(REPORT_FILE, stats, true);

  console.log('Wave 1 AI adjudication apply complete');
  console.log(`  Results loaded:        ${stats.results_loaded}`);
  console.log(`  PASS results:          ${stats.pass_results}`);
  console.log(`  HOLD results:          ${stats.hold_results}`);
  console.log(`  PASS applied:          ${stats.pass_applied}`);
  console.log(`  HOLD marked:           ${stats.hold_marked}`);
  console.log(`  Answer fixes:          ${stats.answer_fixes}`);
  console.log(`  Prompt rewrites:       ${stats.prompt_rewrites}`);
  console.log(`  Narrative rewrites:    ${stats.narrative_rewrites}`);
  console.log(`  Rationales refreshed:  ${stats.rationales_refreshed}`);
  console.log(`  Invalid option IDs:    ${stats.invalid_option_ids}`);
  console.log(`  Missing cases:         ${stats.missing_cases}`);
  console.log(`  Source mismatches:     ${stats.source_mismatches}`);
  console.log(`  Modified DB cases:     ${stats.modified_db_cases}`);
  console.log(`  Modified JSON cases:   ${stats.modified_json_cases}`);
  console.log(`  Report:                ${REPORT_FILE}`);
}

main();
