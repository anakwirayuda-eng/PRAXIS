import fs from 'fs';

import { openCaseStorage } from './case-storage.mjs';

const IS_DRY_RUN = !process.argv.includes('--write');
const RAW_PATH = 'ingestion/sources/medmcqa/medmcqa_raw.json';
const LOG_PATH = 'ingestion/output/lane1_mechanical_report.json';
const TARGET_STATUSES = new Set([
  'QUARANTINED_HASH_ANCHOR_MISMATCH',
  'QUARANTINED_SPATIAL_ANOMALY',
]);

function normalizeLoose(value) {
  return String(value || '')
    .replace(/<[^>]*>?/gm, ' ')
    .replace(/^[A-D]\s*[\)\].:-]\s*/i, '')
    .replace(/[.,/#!$%^&*;:{}=_`~()"'[\]-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function levenshtein(a, b) {
  const left = normalizeLoose(a);
  const right = normalizeLoose(b);
  const m = left.length;
  const n = right.length;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1),
      );
    }
  }

  return dp[m][n];
}

function detectCopBase(items) {
  const values = new Set(items.map((item) => Number.parseInt(item?.cop, 10)).filter(Number.isInteger));
  if (values.has(0) && !values.has(4)) return 0;
  if (values.has(4) && !values.has(0)) return 1;
  throw new Error(`FATAL: Unsupported mixed cop bases detected: ${[...values].sort((a, b) => a - b).join(', ')}`);
}

function getRawCorrectText(rawItem, copBase) {
  const copParsed = Number.parseInt(rawItem?.cop, 10);
  if (!Number.isInteger(copParsed)) return null;
  return [rawItem.opa, rawItem.opb, rawItem.opc, rawItem.opd][copParsed - copBase] || null;
}

function chooseAnchoredOption(options, rawCorrectText) {
  const exactHits = options.filter((option) => normalizeLoose(option?.text) === normalizeLoose(rawCorrectText));
  if (exactHits.length === 1) {
    return { option: exactHits[0], method: 'exact' };
  }
  if (exactHits.length > 1) {
    return { option: null, method: 'ambiguous_exact' };
  }

  const scored = options
    .map((option) => ({
      option,
      distance: levenshtein(rawCorrectText, option?.text),
    }))
    .sort((a, b) => a.distance - b.distance);

  const best = scored[0];
  const second = scored[1];
  const margin = second ? second.distance - best.distance : 99;

  if (best && best.distance <= 2 && margin >= 2) {
    return { option: best.option, method: 'fuzzy_ocr' };
  }

  return { option: null, method: 'unresolved' };
}

console.log('LANE 1 - MECHANICAL REMEDIATION');
console.log(`MODE: ${IS_DRY_RUN ? 'DRY RUN (READ ONLY)' : 'PRODUCTION WRITE ENABLED'}\n`);

const raw = JSON.parse(fs.readFileSync(RAW_PATH, 'utf8'));
const rawArray = Array.isArray(raw) ? raw : raw.rows || raw.data || [];
const copBase = detectCopBase(rawArray);
const rawByHash = new Map();
for (const item of rawArray) {
  const data = item.row || item;
  if (data.id) rawByHash.set(`medmcqa_${data.id}`, data);
}

const storage = await openCaseStorage();
const stats = {
  totalCandidates: 0,
  fixedSpatial: [],
  fixedHashExact: [],
  fixedHashFuzzy: [],
  unresolved: [],
  missingRaw: [],
  missingCorrectText: [],
};
const modifiedById = new Map();

try {
  for (const item of storage.dataset) {
    const status = item.meta?.status || '';
    if (!TARGET_STATUSES.has(status)) continue;
    stats.totalCandidates++;

    const rawItem = item.hash_id ? rawByHash.get(item.hash_id) : null;
    if (!rawItem) {
      stats.missingRaw.push(item._id);
      continue;
    }

    const rawCorrectText = getRawCorrectText(rawItem, copBase);
    if (!rawCorrectText) {
      stats.missingCorrectText.push(item._id);
      continue;
    }

    const { option: anchoredOption, method } = chooseAnchoredOption(item.options || [], rawCorrectText);
    if (!anchoredOption) {
      stats.unresolved.push({
        id: item._id,
        case_code: item.case_code,
        status,
        rawCorrectText,
        method,
      });
      continue;
    }

    item.options.forEach((option) => {
      option.is_correct = option.id === anchoredOption.id;
    });

    item.meta = item.meta || {};
    delete item.meta.status;
    delete item.meta.failed_raw_anchor;
    item.meta.answer_anchor_text = rawCorrectText;
    item.meta.antidote_v3 = true;
    item.meta.antidote_applied = true;
    item.meta.lane1_mechanical_fix = {
      at: new Date().toISOString(),
      previous_status: status,
      method,
      anchored_option_id: anchoredOption.id,
    };

    modifiedById.set(item._id, item);

    if (status === 'QUARANTINED_SPATIAL_ANOMALY') {
      stats.fixedSpatial.push(item._id);
    } else if (method === 'exact') {
      stats.fixedHashExact.push(item._id);
    } else {
      stats.fixedHashFuzzy.push(item._id);
    }
  }

  if (!IS_DRY_RUN && modifiedById.size > 0) {
    await storage.persistCases([...modifiedById.values()], { fullDataset: storage.dataset });
  }
} finally {
  await storage.close();
}

if (!fs.existsSync('ingestion/output')) fs.mkdirSync('ingestion/output', { recursive: true });
fs.writeFileSync(LOG_PATH, JSON.stringify(stats, null, 2), 'utf8');

console.log(`Storage backend: ${storage.label}`);
console.log(`MedMCQA cop base detected: ${copBase}-indexed\n`);
console.table({
  'Total candidates': stats.totalCandidates,
  'Fixed spatial': stats.fixedSpatial.length,
  'Fixed hash (exact)': stats.fixedHashExact.length,
  'Fixed hash (fuzzy OCR)': stats.fixedHashFuzzy.length,
  'Missing raw': stats.missingRaw.length,
  'Missing correct text': stats.missingCorrectText.length,
  'Unresolved': stats.unresolved.length,
});
console.log(`\nDetailed log saved to: ${LOG_PATH}`);
