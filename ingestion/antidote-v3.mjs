import fs from 'fs';

import { openCaseStorage } from './case-storage.mjs';

const IS_DRY_RUN = !process.argv.includes('--write');

const RAW_PATH = 'ingestion/sources/medmcqa/medmcqa_raw.json';
const LOG_PATH = 'ingestion/output/antidote_audit.json';

function normalizeComparable(str) {
  if (!str) return '';
  return String(str)
    .replace(/<[^>]*>?/gm, '')
    .replace(/[.,/#!$%^&*;:{}=\-_`~()]/g, '')
    .replace(/\\n|\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function detectCopBase(items) {
  const values = new Set(items.map((item) => Number.parseInt(item?.cop, 10)).filter(Number.isInteger));
  if (values.has(0) && values.has(4)) {
    throw new Error('FATAL: Mixed MedMCQA `cop` bases detected in raw source.');
  }
  if (values.has(0)) return 0;
  if (values.has(4)) return 1;
  throw new Error(
    'FATAL: Unable to safely infer MedMCQA `cop` base from raw source. Escaping silently is dangerous. Operation aborted.',
  );
}

console.log('ANTIDOTE v3 - HASH-FIRST MOP-UP PROTOCOL');
console.log(`MODE: ${IS_DRY_RUN ? 'DRY RUN (READ ONLY)' : 'PRODUCTION WRITE ENABLED'}\n`);

const raw = JSON.parse(fs.readFileSync(RAW_PATH, 'utf8'));
const rawArray = Array.isArray(raw) ? raw : raw.rows || raw.data || [];
const copBase = detectCopBase(rawArray);
const storage = await openCaseStorage();

console.log(`Storage backend: ${storage.label}`);
console.log(`MedMCQA cop base detected: ${copBase}-indexed\n`);

const rawByHash = new Map();
const rawByFingerprint = new Map();

for (const item of rawArray) {
  const data = item.row || item;
  if (data.id) rawByHash.set(`medmcqa_${data.id}`, data);
  if (!data.opa) continue;

  const fingerprint = [data.opa, data.opb, data.opc, data.opd]
    .map((option) => (option || '').trim().toLowerCase().slice(0, 30))
    .sort()
    .join('|');

  if (!rawByFingerprint.has(fingerprint)) rawByFingerprint.set(fingerprint, []);
  rawByFingerprint.get(fingerprint).push(data);
}

const stats = {
  totalMedMCQA: 0,
  alreadyCorrect: 0,
  matchedByHash: [],
  matchedByUniqueFP: [],
  quarantinedAmbiguousFP: [],
  quarantinedSpatialAnomaly: [],
  quarantinedHashAnchorMismatch: [],
  noRawFound: [],
  noCopProvided: [],
};

const modifiedById = new Map();

try {
  const dataset = storage.dataset;

  for (const item of dataset) {
    const isTargetSource =
      item.meta?.source?.toLowerCase() === 'medmcqa' ||
      /^medmcqa_[a-z0-9-]+$/i.test(String(item.hash_id));
    if (!isTargetSource) continue;

    stats.totalMedMCQA++;

    if (
      item.meta?.status?.startsWith('QUARANTINED_AMBIGUOUS_RAW') ||
      item.meta?.status?.startsWith('QUARANTINED_SPATIAL_ANOMALY') ||
      item.meta?.status?.startsWith('QUARANTINED_HASH_ANCHOR_MISMATCH')
    ) {
      delete item.meta.status;
      modifiedById.set(item._id, item);
    }

    let targetRaw = null;
    let matchType = '';

    if (item.hash_id && rawByHash.has(item.hash_id)) {
      targetRaw = rawByHash.get(item.hash_id);
      matchType = 'hash';
    } else {
      const fingerprint = (item.options || [])
        .map((option) => (option.text || '').trim().toLowerCase().slice(0, 30))
        .sort()
        .join('|');
      const candidates = rawByFingerprint.get(fingerprint);

      if (!candidates?.length) {
        stats.noRawFound.push(item._id);
        continue;
      }

      const correctTexts = new Set();
      for (const candidate of candidates) {
        const candidateCop = Number.parseInt(candidate.cop, 10);
        if (!Number.isNaN(candidateCop)) {
          const candidateText = [candidate.opa, candidate.opb, candidate.opc, candidate.opd][candidateCop - copBase];
          if (candidateText) correctTexts.add(normalizeComparable(candidateText));
        }
      }

      if (correctTexts.size > 1) {
        item.meta = item.meta || {};
        item.meta.status = 'QUARANTINED_AMBIGUOUS_RAW';
        modifiedById.set(item._id, item);
        stats.quarantinedAmbiguousFP.push(item._id);
        continue;
      }

      targetRaw = candidates[0];
      matchType = 'unique_fp';
    }

    const copParsed = Number.parseInt(targetRaw.cop, 10);
    if (Number.isNaN(copParsed)) {
      stats.noCopProvided.push(item._id);
      continue;
    }

    const rawCorrectText = [targetRaw.opa, targetRaw.opb, targetRaw.opc, targetRaw.opd][copParsed - copBase];
    if (!rawCorrectText) {
      stats.noRawFound.push(item._id);
      continue;
    }

    if (/(all|none) of the (above|options)|semua (di atas )?benar|salah semua/i.test(rawCorrectText)) {
      item.meta = item.meta || {};
      item.meta.status = 'QUARANTINED_SPATIAL_ANOMALY';
      modifiedById.set(item._id, item);
      stats.quarantinedSpatialAnomaly.push(item._id);
      continue;
    }

    const anchoredOption = item.options?.find(
      (option) => normalizeComparable(option?.text) === normalizeComparable(rawCorrectText),
    );

    if (!anchoredOption) {
      if (matchType === 'hash') {
        item.meta = item.meta || {};
        item.meta.status = 'QUARANTINED_HASH_ANCHOR_MISMATCH';
        item.meta.failed_raw_anchor = rawCorrectText;
        modifiedById.set(item._id, item);
        stats.quarantinedHashAnchorMismatch.push({ id: item._id, anchor: rawCorrectText });
      } else {
        stats.noRawFound.push(item._id);
      }
      continue;
    }

    const dbCorrect = item.options?.find((option) => option.is_correct);
    if (dbCorrect && dbCorrect.id === anchoredOption.id) {
      stats.alreadyCorrect++;
      continue;
    }

    item.options.forEach((option) => {
      option.is_correct = option.id === anchoredOption.id;
    });
    item.meta = item.meta || {};
    item.meta.antidote_v3 = true;
    item.meta.antidote_applied = true;
    item.meta.answer_anchor_text = rawCorrectText;
    item.meta._recovered_from = matchType;

    if (item.meta.is_t9_processed || item.meta.is_holy_trinity) {
      delete item.meta.is_t9_processed;
      delete item.meta.is_holy_trinity;
      item.meta.poisoned_reverted = true;
    }

    const originalExplanation = (targetRaw.exp || '').trim();
    if (originalExplanation.length > 20) {
      item.rationale = { correct: `[RESTORED SOURCE] ${originalExplanation}`, distractors: {}, pearl: null };
    } else {
      item.meta.needs_rationale_regen = true;
    }

    modifiedById.set(item._id, item);
    if (matchType === 'hash') stats.matchedByHash.push(item._id);
    else stats.matchedByUniqueFP.push(item._id);
  }

  if (!IS_DRY_RUN && modifiedById.size > 0) {
    await storage.persistCases([...modifiedById.values()], { fullDataset: dataset });
  }
} finally {
  await storage.close();
}

if (!fs.existsSync('ingestion/output')) fs.mkdirSync('ingestion/output', { recursive: true });
fs.writeFileSync(LOG_PATH, JSON.stringify(stats, null, 2), 'utf8');

if (!IS_DRY_RUN) {
  console.log('\nSUCCESS: Backend updated permanently.');
} else {
  console.log('\nDRY RUN COMPLETED: No backend changes were written.');
}

console.log('\nAUDIT RESULTS:');
console.table({
  'Total MedMCQA Audited': stats.totalMedMCQA,
  'Already Correct': stats.alreadyCorrect,
  'Fixed by Hash': stats.matchedByHash.length,
  'Fixed by Unique FP': stats.matchedByUniqueFP.length,
  'Q: Ambiguous FP': stats.quarantinedAmbiguousFP.length,
  'Q: Spatial Anomaly': stats.quarantinedSpatialAnomaly.length,
  'Q: Hash Anchor Mismatch': stats.quarantinedHashAnchorMismatch.length,
  'No Raw / No Cop': stats.noRawFound.length + stats.noCopProvided.length,
});
console.log(`\nDetailed log saved to: ${LOG_PATH}`);
