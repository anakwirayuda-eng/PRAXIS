import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openCasebankDb } from '../server/casebank-db.js';
import { createCasebankRepository } from '../server/casebank-repository.js';
import { applyResolvedCategory, normalizeCategoryExact } from '../src/data/categoryResolution.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DATA_FILE = join(ROOT, 'public', 'data', 'compiled_cases.json');
const REPORT_FILE = join(__dirname, 'output', 'category_source_map_apply_report.json');

const SOURCE_CATEGORY_MAP = {
  'mmlu-anatomy': 'Anatomi',
  'mmlu-college_biology': 'Biokimia',
  'mmlu-high_school_biology': 'Biokimia',
  'mmlu-medical_genetics': 'Biokimia',
  'mmlu-nutrition': 'Ilmu Kesehatan Masyarakat',
  'mmlu-professional_psychology': 'Psikiatri',
  'mmlu-virology': 'Mikrobiologi',
};

function ensureDir(path) {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true });
  }
}

function writeJson(path, value) {
  ensureDir(dirname(path));
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function normalize(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
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

function getSource(caseRecord) {
  return normalize(caseRecord?.meta?.source || caseRecord?.source);
}

function getResolution(caseRecord) {
  const resolution = caseRecord?.meta?.category_resolution;
  return resolution && typeof resolution === 'object' ? resolution : {};
}

function getAllowedCategories(caseRecord) {
  const resolution = getResolution(caseRecord);
  return new Set([
    normalizeCategoryExact(caseRecord?.category),
    normalizeCategoryExact(resolution.resolved_category),
    normalizeCategoryExact(resolution.runner_up_category),
  ].filter(Boolean));
}

function buildAdjudication(caseRecord, mappedCategory, now) {
  const resolution = getResolution(caseRecord);
  const currentCategory = normalizeCategoryExact(caseRecord?.category);
  const runnerUpCategory = normalizeCategoryExact(resolution.runner_up_category);
  const resolvedCategory = normalizeCategoryExact(resolution.resolved_category);
  const decision = mappedCategory === currentCategory ? 'KEEP_CURRENT' : 'PROMOTE_RUNNER_UP';

  return {
    status: 'applied',
    playbook: 'category_source_map',
    pack_name: 'deterministic-source-category-map',
    bucket_id: `source-map-${getSource(caseRecord)}`,
    decision,
    recommended_category: mappedCategory,
    confidence: 'HIGH',
    reasoning: 'Source-specific MMLU subset maps directly to this category, and the mapped category is already present in the resolver candidate set.',
    evidence: [
      `source=${getSource(caseRecord)}`,
      `current=${currentCategory || ''}`,
      `resolved=${resolvedCategory || ''}`,
      `runner_up=${runnerUpCategory || ''}`,
    ],
    current_category: currentCategory || null,
    target_category: mappedCategory === resolvedCategory ? mappedCategory : null,
    runner_up_category: runnerUpCategory || null,
    runner_up_score: resolution.runner_up_score ?? null,
    applied_at: now,
  };
}

function applySourceMap(caseRecord, mappedCategory, now) {
  const nextMeta = {
    ...(caseRecord.meta || {}),
    category_adjudication: buildAdjudication(caseRecord, mappedCategory, now),
    category_source_map_applied: true,
    category_source_map_applied_at: now,
    category_source_map_basis: `deterministic:${getSource(caseRecord)}->${mappedCategory}`,
  };

  return applyResolvedCategory({
    ...caseRecord,
    meta: nextMeta,
  });
}

function main() {
  const now = new Date().toISOString();
  const repo = createCasebankRepository(openCasebankDb());
  const jsonCases = JSON.parse(readFileSync(DATA_FILE, 'utf8'));
  const jsonById = new Map(jsonCases.map((caseRecord) => [String(caseRecord._id), caseRecord]));
  const dbCases = repo.getAllCases();

  const modified = [];
  const skipped = [];
  const bySource = {};

  try {
    for (const dbCase of dbCases) {
      if (dbCase?.meta?.category_review_needed !== true) {
        continue;
      }

      const source = getSource(dbCase);
      const mappedCategory = normalizeCategoryExact(SOURCE_CATEGORY_MAP[source]);
      if (!mappedCategory) {
        continue;
      }

      const allowed = getAllowedCategories(dbCase);
      if (!allowed.has(mappedCategory)) {
        skipped.push({
          _id: dbCase._id,
          case_code: dbCase.case_code,
          source,
          mapped_category: mappedCategory,
          allowed_categories: [...allowed],
          reason: 'mapped_category_not_in_candidate_set',
        });
        continue;
      }

      const nextCase = applySourceMap(dbCase, mappedCategory, now);
      if (nextCase.category !== mappedCategory || nextCase?.meta?.category_review_needed === true) {
        skipped.push({
          _id: dbCase._id,
          case_code: dbCase.case_code,
          source,
          mapped_category: mappedCategory,
          next_category: nextCase.category,
          next_review_needed: nextCase?.meta?.category_review_needed,
          reason: 'apply_did_not_resolve_review',
        });
        continue;
      }

      if (stableStringify(dbCase) === stableStringify(nextCase)) {
        continue;
      }

      modified.push(nextCase);
      bySource[source] = (bySource[source] || 0) + 1;

      const jsonCase = jsonById.get(String(dbCase._id));
      if (jsonCase) {
        Object.assign(jsonCase, nextCase);
      }
    }

    if (modified.length > 0) {
      repo.updateCaseSnapshots(modified);
      writeJson(DATA_FILE, jsonCases);
    }
  } finally {
    repo.close();
  }

  const report = {
    generated_at: now,
    source_map: SOURCE_CATEGORY_MAP,
    modified_count: modified.length,
    skipped_count: skipped.length,
    by_source: bySource,
    modified_sample: modified.slice(0, 25).map((caseRecord) => ({
      _id: caseRecord._id,
      case_code: caseRecord.case_code,
      source: getSource(caseRecord),
      category: caseRecord.category,
      title: caseRecord.title,
    })),
    skipped_sample: skipped.slice(0, 50),
  };
  writeJson(REPORT_FILE, report);

  console.log('Category source-map apply complete');
  console.log(`  Modified: ${modified.length}`);
  console.log(`  Skipped:  ${skipped.length}`);
  console.log(`  Report:   ${REPORT_FILE}`);
  for (const [source, count] of Object.entries(bySource)) {
    console.log(`  ${source}: ${count}`);
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
}
