/**
 * Add meta.sourceLabel abbreviation to every case in the dataset
 * Usage: node ingestion/add-source-labels.cjs
 */
const fs = require('fs');
const path = require('path');

const COMPILED = path.join(__dirname, 'output', 'compiled_cases.json');
const PUBLIC = path.join(__dirname, '..', 'public', 'data', 'compiled_cases.json');

const LABELS = {
  'medmcqa': 'MedMCQA',
  'medqa': 'MedQA',
  'headqa': 'HeadQA-ES',
  'pubmedqa': 'PubMedQA',
  'litfl': 'LITFL',
  'docquiz': 'DocQuiz',
  'ukmppd-scribd': 'UKMPPD-S',
  'ukmppd-optima': 'UKMPPD-O',
  'ukmppd-ukdicorner': 'UKMPPD-UC',
  'ukmppd-pdf-scribd': 'UKMPPD-P',
  'ukmppd_pdf': 'UKMPPD-P',
  'ukmppd_web': 'UKMPPD-W',
  'sct-alchemist': 'SCT',
  'frenchmedmcqa': 'FrMedMCQA',
  'med-dataset': 'MedDS',
};

// MMLU variants all get "MMLU" label
const MMLU_PATTERN = /^mmlu/;

console.log('=== Add Source Labels ===\n');

const cases = JSON.parse(fs.readFileSync(COMPILED, 'utf-8'));
let updated = 0;

for (const c of cases) {
  if (!c.meta) c.meta = {};
  const src = c.meta.source || '';
  
  if (LABELS[src]) {
    c.meta.sourceLabel = LABELS[src];
  } else if (MMLU_PATTERN.test(src)) {
    c.meta.sourceLabel = 'MMLU';
  } else {
    c.meta.sourceLabel = src.substring(0, 10).toUpperCase();
  }
  updated++;
}

fs.writeFileSync(COMPILED, JSON.stringify(cases), 'utf-8');
fs.copyFileSync(COMPILED, PUBLIC);

// Stats
const stats = {};
for (const c of cases) {
  const label = c.meta.sourceLabel;
  stats[label] = (stats[label] || 0) + 1;
}

console.log(`Updated ${updated} cases\n`);
console.log('Source Label Breakdown:');
for (const [label, count] of Object.entries(stats).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${label.padEnd(12)} ${count.toLocaleString()}`);
}
console.log(`\nTotal: ${cases.length.toLocaleString()}`);
console.log('Done!');
