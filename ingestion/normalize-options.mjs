import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DATA_FILE = join(__dirname, '..', 'public', 'data', 'compiled_cases.json');
const AOTA_REGEX = /all of the above|semua benar|all correct|todas/i;
const NOTA_REGEX = /none of the above|semua salah|none correct|ninguna|ninguno/i;

function normalizeWhitespace(value) {
  return String(value ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
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

function addNeedsReviewReason(meta, reason) {
  meta.needs_review = true;

  if (!meta.needs_review_reason) {
    meta.needs_review_reason = reason;
  }

  if (!Array.isArray(meta.needs_review_reasons)) {
    meta.needs_review_reasons = [];
  }

  if (!meta.needs_review_reasons.includes(reason)) {
    meta.needs_review_reasons.push(reason);
  }
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripOwnLetterPrefix(text, optionIndex, optionId) {
  const expectedLetter = String.fromCharCode(65 + optionIndex);
  const candidates = [expectedLetter];
  const normalizedId = normalizeWhitespace(optionId).toUpperCase();
  if (/^[A-Z]$/.test(normalizedId)) {
    candidates.push(normalizedId);
  }

  let next = text;
  for (const candidate of [...new Set(candidates)]) {
    const prefixRegex = new RegExp(`^(?:\\(?${escapeRegExp(candidate)}\\)?)[.:)\\-]\\s+`, 'i');
    if (prefixRegex.test(next)) {
      next = next.replace(prefixRegex, '');
      break;
    }
  }

  return next;
}

function isAllUppercaseOptions(options) {
  if (options.length === 0) {
    return false;
  }

  return options.every((option) => {
    const text = normalizeWhitespace(option?.text);
    if (!/[A-Z]/.test(text)) {
      return false;
    }

    return text === text.toUpperCase();
  });
}

function toTitleCase(text) {
  return normalizeWhitespace(text)
    .split(/\s+/)
    .map((word) => {
      if (!/[A-Z]/.test(word) && !/[a-z]/i.test(word)) {
        return word;
      }

      if (/^[A-Z0-9]{2,4}$/.test(word)) {
        return word;
      }

      const lower = word.toLowerCase();
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(' ');
}

function main() {
  const cases = JSON.parse(readFileSync(DATA_FILE, 'utf8'));
  const summary = {
    cases_scanned: cases.length,
    trimmed_options: 0,
    prefixes_stripped: 0,
    uppercase_cases_normalized: 0,
    aota_cases: 0,
    nota_cases: 0,
    empty_option_cases: 0,
    avg_length_updated: 0,
  };

  for (const caseRecord of cases) {
    if (!Array.isArray(caseRecord.options) || caseRecord.options.length === 0) {
      continue;
    }

    const meta = ensureMeta(caseRecord);
    const uppercaseCase = isAllUppercaseOptions(caseRecord.options);
    let hasAota = false;
    let hasNota = false;
    let hasEmptyOption = false;
    let caseChanged = false;

    for (let index = 0; index < caseRecord.options.length; index += 1) {
      const option = caseRecord.options[index];
      const originalText = String(option?.text ?? '');
      let nextText = normalizeWhitespace(originalText);

      if (nextText !== originalText) {
        summary.trimmed_options += 1;
        caseChanged = true;
      }

      const strippedText = stripOwnLetterPrefix(nextText, index, option?.id);
      if (strippedText !== nextText) {
        nextText = strippedText;
        summary.prefixes_stripped += 1;
        caseChanged = true;
      }

      if (uppercaseCase) {
        const titleText = toTitleCase(nextText);
        if (titleText !== nextText) {
          nextText = titleText;
          caseChanged = true;
        }
      }

      option.text = nextText;

      if (!nextText) {
        hasEmptyOption = true;
      }

      if (AOTA_REGEX.test(nextText)) {
        hasAota = true;
      }

      if (NOTA_REGEX.test(nextText)) {
        hasNota = true;
      }
    }

    if (uppercaseCase) {
      summary.uppercase_cases_normalized += 1;
    }

    if (hasAota) {
      meta.has_aota = true;
      summary.aota_cases += 1;
    } else if (meta.has_aota === true) {
      delete meta.has_aota;
    }

    if (hasNota) {
      meta.has_nota = true;
      summary.nota_cases += 1;
    } else if (meta.has_nota === true) {
      delete meta.has_nota;
    }

    if (hasEmptyOption) {
      addNeedsReviewReason(meta, 'empty_option_text');
      summary.empty_option_cases += 1;
    }

    const totalLength = caseRecord.options.reduce(
      (sum, option) => sum + normalizeWhitespace(option?.text).length,
      0,
    );
    const averageLength = totalLength / caseRecord.options.length;
    const roundedAverage = Number(averageLength.toFixed(1));
    if (meta.avg_option_length !== roundedAverage) {
      meta.avg_option_length = roundedAverage;
      summary.avg_length_updated += 1;
      caseChanged = true;
    }

    if (!caseChanged && !hasAota && !hasNota && !hasEmptyOption) {
      continue;
    }
  }

  writeJsonAtomically(DATA_FILE, cases);

  console.log('=== OPTION NORMALIZATION ===');
  console.log(`Cases scanned: ${formatCount(summary.cases_scanned)}`);
  console.log(`Options trimmed: ${formatCount(summary.trimmed_options)}`);
  console.log(`Prefixes stripped: ${formatCount(summary.prefixes_stripped)}`);
  console.log(`Uppercase option sets normalized: ${formatCount(summary.uppercase_cases_normalized)}`);
  console.log(`Cases with AOTA: ${formatCount(summary.aota_cases)}`);
  console.log(`Cases with NOTA: ${formatCount(summary.nota_cases)}`);
  console.log(`Cases flagged for empty options: ${formatCount(summary.empty_option_cases)}`);
  console.log(`Cases with avg_option_length updated: ${formatCount(summary.avg_length_updated)}`);
}

main();
