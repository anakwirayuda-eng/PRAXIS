import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';

import { createCasebankRepository } from '../server/casebank-repository.js';

const DEFAULT_OUTPUT_PATH = 'ingestion/output/compiled_cases.from_sqlite.json';

function getOutPath() {
  const arg = process.argv.slice(2).find((value) => value.startsWith('--out='));
  return resolve(process.cwd(), arg ? arg.slice('--out='.length) : DEFAULT_OUTPUT_PATH);
}

function ensureOutputDirectory(filePath) {
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

const outputPath = getOutPath();
const repository = createCasebankRepository();

try {
  const cases = repository.getAllCases();
  ensureOutputDirectory(outputPath);
  writeFileSync(outputPath, JSON.stringify(cases, null, 2), 'utf8');

  console.log('CASEBANK SQLITE EXPORT');
  console.log(`Cases:   ${cases.length}`);
  console.log(`Output:  ${outputPath}`);
} finally {
  repository.close();
}
