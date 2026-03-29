import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

import { saveCompiledCases } from './openclaw.mjs';
import { createCasebankRepository } from '../server/casebank-repository.js';
import { CASEBANK_DB_PATH } from '../server/casebank-db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_JSON_DB_PATH = path.join(__dirname, '..', 'public', 'data', 'compiled_cases.json');

function parseBackendArg(argv = process.argv.slice(2)) {
  const explicit = argv.find((value) => value.startsWith('--backend='));
  if (explicit) return explicit.slice('--backend='.length).trim().toLowerCase();
  if (argv.includes('--json')) return 'json';
  if (argv.includes('--sqlite')) return 'sqlite';
  return null;
}

export function getCaseStorageMode(argv = process.argv.slice(2)) {
  const argMode = parseBackendArg(argv);
  if (argMode) return argMode === 'json' ? 'json' : 'sqlite';
  return process.env.CASEBANK_BACKEND === 'json' ? 'json' : 'sqlite';
}

export function describeCaseStorage(mode) {
  if (mode === 'json') return `JSON (${DEFAULT_JSON_DB_PATH})`;
  return `SQLite (${CASEBANK_DB_PATH})`;
}

export async function openCaseStorage(options = {}) {
  const mode = options.mode || getCaseStorageMode(options.argv);
  if (mode === 'json') {
    const raw = await fs.readFile(options.jsonPath || DEFAULT_JSON_DB_PATH, 'utf8');
    const dataset = JSON.parse(raw);
    return {
      mode,
      label: describeCaseStorage(mode),
      dataset,
      async saveFn(fullDataset, saveOptions = {}) {
        await saveCompiledCases(fullDataset, saveOptions);
      },
      async persistCases(modifiedItems, context = {}) {
        await saveCompiledCases(context.fullDataset || dataset, context.saveOptions || {});
      },
      async close() {},
    };
  }

  const repository = createCasebankRepository();
  const dataset = repository.getAllCases();
  return {
    mode: 'sqlite',
    label: describeCaseStorage('sqlite'),
    dataset,
    async saveFn(fullDataset, context = {}) {
      const modifiedItems = context.modifiedItems?.length ? context.modifiedItems : fullDataset;
      repository.updateCaseSnapshots(modifiedItems);
    },
    async persistCases(modifiedItems) {
      repository.updateCaseSnapshots(modifiedItems);
    },
    async close() {
      repository.close();
    },
  };
}
