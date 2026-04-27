import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isCasePlayable } from '../data/caseQuality.js';

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

function getPrimaryStem(caseData) {
  if (caseData.q_type === 'CLINICAL_DISCUSSION') {
    return normalizeWhitespace(
      caseData.vignette?.narrative
      || caseData.title
      || caseData.prompt
      || caseData.question,
    );
  }

  return normalizeWhitespace(
    caseData.prompt
    || caseData.question
    || caseData.vignette?.narrative
    || caseData.title,
  );
}

function isReviewedRationaleCase(caseData) {
  const meta = caseData.meta ?? {};
  return meta.review_source === 'openai-batch'
    || meta.ai_audited === true
    || meta._openclaw_t10_verified === true
    || meta.readability_ai_rationale_refreshed === true;
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
        ? caseData.options.filter((option) => Boolean(option?.is_correct) === true).length
        : 0;

      if (isCasePlayable(caseData)) {
        publishableCases.push(correctCount);
      }

      if (correctCount !== 1 && isCasePlayable(caseData)) {
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
      if (score === undefined) return false;
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

  it('ensures reviewed publishable cases do not regress to stub rationales', () => {
    const stubRationales = compiledCases.filter((caseData) => {
      if (!isCasePlayable(caseData) || !isReviewedRationaleCase(caseData)) {
        return false;
      }

      const text = typeof caseData.rationale === 'string'
        ? caseData.rationale
        : caseData.rationale?.correct;
      const normalized = normalizeWhitespace(text);

      if (!normalized) return false;
      const hasAnswerEchoPrefix = /^ans(?:wer)?[\s:.]/i.test(normalized)
        || /^s\s*['"`(]?[a-e]['"`)]?\s*i\.?e\.?/i.test(normalized);
      return normalized.length < 40
        || PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(normalized))
        || (hasAnswerEchoPrefix && normalized.length < 120);
    });

    expect(stubRationales).toEqual([]);
  });

  it('enforces options text uniqueness per published case', () => {
    const duplicateOptionsCases = compiledCases.filter((caseData) => {
      if (!isCasePlayable(caseData) || !Array.isArray(caseData.options)) return false;

      const seenTexts = new Set();
      for (const opt of caseData.options) {
        const text = normalizeWhitespace(opt.text);
        if (seenTexts.has(text)) return true;
        seenTexts.add(text);
      }
      return false;
    });

    expect(duplicateOptionsCases).toEqual([]);
  });

  it('enforces a minimum primary stem length for published cases', () => {
    const shortPromptCases = compiledCases.filter((caseData) => {
      if (!isCasePlayable(caseData)) {
        return false;
      }

      return getPrimaryStem(caseData).length < 10;
    });

    expect(shortPromptCases).toEqual([]);
  });
});
