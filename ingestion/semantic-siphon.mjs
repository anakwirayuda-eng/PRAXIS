/**
 * Semantic Siphon — $0 Re-tagging Engine
 * 
 * DeepThink Strategy: Scan ONLY options + final question prompt (not full vignette)
 * to re-tag IPD/HeadQA cases into Radiologi, Mata, Forensik.
 */
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, '..', 'public', 'data', 'compiled_cases.json');

// ── DeepThink's Regex Radar (scan options + prompt only) ──
const SIPHON_RULES = [
  {
    target: 'Radiologi',
    regex: /\b(ct scan|ct[-\s]?kepala|mri|usg|ultrasonografi|x[-\s]?ray|rontgen|r[oö]ntgen|fluoroskopi|barium|kontras|mammografi|echocardiography|modalitas|pencitraan|radiografi|radiolog|imaging|sunburst|onion skin|bamboo spine|steeple sign|thumbprint sign|air.?bronchogram|batwing|meniscus sign|step.?ladder|air.?fluid|coffee bean|pneumoperitoneum|crescent sign|salter.?harris|bikonveks|bulan sabit|transition zone|dinner fork|bi.?rads|fast protocol|alara)\b/i,
  },
  {
    target: 'Mata',
    regex: /\b(visus|funduskopi|retina|kornea|lensa|glaukoma|katarak|hifema|konjungtiv|timolol|miopia|hipermetropia|astigmatis|snellen|slit.?lamp|oftalmoskop|pterigium|pinguekula|hordeolum|kalazion|uveitis|keratitis|ablasio|cherry red spot|floaters?|flashes|presbiopia|dakriosistitis|retinoblastoma|leukokoria|ishihara|buta warna|diplopia|papilledema|intraocular|strabismus|amblyopia|fluorescein|konjungtiva|pupil|cataract|glaucoma|retinopathy|cornea)\b/i,
  },
  {
    target: 'Forensik',
    regex: /\b(visum|lebam mayat|kaku mayat|rigor mortis|livor mortis|algor mortis|luka tembak|toksikolog|sianida|organofosfat|informed consent|malpraktik|malpractice|autonomy|beneficence|non.?maleficence|justice|etik kedokteran|medical ethics|autopsy|postmortem|cause of death|manner of death|forensi[ck]|decomposition|asfiksia|drowning|tenggelam|hanging|gantung|strangulation|penjeratan|infanticide|diatom|cherry red livid|bitter almond|atropin|sludge|rahasia medis|confidentiality|negligence|duty of care)\b/i,
  },
];

console.log('🔍 Semantic Siphon — $0 Re-tagging Engine');
console.log('━'.repeat(60));

const db = JSON.parse(readFileSync(DB_PATH, 'utf8'));
const results = { Radiologi: [], Mata: [], Forensik: [] };
let totalSiphoned = 0;

// Source categories to scan (IPD surplus + HeadQA + other generics)
const DONOR_CATS = new Set([
  'Ilmu Penyakit Dalam', 'Bedah', 'Ilmu Kesehatan Anak',
  'Neurologi', 'Farmakologi', 'Biokimia', 'Anatomi',
  'Ilmu Kesehatan Masyarakat', 'Psikiatri',
]);

for (const c of db) {
  // Only scan donor categories (don't re-tag from target categories)
  if (!DONOR_CATS.has(c.category)) continue;
  
  // Build scan text: options + final question sentence (DeepThink's Genius Hack)
  const optionTexts = (c.options || []).map(o => o.text || '').join(' ');
  const question = c.question || '';
  // Extract last sentence (the actual prompt)
  const sentences = question.split(/[.?!]\s+/);
  const lastPrompt = sentences[sentences.length - 1] || '';
  
  const scanText = `${optionTexts} ${lastPrompt}`;
  
  // Test against each siphon rule
  for (const rule of SIPHON_RULES) {
    const match = scanText.match(rule.regex);
    if (match) {
      results[rule.target].push({
        _id: c._id,
        case_code: c.case_code,
        from: c.category,
        matchedKeyword: match[0],
        prompt: lastPrompt.slice(0, 80),
      });
      break; // Only re-tag to first match
    }
  }
}

// Report
for (const [cat, matches] of Object.entries(results)) {
  console.log(`\n${cat}: ${matches.length} candidates found`);
  // Show sample
  for (const m of matches.slice(0, 5)) {
    console.log(`  ${m.case_code || m._id} | from ${m.from} | matched "${m.matchedKeyword}" | "${m.prompt}..."`);
  }
  if (matches.length > 5) console.log(`  ... and ${matches.length - 5} more`);
  totalSiphoned += matches.length;
}

console.log(`\n${'━'.repeat(60)}`);
console.log(`📊 TOTAL SIPHONED: ${totalSiphoned}`);
console.log(`   Target was: 757`);
console.log(`   ${totalSiphoned >= 757 ? '✅ TARGET MET — $0 VICTORY!' : `⚠️  Short by ${757 - totalSiphoned}. May need AI generation.`}`);

// Apply re-tags
console.log(`\n🔧 Applying re-tags...`);
let applied = 0;
for (const [cat, matches] of Object.entries(results)) {
  for (const m of matches) {
    const c = db.find(x => x._id === m._id);
    if (c) {
      c.meta = c.meta || {};
      c.meta._siphoned_from = c.category;
      c.meta._siphon_keyword = m.matchedKeyword;
      c.category = cat;
      applied++;
    }
  }
}

console.log(`✅ Applied ${applied} re-tags`);

// Final counts
const finalCounts = {};
for (const c of db) {
  finalCounts[c.category] = (finalCounts[c.category] || 0) + 1;
}
console.log('\n📊 Post-Siphon Counts:');
for (const cat of ['Radiologi', 'Mata', 'Forensik', 'THT', 'Kulit & Kelamin']) {
  console.log(`   ${cat.padEnd(30)} ${(finalCounts[cat] || 0).toLocaleString()}`);
}

const tmp = `${DB_PATH}.tmp`;
writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf8');
renameSync(tmp, DB_PATH);
console.log('\n💾 Saved.');
