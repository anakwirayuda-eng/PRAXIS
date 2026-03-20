/**
 * Category Normalization — map 80+ fragmented names to SKDI standard categories
 */
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, '..', 'public', 'data', 'compiled_cases.json');

// Map ALL variants → standard SKDI category name
const CATEGORY_MAP = {
  // Ilmu Penyakit Dalam
  'Ilmu Penyakit Dalam': 'Ilmu Penyakit Dalam',
  'Penyakit Dalam': 'Ilmu Penyakit Dalam',
  'INTERNAL MEDICINE': 'Ilmu Penyakit Dalam',
  'Internal Medicine': 'Ilmu Penyakit Dalam',
  'GASTROENTEROLOGY': 'Ilmu Penyakit Dalam',
  'DIGESTIVE SYSTEM': 'Ilmu Penyakit Dalam',
  'DIGESTIVE TRACT': 'Ilmu Penyakit Dalam',
  'ENDOCRINOLOGY': 'Ilmu Penyakit Dalam',
  'HEMATOLOGY': 'Ilmu Penyakit Dalam',
  'NEPHROLOGY': 'Ilmu Penyakit Dalam',
  'RHEUMATOLOGY': 'Ilmu Penyakit Dalam',
  'INFECTOLOGY': 'Ilmu Penyakit Dalam',
  'ALLERGOLOGY': 'Ilmu Penyakit Dalam',
  'CARDIOLOGY AND CARDIOVASCULAR SURGERY': 'Ilmu Penyakit Dalam',
  'PNEUMOLOGY': 'Ilmu Penyakit Dalam',
  'PULMONOLOGY': 'Ilmu Penyakit Dalam',
  'PULMONOLOGY AND THORACIC SURGERY': 'Ilmu Penyakit Dalam',
  'PNEUMOLOGY AND THORACIC SURGERY': 'Ilmu Penyakit Dalam',
  'INFECTIOUS DISEASES AND MICROBIOLOGY': 'Ilmu Penyakit Dalam',
  'INFECTIOUS': 'Ilmu Penyakit Dalam',
  'MEDICAL ONCOLOGY': 'Ilmu Penyakit Dalam',
  'ONCOLOGY': 'Ilmu Penyakit Dalam',
  'ONCOLOGY (ECTOPIC)': 'Ilmu Penyakit Dalam',
  'GERIATRICS': 'Ilmu Penyakit Dalam',

  // Bedah
  'Bedah': 'Bedah',
  'SURGERY': 'Bedah',
  'GENERAL SURGERY': 'Bedah',
  'TRAUMATOLOGY AND ORTHOPEDICS': 'Bedah',
  'ORTHOPEDIC SURGERY AND TRAUMATOLOGY': 'Bedah',
  'UROLOGY': 'Bedah',
  'Bedah Saraf': 'Bedah',
  'NEUROSURGERY': 'Bedah',
  'PLASTIC SURGERY': 'Bedah',

  // Obstetri & Ginekologi
  'Obstetri & Ginekologi': 'Obstetri & Ginekologi',
  'OB/GYN': 'Obstetri & Ginekologi',
  'OBSTETRICS AND GYNECOLOGY': 'Obstetri & Ginekologi',
  'GYNECOLOGY': 'Obstetri & Ginekologi',

  // Anak
  'Ilmu Kesehatan Anak': 'Ilmu Kesehatan Anak',
  'Anak': 'Ilmu Kesehatan Anak',
  'PEDIATRICS': 'Ilmu Kesehatan Anak',

  // Neurologi
  'Neurologi': 'Neurologi',
  'Saraf': 'Neurologi',
  'NEUROLOGY': 'Neurologi',
  'NEUROLOGY AND NEUROSURGERY': 'Neurologi',
  'NEUROLOGY AND THORACIC SURGERY': 'Neurologi',

  // Psikiatri
  'Psikiatri': 'Psikiatri',
  'PSYCHIATRY': 'Psikiatri',

  // Kulit & Kelamin
  'Kulit & Kelamin': 'Kulit & Kelamin',
  'Kulit': 'Kulit & Kelamin',
  'DERMATOLOGY': 'Kulit & Kelamin',
  'DERMATOLOGY AND PLASTIC SURGERY': 'Kulit & Kelamin',
  'DERMATOLOGY, VENEREOLOGY AND PLASTIC SURGERY': 'Kulit & Kelamin',

  // Mata
  'Mata': 'Mata',
  'OPHTHALMOLOGY': 'Mata',
  'OPHTHALMOLOGY (ECTOPIC)': 'Mata',

  // THT
  'THT': 'THT',
  'OTORHINOLARYNGOLOGY': 'THT',
  'OTORHINOLARYNGOLOGY AND MAXILLOFACIAL SURGERY': 'THT',
  'OTOLARYNGOLOGY AND MAXILLOFACIAL SURGERY': 'THT',
  'ENT': 'THT',

  // IKM
  'Ilmu Kesehatan Masyarakat': 'Ilmu Kesehatan Masyarakat',
  'PUBLIC HEALTH': 'Ilmu Kesehatan Masyarakat',
  'PREVENTIVE MEDICINE': 'Ilmu Kesehatan Masyarakat',
  'PREVENTIVE MEDICINE AND EPIDEMIOLOGY': 'Ilmu Kesehatan Masyarakat',
  'EPIDEMIOLOGY': 'Ilmu Kesehatan Masyarakat',
  'EPIDEMIOLOGY AND PREVENTIVE MEDICINE': 'Ilmu Kesehatan Masyarakat',
  'PRIMARY CARE': 'Ilmu Kesehatan Masyarakat',
  'PRIMARY CARE AND SOCIAL NETWORKS': 'Ilmu Kesehatan Masyarakat',
  'BIOSTATISTICS': 'Ilmu Kesehatan Masyarakat',
  'STATISTICS': 'Ilmu Kesehatan Masyarakat',

  // Farmakologi
  'Farmakologi': 'Farmakologi',
  'PHARMACOLOGY': 'Farmakologi',

  // Forensik
  'Forensik': 'Forensik',
  'Medikolegal': 'Forensik',
  'LEGAL MEDICINE': 'Forensik',
  'FORENSIC MEDICINE': 'Forensik',

  // Radiologi
  'Radiologi': 'Radiologi',
  'RADIOLOGY': 'Radiologi',

  // Patologi Klinik
  'Patologi Klinik': 'Patologi Klinik',
  'CLINICAL PATHOLOGY': 'Patologi Klinik',

  // Patologi Anatomi
  'Patologi Anatomi': 'Patologi Anatomi',
  'Patologi': 'Patologi Anatomi',
  'PATHOLOGICAL ANATOMY': 'Patologi Anatomi',
  'ANATOMIC PATHOLOGY': 'Patologi Anatomi',

  // Anestesi & Emergency
  'Anestesi': 'Anestesi & Emergency Medicine',
  'Emergency Medicine': 'Anestesi & Emergency Medicine',
  'ANESTHESIOLOGY': 'Anestesi & Emergency Medicine',
  'ANESTHESIOLOGY AND CRITICAL CARE': 'Anestesi & Emergency Medicine',
  'ANESTHESIOLOGY, CRITICAL CARE AND EMERGENCIES': 'Anestesi & Emergency Medicine',
  'ANESTHESIOLOGY, CRITICAL CARE AND EMERGENCY MEDICINE': 'Anestesi & Emergency Medicine',
  'CRITICAL CARE': 'Anestesi & Emergency Medicine',
  'CRITICAL CARE AND EMERGENCY': 'Anestesi & Emergency Medicine',
  'CRITICAL CARE AND EMERGENCIES': 'Anestesi & Emergency Medicine',
  'CRITICAL AND EMERGENCY CARE': 'Anestesi & Emergency Medicine',
  'CRITICAL, PALLIATIVE AND EMERGENCY CARE': 'Anestesi & Emergency Medicine',
  'PALLIATIVE CARE': 'Anestesi & Emergency Medicine',

  // Mikrobiologi
  'Mikrobiologi': 'Mikrobiologi',
  'MICROBIOLOGY': 'Mikrobiologi',

  // Biokimia / Fisiologi / Anatomi
  'Biokimia': 'Biokimia',
  'BIOCHEMISTRY': 'Biokimia',
  'Fisiologi': 'Fisiologi',
  'PHYSIOLOGY': 'Fisiologi',
  'Anatomi': 'Anatomi',
  'ANATOMY': 'Anatomi',
  'Histologi': 'Histologi',

  // Other
  'GENETICS': 'Biokimia',
  'GENETICS AND IMMUNOLOGY': 'Biokimia',
  'Rehabilitasi Medik': 'Rehabilitasi Medik',

  // ── Remaining Indonesian variants ──
  'Pediatri': 'Ilmu Kesehatan Anak',
  'IKM & Kesmas': 'Ilmu Kesehatan Masyarakat',
  'IKM': 'Ilmu Kesehatan Masyarakat',
  'Evidence-Based Medicine': 'Ilmu Kesehatan Masyarakat',
  'Kedokteran Gigi': 'Kedokteran Gigi',
  'Hematologi & Infeksi': 'Ilmu Penyakit Dalam',
  'Anestesi & Emergency': 'Anestesi & Emergency Medicine',
  'Anatomi & Fisiologi': 'Anatomi',
  'Dermatovenereologi': 'Kulit & Kelamin',
  'Endokrinologi': 'Ilmu Penyakit Dalam',
  'Kardiologi': 'Ilmu Penyakit Dalam',
  'Pulmonologi': 'Ilmu Penyakit Dalam',
  'Gastroenterohepatologi': 'Ilmu Penyakit Dalam',
  'Nefrologi': 'Ilmu Penyakit Dalam',
  'Forensik & Medikolegal': 'Forensik',
  'THT-KL': 'THT',
  'Onkologi': 'Ilmu Penyakit Dalam',

  // ── Remaining international variants ──
  'GYNECOLOGY AND OBSTETRICS': 'Obstetri & Ginekologi',
  'TRAUMATOLOGY': 'Bedah',
  'INFECTIOUS DISEASES': 'Ilmu Penyakit Dalam',
  'CARDIOLOGY AND VASCULAR SURGERY': 'Ilmu Penyakit Dalam',
  'CARDIOLOGY': 'Ilmu Penyakit Dalam',
  'DIGESTIVE': 'Ilmu Penyakit Dalam',
};

console.log('🔧 Category Normalization');
console.log('━'.repeat(60));

const db = JSON.parse(readFileSync(DB_PATH, 'utf8'));
let normalized = 0;
let unmapped = {};

for (const c of db) {
  const old = c.category;
  const mapped = CATEGORY_MAP[old];
  if (mapped && mapped !== old) {
    c.meta = c.meta || {};
    c.meta._original_category = old;
    c.category = mapped;
    normalized++;
  } else if (!mapped && old) {
    unmapped[old] = (unmapped[old] || 0) + 1;
  }
}

console.log(`✅ Normalized: ${normalized.toLocaleString()} cases`);
if (Object.keys(unmapped).length > 0) {
  console.log(`⚠️  Unmapped categories:`);
  for (const [cat, count] of Object.entries(unmapped).sort((a,b) => b[1]-a[1]).slice(0, 10)) {
    console.log(`   ${cat}: ${count}`);
  }
}

// Recount
const cats = {};
for (const c of db) {
  cats[c.category] = (cats[c.category] || 0) + 1;
}
console.log('\n📊 After normalization:');
for (const [cat, count] of Object.entries(cats).sort((a,b) => b[1]-a[1])) {
  console.log(`   ${cat.padEnd(35)} ${count.toLocaleString()}`);
}

const tmp = `${DB_PATH}.tmp`;
writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf8');
renameSync(tmp, DB_PATH);
console.log('\n💾 Saved.');
