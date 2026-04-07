import { readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createCasebankRepository, hydrateCase } from '../server/casebank-repository.js';
import { openCasebankDb } from '../server/casebank-db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DATA_FILE = join(__dirname, '..', 'public', 'data', 'compiled_cases.json');
const QUEUE_FILE = join(__dirname, 'output', 'readability_batch_salvage_queue.json');
const REPORT_FILE = join(__dirname, 'output', 'batch_salvage_sync_report.json');
const TARGET_SOURCES = new Set(['pubmedqa', 'medexpqa', 'medmcqa']);
const MEDMCQA_RAW_FILE = join(__dirname, 'sources', 'medmcqa', 'medmcqa_raw.json');
const PUBMEDQA_RAW_FILE = join(__dirname, 'sources', 'pubmedqa', 'pubmedqa_raw.json');
const MEDEXPQA_OUTPUT_DIR = join(__dirname, 'output', 'medexpqa');
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

function makeTitle(text, limit = 80) {
  const normalized = normalizeWhitespace(text);
  if (!normalized) {
    return '';
  }
  if (normalized.length <= limit) {
    return normalized;
  }
  return `${normalized.slice(0, limit - 3).trimEnd()}...`;
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

function ensureRationale(caseRecord) {
  if (!caseRecord.rationale || typeof caseRecord.rationale !== 'object' || Array.isArray(caseRecord.rationale)) {
    caseRecord.rationale = {
      correct: typeof caseRecord.rationale === 'string' ? caseRecord.rationale : '',
      distractors: {},
      pearl: '',
    };
  }
  if (!caseRecord.rationale.distractors || typeof caseRecord.rationale.distractors !== 'object') {
    caseRecord.rationale.distractors = {};
  }
  if (typeof caseRecord.rationale.correct !== 'string') {
    caseRecord.rationale.correct = String(caseRecord.rationale.correct ?? '');
  }
  if (typeof caseRecord.rationale.pearl !== 'string') {
    caseRecord.rationale.pearl = String(caseRecord.rationale.pearl ?? '');
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
    if (!item?.id || !item?.question) {
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
      question: normalizeWhitespace(item.question),
      explanation: normalizeWhitespace(item.exp),
      choiceType: normalizeWhitespace(item.choice_type).toLowerCase(),
      options,
    });
  }
  return map;
}

function loadPubmedqaMap() {
  const raw = JSON.parse(readFileSync(PUBMEDQA_RAW_FILE, 'utf8'));
  const map = new Map();
  for (const item of raw) {
    const key = String(item?.pubid ?? '').trim();
    const question = normalizeWhitespace(item?.question);
    if (!key || !question) {
      continue;
    }
    const contexts = Array.isArray(item?.context?.contexts)
      ? item.context.contexts.map((entry) => normalizeWhitespace(entry)).filter(Boolean).join('\n')
      : '';
    map.set(key, {
      question,
      narrative: normalizeWhitespace(contexts),
    });
  }
  return map;
}

function optionFingerprint(options) {
  return (options || [])
    .map((option) => normalizeComparable(option?.text))
    .filter(Boolean)
    .join('||');
}

function loadMedexpqaMap() {
  const map = new Map();
  for (const split of ['train', 'dev', 'test']) {
    const path = join(MEDEXPQA_OUTPUT_DIR, `${split}.jsonl`);
    const lines = readFileSync(path, 'utf8').trim().split('\n');
    for (const line of lines) {
      const raw = JSON.parse(line);
      const question = normalizeWhitespace(raw.full_question || raw.question);
      if (!question) {
        continue;
      }
      const optionEntries = Object.entries(raw.options || {})
        .sort(([left], [right]) => Number(left) - Number(right))
        .map(([id, text]) => ({ id, text }));
      const fingerprint = optionFingerprint(optionEntries);
      if (!fingerprint) {
        continue;
      }
      const year = String(raw.year ?? '').trim();
      map.set(`${year}::${fingerprint}`, question);
      map.set(fingerprint, question);
    }
  }
  return map;
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

function normalizeUnits(text) {
  return normalizeWhitespace(
    String(text ?? '')
      .replace(/\bmm\s*hg\b/gi, 'mmHg')
      .replace(/\bmmol\s*\/\s*l\b/gi, 'mmol/L')
      .replace(/\bmeq\s*\/\s*l\b/gi, 'mEq/L')
      .replace(/\bpco2\b/gi, 'PCO2')
      .replace(/\bpo2\b/gi, 'PO2')
      .replace(/\bpao2\b/gi, 'PaO2')
      .replace(/\bpaco2\b/gi, 'PaCO2')
      .replace(/\bhco3[-−]?\b/gi, 'HCO3')
  );
}

function setQualityFlag(meta, flag) {
  const flags = Array.isArray(meta.quality_flags) ? meta.quality_flags.slice() : [];
  if (!flags.includes(flag)) {
    flags.push(flag);
  }
  meta.quality_flags = flags;
}

function addSkip(report, key) {
  report.skipped[key] = (report.skipped[key] || 0) + 1;
}

function mutatePair(dbCase, jsonCase, mutator) {
  let changed = false;
  changed = mutator(dbCase, true) || changed;
  changed = mutator(jsonCase, false) || changed;
  return changed;
}

function applyPubmedqaFix(dbCase, jsonCase, rawMap, report) {
  const pubmedKey = String((jsonCase.meta || {}).pmid || (dbCase.meta || {}).pmid || '').trim();
  const raw = rawMap.get(pubmedKey);
  const question = normalizeWhitespace(jsonCase.question || raw?.question);
  if (!question) {
    addSkip(report, 'pubmedqa_missing_question');
    return false;
  }
  const fallbackNarrative = normalizeWhitespace(getNarrative(jsonCase) || getNarrative(dbCase) || raw?.narrative);

  return mutatePair(dbCase, jsonCase, (caseRecord) => {
    const meta = ensureMeta(caseRecord);
    const rationale = ensureRationale(caseRecord);
    let changed = false;

    if (caseRecord.source !== 'pubmedqa') {
      caseRecord.source = 'pubmedqa';
      changed = true;
    }

    const nextPrompt = normalizeUnits(question);
    if (normalizeWhitespace(caseRecord.prompt) !== nextPrompt) {
      caseRecord.prompt = nextPrompt;
      changed = true;
    }

    const nextTitle = makeTitle(question);
    if (normalizeWhitespace(caseRecord.title) !== nextTitle) {
      caseRecord.title = nextTitle;
      changed = true;
    }

    if (fallbackNarrative) {
      changed = setNarrative(caseRecord, normalizeUnits(fallbackNarrative)) || changed;
    }

    const nextRationale = normalizeUnits(rationale.correct);
    if (normalizeWhitespace(rationale.correct) !== nextRationale) {
      rationale.correct = nextRationale;
      changed = true;
    }

    if (meta.source !== 'pubmedqa') {
      meta.source = 'pubmedqa';
      changed = true;
    }
    if (meta.truncated) {
      meta.truncated = false;
      changed = true;
    }
    setQualityFlag(meta, 'batch_salvage_sync');
    return changed;
  });
}

function applyMedexpqaFix(dbCase, jsonCase, medexpqaMap, report) {
  const meta = jsonCase.meta || {};
  const fingerprint = optionFingerprint(jsonCase.options || dbCase.options || []);
  const question = normalizeWhitespace(
    jsonCase.question
      || medexpqaMap.get(`${String(meta.year ?? '').trim()}::${fingerprint}`)
      || medexpqaMap.get(fingerprint),
  );
  if (!question) {
    addSkip(report, 'medexpqa_missing_question');
    return false;
  }

  return mutatePair(dbCase, jsonCase, (caseRecord) => {
    const caseMeta = ensureMeta(caseRecord);
    const rationale = ensureRationale(caseRecord);
    let changed = false;

    if (caseRecord.source !== 'medexpqa') {
      caseRecord.source = 'medexpqa';
      changed = true;
    }

    const nextQuestion = normalizeUnits(question);
    if (normalizeWhitespace(caseRecord.prompt) !== nextQuestion) {
      caseRecord.prompt = nextQuestion;
      changed = true;
    }
    const nextTitle = makeTitle(question);
    if (normalizeWhitespace(caseRecord.title) !== nextTitle) {
      caseRecord.title = nextTitle;
      changed = true;
    }
    changed = setNarrative(caseRecord, nextQuestion) || changed;

    const nextRationale = normalizeUnits(rationale.correct);
    if (normalizeWhitespace(rationale.correct) !== nextRationale) {
      rationale.correct = nextRationale;
      changed = true;
    }

    if (caseMeta.source !== 'medexpqa') {
      caseMeta.source = 'medexpqa';
      changed = true;
    }
    if (caseMeta.truncated) {
      caseMeta.truncated = false;
      changed = true;
    }
    setQualityFlag(caseMeta, 'batch_salvage_sync');
    return changed;
  });
}

function applyMedmcqaFix(dbCase, jsonCase, medmcqaMap, report) {
  const meta = dbCase.meta || {};
  const status = String(meta.status || '').trim();
  const raw = medmcqaMap.get(String(jsonCase.hash_id || dbCase.hash_id || ''));
  if (status.startsWith('QUARANTINED') || meta.quarantined === true) {
    addSkip(report, 'medmcqa_quarantined');
    return false;
  }
  if (meta.truncated !== true) {
    addSkip(report, 'medmcqa_not_truncated');
    return false;
  }
  const currentOptionsUsable = hasCompleteOptions(dbCase) && hasUniqueOptionTexts(dbCase.options || []);
  const rawOptionsUsable = raw && hasCompleteOptions({ options: raw.options }) && hasUniqueOptionTexts(raw.options || []);
  const candidateOptionCarrier = currentOptionsUsable
    ? dbCase
    : rawOptionsUsable
      ? { options: raw.options }
      : null;
  if (!candidateOptionCarrier) {
    if (hasCompleteOptions(dbCase) || (raw && hasCompleteOptions({ options: raw.options }))) {
      addSkip(report, 'medmcqa_duplicate_options');
      return false;
    }
    addSkip(report, 'medmcqa_incomplete_options');
    return false;
  }

  const currentRationale = normalizeWhitespace((dbCase.rationale || {}).correct);
  const rawRationale = normalizeWhitespace(raw?.explanation);
  const usableRationale = currentRationale.length >= 80
    ? currentRationale
    : rawRationale.length >= 80
      ? rawRationale
      : '';
  if (!usableRationale) {
    addSkip(report, 'medmcqa_weak_rationale');
    return false;
  }

  const stem = normalizeWhitespace(
    jsonCase.question
      || raw?.question
      || getNarrative(jsonCase)
      || jsonCase.prompt
      || jsonCase.title
      || getNarrative(dbCase)
      || dbCase.prompt
      || dbCase.title,
  );
  if (!stem) {
    addSkip(report, 'medmcqa_missing_stem');
    return false;
  }

  const questionMode = String(meta.questionMode || '').trim().toLowerCase();
  const minLength = questionMode === 'rapid_recall' ? 8 : 12;
  if (stem.length < minLength) {
    addSkip(report, 'medmcqa_short_stem');
    return false;
  }
  if (IMAGE_DEPENDENT_RE.test(stem)) {
    addSkip(report, 'medmcqa_image_dependent');
    return false;
  }

  return mutatePair(dbCase, jsonCase, (caseRecord) => {
    const caseMeta = ensureMeta(caseRecord);
    const rationale = ensureRationale(caseRecord);
    let changed = false;

    if (caseRecord.source !== 'medmcqa') {
      caseRecord.source = 'medmcqa';
      changed = true;
    }

    const nextStem = normalizeUnits(stem);
    if (normalizeWhitespace(caseRecord.prompt) !== nextStem) {
      caseRecord.prompt = nextStem;
      changed = true;
    }
    if (normalizeWhitespace(caseRecord.title) !== makeTitle(stem)) {
      caseRecord.title = makeTitle(stem);
      changed = true;
    }
    changed = setNarrative(caseRecord, nextStem) || changed;

    if ((!hasCompleteOptions(caseRecord) || !hasUniqueOptionTexts(caseRecord.options || [])) && rawOptionsUsable) {
      caseRecord.options = raw.options.map((option) => ({ ...option }));
      changed = true;
    }

    const nextRationale = normalizeUnits(usableRationale || rationale.correct);
    if (normalizeWhitespace(rationale.correct) !== nextRationale) {
      rationale.correct = nextRationale;
      changed = true;
    }

    if (caseMeta.source !== 'medmcqa') {
      caseMeta.source = 'medmcqa';
      changed = true;
    }
    if (caseMeta.truncated) {
      caseMeta.truncated = false;
      changed = true;
    }
    setQualityFlag(caseMeta, 'truncated_false_positive_cleared');
    setQualityFlag(caseMeta, 'batch_salvage_sync');
    return changed;
  });
}

function main() {
  const queue = JSON.parse(readFileSync(QUEUE_FILE, 'utf8'));
  const targetIds = new Set();
  const bySource = new Map();
  for (const item of queue) {
    const source = String(item.source || '').trim();
    if (!TARGET_SOURCES.has(source)) {
      continue;
    }
    if (item.playbook !== 'truncated_text_recovery') {
      continue;
    }
    const caseId = String(item._id || '').trim();
    if (!caseId) {
      continue;
    }
    targetIds.add(caseId);
    bySource.set(caseId, source);
  }

  const jsonCases = JSON.parse(readFileSync(DATA_FILE, 'utf8'));
  const jsonCaseMap = new Map(jsonCases.map((caseRecord) => [String(caseRecord._id), caseRecord]));

  const repo = createCasebankRepository(openCasebankDb());
  const dbCases = loadTargetCases(repo, targetIds);
  const dbCaseMap = new Map(dbCases.map((caseRecord) => [String(caseRecord._id), caseRecord]));

  const medmcqaMap = loadMedMcqaMap();
  const pubmedqaMap = loadPubmedqaMap();
  const medexpqaMap = loadMedexpqaMap();

  const report = {
    generated_at: new Date().toISOString(),
    target_case_count: targetIds.size,
    changed_cases: 0,
    by_source: {
      pubmedqa: 0,
      medexpqa: 0,
      medmcqa: 0,
    },
    skipped: {},
    samples: [],
  };

  const modifiedIds = new Set();

  for (const caseId of targetIds) {
    const jsonCase = jsonCaseMap.get(caseId);
    const dbCase = dbCaseMap.get(caseId);
    const source = bySource.get(caseId);
    if (!jsonCase || !dbCase || !source) {
      addSkip(report, 'missing_case');
      continue;
    }

    let changed = false;
    if (source === 'pubmedqa') {
      changed = applyPubmedqaFix(dbCase, jsonCase, pubmedqaMap, report);
    } else if (source === 'medexpqa') {
      changed = applyMedexpqaFix(dbCase, jsonCase, medexpqaMap, report);
    } else if (source === 'medmcqa') {
      changed = applyMedmcqaFix(dbCase, jsonCase, medmcqaMap, report);
    }

    if (!changed) {
      continue;
    }

    modifiedIds.add(caseId);
    report.changed_cases += 1;
    report.by_source[source] += 1;
    if (report.samples.length < 12) {
      report.samples.push({
        _id: Number(caseId),
        source,
        prompt: normalizeWhitespace(jsonCase.prompt).slice(0, 180),
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

  console.log('Batch salvage sync applied');
  console.log(`  Targeted queue IDs: ${targetIds.size}`);
  console.log(`  Modified cases:     ${report.changed_cases}`);
  console.log(`  By source:          ${JSON.stringify(report.by_source)}`);
  console.log(`  Report:             ${REPORT_FILE}`);
}

main();
