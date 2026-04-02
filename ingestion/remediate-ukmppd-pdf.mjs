import Database from 'better-sqlite3';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');
const DB_PATH = join(PROJECT_ROOT, 'server', 'data', 'casebank.db');
const PUBLIC_CASES_PATH = join(PROJECT_ROOT, 'public', 'data', 'compiled_cases.json');
const REPORT_PATH = join(__dirname, 'output', 'ukmppd_pdf_remediation_report.json');

const FOOTER_PATTERN = /\b(?:\d{1,3}\s+){4,}\d{1,3}\s+1001\s+SOAL\s*&?(?:\s+PEMBAHASAN\s+UKMPPD)?|\b1001\s+SOAL\s*&?(?:\s+PEMBAHASAN\s+UKMPPD)?|\bPEMBAHASAN\s+UKMPPD\b/giu;
const REPEATED_NUMBER_PATTERN = /\b(\d{1,3})(?:\s+\1){3,}\b/gu;
const IMAGE_REFERENCE_PATTERN = /\b(gambar|foto|radiologis|sebagai berikut|gambar di bawah|seperti gambar)\b/iu;
const ABOVE_REFERENCE_PATTERN = /\b(kasus di atas|kelainan kulit di atas|pasien di atas|hal di atas|gambar di atas)\b/iu;
const GENERIC_DANGLING_PATTERN = /\b(kasus di atas|kelainan kulit di atas|gambar di atas|foto yang dilakukan)\b/iu;

function writeJsonAtomic(filePath, value) {
  const tmp = `${filePath}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  renameSync(tmp, filePath);
}

function stableSort(value) {
  if (Array.isArray(value)) return value.map((item) => stableSort(item));
  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce((acc, key) => {
        acc[key] = stableSort(value[key]);
        return acc;
      }, {});
  }
  return value;
}

function stableStringify(value) {
  return JSON.stringify(stableSort(value));
}

function cleanUkMppdText(value) {
  let text = String(value || '');
  const original = text;

  text = text
    .replace(FOOTER_PATTERN, ' ')
    .replace(REPEATED_NUMBER_PATTERN, ' ')
    .replace(/([\p{L}])\s*-\s+([\p{L}])/gu, '$1$2')
    .replace(/\s+([,.;:?])/g, '$1')
    .replace(/\s*…\s*/g, ' ... ')
    .replace(/([.?!]){4,}/g, '...')
    .replace(/\s{2,}/g, ' ')
    .trim();

  return {
    value: text,
    changed: text !== original,
  };
}

function uniqFlags(flags) {
  return [...new Set((flags || []).filter(Boolean))];
}

function hasAnyImageReference(text) {
  return IMAGE_REFERENCE_PATTERN.test(text || '');
}

function hasDanglingReference(text) {
  return GENERIC_DANGLING_PATTERN.test(text || '');
}

function classifyUkMppdCase({ title, prompt, narrative, options, meta }) {
  const combined = [title, prompt, narrative, ...options].filter(Boolean).join(' ');
  const cleanNarrative = (narrative || '').trim();
  const cleanPrompt = (prompt || '').trim();
  const hasImages = Array.isArray(meta?.images) && meta.images.length > 0;

  const mentionsImage = hasAnyImageReference(combined);
  const missingImageContext = !hasImages && mentionsImage;
  const danglingContext = hasDanglingReference(combined)
    && cleanNarrative.length < 120
    && cleanPrompt.length < 120;
  const residualFooter = FOOTER_PATTERN.test(combined) || REPEATED_NUMBER_PATTERN.test(combined);
  const emptyContext = cleanNarrative.length === 0 && cleanPrompt.length === 0;

  let quarantineReason = null;
  if (missingImageContext) {
    quarantineReason = 'missing image context';
  } else if (danglingContext) {
    quarantineReason = 'missing stem context';
  } else if (residualFooter) {
    quarantineReason = 'unresolved OCR contamination';
  } else if (emptyContext) {
    quarantineReason = 'empty stem';
  }

  return {
    quarantineReason,
    keepTruncated: Boolean(quarantineReason),
    clearNeedsImage: !missingImageContext,
  };
}

function sanitizeMeta(meta, classification, cleanedAny) {
  const nextMeta = { ...(meta || {}) };
  const flags = Array.isArray(nextMeta.quality_flags) ? [...nextMeta.quality_flags] : [];

  if (cleanedAny) {
    flags.push('ukmppd_pdf_ocr_cleaned');
  }

  if (classification.quarantineReason) {
    nextMeta.quarantined = true;
    nextMeta.status = 'QUARANTINED_UKMPPD_PDF';
    nextMeta.quarantine_reason = classification.quarantineReason;
    flags.push(`ukmppd_pdf_${classification.quarantineReason.replace(/\s+/g, '_')}`);
    nextMeta.truncated = true;
    nextMeta.needs_image = classification.quarantineReason === 'missing image context';
  } else {
    nextMeta.quarantined = false;
    delete nextMeta.quarantine_reason;
    if (nextMeta.status === 'QUARANTINED_UKMPPD_PDF') {
      delete nextMeta.status;
    }
    nextMeta.truncated = false;
    if (classification.clearNeedsImage) {
      nextMeta.needs_image = false;
    }
  }

  nextMeta.quality_flags = uniqFlags(flags);
  return nextMeta;
}

function remediateRecord(record) {
  const cleanedTitle = cleanUkMppdText(record.title);
  const cleanedPrompt = cleanUkMppdText(record.prompt);
  const cleanedNarrative = cleanUkMppdText(record.narrative);
  const cleanedOptions = record.options.map((option) => {
    const cleaned = cleanUkMppdText(option.text);
    return {
      ...option,
      text: cleaned.value,
      changed: cleaned.changed,
    };
  });

  const classification = classifyUkMppdCase({
    title: cleanedTitle.value,
    prompt: cleanedPrompt.value,
    narrative: cleanedNarrative.value,
    options: cleanedOptions.map((option) => option.text),
    meta: record.vignette,
  });

  const cleanedAny = cleanedTitle.changed
    || cleanedPrompt.changed
    || cleanedNarrative.changed
    || cleanedOptions.some((option) => option.changed);

  return {
    title: cleanedTitle.value,
    prompt: cleanedPrompt.value,
    narrative: cleanedNarrative.value,
    options: cleanedOptions.map(({ changed, ...option }) => option),
    classification,
    cleanedAny,
  };
}

function main() {
  const db = new Database(DB_PATH);
  const dataset = JSON.parse(readFileSync(PUBLIC_CASES_PATH, 'utf8'));

  const caseRows = db.prepare(`
    SELECT case_id, case_code, title, prompt, source, category, meta_json, vignette_json, meta_status
    FROM cases
    WHERE source = 'ukmppd-pdf'
    ORDER BY case_id
  `).all();
  const optionRows = db.prepare(`
    SELECT case_id, sort_order, option_id, option_text, is_correct
    FROM case_options
    WHERE case_id IN (SELECT case_id FROM cases WHERE source='ukmppd-pdf')
    ORDER BY case_id, sort_order
  `).all();

  const optionsByCaseId = new Map();
  for (const option of optionRows) {
    const list = optionsByCaseId.get(option.case_id) || [];
    list.push(option);
    optionsByCaseId.set(option.case_id, list);
  }

  const updateCase = db.prepare(`
    UPDATE cases
    SET title = ?, prompt = ?, meta_json = ?, vignette_json = ?, meta_status = ?
    WHERE case_id = ?
  `);
  const updateOption = db.prepare(`
    UPDATE case_options
    SET option_text = ?
    WHERE case_id = ? AND sort_order = ?
  `);

  const report = {
    total_cases: caseRows.length,
    cleaned_cases: 0,
    quarantined_cases: 0,
    cleared_truncated_cases: 0,
    quarantine_reasons: {},
    changed_option_rows: 0,
    sample_quarantined: [],
  };

  const apply = db.transaction(() => {
    for (const row of caseRows) {
      const meta = JSON.parse(row.meta_json || '{}');
      const vignette = JSON.parse(row.vignette_json || '{}');
      const options = (optionsByCaseId.get(row.case_id) || []).map((option) => ({
        sortOrder: option.sort_order,
        optionId: option.option_id,
        text: option.option_text,
      }));

      const result = remediateRecord({
        title: row.title,
        prompt: row.prompt,
        narrative: vignette?.narrative || '',
        options,
        vignette,
      });

      const nextMeta = sanitizeMeta(meta, result.classification, result.cleanedAny);
      const nextVignette = {
        ...vignette,
        narrative: result.narrative,
      };

      const nextMetaJson = JSON.stringify(nextMeta);
      const nextVignetteJson = JSON.stringify(nextVignette);
      const nextMetaStatus = nextMeta.status || '';

      if (result.cleanedAny) {
        report.cleaned_cases += 1;
      }

      if (result.classification.quarantineReason) {
        report.quarantined_cases += 1;
        report.quarantine_reasons[result.classification.quarantineReason] =
          (report.quarantine_reasons[result.classification.quarantineReason] || 0) + 1;
        if (report.sample_quarantined.length < 25) {
          report.sample_quarantined.push({
            case_id: row.case_id,
            case_code: row.case_code,
            reason: result.classification.quarantineReason,
            title: result.title,
          });
        }
      } else if (meta.truncated === true) {
        report.cleared_truncated_cases += 1;
      }

      const rowChanged = row.title !== result.title
        || row.prompt !== result.prompt
        || stableStringify(meta) !== stableStringify(nextMeta)
        || stableStringify(vignette) !== stableStringify(nextVignette)
        || row.meta_status !== nextMetaStatus;

      if (rowChanged) {
        updateCase.run(result.title, result.prompt, nextMetaJson, nextVignetteJson, nextMetaStatus, row.case_id);
      }

      for (const option of result.options) {
        const original = options.find((item) => item.sortOrder === option.sortOrder);
        if (original && original.text !== option.text) {
          updateOption.run(option.text, row.case_id, option.sortOrder);
          report.changed_option_rows += 1;
        }
      }
    }
  });

  apply();

  let datasetChanged = 0;
  const nextDataset = dataset.map((caseData) => {
    if (caseData?.meta?.source !== 'ukmppd-pdf') return caseData;

    const result = remediateRecord({
      title: caseData.title,
      prompt: caseData.prompt,
      narrative: caseData?.vignette?.narrative || '',
      options: (caseData.options || []).map((option, index) => ({
        sortOrder: index,
        optionId: option.id,
        text: option.text,
      })),
      vignette: caseData?.vignette || {},
    });

    const nextMeta = sanitizeMeta(caseData.meta || {}, result.classification, result.cleanedAny);
    const nextCase = {
      ...caseData,
      title: result.title,
      prompt: result.prompt,
      vignette: {
        ...(caseData.vignette || {}),
        narrative: result.narrative,
      },
      options: (caseData.options || []).map((option, index) => ({
        ...option,
        text: result.options[index]?.text || option.text,
      })),
      meta: nextMeta,
    };

    if (stableStringify(nextCase) !== stableStringify(caseData)) {
      datasetChanged += 1;
    }
    return nextCase;
  });

  writeJsonAtomic(PUBLIC_CASES_PATH, nextDataset);
  report.dataset_changed_cases = datasetChanged;
  writeJsonAtomic(REPORT_PATH, report);

  console.log('UKMPPD PDF remediation complete');
  console.log(`Cleaned cases: ${report.cleaned_cases.toLocaleString()}`);
  console.log(`Quarantined cases: ${report.quarantined_cases.toLocaleString()}`);
  console.log(`Truncated cleared: ${report.cleared_truncated_cases.toLocaleString()}`);
  console.log(`Dataset changed cases: ${report.dataset_changed_cases.toLocaleString()}`);
  console.log(`Report: ${REPORT_PATH}`);
}

main();
