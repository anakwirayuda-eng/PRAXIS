import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createCasebankRepository } from '../server/casebank-repository.js';
import { openCasebankDb } from '../server/casebank-db.js';
import { applyResolvedCategory } from '../src/data/categoryResolution.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..');

const PUBLIC_FILE = join(PROJECT_ROOT, 'public', 'data', 'compiled_cases.json');
const OUTPUT_FILE = join(__dirname, 'output', 'compiled_cases.json');
const REVIEW_QUEUE_FILE = join(__dirname, 'output', 'category_review_queue.json');
const AUDIT_FILE = join(__dirname, 'output', 'category_resolution_audit.json');
const REPORT_FILE = join(__dirname, 'output', 'category_incremental_refresh_report.json');
const TARGET_SOURCES = new Set(['medmcqa', 'medqa', 'headqa']);
const MANAGED_PROMOTION_RULES = new Set([
  'headqa_targeted_runner1',
  'medqa_targeted_runner2',
  'medmcqa_targeted_consensus4',
  'medmcqa_bedah_confirm_consensus',
  'medmcqa_pediatrics_consensus10',
  'medmcqa_pediatrics_medicine_consensus10',
  'medmcqa_surgery_consensus10',
  'medmcqa_obgyn_consensus11',
  'medmcqa_pathology_biopsy_onion_skin_consensus9',
  'medmcqa_pathology_text_runner4',
  'medmcqa_pathology_subject_tag_consensus5',
  'medmcqa_pathology_subject_tag_rescue_runner6',
  'medmcqa_pathology_exact_phrase_subject_tag_consensus5',
  'medmcqa_pathology_morphology_subject_tag_runner6',
  'medmcqa_medicine_streptococcus_host_receptor_consensus5',
  'medmcqa_medicine_peripheral_smear_xray_handfoot_consensus5',
  'medmcqa_microbiology_exact_phrase_runner6',
  'medmcqa_microbiology_exact_phrase_consensus5',
  'medmcqa_microbiology_subject_tag_runner6',
  'medmcqa_microbiology_subject_tag_rescue_runner6',
  'medmcqa_anatomy_subject_tag_consensus4',
  'medmcqa_anatomy_exact_phrase_consensus5',
  'medmcqa_anatomy_exact_phrase_runner6',
  'medmcqa_anatomy_subject_tag_runner6',
  'medmcqa_orthopaedics_subject_tag_rescue3',
  'medmcqa_orthopaedics_runner_bedah_consensus6',
  'medmcqa_dental_exact_phrase_consensus6',
  'medmcqa_psychiatry_child_drift_rescue12',
  'medmcqa_surgery_child_drift_rescue13',
  'medmcqa_obg_child_drift_rescue10',
  'medmcqa_pediatrics_modality_subject_tag_consensus5',
  'medmcqa_dental_rvg_modality_consensus5',
  'medmcqa_surgery_subject_tag_rescue10',
  'medmcqa_surgery_subject_tag_confirm_consensus9',
  'medmcqa_pediatrics_subject_tag_confirm_consensus10',
  'medmcqa_psychiatry_subject_tag_confirm_consensus9',
  'medmcqa_forensic_subject_tag_consensus9',
  'medmcqa_pharmacology_subject_tag_consensus9',
  'medmcqa_biochemistry_subject_tag_consensus11',
  'medmcqa_pharmacology_medicine_consensus10',
  'medmcqa_pharmacology_subject_tag_consensus11',
  'medmcqa_neurology_medicine_consensus10',
  'medmcqa_psychiatry_medicine_consensus10',
  'medmcqa_psychiatry_pharmacology_drift_rescue10',
  'medmcqa_ent_medicine_consensus10',
  'medmcqa_ophthalmology_medicine_consensus10',
  'medmcqa_ophthalmology_subject_tag_consensus7',
  'medmcqa_radiology_subject_tag_consensus9',
  'medmcqa_radiology_subject_tag_consensus10',
  'medmcqa_anaesthesia_subject_tag_consensus7',
  'medmcqa_dermatology_subject_tag_runner3',
  'medmcqa_dermatology_subject_tag_rescue3',
  'medmcqa_public_health_subject_tag_consensus7',
  'medmcqa_dental_subject_tag_consensus12',
  'medmcqa_public_health_subject_consensus7',
  'medmcqa_surgery_pharmacology_drift_rescue10',
]);

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function writeJsonAtomically(filePath, value, pretty = true) {
  const tempFile = `${filePath}.tmp`;
  const payload = pretty
    ? `${JSON.stringify(value, null, 2)}\n`
    : JSON.stringify(value);
  writeFileSync(tempFile, payload, 'utf8');
  try {
    renameSync(tempFile, filePath);
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || !['EPERM', 'EBUSY'].includes(error.code)) {
      throw error;
    }
    writeFileSync(filePath, payload, 'utf8');
    rmSync(tempFile, { force: true });
  }
}

function stableSort(value) {
  if (Array.isArray(value)) {
    return value.map((item) => stableSort(item));
  }
  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce((acc, key) => {
        acc[key] = stableSort(value[key]);
        return acc;
      }, {});
  }
  return value;
}

function stableStringify(value) {
  return JSON.stringify(stableSort(value));
}

function buildReviewEntry(caseData) {
  const resolution = caseData?.meta?.category_resolution || {};
  return {
    _id: caseData._id,
    case_code: caseData.case_code || null,
    source: caseData?.meta?.source || caseData.source || null,
    title: caseData.title || caseData.topic || caseData.subject_name || '',
    raw_category: resolution.raw_category || null,
    raw_normalized_category: resolution.raw_normalized_category || null,
    resolved_category: resolution.resolved_category || null,
    final_category: caseData.category || null,
    confidence: resolution.confidence || 'low',
    prefix: resolution.prefix || null,
    winning_signals: Array.isArray(resolution.winning_signals) ? resolution.winning_signals : [],
  };
}

function buildAudit(cases, filePath) {
  const countsByRaw = {};
  const countsByResolved = {};
  const countsByFinal = {};
  const countsByConfidence = { high: 0, medium: 0, low: 0 };
  const mismatchPairs = {};
  const reviewQueue = [];
  let autoFixed = 0;
  let reviewQueued = 0;
  let unclassified = 0;

  for (const caseData of cases) {
    const resolution = caseData?.meta?.category_resolution || {};
    const rawLabel = resolution.raw_normalized_category || resolution.raw_category || '<missing>';
    const resolvedLabel = resolution.resolved_category || '<missing>';
    const finalLabel = caseData.category || '<missing>';
    const confidence = resolution.confidence || 'low';

    countsByRaw[rawLabel] = (countsByRaw[rawLabel] || 0) + 1;
    countsByResolved[resolvedLabel] = (countsByResolved[resolvedLabel] || 0) + 1;
    countsByFinal[finalLabel] = (countsByFinal[finalLabel] || 0) + 1;
    countsByConfidence[confidence] = (countsByConfidence[confidence] || 0) + 1;

    if (resolution.raw_normalized_category && resolution.raw_normalized_category !== resolvedLabel) {
      const pairKey = `${resolution.raw_normalized_category} -> ${resolvedLabel}`;
      mismatchPairs[pairKey] = (mismatchPairs[pairKey] || 0) + 1;
    }

    if (confidence === 'high' && finalLabel !== resolution.raw_normalized_category) {
      autoFixed += 1;
    }

    if (caseData?.meta?.category_review_needed) {
      reviewQueued += 1;
      reviewQueue.push(buildReviewEntry(caseData));
    }

    if (finalLabel === 'Unclassified') {
      unclassified += 1;
    }
  }

  return {
    audit: {
      file: filePath,
      total_cases: cases.length,
      auto_fixed_high_confidence: autoFixed,
      review_queued: reviewQueued,
      unclassified,
      sqlite_raw_backfilled: 0,
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

function main() {
  const now = new Date().toISOString();
  const publicCases = safeJsonParse(readFileSync(PUBLIC_FILE, 'utf8')) || [];
  const outputCases = existsSync(OUTPUT_FILE)
    ? (safeJsonParse(readFileSync(OUTPUT_FILE, 'utf8')) || [])
    : null;
  const queue = safeJsonParse(readFileSync(REVIEW_QUEUE_FILE, 'utf8')) || [];

  const targetIds = new Set(
    queue
      .filter((item) => TARGET_SOURCES.has(String(item.source || '').trim()))
      .map((item) => String(item._id)),
  );

  const publicIndexById = new Map(publicCases.map((caseData, index) => [String(caseData._id), index]));
  const outputIndexById = outputCases
    ? new Map(outputCases.map((caseData, index) => [String(caseData._id), index]))
    : new Map();

  const casesToSync = [];
  const syncedIds = new Set();
  const report = {
    generated_at: now,
    scanned_queue_items: queue.length,
    targeted_sources: [...TARGET_SOURCES],
    targeted_cases: targetIds.size,
    updated_public_cases: 0,
    synced_cases: 0,
    cleared_review_needed: 0,
    promotion_rules: {},
    by_source: {},
    sample: [],
  };

  for (const caseId of targetIds) {
    const publicIndex = publicIndexById.get(caseId);
    if (publicIndex == null) {
      continue;
    }

    const originalCase = publicCases[publicIndex];
    const updatedCase = applyResolvedCategory(originalCase);
    const publicChanged = (
      originalCase.category === updatedCase.category
      && stableStringify(originalCase.meta || {}) === stableStringify(updatedCase.meta || {})
    ) === false;
    if (publicChanged) {
      publicCases[publicIndex] = updatedCase;
      report.updated_public_cases += 1;
    }

    const publicCaseToSync = publicChanged ? updatedCase : originalCase;
    const rule = publicCaseToSync?.meta?.category_resolution?.promotion_rule || 'none';
    const managedPromotion = MANAGED_PROMOTION_RULES.has(rule);

    let outputChanged = false;
    if (outputCases) {
      const outputIndex = outputIndexById.get(caseId);
      if (outputIndex != null) {
        const outputCase = outputCases[outputIndex];
        outputChanged = stableStringify(outputCase) !== stableStringify(publicCaseToSync);
        if (outputChanged) {
          outputCases[outputIndex] = publicCaseToSync;
        }
      }
    }

    if ((publicChanged || outputChanged || managedPromotion) && !syncedIds.has(caseId)) {
      casesToSync.push(publicCaseToSync);
      syncedIds.add(caseId);
    }

    if (originalCase?.meta?.category_review_needed && !publicCaseToSync?.meta?.category_review_needed) {
      report.cleared_review_needed += 1;
    }

    const source = publicCaseToSync?.meta?.source || publicCaseToSync.source || 'UNKNOWN';
    report.by_source[source] = (report.by_source[source] || 0) + 1;
    report.promotion_rules[rule] = (report.promotion_rules[rule] || 0) + 1;
    if (report.sample.length < 25) {
      report.sample.push({
        _id: publicCaseToSync._id,
        case_code: publicCaseToSync.case_code,
        source,
        final_category: publicCaseToSync.category,
        promotion_rule: rule,
        confidence: publicCaseToSync?.meta?.category_resolution?.confidence || 'low',
      });
    }
  }

  if (report.updated_public_cases > 0) {
    writeJsonAtomically(PUBLIC_FILE, publicCases, true);
  }
  if (outputCases) {
    writeJsonAtomically(OUTPUT_FILE, outputCases, true);
  }

  if (casesToSync.length > 0) {
    const repo = createCasebankRepository(openCasebankDb());
    repo.updateCaseSnapshots(casesToSync);
    repo.close();
  }

  report.synced_cases = casesToSync.length;

  const auditPayload = buildAudit(publicCases, PUBLIC_FILE);
  writeJsonAtomically(AUDIT_FILE, auditPayload.audit, true);
  writeJsonAtomically(REVIEW_QUEUE_FILE, auditPayload.reviewQueue, true);
  writeJsonAtomically(REPORT_FILE, report, true);

  console.log('Incremental category refresh complete');
  console.log(`  Targeted cases:         ${report.targeted_cases}`);
  console.log(`  Updated public cases:   ${report.updated_public_cases}`);
  console.log(`  Synced cases:           ${report.synced_cases}`);
  console.log(`  Review flags cleared:   ${report.cleared_review_needed}`);
  console.log(`  Review queue now:       ${auditPayload.audit.review_queued}`);
  console.log(`  Audit:                  ${AUDIT_FILE}`);
  console.log(`  Review queue:           ${REVIEW_QUEUE_FILE}`);
  console.log(`  Report:                 ${REPORT_FILE}`);
}

main();
