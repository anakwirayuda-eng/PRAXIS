/**
 * Category Resolution Audit + Apply
 *
 * Usage:
 *   node ingestion/normalize-categories.mjs
 *   node ingestion/normalize-categories.mjs --target output
 *   node ingestion/normalize-categories.mjs --target public
 *   node ingestion/normalize-categories.mjs --target both
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyResolvedCategory, resolveCaseCategory } from '../src/data/categoryResolution.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');
const OUTPUT_FILE = join(__dirname, 'output', 'compiled_cases.json');
const PUBLIC_FILE = join(PROJECT_ROOT, 'public', 'data', 'compiled_cases.json');
const REPORT_DIR = join(__dirname, 'output');

function parseTargetArg(argv) {
  const targetIndex = argv.findIndex((arg) => arg === '--target');
  if (targetIndex === -1) return 'both';
  return argv[targetIndex + 1] || 'both';
}

function writeJsonAtomic(filePath, value) {
  const tmp = `${filePath}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  renameSync(tmp, filePath);
}

function normalizeDataset(filePath) {
  const raw = JSON.parse(readFileSync(filePath, 'utf8'));
  const countsByRaw = {};
  const countsByResolved = {};
  const countsByFinal = {};
  const countsByConfidence = { high: 0, medium: 0, low: 0 };
  const mismatchPairs = {};
  const reviewQueue = [];

  let autoFixed = 0;
  let reviewQueued = 0;
  let unclassified = 0;

  const normalized = raw.map((caseData) => {
    const resolution = resolveCaseCategory(caseData);
    const updated = applyResolvedCategory(caseData);

    const rawLabel = resolution.raw_normalized_category || resolution.raw_category || '<missing>';
    const resolvedLabel = resolution.resolved_category || '<missing>';
    const finalLabel = updated.category || '<missing>';

    countsByRaw[rawLabel] = (countsByRaw[rawLabel] || 0) + 1;
    countsByResolved[resolvedLabel] = (countsByResolved[resolvedLabel] || 0) + 1;
    countsByFinal[finalLabel] = (countsByFinal[finalLabel] || 0) + 1;
    countsByConfidence[resolution.confidence] = (countsByConfidence[resolution.confidence] || 0) + 1;

    if (resolution.raw_normalized_category && resolution.raw_normalized_category !== resolvedLabel) {
      const pairKey = `${resolution.raw_normalized_category} -> ${resolvedLabel}`;
      mismatchPairs[pairKey] = (mismatchPairs[pairKey] || 0) + 1;
    }

    if (resolution.confidence === 'high' && updated.category !== resolution.raw_normalized_category) {
      autoFixed += 1;
    }

    if (updated.meta?.category_review_needed) {
      reviewQueued += 1;
      reviewQueue.push({
        _id: updated._id,
        case_code: updated.case_code || null,
        title: updated.title || updated.topic || updated.subject_name || '',
        raw_category: resolution.raw_category,
        raw_normalized_category: resolution.raw_normalized_category,
        resolved_category: resolution.resolved_category,
        final_category: updated.category,
        confidence: resolution.confidence,
        prefix: resolution.prefix,
        winning_signals: resolution.winning_signals,
      });
    }

    if (updated.category === 'Unclassified') {
      unclassified += 1;
    }

    return updated;
  });

  writeJsonAtomic(filePath, normalized);

  return {
    normalized,
    audit: {
      file: filePath,
      total_cases: normalized.length,
      auto_fixed_high_confidence: autoFixed,
      review_queued: reviewQueued,
      unclassified,
      counts_by_confidence: countsByConfidence,
      counts_by_raw_category: countsByRaw,
      counts_by_resolved_category: countsByResolved,
      counts_by_final_category: countsByFinal,
      top_mismatch_pairs: Object.entries(mismatchPairs)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 25)
        .map(([pair, count]) => ({ pair, count })),
    },
    reviewQueue,
  };
}

function resolveTargets(targetArg) {
  const requested = targetArg === 'output'
    ? [OUTPUT_FILE]
    : targetArg === 'public'
      ? [PUBLIC_FILE]
      : [OUTPUT_FILE, PUBLIC_FILE];

  return requested.filter((filePath, index, arr) => arr.indexOf(filePath) === index);
}

function main() {
  const target = parseTargetArg(process.argv.slice(2));
  const targets = resolveTargets(target).filter((filePath) => existsSync(filePath));

  if (targets.length === 0) {
    console.error('No compiled case dataset found for category normalization.');
    process.exit(1);
  }

  if (!existsSync(REPORT_DIR)) mkdirSync(REPORT_DIR, { recursive: true });

  const results = targets.map((filePath) => normalizeDataset(filePath));
  const primary = results[0];

  writeJsonAtomic(join(REPORT_DIR, 'category_resolution_audit.json'), primary.audit);
  writeJsonAtomic(join(REPORT_DIR, 'category_review_queue.json'), primary.reviewQueue);

  console.log('🔧 Category Resolution');
  console.log('━'.repeat(60));
  console.log(`Targets: ${targets.join(', ')}`);
  console.log(`Total cases: ${primary.audit.total_cases.toLocaleString()}`);
  console.log(`High-confidence auto-fixes: ${primary.audit.auto_fixed_high_confidence.toLocaleString()}`);
  console.log(`Queued for review: ${primary.audit.review_queued.toLocaleString()}`);
  console.log(`Unclassified: ${primary.audit.unclassified.toLocaleString()}`);
  console.log(`Confidence: high=${primary.audit.counts_by_confidence.high}, medium=${primary.audit.counts_by_confidence.medium}, low=${primary.audit.counts_by_confidence.low}`);
  console.log(`Audit: ${join(REPORT_DIR, 'category_resolution_audit.json')}`);
  console.log(`Review queue: ${join(REPORT_DIR, 'category_review_queue.json')}`);
}

main();
