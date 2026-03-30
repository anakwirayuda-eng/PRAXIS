export function getCaseRouteId(caseData) {
  if (!caseData) return '';
  return String(caseData.case_code || caseData.hash_id || caseData.case_id || caseData._id || caseData.id || '');
}

export function caseMatchesRouteId(caseData, routeId) {
  if (!caseData || routeId == null) return false;
  const normalized = String(routeId);
  return [
    caseData.case_code,
    caseData.hash_id,
    caseData.case_id,
    caseData._id,
    caseData.id,
  ].some((value) => value != null && String(value) === normalized);
}
