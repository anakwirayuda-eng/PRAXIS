/**
 * TASK 5: OCR Rekapan 2021 — GPT-4o-mini Vision Batch
 * 
 * Reads 235 extracted page images (WebP), encodes to base64,
 * creates JSONL for OpenAI Vision Batch API to extract MCQs.
 * 
 * Gemini's hack: low-res (1024px), strict JSON output, artifact ignorance.
 * 
 * Usage: node ingestion/ocr-rekapan-batch.cjs
 */
const fs = require('fs');
const path = require('path');

const IMAGE_DIR = path.join(__dirname, '..', 'public', 'images', 'cases');
const OUTPUT_DIR = path.join(__dirname, 'output');
const envFile = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf-8');
const API_KEY = envFile.match(/OPENAI_API_KEY=(.+)/)?.[1]?.trim();

console.log('═══ TASK 5: OCR Rekapan 2021 — Vision Batch ═══\n');

// Find all Rekapan page images
const rekapanFiles = fs.readdirSync(IMAGE_DIR)
  .filter(f => f.includes('Rekapan-Soal-Ukmppd-2021') && f.endsWith('.webp'))
  .sort((a, b) => {
    const pa = parseInt(a.match(/_p(\d+)_/)?.[1] || '0');
    const pb = parseInt(b.match(/_p(\d+)_/)?.[1] || '0');
    return pa - pb;
  });

console.log(`Found ${rekapanFiles.length} page images\n`);

// Build JSONL — each line is a Vision request for one page
const SYSTEM_PROMPT = `Kamu adalah alat OCR Medis untuk soal UKMPPD. Ekstrak SEMUA soal MCQ dari gambar ini.

OUTPUT FORMAT: Pure JSON array (no markdown, no backticks):
[
  {
    "number": 1,
    "vignette": "teks soal lengkap termasuk skenario klinis",
    "options": {"A": "teks opsi A", "B": "teks opsi B", "C": "teks opsi C", "D": "teks opsi D", "E": "teks opsi E"},
    "answer": "A",
    "is_cut": false
  }
]

RULES:
- Perbaiki typo otomatis (misal "Sefalosn rin" → "Sefalosporin", "lV" → "IV")
- ABAIKAN watermark, nomor halaman, header "Try Out UKMPPD", footer
- Jika soal terpotong di akhir halaman, set "is_cut": true
- Jika halaman tidak berisi soal MCQ (halaman sampul, daftar isi), kembalikan array kosong []
- "answer" bisa null jika tidak ada kunci jawaban terlihat
- Pastikan vignette lengkap dan tidak terpotong`;

const lines = [];
for (const file of rekapanFiles) {
  const imgPath = path.join(IMAGE_DIR, file);
  const imgData = fs.readFileSync(imgPath);
  const base64 = imgData.toString('base64');
  const pageNum = parseInt(file.match(/_p(\d+)_/)?.[1] || '0');

  lines.push(JSON.stringify({
    custom_id: `ocr_rekapan_p${pageNum}`,
    method: 'POST',
    url: '/v1/chat/completions',
    body: {
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      max_tokens: 4096,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'text', text: `Halaman ${pageNum + 1} dari Rekapan Soal UKMPPD 2021. Ekstrak semua soal MCQ. Output JSON: {"questions": [...]}` },
            {
              type: 'image_url',
              image_url: {
                url: `data:image/webp;base64,${base64}`,
                detail: 'low'  // Low-res arbitrage: cheaper!
              }
            }
          ]
        }
      ]
    }
  }));
}

const jsonlPath = path.join(OUTPUT_DIR, 'ocr_rekapan_batch.jsonl');
fs.writeFileSync(jsonlPath, lines.join('\n'), 'utf-8');
console.log(`JSONL written: ${lines.length} requests`);
console.log(`File size: ${(fs.statSync(jsonlPath).size / 1024 / 1024).toFixed(1)} MB`);

// Submit batch
async function submit() {
  console.log('\nUploading JSONL...');
  const formData = new FormData();
  formData.append('file', new Blob([fs.readFileSync(jsonlPath)]), 'ocr_rekapan_batch.jsonl');
  formData.append('purpose', 'batch');

  const uploadRes = await fetch('https://api.openai.com/v1/files', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${API_KEY}` },
    body: formData,
  });
  
  if (!uploadRes.ok) {
    console.log('Upload failed:', (await uploadRes.text()).substring(0, 200));
    return;
  }
  
  const upload = await uploadRes.json();
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

  if (!batchRes.ok) {
    console.log('Batch creation failed:', (await batchRes.text()).substring(0, 200));
    return;
  }

  const batch = await batchRes.json();
  console.log(`✅ Batch: ${batch.id} (${batch.status})`);

  // Update manifest
  const manifest = JSON.parse(fs.readFileSync(path.join(OUTPUT_DIR, 'god_tier_batches.json'), 'utf-8'));
  manifest.batches.ocr_rekapan = batch.id;
  manifest.timestamp_ocr = new Date().toISOString();
  fs.writeFileSync(path.join(OUTPUT_DIR, 'god_tier_batches.json'), JSON.stringify(manifest, null, 2));
  console.log('Manifest updated');
}

submit().catch(e => console.error(e));
