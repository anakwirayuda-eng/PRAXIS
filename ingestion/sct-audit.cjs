/**
 * SCT Deep Quality Audit — 50 random samples
 * Checks: coherence, logic, answerability, format integrity
 */
const fs = require('fs');
const path = require('path');

const cases = JSON.parse(fs.readFileSync(path.join(__dirname, 'output', 'compiled_cases.json'), 'utf-8'));
const scts = cases.filter(c => c.meta?.source === 'sct-factory-v1');
console.log('SCT Factory Total:', scts.length);

const N = 50;
const indices = new Set();
while (indices.size < N) indices.add(Math.floor(Math.random() * scts.length));

let pass = 0, fail = 0;
const failDetails = [];
const catDist = {};
const dirDist = { '-2': 0, '-1': 0, '0': 0, '+1': 0, '+2': 0 };

for (const idx of indices) {
  const s = scts[idx];
  const sc = s.vignette?.narrative || '';
  const pr = s.prompt || '';
  const opts = s.options || [];
  const rat = s.rationale?.correct || '';
  
  const totalVotes = opts.reduce((sum, o) => sum + (o.sct_panel_votes || 0), 0);
  const hasCorrect = opts.some(o => o.is_correct);
  const correctOpt = opts.find(o => o.is_correct);
  const highestVoted = opts.reduce((a, b) => (a.sct_panel_votes || 0) > (b.sct_panel_votes || 0) ? a : b, opts[0]);
  
  catDist[s.category] = (catDist[s.category] || 0) + 1;
  if (correctOpt) dirDist[correctOpt.id] = (dirDist[correctOpt.id] || 0) + 1;
  
  const issues = [];
  
  // Structural checks
  if (sc.length < 30) issues.push('VIGNETTE_TOO_SHORT');
  if (sc.length > 1500) issues.push('VIGNETTE_TOO_LONG');
  if (!hasCorrect) issues.push('NO_CORRECT_ANSWER');
  if (totalVotes < 13 || totalVotes > 17) issues.push('VOTES_SUM=' + totalVotes);
  if (correctOpt && highestVoted && correctOpt.id !== highestVoted.id) issues.push('CORRECT_NOT_MAJORITY');
  if (rat.length < 20) issues.push('WEAK_RATIONALE');
  
  // Content checks
  if (/undefined|null|NaN/i.test(sc + pr)) issues.push('DATA_CORRUPTION');
  
  const hasHypothesis = pr.includes('berpikir tentang:');
  const hasNewInfo = pr.includes('menemukan:');
  if (!hasHypothesis) issues.push('MISSING_HYPOTHESIS');
  if (!hasNewInfo) issues.push('MISSING_NEW_INFO');
  
  // Depth checks
  const sentences = sc.split(/[.!?]/).filter(s => s.trim().length > 3);
  if (sentences.length < 2) issues.push('SCENARIO_NO_DEPTH');
  
  // Check if scenario is in Indonesian
  const idWords = ['pasien', 'dokter', 'rumah sakit', 'keluhan', 'pemeriksaan', 'diagnosis', 'terapi', 'obat', 'tahun', 'datang', 'berusia'];
  const hasIndo = idWords.some(w => sc.toLowerCase().includes(w));
  if (!hasIndo && sc.length > 50) issues.push('NOT_INDONESIAN');
  
  if (issues.length === 0) {
    pass++;
  } else {
    fail++;
    failDetails.push({ idx, id: s._id, cat: s.category, issues, preview: sc.substring(0, 80) });
  }
}

console.log('\n=== 50-SAMPLE DEEP AUDIT ===');
console.log('Pass:', pass + '/' + N, '(' + Math.round(pass / N * 100) + '%)');
console.log('Fail:', fail + '/' + N);

console.log('\nCategory distribution:');
for (const [k, v] of Object.entries(catDist).sort((a, b) => b[1] - a[1])) {
  console.log('  ' + k + ': ' + v);
}

console.log('\nCorrect direction distribution:');
for (const [k, v] of Object.entries(dirDist)) {
  console.log('  ' + k + ': ' + v);
}

if (failDetails.length > 0) {
  console.log('\nFailed cases:');
  const issueCounts = {};
  for (const f of failDetails) {
    for (const i of f.issues) issueCounts[i] = (issueCounts[i] || 0) + 1;
    console.log('  #' + f.id + ' (' + f.cat + '): ' + f.issues.join(', '));
    console.log('    Preview: ' + f.preview + '...');
  }
  console.log('\nIssue breakdown:');
  for (const [k, v] of Object.entries(issueCounts).sort((a, b) => b[1] - a[1])) {
    console.log('  ' + k + ': ' + v + '/' + N + ' (' + Math.round(v / N * 100) + '%)');
  }
}

// Vignette length stats
console.log('\n=== VIGNETTE LENGTH STATS ===');
const lengths = scts.map(s => (s.vignette?.narrative || '').length);
lengths.sort((a, b) => a - b);
console.log('Min:', lengths[0], 'chars');
console.log('P25:', lengths[Math.floor(lengths.length * 0.25)]);
console.log('Median:', lengths[Math.floor(lengths.length * 0.5)]);
console.log('P75:', lengths[Math.floor(lengths.length * 0.75)]);
console.log('Max:', lengths[lengths.length - 1]);
console.log('Avg:', Math.round(lengths.reduce((a, b) => a + b, 0) / lengths.length));

// Rationale length stats
console.log('\n=== RATIONALE LENGTH STATS ===');
const ratLens = scts.map(s => (s.rationale?.correct || '').length);
ratLens.sort((a, b) => a - b);
console.log('Min:', ratLens[0], 'chars');
console.log('Median:', ratLens[Math.floor(ratLens.length * 0.5)]);
console.log('Max:', ratLens[ratLens.length - 1]);
const noRationale = ratLens.filter(l => l < 20).length;
console.log('Weak rationale (<20ch):', noRationale + '/' + scts.length);

// Print 3 random FULL samples for human review
console.log('\n=== 3 FULL SAMPLES FOR HUMAN REVIEW ===');
const reviewIdx = [42, 187, 333];
for (const i of reviewIdx) {
  if (!scts[i]) continue;
  const s = scts[i];
  console.log('\n─── Sample (ID:' + s._id + ', ' + s.category + ') ───');
  console.log('SKENARIO:\n  ' + s.vignette.narrative);
  console.log('\nPROMPT:\n  ' + s.prompt);
  console.log('\nOPTIONS:');
  for (const o of s.options) {
    console.log('  ' + o.id + ' [' + o.sct_panel_votes + ' votes]' + (o.is_correct ? ' ★' : '') + ' — ' + o.text);
  }
  console.log('\nRATIONALE:\n  ' + s.rationale.correct);
}
