/**
 * MedCase Pro — FSRS v5 Brain Engine
 * Free Spaced Repetition Scheduler using Float32Array (C-style memory)
 *
 * Memory Layout per case (5 floats = 20 bytes):
 *   [0] Difficulty (1.0 - 10.0)
 *   [1] Stability (days until 90% retention threshold)
 *   [2] Retrievability (0.0 - 1.0, current recall probability)
 *   [3] Lapses (count of times forgotten)
 *   [4] LastReview (unix timestamp in seconds)
 */

const PARAMS_PER_CASE = 5;
const MAX_CASES = 200000;

const FSRS_W = [0.4, 0.6, 2.4, 5.8, 4.93, 0.94, 0.86, 0.01, 1.49, 0.14, 0.94, 2.18, 0.05, 0.34, 1.26, 0.29, 2.61];
const DECAY = -0.5;
const FACTOR = Math.pow(0.9, 1 / DECAY) - 1;

const getStorage = () => {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
};

function createFreshBrain() {
  const mem = new Float32Array(MAX_CASES * PARAMS_PER_CASE);
  for (let i = 0; i < MAX_CASES; i++) {
    mem[i * PARAMS_PER_CASE + 0] = 5.0;
    mem[i * PARAMS_PER_CASE + 1] = 0;
    mem[i * PARAMS_PER_CASE + 2] = 0;
    mem[i * PARAMS_PER_CASE + 3] = 0;
    mem[i * PARAMS_PER_CASE + 4] = 0;
  }
  return mem;
}

function isValidCaseId(caseId) {
  return Number.isInteger(caseId) && caseId >= 0 && caseId < MAX_CASES;
}

export function initBrain() {
  const storage = getStorage();
  if (!storage) return createFreshBrain();

  try {
    const saved = storage.getItem('medcase_brain');
    if (!saved) return createFreshBrain();

    const binary = atob(saved);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }

    const alignedLength = Math.ceil(bytes.length / 4) * 4;
    const alignedBytes = new Uint8Array(alignedLength);
    alignedBytes.set(bytes);

    const stored = new Float32Array(alignedBytes.buffer);
    const fresh = createFreshBrain();
    fresh.set(stored.subarray(0, fresh.length));
    return fresh;
  } catch (error) {
    console.warn('[FSRS] Corrupted brain data, reinitializing.', error);
    return createFreshBrain();
  }
}

export let brainMatrix = initBrain();

function saveBrain() {
  const storage = getStorage();
  if (!storage) return;

  try {
    const bytes = new Uint8Array(brainMatrix.buffer);
    let lastNonZero = bytes.length - 1;
    while (lastNonZero > 0 && bytes[lastNonZero] === 0) {
      lastNonZero--;
    }

    const alignedLength = Math.ceil((lastNonZero + 1) / 4) * 4;
    const trimmed = bytes.slice(0, alignedLength);

    let binary = '';
    const chunkSize = 32768;
    for (let i = 0; i < trimmed.length; i += chunkSize) {
      binary += String.fromCharCode.apply(null, trimmed.subarray(i, i + chunkSize));
    }

    storage.setItem('medcase_brain', btoa(binary));
  } catch (error) {
    console.warn('[FSRS] Save failed:', error.message);
  }
}

export function getCaseState(caseId) {
  if (!isValidCaseId(caseId)) return null;

  const ptr = caseId * PARAMS_PER_CASE;
  return {
    difficulty: brainMatrix[ptr + 0],
    stability: brainMatrix[ptr + 1],
    retrievability: brainMatrix[ptr + 2],
    lapses: brainMatrix[ptr + 3],
    lastReview: brainMatrix[ptr + 4],
    isNew: brainMatrix[ptr + 4] === 0,
  };
}

export function updateReview(caseId, grade) {
  if (!isValidCaseId(caseId) || ![1, 2, 3, 4].includes(grade)) return null;

  const ptr = caseId * PARAMS_PER_CASE;
  let D = Number.isFinite(brainMatrix[ptr + 0]) ? brainMatrix[ptr + 0] : 5.0;
  let S = Number.isFinite(brainMatrix[ptr + 1]) ? brainMatrix[ptr + 1] : 0;
  const lastReview = Number.isFinite(brainMatrix[ptr + 4]) ? brainMatrix[ptr + 4] : 0;
  const isNew = lastReview === 0;
  const now = Date.now() / 1000;

  if (isNew) {
    S = FSRS_W[grade - 1];
    D = Math.max(1, Math.min(10, FSRS_W[4] - (grade - 3) * FSRS_W[5]));
  } else {
    const elapsed = (now - lastReview) / 86400;
    const R = Math.pow(1 + FACTOR * elapsed / S, DECAY);
    const deltaD = FSRS_W[6] * (-(grade - 3) * FSRS_W[7]);
    D = Math.max(1, Math.min(10, D + deltaD));

    if (grade >= 3) {
      const sinFac = Math.exp(FSRS_W[8]) * (11 - D) * Math.pow(S, -FSRS_W[9]) * (Math.exp(FSRS_W[10] * (1 - R)) - 1);
      S = S * (1 + sinFac);
    } else {
      S = Math.max(
        0.1,
        FSRS_W[11] * Math.pow(D, -FSRS_W[12]) * (Math.pow(S + 1, FSRS_W[13]) - 1) * Math.exp(FSRS_W[14] * (1 - R)),
      );
      brainMatrix[ptr + 3] += 1;
    }
  }

  const R = 1.0;
  brainMatrix[ptr + 0] = D;
  brainMatrix[ptr + 1] = S;
  brainMatrix[ptr + 2] = R;
  brainMatrix[ptr + 4] = now;

  saveBrain();
  return { difficulty: D, stability: S, retrievability: R };
}

export function recalcRetrievability() {
  const now = Date.now() / 1000;
  for (let i = 0; i < MAX_CASES; i++) {
    const ptr = i * PARAMS_PER_CASE;
    const S = brainMatrix[ptr + 1];
    const lastReview = brainMatrix[ptr + 4];
    if (lastReview === 0 || S === 0) continue;

    const elapsed = (now - lastReview) / 86400;
    const R = Math.pow(1 + FACTOR * elapsed / S, DECAY);
    brainMatrix[ptr + 2] = Math.max(0, Math.min(1, R));
  }
}

export function getDueCards(threshold = 0.9, limit = 20) {
  recalcRetrievability();
  const due = [];

  for (let i = 0; i < MAX_CASES; i++) {
    const ptr = i * PARAMS_PER_CASE;
    const lastReview = brainMatrix[ptr + 4];
    if (lastReview === 0) continue;

    const R = brainMatrix[ptr + 2];
    if (Number.isFinite(R) && R < threshold) {
      due.push({ caseId: i, retrievability: R, stability: brainMatrix[ptr + 1] });
    }
  }

  due.sort((a, b) => a.retrievability - b.retrievability);
  return due.slice(0, limit);
}

export function getBrainStats(validIds = null) {
  recalcRetrievability();
  let totalReviewed = 0;
  let totalRetention = 0;
  let totalLapses = 0;

  for (let i = 0; i < MAX_CASES; i++) {
    const ptr = i * PARAMS_PER_CASE;
    if (brainMatrix[ptr + 4] === 0) continue;
    if (validIds && !validIds.has(i)) continue; // Filter out contaminated cases

    totalReviewed++;
    totalRetention += brainMatrix[ptr + 2];
    totalLapses += brainMatrix[ptr + 3];
  }

  return {
    totalReviewed,
    averageRetention: totalReviewed > 0 ? Math.round((totalRetention / totalReviewed) * 100) : 0,
    totalLapses,
    memoryStrength: totalReviewed > 0
      ? (totalRetention / totalReviewed > 0.85 ? 'Strong' : totalRetention / totalReviewed > 0.6 ? 'Moderate' : 'Weak')
      : 'No Data',
  };
}

export function exportBrain() {
  const data = {};
  for (let i = 0; i < MAX_CASES; i++) {
    const ptr = i * PARAMS_PER_CASE;
    if (brainMatrix[ptr + 4] === 0) continue;

    data[i] = {
      d: brainMatrix[ptr + 0],
      s: brainMatrix[ptr + 1],
      r: brainMatrix[ptr + 2],
      l: brainMatrix[ptr + 3],
      t: brainMatrix[ptr + 4],
    };
  }
  return data;
}

export function importBrain(data) {
  brainMatrix = createFreshBrain();

  for (const [id, state] of Object.entries(data)) {
    const caseId = Number.parseInt(id, 10);
    if (!isValidCaseId(caseId) || !state || typeof state !== 'object') continue;

    const ptr = caseId * PARAMS_PER_CASE;
    brainMatrix[ptr + 0] = state.d;
    brainMatrix[ptr + 1] = state.s;
    brainMatrix[ptr + 2] = state.r;
    brainMatrix[ptr + 3] = state.l;
    brainMatrix[ptr + 4] = state.t;
  }

  saveBrain();
}

/**
 * FSRS Amnesia Protocol — wipes contaminated FSRS state for antidote-patched cases.
 * Called once on app init. Cases are reset to "New Card" status so users
 * re-learn with the corrected answer.
 * @param {Array} cases - loaded case array from compiled_cases.json
 * @returns {number} count of wiped cards
 */
export function applyAntidoteAmnesia(cases) {
  const AMNESIA_KEY = 'praxis_amnesia_applied';
  const storage = getStorage();
  if (!storage) return 0;

  // Only run once per browser
  try {
    if (storage.getItem(AMNESIA_KEY) === '1') return 0;
  } catch { return 0; }

  let wiped = 0;
  for (const c of cases) {
    if (!c.meta?.antidote_applied) continue;
    const caseId = c._id;
    if (!isValidCaseId(caseId)) continue;

    const ptr = caseId * PARAMS_PER_CASE;
    // Only wipe if user has actually reviewed this card
    if (brainMatrix[ptr + 4] === 0) continue;

    // Reset to fresh state
    brainMatrix[ptr + 0] = 5.0; // difficulty
    brainMatrix[ptr + 1] = 0;   // stability
    brainMatrix[ptr + 2] = 0;   // retrievability
    brainMatrix[ptr + 3] = 0;   // lapses
    brainMatrix[ptr + 4] = 0;   // lastReview (marks as New)
    wiped++;
  }

  if (wiped > 0) {
    saveBrain();
    console.log(`🧹 FSRS Amnesia Protocol: Reset ${wiped} contaminated cards to New status.`);
  }

  try { storage.setItem(AMNESIA_KEY, '1'); } catch {}
  return wiped;
}

