import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = dirname(fileURLToPath(import.meta.url));

// PedMedQA
const ped = JSON.parse(readFileSync(join(__dirname, 'sources/pedmedqa/pedmedqa_raw.json'), 'utf8'));
console.log('=== PedMedQA ===');
console.log('Total:', ped.length);
const s1 = ped[0];
console.log('Keys:', Object.keys(s1).join(', '));
console.log('Has answer?', 'answer' in s1 || 'correct_answer' in s1 || 'cop' in s1);
console.log('Has explanation?', 'explanation' in s1 || 'rationale' in s1 || 'exp' in s1);
console.log('Sample question:', (s1.question || s1.text || '').slice(0, 150));
console.log('Sample answer:', s1.answer || s1.correct_answer || s1.cop || 'N/A');
console.log('Sample explanation:', (s1.explanation || s1.rationale || s1.exp || 'NONE').toString().slice(0, 150));
console.log('');

// MedExpQA  
const med = JSON.parse(readFileSync(join(__dirname, 'sources/medexpqa/medexpqa_raw.json'), 'utf8'));
const medItems = Array.isArray(med) ? med : Object.values(med).flat();
console.log('=== MedExpQA ===');
console.log('Total:', medItems.length);
const s2 = medItems[0];
console.log('Keys:', Object.keys(s2).join(', '));
console.log('Has answer?', 'correct_option' in s2);
console.log('Has explanation?', 'explanations' in s2);
console.log('Sample question:', (s2.question || '').slice(0, 150));
console.log('');

// HeadQA — check categories
const head = JSON.parse(readFileSync(join(__dirname, 'sources/headqa/headqa_raw.json'), 'utf8'));
const headItems = Array.isArray(head) ? head : Object.values(head).flat();
console.log('=== HeadQA ===');
console.log('Total:', headItems.length);
const s3 = headItems[0];
console.log('Keys:', Object.keys(s3).join(', '));
console.log('Sample question:', (s3.qtext || s3.question || '').slice(0, 150));
// Category distribution
const cats = {};
for (const h of headItems) {
  cats[h.category] = (cats[h.category] || 0) + 1;
}
console.log('Category breakdown:');
for (const [c, n] of Object.entries(cats).sort((a,b) => b[1]-a[1])) {
  console.log('  ' + c + ': ' + n);
}
// Check avg text length (for translation cost estimate)
const avgLen = headItems.reduce((s, h) => s + (h.qtext || '').length, 0) / headItems.length;
console.log('Avg question length:', Math.round(avgLen), 'chars');
console.log('Estimated tokens for translation:', Math.round(headItems.length * avgLen * 0.35));
