/**
 * Generate Semantic Case Codes
 * 
 * Format: {SOURCE}-{CATEGORY}-{TYPE}-{SEQUENCE}
 * Example: MQA-IPD-MCQ-00542
 * 
 * - SOURCE (3 chars): Identifies dataset provenance
 * - CATEGORY (3 chars): Medical discipline
 * - TYPE (3 chars): Question format
 * - SEQUENCE (5 digits): Zero-padded within source+category group
 * 
 * These codes are STABLE (generated once, never regenerated)
 * and SELF-DESCRIBING (any human or AI can decode them).
 */
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, '..', 'public', 'data', 'compiled_cases.json');

// ── Source Code Map (3 chars) ──
const SOURCE_CODES = {
  'medqa':            'MQA',
  'medmcqa':          'MMC',
  'headqa':           'HQA',
  'pubmedqa':         'PMQ',
  'frenchmedmcqa':    'FMC',
  'worldmedqa':       'WMQ',
  'polish-ldek-en':   'PLK',
  'greek-mcqa':       'GRK',
  'tw-medqa':         'TWM',
  'asian-medqa':      'AMQ',
  'litfl':            'LIT',
  'docquiz':          'DQZ',
  'nano1337-mcqs':    'NAN',
  // UKMPPD sources
  'ukmppd-pdf':       'UKP',
  'ukmppd-web':       'UKW',
  'ukmppd-scribd':    'UKS',
  'ukmppd-pdf-scribd':'UPS',
  'ukmppd-optima':    'UKO',
  'ukmppd-ukdicorner':'UKD',
  'ukmppd-rekapan-2021-ocr': 'UKR',
  'fk-leaked-ukmppd': 'FKU',
  // MMLU subsets
  'mmlu-clinical_knowledge':     'MCK',
  'mmlu-medical_genetics':       'MMG',
  'mmlu-anatomy':                'MAN',
  'mmlu-college_medicine':       'MCM',
  'mmlu-college_biology':        'MCB',
  'mmlu-nutrition':              'MNU',
  'mmlu-virology':               'MVR',
  'mmlu-professional_psychology':'MPP',
  'mmlu-high_school_biology':    'MHB',
  'mmlu-human_aging':            'MHA',
  'mmlu-professional_medicine':  'MPM',
  // SCT & generated
  'sct-alchemist-v3':  'SAV',
  'sct-factory-v1':    'SFV',
  // Tryout / Indonesia
  'aipki-ugm':         'AUG',
  'ingenio-tryout':    'ING',
  'aipki-tryout':      'AIP',
  'sinauyuk-tryout':   'SNY',
  'ukdi-tryout':       'UKT',
  'medsense-tryout':   'MSN',
  'fdi-tryout':        'FDI',
  // Fallback
  'unknown':           'UNK',
  'manual':            'MAN',
};

// ── Category Code Map (3 chars) ──
const CATEGORY_CODES = {
  'Ilmu Penyakit Dalam':      'IPD',
  'Bedah':                    'BDH',
  'Obstetri & Ginekologi':    'OBG',
  'Ilmu Kesehatan Anak':      'ANA',
  'Neurologi':                'NEU',
  'Kulit & Kelamin':          'KLT',
  'Mata':                     'MTA',
  'THT':                      'THT',
  'Psikiatri':                'PSI',
  'Radiologi':                'RAD',
  'Patologi Klinik':          'PAK',
  'Patologi Anatomi':         'PAT',
  'Farmakologi':              'FRM',
  'Forensik':                 'FOR',
  'Ilmu Kesehatan Masyarakat':'IKM',
  'Anestesi':                 'ANS',
  'Mikrobiologi':             'MKB',
  'Biokimia':                 'BIO',
  'Fisiologi':                'FIS',
  'Anatomi':                  'ANT',
  'Histologi':                'HIS',
};
const FALLBACK_CATEGORY = 'GEN'; // General/unclassified

// ── Type Codes ──
const TYPE_CODES = {
  'MCQ': 'MCQ',
  'SCT': 'SCT',
  'CLINICAL_DISCUSSION': 'CLD',
};

console.log('🏷️  Generating Semantic Case Codes...');
console.log('━'.repeat(60));

const db = JSON.parse(readFileSync(DB_PATH, 'utf8'));

// Group counters for sequence numbers
const seqCounters = {};
let generated = 0;
let skipped = 0;

for (const c of db) {
  // Skip if already has a valid case_code
  if (c.case_code && /^[A-Z]{3}-[A-Z]{3}-[A-Z]{3}-\d{5}$/.test(c.case_code)) {
    skipped++;
    continue;
  }

  const source = c.meta?.source || 'unknown';
  const srcCode = SOURCE_CODES[source] || 'UNK';
  
  const category = c.category || '';
  const catCode = CATEGORY_CODES[category] || FALLBACK_CATEGORY;
  
  const qType = c.q_type || 'MCQ';
  const typeCode = TYPE_CODES[qType] || 'MCQ';
  
  // Generate sequence within source+category group
  const groupKey = `${srcCode}-${catCode}-${typeCode}`;
  seqCounters[groupKey] = (seqCounters[groupKey] || 0) + 1;
  const seq = String(seqCounters[groupKey]).padStart(5, '0');
  
  c.case_code = `${srcCode}-${catCode}-${typeCode}-${seq}`;
  generated++;
}

// Print distribution
console.log(`✅ Generated: ${generated.toLocaleString()} case codes`);
console.log(`⏭️  Skipped (already had code): ${skipped.toLocaleString()}`);
console.log('');
console.log('📊 Group Distribution (top 20):');

const groupCounts = Object.entries(seqCounters)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 20);

for (const [group, count] of groupCounts) {
  console.log(`   ${group}: ${count.toLocaleString()}`);
}

// Show some examples
console.log('');
console.log('📋 Sample Case Codes:');
for (let i = 0; i < Math.min(5, db.length); i++) {
  console.log(`   ${db[i].case_code} → "${(db[i].title || '').slice(0, 50)}..."`);
}
// Show a random UKMPPD example
const ukmppd = db.find(c => c.case_code?.startsWith('UKP'));
if (ukmppd) console.log(`   ${ukmppd.case_code} → "${(ukmppd.title || '').slice(0, 50)}..."`);
const sct = db.find(c => c.case_code?.startsWith('SAV'));
if (sct) console.log(`   ${sct.case_code} → "${(sct.title || '').slice(0, 50)}..."`);

// Atomic save
const tmp = `${DB_PATH}.tmp`;
writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf8');
renameSync(tmp, DB_PATH);
console.log('');
console.log('💾 compiled_cases.json updated.');
