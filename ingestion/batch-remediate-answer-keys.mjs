import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const COMPILED_PATH = join(__dirname, '..', 'public', 'data', 'compiled_cases.json');
const MANIFEST_PATH = join(__dirname, '..', 'public', 'data', 'quarantine_manifest.json');
const RAW_MEDMCQA_PATH = join(__dirname, 'sources', 'medmcqa', 'medmcqa_raw.json');
const REPORTS_DIR = join(__dirname, 'reports');
const AUDIT_PATH = join(REPORTS_DIR, 'answer_key_audit.json');
const REMEDIATION_LOG_PATH = join(REPORTS_DIR, 'remediation_log.json');

const STOPWORDS = new Set([
  'about', 'after', 'again', 'against', 'agents', 'also', 'among', 'an', 'and', 'any',
  'appropriate', 'are', 'associated', 'association', 'because', 'been', 'before', 'being',
  'best', 'between', 'both', 'but', 'can', 'case', 'characteristics', 'common',
  'complication', 'condition', 'correct', 'current', 'data', 'diagnosis', 'different',
  'disease', 'does', 'during', 'each', 'episodes', 'evaluation', 'false', 'features',
  'findings', 'following', 'from', 'future', 'have', 'into', 'least', 'likely',
  'management', 'most', 'more', 'next', 'none', 'often', 'only', 'option', 'other',
  'patient', 'possible', 'prevention', 'prevent', 'problem', 'question', 'regarding',
  'result', 'seen', 'shows', 'should', 'similar', 'some', 'statement', 'step', 'tests',
  'that', 'their', 'them', 'there', 'these', 'they', 'this', 'those', 'treatment',
  'true', 'underlying', 'used', 'useful', 'which', 'with', 'without', 'would', 'wrong',
]);

const CONFIDENCE_WEIGHT = {
  high: 3,
  medium: 2,
  low: 1,
};

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function writeJsonAtomic(filePath, value, pretty = false) {
  const tmpPath = `${filePath}.tmp`;
  const payload = pretty ? `${JSON.stringify(value, null, 2)}\n` : JSON.stringify(value);
  writeFileSync(tmpPath, payload, 'utf8');
  try {
    renameSync(tmpPath, filePath);
  } catch (error) {
    if (error?.code !== 'EPERM' && error?.code !== 'EEXIST') {
      throw error;
    }

    const backupPath = `${filePath}.bak`;
    if (existsSync(backupPath)) {
      rmSync(backupPath, { force: true });
    }

    renameSync(filePath, backupPath);
    renameSync(tmpPath, filePath);
    rmSync(backupPath, { force: true });
  }
}

function ensureDir(dirPath) {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
  }
}

function normalizeText(value) {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeLoose(value) {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim();
}

function getPromptText(caseRecord) {
  return String(
    caseRecord?.prompt ||
      caseRecord?.question ||
      caseRecord?.vignette?.narrative ||
      caseRecord?.title ||
      '',
  ).trim();
}

function getRationaleText(caseRecord) {
  if (typeof caseRecord?.rationale === 'string') {
    return caseRecord.rationale.trim();
  }

  if (typeof caseRecord?.rationale?.correct === 'string') {
    return caseRecord.rationale.correct.trim();
  }

  return '';
}

function getOptions(caseRecord) {
  return Array.isArray(caseRecord?.options) ? caseRecord.options : [];
}

function getCurrentCorrect(caseRecord) {
  const options = getOptions(caseRecord);
  const index = options.findIndex((option) => option?.is_correct === true);
  if (index === -1) {
    return { index: null, option: null };
  }

  return { index, option: options[index] };
}

function buildOptionFingerprint(options) {
  return options
    .map((option) => normalizeText(option?.text))
    .filter(Boolean)
    .sort()
    .join('|');
}

function detectCopBase(items) {
  const values = new Set(
    items
      .map((item) => Number.parseInt(item?.cop, 10))
      .filter((value) => Number.isInteger(value)),
  );

  if (values.has(0) && values.has(4)) {
    throw new Error('Mixed MedMCQA `cop` bases detected in raw source.');
  }

  if (values.has(0)) {
    return 0;
  }

  if (values.has(4)) {
    return 1;
  }

  throw new Error(
    `Unable to infer MedMCQA \`cop\` base from raw values: ${[...values].sort((a, b) => a - b).join(', ') || 'none'}`,
  );
}

function buildMedmcqaAnchorMap(rawItems) {
  const copBase = detectCopBase(rawItems);
  const map = new Map();

  for (const item of rawItems) {
    const options = [item?.opa, item?.opb, item?.opc, item?.opd]
      .map((text) => String(text ?? '').trim())
      .filter(Boolean);

    if (options.length < 2) {
      continue;
    }

    const copValue = Number.parseInt(item?.cop, 10);
    const anchorIndex = copValue - copBase;
    const anchorText = [item?.opa, item?.opb, item?.opc, item?.opd][anchorIndex];
    if (!anchorText) {
      continue;
    }

    const fingerprint = buildOptionFingerprint(options.map((text) => ({ text })));
    const normalizedAnchor = normalizeText(anchorText);
    const existing = map.get(fingerprint);

    if (!existing) {
      map.set(fingerprint, {
        anchorText,
        normalizedAnchor,
        ambiguous: false,
      });
      continue;
    }

    if (existing.normalizedAnchor !== normalizedAnchor) {
      existing.ambiguous = true;
    }
  }

  return map;
}

function resolveTargetIndexFromWindow(rationaleText, matchIndex, matchLength, options) {
  const answerWindow = rationaleText
    .slice(matchIndex + matchLength, matchIndex + matchLength + 120)
    .split(/[\n;]+/, 1)[0];
  const comparableWindow = normalizeText(answerWindow);
  const optionCandidates = options
    .map((option, index) => ({
      index,
      text: String(option?.text ?? '').trim(),
      comparable: normalizeText(option?.text),
    }))
    .filter((option) => option.comparable.length >= 3);

  let bestMatch = null;
  for (const option of optionCandidates) {
    const position = comparableWindow.indexOf(option.comparable);
    if (position === -1) {
      continue;
    }

    if (
      !bestMatch ||
      position < bestMatch.position ||
      (position === bestMatch.position && option.comparable.length > bestMatch.length)
    ) {
      bestMatch = {
        index: option.index,
        position,
        length: option.comparable.length,
      };
    }
  }

  return bestMatch?.index ?? null;
}

function extractExplicitAnswer(rationaleText, options) {
  const candidates = [];
  const patterns = [
    /(?:the\s+)?correct\s+answer\s+is\s+([A-E])(?:\s*[:.)-]|\b)/gi,
    /\bANSWER\s*[:.]?\s*\(?([A-E])\)?(?:\s*[:.)-]|\b)/gi,
    /\bAns(?:wer)?\.?\s*(?:is|:)?\s*['"`(]*([A-E])['"`)]?(?:\s*[:.)-]|\b)/gi,
    /(?:^|\n)\s*s\s*['"`(]*([A-E])['"`)]?\s*i\.?\s*e\.?/gim,
  ];

  for (const pattern of patterns) {
    for (const match of rationaleText.matchAll(pattern)) {
      const letter = String(match[1] ?? '').toUpperCase();
      const index = match.index ?? -1;
      if (!letter || index === -1) {
        continue;
      }

      const after = rationaleText.slice(index + match[0].length, index + match[0].length + 12);
      if (/^\s*(?:>|<|\/|&|,|and\b|or\b)/i.test(after)) {
        continue;
      }

      const textIndex = resolveTargetIndexFromWindow(rationaleText, index, match[0].length, options);
      if (textIndex === null) {
        continue;
      }

      candidates.push({ letter, index, targetIndex: textIndex });
    }
  }

  candidates.sort((left, right) => left.index - right.index);
  if (candidates.length > 0) {
    return candidates[0];
  }

  return null;
}

function containsComparablePhrase(haystack, needle) {
  const comparableNeedle = normalizeText(needle);
  if (!comparableNeedle || comparableNeedle.length < 5) {
    return false;
  }

  return normalizeText(haystack).includes(comparableNeedle);
}

function tokenizeImportant(text) {
  const tokens = normalizeText(text)
    .split(' ')
    .map((token) => {
      if (token.endsWith('ies') && token.length > 6) {
        return `${token.slice(0, -3)}y`;
      }

      if (token.endsWith('s') && token.length > 6) {
        return token.slice(0, -1);
      }

      return token;
    })
    .filter((token) => token.length >= 5 && !STOPWORDS.has(token));

  return [...new Set(tokens)];
}

function detectSimpleLanguage(text) {
  const normalized = normalizeLoose(text);
  const idHits = (normalized.match(/\b(pasien|dengan|yang|adalah|pada|untuk|karena|dan|tidak|dapat|lebih|sering)\b/g) || []).length;
  const enHits = (normalized.match(/\b(the|patient|with|because|which|that|this|these|those|not|more|most|often|used|correct)\b/g) || []).length;

  if (idHits >= 2 && idHits > enHits * 1.5) {
    return 'id';
  }

  if (enHits >= 2 && enHits > idHits * 1.5) {
    return 'en';
  }

  return 'other';
}

function detectTopicDrift(caseRecord) {
  const rationaleText = getRationaleText(caseRecord);
  if (rationaleText.length < 120) {
    return null;
  }

  const options = getOptions(caseRecord);
  const currentCorrect = getCurrentCorrect(caseRecord);
  const optionMentioned = options.some((option) => containsComparablePhrase(rationaleText, option?.text));
  if (optionMentioned) {
    return null;
  }

  const promptText = getPromptText(caseRecord);
  const promptLanguage = detectSimpleLanguage(promptText);
  const rationaleLanguage = detectSimpleLanguage(rationaleText);
  if (promptLanguage !== 'other' && rationaleLanguage !== 'other' && promptLanguage !== rationaleLanguage) {
    return null;
  }

  const promptTokens = tokenizeImportant(promptText);
  const correctTokens = tokenizeImportant(currentCorrect.option?.text ?? '');
  const anchorTokens = [...new Set([...promptTokens, ...correctTokens])];
  const rationaleTokens = tokenizeImportant(rationaleText);

  if (anchorTokens.length < 2 || rationaleTokens.length < 4) {
    return null;
  }

  const overlap = anchorTokens.filter((token) => rationaleTokens.includes(token));
  if (overlap.length > 0) {
    return null;
  }

  const optionTokenOverlap = options.some((option) => {
    const optionTokens = tokenizeImportant(option?.text ?? '');
    return optionTokens.some((token) => rationaleTokens.includes(token));
  });
  if (optionTokenOverlap) {
    return null;
  }

  return {
    promptTokens: anchorTokens.slice(0, 6),
    rationaleTokens: rationaleTokens.slice(0, 6),
  };
}

function compareIds(left, right) {
  const leftNumber = Number(left);
  const rightNumber = Number(right);

  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
    return leftNumber - rightNumber;
  }

  return String(left).localeCompare(String(right));
}

function buildAuditEntry(caseRecord, currentCorrect, detection) {
  return {
    _id: caseRecord._id,
    case_code: caseRecord.case_code ?? null,
    prompt_snippet: getPromptText(caseRecord).slice(0, 120),
    current_correct_index: currentCorrect.index,
    current_correct_text: currentCorrect.option?.text ?? null,
    rationale_says_index: detection.targetIndex,
    rationale_says_text: detection.targetText,
    detection_method: detection.method,
    confidence: detection.confidence,
    rationale_snippet: getRationaleText(caseRecord).slice(0, 280),
  };
}

function setSingleCorrectOption(options, targetIndex) {
  let changed = false;

  for (let index = 0; index < options.length; index += 1) {
    const shouldBeCorrect = index === targetIndex;
    if (Boolean(options[index]?.is_correct) !== shouldBeCorrect) {
      options[index].is_correct = shouldBeCorrect;
      changed = true;
    }
  }

  return changed;
}

function main() {
  ensureDir(REPORTS_DIR);

  const compiledCases = readJson(COMPILED_PATH);
  const quarantineManifest = readJson(MANIFEST_PATH);
  const rawMedmcqa = readJson(RAW_MEDMCQA_PATH);
  const medmcqaAnchorMap = buildMedmcqaAnchorMap(rawMedmcqa);
  const caseMap = new Map(compiledCases.map((caseRecord) => [String(caseRecord._id), caseRecord]));
  const staleManifestEntries = quarantineManifest.filter((entry) => !caseMap.has(String(entry.id)));
  const normalizedManifest = quarantineManifest.filter((entry) => caseMap.has(String(entry.id)));

  const auditEntries = [];
  const auditById = new Map();
  const remediationLog = [];

  function upsertAudit(caseRecord, detection) {
    const currentCorrect = getCurrentCorrect(caseRecord);
    const nextEntry = buildAuditEntry(caseRecord, currentCorrect, detection);
    const existing = auditById.get(String(caseRecord._id));
    if (!existing || CONFIDENCE_WEIGHT[nextEntry.confidence] > CONFIDENCE_WEIGHT[existing.confidence]) {
      auditById.set(String(caseRecord._id), nextEntry);
    }
  }

  for (const caseRecord of compiledCases) {
    const options = getOptions(caseRecord);
    if (options.length < 2) {
      continue;
    }

    const currentCorrect = getCurrentCorrect(caseRecord);
    if (currentCorrect.index === null || !currentCorrect.option) {
      continue;
    }

    const rationaleText = getRationaleText(caseRecord);

    const explicit = extractExplicitAnswer(rationaleText, options);
    if (explicit) {
      const targetIndex = explicit.targetIndex;
      const targetOption = options[targetIndex];
      if (targetOption && normalizeText(targetOption.text) !== normalizeText(currentCorrect.option.text)) {
        upsertAudit(caseRecord, {
          method: 'regex_answer_is_X',
          confidence: 'high',
          targetIndex,
          targetText: targetOption.text,
        });
        continue;
      }
    }

    let anchorText = caseRecord?.meta?.answer_anchor_text;
    if (!anchorText && caseRecord?.meta?.source === 'medmcqa') {
      const fingerprint = buildOptionFingerprint(options);
      const recoveredAnchor = medmcqaAnchorMap.get(fingerprint);
      if (recoveredAnchor && !recoveredAnchor.ambiguous) {
        anchorText = recoveredAnchor.anchorText;
      }
    }

    if (anchorText && normalizeText(anchorText) !== normalizeText(currentCorrect.option.text)) {
      const targetIndex = options.findIndex((option) => normalizeText(option?.text) === normalizeText(anchorText));
      upsertAudit(caseRecord, {
        method: 'text_anchor_mismatch',
        confidence: 'medium',
        targetIndex: targetIndex === -1 ? null : targetIndex,
        targetText: anchorText,
      });
      continue;
    }

    const drift = detectTopicDrift(caseRecord);
    if (drift) {
      upsertAudit(caseRecord, {
        method: 'rationale_topic_drift',
        confidence: 'low',
        targetIndex: null,
        targetText: null,
      });
    }
  }

  auditEntries.push(...Array.from(auditById.values()).sort((left, right) => {
    const confidenceDelta = CONFIDENCE_WEIGHT[right.confidence] - CONFIDENCE_WEIGHT[left.confidence];
    if (confidenceDelta !== 0) {
      return confidenceDelta;
    }
    return compareIds(left._id, right._id);
  }));

  let fixed = 0;
  for (const entry of auditEntries) {
    if (entry.confidence !== 'high' || entry.rationale_says_index === null) {
      continue;
    }

    const caseRecord = caseMap.get(String(entry._id));
    if (!caseRecord) {
      continue;
    }

    const options = getOptions(caseRecord);
    const currentCorrect = getCurrentCorrect(caseRecord);
    if (currentCorrect.index === entry.rationale_says_index) {
      continue;
    }

    const changed = setSingleCorrectOption(options, entry.rationale_says_index);
    if (!changed) {
      continue;
    }

    fixed += 1;
    remediationLog.push({
      _id: caseRecord._id,
      case_code: caseRecord.case_code ?? null,
      action: 'is_correct_flipped',
      from_index: currentCorrect.index,
      to_index: entry.rationale_says_index,
      reason: `Rationale states "${entry.rationale_snippet.slice(0, 140)}"`,
      timestamp: new Date().toISOString(),
    });
  }

  const manifestIds = new Set(normalizedManifest.map((entry) => String(entry.id)));
  let quarantinedNew = 0;

  for (const entry of auditEntries) {
    if (entry.confidence === 'high') {
      continue;
    }

    const idKey = String(entry._id);
    if (manifestIds.has(idKey)) {
      continue;
    }

    const caseRecord = caseMap.get(idKey);
    normalizedManifest.push({
      id: caseRecord?._id ?? entry._id,
      code: entry.confidence === 'medium' ? 'A5_CONFLICT' : 'A6_DRIFT',
      reason: entry.detection_method,
      case_code: caseRecord?.case_code ?? entry.case_code ?? null,
      source: caseRecord?.meta?.source ?? null,
    });
    manifestIds.add(idKey);
    quarantinedNew += 1;
  }

  const remainingRegexContradictions = [];
  for (const caseRecord of compiledCases) {
    const options = getOptions(caseRecord);
    const currentCorrect = getCurrentCorrect(caseRecord);
    if (options.length < 2 || currentCorrect.index === null) {
      continue;
    }

    const explicit = extractExplicitAnswer(getRationaleText(caseRecord), options);
    if (!explicit) {
      continue;
    }

    const targetIndex = explicit.targetIndex;
    const targetOption = options[targetIndex];
    if (!targetOption) {
      continue;
    }

    if (normalizeText(targetOption.text) !== normalizeText(currentCorrect.option?.text)) {
      remainingRegexContradictions.push({
        _id: caseRecord._id,
        case_code: caseRecord.case_code ?? null,
      });
    }
  }

  const compiledIds = new Set(compiledCases.map((caseRecord) => String(caseRecord._id)));
  const missingManifestIds = normalizedManifest
    .map((entry) => entry.id)
    .filter((id) => !compiledIds.has(String(id)));

  writeJsonAtomic(AUDIT_PATH, auditEntries, true);
  writeJsonAtomic(REMEDIATION_LOG_PATH, remediationLog, true);
  writeJsonAtomic(COMPILED_PATH, compiledCases, false);
  writeJsonAtomic(MANIFEST_PATH, normalizedManifest, true);

  const summary = {
    total_cases: compiledCases.length,
    audit_findings: auditEntries.length,
    fixed,
    quarantined_new: quarantinedNew,
    quarantined_total: normalizedManifest.length,
    remaining_clean: compiledCases.length - normalizedManifest.length,
    remaining_regex_contradictions: remainingRegexContradictions.length,
    missing_manifest_ids: missingManifestIds.length,
    stale_manifest_entries_removed: staleManifestEntries.length,
  };

  console.log('=== ANSWER KEY REMEDIATION ===');
  console.log(`Total cases: ${summary.total_cases}`);
  console.log(`Audit findings: ${summary.audit_findings}`);
  console.log(`Fixed: ${summary.fixed}`);
  console.log(`Quarantined (new): ${summary.quarantined_new}`);
  console.log(`Quarantined (total): ${summary.quarantined_total}`);
  console.log(`Remaining clean: ${summary.remaining_clean}`);
  console.log(`Remaining regex contradictions: ${summary.remaining_regex_contradictions}`);
  console.log(`Missing manifest ids: ${summary.missing_manifest_ids}`);
  console.log(`Stale manifest entries removed: ${summary.stale_manifest_entries_removed}`);

  if (remainingRegexContradictions.length > 0) {
    console.log('Remaining regex contradiction samples:');
    remainingRegexContradictions.slice(0, 10).forEach((entry) => {
      console.log(`  - ${entry._id} ${entry.case_code ?? ''}`.trim());
    });
  }

  if (missingManifestIds.length > 0) {
    console.log('Missing manifest ids:');
    missingManifestIds.slice(0, 10).forEach((id) => {
      console.log(`  - ${id}`);
    });
  }

  if (remainingRegexContradictions.length > 0 || missingManifestIds.length > 0) {
    process.exitCode = 1;
  }
}

main();
