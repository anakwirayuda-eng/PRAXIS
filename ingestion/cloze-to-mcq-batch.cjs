/**
 * Cloze→MCQ Batch Converter
 * 
 * Takes parsed Anki cloze cards and creates an OpenAI Batch to convert
 * each medical fact into a UKMPPD-style clinical vignette MCQ.
 * 
 * Usage: node ingestion/cloze-to-mcq-batch.cjs <parsed-anki-file>
 * Example: node ingestion/cloze-to-mcq-batch.cjs anki_plab1_parsed.json
 */
const fs = require('fs');
const path = require('path');

const inputFile = process.argv[2];
if (!inputFile) {
  console.log('Usage: node ingestion/cloze-to-mcq-batch.cjs <parsed-anki-file>');
  process.exit(1);
}

const OUTPUT = path.join(__dirname, 'output');
const fullPath = path.join(OUTPUT, inputFile);
if (!fs.existsSync(fullPath)) {
  console.log(`File not found: ${fullPath}`);
  process.exit(1);
}

const envFile = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf-8');
const API_KEY = envFile.match(/OPENAI_API_KEY=(.+)/)?.[1]?.trim();

const cards = JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
const clozeCards = cards.filter(c => c.q_type === 'CLOZE' || c.meta?.needsMCQConversion);

console.log(`═══ Cloze→MCQ Converter ═══\n`);
console.log(`Input: ${inputFile}`);
console.log(`Total cards: ${cards.length}`);
console.log(`Cards needing MCQ conversion: ${clozeCards.length}\n`);

if (clozeCards.length === 0) {
  console.log('No cloze cards to convert!');
  process.exit(0);
}

const SYSTEM = `Kamu adalah penulis soal UKMPPD. Ubah fakta medis ini menjadi soal MCQ skenario klinis.

FORMAT OUTPUT (Strict JSON, no markdown):
{
  "vignette": "Seorang [demografi] datang ke [setting] dengan keluhan [gejala]...",
  "prompt": "Apa diagnosis/tatalaksana/pemeriksaan yang paling tepat?",
  "options": {"A": "...", "B": "...", "C": "...", "D": "...", "E": "..."},
  "answer": "A/B/C/D/E",
  "rationale": "Penjelasan mengapa jawaban benar dan mengapa opsi lain salah",
  "category": "medical specialty in english"
}

RULES:
- Vignette HARUS berupa skenario klinis realistis di IGD/Puskesmas Indonesia
- Gunakan nama Indonesia (Budi, Sari, dsb)
- Jawaban benar harus berdasarkan fakta medis yang diberikan
- 4 distractor harus plausible tapi salah
- Bahasa Indonesia formal kedokteran`;

const batchLines = [];
for (let i = 0; i < clozeCards.length; i++) {
  const card = clozeCards[i];
  const fact = card.raw_front || '';
  const extra = card.raw_back || card.raw_extra || '';
  const answers = (card.cloze_answers || []).join(', ');

  batchLines.push(JSON.stringify({
    custom_id: `cloze_${i}`,
    method: 'POST',
    url: '/v1/chat/completions',
    body: {
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      max_tokens: 1024,
      messages: [
        { role: 'system', content: SYSTEM },
        {
          role: 'user',
          content: `Fakta medis:\n${fact}\n\nJawaban kunci: ${answers}\n\nInfo tambahan:\n${extra}\n\nKategori: ${card.category}\nTags: ${(card.tags || []).join(', ')}`,
        },
      ],
    },
  }));
}

const deckName = inputFile.replace('anki_', '').replace('_parsed.json', '');
const jsonlPath = path.join(OUTPUT, `cloze_mcq_${deckName}_batch.jsonl`);
fs.writeFileSync(jsonlPath, batchLines.join('\n'));
console.log(`JSONL: ${batchLines.length} requests`);
console.log(`File: ${(fs.statSync(jsonlPath).size / 1024).toFixed(0)} KB`);

// Upload + Submit
(async () => {
  console.log('\nUploading...');
  const formData = new FormData();
  formData.append('file', new Blob([fs.readFileSync(jsonlPath)]), `cloze_mcq_${deckName}_batch.jsonl`);
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

  const mPath = path.join(OUTPUT, 'god_tier_batches.json');
  const manifest = JSON.parse(fs.readFileSync(mPath, 'utf-8'));
  manifest.batches[`cloze_mcq_${deckName}`] = batch.id;
  fs.writeFileSync(mPath, JSON.stringify(manifest, null, 2));
  console.log('Manifest updated');
})();
