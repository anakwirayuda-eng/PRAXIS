/**
 * Holy Trinity Mega-Batch Builder
 * 
 * Hack 1: Merge rationale + distractor + pearl into ONE call
 * Hack 2: Sort by category for OpenAI prompt caching (50% input discount)
 * 
 * Builds JSONL batch file(s) for OpenAI Batch API, then uploads and submits.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { request } from 'node:https';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, '..', 'public', 'data', 'compiled_cases.json');
const OUTPUT_DIR = join(__dirname, 'output');
const ENV_PATH = join(__dirname, '..', '.env');

if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });

const env = readFileSync(ENV_PATH, 'utf8');
const API_KEY = env.match(/OPENAI_API_KEY=(.+)/)?.[1]?.trim();
if (!API_KEY) { console.error('No OPENAI_API_KEY'); process.exit(1); }

// ── Placeholder detection ──
const PLACEHOLDER_PATTERNS = [
  /^see reference/i,
  /^explanation unavailable/i,
  /^no explanation available/i,
  /^refer to textbook/i,
  /^not available/i,
  /^n\/a$/i,
  /^-$/,
  /^\.$/,
  /^none$/i,
  /^\s*$/,
];

function isPlaceholder(text) {
  if (!text || text.length < 15) return true;
  return PLACEHOLDER_PATTERNS.some(p => p.test(text.trim()));
}

function needsRationale(c) {
  if (c.meta?.quarantined) return false;
  if (!c.options?.some(o => o.is_correct)) return false; // skip no-answer cases
  
  const r = c.rationale;
  if (!r) return true;
  if (typeof r === 'string') return isPlaceholder(r);
  if (typeof r === 'object') return isPlaceholder(r.correct);
  return true;
}

// ── System prompt (shared prefix for caching) ──
const SYSTEM_PROMPT = `You are the Chief Medical Editor of a board-exam preparation platform (like Amboss/UWorld).

Your task: Transform a raw medical MCQ into a premium learning object by writing a comprehensive rationale.

Requirements:
1. "correct_rationale": 2-4 sentences explaining WHY the correct answer is right. Cite the pathophysiology, mechanism of action, clinical guideline, or diagnostic criteria. Be specific — mention the disease name, the relevant pathway, or the clinical finding that confirms the diagnosis.

2. "distractors": For EACH wrong option, write 1-2 sentences explaining why it is incorrect in this clinical context. Use the option letter as the key (e.g., "A", "B", "C", "D", "E").

3. "clinical_pearl": One ultra high-yield memorization fact for board exams. Make it catchy, specific, and clinically actionable. Use mnemonics when possible.

Return valid JSON with exactly these three keys: correct_rationale, distractors, clinical_pearl.
Do NOT include markdown formatting, code blocks, or any text outside the JSON object.`;

console.log('🔱 Holy Trinity Mega-Batch Builder');
console.log('━'.repeat(60));

const db = JSON.parse(readFileSync(DB_PATH, 'utf8'));

// Filter cases needing rationale
const candidates = db.filter(needsRationale);
console.log(`📊 Cases needing rationale: ${candidates.length.toLocaleString()} of ${db.length.toLocaleString()}`);

// Hack 2: Sort by category for prompt caching
candidates.sort((a, b) => (a.category || '').localeCompare(b.category || ''));

// Build batch requests
const requests = [];
for (const c of candidates) {
  const correctOpt = c.options.find(o => o.is_correct);
  const wrongOpts = c.options
    .filter(o => !o.is_correct)
    .map(o => `${o.id}. ${o.text}`)
    .join('\n');

  const questionText = c.vignette?.narrative || c.question || c.prompt || c.title || '';
  const promptText = c.prompt || '';
  
  // Build user message
  const userMsg = [
    `Question: ${questionText}`,
    promptText && promptText !== questionText ? `\nPrompt: ${promptText}` : '',
    `\nCorrect Answer: ${correctOpt.id}. ${correctOpt.text}`,
    `\nWrong Options:\n${wrongOpts}`,
  ].filter(Boolean).join('');

  requests.push({
    custom_id: `enrich|${c.meta?.source || 'unknown'}|${c._id}`,
    method: "POST",
    url: "/v1/chat/completions",
    body: {
      model: "gpt-4o-mini",
      temperature: 0.2,
      max_tokens: 600,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userMsg },
      ],
    },
  });
}

console.log(`📦 Total requests: ${requests.length.toLocaleString()}`);

// Split into batches of 8000 (OpenAI limit)
const BATCH_SIZE = 8000;
const batchFiles = [];

for (let i = 0; i < requests.length; i += BATCH_SIZE) {
  const chunk = requests.slice(i, i + BATCH_SIZE);
  const batchNum = Math.floor(i / BATCH_SIZE) + 1;
  const filename = `holy_trinity_batch_${batchNum}.jsonl`;
  const filepath = join(OUTPUT_DIR, filename);
  
  writeFileSync(filepath, chunk.map(r => JSON.stringify(r)).join('\n'), 'utf8');
  batchFiles.push({ filepath, filename, count: chunk.length });
  console.log(`   📄 ${filename}: ${chunk.length.toLocaleString()} requests`);
}

// ── Upload & Submit ──
function apiRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = typeof body === 'string' ? body : (body ? JSON.stringify(body) : '');
    const isMultipart = typeof body === 'object' && body?.boundary;
    
    const opts = {
      hostname: 'api.openai.com',
      path,
      method,
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        ...(isMultipart 
          ? { 'Content-Type': `multipart/form-data; boundary=${body.boundary}` }
          : bodyStr ? { 'Content-Type': 'application/json' } : {}
        ),
      },
    };

    const req = request(opts, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 500)}`));
        } else {
          resolve(JSON.parse(data));
        }
      });
    });
    req.on('error', reject);
    if (isMultipart) {
      req.write(body.data);
    } else if (bodyStr) {
      req.write(bodyStr);
    }
    req.end();
  });
}

function uploadFile(filepath, filename) {
  return new Promise((resolve, reject) => {
    const fileContent = readFileSync(filepath);
    const boundary = '----FormBoundary' + Date.now();
    
    let body = '';
    body += `--${boundary}\r\n`;
    body += `Content-Disposition: form-data; name="purpose"\r\n\r\n`;
    body += `batch\r\n`;
    body += `--${boundary}\r\n`;
    body += `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n`;
    body += `Content-Type: application/jsonl\r\n\r\n`;
    
    const prefix = Buffer.from(body);
    const suffix = Buffer.from(`\r\n--${boundary}--\r\n`);
    const fullBody = Buffer.concat([prefix, fileContent, suffix]);

    const opts = {
      hostname: 'api.openai.com',
      path: '/v1/files',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': fullBody.length,
      },
    };

    const req = request(opts, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 400) {
          reject(new Error(`Upload failed ${res.statusCode}: ${data.slice(0, 500)}`));
        } else {
          resolve(JSON.parse(data));
        }
      });
    });
    req.on('error', reject);
    req.write(fullBody);
    req.end();
  });
}

async function main() {
  console.log('');
  console.log('📡 Uploading and submitting batches to OpenAI...');
  
  const batchIds = [];
  
  for (const bf of batchFiles) {
    // Upload file
    console.log(`\n⬆️  Uploading ${bf.filename} (${bf.count} requests)...`);
    const file = await uploadFile(bf.filepath, bf.filename);
    console.log(`   File ID: ${file.id}`);
    
    // Submit batch
    console.log(`   🚀 Submitting batch...`);
    const batch = await apiRequest('POST', '/v1/batches', {
      input_file_id: file.id,
      endpoint: '/v1/chat/completions',
      completion_window: '24h',
      metadata: { description: `Holy Trinity rationale enrichment - ${bf.filename}` },
    });
    
    console.log(`   ✅ Batch ID: ${batch.id} | Status: ${batch.status}`);
    batchIds.push(batch.id);
  }
  
  // Cost estimate
  const avgInputTokens = 350; // ~350 tokens per question
  const avgOutputTokens = 400; // ~400 tokens per rationale
  const inputCost = (requests.length * avgInputTokens / 1_000_000) * 0.075; // batch = 50% off $0.15
  const outputCost = (requests.length * avgOutputTokens / 1_000_000) * 0.30;  // batch = 50% off $0.60
  const totalCost = inputCost + outputCost;
  
  console.log('\n' + '━'.repeat(60));
  console.log('🎉 ALL BATCHES SUBMITTED!');
  console.log(`   Batch IDs: ${batchIds.join(', ')}`);
  console.log(`   Total requests: ${requests.length.toLocaleString()}`);
  console.log(`   💰 Estimated cost: $${totalCost.toFixed(2)} (with 50% batch discount)`);
  console.log('');
  console.log('⏰ OpenAI will process overnight. Check status tomorrow:');
  console.log('   node ingestion/download-batch-results.mjs');
}

main().catch(err => {
  console.error('❌ Failed:', err.message);
  process.exitCode = 1;
});
