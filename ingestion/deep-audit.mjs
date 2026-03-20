/**
 * DEEP WIDE AUDIT — Scan every single case for anomalies
 * Zero-cost local analysis, no API calls
 * 
 * Checks: missing fields, empty strings, duplicates, format issues,
 * language mixing, structural problems, option anomalies, etc.
 * 
 * Usage: node ingestion/deep-audit.mjs
 */
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const OUTPUT_DIR = join(import.meta.dirname, 'output');
const COMPILED = join(OUTPUT_DIR, 'compiled_cases.json');

console.log('══════════════════════════════════════════════════');
console.log(' DEEP WIDE AUDIT — Full Dataset Scan');
console.log('══════════════════════════════════════════════════\n');

const cases = JSON.parse(readFileSync(COMPILED, 'utf-8'));
console.log(`📂 Total cases: ${cases.length.toLocaleString()}\n`);

// Issue collectors
const issues = {
  // STRUCTURAL
  missing_id: [],
  missing_qtype: [],
  missing_category: [],
  missing_title: [],
  missing_vignette: [],
  missing_narrative: [],
  empty_narrative: [],
  short_narrative: [],       // <30 chars
  missing_prompt: [],
  empty_prompt: [],
  missing_options: [],
  few_options: [],           // <2
  no_correct_answer: [],
  multiple_correct: [],
  missing_meta: [],
  missing_source: [],
  
  // CONTENT QUALITY
  duplicate_ids: [],
  duplicate_hashes: [],
  duplicate_narratives: [],
  identical_options: [],     // 2+ options with same text
  option_is_empty: [],       // option with empty text
  very_long_option: [],      // >500 chars (suspicious)
  narrative_has_question_stem: [],  // SCT with "which of the following"
  raw_markdown_in_text: [],  // **bold** or __italic__ in plain text
  html_in_text: [],          // <br> <p> etc
  
  // SCT-SPECIFIC
  sct_missing_hypothesis: [],
  sct_no_panel_votes: [],
  sct_bad_likert: [],        // none marked correct
  sct_english_vignette: [],  // should be Indonesian now
  
  // EXPLANATION QUALITY
  no_explanation: [],
  very_short_explanation: [], // <20 chars
  dirty_explanation_ans_prefix: [],   // starts with "Ans. A/B/C/D"
  dirty_explanation_ref: [],          // has "Ref;" or "Ref:" textbook references
  dirty_explanation_hash_sep: [],     // # used as paragraph separator
  dirty_explanation_image_ref: [],    // "(Image)" phantom refs in explanation
  dirty_explanation_extra_mile: [],   // "Extra mile" / "Extra Mileage" raw section
  dirty_explanation_page_ref: [],     // "pg. 57" raw page references
  auto_analysis_hallucination: [],    // "[Auto-Analysis]" generic distractor explanations
  explanation_very_long: [],          // >2000 chars (likely dumps)
  
  // METADATA
  missing_exam_type: [],
  unknown_exam_type: [],
  missing_difficulty: [],
  
  // PHANTOM / MEDIA
  phantom_image: [],
  has_images: [],
};

const VALID_EXAM_TYPES = new Set(['USMLE', 'UKMPPD', 'MIR-Spain', 'Academic', 'Research', 'Clinical']);
const QUESTION_STEM_REGEX = /\b(which of the following|what is the most likely|what is the next|what is the best|the most appropriate|which one|which statement)\b/i;
const MARKDOWN_REGEX = /\*\*[^*]+\*\*|__[^_]+__/;
const HTML_REGEX = /<(br|p|div|span|img|table|tr|td|th|ul|ol|li|h[1-6]|strong|em|a)\b/i;
const PHANTOM_REGEX = /\b(refer to image|as shown in figure|x-ray reveals|gambar|berikut ini|di bawah ini|menunjukkan gambaran|figure \d|radiograph|chest x|foto thorax|histopatolog|mikroskop|preparat|dermoskop|ekg|ecg|ct scan|mri)\b/i;

const seenIds = new Map();
const seenHashes = new Map();
const seenNarratives = new Map();

for (const c of cases) {
  const id = c._id;
  const narrative = c.vignette?.narrative || '';
  const prompt = c.prompt || '';
  const fullText = `${narrative} ${prompt}`.trim();
  const options = c.options || [];
  const correctOpts = options.filter(o => o.is_correct);
  const source = c.meta?.source || 'unknown';
  const brief = { id, source, title: (c.title || '').substring(0, 60) };

  // STRUCTURAL
  if (id === undefined || id === null) issues.missing_id.push(brief);
  if (!c.q_type) issues.missing_qtype.push(brief);
  if (!c.category) issues.missing_category.push(brief);
  if (!c.title) issues.missing_title.push(brief);
  if (!c.vignette) issues.missing_vignette.push(brief);
  if (c.vignette && !c.vignette.narrative) issues.missing_narrative.push(brief);
  if (narrative.length === 0 && c.vignette) issues.empty_narrative.push(brief);
  if (narrative.length > 0 && narrative.length < 30 && c.q_type === 'MCQ') issues.short_narrative.push(brief);
  if (!prompt) issues.missing_prompt.push(brief);
  if (prompt === '') issues.empty_prompt.push(brief);
  if (options.length === 0) issues.missing_options.push(brief);
  if (options.length > 0 && options.length < 2) issues.few_options.push(brief);
  if (correctOpts.length === 0) issues.no_correct_answer.push(brief);
  if (correctOpts.length > 1 && c.q_type === 'MCQ') issues.multiple_correct.push(brief);
  if (!c.meta) issues.missing_meta.push(brief);
  if (c.meta && !c.meta.source) issues.missing_source.push(brief);

  // DUPLICATES
  if (seenIds.has(id)) issues.duplicate_ids.push({ ...brief, duplicate_of: seenIds.get(id) });
  seenIds.set(id, source);
  
  if (c.hash_id) {
    if (seenHashes.has(c.hash_id)) issues.duplicate_hashes.push({ ...brief, hash: c.hash_id });
    seenHashes.set(c.hash_id, id);
  }

  const narrativeKey = narrative.toLowerCase().trim().substring(0, 200);
  if (narrativeKey.length > 50) {
    if (seenNarratives.has(narrativeKey)) {
      issues.duplicate_narratives.push({ ...brief, duplicate_of: seenNarratives.get(narrativeKey) });
    }
    seenNarratives.set(narrativeKey, id);
  }

  // OPTION QUALITY
  const optTexts = options.map(o => (o.text || '').trim().toLowerCase());
  const uniqueOpts = new Set(optTexts);
  if (uniqueOpts.size < optTexts.length && optTexts.length > 0) {
    issues.identical_options.push(brief);
  }
  for (const o of options) {
    if (!o.text || o.text.trim() === '') issues.option_is_empty.push({ ...brief, option: o.id });
    if ((o.text || '').length > 500) issues.very_long_option.push({ ...brief, option: o.id, len: o.text.length });
  }

  // CONTENT QUALITY
  if (c.q_type === 'SCT' && QUESTION_STEM_REGEX.test(narrative)) {
    issues.narrative_has_question_stem.push({ ...brief, snippet: narrative.substring(0, 100) });
  }
  if (MARKDOWN_REGEX.test(fullText)) issues.raw_markdown_in_text.push(brief);
  if (HTML_REGEX.test(fullText)) issues.html_in_text.push(brief);

  // SCT-SPECIFIC
  if (c.q_type === 'SCT') {
    if (!c.hypothesis && !narrative.includes('hipotesis') && !narrative.includes('Hipotesis')) {
      issues.sct_missing_hypothesis.push(brief);
    }
    const hasVotes = options.some(o => o.sct_panel_votes > 0);
    if (!hasVotes) issues.sct_no_panel_votes.push(brief);
    if (correctOpts.length === 0) issues.sct_bad_likert.push(brief);
    // Check if vignette is in English (should be Indonesian for v3)
    if (/\b(presents to|year-old|complains of|history of|physical exam)\b/i.test(narrative.substring(0, 200))) {
      issues.sct_english_vignette.push({ ...brief, snippet: narrative.substring(0, 100) });
    }
  }

  // EXPLANATION QUALITY
  const explanation = c.rationale?.correct || '';
  if (!explanation || explanation.length === 0) issues.no_explanation.push(brief);
  else if (explanation.length < 20) issues.very_short_explanation.push(brief);
  
  if (/^Ans\.\s*[A-Za-z]/i.test(explanation)) {
    issues.dirty_explanation_ans_prefix.push({ ...brief, snippet: explanation.substring(0, 80) });
  }
  if (/Ref[;:]\s/i.test(explanation) || /\bRef\b.*\b(gangong|guyton|robbins|harrison|schwartz|sabiston|bailey|nelson|hangman|essesntial)/i.test(explanation)) {
    issues.dirty_explanation_ref.push({ ...brief, snippet: explanation.substring(0, 80) });
  }
  if (explanation.includes('#') && (explanation.match(/#/g) || []).length >= 2) {
    issues.dirty_explanation_hash_sep.push(brief);
  }
  if (/\(Image\)/i.test(explanation)) {
    issues.dirty_explanation_image_ref.push(brief);
  }
  if (/Extra mile/i.test(explanation)) {
    issues.dirty_explanation_extra_mile.push(brief);
  }
  if (/pg\.\s*\d+/i.test(explanation)) {
    issues.dirty_explanation_page_ref.push(brief);
  }
  if (explanation.length > 2000) {
    issues.explanation_very_long.push({ ...brief, len: explanation.length });
  }
  
  // Check distractor explanations for [Auto-Analysis] hallucinations
  const distractors = c.rationale?.distractors || {};
  for (const [key, val] of Object.entries(distractors)) {
    if (typeof val === 'string' && val.includes('[Auto-Analysis]')) {
      issues.auto_analysis_hallucination.push({ ...brief, option: key });
      break; // count once per case
    }
  }

  // METADATA
  if (!c.meta?.examType) issues.missing_exam_type.push(brief);
  if (c.meta?.examType && !VALID_EXAM_TYPES.has(c.meta.examType)) {
    issues.unknown_exam_type.push({ ...brief, examType: c.meta.examType });
  }

  // PHANTOM IMAGES
  if (PHANTOM_REGEX.test(fullText) && (!c.images || c.images.length === 0)) {
    issues.phantom_image.push(brief);
  }
  if (c.images && c.images.length > 0) issues.has_images.push(brief);
}

// ═══════════════════════════════════════════════════
// REPORT
// ═══════════════════════════════════════════════════
console.log('━━━ STRUCTURAL ISSUES ━━━');
console.log(`  Missing ID:           ${issues.missing_id.length}`);
console.log(`  Missing q_type:       ${issues.missing_qtype.length}`);
console.log(`  Missing category:     ${issues.missing_category.length}`);
console.log(`  Missing title:        ${issues.missing_title.length}`);
console.log(`  Missing vignette:     ${issues.missing_vignette.length}`);
console.log(`  Missing narrative:    ${issues.missing_narrative.length}`);
console.log(`  Empty narrative:      ${issues.empty_narrative.length}`);
console.log(`  Short narrative (<30):${issues.short_narrative.length}`);
console.log(`  Missing prompt:       ${issues.missing_prompt.length}`);
console.log(`  Missing options:      ${issues.missing_options.length}`);
console.log(`  Few options (<2):     ${issues.few_options.length}`);
console.log(`  No correct answer:    ${issues.no_correct_answer.length}`);
console.log(`  Multiple correct:     ${issues.multiple_correct.length}`);
console.log(`  Missing meta:         ${issues.missing_meta.length}`);
console.log(`  Missing source:       ${issues.missing_source.length}`);

console.log('\n━━━ DUPLICATES ━━━');
console.log(`  Duplicate IDs:        ${issues.duplicate_ids.length}`);
console.log(`  Duplicate hashes:     ${issues.duplicate_hashes.length}`);
console.log(`  Duplicate narratives: ${issues.duplicate_narratives.length}`);

console.log('\n━━━ CONTENT QUALITY ━━━');
console.log(`  Identical options:    ${issues.identical_options.length}`);
console.log(`  Empty option text:    ${issues.option_is_empty.length}`);
console.log(`  Very long option:     ${issues.very_long_option.length}`);
console.log(`  Question stem in SCT: ${issues.narrative_has_question_stem.length}`);
console.log(`  Raw markdown:         ${issues.raw_markdown_in_text.length}`);
console.log(`  HTML tags in text:    ${issues.html_in_text.length}`);

console.log('\n━━━ SCT-SPECIFIC ━━━');
console.log(`  Missing hypothesis:   ${issues.sct_missing_hypothesis.length}`);
console.log(`  No panel votes:       ${issues.sct_no_panel_votes.length}`);
console.log(`  Bad Likert (no correct): ${issues.sct_bad_likert.length}`);
console.log(`  English vignette:     ${issues.sct_english_vignette.length}`);

console.log('\n━━━ EXPLANATION QUALITY ━━━');
console.log(`  No explanation:       ${issues.no_explanation.length}`);
console.log(`  Very short (<20ch):   ${issues.very_short_explanation.length}`);
console.log(`  Very long (>2000ch):  ${issues.explanation_very_long.length}`);
console.log(`  Dirty: "Ans." prefix: ${issues.dirty_explanation_ans_prefix.length}`);
console.log(`  Dirty: "Ref;" refs:   ${issues.dirty_explanation_ref.length}`);
console.log(`  Dirty: # separators:  ${issues.dirty_explanation_hash_sep.length}`);
console.log(`  Dirty: "(Image)":     ${issues.dirty_explanation_image_ref.length}`);
console.log(`  Dirty: "Extra mile":  ${issues.dirty_explanation_extra_mile.length}`);
console.log(`  Dirty: "pg. ##":      ${issues.dirty_explanation_page_ref.length}`);
console.log(`  [Auto-Analysis] dist: ${issues.auto_analysis_hallucination.length}`);

console.log('\n━━━ METADATA ━━━');
console.log(`  Missing examType:     ${issues.missing_exam_type.length}`);
console.log(`  Unknown examType:     ${issues.unknown_exam_type.length}`);

console.log('\n━━━ MEDIA ━━━');
console.log(`  Phantom images:       ${issues.phantom_image.length}`);
console.log(`  Has real images:      ${issues.has_images.length}`);

// Source breakdown
console.log('\n━━━ SOURCE BREAKDOWN ━━━');
const sourceCounts = {};
for (const c of cases) {
  const src = c.meta?.source || 'unknown';
  sourceCounts[src] = (sourceCounts[src] || 0) + 1;
}
for (const [src, count] of Object.entries(sourceCounts).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${src}: ${count.toLocaleString()}`);
}

// Critical count
const criticalCount = 
  issues.missing_options.length + issues.no_correct_answer.length + 
  issues.duplicate_ids.length + issues.missing_vignette.length +
  issues.missing_qtype.length;

const warningCount = 
  issues.duplicate_narratives.length + issues.identical_options.length +
  issues.phantom_image.length + issues.empty_narrative.length +
  issues.raw_markdown_in_text.length + issues.html_in_text.length +
  issues.sct_english_vignette.length + issues.narrative_has_question_stem.length;

console.log(`\n══════════════════════════════════════════════════`);
console.log(` DEEP AUDIT SUMMARY`);
console.log(`══════════════════════════════════════════════════`);
console.log(`  🔴 Critical issues: ${criticalCount}`);
console.log(`  🟡 Warnings:        ${warningCount}`);
console.log(`  📊 Total cases:     ${cases.length.toLocaleString()}`);
console.log(`  📊 With explanation: ${(cases.length - issues.no_explanation.length).toLocaleString()} (${((1 - issues.no_explanation.length / cases.length) * 100).toFixed(1)}%)`);
console.log(`══════════════════════════════════════════════════\n`);

// Save full report
writeFileSync(join(OUTPUT_DIR, 'deep_audit_report.json'), JSON.stringify(issues, null, 2), 'utf-8');
console.log(`📋 Full report: ingestion/output/deep_audit_report.json\n`);
