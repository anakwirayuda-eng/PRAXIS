/**
 * Download TW-MedQA + IgakuQA from HuggingFace → Build translation batch 
 * 
 * TW-MedQA: 1,413 MCQs (Traditional Chinese) — Taiwan medical board
 * IgakuQA: 146 MCQs (Japanese) — Japan medical board
 * 
 * Outputs: translation_asian_batch.jsonl for OpenAI Batch API
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
  }
  return rows;
}

(async () => {
  console.log('═══ Download Asian Med QA ═══\n');

  // 1. TW-MedQA
  console.log('Downloading TW-MedQA...');
  const twRows = await fetchAllRows('xuxuxuxuxu/MedQA_Taiwan_test', 'train', 1500);
  console.log(`  Got: ${twRows.length} rows`);
  fs.writeFileSync(path.join(OUTPUT, 'tw_medqa_raw.json'), JSON.stringify(twRows, null, 2));

  // 2. IgakuQA
  console.log('Downloading IgakuQA...');
  const igRows = await fetchAllRows('japan-ai-official/igakuqa-subset-curated', 'train', 200);
  console.log(`  Got: ${igRows.length} rows`);
  fs.writeFileSync(path.join(OUTPUT, 'igakuqa_raw.json'), JSON.stringify(igRows, null, 2));

  // 3. Build translation batch JSONL
  console.log('\nBuilding translation batch...');
  const batchLines = [];

  const SYSTEM = `Kamu adalah translator medis. Terjemahkan soal ujian kedokteran ini ke Bahasa Indonesia yang natural.
Lokalisasi: ganti nama pasien dengan nama Indonesia, ganti nama tempat jika tidak relevan.
JANGAN ubah substansi medis. Output STRICT JSON (no markdown):
{
  "question": "teks soal dalam Bahasa Indonesia",
  "options": {"A": "...", "B": "...", "C": "...", "D": "...", "E": "..."},
  "answer": "A/B/C/D/E",
  "category": "best guess medical category in english"
}`;

  // TW-MedQA entries
  for (let i = 0; i < twRows.length; i++) {
    const row = twRows[i];
    const optText = Object.entries(row.options || {}).map(([k, v]) => `${k}. ${v}`).join('\n');
    batchLines.push(JSON.stringify({
      custom_id: `tw_${i}`,
      method: 'POST',
      url: '/v1/chat/completions',
      body: {
        model: 'gpt-4o-mini',
        response_format: { type: 'json_object' },
        max_tokens: 1024,
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: `Soal (Traditional Chinese):\n${row.question}\n\nOpsi:\n${optText}\n\nJawaban: ${row.answer_idx || row.answer}` },
        ],
      },
    }));
  }

  // IgakuQA entries
  for (let i = 0; i < igRows.length; i++) {
    const row = igRows[i];
    const opts = Array.isArray(row.options) ? row.options : [];
    const optText = opts.map((v, idx) => `${String.fromCharCode(65 + idx)}. ${v}`).join('\n');
    const ansLetter = typeof row.answer_idx === 'number'
      ? String.fromCharCode(65 + row.answer_idx)
      : row.answer_idx;
    batchLines.push(JSON.stringify({
      custom_id: `ig_${i}`,
      method: 'POST',
      url: '/v1/chat/completions',
      body: {
        model: 'gpt-4o-mini',
        response_format: { type: 'json_object' },
        max_tokens: 1024,
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: `Soal (Japanese):\n${row.question}\n\nOpsi:\n${optText}\n\nJawaban: ${ansLetter}` },
        ],
      },
    }));
  }

  const jsonlPath = path.join(OUTPUT, 'translation_asian_batch.jsonl');
  fs.writeFileSync(jsonlPath, batchLines.join('\n'));
  console.log(`JSONL: ${batchLines.length} requests`);
  console.log(`  TW-MedQA: ${twRows.length}`);
  console.log(`  IgakuQA: ${igRows.length}`);
  console.log(`  File: ${(fs.statSync(jsonlPath).size / 1024).toFixed(0)} KB`);

  // 4. Upload + Submit batch
  const envFile = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf-8');
  const API_KEY = envFile.match(/OPENAI_API_KEY=(.+)/)?.[1]?.trim();

  console.log('\nUploading...');
  const formData = new FormData();
  formData.append('file', new Blob([fs.readFileSync(jsonlPath)]), 'translation_asian_batch.jsonl');
  formData.append('purpose', 'batch');
  const uploadRes = await fetch('https://api.openai.com/v1/files', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${API_KEY}` },
    body: formData,
  });
  const upload = await uploadRes.json();
  if (!uploadRes.ok) { console.log('Upload failed:', JSON.stringify(upload).substring(0, 200)); return; }
  console.log(`Uploaded: ${upload.id}`);

  console.log('Creating batch...');
  const batchRes = await fetch('https://api.openai.com/v1/batches', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      input_file_id: upload.id,
      endpoint: '/v1/chat/completions',
      completion_window: '24h',
    }),
  });
  const batch = await batchRes.json();
  if (!batchRes.ok) { console.log('Batch failed:', JSON.stringify(batch).substring(0, 200)); return; }
  console.log(`✅ Batch: ${batch.id} (${batch.status})`);

  // Update manifest
  const mPath = path.join(OUTPUT, 'god_tier_batches.json');
  const manifest = JSON.parse(fs.readFileSync(mPath, 'utf-8'));
  manifest.batches.translate_asian = batch.id;
  fs.writeFileSync(mPath, JSON.stringify(manifest, null, 2));
  console.log('Manifest updated');
})();
