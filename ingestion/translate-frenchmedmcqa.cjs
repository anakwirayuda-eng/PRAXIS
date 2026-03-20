/**
 * Translate 1,080 FrMedMCQA questions from French to English
 * Uses gpt-4o-mini batch API for cheap bulk translation
 * 
 * Usage: node ingestion/translate-frenchmedmcqa.cjs
 */
const fs = require('fs');
const path = require('path');

const envFile = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf-8');
const API_KEY = envFile.match(/OPENAI_API_KEY=(.+)/)?.[1]?.trim();
const OUTPUT_DIR = path.join(__dirname, 'output');
const COMPILED = path.join(OUTPUT_DIR, 'compiled_cases.json');

console.log('=== FrMedMCQA Translation Batch ===\n');

const cases = JSON.parse(fs.readFileSync(COMPILED, 'utf-8'));
const french = cases.filter(c => c.meta?.source === 'frenchmedmcqa');
console.log(`French cases to translate: ${french.length}\n`);

// Generate JSONL
const lines = french.map(c => {
  const optStr = c.options.map(o => `${o.id}. ${o.text}`).join('\n');
  return JSON.stringify({
    custom_id: `translate_${c._id}`,
    method: 'POST',
    url: '/v1/chat/completions',
    body: {
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: 'You are a medical translator (French→English). Translate the question and all options to clear, accurate medical English. Keep medical terminology precise. Output JSON: {"question": "translated question", "options": ["A translated", "B translated", ...], "category": "medical specialty in English"}'
        },
        {
          role: 'user',
          content: `QUESTION (French):\n${c.vignette?.narrative || ''}\n\nOPTIONS:\n${optStr}`
        }
      ]
    }
  });
});

const jsonlFile = path.join(OUTPUT_DIR, 'translate_frenchmedmcqa.jsonl');
fs.writeFileSync(jsonlFile, lines.join('\n'), 'utf-8');
console.log(`Generated: ${lines.length} prompts → ${jsonlFile}\n`);

// Submit batch
(async () => {
  const formData = new FormData();
  formData.append('file', new Blob([fs.readFileSync(jsonlFile)]), 'translate_frenchmedmcqa.jsonl');
  formData.append('purpose', 'batch');

  console.log('Uploading...');
  const uploadRes = await fetch('https://api.openai.com/v1/files', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${API_KEY}` },
    body: formData,
  });
  if (!uploadRes.ok) { console.log('Upload failed:', (await uploadRes.text()).substring(0, 200)); return; }
  const upload = await uploadRes.json();
  console.log(`File: ${upload.id}`);

  console.log('Creating batch...');
  const batchRes = await fetch('https://api.openai.com/v1/batches', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ input_file_id: upload.id, endpoint: '/v1/chat/completions', completion_window: '24h' }),
  });
  if (!batchRes.ok) { console.log('Batch failed:', (await batchRes.text()).substring(0, 200)); return; }
  const batch = await batchRes.json();
  console.log(`Batch: ${batch.id} (${batch.status})`);

  // Save to manifest
  const manifest = JSON.parse(fs.readFileSync(path.join(OUTPUT_DIR, 'god_tier_batches.json'), 'utf-8'));
  manifest.batches.translate_fr = batch.id;
  fs.writeFileSync(path.join(OUTPUT_DIR, 'god_tier_batches.json'), JSON.stringify(manifest, null, 2));
  console.log('\nSaved to manifest. Done!');
})();
