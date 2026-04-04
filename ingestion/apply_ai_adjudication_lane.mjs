import { readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createCasebankRepository } from '../server/casebank-repository.js';
import { openCasebankDb } from '../server/casebank-db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DATA_FILE = join(__dirname, '..', 'public', 'data', 'compiled_cases.json');
const QUEUE_FILE = join(__dirname, 'output', 'readability_ai_adjudication_queue.json');
const REPORT_FILE = join(__dirname, 'output', 'readability_ai_adjudication_apply_report.json');
const RESULT_DIRS = [
  join(__dirname, 'output', 'needs_review_results'),
  join(__dirname, 'output', 'batch_results'),
];
const TARGET_SOURCES = new Set(['medmcqa', 'fk-leaked-ukmppd']);
const ADVISORY_AMBIGUITY_CODES = new Set([
  'aota_suspect',
  'negation_blindspot',
  'absolute_trap',
  'length_bias',
]);
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

  if (/^[A-E]$/.test(letter)) {
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

function clearQuarantineFlags(meta) {
  let changed = false;
  if (meta.quarantined === true) {
    meta.quarantined = false;
    changed = true;
  }
  if (meta.status) {
    delete meta.status;
    changed = true;
  }
  if (meta.quarantine_reason) {
    delete meta.quarantine_reason;
    changed = true;
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

function getPrimaryStem(caseRecord) {
  return normalizeWhitespace(
    caseRecord.prompt
      || caseRecord.question
      || caseRecord.vignette?.narrative
      || caseRecord.title,
  );
}

function correctCount(caseRecord) {
  return Array.isArray(caseRecord.options)
    ? caseRecord.options.filter((option) => option?.is_correct === true).length
    : 0;
}

function isPlayable(caseRecord) {
  const meta = caseRecord.meta || {};
  return meta.needs_review !== true
    && meta.truncated !== true
    && meta.quarantined !== true
    && !String(meta.status || '').startsWith('QUARANTINED');
}

function collectExplicitReviewResults(targetIds) {
  const reviewResults = new Map();

  for (const directory of RESULT_DIRS) {
    let files = [];
    try {
      files = readdirSync(directory)
        .filter((name) => extname(name).toLowerCase() === '.jsonl')
        .sort((left, right) => left.localeCompare(right));
    } catch {
      continue;
    }

    for (const fileName of files) {
      const raw = readFileSync(join(directory, fileName), 'utf8');
      const lines = raw
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

      for (const line of lines) {
        const entry = safeJsonParse(line);
        if (!entry) continue;

        const payload = extractFirstJsonObject(extractResponseText(entry));
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) continue;

        const caseId = normalizeWhitespace(payload._id);
        const correctOptionId = normalizeWhitespace(payload.correct_option_id);
        if (!caseId || !correctOptionId || !targetIds.has(caseId)) continue;

        const confidence = normalizeWhitespace(payload.confidence).toUpperCase();
        if (!['HIGH', 'MEDIUM'].includes(confidence)) continue;

        const existing = reviewResults.get(caseId);
        if (existing && existing.confidence === 'HIGH' && confidence !== 'HIGH') {
          continue;
        }

        reviewResults.set(caseId, {
          confidence,
          correct_option_id: correctOptionId,
          reasoning: normalizeWhitespace(payload.reasoning),
          source_file: fileName,
        });
      }
    }
  }

  return reviewResults;
}

function refreshRationaleIfNeeded(caseRecord, candidateText, meta, stats, sourceKey) {
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
  stats.rationales_refreshed += 1;
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
  if (meta.readability_ai_hold) {
    delete meta.readability_ai_hold;
    changed = true;
  }
  if (meta.readability_ai_hold_basis) {
    delete meta.readability_ai_hold_basis;
    changed = true;
  }
  if (meta.readability_ai_hold_at) {
    delete meta.readability_ai_hold_at;
    changed = true;
  }
  return changed;
}

function setReadabilityHold(meta, hold, basis, now) {
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
  if (meta.readability_ai_pass === true) {
    delete meta.readability_ai_pass;
    changed = true;
  }
  if (meta.readability_ai_basis) {
    delete meta.readability_ai_basis;
    changed = true;
  }
  if (meta.readability_ai_pass_at) {
    delete meta.readability_ai_pass_at;
    changed = true;
  }
  return changed;
}

function applyAnswer(caseRecord, answerValue, meta, stats, answerSource) {
  const targetIndex = resolveOptionIndex(caseRecord.options, answerValue);
  if (targetIndex === -1) {
    return { changed: false, invalid: true };
  }

  const changed = setSingleCorrectOption(caseRecord.options, targetIndex);
  if (changed) {
    meta.readability_ai_answer_source = answerSource;
    stats.answer_fixes += 1;
  }

  return { changed, invalid: false };
}

function mutateCasePair(dbCase, jsonCase, mutator) {
  let changed = false;
  changed = mutator(dbCase) || changed;
  changed = mutator(jsonCase) || changed;
  return changed;
}

function shouldPassAdvisoryAmbiguity(item, meta, reviewResult) {
  const reasonCodes = new Set(item.reason_codes || []);
  const onlyAdvisory = [...reasonCodes].every((code) => ADVISORY_AMBIGUITY_CODES.has(code));
  if (!onlyAdvisory) {
    return false;
  }

  const verdict = normalizeWhitespace(meta.fase2_verdict).toUpperCase();
  return Boolean(
    reviewResult
      || meta._openclaw_t9_v2 === true
      || meta._openclaw_t9_verified === true
      || normalizeWhitespace(meta.clinical_consensus).startsWith('AI_')
      || verdict === 'NONE'
      || verdict === 'MINOR',
  );
}

function choosePassBasis(meta, reviewResult) {
  if (reviewResult) {
    return `openai-batch:${reviewResult.confidence.toLowerCase()}`;
  }
  if (meta._openclaw_t9_v2 === true || meta._openclaw_t9_verified === true) {
    return 'openclaw-t9';
  }
  if (normalizeWhitespace(meta.clinical_consensus).startsWith('AI_')) {
    return `clinical-consensus:${normalizeWhitespace(meta.clinical_consensus)}`;
  }
  const verdict = normalizeWhitespace(meta.fase2_verdict).toUpperCase();
  if (verdict === 'NONE' || verdict === 'MINOR') {
    return `fase2:${verdict.toLowerCase()}`;
  }
  return 'ai-adjudicated';
}

function applyIntegrityHolds(caseRecord, meta, stats) {
  let changed = false;

  if (isPlayable(caseRecord) && correctCount(caseRecord) !== 1) {
    if (meta.needs_review !== true) {
      meta.needs_review = true;
      changed = true;
    }
    if (meta.needs_review_reason !== 'integrity_multiple_correct_answers') {
      meta.needs_review_reason = 'integrity_multiple_correct_answers';
      changed = true;
    }
    meta.readability_integrity_hold = true;
    stats.integrity_holds.multiple_correct += 1;
  }

  if (isPlayable(caseRecord) && getPrimaryStem(caseRecord).length < 10) {
    if (meta.truncated !== true) {
      meta.truncated = true;
      changed = true;
    }
    meta.readability_integrity_hold = true;
    stats.integrity_holds.short_primary_stem += 1;
  }

  return changed;
}

function main() {
  const now = new Date().toISOString();
  const queue = safeJsonParse(readFileSync(QUEUE_FILE, 'utf8')) || [];
  const targetQueue = queue.filter((item) => TARGET_SOURCES.has(item.source));
  const targetIds = new Set(targetQueue.map((item) => String(item._id)));
  const reviewResults = collectExplicitReviewResults(targetIds);

  const jsonCases = safeJsonParse(readFileSync(DATA_FILE, 'utf8')) || [];
  const jsonCaseMap = new Map(jsonCases.map((caseRecord) => [String(caseRecord._id), caseRecord]));

  const repo = createCasebankRepository(openCasebankDb());
  const dbCases = repo.getAllCases();
  const dbCaseMap = new Map(dbCases.map((caseRecord) => [String(caseRecord._id), caseRecord]));

  const modifiedDbIds = new Set();
  const modifiedJsonIds = new Set();
  const stats = {
    scanned_queue_items: targetQueue.length,
    review_results_loaded: reviewResults.size,
    fk_cleared: 0,
    med_passed: 0,
    med_held_fatal: 0,
    med_held_rewrite: 0,
    answer_fixes: 0,
    rationales_refreshed: 0,
    integrity_holds: {
      multiple_correct: 0,
      short_primary_stem: 0,
    },
    unresolved: [],
  };

  for (const item of targetQueue) {
    const caseId = String(item._id);
    const jsonCase = jsonCaseMap.get(caseId);
    const dbCase = dbCaseMap.get(caseId);
    if (!jsonCase || !dbCase) {
      stats.unresolved.push({ _id: item._id, source: item.source, reason: 'case_missing_in_one_backend' });
      continue;
    }

    const reviewResult = reviewResults.get(caseId) || null;
    const meta = dbCase.meta || {};
    const fase2Verdict = normalizeWhitespace(meta.fase2_verdict).toUpperCase();
    const safeFase2 = fase2Verdict === 'NONE' || fase2Verdict === 'MINOR';
    const advisoryPass = item.playbook === 'ambiguity_rewrite' && shouldPassAdvisoryAmbiguity(item, meta, reviewResult);

    let caseChanged = false;

    if (item.source === 'fk-leaked-ukmppd') {
      if (!reviewResult) {
        stats.unresolved.push({ _id: item._id, source: item.source, reason: 'missing_explicit_review_result' });
      } else {
        caseChanged = mutateCasePair(dbCase, jsonCase, (caseRecord) => {
          const caseMeta = ensureMeta(caseRecord);
          let changed = false;
          const answerResult = applyAnswer(caseRecord, reviewResult.correct_option_id, caseMeta, stats, 'openai-batch');
          if (answerResult.invalid) {
            return false;
          }
          changed = answerResult.changed || changed;
          changed = clearReviewFlags(caseMeta) || changed;
          changed = clearQuarantineFlags(caseMeta) || changed;
          caseMeta.review_source = 'openai-batch';
          caseMeta.review_confidence = reviewResult.confidence;
          caseMeta.ai_audited = true;
          caseMeta.reviewed = true;
          changed = setReadabilityPass(caseMeta, `openai-batch:${reviewResult.confidence.toLowerCase()}`, now) || changed;
          changed = refreshRationaleIfNeeded(caseRecord, reviewResult.reasoning || caseMeta.review_rationale, caseMeta, stats, 'openai-batch') || changed;
          return changed;
        }) || caseChanged;

        if (caseChanged) {
          stats.fk_cleared += 1;
        }
      }
    } else if (item.source === 'medmcqa') {
      if (fase2Verdict === 'FATAL') {
        caseChanged = mutateCasePair(dbCase, jsonCase, (caseRecord) => {
          const caseMeta = ensureMeta(caseRecord);
          return setReadabilityHold(caseMeta, 'fatal', reviewResult ? `fase2+openai-batch:${reviewResult.confidence.toLowerCase()}` : 'fase2:fatal', now);
        }) || caseChanged;
        if (caseChanged) {
          stats.med_held_fatal += 1;
        }
      } else if (item.playbook === 'answer_key_adjudication' || item.playbook === 'needs_review_adjudication') {
        if (reviewResult || safeFase2) {
          caseChanged = mutateCasePair(dbCase, jsonCase, (caseRecord) => {
            const caseMeta = ensureMeta(caseRecord);
            let changed = false;

            if (reviewResult) {
              const answerResult = applyAnswer(caseRecord, reviewResult.correct_option_id, caseMeta, stats, 'openai-batch');
              if (answerResult.invalid) {
                return false;
              }
              changed = answerResult.changed || changed;
            } else if (normalizeWhitespace(caseMeta.fase2_correct)) {
              const answerResult = applyAnswer(caseRecord, caseMeta.fase2_correct, caseMeta, stats, 'fase2');
              if (!answerResult.invalid) {
                changed = answerResult.changed || changed;
              }
            }

            changed = clearReviewFlags(caseMeta) || changed;
            changed = clearQuarantineFlags(caseMeta) || changed;
            changed = setReadabilityPass(caseMeta, choosePassBasis(caseMeta, reviewResult), now) || changed;
            changed = refreshRationaleIfNeeded(
              caseRecord,
              reviewResult?.reasoning || caseMeta.fase2_reasoning,
              caseMeta,
              stats,
              reviewResult ? 'openai-batch' : 'fase2',
            ) || changed;
            return changed;
          }) || caseChanged;

          if (caseChanged) {
            stats.med_passed += 1;
          }
        } else {
          caseChanged = mutateCasePair(dbCase, jsonCase, (caseRecord) => {
            const caseMeta = ensureMeta(caseRecord);
            return setReadabilityHold(caseMeta, 'rewrite_required', 'missing_safe_adjudication_signal', now);
          }) || caseChanged;
          if (caseChanged) {
            stats.med_held_rewrite += 1;
          }
        }
      } else if (item.playbook === 'ambiguity_rewrite') {
        if (advisoryPass) {
          caseChanged = mutateCasePair(dbCase, jsonCase, (caseRecord) => {
            const caseMeta = ensureMeta(caseRecord);
            let changed = false;
            if (reviewResult) {
              const answerResult = applyAnswer(caseRecord, reviewResult.correct_option_id, caseMeta, stats, 'openai-batch');
              if (!answerResult.invalid) {
                changed = answerResult.changed || changed;
              }
            }
            if (safeFase2) {
              changed = clearQuarantineFlags(caseMeta) || changed;
            }
            changed = setReadabilityPass(caseMeta, choosePassBasis(caseMeta, reviewResult), now) || changed;
            return changed;
          }) || caseChanged;

          if (caseChanged) {
            stats.med_passed += 1;
          }
        } else if (reviewResult || safeFase2) {
          caseChanged = mutateCasePair(dbCase, jsonCase, (caseRecord) => {
            const caseMeta = ensureMeta(caseRecord);
            return setReadabilityHold(caseMeta, 'rewrite_required', choosePassBasis(caseMeta, reviewResult), now);
          }) || caseChanged;

          if (caseChanged) {
            stats.med_held_rewrite += 1;
          }
        } else {
          caseChanged = mutateCasePair(dbCase, jsonCase, (caseRecord) => {
            const caseMeta = ensureMeta(caseRecord);
            return setReadabilityHold(caseMeta, 'rewrite_required', 'ambiguity_without_adjudication_signal', now);
          }) || caseChanged;
          if (caseChanged) {
            stats.med_held_rewrite += 1;
          }
        }
      }
    }

    for (const caseRecord of [dbCase, jsonCase]) {
      const caseMeta = ensureMeta(caseRecord);
      if (applyIntegrityHolds(caseRecord, caseMeta, stats)) {
        caseChanged = true;
      }
    }

    if (caseChanged) {
      modifiedDbIds.add(caseId);
      modifiedJsonIds.add(caseId);
    }
  }

  for (const dbCase of dbCases) {
    if (TARGET_SOURCES.has(dbCase.meta?.source) || !isPlayable(dbCase)) {
      continue;
    }

    const caseId = String(dbCase._id);
    const jsonCase = jsonCaseMap.get(caseId);
    if (!jsonCase) {
      continue;
    }

    let caseChanged = false;
    for (const caseRecord of [dbCase, jsonCase]) {
      const caseMeta = ensureMeta(caseRecord);
      if (applyIntegrityHolds(caseRecord, caseMeta, stats)) {
        caseChanged = true;
      }
    }

    if (caseChanged) {
      modifiedDbIds.add(caseId);
      modifiedJsonIds.add(caseId);
    }
  }

  const modifiedDbCases = [...modifiedDbIds].map((caseId) => dbCaseMap.get(caseId)).filter(Boolean);
  if (modifiedDbCases.length > 0) {
    repo.updateCaseSnapshots(modifiedDbCases);
  }
  repo.close();

  if (modifiedJsonIds.size > 0) {
    writeJsonAtomically(DATA_FILE, jsonCases, true);
  }

  writeJsonAtomically(REPORT_FILE, {
    generated_at: now,
    stats,
    modified_db_cases: modifiedDbCases.length,
    modified_json_cases: modifiedJsonIds.size,
    unresolved_sample: stats.unresolved.slice(0, 50),
  }, true);

  console.log('AI adjudication lane apply complete');
  console.log(`  Queue items scanned:      ${stats.scanned_queue_items}`);
  console.log(`  Review results loaded:    ${stats.review_results_loaded}`);
  console.log(`  FK cleared:               ${stats.fk_cleared}`);
  console.log(`  Med passed:               ${stats.med_passed}`);
  console.log(`  Med held (fatal):         ${stats.med_held_fatal}`);
  console.log(`  Med held (rewrite):       ${stats.med_held_rewrite}`);
  console.log(`  Answer fixes:             ${stats.answer_fixes}`);
  console.log(`  Rationales refreshed:     ${stats.rationales_refreshed}`);
  console.log(`  Integrity hold - multi:   ${stats.integrity_holds.multiple_correct}`);
  console.log(`  Integrity hold - short:   ${stats.integrity_holds.short_primary_stem}`);
  console.log(`  Modified DB cases:        ${modifiedDbCases.length}`);
  console.log(`  Modified JSON cases:      ${modifiedJsonIds.size}`);
  console.log(`  Unresolved:               ${stats.unresolved.length}`);
  console.log(`  Report:                   ${REPORT_FILE}`);
}

main();
