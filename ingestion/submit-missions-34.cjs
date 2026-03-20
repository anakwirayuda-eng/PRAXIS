/**
 * Submit remaining missions:
 * - Mission 3: FrMedMCQA French→English translation (gpt-4o-mini)
 * - Mission 4: UKMPPD new PDF answer keys (gpt-5.4)
 * 
 * Usage: node ingestion/submit-missions-34.cjs
 */
const fs = require('fs');
const path = require('path');

const envFile = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf-8');
const API_KEY = envFile.match(/OPENAI_API_KEY=(.+)/)?.[1]?.trim();
const OUTPUT_DIR = path.join(__dirname, 'output');
const COMPILED = path.join(OUTPUT_DIR, 'compiled_cases.json');

const cases = JSON.parse(fs.readFileSync(COMPILED, 'utf-8'));
console.log('=== Missions 3 & 4 ===\n');

// ─── Mission 3: FrMedMCQA Translation ───
const french = cases.filter(c => c.meta?.source === 'frenchmedmcqa');
console.log(`Mission 3: ${french.length} FrMedMCQA to translate`);

const translateLines = french.map(c => {
  const optStr = c.options.map(o => `${o.id}. ${o.text}`).join('\n');
  return JSON.stringify({
    custom_id: `translate_${c._id}`,
    method: 'POST', url: '/v1/chat/completions',
    body: {
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'You are a medical translator (French→English). Translate the pharmacy exam question and ALL options to precise medical English. Output JSON: {"question": "translated question", "options": {"A": "text", "B": "text", ...}, "category": "medical specialty"}' },
        { role: 'user', content: `QUESTION:\n${c.vignette?.narrative || ''}\n\nOPTIONS:\n${optStr}` },
      ]
    }
  });
});

const translateFile = path.join(OUTPUT_DIR, 'mission3_translate.jsonl');
fs.writeFileSync(translateFile, translateLines.join('\n'), 'utf-8');

// ─── Mission 4: UKMPPD PDF Answer Keys ───
const newPdfUkmppd = cases.filter(c => 
  c.meta?.source === 'ukmppd-pdf-scribd' &&
  !c.meta?.hasVerifiedAnswer &&
  c.options?.length >= 2 &&
  c.vignette?.narrative?.length > 20
);
console.log(`Mission 4: ${newPdfUkmppd.length} UKMPPD PDF cases need answer keys`);

const oracleLines = newPdfUkmppd.map(c => {
  const optStr = c.options.map(o => `${o.id}. ${o.text}`).join('\n');
  return JSON.stringify({
    custom_id: `ukmppd_pdf_oracle_${c._id}`,
    method: 'POST', url: '/v1/chat/completions',
    body: {
      model: 'gpt-5.4',
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'Kamu adalah Dosen Penguji UKMPPD Indonesia berpengalaman 20 tahun.\n\nTugas:\n1. Tentukan SATU kunci jawaban paling tepat berdasarkan PPK Kemenkes RI / Pedoman IDI\n2. Tulis pembahasan 2 paragraf yang BERKUALITAS: paragraf 1 = kenapa jawaban benar, paragraf 2 = kenapa opsi lain salah\n3. Perbaiki vignette jika terlalu pendek atau tidak jelas — buat menjadi skenario klinis yang realistis\n\nABAIKAN pedoman USMLE jika bertentangan dengan PPK Indonesia.\n\nOutput JSON:\n{"correct_answer": "A-E", "confidence": 1-5, "explanation": "pembahasan berkualitas", "improved_vignette": "vignette yang diperbaiki jika perlu, atau null jika sudah bagus", "category": "spesialisasi medis (EN)"}' },
        { role: 'user', content: `SOAL UKMPPD:\n${c.vignette.narrative}\n\nOPSI:\n${optStr}` },
      ]
    }
  });
});

const oracleFile = path.join(OUTPUT_DIR, 'mission4_ukmppd_pdf.jsonl');
fs.writeFileSync(oracleFile, oracleLines.join('\n'), 'utf-8');

// ─── Submit Batches ───
async function uploadAndSubmit(filePath, label) {
  console.log(`\nSubmitting ${label}...`);
  const formData = new FormData();
  formData.append('file', new Blob([fs.readFileSync(filePath)]), path.basename(filePath));
  formData.append('purpose', 'batch');

  const uploadRes = await fetch('https://api.openai.com/v1/files', {
    method: 'POST', headers: { 'Authorization': `Bearer ${API_KEY}` }, body: formData,
  });
  if (!uploadRes.ok) { console.log(`  Upload fail: ${(await uploadRes.text()).substring(0,150)}`); return null; }
  const upload = await uploadRes.json();

  const batchRes = await fetch('https://api.openai.com/v1/batches', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ input_file_id: upload.id, endpoint: '/v1/chat/completions', completion_window: '24h' }),
  });
  if (!batchRes.ok) { console.log(`  Batch fail: ${(await batchRes.text()).substring(0,200)}`); return null; }
  const batch = await batchRes.json();
  console.log(`  Batch: ${batch.id} (${batch.status})`);
  return batch.id;
}

(async () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(OUTPUT_DIR, 'god_tier_batches.json'), 'utf-8'));
  
  manifest.batches.mission3_translate = await uploadAndSubmit(translateFile, `Mission 3: Translate (${french.length})`);
  manifest.batches.mission4_ukmppd_pdf = await uploadAndSubmit(oracleFile, `Mission 4: UKMPPD PDF (${newPdfUkmppd.length})`);
  
  fs.writeFileSync(path.join(OUTPUT_DIR, 'god_tier_batches.json'), JSON.stringify(manifest, null, 2));
  console.log('\nAll missions submitted! Manifest updated.');
  console.log(JSON.stringify(manifest.batches, null, 2));
})();
