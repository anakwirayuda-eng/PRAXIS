import fs from 'fs';

import { openCaseStorage } from './case-storage.mjs';

const IS_DRY_RUN = !process.argv.includes('--write');
const REPORT_PATH = 'ingestion/output/lane1_unresolved_adjudication.json';

const DECISIONS = {
  752: { action: 'hold', note: 'Clinical review: double aortic arch results from persistence of both fourth arches/right dorsal aortic segments, and no single option cleanly represents that mechanism. Keep quarantined for rewrite.' },
  3623: { action: 'clear', note: 'Raw anchor is OCR-corrupted but still points to the current option B.' },
  7815: { action: 'fix', optionId: 'A', optionText: 'A-mode', note: 'Raw explanation explicitly states orbital biometry uses A-mode ultrasound.' },
  9558: { action: 'clear', note: 'Raw explanation explicitly says C i.e. vertebral artery.' },
  9769: { action: 'clear', note: 'Clinical review favors redistribution from dependent venous reservoirs when supine, so leg veins remain the best available option among the choices.' },
  10135: { action: 'clear', note: 'Raw explanation explicitly marks option C as the false statement in the except stem.' },
  11338: { action: 'fix', optionId: 'D', note: 'Raw explanation explicitly says Ans. d i.e. coronary arteries do not arise from the arch of aorta.' },
  14330: { action: 'clear', note: 'Raw explanation explicitly marks option A.' },
  28517: { action: 'clear', note: 'Raw explanation states inferior thyroid artery lies laterally and escapes injury.' },
  28601: { action: 'clear', note: 'Raw explanation states embalming solution is given through arteries.' },
  28644: { action: 'clear', note: 'Raw explanation explicitly marks option A (CRAO).' },
  29008: { action: 'clear', note: 'Raw explanation states vertebral artery does not contribute significantly and is the except.' },
  29487: { action: 'clear', note: 'Raw explanation matches the current option A exactly apart from OCR noise.' },
  31254: { action: 'fix', optionId: 'C', note: 'The explanation names superior and inferior pancreaticoduodenal arteries, which map to celiac trunk plus superior mesenteric artery.' },
  33885: { action: 'clear', note: 'Raw explanation explicitly states aortic arch 3.' },
  33986: { action: 'fix', optionId: 'D', note: 'The stem is EXCEPT; vertebral artery passes through the foramen magnum, so internal carotid artery is the false option.' },
  33963: { action: 'clear', note: 'Raw explanation supports selective arterial infusion of vasopressin through the left gastric artery.' },
  36307: { action: 'clear', note: 'Raw explanation identifies aorta, which corresponds to current option D.' },
  36775: { action: 'clear', note: 'Raw explanation identifies central retinal artery occlusion, matching current option B.' },
  39643: { action: 'clear', note: 'Raw explanation matches the current option A exactly apart from OCR noise.' },
  39979: { action: 'clear', note: 'Raw explanation states partial nephrectomy is the best option.' },
  40068: { action: 'clear', note: 'Raw explanation names superior and inferior pancreaticoduodenal arteries, matching current option D.' },
  40956: { action: 'clear', note: 'Raw explanation says reversal is ipsilateral, so the contralateral statement is false as current option B indicates.' },
  41656: { action: 'clear', note: 'Raw explanation matches the current option B sequence apart from OCR noise.' },
  42323: { action: 'clear', note: 'Clinical review supports skeletal stabilization first in digit replantation, so bone remains the correct answer despite the noisy raw explanation.' },
  43732: { action: 'clear', note: 'Raw explanation states inferior thyroid artery escapes injury, matching current option B.' },
};

function getCorrectOption(caseData) {
  return (caseData.options || []).find((option) => option.is_correct) || null;
}

console.log('LANE 1 - UNRESOLVED ADJUDICATION');
console.log(`MODE: ${IS_DRY_RUN ? 'DRY RUN (READ ONLY)' : 'PRODUCTION WRITE ENABLED'}\n`);

const storage = await openCaseStorage({ mode: 'sqlite' });
const stats = {
  totalReviewed: 0,
  cleared: [],
  fixed: [],
  held: [],
  untouched: [],
};
const modifiedById = new Map();

try {
  for (const caseData of storage.dataset) {
    if (caseData.meta?.status !== 'QUARANTINED_HASH_ANCHOR_MISMATCH') continue;
    stats.totalReviewed++;

    const decision = DECISIONS[caseData._id];
    if (!decision) {
      stats.untouched.push({
        id: caseData._id,
        case_code: caseData.case_code,
        current: getCorrectOption(caseData)?.id || null,
      });
      continue;
    }

    const rawAnchor = caseData.meta?.failed_raw_anchor || caseData.meta?.answer_anchor_text || '';
    caseData.meta = caseData.meta || {};
    caseData.meta.lane1_manual_resolution = {
      at: new Date().toISOString(),
      action: decision.action,
      note: decision.note,
    };

    if (decision.action === 'hold') {
      caseData.meta.answer_anchor_text = rawAnchor;
      caseData.meta.review_queue = 'CLINICAL_REVIEW';
      stats.held.push({
        id: caseData._id,
        case_code: caseData.case_code,
      });
      modifiedById.set(caseData._id, caseData);
      continue;
    }

    delete caseData.meta.status;
    delete caseData.meta.failed_raw_anchor;
    caseData.meta.answer_anchor_text = rawAnchor;

    if (decision.action === 'fix') {
      for (const option of caseData.options || []) {
        option.is_correct = option.id === decision.optionId;
        if (option.id === decision.optionId && decision.optionText) {
          option.text = decision.optionText;
        }
      }
      stats.fixed.push({
        id: caseData._id,
        case_code: caseData.case_code,
        optionId: decision.optionId,
      });
    } else {
      stats.cleared.push({
        id: caseData._id,
        case_code: caseData.case_code,
        optionId: getCorrectOption(caseData)?.id || null,
      });
    }

    modifiedById.set(caseData._id, caseData);
  }

  if (!IS_DRY_RUN && modifiedById.size > 0) {
    await storage.persistCases([...modifiedById.values()], { fullDataset: storage.dataset });
  }
} finally {
  await storage.close();
}

if (!fs.existsSync('ingestion/output')) fs.mkdirSync('ingestion/output', { recursive: true });
fs.writeFileSync(REPORT_PATH, JSON.stringify(stats, null, 2), 'utf8');

console.log(`Storage backend: ${storage.label}`);
console.table({
  'Reviewed unresolved': stats.totalReviewed,
  Cleared: stats.cleared.length,
  Fixed: stats.fixed.length,
  Held: stats.held.length,
  Remaining: stats.untouched.length,
});
console.log(`\nDetailed log saved to: ${REPORT_PATH}`);
