import { describe, expect, it } from 'vitest';
import { isCaseNeedsReview, isCasePlayable, isCaseQuarantined, isCaseTruncated } from '../data/caseQuality';

describe('case quality gates', () => {
  it('treats status-based quarantines as quarantined even without the boolean flag', () => {
    const caseData = {
      meta: {
        quarantined: false,
        status: 'QUARANTINED_AI_CONFLICT',
      },
    };

    expect(isCaseQuarantined(caseData)).toBe(true);
    expect(isCasePlayable(caseData)).toBe(false);
  });

  it('keeps review and truncation flags separate but blocks both from playable pools', () => {
    expect(isCaseNeedsReview({ meta: { needs_review: true } })).toBe(true);
    expect(isCaseTruncated({ meta: { truncated: true } })).toBe(true);
    expect(isCasePlayable({ meta: { needs_review: true } })).toBe(false);
    expect(isCasePlayable({ meta: { truncated: true } })).toBe(false);
  });
});
