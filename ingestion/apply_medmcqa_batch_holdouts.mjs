import { readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createCasebankRepository, hydrateCase } from '../server/casebank-repository.js';
import { openCasebankDb } from '../server/casebank-db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DATA_FILE = join(__dirname, '..', 'public', 'data', 'compiled_cases.json');
const QUEUE_FILE = join(__dirname, 'output', 'readability_batch_salvage_queue.json');
const MEDMCQA_RAW_FILE = join(__dirname, 'sources', 'medmcqa', 'medmcqa_raw.json');
const REPORT_FILE = join(__dirname, 'output', 'medmcqa_batch_holdouts_report.json');
const IMAGE_DEPENDENT_RE = /\b(?:shown in (?:the )?(?:image|figure)|below pic|see image|see picture|see figure|image below|figure below|picture below)\b/i;

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
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function writeJsonAtomically(filePath, value, pretty = true) {
  const tempFile = `${filePath}.tmp`;
  const payload = pretty ? `${JSON.stringify(value, null, 2)}\n` : JSON.stringify(value);
  writeFileSync(tempFile, payload, 'utf8');
  try {
    renameSync(tempFile, filePath);
  } catch (error) {
    if (error && error.code !== 'EPERM') {
      throw error;
    }
    writeFileSync(filePath, payload, 'utf8');
    unlinkSync(tempFile);
  }
}

function ensureMeta(caseRecord) {
  if (!caseRecord.meta || typeof caseRecord.meta !== 'object' || Array.isArray(caseRecord.meta)) {
    caseRecord.meta = {};
  }
  return caseRecord.meta;
}

function loadTargetCases(repo, caseIds) {
  const numericIds = [...caseIds].map((value) => Number(value)).filter(Number.isFinite);
  if (numericIds.length === 0) {
    return [];
  }

  const placeholders = numericIds.map(() => '?').join(', ');
  const caseRows = repo.db.prepare(`
    SELECT
      case_id,
      case_code,
      hash_id,
      q_type,
      confidence,
      category,
      title,
      prompt,
      vignette_json,
      rationale_json,
      meta_json,
      validation_json
    FROM cases
    WHERE case_id IN (${placeholders})
    ORDER BY case_id
  `).all(...numericIds);

  const optionRows = repo.db.prepare(`
    SELECT case_id, option_id, sort_order, option_text, is_correct
    FROM case_options
    WHERE case_id IN (${placeholders})
    ORDER BY case_id, sort_order
  `).all(...numericIds);

  const optionsByCaseId = new Map();
  for (const row of optionRows) {
    const list = optionsByCaseId.get(row.case_id) || [];
    list.push(row);
    optionsByCaseId.set(row.case_id, list);
  }

  return caseRows.map((row) => hydrateCase(row, optionsByCaseId.get(row.case_id) || []));
}

function loadMedMcqaMap() {
  const raw = JSON.parse(readFileSync(MEDMCQA_RAW_FILE, 'utf8'));
  const map = new Map();
  for (const item of raw) {
    if (!item?.id) {
      continue;
    }
    const options = [];
    for (const [suffix, label] of [['a', 'A'], ['b', 'B'], ['c', 'C'], ['d', 'D'], ['e', 'E']]) {
      const text = normalizeWhitespace(item[`op${suffix}`]);
      if (!text) {
        continue;
      }
      const correctIndex = Number(item.cop);
      options.push({
        id: label,
        text,
        is_correct: Number.isFinite(correctIndex) ? correctIndex === options.length : false,
      });
    }
    map.set(`medmcqa_${item.id}`, {
      explanation: normalizeWhitespace(item.exp),
      options,
    });
  }
  return map;
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

function hasCompleteOptions(caseRecord) {
  const options = caseRecord.options || [];
  if (options.length < 4) {
    return false;
  }
  let correctCount = 0;
  let substantialCount = 0;
  for (const option of options) {
    if (option?.is_correct === true) {
      correctCount += 1;
    }
    if (normalizeWhitespace(option?.text).length >= 3) {
      substantialCount += 1;
    }
  }
  return correctCount === 1 && substantialCount >= 4;
}

function hasUniqueOptionTexts(options) {
  const seen = new Set();
  for (const option of options || []) {
    const text = normalizeComparable(option?.text);
    if (!text) {
      continue;
    }
    if (seen.has(text)) {
      return false;
    }
    seen.add(text);
  }
  return seen.size >= 4;
}

function addQualityFlag(meta, flag) {
  if (!Array.isArray(meta.quality_flags)) {
    meta.quality_flags = [];
  }
  if (!meta.quality_flags.includes(flag)) {
    meta.quality_flags.push(flag);
    return true;
  }
  return false;
}

function setReadabilityHold(meta, hold, basis, now, reasoning, notes) {
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

function mutateCasePair(dbCase, jsonCase, mutator) {
  let changed = false;
  changed = mutator(dbCase) || changed;
  changed = mutator(jsonCase) || changed;
  return changed;
}

function classifyHold(dbCase, jsonCase, raw) {
  const meta = dbCase.meta || {};
  const status = String(meta.status || '').trim();
  if (meta.quarantined === true || status.startsWith('QUARANTINED')) {
    return {
      hold: 'source_quarantined',
      basis: 'batch-salvage:quarantined_medmcqa',
      reasoning: 'The MedMCQA source row is still quarantined after salvage attempts, so it should leave the automated salvage lane.',
      notes: 'Quarantined MedMCQA items need selective editor review or retirement.',
    };
  }

  const stem = normalizeWhitespace(
    jsonCase.question
      || dbCase.question
      || jsonCase.prompt
      || dbCase.prompt
      || getNarrative(jsonCase)
      || getNarrative(dbCase)
      || jsonCase.title
      || dbCase.title,
  );
  if (IMAGE_DEPENDENT_RE.test(stem)) {
    return {
      hold: 'image_dependency',
      basis: 'batch-salvage:image_dependent_medmcqa',
      reasoning: 'The remaining MedMCQA item depends on missing visual context, so text salvage is exhausted.',
      notes: 'Needs source image recovery or human rewrite.',
    };
  }

  const currentOptionsComplete = hasCompleteOptions(dbCase);
  const rawOptionsComplete = raw && hasCompleteOptions({ options: raw.options });
  const currentOptionsUnique = hasUniqueOptionTexts(dbCase.options || []);
  const rawOptionsUnique = raw && hasUniqueOptionTexts(raw.options || []);
  if ((currentOptionsComplete || rawOptionsComplete) && !(currentOptionsUnique || rawOptionsUnique)) {
    return {
      hold: 'duplicate_options',
      basis: 'batch-salvage:duplicate_options_medmcqa',
      reasoning: 'Only duplicate option sets remain for this MedMCQA item, so automated salvage cannot rebuild a trustworthy option set.',
      notes: 'Requires editor repair or fresh distractor authoring.',
    };
  }

  if (!(currentOptionsComplete && currentOptionsUnique) && !(rawOptionsComplete && rawOptionsUnique)) {
    return {
      hold: 'incomplete_source_options',
      basis: 'batch-salvage:incomplete_options_medmcqa',
      reasoning: 'The MedMCQA source still lacks a complete unique option set after salvage, so structural repair is required.',
      notes: 'Incomplete option sets should leave the automated salvage lane.',
    };
  }

  const currentRationale = normalizeWhitespace((dbCase.rationale || {}).correct);
  const rawRationale = normalizeWhitespace(raw?.explanation);
  if (currentRationale.length < 80 && rawRationale.length < 80) {
    return {
      hold: 'weak_source_rationale',
      basis: 'batch-salvage:weak_rationale_medmcqa',
      reasoning: 'The MedMCQA source does not provide enough rationale text to safely recover this truncated item in batch.',
      notes: 'Needs human review or a separate adjudication pass with fresh rationale generation.',
    };
  }

  return null;
}

function main() {
  const now = new Date().toISOString();
  const queue = JSON.parse(readFileSync(QUEUE_FILE, 'utf8'));
  const medItems = queue.filter((item) => item.source === 'medmcqa' && item.playbook === 'truncated_text_recovery');
  const targetIds = new Set(medItems.map((item) => String(item._id)).filter(Boolean));

  const jsonCases = JSON.parse(readFileSync(DATA_FILE, 'utf8'));
  const jsonCaseMap = new Map(jsonCases.map((caseRecord) => [String(caseRecord._id), caseRecord]));

  const repo = createCasebankRepository(openCasebankDb());
  const dbCases = loadTargetCases(repo, targetIds);
  const dbCaseMap = new Map(dbCases.map((caseRecord) => [String(caseRecord._id), caseRecord]));
  const medmcqaMap = loadMedMcqaMap();

  const modifiedIds = new Set();
  const report = {
    generated_at: now,
    target_case_count: targetIds.size,
    modified_case_count: 0,
    by_hold: {},
    skipped_unclassified: 0,
    samples: [],
  };

  for (const item of medItems) {
    const caseId = String(item._id);
    const jsonCase = jsonCaseMap.get(caseId);
    const dbCase = dbCaseMap.get(caseId);
    if (!jsonCase || !dbCase) {
      continue;
    }

    const raw = medmcqaMap.get(String(jsonCase.hash_id || dbCase.hash_id || ''));
    const hold = classifyHold(dbCase, jsonCase, raw);
    if (!hold) {
      report.skipped_unclassified += 1;
      continue;
    }

    const changed = mutateCasePair(dbCase, jsonCase, (caseRecord) => {
      const meta = ensureMeta(caseRecord);
      let localChanged = setReadabilityHold(meta, hold.hold, hold.basis, now, hold.reasoning, hold.notes);
      localChanged = addQualityFlag(meta, 'batch_salvage_exhausted') || localChanged;
      if (hold.hold === 'duplicate_options') {
        if (meta.needs_review !== true) {
          meta.needs_review = true;
          localChanged = true;
        }
        if (meta.needs_review_reason !== 'duplicate_options') {
          meta.needs_review_reason = 'duplicate_options';
          localChanged = true;
        }
      }
      return localChanged;
    });

    if (!changed) {
      continue;
    }

    modifiedIds.add(caseId);
    report.modified_case_count += 1;
    report.by_hold[hold.hold] = (report.by_hold[hold.hold] || 0) + 1;
    if (report.samples.length < 12) {
      report.samples.push({
        _id: Number(caseId),
        case_code: jsonCase.case_code,
        hold: hold.hold,
        basis: hold.basis,
      });
    }
  }

  if (modifiedIds.size > 0) {
    const modifiedDbCases = [...modifiedIds].map((caseId) => dbCaseMap.get(caseId)).filter(Boolean);
    repo.updateCaseSnapshots(modifiedDbCases);
    writeJsonAtomically(DATA_FILE, jsonCases, true);
  }

  repo.close();
  writeJsonAtomically(REPORT_FILE, report, true);

  console.log('MedMCQA batch holdouts applied');
  console.log(`  Targets:  ${report.target_case_count}`);
  console.log(`  Modified: ${report.modified_case_count}`);
  console.log(`  Report:   ${REPORT_FILE}`);
}

main();
