/**
 * Quality Inject — Apply all 4 sprint results to compiled_cases.json
 * 
 * Usage: node ingestion/quality-inject.mjs
 */
import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'fs';
import { join } from 'path';

const OUTPUT_DIR = join(import.meta.dirname, 'output');
const COMPILED = join(OUTPUT_DIR, 'compiled_cases.json');
const PUBLIC_COMPILED = join(import.meta.dirname, '..', 'public', 'data', 'compiled_cases.json');

console.log('══════════════════════════════════════════════════');
console.log(' Quality Inject — Applying Batch Results');
console.log('══════════════════════════════════════════════════\n');

const cases = JSON.parse(readFileSync(COMPILED, 'utf-8'));
const caseIndex = new Map();
for (const c of cases) caseIndex.set(c._id, c);
console.log(`📂 Loaded ${cases.length.toLocaleString()} cases\n`);

function parseResultFile(filename) {
  const path = join(OUTPUT_DIR, filename);
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf-8').split('\n').filter(l => l.trim()).map(l => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean);
}

// ═══════════════════════════════════════
// SPRINT 1: Conflict Resolution
// ═══════════════════════════════════════
console.log('🔴 Sprint 1: Applying Conflict Resolutions...');
const conflicts = parseResultFile('result_conflicts.jsonl');
let conflictsApplied = 0;
for (const r of conflicts) {
  try {
    const id = parseInt(r.custom_id.replace('conflict_', ''), 10);
    const c = caseIndex.get(id);
    if (!c) continue;
    const content = r.response?.body?.choices?.[0]?.message?.content || '';
    // Add conflict resolution to rationale
    if (content.length > 10) {
      c.rationale = c.rationale || {};
      c.rationale.correct = (c.rationale.correct || '') + `\n\n⚖️ **Cross-Source Resolution:** ${content}`;
      conflictsApplied++;
    }
  } catch {}
}
console.log(`  ✅ ${conflictsApplied}/${conflicts.length} conflicts resolved\n`);

// ═══════════════════════════════════════
// SPRINT 2: MedMCQA Spot-Check
// ═══════════════════════════════════════
console.log('🔍 Sprint 2: Processing MedMCQA Spot-Check...');
const spotchecks = parseResultFile('result_spotcheck.jsonl');
let verified = 0, incorrect = 0, spotcheckErrors = 0;
const incorrectList = [];

for (const r of spotchecks) {
  try {
    const id = parseInt(r.custom_id.replace('verify_', ''), 10);
    const content = r.response?.body?.choices?.[0]?.message?.content || '';
    const parsed = JSON.parse(content);
    
    if (parsed.is_correct === true) {
      verified++;
    } else if (parsed.is_correct === false) {
      incorrect++;
      const c = caseIndex.get(id);
      incorrectList.push({
        id,
        source: c?.meta?.source,
        question: (c?.vignette?.narrative || '').substring(0, 100),
        markedCorrect: c?.options?.find(o => o.is_correct)?.text,
        shouldBe: parsed.correct_answer_should_be,
        reasoning: parsed.reasoning,
        confidence: parsed.confidence,
      });
      
      // Add warning to rationale
      if (c && parsed.confidence >= 4) {
        c.rationale = c.rationale || {};
        c.rationale.correct = (c.rationale.correct || '') + 
          `\n\n⚠️ **Answer Audit Warning (GPT confidence ${parsed.confidence}/5):** The marked answer may be incorrect. ${parsed.reasoning || ''}`;
      }
    }
  } catch {
    spotcheckErrors++;
  }
}

const errorRate = spotchecks.length > 0 ? ((incorrect / spotchecks.length) * 100).toFixed(1) : '0';
console.log(`  ✅ Verified correct: ${verified}`);
console.log(`  ❌ Possibly incorrect: ${incorrect} (${errorRate}% error rate)`);
console.log(`  ⚠️ Parse errors: ${spotcheckErrors}`);
if (incorrectList.length > 0) {
  writeFileSync(join(OUTPUT_DIR, 'spotcheck_incorrect.json'), JSON.stringify(incorrectList, null, 2), 'utf-8');
  console.log(`  📋 Details: spotcheck_incorrect.json`);
}
console.log();

// ═══════════════════════════════════════
// SPRINT 3: HeadQA Explanations
// ═══════════════════════════════════════
console.log('📚 Sprint 3: Injecting HeadQA Explanations...');
const headqaResults = parseResultFile('result_explain_headqa.jsonl');
let headqaInjected = 0;
for (const r of headqaResults) {
  try {
    const id = parseInt(r.custom_id.replace('explain_headqa_', ''), 10);
    const c = caseIndex.get(id);
    if (!c) continue;
    const content = r.response?.body?.choices?.[0]?.message?.content || '';
    if (content.length > 20) {
      c.rationale = c.rationale || {};
      c.rationale.correct = content;
      headqaInjected++;
    }
  } catch {}
}
console.log(`  ✅ ${headqaInjected}/${headqaResults.length} HeadQA explanations injected\n`);

// ═══════════════════════════════════════
// SPRINT 4: MMLU Explanations
// ═══════════════════════════════════════
console.log('📚 Sprint 4: Injecting MMLU Explanations...');
const mmluResults = parseResultFile('result_explain_mmlu.jsonl');
let mmluInjected = 0;
for (const r of mmluResults) {
  try {
    const id = parseInt(r.custom_id.replace('explain_mmlu_', ''), 10);
    const c = caseIndex.get(id);
    if (!c) continue;
    const content = r.response?.body?.choices?.[0]?.message?.content || '';
    if (content.length > 20) {
      c.rationale = c.rationale || {};
      c.rationale.correct = content;
      mmluInjected++;
    }
  } catch {}
}
console.log(`  ✅ ${mmluInjected}/${mmluResults.length} MMLU explanations injected\n`);

// ═══════════════════════════════════════
// SAVE
// ═══════════════════════════════════════
writeFileSync(COMPILED, JSON.stringify(cases), 'utf-8');
copyFileSync(COMPILED, PUBLIC_COMPILED);

const withExplanation = cases.filter(c => c.rationale?.correct && c.rationale.correct.length > 20).length;
const pct = ((withExplanation / cases.length) * 100).toFixed(1);

console.log('══════════════════════════════════════════════════');
console.log(' QUALITY INJECT COMPLETE');
console.log('══════════════════════════════════════════════════');
console.log(`  Conflicts resolved:     ${conflictsApplied}`);
console.log(`  MedMCQA error rate:     ${errorRate}% (${incorrect}/${spotchecks.length})`);
console.log(`  HeadQA explanations:    +${headqaInjected}`);
console.log(`  MMLU explanations:      +${mmluInjected}`);
console.log(`  Cases with explanation: ${withExplanation.toLocaleString()} (${pct}%)`);
console.log(`  Saved: ${PUBLIC_COMPILED}`);
console.log('══════════════════════════════════════════════════\n');
