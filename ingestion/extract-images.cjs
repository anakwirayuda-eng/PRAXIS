/**
 * IMAGE PIPELINE — Hacks 1+2: Extract WorldMedQA-V images + NLP classify
 * 
 * - Downloads WorldMedQA-V from HuggingFace (568 questions with images)
 * - Converts base64 → WebP via Sharp (~25MB instead of 110MB)
 * - NLP auto-classifies image type from vignette text
 * - Tags phantom images (text says "see image" but no image)
 * 
 * Usage: node ingestion/extract-images.cjs
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const OUTPUT_DIR = path.join(__dirname, 'output');
const COMPILED = path.join(OUTPUT_DIR, 'compiled_cases.json');
const PUBLIC_COMPILED = path.join(__dirname, '..', 'public', 'data', 'compiled_cases.json');
const IMAGE_DIR = path.join(__dirname, '..', 'public', 'images', 'cases');

// Ensure image directory exists
if (!fs.existsSync(IMAGE_DIR)) {
  fs.mkdirSync(IMAGE_DIR, { recursive: true });
}

// ═══ Hack 2: NLP Image Classifier ═══
function classifyImageType(text) {
  const t = (text || '').toLowerCase();
  if (t.match(/(x-ray|xray|radiograph|chest film|ct scan|mri|rontgen|foto thorax|rontgen toraks)/))
    return { type: 'Radiology', emoji: '🩻', ui_mode: 'pacs_dark' };
  if (t.match(/(ecg|ekg|electrocardiogram|elektrokardiogram|irama jantung|gelombang p)/))
    return { type: 'ECG', emoji: '📈', ui_mode: 'light_grid' };
  if (t.match(/(usg|ultrasound|ultrasonografi|sonografi|janin|fetus|amnion)/))
    return { type: 'Ultrasound', emoji: '🤰', ui_mode: 'light' };
  if (t.match(/(histolog|biopsi|biopsy|smear|stain|microscop|patolog|preparat)/))
    return { type: 'Pathology', emoji: '🔬', ui_mode: 'light' };
  if (t.match(/(rash|lesi|lesion|eritema|erythema|makula|macule|ulkus|ulcer|papul|vesikel|kulit|skin|dermatos)/))
    return { type: 'Dermatology', emoji: '🖐️', ui_mode: 'light' };
  if (t.match(/(funduskopi|fundoscop|retina|optic disc)/))
    return { type: 'Ophthalmology', emoji: '👁️', ui_mode: 'pacs_dark' };
  return { type: 'Clinical Photo', emoji: '📸', ui_mode: 'light' };
}

// ═══ Hack 5 (bonus): Phantom Image Quarantine ═══
const PHANTOM_PATTERNS = [
  /perhatikan (gambar|foto|ekg|rontgen|usg|hasil)/i,
  /lihat (gambar|foto|image)/i,
  /berdasarkan (gambar|foto|ekg|rontgen)/i,
  /see (the )?(image|figure|photo|x-ray|ecg|scan)/i,
  /shown (below|above|here)/i,
  /following (image|figure|ecg|radiograph)/i,
];

function hasPhantomImageRef(text) {
  return PHANTOM_PATTERNS.some(p => p.test(text || ''));
}

// ═══ Hack 1: Sharp WebP Pipeline ═══
async function processBase64Image(base64Data, caseId, index) {
  try {
    // Handle data URI prefix
    const cleanBase64 = base64Data.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(cleanBase64, 'base64');
    const fileName = `${caseId}_${index}.webp`;
    const outPath = path.join(IMAGE_DIR, fileName);

    await sharp(buffer)
      .webp({ quality: 80 })
      .resize({ width: 1200, withoutEnlargement: true })
      .toFile(outPath);

    const stats = fs.statSync(outPath);
    return { fileName, sizeKB: Math.round(stats.size / 1024) };
  } catch (err) {
    console.log(`  ⚠️ Sharp error for case ${caseId}: ${err.message}`);
    return null;
  }
}

// ═══ MAIN: Download WorldMedQA-V + Process ═══
async function downloadWorldMedQA() {
  console.log('=== WorldMedQA-V Image Download ===\n');

  const PAGE_SIZE = 100;
  let offset = 0;
  let allRows = [];

  while (true) {
    const url = `https://datasets-server.huggingface.co/rows?dataset=WorldMedQA/V&config=default&split=train&offset=${offset}&length=${PAGE_SIZE}`;
    console.log(`  Fetching offset ${offset}...`);
    const res = await fetch(url);
    const data = await res.json();
    if (!data.rows || data.rows.length === 0) break;
    allRows = allRows.concat(data.rows.map(r => r.row));
    if (data.rows.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  console.log(`  Total: ${allRows.length} questions\n`);
  return allRows;
}

(async () => {
  console.log('=== IMAGE PIPELINE ===\n');

  // Load existing dataset
  let cases = JSON.parse(fs.readFileSync(COMPILED, 'utf-8'));
  console.log(`Existing cases: ${cases.length.toLocaleString()}\n`);

  // 1. Download & inject WorldMedQA-V
  let wmqAdded = 0, imagesExtracted = 0;
  try {
    const wmqRows = await downloadWorldMedQA();
    
    for (const row of wmqRows) {
      // Extract country from row
      const country = (row.Country || row.country || '').toUpperCase();
      const countryTag = { 'BRAZIL': 'BR', 'JAPAN': 'JP', 'SPAIN': 'ES', 'ISRAEL': 'IL' }[country] || country.substring(0, 2);
      
      // Extract question text (English translation)
      const questionEn = row.Question_EN || row.question_en || row.Question || '';
      if (!questionEn || questionEn.length < 10) continue;

      // Extract options
      const opts = [];
      for (const letter of ['A', 'B', 'C', 'D', 'E']) {
        const optText = row[`Option_${letter}_EN`] || row[`option_${letter}_en`] || row[`Option_${letter}`] || row[`option_${letter}`];
        if (optText) opts.push({ id: letter, text: optText });
      }
      if (opts.length < 2) continue;

      // Correct answer
      const correctLetter = (row.Correct_Answer || row.correct_answer || 'A').toUpperCase();

      const caseId = 990000 + wmqAdded;
      const imageFiles = [];

      // Extract image if present
      if (row.image?.src || row.Image?.src) {
        const imgSrc = row.image?.src || row.Image?.src;
        if (imgSrc && imgSrc.startsWith('data:')) {
          const result = await processBase64Image(imgSrc, `wmqa_${countryTag}_${caseId}`, 0);
          if (result) {
            imageFiles.push(result.fileName);
            imagesExtracted++;
          }
        }
      }

      // NLP classify
      const imgClass = classifyImageType(questionEn);

      cases.push({
        _id: caseId,
        hash_id: `worldmedqa_${countryTag}_${wmqAdded}`,
        q_type: 'MCQ',
        confidence: 4.0,
        category: imgClass.type === 'ECG' ? 'Cardiology' : imgClass.type === 'Radiology' ? 'Radiology' : 'General Medicine',
        title: questionEn.substring(0, 80) + (questionEn.length > 80 ? '...' : ''),
        vignette: { demographics: { age: null, sex: null }, narrative: questionEn },
        prompt: '',
        options: opts.map(o => ({ ...o, is_correct: o.id === correctLetter })),
        rationale: { correct: row.Explanation_EN || row.explanation_en || '', distractors: {} },
        images: imageFiles,
        imageType: imageFiles.length > 0 ? imgClass : null,
        meta: {
          source: 'worldmedqa', sourceLabel: `WMedQA-${countryTag}`,
          examType: 'BOTH', difficulty: 3,
          country, requiresImage: imageFiles.length > 0,
        },
        validation: {
          overallScore: 4.0,
          layers: { content: 4, answer: 4, format: 4, image: imageFiles.length > 0 ? 4 : 5, explanation: 3, source: 4 },
          standard: 'worldmedqa-v',
          warnings: [],
        },
      });
      wmqAdded++;
    }
  } catch (err) {
    console.log(`WorldMedQA download error: ${err.message}`);
  }
  console.log(`WorldMedQA: ${wmqAdded} added, ${imagesExtracted} images extracted\n`);

  // 2. NLP classify + phantom detect on ALL existing cases
  let phantomCount = 0, classified = 0;
  for (const c of cases) {
    const text = c.vignette?.narrative || c.title || '';
    
    // Phantom image detection
    if (hasPhantomImageRef(text) && (!c.images || c.images.length === 0)) {
      if (!c.validation) c.validation = {};
      if (!c.validation.warnings) c.validation.warnings = [];
      if (!c.validation.warnings.includes('phantom_image')) {
        c.validation.warnings.push('phantom_image');
        phantomCount++;
      }
    }

    // NLP classify for cases that already have images
    if (c.images && c.images.length > 0 && !c.imageType) {
      c.imageType = classifyImageType(text);
      classified++;
    }
  }
  console.log(`Phantom image refs detected: ${phantomCount}`);
  console.log(`Image types classified: ${classified}\n`);

  // Save
  fs.writeFileSync(COMPILED, JSON.stringify(cases), 'utf-8');
  fs.copyFileSync(COMPILED, PUBLIC_COMPILED);

  console.log(`Total cases: ${cases.length.toLocaleString()}`);
  console.log(`Cases with images: ${cases.filter(c => c.images?.length > 0).length}`);
  console.log(`Phantom image warnings: ${phantomCount}`);
  console.log('Done!');
})();
