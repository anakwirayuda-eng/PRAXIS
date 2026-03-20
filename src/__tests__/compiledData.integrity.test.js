import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const DATA_FILE = join(process.cwd(), 'public', 'data', 'compiled_cases.json');
const CASE_CODE_PATTERN = /^[A-Z]{3}-[A-Z]{3}-[A-Z]{3}-\d{5}$/;
const PLACEHOLDER_PATTERNS = [
  /^see reference/i,
  /^explanation unavailable/i,
  /^no explanation available/i,
  /^refer to textbook/i,
  /^not available/i,
  /^n\/a$/i,
  /^-$/,
  /^\.$/,
  /^none$/i,
];

function normalizeWhitespace(value) {
  return String(value ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const compiledCases = JSON.parse(readFileSync(DATA_FILE, 'utf8'));

describe('compiled case dataset integrity', () => {
  it('ensures every case has required identifiers and source metadata', () => {
    const invalid = compiledCases.filter((caseData) => (
      caseData._id === undefined
      || !normalizeWhitespace(caseData.case_code)
      || !Array.isArray(caseData.options)
      || !normalizeWhitespace(caseData.meta?.source || caseData.source)
    ));

    expect(invalid).toEqual([]);
  });

  it('enforces case_code format and global uniqueness', () => {
    const seenCaseCodes = new Set();
    const invalidCaseCodes = [];
    const duplicateCaseCodes = [];

    for (const caseData of compiledCases) {
      const caseCode = String(caseData.case_code);
      if (!CASE_CODE_PATTERN.test(caseCode)) {
        invalidCaseCodes.push(caseCode);
      }

      if (seenCaseCodes.has(caseCode)) {
        duplicateCaseCodes.push(caseCode);
      } else {
        seenCaseCodes.add(caseCode);
      }
    }

    expect(invalidCaseCodes).toEqual([]);
    expect(duplicateCaseCodes).toEqual([]);
  });

  it('enforces unique _id values', () => {
    const seenIds = new Set();
    const duplicateIds = [];

    for (const caseData of compiledCases) {
      const id = String(caseData._id);
      if (seenIds.has(id)) {
        duplicateIds.push(id);
      } else {
        seenIds.add(id);
      }
    }

    expect(duplicateIds).toEqual([]);
  });

  it('keeps published clean cases to exactly one correct answer and leaves invalid ones flagged for review', () => {
    const publishableCases = [];
    const unflaggedInvalidCases = [];

    for (const caseData of compiledCases) {
      const correctCount = Array.isArray(caseData.options)
        ? caseData.options.filter((option) => option?.is_correct === true).length
        : 0;

      if (caseData.meta?.quarantined !== true && caseData.meta?.needs_review !== true) {
        publishableCases.push(correctCount);
      }

      if (correctCount !== 1 && caseData.meta?.quarantined !== true && caseData.meta?.needs_review !== true) {
        unflaggedInvalidCases.push({
          _id: caseData._id,
          case_code: caseData.case_code,
          correctCount,
        });
      }
    }

    expect(publishableCases.every((count) => count === 1)).toBe(true);
    expect(unflaggedInvalidCases).toEqual([]);
  });

  it('keeps quality scores bounded to 0-100', () => {
    const invalidScores = compiledCases.filter((caseData) => {
      const score = caseData.meta?.quality_score;
      return !Number.isFinite(score) || score < 0 || score > 100;
    });

    expect(invalidScores).toEqual([]);
  });

  it('removes non-empty placeholder rationales from the compiled library', () => {
    const placeholderRationales = compiledCases.filter((caseData) => {
      const text = typeof caseData.rationale === 'string'
        ? caseData.rationale
        : caseData.rationale?.correct;
      const normalized = normalizeWhitespace(text);
      return normalized && PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(normalized));
    });

    expect(placeholderRationales).toEqual([]);
  });
});
