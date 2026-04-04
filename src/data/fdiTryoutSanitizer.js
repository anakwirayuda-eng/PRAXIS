const GENERIC_PROMPT_RE = /^pilih jawaban yang paling tepat\.?$/i;
const WATERMARK_RE = /(?:F\s*U\s*T\s*U\s*R\s*E\s*D\s*O\s*C\s*T\s*O\s*R\s*I\s*N\s*D\s*O\s*N\s*E\s*S\s*I\s*A\s*\.?\s*C\s*O\s*M|FUTUREDOCTORINDONESIA\.COM|PLATFORM\s+TRY\s*OUT\s+UKMPPD\s+ONLINE\s+TERBAIK\s+DAN\s+TERMURAH\s+DI\s+INDONESIA\s*\d*)/gi;
const IMAGE_DEPENDENT_RE = /\b(gambar\s+seperti\s+berikut|gambar\s+berikut|hasil\s+ekg\s+ditemukan\s+gambaran\s+seperti\s+ini|foto\s+thorax|foto\s+toraks|ct\s+scan.*gambar|mri.*gambar)\b/i;
const QUESTIONISH_RE = /\b(apakah|diagnosis|terapi|tatalaksana|komplikasi|gambaran|pemeriksaan|temuan|penanganan|penyebab|patofisiologi|cara penularan|definitif)\b/i;
const EMBEDDED_OPTION_RE = /^(.*?)(?:\s+|^)([A-E])[\.\)]\s*(.+)$/i;
const NARRATIVE_PROMPT_TRIGGER_RE = /\b(apakah|diagnosis|terapi|tatalaksana|komplikasi|etiologi|patofisiologi|pemeriksaan|temuan|penanganan|tindakan|interpretasi|nervus|lokasi|penyebab|yang paling tepat|yang tepat|yang sesuai|yang mungkin|apa diagnosis|apa terapi|apa tatalaksana|apa temuan|apa penanganan)\b/gi;

function cleanText(value) {
  return String(value || '')
    .replace(WATERMARK_RE, ' ')
    .replace(/[\u2022\u25CF\u25AA\u25A0•●▪■]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.:;!?])/g, '$1')
    .replace(/([,.:;!?])([^\s])/g, '$1 $2')
    .replace(/\s*\.\s*\.\s*\./g, ' ...')
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
      id: letters[index] || String.fromCharCode(65 + index),
      text: cleanText(option.text),
      is_correct: Boolean(option.is_correct),
    }));
}

function findLeakedPromptOption(options, prompt) {
  if (!GENERIC_PROMPT_RE.test(String(prompt || '').trim())) return null;
  if (!Array.isArray(options) || options.length < 4) return null;

  const sortedByLength = [...options]
    .map((option) => ({ ...option, text: String(option?.text || option?.option_text || '') }))
    .sort((a, b) => b.text.length - a.text.length);

  const candidate = sortedByLength[0];
  const secondLength = sortedByLength[1]?.text.length || 0;
  if (!candidate || candidate.text.length < 55) return null;
  if (candidate.text.length < secondLength * 1.8) return null;
  if (!QUESTIONISH_RE.test(candidate.text) && !/\?/.test(candidate.text) && !/\.\.\.|…/.test(candidate.text)) return null;

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

  return { promptText, narrativeText };
}

function withQualityFlag(meta, flag) {
  return Array.from(new Set([...(meta?.quality_flags || []), flag]));
}

export function sanitizeFdiTryoutCase(rawCase) {
  if ((rawCase?.meta?.source || rawCase?.source) !== 'fdi-tryout') return rawCase;

  const next = {
    ...rawCase,
    title: cleanText(rawCase?.title),
    prompt: rawCase?.prompt ?? '',
    vignette: typeof rawCase?.vignette === 'string'
      ? rawCase.vignette
      : {
          ...(rawCase?.vignette || {}),
          narrative: cleanText(rawCase?.vignette?.narrative),
        },
    rationale: typeof rawCase?.rationale === 'string'
      ? rawCase.rationale
      : {
          ...(rawCase?.rationale || {}),
          correct: cleanText(rawCase?.rationale?.correct),
        },
    meta: {
      ...(rawCase?.meta || {}),
    },
    options: Array.isArray(rawCase?.options)
      ? rawCase.options.map((option) => ({
          ...option,
          text: cleanText(option?.text || option?.option_text),
        }))
      : [],
  };

  const leaked = findLeakedPromptOption(next.options, next.prompt);
  if (leaked) {
    const leakedText = cleanText(leaked.text || leaked.option_text);
    if (IMAGE_DEPENDENT_RE.test(leakedText)) {
      next.meta = {
        ...next.meta,
        quarantined: true,
        truncated: true,
        quarantine_reason: 'missing image context',
        status: 'QUARANTINED_FDI_TRYOUT_IMAGE_CONTEXT',
        quality_flags: withQualityFlag(next.meta, 'missing_image_context'),
      };
      return next;
    }

    let promptText = leakedText;
    let embeddedOption = null;
    const embeddedMatch = leakedText.match(EMBEDDED_OPTION_RE);
    if (embeddedMatch && embeddedMatch[3]) {
      promptText = cleanText(embeddedMatch[1]);
      embeddedOption = {
        originalId: embeddedMatch[2].toUpperCase(),
        text: embeddedMatch[3],
        is_correct: leaked.is_correct,
      };
    }

    const survivors = next.options
      .filter((option) => option.id !== leaked.id)
      .map((option) => ({
        originalId: option.id,
        text: option.text,
        is_correct: option.is_correct,
      }));

    if (embeddedOption) survivors.push(embeddedOption);

    next.prompt = promptText;
    next.options = reletterOptions(survivors);
    next.meta = {
      ...next.meta,
      truncated: false,
      option_count: next.options.length,
      avg_option_length: Number((next.options.reduce((sum, option) => sum + String(option.text || '').length, 0) / Math.max(next.options.length, 1)).toFixed(1)),
      quality_flags: withQualityFlag(next.meta, 'fdi_prompt_leak_fixed'),
    };
    return next;
  }

  if (typeof next.vignette !== 'string') {
    const extracted = extractPromptFromNarrative(next.vignette?.narrative, next.prompt);
    if (extracted) {
      if (IMAGE_DEPENDENT_RE.test(extracted.promptText)) {
        next.meta = {
          ...next.meta,
          quarantined: true,
          truncated: true,
          quarantine_reason: 'missing image context',
          status: 'QUARANTINED_FDI_TRYOUT_IMAGE_CONTEXT',
          quality_flags: withQualityFlag(next.meta, 'missing_image_context'),
        };
        return next;
      }

      next.prompt = extracted.promptText;
      next.vignette = {
        ...next.vignette,
        narrative: extracted.narrativeText,
      };
      next.meta = {
        ...next.meta,
        truncated: false,
        vignette_length:
          extracted.narrativeText.length > 380 ? 'long' : extracted.narrativeText.length > 180 ? 'medium' : 'short',
        quality_flags: withQualityFlag(next.meta, 'fdi_prompt_extracted'),
      };
    }
  }

  return next;
}
