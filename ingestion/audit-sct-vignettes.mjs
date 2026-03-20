/**
 * DEEP AUDIT: SCT Vignette Coherence & Clinical Structure
 * 
 * Criteria checklist:
 * 1. Demographics (Age & Sex)
 * 2. Clinical Setting (IGD, Poli, Puskesmas, Klinik)
 * 3. Chief Complaint (keluhan utama)
 * 4. Temporal Context (durasi/timeline keluhan)
 * 5. Objective Data (Vitals / Physical Exam)
 * 6. Language Quality (Formal Indonesian, no slang/informal words, no English leakage)
 * 7. Point of View (3rd person objective)
 */
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const COMPILED_PATH = join(import.meta.dirname, 'output', 'compiled_cases.json');
const cases = JSON.parse(readFileSync(COMPILED_PATH, 'utf-8'));
const scts = cases.filter(c => c.q_type === 'SCT');

console.log('══════════════════════════════════════════════════');
console.log(' 🔬 VIGNETTE COHERENCE AUDIT — 1,000 SCT Cases');
console.log('══════════════════════════════════════════════════\n');

const issues = {
  // 1. Demographics
  missing_subject: [],      // missing "Seorang laki-laki/perempuan/anak/bayi/pasien"
  missing_age: [],          // missing "berusia XX tahun/bulan"

  // 2. Setting 
  missing_setting: [],      // nowhere mentions "datang ke", "dibawa ke", "di ruang bedah", UGD, RS, poli, klinik

  // 3. Complaint & Duration
  missing_complaint: [],    // missing "dengan keluhan", "mengeluhkan", "karena"
  missing_duration: [],     // missing "sejak", "selama", "hari/minggu/bulan yang lalu"

  // 4. Clinical Data
  missing_vitals: [],       // no mention of TD, nadi, RR, suhu, tekanan darah, HR, dll
  missing_physical_exam: [],// no mention of pemeriksaan fisik, tampak, auskultasi, palpasi, lab, dll

  // 5. Language & Tone
  informal_language: [],    // contains slang: "udah", "cewek", "cowok", "mencret", "muntah-muntah", "nggak", "gak"
  english_leakage: [],      // contains "patient", "presents", "history of", "exam", "reveals"
  first_person_pov: [],     // contains "saya", "aku"
  
  // 6. Formatting
  starts_with_number: [],   // Starts directly with a symptom instead of subject
  incomplete_sentences: [], // Ends abruptly without punctuation
};

// Regex dictionaries
const RE_SUBJECT = /\b(seorang\s+(laki-laki|perempuan|wanita|pria|anak|bayi|pasien)|laki-laki|perempuan|wanita|pria|anak|bayi|pasien)\b/i;
const RE_AGE = /\b(\d+)\s*(tahun|bulan|hari|minggu|thn|bln|hr|mgg)\b/i;
const RE_SETTING = /\b(datang|dibawa|dirujuk|diantar|masuk)\b.*\b(ugd|igd|poli|poliklinik|puskesmas|klinik|rumah sakit|rs|dokter|praktik)\b/i;
const RE_COMPLAINT = /\b(dengan keluhan|mengeluh|mengeluhkan|karena keluhan|karena|untuk evaluasi|konsultasi)\b/i;
const RE_DURATION = /\b(sejak|selama|kurang lebih)\s+(\d+|beberapa)\s*(jam|hari|minggu|bulan|tahun)/i;
const RE_VITALS = /\b(tekanan darah|td|nadi|denyut|hr|frekuensi napas|rr|suhu|[0-9]{2,3}\/[0-9]{2,3}\s*mmhg|x\/menit|kali\/menit|celsius|°c)\b/i;
const RE_EXAM = /\b(pemeriksaan( fisik| lokal| lab| penunjang)?|tampak|auskultasi|palpasi|perkusi|inspeksi|hasil|menunjukkan|didapatkan)\b/i;

const RE_INFORMAL = /\b(udah|cewek|cowok|mencret|muntah-muntah|pusing tujuh keliling|nggak|gak|bikin|karna|yg|dgn|krn|pd)\b/i;
const RE_ENGLISH = /\b(patient|presents|history of|exam reveals|complains|years old|blood pressure|heart rate)\b/i;
const RE_FIRST_PERSON = /\b(saya|aku|kami)\b/i;

let perfectScoreCount = 0;

for (const c of scts) {
  const v = c.vignette?.narrative || '';
  const id = c._id;
  
  let defectCount = 0;

  if (!RE_SUBJECT.test(v)) { issues.missing_subject.push(id); defectCount++; }
  if (!RE_AGE.test(v)) { issues.missing_age.push(id); defectCount++; }
  if (!RE_SETTING.test(v)) { issues.missing_setting.push(id); defectCount++; }
  if (!RE_COMPLAINT.test(v)) { issues.missing_complaint.push(id); defectCount++; }
  // Duration is not strict for every case (e.g., trauma), but good to track
  if (!RE_DURATION.test(v)) { issues.missing_duration.push(id); } 
  if (!RE_VITALS.test(v)) { issues.missing_vitals.push(id); defectCount++; }
  if (!RE_EXAM.test(v) && !RE_VITALS.test(v)) { issues.missing_physical_exam.push(id); defectCount++; }

  if (RE_INFORMAL.test(v)) { issues.informal_language.push(id); defectCount++; }
  if (RE_ENGLISH.test(v)) { issues.english_leakage.push(id); defectCount++; }
  if (RE_FIRST_PERSON.test(v)) { issues.first_person_pov.push(id); defectCount++; }

  if (/^\d/.test(v)) { issues.starts_with_number.push(id); defectCount++; }
  if (!/[.!?]$/.test(v.trim())) { issues.incomplete_sentences.push(id); defectCount++; }

  if (defectCount === 0) perfectScoreCount++;
}

console.log(`━━━ ARCHITECTURAL COHERENCE ━━━`);
console.log(`✅ Perfect "Golden Standard" Vignettes: ${perfectScoreCount} / ${scts.length} (${((perfectScoreCount/scts.length)*100).toFixed(1)}%)`);

console.log(`\n━━━ MISSING CORE COMPONENTS ━━━`);
console.log(`  Missing Subject (Age/Sex):  ${issues.missing_subject.length} / ${issues.missing_age.length}`);
console.log(`  Missing Clinical Setting:   ${issues.missing_setting.length}`);
console.log(`  Missing Chief Complaint:    ${issues.missing_complaint.length}`);
console.log(`  Missing Timeline/Duration:  ${issues.missing_duration.length}`);
console.log(`  Missing Vitals/Exam Data:   ${issues.missing_vitals.length} / ${issues.missing_physical_exam.length}`);

console.log(`\n━━━ LANGUAGE & TONE ISSUES ━━━`);
console.log(`  Informal/Slang Words:       ${issues.informal_language.length}`);
console.log(`  English Text Leakage:       ${issues.english_leakage.length}`);
console.log(`  First-Person POV (saya):    ${issues.first_person_pov.length}`);

console.log(`\n━━━ SAMPLES OF FLAGGED VIGNETTES ━━━`);
const sampleSize = 2;

if (issues.missing_setting.length > 0) {
  console.log(`\n[Missing Setting]`);
  issues.missing_setting.slice(0, sampleSize).forEach(id => {
    const c = scts.find(x => x._id === id);
    console.log(`  - ID ${id}: ${c.vignette.narrative.substring(0, 100)}...`);
  });
}

if (issues.missing_vitals.length > 0) {
  console.log(`\n[Missing Vitals]`);
  issues.missing_vitals.slice(0, sampleSize).forEach(id => {
    const c = scts.find(x => x._id === id);
    console.log(`  - ID ${id}: ${c.vignette.narrative.substring(0, 100)}...`);
  });
}

if (issues.informal_language.length > 0) {
  console.log(`\n[Informal Language Detected]`);
  issues.informal_language.slice(0, 3).forEach(id => {
    const c = scts.find(x => x._id === id);
    console.log(`  - ID ${id}: ${c.vignette.narrative.substring(0, 150)}...`);
  });
}

console.log(`\n──────────────────────────────────────────────────`);
console.log(`Note: A vignette without explicit setting or vitals is not necessarily invalid (e.g. psych cases, basic sciences), but tracking them ensures standardization.`);
