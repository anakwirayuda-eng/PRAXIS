/**
 * Download & Ingest 4 Qualified Datasets
 * 
 * 1. Polish LDEK EN (2,726) — already English, direct inject
 * 2. Nano1337 Medical MCQs (400) — already English, direct inject
 * 3. MedQA Mainland China (3,426) — needs CN→ID translation batch
 * 4. Greek Medical MCQA (2,034) — needs GR→ID translation batch
 */
const fs = require('fs');
const path = require('path');

const HF_TOKEN = process.env.HF_TOKEN || 'YOUR_HF_TOKEN_HERE';
const OUTPUT = path.join(__dirname, 'output');

async function fetchAllRows(dataset, split, maxRows) {
  const rows = [];
  const PAGE = 100;
  for (let offset = 0; offset < maxRows; offset += PAGE) {
    const url = `https://datasets-server.huggingface.co/rows?dataset=${encodeURIComponent(dataset)}&config=default&split=${split}&offset=${offset}&length=${PAGE}`;
    const r = await fetch(url, { headers: { 'Authorization': `Bearer ${HF_TOKEN}` } });
    const d = await r.json();
    if (!d.rows || d.rows.length === 0) break;
    for (const row of d.rows) rows.push(row.row);
    process.stdout.write(`\r  ${rows.length} rows...`);
  }
  console.log(`\r  Got: ${rows.length} rows`);
  return rows;
}

function guessCategory(t) {
  t = t.toLowerCase();
  if (/cardio|heart|ecg|ekg|murmur|atrial|ventricul|coronary|myocard/i.test(t)) return 'cardiology';
  if (/pulmon|lung|pneumon|asthma|copd|bronch|respiratory/i.test(t)) return 'pulmonology';
  if (/neuro|brain|stroke|seizure|epilep|meningit|cerebr/i.test(t)) return 'neurology';
  if (/paediatric|pediatric|child|neonat|infant|newborn/i.test(t)) return 'pediatrics';
  if (/obstetric|gynae|gynec|pregnan|labour|fetus|contracept/i.test(t)) return 'obgyn';
  if (/derma|skin|rash|eczema|psoriasis/i.test(t)) return 'dermatology';
  if (/ophthalm|eye|visual|cataract|glaucoma|retina/i.test(t)) return 'ophthalmology';
  if (/ent|ear|nose|throat|otitis|tonsil/i.test(t)) return 'ent';
  if (/psychiatr|depress|anxiety|schizophren|bipolar/i.test(t)) return 'psychiatry';
  if (/surg|fractur|wound|trauma|hernia|appendic|orthop/i.test(t)) return 'surgery';
  if (/renal|kidney|nephro|uret|creatin|dialys/i.test(t)) return 'nephrology';
  if (/gastro|liver|hepat|bowel|colon|pancrea|esophag/i.test(t)) return 'gastroenterology';
  if (/diabet|thyroid|endocrin|insulin|adrenal|pituitar/i.test(t)) return 'endocrinology';
  if (/anaemia|anemia|haematol|platelet|coagul|leukemia/i.test(t)) return 'hematology';
  if (/forens|autopsy|medico.?legal/i.test(t)) return 'forensics';
  if (/pharmaco|drug|dose|adverse|receptor/i.test(t)) return 'pharmacology';
  if (/anatomy|muscle|nerve|artery|vein|bone|ligament/i.test(t)) return 'anatomy';
  if (/micro|bacteri|virus|fungal|parasit|infection/i.test(t)) return 'microbiology';
  if (/dental|tooth|oral|gingiv|periodon/i.test(t)) return 'dentistry';
  return 'internal-medicine';
}

(async () => {
  console.log('═══ Download & Ingest New Datasets ═══\n');
  
  const cases = JSON.parse(fs.readFileSync(path.join(OUTPUT, 'compiled_cases.json'), 'utf-8'));
  let startId = cases.length;
  let totalAdded = 0;

  // ═══════════════════════════════════════
  // 1. Polish LDEK EN (2,726) — DIRECT INJECT
  // ═══════════════════════════════════════
  console.log('1. Polish LDEK EN...');
  const polishRows = await fetchAllRows('amu-cai/medical-exams-LDEK-EN-2013-2024', 'train', 3000);
  fs.writeFileSync(path.join(OUTPUT, 'polish_ldek_raw.json'), JSON.stringify(polishRows));
  
  let polishAdded = 0;
  for (const row of polishRows) {
    // Format: question_w_options has question + options inline, answer is letter
    const qText = row.question_w_options || '';
    if (qText.length < 20) continue;
    
    // Parse: split by \nA. \nB. etc
    const optMatch = qText.split(/\n([A-E])\.\s*/);
    const vignette = optMatch[0]?.trim() || qText;
    
    const options = [];
    for (let i = 1; i < optMatch.length - 1; i += 2) {
      const letter = optMatch[i];
      const text = (optMatch[i + 1] || '').split('\n')[0].trim();
      if (text.length > 0) {
        options.push({
          id: letter,
          text,
          is_correct: letter === (row.answer || '').trim(),
        });
      }
    }
    
    if (options.length < 3 || !options.some(o => o.is_correct)) continue;
    
    cases.push({
      _id: startId++,
      q_type: 'MCQ',
      category: guessCategory(vignette),
      title: vignette.substring(0, 80) + (vignette.length > 80 ? '...' : ''),
      vignette: { narrative: vignette, demographics: {} },
      prompt: 'Choose the single best answer.',
      options,
      rationale: { correct: '', distractors: {} },
      meta: {
        source: 'polish-ldek-en',
        examType: 'International',
        difficulty: 2,
        tags: ['LDEK', 'Poland', 'English', `${row.year || ''}`, `${row.season || ''}`],
      },
      _searchKey: vignette.toLowerCase(),
    });
    polishAdded++;
  }
  console.log(`  Injected: ${polishAdded}`);
  totalAdded += polishAdded;

  // ═══════════════════════════════════════
  // 2. Nano1337 Medical MCQs (400) — DIRECT INJECT
  // ═══════════════════════════════════════
  console.log('\n2. Nano1337 Medical MCQs...');
  const nanoRows = await fetchAllRows('Nano1337/medical-mcqs', 'train', 500);
  fs.writeFileSync(path.join(OUTPUT, 'nano1337_raw.json'), JSON.stringify(nanoRows));
  
  let nanoAdded = 0;
  for (const row of nanoRows) {
    const question = row.question || '';
    if (question.length < 15) continue;
    
    const opts = Array.isArray(row.options) ? row.options : [];
    if (opts.length < 3) continue;
    
    const correctIdx = typeof row.correct_index === 'number' ? row.correct_index : -1;
    const options = opts.map((text, idx) => ({
      id: String.fromCharCode(65 + idx),
      text,
      is_correct: idx === correctIdx,
    }));
    
    if (!options.some(o => o.is_correct)) continue;
    
    cases.push({
      _id: startId++,
      q_type: 'MCQ',
      category: guessCategory(question),
      title: question.substring(0, 80) + (question.length > 80 ? '...' : ''),
      vignette: { narrative: question, demographics: {} },
      prompt: 'Choose the correct answer.',
      options,
      rationale: { correct: '', distractors: {} },
      meta: {
        source: 'nano1337-mcqs',
        examType: 'International',
        difficulty: 2,
        tags: ['Nano1337', 'English', row.question_type || ''],
      },
      _searchKey: question.toLowerCase(),
    });
    nanoAdded++;
  }
  console.log(`  Injected: ${nanoAdded}`);
  totalAdded += nanoAdded;

  // ═══════════════════════════════════════
  // 3 & 4. MedQA Mainland + Greek → Translation batch
  // ═══════════════════════════════════════
  console.log('\n3. MedQA Mainland China...');
  const cnRows = await fetchAllRows('xuxuxuxuxu/MedQA_Mainland_test', 'train', 4000);
  fs.writeFileSync(path.join(OUTPUT, 'medqa_mainland_raw.json'), JSON.stringify(cnRows));

  console.log('\n4. Greek Medical MCQA...');
  const grRows = await fetchAllRows('ilsp/medical_mcqa_greek', 'train', 2500);
  fs.writeFileSync(path.join(OUTPUT, 'greek_mcqa_raw.json'), JSON.stringify(grRows));

  // Build translation batch JSONL
  console.log('\nBuilding translation batch...');
  const batchLines = [];

  const SYSTEM = `Kamu adalah translator medis. Terjemahkan soal ujian kedokteran ini ke Bahasa Indonesia yang natural.
Lokalisasi: ganti nama pasien dengan nama Indonesia jika perlu.
JANGAN ubah substansi medis. Output STRICT JSON (no markdown):
{
  "question": "teks soal dalam Bahasa Indonesia",
  "options": {"A": "...", "B": "...", "C": "...", "D": "...", "E": "..."},
  "answer": "A/B/C/D/E",
  "category": "best guess medical category in english"
}`;

  for (let i = 0; i < cnRows.length; i++) {
    const row = cnRows[i];
    const optText = Object.entries(row.options || {}).map(([k, v]) => `${k}. ${v}`).join('\n');
    batchLines.push(JSON.stringify({
      custom_id: `cn_${i}`,
      method: 'POST',
      url: '/v1/chat/completions',
      body: {
        model: 'gpt-4o-mini',
        response_format: { type: 'json_object' },
        max_tokens: 1024,
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: `Soal (Simplified Chinese):\n${row.question}\n\nOpsi:\n${optText}\n\nJawaban: ${row.answer_idx || row.answer}` },
        ],
      },
    }));
  }

  for (let i = 0; i < grRows.length; i++) {
    const row = grRows[i];
    const opts = row.multiple_choice_targets || [];
    const scores = row.multiple_choice_scores || [];
    const correctIdx = scores.indexOf(1);
    const ansLetter = correctIdx >= 0 ? String.fromCharCode(65 + correctIdx) : '?';
    const optText = opts.map((v, idx) => `${String.fromCharCode(65 + idx)}. ${v}`).join('\n');
    
    batchLines.push(JSON.stringify({
      custom_id: `gr_${i}`,
      method: 'POST',
      url: '/v1/chat/completions',
      body: {
        model: 'gpt-4o-mini',
        response_format: { type: 'json_object' },
        max_tokens: 1024,
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: `Soal (Greek):\n${row.inputs}\n\nOpsi:\n${optText}\n\nJawaban: ${ansLetter}\nSubject: ${row.subject || ''}` },
        ],
      },
    }));
  }

  const jsonlPath = path.join(OUTPUT, 'translation_batch2.jsonl');
  fs.writeFileSync(jsonlPath, batchLines.join('\n'));
  console.log(`JSONL: ${batchLines.length} requests (CN: ${cnRows.length}, GR: ${grRows.length})`);

  // Save English datasets now
  const TMP = path.join(OUTPUT, 'compiled_cases.json.tmp');
  fs.writeFileSync(TMP, JSON.stringify(cases), 'utf-8');
  fs.renameSync(TMP, path.join(OUTPUT, 'compiled_cases.json'));
  
  // Payload optimizer: filter quarantined for frontend
  const frontendCases = cases.filter(c => !c.meta?.quarantined && !c.meta?.quarantine_flag);
  const TMP_PUB = path.join(__dirname, '..', 'public', 'data', 'compiled_cases.json.tmp');
  fs.writeFileSync(TMP_PUB, JSON.stringify(frontendCases), 'utf-8');
  fs.renameSync(TMP_PUB, path.join(__dirname, '..', 'public', 'data', 'compiled_cases.json'));

  console.log(`\n🛡️ Master: ${cases.length.toLocaleString()} cases`);
  console.log(`🚀 Frontend: ${frontendCases.length.toLocaleString()} clean`);
  console.log(`📦 Added today: ${totalAdded} (EN direct)`);
  console.log(`📤 Translation batch: ${batchLines.length} (CN+GR → ID)`);

  // Upload + Submit batch
  const envFile = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf-8');
  const API_KEY = envFile.match(/^OPENAI_API_KEY\s*=\s*['"]?([^'"\r\n]+)['"]?/m)?.[1]?.trim();

  console.log('\nUploading translation batch...');
  const formData = new FormData();
  formData.append('file', new Blob([fs.readFileSync(jsonlPath)]), 'translation_batch2.jsonl');
  formData.append('purpose', 'batch');
  const uploadRes = await fetch('https://api.openai.com/v1/files', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${API_KEY}` },
    body: formData,
  });
  const upload = await uploadRes.json();
  if (!uploadRes.ok) { console.log('Upload failed:', JSON.stringify(upload).substring(0, 200)); return; }
  console.log(`Uploaded: ${upload.id}`);

  const batchRes = await fetch('https://api.openai.com/v1/batches', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ input_file_id: upload.id, endpoint: '/v1/chat/completions', completion_window: '24h' }),
  });
  const batch = await batchRes.json();
  if (!batchRes.ok) { console.log('Batch failed:', JSON.stringify(batch).substring(0, 200)); return; }
  console.log(`✅ Batch: ${batch.id} (${batch.status})`);

  const mPath = path.join(OUTPUT, 'god_tier_batches.json');
  const manifest = JSON.parse(fs.readFileSync(mPath, 'utf-8'));
  manifest.batches.translate_cn_gr = batch.id;
  fs.writeFileSync(mPath, JSON.stringify(manifest, null, 2));
  console.log('Manifest updated');
})();
