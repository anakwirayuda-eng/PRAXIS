import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_PATH = path.join(__dirname, '../public/data/compiled_cases.json');
const OUTPUT_DIR = path.join(__dirname, 'output');
const ENV_PATH = path.join(__dirname, '../.env');

console.log('═══ AOTA + No-Answer Batch Factory ═══\n');
console.log('Reading database...');
const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));

// Target: cases with no correct answer OR AOTA suspects
const targets = db.filter(c => {
  if (c.q_type === 'SCT') return false; // Skip SCT
  const hasCorrect = (c.options || []).some(o => o.is_correct);
  const isAOTA = (c.options || []).some(o =>
    /all of the above|none of the above|semua benar|semua salah/i.test(o.text || '')
  );
  const needsReview = c.meta?.needs_review === true;
  return !hasCorrect || (isAOTA && needsReview);
});

console.log(`Found ${targets.length} cases to audit\n`);

// ═══ SYSTEM PROMPT ═══
const SYSTEM_PROMPT = `You are a Panel of 3 Medical Experts conducting a triangulated answer key audit:
1. Clinical Professor (Harrison's, UpToDate) 
2. Board Exam Psychometrician (UKMPPD/USMLE item analysis)
3. Pharmacologist/Biochemist (Goodman & Gilman, Guyton)

TASK: Determine the correct answer for MCQ questions that have NO marked correct answer.

RULES:
- Each expert analyzes independently, then converge on consensus
- For "All of the above": evaluate EACH option separately first
- For "EXCEPT/FALSE/NOT" questions: find the INCORRECT statement
- If question is truncated or unclear: set confidence = "LOW"
- Temperature is 0: be deterministic and evidence-based

OUTPUT FORMAT (strict JSON, no markdown):
{
  "status": "FIXED",
  "_id": "case_id",
  "correct_option_id": "opa|opb|opc|opd",
  "correct_option_text": "text of correct option",
  "confidence": "HIGH|MEDIUM|LOW",
  "reasoning": "2-3 sentence consensus explanation with reference",
  "triangulation": {
    "clinician": "opa",
    "examiner": "opa", 
    "pharmacologist": "opa"
  },
  "agreement": "3/3|2/3|1/3"
}`;

// ═══ BUILD BATCH REQUESTS ═══
const batchRequests = [];

targets.forEach(c => {
  const optionsText = (c.options || []).map(o => {
    const marker = o.is_correct ? ' ✓CURRENT' : '';
    return `[${o.id}] ${o.text || '(empty)'}${marker}`;
  }).join('\n');

  // Get question text from various possible fields
  const qText = c.question
    || (typeof c.vignette === 'string' ? c.vignette : c.vignette?.narrative)
    || c.prompt
    || '(no question text)';

  const rationale = typeof c.rationale === 'string'
    ? c.rationale
    : c.rationale?.correct || '';

  const userContent = [
    `ID: ${c._id}`,
    `Question: ${qText}`,
    `Options:`,
    optionsText,
    rationale ? `\nExisting Rationale: ${rationale.substring(0, 500)}` : '',
    `\nDetermine the correct answer. Output JSON only.`
  ].filter(Boolean).join('\n');

  batchRequests.push({
    custom_id: `answer_audit_${c._id}`,
    method: "POST",
    url: "/v1/chat/completions",
    body: {
      model: "gpt-4.1-mini",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userContent }
      ]
    }
  });
});

// ═══ WRITE BATCH JSONL ═══
const batchPath = path.join(OUTPUT_DIR, 'batch_answer_audit.jsonl');
fs.writeFileSync(batchPath, batchRequests.map(r => JSON.stringify(r)).join('\n'));
console.log(`✅ Wrote ${batchRequests.length} requests to ${batchPath}`);

// ═══ SUBMIT TO OPENAI BATCH API ═══
const apiKey = fs.readFileSync(ENV_PATH, 'utf-8').match(/OPENAI_API_KEY=(.+)/)?.[1]?.trim();

if (!apiKey) {
  console.log('\n⚠️ No OPENAI_API_KEY found in .env — batch file created but not submitted.');
  console.log('To submit manually:');
  console.log('  1. Upload batch_answer_audit.jsonl as a file');
  console.log('  2. Create a batch with that file ID');
  process.exit(0);
}

console.log('\nUploading batch file to OpenAI...');

async function submitBatch() {
  // Step 1: Upload file
  const formData = new FormData();
  formData.append('purpose', 'batch');
  formData.append('file', new Blob([fs.readFileSync(batchPath)]), 'batch_answer_audit.jsonl');

  const uploadRes = await fetch('https://api.openai.com/v1/files', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}` },
    body: formData,
  });
  const uploadData = await uploadRes.json();

  if (!uploadData.id) {
    console.error('❌ Upload failed:', uploadData);
    return;
  }
  console.log(`✅ File uploaded: ${uploadData.id}`);

  // Step 2: Create batch
  const batchRes = await fetch('https://api.openai.com/v1/batches', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      input_file_id: uploadData.id,
      endpoint: '/v1/chat/completions',
      completion_window: '24h',
      metadata: { description: 'MedCase answer key triangulation audit' },
    }),
  });
  const batchData = await batchRes.json();

  if (!batchData.id) {
    console.error('❌ Batch creation failed:', batchData);
    return;
  }

  console.log(`\n🚀 BATCH SUBMITTED!`);
  console.log(`   Batch ID: ${batchData.id}`);
  console.log(`   Status: ${batchData.status}`);
  console.log(`   Cases: ${batchRequests.length}`);
  console.log(`   Model: gpt-4.1-mini`);
  console.log(`   ETA: ~2-4 hours (50% discount)`);

  // Save batch info
  const infoPath = path.join(OUTPUT_DIR, 'batch_answer_audit_info.json');
  fs.writeFileSync(infoPath, JSON.stringify({
    batch_id: batchData.id,
    file_id: uploadData.id,
    count: batchRequests.length,
    model: 'gpt-4.1-mini',
    submitted_at: new Date().toISOString(),
  }, null, 2));
  console.log(`\n📝 Batch info saved to ${infoPath}`);
  console.log(`\nCek status: node ingestion/_check_all_batches.cjs`);
}

submitBatch().catch(err => {
  console.error('Error:', err.message);
});
