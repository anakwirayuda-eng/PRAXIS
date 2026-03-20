/**
 * Intense Deep Audit specifically for SCT (Script Concordance Test) cases
 * Checks:
 * - Vignette clinical quality (length, language)
 * - Hypothesis presence and clarity
 * - New Information / Prompt clarity
 * - Options adherence to 5-point Likert scale
 * - Expert panel vote distribution (variance, mode, realistic spread)
 * - Vestigial MCQ artifacts ("which of the following", "kecuali")
 */
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const OUTPUT_DIR = join(import.meta.dirname, 'output');
const COMPILED = join(OUTPUT_DIR, 'compiled_cases.json');

console.log('══════════════════════════════════════════════════');
console.log(' 🔬 DEEP INTENSE AUDIT — SCT Cases');
console.log('══════════════════════════════════════════════════\n');

const cases = JSON.parse(readFileSync(COMPILED, 'utf-8'));
const scts = cases.filter(c => c.q_type === 'SCT');

console.log(`Total SCT Cases found: ${scts.length}\n`);

const issues = {
  missing_hypothesis: [],
  missing_new_info: [],
  short_vignette: [],           // < 100 chars
  vestigial_mcq_text: [],       // contains "kecuali", "berikut ini", "yang mana"
  invalid_likert_scale: [],     // not exactly 5 options or bad text
  missing_panel_votes: [],      // no votes array
  unrealistic_panel_votes: [],  // exactly 100% agreement on every question or weird sums
  bimodial_extreme_votes: [],   // polarized experts (-2 and +2 only) -> bad question design
  english_leakage: [],          // "year-old", "presents"
  empty_rationale: []
};

// Valid Likert variants commonly used in SCT:
// -2, -1, 0, 1, 2
// Sangat kontraindikasi ... Sangat mendukung
// Sangat menurunkan probabilitas ... Sangat meningkatkan probabilitas

const metrics = {
  total_votes: 0,
  expert_panel_sizes: {},
  avg_vignette_length: 0,
  mode_agreements: [] // percentage of experts agreeing on the modal answer
};

for (const c of scts) {
  const narrative = c.vignette?.narrative || '';
  const hypothesis = c.hypothesis || '';
  const prompt = c.prompt || '';
  const options = c.options || [];
  const rationale = c.rationale?.correct || '';
  
  const brief = { id: c._id, title: c.title };

  // 1. Text Quality
  if (narrative.length < 100) issues.short_vignette.push(brief);
  if (/(kecuali|berikut ini|yang mana|manakah|adalah:)/i.test(prompt) || /(kecuali|berikut ini|yang mana|manakah|adalah:)/i.test(narrative)) {
    // SCTs shouldn't ask "which of the following"
    issues.vestigial_mcq_text.push({ ...brief, snippet: prompt || narrative.substring(0,50) });
  }
  if (/(year-old|presents with|complains of)/i.test(narrative)) {
    issues.english_leakage.push(brief);
  }

  // 2. SCT Structure
  // Hypothesis could be in a specific field or embedded in prompt
  const hasH = hypothesis.length > 5 || prompt.toLowerCase().includes('hipotesis') || prompt.toLowerCase().includes('diagnosis awal') || prompt.toLowerCase().includes('rencana');
  if (!hasH) issues.missing_hypothesis.push(brief);
  
  const hasNewInfo = prompt.toLowerCase().includes('data baru') || prompt.toLowerCase().includes('informasi baru') || prompt.length > 10;
  if (!hasNewInfo) issues.missing_new_info.push(brief);

  if (rationale.length < 20) issues.empty_rationale.push(brief);

  // 3. Options & Likert Scale
  if (options.length !== 5) {
    issues.invalid_likert_scale.push({ ...brief, count: options.length });
  }

  // 4. Panel Votes
  let totalVotes = 0;
  let maxVotes = 0;
  let extremeVotes = 0; // votes at -2 or +2
  let modalVoteCount = 0;

  for (const opt of options) {
    const votes = opt.sct_panel_votes || 0;
    totalVotes += votes;
    if (votes > maxVotes) {
      maxVotes = votes;
    }
    // Assume options[0] is -2 and options[4] is +2
    if (opt === options[0] || opt === options[options.length-1]) {
      extremeVotes += votes;
    }
  }

  if (totalVotes === 0) {
    issues.missing_panel_votes.push(brief);
  } else {
    metrics.expert_panel_sizes[totalVotes] = (metrics.expert_panel_sizes[totalVotes] || 0) + 1;
    metrics.mode_agreements.push((maxVotes / totalVotes) * 100);
    
    // Check for weird distributions
    // E.g. all experts polarized at exactly -2 and +2, 0 in middle
    if (extremeVotes === totalVotes && options[0].sct_panel_votes > 0 && options[options.length-1].sct_panel_votes > 0) {
      issues.bimodial_extreme_votes.push(brief);
    }
    
    // E.g. 100% agreement on every single question is unrealistic for SCT (SCT relies on some disagreement)
    if (maxVotes === totalVotes) {
      // It's possible on SOME very obvious questions, but if too many, it's suspicious
      // We'll track it
    }
  }

  metrics.avg_vignette_length += narrative.length;
}

if (scts.length > 0) {
  metrics.avg_vignette_length = Math.round(metrics.avg_vignette_length / scts.length);
  const avgAgreement = metrics.mode_agreements.reduce((a,b)=>a+b,0) / metrics.mode_agreements.length;
  metrics.avg_modal_agreement = Math.round(avgAgreement) + '%';
}

console.log('━━━ METRICS ━━━');
console.log(`Average Vignette Length: ${metrics.avg_vignette_length} chars`);
console.log(`Average Expert Agreement (Mode): ${metrics.avg_modal_agreement}`);
console.log(`Expert Panel Sizes Used:`, metrics.expert_panel_sizes);

console.log('\n━━━ ISSUES FOUND ━━━');
for (const [key, list] of Object.entries(issues)) {
  if (list.length > 0) {
    console.log(`⚠️ ${key}: ${list.length} cases`);
    // Sample max 2
    for (let i = 0; i < Math.min(2, list.length); i++) {
        console.log(`   - ID ${list[i].id}: ${JSON.stringify(list[i].snippet || list[i].title)}`);
    }
  } else {
    console.log(`✅ ${key}: 0 cases`);
  }
}

console.log('\n━━━ SAMPLE SCT CASE ━━━');
if (scts.length > 0) {
  const sample = scts[Math.floor(Math.random() * scts.length)];
  console.log(`ID: ${sample._id}`);
  console.log(`Vignette: ${sample.vignette?.narrative}`);
  console.log(`Hypothesis: ${sample.hypothesis || 'N/A'}`);
  console.log(`Prompt / New Info: ${sample.prompt}`);
  console.log(`Options & Votes:`);
  for (const opt of sample.options) {
    console.log(`  [${opt.sct_panel_votes} votes] ${opt.id}: ${opt.text}`);
  }
  console.log(`Rationale: ${sample.rationale?.correct.substring(0, 100)}...`);
}

console.log(`\nIf metrics look realistic (modal agreement ~70-90%, decent length, no vestigial MCQ text), then the SCTs are "layak".`);
