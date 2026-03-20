import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DATA_FILE = join(__dirname, '..', 'public', 'data', 'compiled_cases.json');
const REPORT_FILE = join(__dirname, 'output', 'cross_source_dedup_report.json');

const SOURCE_PRIORITY = new Map([
  ['medqa', 5],
  ['headqa', 4],
  ['medmcqa', 3],
  ['ukmppd', 2],
  ['mmlu', 1],
]);

function normalizeWhitespace(value) {
  return String(value ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizeComparable(value) {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function ensureMeta(caseRecord) {
  if (!caseRecord.meta || typeof caseRecord.meta !== 'object') {
    caseRecord.meta = {};
  }

  return caseRecord.meta;
}

function writeJsonAtomically(filePath, value) {
  mkdirSync(dirname(filePath), { recursive: true });
  const tempFile = `${filePath}.tmp`;
  writeFileSync(tempFile, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(tempFile, filePath);
}

function formatCount(value) {
  return value.toLocaleString('en-US');
}

function getCaseId(caseRecord) {
  return String(caseRecord.hash_id ?? caseRecord._id);
}

function getSource(caseRecord) {
  return normalizeWhitespace(caseRecord?.meta?.source ?? caseRecord?.source ?? 'unknown').toLowerCase();
}

function getPriorityKey(source) {
  if (source.startsWith('medqa')) return 'medqa';
  if (source.startsWith('headqa')) return 'headqa';
  if (source.startsWith('medmcqa')) return 'medmcqa';
  if (source.startsWith('ukmppd')) return 'ukmppd';
  if (source.startsWith('mmlu')) return 'mmlu';
  return 'others';
}

function getSourcePriority(source) {
  return SOURCE_PRIORITY.get(getPriorityKey(source)) ?? 0;
}

function getQuestionText(caseRecord) {
  const candidates = [
    caseRecord.question,
    caseRecord.vignette?.narrative,
    caseRecord.title,
  ];

  for (const candidate of candidates) {
    const normalized = normalizeWhitespace(candidate);
    if (normalized) {
      return normalized;
    }
  }

  return '';
}

function getFingerprint(caseRecord) {
  const normalizedStem = normalizeComparable(getQuestionText(caseRecord)).slice(0, 200);
  return createHash('sha256').update(normalizedStem).digest('hex').slice(0, 12);
}

function getCorrectOptionText(caseRecord) {
  if (!Array.isArray(caseRecord.options)) {
    return null;
  }

  const correctOptions = caseRecord.options.filter((option) => option?.is_correct === true);
  if (correctOptions.length !== 1) {
    return null;
  }

  const normalized = normalizeComparable(correctOptions[0]?.text);
  return normalized || null;
}

function getRationaleLength(caseRecord) {
  if (typeof caseRecord.rationale === 'string') {
    return normalizeWhitespace(caseRecord.rationale).length;
  }

  if (
    caseRecord.rationale &&
    typeof caseRecord.rationale === 'object' &&
    typeof caseRecord.rationale.correct === 'string'
  ) {
    return normalizeWhitespace(caseRecord.rationale.correct).length;
  }

  return 0;
}

function getDemographicsScore(caseRecord) {
  const demographics = caseRecord?.vignette?.demographics;
  if (!demographics || typeof demographics !== 'object') {
    return 0;
  }

  let score = 0;
  for (const value of Object.values(demographics)) {
    if (value !== null && value !== undefined && normalizeWhitespace(value)) {
      score += 1;
    }
  }

  return score;
}

function getValidationScore(caseRecord) {
  return Number.isFinite(caseRecord?.validation?.overallScore)
    ? Number(caseRecord.validation.overallScore)
    : 0;
}

function compareCases(left, right) {
  const leftSource = getSource(left);
  const rightSource = getSource(right);
  const comparisons = [
    getSourcePriority(rightSource) - getSourcePriority(leftSource),
    getValidationScore(right) - getValidationScore(left),
    getRationaleLength(right) - getRationaleLength(left),
    getDemographicsScore(right) - getDemographicsScore(left),
    getQuestionText(right).length - getQuestionText(left).length,
    getCaseId(left).localeCompare(getCaseId(right)),
  ];

  return comparisons.find((value) => value !== 0) ?? 0;
}

function clearCrossSourceDuplicate(caseRecord) {
  const meta = ensureMeta(caseRecord);
  let changed = false;

  if (meta.quarantined === true && meta.quarantine_reason === 'cross_source_duplicate') {
    meta.quarantined = false;
    delete meta.quarantine_reason;
    changed = true;
  }

  if (meta.duplicate_of) {
    delete meta.duplicate_of;
    changed = true;
  }

  return changed;
}

function clearCrossSourceConflict(caseRecord) {
  const meta = ensureMeta(caseRecord);
  let changed = false;

  if (meta.quarantine_reason === 'cross_source_conflict') {
    delete meta.quarantine_reason;
    changed = true;
  }

  if (meta.cross_source_conflict === true) {
    delete meta.cross_source_conflict;
    changed = true;
  }

  return changed;
}

function main() {
  const cases = JSON.parse(readFileSync(DATA_FILE, 'utf8'));
  const groups = new Map();

  for (const caseRecord of cases) {
    const fingerprint = getFingerprint(caseRecord);
    if (!groups.has(fingerprint)) {
      groups.set(fingerprint, []);
    }

    groups.get(fingerprint).push(caseRecord);
  }

  const summary = {
    total_cases: cases.length,
    duplicate_groups: 0,
    conflict_groups: 0,
    quarantined_cases: 0,
    review_flagged_cases: 0,
    groups_scanned: 0,
  };
  const reportGroups = [];
  let mutated = false;

  for (const [fingerprint, group] of groups.entries()) {
    if (group.length < 2) {
      continue;
    }

    const sources = [...new Set(group.map(getSource))];
    if (sources.length < 2) {
      continue;
    }

    summary.groups_scanned += 1;

    const answerTexts = group.map((caseRecord) => getCorrectOptionText(caseRecord));
    const uniqueAnswers = [...new Set(answerTexts.filter(Boolean))];
    const allAnswersPresent = answerTexts.every(Boolean);

    if (allAnswersPresent && uniqueAnswers.length === 1) {
      summary.duplicate_groups += 1;

      const sorted = [...group].sort(compareCases);
      const canonical = sorted[0];
      const quarantinedIds = [];

      if (clearCrossSourceDuplicate(canonical) || clearCrossSourceConflict(canonical)) {
        mutated = true;
      }

      for (let index = 1; index < sorted.length; index += 1) {
        const caseRecord = sorted[index];
        const meta = ensureMeta(caseRecord);

        if (meta.quarantined !== true) {
          meta.quarantined = true;
          mutated = true;
        }
        if (meta.quarantine_reason !== 'cross_source_duplicate') {
          meta.quarantine_reason = 'cross_source_duplicate';
          mutated = true;
        }
        if (meta.duplicate_of !== getCaseId(canonical)) {
          meta.duplicate_of = getCaseId(canonical);
          mutated = true;
        }
        if (meta.cross_source_conflict === true) {
          delete meta.cross_source_conflict;
          mutated = true;
        }

        quarantinedIds.push(getCaseId(caseRecord));
      }

      summary.quarantined_cases += quarantinedIds.length;
      reportGroups.push({
        fingerprint,
        action: 'quarantine_duplicates',
        canonical_case_id: getCaseId(canonical),
        canonical_source: getSource(canonical),
        answer_text: uniqueAnswers[0],
        quarantined_case_ids: quarantinedIds,
        sources,
      });
      continue;
    }

    summary.conflict_groups += 1;
    const flaggedIds = [];

    for (const caseRecord of group) {
      const meta = ensureMeta(caseRecord);
      if (meta.quarantined === true && meta.quarantine_reason === 'cross_source_duplicate') {
        meta.quarantined = false;
        mutated = true;
      }
      if (meta.needs_review !== true) {
        meta.needs_review = true;
        mutated = true;
      }
      if (meta.quarantine_reason !== 'cross_source_conflict') {
        meta.quarantine_reason = 'cross_source_conflict';
        mutated = true;
      }
      if (meta.cross_source_conflict !== true) {
        meta.cross_source_conflict = true;
        mutated = true;
      }
      if (meta.duplicate_of) {
        delete meta.duplicate_of;
        mutated = true;
      }

      flaggedIds.push(getCaseId(caseRecord));
    }

    summary.review_flagged_cases += flaggedIds.length;
    reportGroups.push({
      fingerprint,
      action: 'flag_conflict',
      case_ids: flaggedIds,
      sources,
      answers: [...new Set(answerTexts.map((value) => value ?? '(missing)'))],
    });
  }

  const report = {
    timestamp: new Date().toISOString(),
    summary,
    groups: reportGroups.sort((left, right) => left.fingerprint.localeCompare(right.fingerprint)),
  };

  writeJsonAtomically(REPORT_FILE, report);
  if (mutated) {
    writeJsonAtomically(DATA_FILE, cases);
  }

  console.log('=== CROSS-SOURCE DEDUP ===');
  console.log(`Cases scanned: ${formatCount(summary.total_cases)}`);
  console.log(`Cross-source groups found: ${formatCount(summary.groups_scanned)}`);
  console.log(`Duplicate groups quarantined: ${formatCount(summary.duplicate_groups)}`);
  console.log(`Conflict groups flagged: ${formatCount(summary.conflict_groups)}`);
  console.log(`Cases quarantined: ${formatCount(summary.quarantined_cases)}`);
  console.log(`Cases flagged for review: ${formatCount(summary.review_flagged_cases)}`);
  console.log(`Report written to ${REPORT_FILE}`);
}

main();
