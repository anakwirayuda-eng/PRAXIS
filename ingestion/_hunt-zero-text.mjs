/**
 * DEEP AUDIT: Find cases that would render ZERO text in CasePlayer
 * Simulates what caseLoader.js does — checks resolvedNarrative
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = dirname(fileURLToPath(import.meta.url));
const db = JSON.parse(readFileSync(join(__dirname, '..', 'public', 'data', 'compiled_cases.json'), 'utf8'));

const DEFAULT_NARRATIVE = 'Review this case carefully.';

const zeroText = [];
const shortText = [];
const noOptions = [];

for (const c of db) {
  // Simulate caseLoader resolve
  const vignette = typeof c.vignette === 'string' ? {} : (c.vignette || {});
  const resolvedNarrative = c.question
    || (typeof c.vignette === 'string' ? c.vignette : '')
    || vignette.narrative
    || '';

  const cleanNarr = (resolvedNarrative || '').trim();
  
  if (!cleanNarr || cleanNarr === DEFAULT_NARRATIVE || cleanNarr.length < 5) {
    zeroText.push({
      _id: c._id,
      src: c.meta?.source,
      cat: c.category,
      qLen: (c.question || '').length,
      narrLen: (vignette.narrative || '').length,
      resolved: cleanNarr.slice(0, 50),
    });
  } else if (cleanNarr.length < 30) {
    shortText.push({
      _id: c._id,
      src: c.meta?.source,
      text: cleanNarr,
    });
  }

  if (!Array.isArray(c.options) || c.options.length < 2) {
    noOptions.push(c._id);
  }
}

console.log(`═══ ZERO-TEXT CASES (would show blank in UI) ═══`);
console.log(`Count: ${zeroText.length}`);
if (zeroText.length > 0) {
  const bySrc = {};
  zeroText.forEach(c => { bySrc[c.src || '?'] = (bySrc[c.src || '?'] || 0) + 1; });
  console.log('By source:');
  Object.entries(bySrc).sort((a,b) => b[1]-a[1]).forEach(([s,n]) => console.log(`  ${n.toString().padStart(5)}  ${s}`));
  console.log('\nSamples:');
  zeroText.slice(0, 10).forEach(c => console.log(`  ID:${c._id} src:${c.src} qLen:${c.qLen} narrLen:${c.narrLen} → "${c.resolved}"`));
}

console.log(`\n═══ SHORT TEXT (<30 chars) ═══`);
console.log(`Count: ${shortText.length}`);
shortText.slice(0, 10).forEach(c => console.log(`  ID:${c._id} src:${c.src} → "${c.text}"`));

console.log(`\n═══ NO OPTIONS (<2) ═══`);
console.log(`Count: ${noOptions.length}`);

console.log(`\n═══ SUMMARY ═══`);
console.log(`Total DB: ${db.length}`);
console.log(`Zero text: ${zeroText.length} (${(zeroText.length/db.length*100).toFixed(2)}%)`);
console.log(`Short text: ${shortText.length}`);
console.log(`No options: ${noOptions.length}`);
console.log(`Clean presentable: ${db.length - zeroText.length - noOptions.length}`);
