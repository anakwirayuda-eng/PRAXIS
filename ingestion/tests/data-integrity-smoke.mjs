import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const COMPILED_PATH = join(__dirname, '..', '..', 'public', 'data', 'compiled_cases.json');
const MANIFEST_PATH = join(__dirname, '..', '..', 'public', 'data', 'quarantine_manifest.json');

const EXPECTED_MANIFEST_COUNT = 1859;
const MIN_PROMPT_LENGTH = 10;
const MIN_RATIONALE_RATIO = 0.95;
const MAX_OPTION_TEXT_LENGTH = 500;

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function normalizeText(value) {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
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
  return {
    index,
    option: index === -1 ? null : options[index],
  };
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
      const letter = String(match[1] ?? '').toUpperCase();
      const index = match.index ?? -1;
      if (!letter || index === -1) {
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

      candidates.push({ targetIndex, index, letter });
    }
  }

  candidates.sort((left, right) => left.index - right.index);
  return candidates[0] ?? null;
}

function fail(failures, message) {
  failures.push(message);
}

function main() {
  const compiledCases = readJson(COMPILED_PATH);
  const quarantineManifest = readJson(MANIFEST_PATH);
  const caseMap = new Map(compiledCases.map((caseRecord) => [String(caseRecord._id), caseRecord]));

  const failures = [];
  const duplicateIds = [];
  const duplicateCaseCodes = [];
  const schemaIssues = {
    missing_id: 0,
    missing_case_code: 0,
    prompt_too_short: 0,
    bad_option_count: 0,
    bad_correct_count: 0,
  };
  const optionIssues = {
    empty_text: 0,
    too_long: 0,
  };
  const contradictionSamples = [];
  const promptSamples = [];

  const seenIds = new Set();
  const seenCaseCodes = new Set();
  let rationalePresent = 0;
  let remainingHardContradictions = 0;

  for (const caseRecord of compiledCases) {
    const idKey = String(caseRecord?._id ?? '');
    const caseCode = String(caseRecord?.case_code ?? '').trim();
    const promptText = getPromptText(caseRecord);
    const options = getOptions(caseRecord);
    const rationaleText = getRationaleText(caseRecord);
    const correctCount = options.filter((option) => option?.is_correct === true).length;

    if (!idKey) {
      schemaIssues.missing_id += 1;
    } else if (seenIds.has(idKey)) {
      duplicateIds.push(idKey);
    } else {
      seenIds.add(idKey);
    }

    if (!caseCode) {
      schemaIssues.missing_case_code += 1;
    } else if (seenCaseCodes.has(caseCode)) {
      duplicateCaseCodes.push(caseCode);
    } else {
      seenCaseCodes.add(caseCode);
    }

    if (promptText.length < MIN_PROMPT_LENGTH) {
      schemaIssues.prompt_too_short += 1;
      if (promptSamples.length < 8) {
        promptSamples.push({
          _id: caseRecord._id,
          case_code: caseCode,
          prompt: promptText,
        });
      }
    }

    if (options.length < 2 || options.length > 5) {
      schemaIssues.bad_option_count += 1;
    }

    if (correctCount !== 1) {
      schemaIssues.bad_correct_count += 1;
    }

    if (rationaleText.length > 0) {
      rationalePresent += 1;
    }

    for (const option of options) {
      const optionText = String(option?.text ?? '');
      if (!optionText.trim()) {
        optionIssues.empty_text += 1;
      }
      if (optionText.length > MAX_OPTION_TEXT_LENGTH) {
        optionIssues.too_long += 1;
      }
    }

    if (!caseMap.has(idKey)) {
      continue;
    }
  }

  const quarantineIds = new Set();
  let manifestNonNumericIds = 0;
  let manifestMissingIds = 0;
  let manifestDuplicateIds = 0;

  for (const entry of quarantineManifest) {
    if (typeof entry?.id !== 'number' || Number.isNaN(entry.id)) {
      manifestNonNumericIds += 1;
      continue;
    }

    const idKey = String(entry.id);
    if (quarantineIds.has(idKey)) {
      manifestDuplicateIds += 1;
      continue;
    }

    quarantineIds.add(idKey);
    if (!caseMap.has(idKey)) {
      manifestMissingIds += 1;
    }
  }

  for (const caseRecord of compiledCases) {
    if (quarantineIds.has(String(caseRecord._id))) {
      continue;
    }

    const options = getOptions(caseRecord);
    const currentCorrect = getCurrentCorrect(caseRecord);
    if (options.length < 2 || currentCorrect.index === -1 || !currentCorrect.option) {
      continue;
    }

    const explicit = extractExplicitAnswer(getRationaleText(caseRecord), options);
    if (!explicit) {
      continue;
    }

    const targetOption = options[explicit.targetIndex];
    if (
      targetOption &&
      normalizeText(targetOption.text) !== normalizeText(currentCorrect.option.text)
    ) {
      remainingHardContradictions += 1;
      if (contradictionSamples.length < 8) {
        contradictionSamples.push({
          _id: caseRecord._id,
          case_code: caseRecord.case_code,
          current_correct_text: currentCorrect.option.text,
          rationale_target_text: targetOption.text,
          rationale_snippet: getRationaleText(caseRecord).slice(0, 180),
        });
      }
    }
  }

  const rationaleRatio = rationalePresent / compiledCases.length;
  const spotChecks = [
    [5098, 'Right atrium'],
    [511, 'Sigmoid colon'],
    [4313, 'Genioglossus'],
    [1602, 'Heart'],
    [2386, 'Masochism'],
  ].map(([id, expectedText]) => {
    const caseRecord = caseMap.get(String(id));
    const correctText = getCurrentCorrect(caseRecord).option?.text ?? '';
    return {
      id,
      expected: expectedText,
      actual: correctText,
      pass: normalizeText(correctText).includes(normalizeText(expectedText)),
    };
  });

  if (schemaIssues.missing_id > 0) {
    fail(failures, `Missing _id: ${schemaIssues.missing_id}`);
  }
  if (schemaIssues.missing_case_code > 0) {
    fail(failures, `Missing case_code: ${schemaIssues.missing_case_code}`);
  }
  if (duplicateIds.length > 0) {
    fail(failures, `Duplicate _id values: ${duplicateIds.length}`);
  }
  if (duplicateCaseCodes.length > 0) {
    fail(failures, `Duplicate case_code values: ${duplicateCaseCodes.length}`);
  }
  if (schemaIssues.prompt_too_short > 0) {
    fail(failures, `Prompt too short: ${schemaIssues.prompt_too_short}`);
  }
  if (schemaIssues.bad_option_count > 0) {
    fail(failures, `Invalid option count: ${schemaIssues.bad_option_count}`);
  }
  if (schemaIssues.bad_correct_count > 0) {
    fail(failures, `Cases without exactly one correct option: ${schemaIssues.bad_correct_count}`);
  }
  if (remainingHardContradictions > 0) {
    fail(failures, `Remaining hard contradictions outside quarantine: ${remainingHardContradictions}`);
  }
  if (rationaleRatio < MIN_RATIONALE_RATIO) {
    fail(failures, `Rationale presence below threshold: ${(rationaleRatio * 100).toFixed(2)}%`);
  }
  if (optionIssues.empty_text > 0) {
    fail(failures, `Empty option text entries: ${optionIssues.empty_text}`);
  }
  if (optionIssues.too_long > 0) {
    fail(failures, `Option text longer than ${MAX_OPTION_TEXT_LENGTH}: ${optionIssues.too_long}`);
  }
  if (manifestNonNumericIds > 0) {
    fail(failures, `Manifest non-numeric ids: ${manifestNonNumericIds}`);
  }
  if (manifestMissingIds > 0) {
    fail(failures, `Manifest ids missing in compiled data: ${manifestMissingIds}`);
  }
  if (manifestDuplicateIds > 0) {
    fail(failures, `Manifest duplicate ids: ${manifestDuplicateIds}`);
  }
  if (quarantineManifest.length !== EXPECTED_MANIFEST_COUNT) {
    fail(
      failures,
      `Manifest count mismatch: expected ${EXPECTED_MANIFEST_COUNT}, got ${quarantineManifest.length}`,
    );
  }
  for (const check of spotChecks) {
    if (!check.pass) {
      fail(failures, `Spot-check failed for _id ${check.id}: expected ${check.expected}, got ${check.actual}`);
    }
  }

  const summary = {
    total_cases: compiledCases.length,
    rationale_present: rationalePresent,
    rationale_ratio: Number(rationaleRatio.toFixed(5)),
    manifest_count: quarantineManifest.length,
    remaining_hard_contradictions: remainingHardContradictions,
    schema_issues: schemaIssues,
    option_issues: optionIssues,
    manifest_issues: {
      non_numeric_ids: manifestNonNumericIds,
      missing_ids: manifestMissingIds,
      duplicate_ids: manifestDuplicateIds,
    },
    spot_checks: spotChecks,
  };

  console.log('=== DATA INTEGRITY SMOKE TEST ===');
  console.log(JSON.stringify(summary, null, 2));

  if (promptSamples.length > 0) {
    console.log('Prompt samples:');
    console.log(JSON.stringify(promptSamples, null, 2));
  }

  if (contradictionSamples.length > 0) {
    console.log('Contradiction samples:');
    console.log(JSON.stringify(contradictionSamples, null, 2));
  }

  if (failures.length > 0) {
    console.log('FAILURES:');
    for (const issue of failures) {
      console.log(`- ${issue}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log('PASS: all smoke checks passed.');
}

main();
