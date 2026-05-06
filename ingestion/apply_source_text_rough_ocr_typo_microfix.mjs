import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createCasebankRepository } from '../server/casebank-repository.js';
import { normalizeDisplayText } from '../src/lib/displayTextNormalization.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DATA_FILE = join(__dirname, '..', 'public', 'data', 'compiled_cases.json');
const REPORT_FILE = join(__dirname, 'output', 'source_text_rough_ocr_typo_microfix_report.json');

const ROUGH_TYPO_RE = /\b(?:transpo(?:ed|er|ers|ing)?|conve(?:ed|es|ing)?|hypeension|impoant|paicularly|fuher|hemetemesis|malena|ascitis|hea disease|pa of|Pseudomonea aeuroginosa)\b|aEUR[\u2018\u2019'`]?/i;

const REPLACEMENTS = [
  [/\bPseudomonea aeuroginosa\b/g, 'Pseudomonas aeruginosa'],
  [/aEUR[\u2018\u2019'`]?/gi, '?'],
  [/\btranspoed\b/gi, preserveCase('transported')],
  [/\btranspoers\b/gi, preserveCase('transporters')],
  [/\btranspoer\b/gi, preserveCase('transporter')],
  [/\btranspoing\b/gi, preserveCase('transporting')],
  [/\btranspo\b/gi, preserveCase('transport')],
  [/\bconveed\b/gi, preserveCase('converted')],
  [/\bconves\b/gi, preserveCase('converts')],
  [/\bconveing\b/gi, preserveCase('converting')],
  [/\bconve\b/gi, preserveCase('convert')],
  [/\bhypeension\b/gi, preserveCase('hypertension')],
  [/\bimpoant\b/gi, preserveCase('important')],
  [/\bpaicularly\b/gi, preserveCase('particularly')],
  [/\bfuher\b/gi, preserveCase('further')],
  [/\bhemetemesis\b/gi, preserveCase('hematemesis')],
  [/\bmalena\b/gi, preserveCase('melena')],
  [/\bascitis\b/gi, preserveCase('ascites')],
  [/\bhea disease\b/gi, preserveCase('heart disease')],
  [/\bpa of\b/gi, preserveCase('part of')],
];

function preserveCase(replacement) {
  return (match) => {
    if (match === match.toUpperCase()) {
      return replacement.toUpperCase();
    }
    if (match[0] === match[0].toUpperCase()) {
      return replacement[0].toUpperCase() + replacement.slice(1);
    }
    return replacement;
  };
}

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

function isQuarantined(caseRecord) {
  const meta = caseRecord?.meta || {};
  return meta.quarantined === true || String(meta.status || '').startsWith('QUARANTINED');
}

function getValue(root, path) {
  let current = root;
  for (const segment of path.split('.')) {
    if (current === null || current === undefined) return '';
    const key = Array.isArray(current) && /^\d+$/.test(segment) ? Number(segment) : segment;
    current = current[key];
  }
  return typeof current === 'string' ? current : '';
}

function setValue(root, path, value) {
  const segments = path.split('.');
  let current = root;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index];
    const key = Array.isArray(current) && /^\d+$/.test(segment) ? Number(segment) : segment;
    if (!current[key] || typeof current[key] !== 'object') {
      current[key] = /^\d+$/.test(segments[index + 1]) ? [] : {};
    }
    current = current[key];
  }
  const last = segments.at(-1);
  const key = Array.isArray(current) && /^\d+$/.test(last) ? Number(last) : last;
  current[key] = value;
}

function collectFieldPaths(caseRecord) {
  const paths = ['title', 'prompt', 'question'];

  if (typeof caseRecord.vignette === 'string') {
    paths.push('vignette');
  } else if (caseRecord.vignette && typeof caseRecord.vignette === 'object') {
    paths.push('vignette.narrative', 'vignette.labFindings');
  }

  if (typeof caseRecord.rationale === 'string') {
    paths.push('rationale');
  } else if (caseRecord.rationale && typeof caseRecord.rationale === 'object') {
    paths.push('rationale.correct', 'rationale.pearl');
    for (const key of Object.keys(caseRecord.rationale.distractors ?? {})) {
      paths.push(`rationale.distractors.${key}`);
    }
  }

  for (let index = 0; index < (caseRecord.options || []).length; index += 1) {
    paths.push(`options.${index}.text`);
  }

  return paths;
}

function normalizeRoughTypos(value) {
  if (typeof value !== 'string' || !ROUGH_TYPO_RE.test(value)) {
    return value;
  }

  let next = value;
  for (const [pattern, replacement] of REPLACEMENTS) {
    next = next.replace(pattern, replacement);
  }

  return normalizeDisplayText(next)
    .replace(/\s+\?/g, '?')
    .replace(/\?{2,}/g, '?')
    .replace(/\?([A-Za-z])/g, '? $1')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function compact(value, limit = 220) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function mutateCase(caseRecord) {
  if (isQuarantined(caseRecord)) {
    return [];
  }

  const changes = [];
  for (const fieldPath of collectFieldPaths(caseRecord)) {
    const current = getValue(caseRecord, fieldPath);
    if (!current) continue;

    const next = normalizeRoughTypos(current);
    if (next !== current) {
      setValue(caseRecord, fieldPath, next);
      changes.push({
        field: fieldPath,
        before: compact(current),
        after: compact(next),
      });
    }
  }

  if (changes.length > 0) {
    caseRecord.meta = caseRecord.meta || {};
    caseRecord.meta._source_text_rough_ocr_typo_microfix = {
      applied_at: new Date().toISOString(),
      changed_fields: changes.map((change) => change.field),
      rule: 'high-confidence rough OCR typo normalization',
    };
  }

  return changes;
}

function main() {
  const cases = JSON.parse(readFileSync(DATA_FILE, 'utf8'));
  const modifiedCases = [];
  const report = {
    generated_at: new Date().toISOString(),
    modified_cases: [],
  };

  for (const caseRecord of cases) {
    const changes = mutateCase(caseRecord);
    if (changes.length === 0) continue;

    modifiedCases.push(caseRecord);
    report.modified_cases.push({
      _id: caseRecord._id,
      case_code: caseRecord.case_code || '',
      source: caseRecord.meta?.source || caseRecord.source || 'unknown',
      changes,
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

  console.log('Source text rough OCR typo microfix applied');
  console.log(`  Modified cases: ${report.modified_cases.length}`);
  console.log(`  Report: ${REPORT_FILE}`);
}

main();
