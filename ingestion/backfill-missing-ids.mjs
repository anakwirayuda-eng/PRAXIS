import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const casesPath = path.join(projectRoot, 'public', 'data', 'compiled_cases.json');

function atomicWriteJson(targetPath, value) {
  mkdirSync(path.dirname(targetPath), { recursive: true });
  const tempPath = `${targetPath}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(tempPath, targetPath);
}

const cases = JSON.parse(readFileSync(casesPath, 'utf8'));
let backfilled = 0;

cases.forEach((caseData, index) => {
  if (caseData._id !== null && caseData._id !== undefined && String(caseData._id).trim() !== '') return;
  const fallbackId = caseData.case_code || caseData.hash_id || `${caseData.source || caseData.meta?.source || 'case'}-${index + 1}`;
  caseData._id = fallbackId;
  backfilled += 1;
});

atomicWriteJson(casesPath, cases);

console.log('=== BACKFILL IDS ===');
console.log(`Cases scanned: ${cases.length}`);
console.log(`Missing _id values backfilled: ${backfilled}`);
