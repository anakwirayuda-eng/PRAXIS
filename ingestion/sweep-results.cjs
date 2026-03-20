/**
 * Download ALL completed batch results + Fix WorldMedQA-V + Convert PNG→WebP
 * Unified script for the full pipeline sweep
 * 
 * Usage: node ingestion/sweep-results.cjs
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const envFile = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf-8');
const API_KEY = envFile.match(/OPENAI_API_KEY=(.+)/)?.[1]?.trim();
const OUTPUT_DIR = path.join(__dirname, 'output');
const COMPILED = path.join(OUTPUT_DIR, 'compiled_cases.json');
const PUBLIC_COMPILED = path.join(__dirname, '..', 'public', 'data', 'compiled_cases.json');
const IMAGE_DIR = path.join(__dirname, '..', 'public', 'images', 'cases');

async function downloadBatchOutput(batchId) {
  const batchRes = await fetch(`https://api.openai.com/v1/batches/${batchId}`,
    { headers: { 'Authorization': `Bearer ${API_KEY}` } });
  const batch = await batchRes.json();
  if (!batch.output_file_id || batch.status !== 'completed') return null;
  const fileRes = await fetch(`https://api.openai.com/v1/files/${batch.output_file_id}/content`,
    { headers: { 'Authorization': `Bearer ${API_KEY}` } });
  return (await fileRes.text()).trim().split('\n').map(line => {
    try {
      const obj = JSON.parse(line);
      const content = obj.response?.body?.choices?.[0]?.message?.content;
      let parsed = null;
      try { parsed = JSON.parse(content); } catch {}
      return { custom_id: obj.custom_id, parsed, raw: content };
    } catch { return null; }
  }).filter(Boolean);
}

(async () => {
  console.log('=== SWEEP: Download Results + Fix Data + Convert Images ===\n');

  const manifest = JSON.parse(fs.readFileSync(path.join(OUTPUT_DIR, 'god_tier_batches.json'), 'utf-8'));
  let cases = JSON.parse(fs.readFileSync(COMPILED, 'utf-8'));
  const caseMap = new Map(cases.map(c => [String(c._id), c]));

  // ═══ 1. Download hack1_chunk4 results ═══
  if (manifest.batches.hack1_chunk4) {
    console.log('--- Hack 1 Chunk 4 ---');
    const results = await downloadBatchOutput(manifest.batches.hack1_chunk4);
    if (results) {
      let fatal = 0, minor = 0, none = 0;
      for (const r of results) {
        if (!r.parsed) continue;
        const caseId = r.custom_id.replace('fase2_', '');
        const c = caseMap.get(caseId);
        if (!c) continue;
        const sev = (r.parsed.severity || '').toUpperCase();
        if (!c.meta) c.meta = {};
        c.meta.fase2_verdict = sev;
        c.meta.fase2_reasoning = r.parsed.reasoning || '';
        if (sev === 'FATAL') { fatal++; c.meta.fase2_quarantine = true; if (r.parsed.correct_answer) c.meta.fase2_suggested_answer = r.parsed.correct_answer; }
        else if (sev === 'MINOR') minor++;
        else none++;
      }
      console.log(`  FATAL=${fatal}, MINOR=${minor}, NONE=${none}`);
    }
  }

  // ═══ 2. Download Mission 3: FrMedMCQA Translation ═══
  if (manifest.batches.mission3_translate) {
    console.log('\n--- Mission 3: FrMedMCQA Translation ---');
    const results = await downloadBatchOutput(manifest.batches.mission3_translate);
    if (results) {
      let updated = 0, errors = 0;
      for (const r of results) {
        if (!r.parsed) { errors++; continue; }
        const caseId = r.custom_id.replace('translate_', '');
        const c = caseMap.get(caseId);
        if (!c) continue;
        
        // Inject English translation
        if (r.parsed.question) {
          c.vignette.narrative_original = c.vignette.narrative; // Keep French 
          c.vignette.narrative = r.parsed.question; // Replace with English
          c.title = r.parsed.question.substring(0, 80) + (r.parsed.question.length > 80 ? '...' : '');
        }
        if (r.parsed.options) {
          for (const opt of c.options) {
            const translated = r.parsed.options[opt.id] || r.parsed.options[opt.id.toLowerCase()];
            if (translated) {
              opt.text_original = opt.text;
              opt.text = translated;
            }
          }
        }
        if (r.parsed.category) c.category = r.parsed.category;
        c.meta.translated = true;
        c.meta.translatedFrom = 'fr';
        updated++;
      }
      console.log(`  Translated: ${updated}, Errors: ${errors}`);
    }
  }

  // ═══ 3. Download Mission 4: UKMPPD PDF Answer Keys ═══
  if (manifest.batches.mission4_ukmppd_pdf) {
    console.log('\n--- Mission 4: UKMPPD PDF Answer Keys ---');
    const results = await downloadBatchOutput(manifest.batches.mission4_ukmppd_pdf);
    if (results) {
      let updated = 0, improved = 0;
      for (const r of results) {
        if (!r.parsed) continue;
        const caseId = r.custom_id.replace('ukmppd_pdf_oracle_', '');
        const c = caseMap.get(caseId);
        if (!c) continue;

        if (r.parsed.correct_answer) {
          const cl = r.parsed.correct_answer.toUpperCase();
          for (const opt of c.options) opt.is_correct = opt.id === cl;
          c.meta.hasVerifiedAnswer = true;
          c.meta.answerSource = 'gpt-5.4-oracle';
          c.confidence = r.parsed.confidence || 4.0;
          c.validation.layers.answer = 4;
        }
        if (r.parsed.explanation) {
          c.rationale.correct = r.parsed.explanation;
          c.validation.layers.explanation = 4;
        }
        if (r.parsed.improved_vignette && r.parsed.improved_vignette !== 'null') {
          c.vignette.narrative = r.parsed.improved_vignette;
          c.title = r.parsed.improved_vignette.substring(0, 80) + '...';
          improved++;
        }
        if (r.parsed.category) c.category = r.parsed.category;
        updated++;
      }
      console.log(`  Updated: ${updated}, Vignettes improved: ${improved}`);
    }
  }

  // ═══ 4. Fix WorldMedQA-V — re-download with correct field names ═══
  console.log('\n--- WorldMedQA-V Fix ---');
  let wmqAdded = 0, wmqImages = 0;
  const existingWmq = new Set(cases.filter(c => c.meta?.source === 'worldmedqa').map(c => c.hash_id));
  
  try {
    const PAGE = 100;
    let offset = 0;
    let nextId = 990000 + cases.filter(c => c._id >= 990000).length;

    while (true) {
      const res = await fetch(`https://datasets-server.huggingface.co/rows?dataset=WorldMedQA/V&config=default&split=train&offset=${offset}&length=${PAGE}`);
      const data = await res.json();
      if (!data.rows || data.rows.length === 0) break;

      for (const { row } of data.rows) {
        const q = row.question || '';
        if (q.length < 10) continue;
        const hashId = `worldmedqa_${row.index || offset}`;
        if (existingWmq.has(hashId)) continue;

        const opts = [];
        for (const l of ['A', 'B', 'C', 'D', 'E']) {
          if (row[l]) opts.push({ id: l, text: row[l], is_correct: l === (row.correct_option || '').toUpperCase() });
        }
        if (opts.length < 2) continue;

        const imageFiles = [];
        // Image is raw base64 string (not object)
        if (row.image && typeof row.image === 'string' && row.image.length > 100) {
          try {
            const cleanB64 = row.image.replace(/^data:image\/\w+;base64,/, '');
            const buf = Buffer.from(cleanB64, 'base64');
            const fname = `wmqa_${nextId}_0.webp`;
            await sharp(buf).webp({ quality: 80 }).resize({ width: 1200, withoutEnlargement: true }).toFile(path.join(IMAGE_DIR, fname));
            imageFiles.push(fname);
            wmqImages++;
          } catch {}
        }

        cases.push({
          _id: nextId++,
          hash_id: hashId,
          q_type: 'MCQ',
          confidence: 4.0,
          category: 'General Medicine',
          title: q.substring(0, 80) + (q.length > 80 ? '...' : ''),
          vignette: { demographics: { age: null, sex: null }, narrative: q },
          prompt: '',
          options: opts,
          rationale: { correct: '', distractors: {} },
          images: imageFiles,
          meta: {
            source: 'worldmedqa', sourceLabel: 'WMedQA',
            examType: 'BOTH', difficulty: 3,
            requiresImage: imageFiles.length > 0,
          },
          validation: {
            overallScore: 4.0,
            layers: { content: 4, answer: 4, format: 4, image: imageFiles.length > 0 ? 4 : 5, explanation: 1, source: 4 },
            standard: 'worldmedqa-v', warnings: [],
          },
        });
        wmqAdded++;
        existingWmq.add(hashId);
      }

      if (data.rows.length < PAGE) break;
      offset += PAGE;
      if (offset % 500 === 0) console.log(`  Offset ${offset}...`);
    }
  } catch (err) {
    console.log(`  WorldMedQA error: ${err.message}`);
  }
  console.log(`  Added: ${wmqAdded}, Images: ${wmqImages}`);

  // ═══ 5. Convert 936 PNG → WebP ═══
  console.log('\n--- PNG → WebP Conversion ---');
  const pngs = fs.readdirSync(IMAGE_DIR).filter(f => f.endsWith('.png'));
  let converted = 0;
  for (const png of pngs) {
    try {
      const inPath = path.join(IMAGE_DIR, png);
      const outPath = path.join(IMAGE_DIR, png.replace('.png', '.webp'));
      await sharp(inPath).webp({ quality: 80 }).resize({ width: 1200, withoutEnlargement: true }).toFile(outPath);
      fs.unlinkSync(inPath); // Delete original PNG
      converted++;
    } catch {}
  }
  console.log(`  Converted: ${converted} PNGs → WebP`);

  // Save
  fs.writeFileSync(COMPILED, JSON.stringify(cases), 'utf-8');
  fs.copyFileSync(COMPILED, PUBLIC_COMPILED);

  const allAudited = cases.filter(c => c.meta?.fase2_verdict);
  const allFatal = allAudited.filter(c => c.meta?.fase2_verdict === 'FATAL');
  const translated = cases.filter(c => c.meta?.translated);
  const withImages = cases.filter(c => c.images?.length > 0);
  const verified = cases.filter(c => c.meta?.hasVerifiedAnswer);

  console.log('\n=== FINAL STATUS ===');
  console.log(`Total cases: ${cases.length.toLocaleString()}`);
  console.log(`FASE 2 audited: ${allAudited.length} (FATAL: ${allFatal.length} = ${(allFatal.length/Math.max(allAudited.length,1)*100).toFixed(1)}%)`);
  console.log(`FrMedMCQA translated: ${translated.length}`);
  console.log(`UKMPPD verified answers: ${verified.length}`);
  console.log(`Cases with images: ${withImages.length}`);
  console.log(`WebP images in folder: ${fs.readdirSync(IMAGE_DIR).filter(f => f.endsWith('.webp')).length}`);
  console.log('Done!');
})();
