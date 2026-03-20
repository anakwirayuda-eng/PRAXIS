/**
 * Topic Coverage Audit — find underrepresented areas
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, '..', 'public', 'data', 'compiled_cases.json');

const db = JSON.parse(readFileSync(DB_PATH, 'utf8'));
const active = db.filter(c => !c.meta?.quarantined);

// 1. Category distribution
const categories = {};
const organSystems = {};
const languages = {};
const qualityBuckets = { '0-20': 0, '21-40': 0, '41-60': 0, '61-80': 0, '81-100': 0 };
let withRationale = 0;
let withDistractors = 0;
let withPearl = 0;

for (const c of active) {
  // Category
  const cat = c.category || 'Uncategorized';
  categories[cat] = (categories[cat] || 0) + 1;
  
  // Organ system
  const org = c.meta?.organ_system || 'untagged';
  organSystems[org] = (organSystems[org] || 0) + 1;
  
  // Language
  const lang = c.meta?.language || 'unknown';
  languages[lang] = (languages[lang] || 0) + 1;
  
  // Quality
  const qs = c.meta?.quality_score ?? 0;
  if (qs <= 20) qualityBuckets['0-20']++;
  else if (qs <= 40) qualityBuckets['21-40']++;
  else if (qs <= 60) qualityBuckets['41-60']++;
  else if (qs <= 80) qualityBuckets['61-80']++;
  else qualityBuckets['81-100']++;
  
  // Rationale depth
  if (c.rationale?.correct?.length > 50) withRationale++;
  if (c.rationale?.distractors && Object.keys(c.rationale.distractors).length > 0) withDistractors++;
  if (c.rationale?.pearl?.length > 10) withPearl++;
}

// SKDI target proportions (approximate from UKMPPD blueprint)
const SKDI_TARGETS = {
  'Ilmu Penyakit Dalam': 18,
  'Bedah': 10,
  'Obstetri & Ginekologi': 10,
  'Ilmu Kesehatan Anak': 10,
  'Neurologi': 5,
  'Psikiatri': 5,
  'Kulit & Kelamin': 5,
  'Mata': 5,
  'THT': 5,
  'Ilmu Kesehatan Masyarakat': 7,
  'Farmakologi': 5,
  'Forensik': 3,
  'Radiologi': 3,
  'Patologi Klinik': 2,
  'Patologi Anatomi': 2,
  'Anestesi': 2,
  'Mikrobiologi': 1.5,
  'Biokimia': 1,
  'Fisiologi': 0.5,
};

console.log('📊 TOPIC COVERAGE AUDIT');
console.log('━'.repeat(80));
console.log(`Active cases: ${active.length.toLocaleString()}`);
console.log('');

// Category table
console.log('📋 CATEGORY DISTRIBUTION (vs SKDI Target)');
console.log('─'.repeat(80));
console.log('Category'.padEnd(30) + 'Count'.padEnd(10) + '%'.padEnd(8) + 'SKDI%'.padEnd(8) + 'Gap'.padEnd(8) + 'Verdict');
console.log('─'.repeat(80));

const sortedCats = Object.entries(categories).sort((a, b) => b[1] - a[1]);
for (const [cat, count] of sortedCats) {
  const pct = (count / active.length * 100).toFixed(1);
  const target = SKDI_TARGETS[cat];
  if (target) {
    const gap = (pct - target).toFixed(1);
    const verdict = parseFloat(gap) < -3 ? '🔴 UNDERREP' : parseFloat(gap) > 5 ? '🟡 EXCESS' : '✅ OK';
    console.log(`${cat.padEnd(30)}${String(count).padEnd(10)}${pct.padEnd(8)}${target.toFixed(1).padEnd(8)}${gap.padEnd(8)}${verdict}`);
  } else {
    console.log(`${cat.padEnd(30)}${String(count).padEnd(10)}${pct.padEnd(8)}${'—'.padEnd(8)}${'—'.padEnd(8)}ℹ️  No SKDI target`);
  }
}

// Organ systems
console.log('');
console.log('🫀 ORGAN SYSTEM DISTRIBUTION');
console.log('─'.repeat(60));
const sortedOrg = Object.entries(organSystems).sort((a, b) => b[1] - a[1]);
for (const [org, count] of sortedOrg) {
  const pct = (count / active.length * 100).toFixed(1);
  const bar = '█'.repeat(Math.round(pct));
  console.log(`${org.padEnd(20)}${String(count).padStart(7)}  ${pct.padStart(5)}%  ${bar}`);
}

// Languages
console.log('');
console.log('🌐 LANGUAGE DISTRIBUTION');
console.log('─'.repeat(40));
for (const [lang, count] of Object.entries(languages).sort((a, b) => b[1] - a[1])) {
  console.log(`${lang.padEnd(10)}${count.toLocaleString().padStart(8)}  ${(count / active.length * 100).toFixed(1)}%`);
}

// Quality
console.log('');
console.log('📈 QUALITY SCORE DISTRIBUTION');
console.log('─'.repeat(40));
for (const [bucket, count] of Object.entries(qualityBuckets)) {
  const bar = '█'.repeat(Math.round(count / active.length * 100));
  console.log(`${bucket.padEnd(8)}${count.toLocaleString().padStart(8)}  ${(count / active.length * 100).toFixed(1)}%  ${bar}`);
}

// Rationale depth
console.log('');
console.log('📝 RATIONALE DEPTH');
console.log('─'.repeat(40));
console.log(`Has rationale (>50ch):   ${withRationale.toLocaleString()} (${(withRationale / active.length * 100).toFixed(1)}%)`);
console.log(`Has distractors:         ${withDistractors.toLocaleString()} (${(withDistractors / active.length * 100).toFixed(1)}%)`);
console.log(`Has clinical pearl:      ${withPearl.toLocaleString()} (${(withPearl / active.length * 100).toFixed(1)}%)`);
