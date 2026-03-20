import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const COMPILED_PATH = join(__dirname, '..', 'public', 'data', 'compiled_cases.json');
const MANIFEST_PATH = join(__dirname, '..', 'public', 'data', 'quarantine_manifest.json');
const RAW_MEDMCQA_PATH = join(__dirname, 'sources', 'medmcqa', 'medmcqa_raw.json');
const AUDIT_PATH = join(__dirname, 'reports', 'answer_key_audit.json');
const REPORTS_DIR = join(__dirname, 'reports');
const REMEDIATION_LOG_PATH = join(REPORTS_DIR, 'remediation_log_phase2.json');
const FALSE_POSITIVE_ANALYSIS_PATH = join(REPORTS_DIR, 'false_positive_analysis.json');

const GENERIC_OPTION_TEXT = new Set([
  'all',
  'all of the above',
  'all are correct',
  'none',
  'none of the above',
  'all correct',
  'semua benar',
  'semua salah',
]);

const STOPWORDS = new Set([
  'about', 'above', 'after', 'again', 'against', 'agent', 'also', 'among', 'an', 'and', 'any',
  'appropriate', 'are', 'associated', 'because', 'been', 'before', 'being', 'best', 'between',
  'both', 'but', 'can', 'case', 'characteristic', 'choice', 'common', 'complication', 'condition',
  'correct', 'current', 'data', 'diagnosis', 'different', 'disease', 'does', 'during', 'each',
  'except', 'evaluation', 'false', 'feature', 'finding', 'following', 'from', 'future', 'have',
  'into', 'least', 'likely', 'management', 'most', 'more', 'next', 'none', 'only', 'option',
  'other', 'patient', 'possible', 'prevention', 'prevent', 'problem', 'question', 'regarding',
  'result', 'seen', 'show', 'should', 'similar', 'some', 'statement', 'step', 'test', 'than',
  'that', 'their', 'them', 'there', 'these', 'they', 'this', 'those', 'treatment', 'true',
  'underlying', 'used', 'useful', 'which', 'with', 'without', 'would', 'wrong',
]);

const MEDICAL_SYNONYMS = [
  ['myocardial infarction', ['mi', 'myocardial infarction', 'heart attack']],
  ['diabetes mellitus', ['dm', 'diabetes mellitus', 'diabetes']],
  ['hypertension', ['htn', 'hypertension', 'high blood pressure']],
  ['tuberculosis', ['tb', 'tuberculosis']],
  ['chronic obstructive pulmonary disease', ['copd', 'chronic obstructive pulmonary disease']],
  ['congestive heart failure', ['chf', 'congestive heart failure', 'heart failure']],
  ['chronic kidney disease', ['ckd', 'chronic kidney disease']],
  ['acute kidney injury', ['aki', 'acute kidney injury']],
  ['urinary tract infection', ['uti', 'urinary tract infection']],
  ['upper respiratory tract infection', ['urti', 'upper respiratory tract infection']],
  ['electrocardiogram', ['ecg', 'ekg', 'electrocardiogram']],
  ['electroencephalogram', ['eeg', 'electroencephalogram']],
  ['cerebrospinal fluid', ['csf', 'cerebrospinal fluid']],
  ['gastroesophageal reflux disease', ['gerd', 'gastroesophageal reflux disease']],
  ['irritable bowel syndrome', ['ibs', 'irritable bowel syndrome']],
  ['inflammatory bowel disease', ['ibd', 'inflammatory bowel disease']],
  ['coronary artery disease', ['cad', 'coronary artery disease']],
  ['cerebrovascular accident', ['cva', 'stroke', 'cerebrovascular accident']],
  ['deep vein thrombosis', ['dvt', 'deep vein thrombosis']],
  ['pulmonary embolism', ['pe', 'pulmonary embolism']],
  ['systemic lupus erythematosus', ['sle', 'systemic lupus erythematosus', 'lupus']],
  ['rheumatoid arthritis', ['ra', 'rheumatoid arthritis']],
  ['osteoarthritis', ['oa', 'osteoarthritis']],
  ['disseminated intravascular coagulation', ['dic', 'disseminated intravascular coagulation']],
  ['idiopathic thrombocytopenic purpura', ['itp', 'idiopathic thrombocytopenic purpura']],
  ['polyarteritis nodosa', ['pan', 'polyarteritis nodosa']],
  ['benign prostatic hyperplasia', ['bph', 'benign prostatic hyperplasia']],
  ['blood urea nitrogen', ['bun', 'blood urea nitrogen']],
  ['c-reactive protein', ['crp', 'c reactive protein', 'c-reactive protein']],
  ['erythrocyte sedimentation rate', ['esr', 'erythrocyte sedimentation rate']],
  ['thyroid stimulating hormone', ['tsh', 'thyroid stimulating hormone']],
  ['hemoglobin a1c', ['hba1c', 'hb a1c', 'hemoglobin a1c']],
  ['shortness of breath', ['sob', 'shortness of breath', 'dyspnea']],
  ['loss of consciousness', ['loc', 'loss of consciousness']],
  ['central nervous system', ['cns', 'central nervous system']],
  ['peripheral nervous system', ['pns', 'peripheral nervous system']],
  ['human immunodeficiency virus', ['hiv', 'human immunodeficiency virus']],
  ['acquired immunodeficiency syndrome', ['aids', 'acquired immunodeficiency syndrome']],
  ['hepatitis b virus', ['hbv', 'hepatitis b virus']],
  ['hepatitis c virus', ['hcv', 'hepatitis c virus']],
  ['hepatitis a virus', ['hav', 'hepatitis a virus']],
  ['human papillomavirus', ['hpv', 'human papillomavirus']],
  ['epstein barr virus', ['ebv', 'epstein barr virus', 'epstein-barr virus']],
  ['cytomegalovirus', ['cmv', 'cytomegalovirus']],
  ['varicella zoster virus', ['vzv', 'varicella zoster virus']],
  ['respiratory syncytial virus', ['rsv', 'respiratory syncytial virus']],
  ['inferior vena cava', ['ivc', 'inferior vena cava']],
  ['superior vena cava', ['svc', 'superior vena cava']],
  ['magnetic resonance imaging', ['mri', 'magnetic resonance imaging']],
  ['high resolution computed tomography', ['hrct', 'high resolution computed tomography']],
  ['c reactive protein', ['crp', 'c reactive protein', 'c-reactive protein']],
  ['basal metabolic rate', ['bmr', 'basal metabolic rate']],
  ['glomerular filtration rate', ['gfr', 'glomerular filtration rate']],
  ['body mass index', ['bmi', 'body mass index']],
  ['upper motor neuron', ['umn', 'upper motor neuron']],
  ['lower motor neuron', ['lmn', 'lower motor neuron']],
  ['attention deficit hyperactivity disorder', ['adhd', 'attention deficit hyperactivity disorder']],
  ['obsessive compulsive disorder', ['ocd', 'obsessive compulsive disorder']],
  ['post traumatic stress disorder', ['ptsd', 'post traumatic stress disorder']],
  ['diffuse large b cell lymphoma', ['dlbcl', 'diffuse large b cell lymphoma']],
  ['non hodgkin lymphoma', ['nhl', 'non hodgkin lymphoma', 'non-hodgkin lymphoma']],
  ['acute respiratory distress syndrome', ['ards', 'acute respiratory distress syndrome']],
  ['glomerulonephritis', ['gn', 'glomerulonephritis']],
  ['gastric outlet obstruction', ['goo', 'gastric outlet obstruction']],
];

const SYNONYM_REGEX = MEDICAL_SYNONYMS.map(([canonical, variants]) => ({
  canonical,
  variants,
  patterns: variants.map((variant) => {
    const escaped = variant
      .toLowerCase()
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\s+/g, '\\s+');
    return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}([^\\p{L}\\p{N}]|$)`, 'iu');
  }),
}));

function ensureDir(dirPath) {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
  }
}

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

function buildOptionFingerprint(options) {
  return options
    .map((option) => normalizeText(option?.text))
    .filter(Boolean)
    .sort()
    .join('|');
}

function resolveTargetIndexFromWindow(rationaleText, matchIndex, matchLength, options) {
  const answerWindow = rationaleText
    .slice(matchIndex + matchLength, matchIndex + matchLength + 120)
    .split(/[\n;]+/, 1)[0];
  const comparableWindow = normalizeText(answerWindow);
  const optionCandidates = options
    .map((option, index) => ({
      index,
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
      const index = match.index ?? -1;
      if (index === -1) {
        continue;
      }

      const after = rationaleText.slice(index + match[0].length, index + match[0].length + 12);
      if (/^\s*(?:>|<|\/|&|,|and\b|or\b)/i.test(after)) {
        continue;
      }

      const targetIndex = resolveTargetIndexFromWindow(rationaleText, index, match[0].length, options);
      if (targetIndex === null) {
        continue;
      }

      candidates.push({
        index,
        targetIndex,
      });
    }
  }

  candidates.sort((left, right) => left.index - right.index);
  return candidates[0] ?? null;
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
    `Unable to infer MedMCQA \`cop\` base from values: ${[...values].sort((a, b) => a - b).join(', ') || 'none'}`,
  );
}

function buildRawFingerprintMap(rawItems) {
  const copBase = detectCopBase(rawItems);
  const map = new Map();

  for (const item of rawItems) {
    const optionTexts = [item?.opa, item?.opb, item?.opc, item?.opd]
      .map((text) => String(text ?? '').trim())
      .filter(Boolean);
    if (optionTexts.length < 2) {
      continue;
    }

    const copValue = Number.parseInt(item?.cop, 10);
    const correctIndex = copValue - copBase;
    const correctText = [item?.opa, item?.opb, item?.opc, item?.opd][correctIndex];
    if (!correctText) {
      continue;
    }

    const fingerprint = buildOptionFingerprint(optionTexts.map((text) => ({ text })));
    if (!map.has(fingerprint)) {
      map.set(fingerprint, []);
    }

    map.get(fingerprint).push({
      correctText,
      normalizedCorrectText: normalizeText(correctText),
    });
  }

  return map;
}

function canonicalMatches(text) {
  const matches = new Set();
  for (const synonym of SYNONYM_REGEX) {
    if (synonym.patterns.some((pattern) => pattern.test(text))) {
      matches.add(synonym.canonical);
    }
  }
  return matches;
}

function tokenizeForStem(text) {
  const canonical = canonicalMatches(text);
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
    .filter((token) => token.length >= 4 && !STOPWORDS.has(token));

  for (const phrase of canonical) {
    for (const token of phrase.split(' ')) {
      if (token.length >= 4 && !STOPWORDS.has(token)) {
        tokens.push(token);
      }
    }
  }

  return [...new Set(tokens)];
}

function meaningfulCorrectOptionText(text) {
  const normalized = normalizeText(text);
  if (!normalized || GENERIC_OPTION_TEXT.has(normalized)) {
    return false;
  }

  if (/\d/.test(normalized) && normalized.length >= 3) {
    return true;
  }

  return normalized.length >= 4 || normalized.includes(' ');
}

function rationaleMentionsCorrectOption(caseRecord) {
  const currentCorrect = getCurrentCorrect(caseRecord);
  const correctText = currentCorrect.option?.text ?? '';
  if (!meaningfulCorrectOptionText(correctText)) {
    return false;
  }

  const rationaleText = getRationaleText(caseRecord);
  const normalizedRationale = normalizeLoose(rationaleText);
  const normalizedCorrect = normalizeLoose(correctText);
  return normalizedCorrect.length > 0 && normalizedRationale.includes(normalizedCorrect);
}

function hasSynonymMatch(caseRecord) {
  const promptCorpus = getPromptText(caseRecord);
  const rationaleText = getRationaleText(caseRecord);
  const promptMatches = canonicalMatches(promptCorpus);
  const rationaleMatches = canonicalMatches(rationaleText);

  for (const canonical of promptMatches) {
    if (rationaleMatches.has(canonical)) {
      return canonical;
    }
  }

  return null;
}

function getStemOverlapStats(caseRecord) {
  const promptPrefixes = [...new Set(tokenizeForStem(getPromptText(caseRecord)).map((token) => token.slice(0, 3)))];
  if (promptPrefixes.length === 0) {
    return {
      promptPrefixCount: 0,
      overlapCount: 0,
      overlapRatio: 0,
    };
  }

  const rationalePrefixes = new Set(tokenizeForStem(getRationaleText(caseRecord)).map((token) => token.slice(0, 3)));
  const overlapCount = promptPrefixes.filter((prefix) => rationalePrefixes.has(prefix)).length;

  return {
    promptPrefixCount: promptPrefixes.length,
    overlapCount,
    overlapRatio: overlapCount / promptPrefixes.length,
  };
}

function hasExplicitAnswerCue(text) {
  return /(?:^|\b)(?:answer|correct|ans\.?|option)\b/i.test(text);
}

function ensureMeta(caseRecord) {
  if (!caseRecord.meta || typeof caseRecord.meta !== 'object') {
    caseRecord.meta = {};
  }

  return caseRecord.meta;
}

function main() {
  ensureDir(REPORTS_DIR);

  const compiledCases = readJson(COMPILED_PATH);
  const caseMap = new Map(compiledCases.map((caseRecord) => [String(caseRecord._id), caseRecord]));
  const quarantineManifest = readJson(MANIFEST_PATH);
  const auditRows = readJson(AUDIT_PATH);
  const rawMedmcqa = readJson(RAW_MEDMCQA_PATH);
  const rawFingerprintMap = buildRawFingerprintMap(rawMedmcqa);

  const manifestBefore = quarantineManifest.length;
  const manifestMap = new Map(quarantineManifest.map((entry) => [String(entry.id), entry]));

  const mediumRows = auditRows.filter((row) => row.confidence === 'medium' && row.detection_method === 'text_anchor_mismatch');
  const lowRows = auditRows.filter((row) => row.confidence === 'low' && row.detection_method === 'rationale_topic_drift');

  const mediumHealedIds = new Set();
  const mediumRemediationLog = [];

  for (const row of mediumRows) {
    const caseRecord = caseMap.get(String(row._id));
    if (!caseRecord) {
      continue;
    }

    const fingerprint = buildOptionFingerprint(getOptions(caseRecord));
    const rawMatches = rawFingerprintMap.get(fingerprint) ?? [];
    if (rawMatches.length === 0) {
      continue;
    }

    const uniqueAnswers = [...new Set(rawMatches.map((match) => match.normalizedCorrectText))];
    if (uniqueAnswers.length !== 1) {
      continue;
    }

    const targetText = uniqueAnswers[0];
    const targetIndex = getOptions(caseRecord).findIndex(
      (option) => normalizeText(option?.text) === targetText,
    );
    if (targetIndex === -1) {
      continue;
    }

    const rationaleText = getRationaleText(caseRecord);
    const explicit = extractExplicitAnswer(rationaleText, getOptions(caseRecord));
    const currentCorrect = getCurrentCorrect(caseRecord);
    if (currentCorrect.index === null) {
      continue;
    }

    let finalTargetIndex = targetIndex;
    let action = 'raw_anchor_heal';
    let reason = 'Matched MedMCQA raw correct option text via option fingerprint';

    if (explicit && explicit.targetIndex !== targetIndex) {
      finalTargetIndex = explicit.targetIndex;
      action = 'explicit_rationale_override';
      reason = 'Explicit rationale answer overrode conflicting MedMCQA raw anchor';
    }

    if (currentCorrect.index !== finalTargetIndex) {
      setSingleCorrectOption(getOptions(caseRecord), finalTargetIndex);
    }

    const meta = ensureMeta(caseRecord);
    meta.needs_review = false;
    meta.phase2_healed = true;

    mediumHealedIds.add(String(caseRecord._id));
    mediumRemediationLog.push({
      _id: caseRecord._id,
      case_code: caseRecord.case_code ?? null,
      action,
      from_index: currentCorrect.index,
      to_index: finalTargetIndex,
      from_text: currentCorrect.option?.text ?? null,
      to_text: getOptions(caseRecord)[finalTargetIndex]?.text ?? null,
      reason,
      timestamp: new Date().toISOString(),
    });
  }

  const falsePositiveAnalysis = [];
  const lowUnquarantinedIds = new Set();

  for (const row of lowRows) {
    const caseRecord = caseMap.get(String(row._id));
    if (!caseRecord) {
      continue;
    }

    let verdict = 'kept';
    let reason = 'true_drift';
    const rationaleText = getRationaleText(caseRecord);
    const sharedSynonym = hasSynonymMatch(caseRecord);
    const stemOverlap = getStemOverlapStats(caseRecord);
    const exactOptionMention = rationaleMentionsCorrectOption(caseRecord);
    const explicitAnswerCue = hasExplicitAnswerCue(rationaleText);

    if (exactOptionMention && (explicitAnswerCue || sharedSynonym || stemOverlap.overlapCount >= 1)) {
      verdict = 'unquarantined';
      reason = 'correct_option_mentioned';
    } else {
      if (sharedSynonym && stemOverlap.overlapCount >= 1) {
        verdict = 'unquarantined';
        reason = 'synonym_match';
      } else if (
        stemOverlap.promptPrefixCount >= 4 &&
        stemOverlap.overlapCount >= 4 &&
        stemOverlap.overlapRatio >= 0.6
      ) {
        verdict = 'unquarantined';
        reason = 'stem_overlap';
      }
    }

    if (verdict === 'unquarantined') {
      const meta = ensureMeta(caseRecord);
      meta.needs_review = false;
      meta.false_positive_cleared = true;
      lowUnquarantinedIds.add(String(caseRecord._id));
    }

    falsePositiveAnalysis.push({
      _id: caseRecord._id,
      case_code: caseRecord.case_code ?? null,
      verdict,
      reason,
      prompt_prefix_count: stemOverlap.promptPrefixCount,
      overlap_count: stemOverlap.overlapCount,
      overlap_ratio: Number(stemOverlap.overlapRatio.toFixed(3)),
      shared_synonym: sharedSynonym,
      explicit_answer_cue: explicitAnswerCue,
      exact_option_mention: exactOptionMention,
    });
  }

  const healedOrClearedIds = new Set([...mediumHealedIds, ...lowUnquarantinedIds]);
  const nextManifest = quarantineManifest.filter((entry) => !healedOrClearedIds.has(String(entry.id)));

  const manifestIds = new Set();
  let duplicateIds = 0;
  let missingIds = 0;
  let nonNumericIds = 0;

  for (const entry of nextManifest) {
    if (typeof entry.id !== 'number' || Number.isNaN(entry.id)) {
      nonNumericIds += 1;
    }

    const key = String(entry.id);
    if (manifestIds.has(key)) {
      duplicateIds += 1;
    }
    manifestIds.add(key);

    if (!caseMap.has(key)) {
      missingIds += 1;
    }
  }

  writeJsonAtomic(REMEDIATION_LOG_PATH, mediumRemediationLog, true);
  writeJsonAtomic(FALSE_POSITIVE_ANALYSIS_PATH, falsePositiveAnalysis, true);
  writeJsonAtomic(COMPILED_PATH, compiledCases, false);
  writeJsonAtomic(MANIFEST_PATH, nextManifest, true);

  const mediumSummary = {
    medium_total: mediumRows.length,
    medium_healed: mediumHealedIds.size,
    medium_still_quarantined: mediumRows.length - mediumHealedIds.size,
  };

  const lowSummary = {
    low_total: lowRows.length,
    unquarantined: lowUnquarantinedIds.size,
    still_quarantined: lowRows.length - lowUnquarantinedIds.size,
  };

  const expectedManifestTotal = manifestBefore - mediumHealedIds.size - lowUnquarantinedIds.size;

  console.log('=== PHASE 2 QUARANTINE HEALING ===');
  console.log(`Medium total: ${mediumSummary.medium_total}`);
  console.log(`Medium healed: ${mediumSummary.medium_healed}`);
  console.log(`Medium still quarantined: ${mediumSummary.medium_still_quarantined}`);
  console.log(`Low total: ${lowSummary.low_total}`);
  console.log(`Low unquarantined: ${lowSummary.unquarantined}`);
  console.log(`Low still quarantined: ${lowSummary.still_quarantined}`);
  console.log(`Manifest before: ${manifestBefore}`);
  console.log(`Manifest after: ${nextManifest.length}`);
  console.log(`Expected manifest after: ${expectedManifestTotal}`);
  console.log(`Manifest non-numeric IDs: ${nonNumericIds}`);
  console.log(`Manifest duplicate IDs: ${duplicateIds}`);
  console.log(`Manifest missing IDs: ${missingIds}`);

  if (nextManifest.length !== expectedManifestTotal || nonNumericIds > 0 || duplicateIds > 0 || missingIds > 0) {
    process.exitCode = 1;
  }
}

main();
