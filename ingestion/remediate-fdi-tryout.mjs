import Database from 'better-sqlite3';
import { readFileSync, renameSync, unlinkSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');
const DB_PATH = join(PROJECT_ROOT, 'server', 'data', 'casebank.db');
const PUBLIC_FILE = join(PROJECT_ROOT, 'public', 'data', 'compiled_cases.json');
const REPORT_FILE = join(__dirname, 'output', 'fdi_tryout_remediation_report.json');

const GENERIC_PROMPT_RE = /^pilih jawaban yang paling tepat\.?$/i;
const WATERMARK_RE = /(?:F\s*U\s*T\s*U\s*R\s*E\s*D\s*O\s*C\s*T\s*O\s*R\s*I\s*N\s*D\s*O\s*N\s*E\s*S\s*I\s*A\s*\.?\s*C\s*O\s*M|FUTUREDOCTORINDONESIA\.COM|PLATFORM\s+TRY\s*OUT\s+UKMPPD\s+ONLINE\s+TERBAIK\s+DAN\s+TERMURAH\s+DI\s+INDONESIA\s*\d*)/gi;
const IMAGE_DEPENDENT_RE = /\b(gambar\s+seperti\s+berikut|gambar\s+berikut|hasil\s+ekg\s+ditemukan\s+gambaran\s+seperti\s+ini|foto\s+thorax|foto\s+toraks|ct\s+scan.*gambar|mri.*gambar)\b/i;
const QUESTIONISH_RE = /\b(apakah|diagnosis|terapi|tatalaksana|komplikasi|gambaran|pemeriksaan|temuan|penanganan|penyebab|patofisiologi|cara penularan|definitif)\b/i;
const EMBEDDED_OPTION_RE = /^(.*?)(?:\s+|^)([A-E])[\.\)]\s*(.+)$/i;
const NARRATIVE_PROMPT_TRIGGER_RE = /\b(apakah|diagnosis|terapi|tatalaksana|komplikasi|etiologi|patofisiologi|pemeriksaan|temuan|penanganan|tatalaksana|tindakan|interpretasi|nervus|lokasi|penyebab|yang paling tepat|yang tepat|yang sesuai|yang mungkin|apa diagnosis|apa terapi|apa tatalaksana|apa temuan|apa penanganan)\b/gi;

function writeJsonAtomic(filePath, value) {
  const tmp = `${filePath}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  try {
    renameSync(tmp, filePath);
  } catch (error) {
    if (error?.code !== 'EPERM') throw error;
    const payload = readFileSync(tmp, 'utf8');
    writeFileSync(filePath, payload, 'utf8');
    unlinkSync(tmp);
  }
}

function cleanText(value) {
  return String(value || '')
    .replace(WATERMARK_RE, ' ')
    .replace(/[•●▪■]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.:;!?])/g, '$1')
    .replace(/([,.:;!?])([^\s])/g, '$1 $2')
    .replace(/\s*\/\s*/g, '/')
    .replace(/\s*-\s*/g, ' - ')
    .trim();
}

function optionSortValue(id) {
  const normalized = String(id || '').trim().toUpperCase();
  return normalized.charCodeAt(0) || 999;
}

function reletterOptions(options) {
  const letters = ['A', 'B', 'C', 'D', 'E'];
  return options
    .sort((a, b) => optionSortValue(a.originalId) - optionSortValue(b.originalId))
    .map((option, index) => ({
      option_id: letters[index] || String.fromCharCode(65 + index),
      sort_order: index,
      option_text: cleanText(option.option_text),
      is_correct: option.is_correct ? 1 : 0,
    }));
}

function findLeakedPromptOption(options, prompt) {
  if (!GENERIC_PROMPT_RE.test(String(prompt || '').trim())) return null;
  if (!Array.isArray(options) || options.length < 4) return null;

  const sortedByLength = [...options]
    .map((option) => ({ ...option, text: String(option.text || option.option_text || '') }))
    .sort((a, b) => b.text.length - a.text.length);

  const candidate = sortedByLength[0];
  const secondLength = sortedByLength[1]?.text.length || 0;
  if (!candidate || candidate.text.length < 55) return null;
  if (candidate.text.length < secondLength * 1.8) return null;
  if (!QUESTIONISH_RE.test(candidate.text) && !/\?/.test(candidate.text)) return null;

  return candidate;
}

function extractPromptFromNarrative(narrative, prompt) {
  if (!GENERIC_PROMPT_RE.test(String(prompt || '').trim())) return null;

  const cleanedNarrative = cleanText(narrative);
  if (cleanedNarrative.length < 80) return null;

  let match;
  let lastMatch = null;
  while ((match = NARRATIVE_PROMPT_TRIGGER_RE.exec(cleanedNarrative)) !== null) {
    lastMatch = match;
  }
  NARRATIVE_PROMPT_TRIGGER_RE.lastIndex = 0;
  if (!lastMatch) return null;

  const triggerIndex = lastMatch.index;
  if (triggerIndex < cleanedNarrative.length * 0.45) return null;

  const boundaryCandidates = [
    cleanedNarrative.lastIndexOf('. ', triggerIndex),
    cleanedNarrative.lastIndexOf('? ', triggerIndex),
    cleanedNarrative.lastIndexOf('! ', triggerIndex),
    cleanedNarrative.lastIndexOf('; ', triggerIndex),
    cleanedNarrative.lastIndexOf(': ', triggerIndex),
  ].filter((value) => value >= 0);

  const boundary = boundaryCandidates.length > 0 ? Math.max(...boundaryCandidates) : -1;
  const splitIndex = boundary >= 0 ? boundary + 1 : triggerIndex;
  const promptText = cleanText(cleanedNarrative.slice(splitIndex));
  const narrativeText = cleanText(cleanedNarrative.slice(0, splitIndex));

  if (!promptText || !narrativeText) return null;
  if (promptText.length < 20 || promptText.length > 240) return null;
  if (narrativeText.length < 40) return null;
  if (!QUESTIONISH_RE.test(promptText) && !/\?/.test(promptText) && !/\.\.\.|…/.test(promptText)) return null;

  return {
    promptText,
    narrativeText,
  };
}

function remediateCase(caseData) {
  const next = structuredClone(caseData);
  next.title = cleanText(next.title);
  if (next.vignette?.narrative) {
    next.vignette.narrative = cleanText(next.vignette.narrative);
  }
  if (next.rationale?.correct) {
    next.rationale.correct = cleanText(next.rationale.correct);
  }

  const leaked = findLeakedPromptOption(next.options, next.prompt);
  if (leaked) {
    const leakedText = cleanText(leaked.text || leaked.option_text);
    if (IMAGE_DEPENDENT_RE.test(leakedText)) {
      next.meta = {
        ...(next.meta || {}),
        quarantined: true,
        truncated: true,
        quarantine_reason: 'missing image context',
        status: 'QUARANTINED_FDI_TRYOUT_IMAGE_CONTEXT',
        quality_flags: Array.from(new Set([...(next.meta?.quality_flags || []), 'fdi_prompt_leak', 'missing_image_context'])),
      };
      return {
        updated: next,
        changed: true,
        remediation: { kind: 'quarantine-image', leaked_option_id: leaked.id, leaked_text: leakedText },
      };
    }

    let promptText = leakedText;
    let embeddedOption = null;
    const embeddedMatch = leakedText.match(EMBEDDED_OPTION_RE);
    if (embeddedMatch && embeddedMatch[3]) {
      promptText = cleanText(embeddedMatch[1]);
      embeddedOption = {
        originalId: embeddedMatch[2].toUpperCase(),
        option_text: embeddedMatch[3],
        is_correct: leaked.is_correct,
      };
    }

    const survivors = next.options
      .filter((option) => option.id !== leaked.id)
      .map((option) => ({
        originalId: option.id,
        option_text: option.text,
        is_correct: Boolean(option.is_correct),
      }));

    if (embeddedOption) {
      survivors.push(embeddedOption);
    }

    const rewritten = reletterOptions(survivors);
    next.prompt = promptText;
    next.options = rewritten.map((option) => ({
      id: option.option_id,
      text: option.option_text,
      is_correct: option.is_correct === 1,
    }));
    next.meta = {
      ...(next.meta || {}),
      truncated: false,
      option_count: next.options.length,
      avg_option_length: Number((next.options.reduce((sum, option) => sum + String(option.text || '').length, 0) / Math.max(next.options.length, 1)).toFixed(1)),
      quality_flags: Array.from(new Set([...(next.meta?.quality_flags || []), 'fdi_prompt_leak_fixed'])),
    };

    return {
      updated: next,
      changed: true,
      remediation: {
        kind: embeddedOption ? 'prompt-recovered-with-embedded-option' : 'prompt-recovered',
        leaked_option_id: leaked.id,
        prompt: promptText,
        option_count: next.options.length,
      },
    };
  }

  const extracted = extractPromptFromNarrative(next.vignette?.narrative, next.prompt);
  if (extracted) {
    if (IMAGE_DEPENDENT_RE.test(extracted.promptText)) {
      next.meta = {
        ...(next.meta || {}),
        quarantined: true,
        truncated: true,
        quarantine_reason: 'missing image context',
        status: 'QUARANTINED_FDI_TRYOUT_IMAGE_CONTEXT',
        quality_flags: Array.from(new Set([...(next.meta?.quality_flags || []), 'fdi_prompt_extracted', 'missing_image_context'])),
      };
      return {
        updated: next,
        changed: true,
        remediation: { kind: 'quarantine-image-from-narrative', prompt: extracted.promptText },
      };
    }

    next.prompt = extracted.promptText;
    next.vignette = {
      ...(next.vignette || {}),
      narrative: extracted.narrativeText,
    };
    next.meta = {
      ...(next.meta || {}),
      truncated: false,
      vignette_length: extracted.narrativeText.length > 380 ? 'long' : extracted.narrativeText.length > 180 ? 'medium' : 'short',
      quality_flags: Array.from(new Set([...(next.meta?.quality_flags || []), 'fdi_prompt_extracted'])),
    };

    return {
      updated: next,
      changed: true,
      remediation: {
        kind: 'prompt-extracted-from-narrative',
        prompt: extracted.promptText,
      },
    };
  }

  return {
    updated: next,
    changed:
      next.title !== caseData.title ||
      next.prompt !== caseData.prompt ||
      next.vignette?.narrative !== caseData.vignette?.narrative ||
      next.rationale?.correct !== caseData.rationale?.correct,
    remediation: null,
  };
}

function updateSqlite(db, updatedCases) {
  const updateCase = db.prepare(`
    UPDATE cases
    SET title = ?, prompt = ?, vignette_json = ?, meta_json = ?, quality_score = ?
    WHERE case_id = ?
  `);
  const deleteOptions = db.prepare(`DELETE FROM case_options WHERE case_id = ?`);
  const insertOption = db.prepare(`
    INSERT INTO case_options (case_id, option_id, sort_order, option_text, is_correct)
    VALUES (?, ?, ?, ?, ?)
  `);

  const tx = db.transaction((items) => {
    for (const item of items) {
      updateCase.run(
        item.updated.title || '',
        item.updated.prompt || '',
        JSON.stringify(item.updated.vignette || {}),
        JSON.stringify(item.updated.meta || {}),
        item.updated.meta?.quality_score ?? item.quality_score ?? null,
        item.case_id,
      );

      if (item.rewriteOptions) {
        deleteOptions.run(item.case_id);
        for (const option of item.rewriteOptions) {
          insertOption.run(item.case_id, option.option_id, option.sort_order, option.option_text, option.is_correct);
        }
      }
    }
  });

  tx(updatedCases);
}

function main() {
  const publicData = JSON.parse(readFileSync(PUBLIC_FILE, 'utf8'));
  const db = new Database(DB_PATH);

  const caseRows = db.prepare(`
    SELECT case_id, case_code, quality_score
    FROM cases
    WHERE source = 'fdi-tryout'
  `).all();
  const caseIdByCode = new Map(caseRows.map((row) => [row.case_code, row]));

  const report = {
    source: 'fdi-tryout',
    total_cases: 0,
    watermark_cleaned: 0,
    prompt_extracted_from_narrative: 0,
    prompt_leak_fixed: 0,
    prompt_leak_with_embedded_option_fixed: 0,
    quarantined_for_missing_image: 0,
    untouched: 0,
    samples: [],
  };

  const sqliteUpdates = [];
  const nextPublic = publicData.map((item) => {
    if ((item.meta?.source || item.source) !== 'fdi-tryout') return item;
    report.total_cases += 1;

    const { updated, changed, remediation } = remediateCase(item);
    const titleChanged = updated.title !== item.title || updated.vignette?.narrative !== item.vignette?.narrative || updated.rationale?.correct !== item.rationale?.correct;

    if (titleChanged) report.watermark_cleaned += 1;
    if (remediation?.kind === 'prompt-extracted-from-narrative') report.prompt_extracted_from_narrative += 1;
    if (remediation?.kind === 'prompt-recovered') report.prompt_leak_fixed += 1;
    if (remediation?.kind === 'prompt-recovered-with-embedded-option') report.prompt_leak_with_embedded_option_fixed += 1;
    if (remediation?.kind === 'quarantine-image' || remediation?.kind === 'quarantine-image-from-narrative') report.quarantined_for_missing_image += 1;
    if (!changed) report.untouched += 1;

    const sqliteRow = caseIdByCode.get(item.case_code);
    if (sqliteRow && changed) {
      sqliteUpdates.push({
        case_id: sqliteRow.case_id,
        quality_score: sqliteRow.quality_score,
        updated,
        rewriteOptions: remediation?.kind?.startsWith('prompt-recovered')
          ? updated.options.map((option, index) => ({
              option_id: option.id,
              sort_order: index,
              option_text: option.text,
              is_correct: option.is_correct ? 1 : 0,
            }))
          : null,
      });
    }

    if (remediation && report.samples.length < 20) {
      report.samples.push({
        case_code: item.case_code,
        remediation: remediation.kind,
        prompt: updated.prompt,
        options: updated.options.map((option) => ({ id: option.id, text: option.text, is_correct: option.is_correct })),
      });
    }

    return updated;
  });

  updateSqlite(db, sqliteUpdates);
  mkdirSync(join(__dirname, 'output'), { recursive: true });
  writeJsonAtomic(PUBLIC_FILE, nextPublic);
  writeJsonAtomic(REPORT_FILE, report);

  console.log(JSON.stringify(report, null, 2));
}

main();
