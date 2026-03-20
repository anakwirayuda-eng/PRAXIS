/**
 * MCQ→SCT Mutation Factory + Synthetic Expert Panel
 * 
 * Takes 500 high-confidence clinical MCQs and converts them to SCT format
 * via OpenAI Batch API. Each SCT gets:
 * - Clinical hypothesis (from distractor)
 * - New information (lab/vitals that challenges hypothesis)
 * - Likert scale (-2 to +2)
 * - Synthetic expert panel votes (15 experts, bell-curve)
 * 
 * Usage: node ingestion/sct-factory.cjs [count]
 * Default: 500 MCQs → 500 SCTs
 */
const fs = require('fs');
const path = require('path');

const COUNT = parseInt(process.argv[2] || '500');
const OUTPUT = path.join(__dirname, 'output');

console.log(`═══ SCT Factory — MCQ→SCT Mutation ═══\n`);

// 1. Load and filter high-quality MCQs
const cases = JSON.parse(fs.readFileSync(path.join(OUTPUT, 'compiled_cases.json'), 'utf-8'));

// Select MCQs with: clinical vignette, 4+ options, has correct answer, has rationale
const candidates = cases.filter(c => {
  if (c.q_type !== 'MCQ') return false;
  if (!c.vignette?.narrative || c.vignette.narrative.length < 50) return false;
  if (!c.options || c.options.length < 4) return false;
  if (!c.options.some(o => o.is_correct)) return false;
  if (c.meta?.quarantine_flag || c.meta?.quarantined) return false;
  // Prefer clinical categories
  const clinicalCats = ['internal-medicine', 'surgery', 'pediatrics', 'obgyn', 'neurology',
    'cardiology', 'pulmonology', 'gastroenterology', 'nephrology', 'endocrinology',
    'hematology', 'dermatology', 'psychiatry', 'emergency-medicine'];
  if (!clinicalCats.includes(c.category)) return false;
  return true;
});

console.log(`Clinical MCQ candidates: ${candidates.length}`);

// Shuffle and take COUNT
for (let i = candidates.length - 1; i > 0; i--) {
  const j = Math.floor(Math.random() * (i + 1));
  [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
}
const selected = candidates.slice(0, COUNT);
console.log(`Selected for mutation: ${selected.length}`);

// 2. Build batch JSONL
const SYSTEM = `Kamu adalah Profesor Kedokteran pembuat soal UKMPPD format SCT (Script Concordance Test).

TUGAS: Ubah soal MCQ ini menjadi 1 soal SCT yang menguji clinical reasoning dalam situasi abu-abu/ambiguous.

FORMAT SCT:
- Skenario klinis (dari vignette MCQ asli, boleh dimodifikasi sedikit)
- Hipotesis: AMBIL salah satu diagnosis/terapi yang SALAH dari opsi distractor sebagai hipotesis awal dokter
- Informasi Baru: Ciptakan hasil pemeriksaan/lab/anamnesis BARU yang mengubah keyakinan terhadap hipotesis
- Skala: -2 (sangat menyingkirkan), -1 (menyingkirkan), 0 (tidak berpengaruh), +1 (mendukung), +2 (sangat mendukung)

EXPERT PANEL: Simulasikan voting 15 dokter spesialis. Total votes HARUS = 15.
Distribusi harus realistis (bell-curve, bukan seragam). Jawaban benar mendapat mayoritas votes.

Output STRICT JSON (no markdown):
{
  "scenario": "Skenario klinis dalam Bahasa Indonesia (Seorang laki-laki berusia...)",
  "hypothesis": "Hipotesis diagnosis/terapi yang diuji",
  "new_information": "Informasi baru yang mengubah keyakinan",
  "correct_direction": -2|-1|0|1|2,
  "expert_panel": {"-2": N, "-1": N, "0": N, "+1": N, "+2": N},
  "rationale": "Penjelasan klinis mengapa informasi baru mengubah/tidak mengubah hipotesis",
  "category": "medical specialty",
  "difficulty": 1-3
}

RULES:
- Skenario HARUS dalam Bahasa Indonesia formal kedokteran
- Hipotesis harus plausible tapi kemungkinan salah/berubah
- Informasi baru harus spesifik (angka lab, tanda klinis)
- Expert votes bell-curve realistis, total = 15`;

const batchLines = [];
for (let i = 0; i < selected.length; i++) {
  const c = selected[i];
  const correct = c.options.find(o => o.is_correct);
  const distractors = c.options.filter(o => !o.is_correct).map(o => o.text);
  const rationale = c.rationale?.correct || '';

  batchLines.push(JSON.stringify({
    custom_id: `sct_${c._id || i}`,
    method: 'POST',
    url: '/v1/chat/completions',
    body: {
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      max_tokens: 1024,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: `Soal MCQ Asli:\n${c.vignette.narrative}\n\nJawaban Benar: ${correct?.text || 'N/A'}\nDistractors: ${distractors.join(' | ')}\nKategori: ${c.category}\n\nPembahasan: ${rationale.substring(0, 300)}` },
      ],
    },
  }));
}

const jsonlPath = path.join(OUTPUT, 'sct_factory_batch.jsonl');
fs.writeFileSync(jsonlPath, batchLines.join('\n'));
console.log(`\nBatch JSONL: ${batchLines.length} requests`);
console.log(`File: ${(fs.statSync(jsonlPath).size / 1024).toFixed(0)} KB`);

// 3. Upload + Submit
(async () => {
  const envFile = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf-8');
  const API_KEY = envFile.match(/^OPENAI_API_KEY\s*=\s*['"]?([^'"\r\n]+)['"]?/m)?.[1]?.trim();

  console.log('\nUploading...');
  const formData = new FormData();
  formData.append('file', new Blob([fs.readFileSync(jsonlPath)]), 'sct_factory_batch.jsonl');
  formData.append('purpose', 'batch');
  const uploadRes = await fetch('https://api.openai.com/v1/files', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${API_KEY}` },
    body: formData,
  });
  const upload = await uploadRes.json();
  if (!uploadRes.ok) { console.log('Upload failed:', JSON.stringify(upload).substring(0, 300)); return; }
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
  if (!batchRes.ok) { console.log('Batch failed:', JSON.stringify(batch).substring(0, 300)); return; }
  console.log(`✅ Batch: ${batch.id} (${batch.status})`);
  console.log(`Est. cost: ~$${(batchLines.length * 0.002).toFixed(2)}`);

  const mPath = path.join(OUTPUT, 'god_tier_batches.json');
  const manifest = JSON.parse(fs.readFileSync(mPath, 'utf-8'));
  manifest.batches.sct_factory = batch.id;
  fs.writeFileSync(mPath, JSON.stringify(manifest, null, 2));
  console.log('Manifest updated');
})();
