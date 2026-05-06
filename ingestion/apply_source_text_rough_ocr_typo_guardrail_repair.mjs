import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createCasebankRepository } from '../server/casebank-repository.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DATA_FILE = join(__dirname, '..', 'public', 'data', 'compiled_cases.json');
const REPORT_FILE = join(__dirname, 'output', 'source_text_rough_ocr_typo_guardrail_repair_report.json');

const REPAIRS = [
  {
    id: '991141',
    before: 'AORTA membership',
    after: 'AOA membership',
    reason: 'Restore legitimate AOA honor-society acronym incorrectly matched by the lower-case aorta OCR rule.',
  },
];

function writeJsonAtomically(filePath, value, pretty = true) {
  const tempFile = `${filePath}.tmp`;
  const payload = pretty ? `${JSON.stringify(value, null, 2)}\n` : JSON.stringify(value);
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

function compact(value, limit = 220) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function repairStrings(root, repair, path = []) {
  if (typeof root === 'string') {
    if (!root.includes(repair.before)) {
      return { value: root, changes: [] };
    }
    const next = root.replaceAll(repair.before, repair.after);
    return {
      value: next,
      changes: [{
        field: path.join('.'),
        before: compact(root),
        after: compact(next),
      }],
    };
  }

  if (!root || typeof root !== 'object') {
    return { value: root, changes: [] };
  }

  const changes = [];
  for (const [key, value] of Object.entries(root)) {
    const repaired = repairStrings(value, repair, [...path, key]);
    if (repaired.changes.length > 0) {
      root[key] = repaired.value;
      changes.push(...repaired.changes);
    }
  }
  return { value: root, changes };
}

function main() {
  const cases = JSON.parse(readFileSync(DATA_FILE, 'utf8'));
  const modifiedCases = [];
  const report = {
    generated_at: new Date().toISOString(),
    repaired_cases: [],
  };

  for (const repair of REPAIRS) {
    const caseRecord = cases.find((candidate) => String(candidate._id) === repair.id);
    if (!caseRecord) {
      report.repaired_cases.push({ ...repair, status: 'missing_case' });
      continue;
    }

    const repaired = repairStrings(caseRecord, repair);
    if (repaired.changes.length === 0) {
      report.repaired_cases.push({
        ...repair,
        status: 'not_needed',
      });
      continue;
    }

    caseRecord.meta = caseRecord.meta || {};
    caseRecord.meta._source_text_rough_ocr_typo_guardrail_repair = {
      applied_at: new Date().toISOString(),
      changed_fields: repaired.changes.map((change) => change.field),
      reason: repair.reason,
    };
    modifiedCases.push(caseRecord);
    report.repaired_cases.push({
      ...repair,
      status: 'repaired',
      changes: repaired.changes,
    });
  }

  const repository = createCasebankRepository();
  try {
    if (modifiedCases.length > 0) {
      repository.updateCaseSnapshots(modifiedCases);
    }
  } finally {
    repository.close();
  }

  writeJsonAtomically(DATA_FILE, cases, true);
  writeJsonAtomically(REPORT_FILE, report, true);

  console.log('Source text rough OCR typo guardrail repair applied');
  console.log(`  Modified cases: ${modifiedCases.length}`);
  console.log(`  Report: ${REPORT_FILE}`);
}

main();
