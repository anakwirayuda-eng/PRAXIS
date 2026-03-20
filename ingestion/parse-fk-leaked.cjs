/**
 * FK Leaked UKMPPD Parser + Category Normalizer + Global Dedup
 * 
 * 1. Parse 19 BANK SOAL UKMPPD PDFs (skip [BOOK] 1001)
 * 2. Normalize all 175 categories → ~20 standard UKMPPD categories
 * 3. Deduplicate by vignette similarity across entire dataset
 */
const fs = require('fs');
const path = require('path');

const FK_DIR = 'C:\\Users\\USER\\Downloads\\FK Leaked-20260316T142835Z-3-001\\FK Leaked';
const OUTPUT = path.join(__dirname, 'output');

// === CATEGORY NORMALIZER ===
const CATEGORY_MAP = {
  // Standard UKMPPD categories
  'cardiology': 'Kardiologi',
  'Cardiology': 'Kardiologi',
  'Cardiovascular': 'Kardiologi',
  'cardiovascular pharmacology': 'Kardiologi',
  'Pediatric Cardiology': 'Kardiologi',
  
  'pulmonology': 'Pulmonologi',
  'Pulmonology': 'Pulmonologi',
  'respiratory medicine': 'Pulmonologi',
  'respiratory physiology': 'Pulmonologi',
  
  'neurology': 'Neurologi',
  'Neurology': 'Neurologi',
  'Neurosurgery': 'Neurologi',
  'epilepsy treatment': 'Neurologi',
  
  'pediatrics': 'Pediatri',
  'Pediatrics': 'Pediatri',
  'Pediatric Surgery': 'Pediatri',
  'Pediatric Nephrology': 'Pediatri',
  
  'obgyn': 'Obstetri & Ginekologi',
  'Obstetrics and Gynecology': 'Obstetri & Ginekologi',
  'Obstetrics & Gynecology': 'Obstetri & Ginekologi',
  'obstetrics': 'Obstetri & Ginekologi',
  'prenatal diagnosis': 'Obstetri & Ginekologi',
  'Andrology': 'Obstetri & Ginekologi',
  
  'dermatology': 'Dermatovenereologi',
  'Dermatology': 'Dermatovenereologi',
  'Dermatovenereology': 'Dermatovenereologi',
  'Dermatology and Venereology': 'Dermatovenereologi',
  
  'ophthalmology': 'Mata',
  'Ophthalmology': 'Mata',
  
  'psychiatry': 'Psikiatri',
  'Psychiatry': 'Psikiatri',
  'psychopharmacology': 'Psikiatri',
  
  'surgery': 'Bedah',
  'Surgery': 'Bedah',
  'General Surgery': 'Bedah',
  'Orthopedic Surgery': 'Bedah',
  'Orthopedics': 'Bedah',
  'orthopedics': 'Bedah',
  'Orthopedic Oncology': 'Bedah',
  'Vascular Surgery': 'Bedah',
  'osteology': 'Bedah',
  
  'nephrology': 'Nefrologi',
  'Nephrology': 'Nefrologi',
  'renal physiology': 'Nefrologi',
  'acid-base disorders': 'Nefrologi',
  'Urology': 'Nefrologi',
  'urology': 'Nefrologi',
  'rheumatology': 'Nefrologi',
  'Rheumatology': 'Nefrologi',
  
  'gastroenterology': 'Gastroenterohepatologi',
  'Gastroenterology': 'Gastroenterohepatologi',
  'hepatology': 'Gastroenterohepatologi',
  'Hepatology': 'Gastroenterohepatologi',
  'liver disease': 'Gastroenterohepatologi',
  'viral hepatitis': 'Gastroenterohepatologi',
  'Internal Medicine - Gastroenterology/Hepatology': 'Gastroenterohepatologi',
  
  'endocrinology': 'Endokrinologi',
  'Endocrinology': 'Endokrinologi',
  'diabetes management': 'Endokrinologi',
  'diabetes': 'Endokrinologi',
  'lipid metabolism': 'Endokrinologi',
  'lipidology': 'Endokrinologi',
  'metabolism': 'Endokrinologi',
  
  'hematology': 'Hematologi & Infeksi',
  'Hematology': 'Hematologi & Infeksi',
  'hemostasis': 'Hematologi & Infeksi',
  'transfusion medicine': 'Hematologi & Infeksi',
  'immunology': 'Hematologi & Infeksi',
  'Immunology': 'Hematologi & Infeksi',
  'immunology/pharmacology': 'Hematologi & Infeksi',
  'Allergy and Immunology': 'Hematologi & Infeksi',
  'infectious diseases': 'Hematologi & Infeksi',
  'infectious disease': 'Hematologi & Infeksi',
  'Infectious Disease': 'Hematologi & Infeksi',
  'Infectious Diseases': 'Hematologi & Infeksi',
  'infection control': 'Hematologi & Infeksi',
  'Tropical Medicine': 'Hematologi & Infeksi',
  'vaccinology': 'Hematologi & Infeksi',
  'Vaccinology': 'Hematologi & Infeksi',
  'vaccination': 'Hematologi & Infeksi',
  'parasitology': 'Hematologi & Infeksi',
  'Parasitology': 'Hematologi & Infeksi',
  'mycology': 'Hematologi & Infeksi',
  'virology': 'Hematologi & Infeksi',
  'microbiology': 'Hematologi & Infeksi',
  'Microbiology': 'Hematologi & Infeksi',
  'medical microbiology': 'Hematologi & Infeksi',
  'antibiotics': 'Hematologi & Infeksi',
  
  'pharmacology': 'Farmakologi',
  'Pharmacology': 'Farmakologi',
  'pharmacy': 'Farmakologi',
  'Pharmacy': 'Farmakologi',
  'pharmacokinetics': 'Farmakologi',
  'pharmaceutical sciences': 'Farmakologi',
  'pharmaceutical analysis': 'Farmakologi',
  'pharmaceutical chemistry': 'Farmakologi',
  'pharmaceutical science': 'Farmakologi',
  'pharmaceutics': 'Farmakologi',
  'pharmacovigilance': 'Farmakologi',
  'clinical pharmacy': 'Farmakologi',
  'nuclear pharmacy': 'Farmakologi',
  'pain management': 'Farmakologi',
  
  'anatomy': 'Anatomi & Fisiologi',
  'physiology': 'Anatomi & Fisiologi',
  'vascular physiology': 'Anatomi & Fisiologi',
  'medical terminology': 'Anatomi & Fisiologi',
  
  'forensics': 'Forensik & Medikolegal',
  'Forensic Medicine': 'Forensik & Medikolegal',
  'bioethics': 'Forensik & Medikolegal',
  'Medical Ethics': 'Forensik & Medikolegal',
  'Medical Ethics and Law': 'Forensik & Medikolegal',
  
  'ent': 'THT-KL',
  'Otorhinolaryngology': 'THT-KL',
  
  'public-health': 'IKM & Kesmas',
  'Public Health': 'IKM & Kesmas',
  'public health': 'IKM & Kesmas',
  'epidemiology': 'IKM & Kesmas',
  'preventive medicine': 'IKM & Kesmas',
  'Preventive and Community Medicine': 'IKM & Kesmas',
  'Family Medicine': 'IKM & Kesmas',
  'healthcare administration': 'IKM & Kesmas',
  'Occupational Medicine': 'IKM & Kesmas',
  'biostatistics': 'IKM & Kesmas',
  'Biostatistics': 'IKM & Kesmas',
  'medical statistics': 'IKM & Kesmas',
  'statistics in medicine': 'IKM & Kesmas',
  'statistics in medical research': 'IKM & Kesmas',
  'statistical inference': 'IKM & Kesmas',
  'statistical methods': 'IKM & Kesmas',
  'statistical analysis in pharmacy': 'IKM & Kesmas',
  'Medical Education': 'IKM & Kesmas',
  'nutrition': 'IKM & Kesmas',
  
  'emergency': 'Anestesi & Emergency',
  'Emergency Medicine': 'Anestesi & Emergency',
  'emergency medicine': 'Anestesi & Emergency',
  'Emergency medicine': 'Anestesi & Emergency',
  'critical care medicine': 'Anestesi & Emergency',
  'Anesthesiology': 'Anestesi & Emergency',
  
  'dentistry': 'Kedokteran Gigi',
  
  'oncology': 'Onkologi',
  'Oncology': 'Onkologi',
  'radiation oncology': 'Onkologi',
  
  'internal-medicine': 'Ilmu Penyakit Dalam',
  'Internal Medicine': 'Ilmu Penyakit Dalam',
  'internal medicine': 'Ilmu Penyakit Dalam',
  'General Medicine': 'Ilmu Penyakit Dalam',
  'medical specialty': 'Ilmu Penyakit Dalam',
  'inflammation': 'Ilmu Penyakit Dalam',
  
  'toxicology': 'Farmakologi',
  'Toxicology': 'Farmakologi',
  'toxology': 'Farmakologi',
  
  'Radiology': 'Radiologi',
  'nuclear medicine': 'Radiologi',
  'radiation safety': 'Radiologi',
  'nuclear chemistry': 'Radiologi',
  'nuclear physics': 'Radiologi',
  'Clinical Pathology': 'Patologi',
  'clinical pathology': 'Patologi',
  
  'biochemistry': 'Biokimia',
  'medical biochemistry': 'Biokimia',
  'clinical biochemistry': 'Biokimia',
  'clinical chemistry': 'Biokimia',
  'analytical chemistry': 'Biokimia',
  'chromatography': 'Biokimia',
  'spectrophotometry': 'Biokimia',
  'spectrofluorimetry': 'Biokimia',
  'spectroscopy': 'Biokimia',
  'electrochemistry': 'Biokimia',
  'organic chemistry': 'Biokimia',
  'molecular biology': 'Biokimia',
  'genetics': 'Biokimia',
  'Genetics': 'Biokimia',
  'medical genetics': 'Biokimia',
  'physics': 'Biokimia',
  
  'Physical Medicine and Rehabilitation': 'Rehabilitasi Medik',
};

// File-to-category mapping for FK Leaked (department-specific PDFs)
const FK_FILE_CATEGORY = {
  'ANESTESI': 'Anestesi & Emergency',
  'BEDAH': 'Bedah',
  'ENDOKRINOLOGI': 'Endokrinologi',
  'FORENSIK': 'Forensik & Medikolegal',
  'GASTROENTEROHEPATOLOGI': 'Gastroenterohepatologi',
  'HEMATOIMUNO': 'Hematologi & Infeksi',
  'IKM': 'IKM & Kesmas',
  'INTEGUMEN': 'Dermatovenereologi',
  'KARDIOLOGI': 'Kardiologi',
  'MATA': 'Mata',
  'NEFROLOGI': 'Nefrologi',
  'OBSGYN': 'Obstetri & Ginekologi',
  'OBSTETRI': 'Obstetri & Ginekologi',
  'PSIKIATRI': 'Psikiatri',
  'PULMONOLOGI': 'Pulmonologi',
  'SARAF': 'Neurologi',
  'THT': 'THT-KL',
  'PEDIATRI': 'Pediatri',
};

function getCategoryFromFilename(filename) {
  for (const [key, cat] of Object.entries(FK_FILE_CATEGORY)) {
    if (filename.toUpperCase().includes(key)) return cat;
  }
  return 'Ilmu Penyakit Dalam';
}

function normalizeCategory(cat) {
  return CATEGORY_MAP[cat] || cat;
}

(async () => {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  
  console.log('═══ FK Leaked Parser + Category Normalizer + Dedup ═══\n');
  
  // === STEP 1: Parse FK Leaked PDFs ===
  const files = fs.readdirSync(FK_DIR)
    .filter(f => f.toLowerCase().endsWith('.pdf') && !f.includes('[BOOK]'));
  
  console.log(`📂 FK Leaked: ${files.length} PDFs (skipping [BOOK])\n`);
  
  const fkQuestions = [];
  
  for (const file of files) {
    const filePath = path.join(FK_DIR, file);
    const category = getCategoryFromFilename(file);
    process.stdout.write(`  ${file.substring(0, 55).padEnd(55)} `);
    
    try {
      const buf = new Uint8Array(fs.readFileSync(filePath));
      const doc = await getDocument({ data: buf, useSystemFonts: true }).promise;
      
      // Extract all text
      let fullText = '';
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        fullText += content.items.map(item => item.str).join(' ') + '\n';
      }
      
      // Parse questions — try multiple strategies
      const questions = [];
      
      // Strategy: split on numbered patterns
      const blocks = fullText.split(/(?:\n|^|\s{2,})(\d{1,3})\s*[.)]\s+/);
      for (let i = 1; i < blocks.length - 1; i += 2) {
        const num = blocks[i];
        const body = (blocks[i + 1] || '').trim();
        if (body.length < 25) continue;
        
        let optParts = body.split(/\n\s*([A-E])\s*[.)]\s*/);
        if (optParts.length < 5) optParts = body.split(/\s{2,}([A-E])\s*[.)]\s*/);
        if (optParts.length < 5) optParts = body.split(/\s+([A-E])\.\s+/);
        if (optParts.length < 7) continue;
        
        const vignette = optParts[0].replace(/\s+/g, ' ').trim();
        if (vignette.length < 15) continue;
        
        const options = [];
        for (let j = 1; j < optParts.length - 1; j += 2) {
          const letter = optParts[j];
          if (!/^[A-E]$/.test(letter)) continue;
          let text = optParts[j + 1].split('\n')[0].replace(/\s+/g, ' ')
            .replace(/\s*(?:Jawaban|Kunci|KUNCI|Pembahasan).*$/i, '').trim();
          if (text.length > 0 && !options.find(o => o.id === letter)) {
            options.push({ id: letter, text, is_correct: false });
          }
        }
        
        if (options.length < 3) continue;
        
        // Look for embedded answer key
        const ansMatch = body.match(/(?:Jawaban|Kunci|KUNCI|Answer)\s*[:\-=]\s*([A-E])\b/i);
        if (ansMatch) {
          for (const opt of options) opt.is_correct = opt.id === ansMatch[1];
        }
        
        questions.push({
          num: parseInt(num),
          vignette,
          options,
          category, // from filename!
          source: 'fk-leaked-ukmppd',
        });
      }
      
      // Try numbered key extraction
      const keys = {};
      for (const m of fullText.matchAll(/(\d{1,3})\s*[.):\-]\s*([A-E])\b/g)) {
        keys[parseInt(m[1])] = m[2];
      }
      for (const q of questions) {
        if (!q.options.some(o => o.is_correct) && keys[q.num]) {
          for (const opt of q.options) opt.is_correct = opt.id === keys[q.num];
        }
      }
      
      const keyed = questions.filter(q => q.options.some(o => o.is_correct)).length;
      console.log(`${questions.length} Qs, ${keyed} keyed → ${category}`);
      fkQuestions.push(...questions);
    } catch (e) {
      console.log(`❌ ${e.message?.substring(0, 40)}`);
    }
  }
  
  console.log(`\nFK Leaked total: ${fkQuestions.length} questions`);
  
  // === STEP 2: Load master dataset + normalize ALL categories ===
  console.log('\n📝 Loading master dataset...');
  const cases = JSON.parse(fs.readFileSync(path.join(OUTPUT, 'compiled_cases.json'), 'utf8'));
  console.log(`Master before: ${cases.length}`);
  
  // Normalize existing categories
  let catFixed = 0;
  for (const c of cases) {
    const norm = normalizeCategory(c.category);
    if (norm !== c.category) {
      c.category = norm;
      catFixed++;
    }
  }
  console.log(`Categories normalized: ${catFixed} cases updated`);
  
  // === STEP 3: Inject FK Leaked with dedup ===
  const existingKeys = new Set();
  for (const c of cases) {
    const vig = (c.vignette?.narrative || '')
      .replace(/F\s*U\s*T\s*U\s*R\s*E.+?\.C\s*O\s*M/gi, '')
      .trim().substring(0, 200).toLowerCase().replace(/\s+/g, ' ');
    if (vig.length > 10) existingKeys.add(vig);
  }
  
  let sid = cases.length, added = 0, dup = 0;
  for (const q of fkQuestions) {
    const key = q.vignette.substring(0, 200).toLowerCase().replace(/\s+/g, ' ');
    if (existingKeys.has(key)) { dup++; continue; }
    existingKeys.add(key);
    
    cases.push({
      _id: sid++,
      q_type: 'MCQ',
      category: q.category,
      title: q.vignette.substring(0, 80) + '...',
      vignette: { narrative: q.vignette, demographics: {} },
      prompt: 'Pilih jawaban yang paling tepat.',
      options: q.options,
      rationale: { correct: '', distractors: {} },
      meta: {
        source: q.source,
        examType: 'UKMPPD',
        difficulty: 2,
        tags: ['FK Leaked', 'Bank Soal', q.category],
      },
    });
    added++;
  }
  
  // === STEP 4: Final category distribution ===
  const catDist = {};
  for (const c of cases) catDist[c.category] = (catDist[c.category] || 0) + 1;
  
  console.log('\n═══ NORMALIZED CATEGORIES ═══');
  for (const [k, v] of Object.entries(catDist).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(30)} ${v}`);
  }
  console.log(`Total categories: ${Object.keys(catDist).length}`);
  
  // === STEP 5: Atomic save ===
  const tmp1 = path.join(OUTPUT, 'compiled_cases.json.tmp');
  fs.writeFileSync(tmp1, JSON.stringify(cases), 'utf-8');
  fs.renameSync(tmp1, path.join(OUTPUT, 'compiled_cases.json'));
  
  const fc = cases.filter(c => !c.meta?.quarantined && !c.meta?.quarantine_flag);
  const tmp2 = path.join(__dirname, '..', 'public', 'data', 'compiled_cases.json.tmp');
  fs.writeFileSync(tmp2, JSON.stringify(fc), 'utf-8');
  fs.renameSync(tmp2, path.join(__dirname, '..', 'public', 'data', 'compiled_cases.json'));
  
  console.log('\n═══ FINAL ═══');
  console.log(`FK Leaked: ${fkQuestions.length} parsed, ${added} new, ${dup} dupes`);
  console.log(`Master: ${cases.length.toLocaleString()}`);
  console.log(`Frontend: ${fc.length.toLocaleString()}`);
})();
