/**
 * MedCase Pro — Case Loader
 * Keeps hand-crafted cases in the main bundle and streams the compiled library at runtime.
 */
import { useEffect, useSyncExternalStore } from 'react';
import { caseBank as handCrafted, CATEGORIES } from './caseBank';
import { captureException, fetchJsonWithWatchdog } from '../lib/runtimeWatchdog';
import { deobfuscateCase, isObfuscated } from '../lib/aegisDecoder';

// Fix #1: Version-busted path preserves offline-first (no-cache killed offline mode)
const APP_VER = import.meta.env.VITE_APP_VERSION || '1.0.0';
const CASE_LIBRARY_PATH = `${import.meta.env.BASE_URL}data/compiled_cases.json?v=${APP_VER}`;
const FALLBACK_CATEGORY = 'internal-medicine';
const DEFAULT_META = {
  source: 'manual',
  examType: 'BOTH',
  difficulty: 1,
  tags: [],
  provenance: [],
};
const DEFAULT_VIGNETTE = {
  demographics: { age: null, sex: null },
  narrative: '',
  vitalSigns: null,
  labFindings: '',
};
const DEFAULT_RATIONALE = {
  correct: 'Explanation unavailable.',
  distractors: {},
  pearl: '',
};
const VALID_EXAM_TYPES = new Set(['UKMPPD', 'USMLE', 'BOTH', 'MIR-Spain', 'Academic', 'Research', 'Clinical', 'IgakuQA', 'International']);

function normalizeOption(option, index) {
  return {
    id: String(option?.id ?? String.fromCharCode(65 + index)),
    text: option?.text ?? 'Option unavailable.',
    is_correct: Boolean(option?.is_correct),
    sct_panel_votes: Number.isFinite(option?.sct_panel_votes) ? option.sct_panel_votes : 0,
  };
}

function normalizeCase(rawCase, fallbackId) {
  const normalizedId = Number.isInteger(rawCase?._id) ? rawCase._id : fallbackId;
  const meta = rawCase?.meta ?? {};
  const vignette = (typeof rawCase?.vignette === 'string') ? {} : (rawCase?.vignette ?? {});
  const demographics = vignette.demographics ?? {};
  const rationale = rawCase?.rationale ?? {};
  const tags = Array.isArray(meta.tags) ? meta.tags : DEFAULT_META.tags;
  const title = rawCase?.title
    || rawCase?.topic
    || rawCase?.subject_name
    || (rawCase?.case_code ? `Case ${rawCase.case_code}` : `${rawCase?.category || 'Clinical'} Review`);
  const category = CATEGORIES[rawCase?.category] ? rawCase.category : FALLBACK_CATEGORY;
  const qType = rawCase?.q_type === 'SCT' ? 'SCT' : (rawCase?.q_type === 'CLINICAL_DISCUSSION' ? 'CLINICAL_DISCUSSION' : 'MCQ');

  // Resolve narrative: support rawCase.question, rawCase.vignette (string), or vignette.narrative (object)
  const resolvedNarrative = rawCase?.question
    || (typeof rawCase?.vignette === 'string' ? rawCase.vignette : '')
    || vignette.narrative
    || DEFAULT_VIGNETTE.narrative;

  // Resolve rationale: support string rationale (MedExpQA/PubMedQA) or object rationale
  const resolvedRationale = typeof rationale === 'string'
    ? { ...DEFAULT_RATIONALE, correct: rationale || DEFAULT_RATIONALE.correct }
    : {
        ...DEFAULT_RATIONALE,
        ...rationale,
        distractors:
          rationale.distractors && typeof rationale.distractors === 'object'
            ? rationale.distractors
            : DEFAULT_RATIONALE.distractors,
        correct: rationale.correct ?? DEFAULT_RATIONALE.correct,
        pearl: rationale.pearl ?? DEFAULT_RATIONALE.pearl,
      };

  return {
    ...rawCase,
    _id: normalizedId,
    hash_id: rawCase?.hash_id ?? `case_${normalizedId}`,
    q_type: qType,
    confidence: Number.isFinite(rawCase?.confidence) ? rawCase.confidence : 0,
    category,
    title,
    prompt: rawCase?.prompt ?? 'Review this case and choose the best answer.',
    options: Array.isArray(rawCase?.options)
      ? rawCase.options.map(normalizeOption)
      : [],
    // Genius Hack 3: Pre-computed flat search key for O(1) search
    _searchKey: `${title} ${resolvedNarrative.substring(0, 200)} ${tags.join(' ')} ${category} ${meta.source || ''}`.toLowerCase(),
    vignette: {
      ...DEFAULT_VIGNETTE,
      ...vignette,
      demographics: {
        age: demographics.age ?? null,
        sex: demographics.sex ?? null,
      },
      narrative: resolvedNarrative,
      vitalSigns: vignette.vitalSigns ?? DEFAULT_VIGNETTE.vitalSigns,
      labFindings: vignette.labFindings ?? DEFAULT_VIGNETTE.labFindings,
    },
    rationale: resolvedRationale,
    meta: {
      ...DEFAULT_META,
      ...meta,
      source: meta.source ?? DEFAULT_META.source,
      examType: VALID_EXAM_TYPES.has(meta.examType) ? meta.examType : DEFAULT_META.examType,
      difficulty: Number.isFinite(meta.difficulty) ? meta.difficulty : DEFAULT_META.difficulty,
      needs_review: meta.needs_review === true,
      truncated: meta.truncated === true,
      tags,
      provenance: Array.isArray(meta.provenance) ? meta.provenance : DEFAULT_META.provenance,
    },
  };
}

function toError(error) {
  return error instanceof Error ? error : new Error(String(error ?? 'Unknown case library error.'));
}

// Fix #3: O(1) lookup Map for FSRS speed (63K .find() → Map.get())
export const caseMap = new Map();

const normalizedHandCrafted = handCrafted.map((caseData, index) => {
  const c = normalizeCase(caseData, index);
  caseMap.set(c._id, c);
  return c;
});
const handCraftedCount = normalizedHandCrafted.length;

// Fix #2: `let` so quarantine can reassign via .filter() instead of O(N²) .splice()
export let allCases = [...normalizedHandCrafted];
export { CATEGORIES };

let compiledCount = 0;
let loadStatus = 'idle';
let loadError = null;
let loadPromise = null;
const listeners = new Set();

function buildSnapshot() {
  return {
    cases: allCases,
    totalCases: allCases.length,
    handCraftedCount,
    compiledCount,
    status: loadStatus,
    isLoading: loadStatus === 'idle' || loadStatus === 'loading',
    isReady: loadStatus === 'ready',
    error: loadError,
  };
}

let caseBankSnapshot = buildSnapshot();

function publishSnapshot() {
  caseBankSnapshot = buildSnapshot();
  listeners.forEach((listener) => listener());
}

// Time-slicing hydration with 3 Sage fixes: throttled render, aggressive GC, Map indexing
const HYDRATION_CHUNK_SIZE = 1500;

function hydrateCompiledCases(compiledRaw) {
  if (!Array.isArray(compiledRaw)) {
    throw new Error('Compiled case library is not an array.');
  }

  return new Promise((resolve) => {
    compiledCount = compiledRaw.length;
    const needsDecrypt = isObfuscated(compiledRaw[0]); // Check once at start
    let index = 0;
    let lastRenderTime = Date.now(); // Fix #4: Throttle re-renders

    function processChunk() {
      const end = Math.min(index + HYDRATION_CHUNK_SIZE, compiledRaw.length);
      for (let i = index; i < end; i++) {
        if (compiledRaw[i]?.meta?.quarantined) { compiledRaw[i] = null; continue; }
        // Aegis Seal: decode obfuscated fields if present (transparent — works plain or XOR'd)
        if (needsDecrypt) deobfuscateCase(compiledRaw[i]);
        const normalized = normalizeCase(
          { ...compiledRaw[i], _id: handCraftedCount + i },
          handCraftedCount + i,
        );
        allCases.push(normalized);
        caseMap.set(normalized._id, normalized); // Fix #3: Index into O(1) Map
        compiledRaw[i] = null; // Fix #5: Aggressive GC — free source reference immediately
      }
      index = end;

      if (index < compiledRaw.length) {
        // Fix #4: Throttle — max 1 UI update per 250ms (prevents 63x render storm)
        const now = Date.now();
        if (now - lastRenderTime > 250) {
          publishSnapshot();
          lastRenderTime = now;
        }
        setTimeout(processChunk, 0);
      } else {
        resolve(allCases);
      }
    }

    processChunk();
  });
}

export function subscribeToCaseBank(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getCaseBankSnapshot() {
  return caseBankSnapshot;
}

export async function ensureCaseBankLoaded() {
  if (loadStatus === 'ready') {
    return allCases;
  }

  if (loadStatus === 'loading' && loadPromise) {
    return loadPromise;
  }

  loadStatus = 'loading';
  loadError = null;
  publishSnapshot();

  // Blindspot #2: Request persistent storage (prevents iOS Safari silent eviction)
  if (navigator?.storage?.persist) {
    navigator.storage.persist().catch(() => {});
  }

  // Fix #1: cache:'default' preserves offline-first. Version busting via ?v= handles staleness.
  // Horcrux Protocol: try chunked manifest first (Cloudflare), fallback to single file (local dev)
  const manifestPath = `${import.meta.env.BASE_URL}data/manifest.json?v=${APP_VER}`;

  loadPromise = (async () => {
    let loaded = false;

    // Try chunked manifest first (production / Cloudflare Pages)
    try {
      const manifestResp = await fetch(manifestPath, { cache: 'default' });
      if (manifestResp.ok) {
        const manifest = await manifestResp.json();
        if (Array.isArray(manifest.chunks) && manifest.chunks.length > 0) {
          compiledCount = manifest.totalCases || 0;
          // Sequential streaming: one chunk at a time (RAM stays < 20MB)
          for (const chunkFile of manifest.chunks) {
            const chunkUrl = `${import.meta.env.BASE_URL}data/${chunkFile}?v=${APP_VER}`;
            const chunkData = await fetchJsonWithWatchdog(
              chunkUrl,
              { cache: 'default' },
              { source: 'case-loader', operation: `chunk ${chunkFile}`, timeoutMs: 30000, retries: 2, retryDelayMs: 1000 },
            );
            await hydrateCompiledCases(chunkData);
          }
          loaded = true;
        }
      }
    } catch { /* manifest not found = not chunked, try single file */ }

    // Fallback: single compiled_cases.json (local dev)
    if (!loaded) {
      const compiledRaw = await fetchJsonWithWatchdog(
        CASE_LIBRARY_PATH,
        { cache: 'default' },
        { source: 'case-loader', operation: 'compiled case library load', timeoutMs: 60000, retries: 2, retryDelayMs: 1500 },
      );
      await hydrateCompiledCases(compiledRaw);
    }
  })()
    .then(async () => {
      // Genius Hack 4: Time-sliced hydration complete

      // Quarantine Manifest — zero-downtime quality filter
      try {
        const qPath = `${import.meta.env.BASE_URL}data/quarantine_manifest.json`;
        const qResp = await fetch(qPath, { cache: 'no-cache' });
        if (qResp.ok) {
          const manifest = await qResp.json();
          if (Array.isArray(manifest) && manifest.length > 0) {
            const badIds = new Set(manifest.map(q => q.id));
            const before = allCases.length;
            // Fix #2: O(N) functional filter replaces O(N²) splice massacre
            allCases = allCases.filter(c => {
              if (badIds.has(c._id)) { caseMap.delete(c._id); return false; }
              return true;
            });
            if (before > allCases.length) console.log(`[MedCase] Quarantined ${before - allCases.length} cases`);
          }
        }
      } catch { /* quarantine manifest optional */ }

      // FSRS Amnesia Protocol — wipe contaminated review memory (runs once)
      try {
        const { applyAntidoteAmnesia } = await import('./fsrs');
        applyAntidoteAmnesia(allCases);
      } catch { /* amnesia module optional */ }

      loadStatus = 'ready';
      loadError = null;
      publishSnapshot();
      console.log(`[MedCase] Loaded ${allCases.length} cases (${handCraftedCount} hand-crafted + ${compiledCount} compiled) — time-sliced`);
      return allCases;
    })
    .catch((error) => {
      loadStatus = 'error';
      loadError = toError(error);
      captureException(loadError, {
        type: 'case-library-load-failed',
        source: 'case-loader',
        message: loadError.message,
        metadata: {
          path: CASE_LIBRARY_PATH,
        },
      });
      publishSnapshot();
      console.error('[MedCase] Failed to load compiled case library:', loadError);
      return allCases;
    })
    .finally(() => {
      loadPromise = null;
    });

  return loadPromise;
}

export async function retryCaseBankLoad() {
  if (loadStatus === 'ready') {
    return allCases;
  }

  if (loadStatus === 'loading' && loadPromise) {
    return loadPromise;
  }

  loadStatus = 'idle';
  loadError = null;
  publishSnapshot();

  return ensureCaseBankLoaded();
}

export function useCaseBank() {
  const snapshot = useSyncExternalStore(subscribeToCaseBank, getCaseBankSnapshot, getCaseBankSnapshot);

  useEffect(() => {
    if (snapshot.status === 'idle') {
      void ensureCaseBankLoaded();
    }
  }, [snapshot.status]);

  return snapshot;
}

export const getCasesByCategory = (category) => allCases.filter((caseData) => caseData.category === category);
export const getCasesByExamType = (examType) => allCases.filter((caseData) =>
  caseData.meta.examType === examType || caseData.meta.examType === 'BOTH'
);
// Fix #3: O(1) Map lookup replaces O(N) .find() — critical for FSRS calling this 200x
export const getCaseById = (id) => caseMap.get(id);
export const getRandomCase = () => (allCases.length > 0
  ? allCases[Math.floor(Math.random() * allCases.length)]
  : null);
export const getTotalCases = () => allCases.length;

export const getDatasetStats = (cases = allCases) => {
  const stats = {
    total: cases.length,
    handCrafted: handCraftedCount,
    compiled: compiledCount,
    byCategory: {},
    bySource: {},
    byExamType: {},
    byConfidence: { high: 0, medium: 0, low: 0 },
  };

  cases.forEach((caseData) => {
    stats.byCategory[caseData.category] = (stats.byCategory[caseData.category] || 0) + 1;

    const source = caseData.meta?.source || 'manual';
    stats.bySource[source] = (stats.bySource[source] || 0) + 1;

    const examType = caseData.meta?.examType || 'BOTH';
    stats.byExamType[examType] = (stats.byExamType[examType] || 0) + 1;

    if (caseData.confidence >= 4) stats.byConfidence.high++;
    else if (caseData.confidence >= 3) stats.byConfidence.medium++;
    else stats.byConfidence.low++;
  });

  return stats;
};
