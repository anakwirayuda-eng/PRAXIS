export function isCaseQuarantined(caseData) {
  const meta = caseData?.meta ?? {};
  return meta.quarantined === true || meta.status?.startsWith?.('QUARANTINED') === true;
}

export function isCaseNeedsReview(caseData) {
  return caseData?.meta?.needs_review === true;
}

export function isCaseTruncated(caseData) {
  return caseData?.meta?.truncated === true;
}

export function isCasePlayable(caseData) {
  return Boolean(caseData)
    && !isCaseQuarantined(caseData)
    && !isCaseNeedsReview(caseData)
    && !isCaseTruncated(caseData);
}
