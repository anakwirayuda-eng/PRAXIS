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
let flagged = 0;

cases.forEach((caseData) => {
  const options = Array.isArray(caseData.options) ? caseData.options : [];
  const correctCount = options.filter((option) => option?.is_correct === true).length;
  caseData.meta = caseData.meta && typeof caseData.meta === 'object' ? caseData.meta : {};
  if (caseData.meta.quarantined === true || caseData.meta.needs_review === true) return;
  if (correctCount === 1) return;
  caseData.meta.needs_review = true;
  caseData.meta.correctness_review_reason = 'non_unique_or_missing_correct_answer';
  flagged += 1;
});

atomicWriteJson(casesPath, cases);

console.log('=== FLAG INVALID CASES ===');
console.log(`Cases scanned: ${cases.length}`);
console.log(`New needs_review flags added: ${flagged}`);
