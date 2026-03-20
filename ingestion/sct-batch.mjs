/**
 * SCT Alchemist — Full Automation
 * Upload JSONL → Create Batch → Poll → Download → Inject to dataset
 * 
 * Usage: node ingestion/sct-batch.mjs
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

// Load API key from .env
const envPath = join(import.meta.dirname, '..', '.env');
if (!existsSync(envPath)) {
  console.error('❌ .env file not found. Create one with: OPENAI_API_KEY=sk-...');
  process.exit(1);
}
const envContent = readFileSync(envPath, 'utf-8');
const API_KEY = envContent.match(/OPENAI_API_KEY=(.+)/)?.[1]?.trim();
if (!API_KEY || API_KEY === 'sk-paste-your-key-here') {
  console.error('❌ Paste your real OpenAI API key in .env');
  process.exit(1);
}

const INPUT_FILE = join(import.meta.dirname, 'output', 'sct_transmutation.jsonl');
const OUTPUT_FILE = join(import.meta.dirname, 'output', 'sct_batch_result.jsonl');
const BASE = 'https://api.openai.com/v1';
const headers = { 'Authorization': `Bearer ${API_KEY}` };

async function apiCall(path, opts = {}) {
  const resp = await fetch(`${BASE}${path}`, { ...opts, headers: { ...headers, ...opts.headers } });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`API ${resp.status}: ${text.substring(0, 200)}`);
  }
  return resp.json();
}

// ═══════════════════════════════════════
// STEP 1: Upload file
// ═══════════════════════════════════════
console.log('══════════════════════════════════════');
console.log(' SCT Alchemist — OpenAI Batch API');
console.log('══════════════════════════════════════\n');

console.log('📤 Step 1: Uploading sct_transmutation.jsonl...');
const fileData = readFileSync(INPUT_FILE);
const formData = new FormData();
formData.append('file', new Blob([fileData]), 'sct_transmutation.jsonl');
formData.append('purpose', 'batch');

const uploadResp = await fetch(`${BASE}/files`, {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${API_KEY}` },
  body: formData,
});
if (!uploadResp.ok) {
  const err = await uploadResp.text();
  console.error('❌ Upload failed:', err.substring(0, 300));
  process.exit(1);
}
const uploadResult = await uploadResp.json();
console.log(`  ✅ File ID: ${uploadResult.id}\n`);

// ═══════════════════════════════════════
// STEP 2: Create batch
// ═══════════════════════════════════════
console.log('🚀 Step 2: Creating batch...');
const batch = await apiCall('/batches', {
  method: 'POST',
  headers: { ...headers, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    input_file_id: uploadResult.id,
    endpoint: '/v1/chat/completions',
    completion_window: '24h',
    metadata: { description: 'MedCase SCT Alchemist - MCQ to SCT conversion' },
  }),
});
console.log(`  ✅ Batch ID: ${batch.id}`);
console.log(`  Status: ${batch.status}\n`);

// ═══════════════════════════════════════
// STEP 3: Poll for completion
// ═══════════════════════════════════════
console.log('⏳ Step 3: Waiting for completion (this may take 1-6 hours)...');
console.log('   (You can close this window — run this script again to check status)\n');

let status = batch.status;
let pollCount = 0;

while (status !== 'completed' && status !== 'failed' && status !== 'expired' && status !== 'cancelled') {
  const waitMinutes = pollCount < 5 ? 1 : 5; // First 5 checks = 1min, then 5min
  console.log(`  [${new Date().toLocaleTimeString()}] Status: ${status} (checking again in ${waitMinutes}m...)`);
  
  await new Promise(r => setTimeout(r, waitMinutes * 60 * 1000));
  
  const check = await apiCall(`/batches/${batch.id}`);
  status = check.status;
  pollCount++;

  if (check.request_counts) {
    console.log(`  Progress: ${check.request_counts.completed}/${check.request_counts.total} completed`);
  }

  // Safety: don't poll forever
  if (pollCount > 100) {
    console.log('  ⚠️ Max poll count reached. Run script again to check.');
    process.exit(0);
  }
}

if (status !== 'completed') {
  console.error(`\n❌ Batch ${status}. Check OpenAI dashboard for details.`);
  process.exit(1);
}

// ═══════════════════════════════════════
// STEP 4: Download results
// ═══════════════════════════════════════
console.log('\n📥 Step 4: Downloading results...');
const finalBatch = await apiCall(`/batches/${batch.id}`);
const outputFileId = finalBatch.output_file_id;

const downloadResp = await fetch(`${BASE}/files/${outputFileId}/content`, { headers });
const resultText = await downloadResp.text();
writeFileSync(OUTPUT_FILE, resultText, 'utf-8');

const lines = resultText.split('\n').filter(l => l.trim());
console.log(`  ✅ Downloaded ${lines.length} results → ${OUTPUT_FILE}\n`);

// ═══════════════════════════════════════
// STEP 5: Parse results & show summary
// ═══════════════════════════════════════
console.log('📊 Step 5: Parsing SCT results...');
let success = 0, failed = 0;

for (const line of lines) {
  try {
    const result = JSON.parse(line);
    if (result.response?.body?.choices?.[0]?.message?.content) {
      success++;
    } else {
      failed++;
    }
  } catch {
    failed++;
  }
}

console.log(`  ✅ Success: ${success}`);
console.log(`  ❌ Failed: ${failed}`);
console.log(`\n  Next: Run 'node ingestion/sct-inject.mjs' to add SCT cases to dataset.`);
console.log('══════════════════════════════════════\n');
