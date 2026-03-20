/**
 * Submit 3,083 no-rationale cases to batch API for explanation generation
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { request } from 'node:https';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const env = readFileSync(join(__dirname, '..', '.env'), 'utf8');
const API_KEY = env.match(/OPENAI_API_KEY=(.+)/)?.[1]?.trim();
const OUT = join(__dirname, 'output');

const db = JSON.parse(readFileSync(join(__dirname, '..', 'public', 'data', 'compiled_cases.json'), 'utf8'));
const noRat = db.filter(c => {
  const r = (c.rationale?.correct || '').trim();
  return r.length < 20 && Array.isArray(c.options) && c.options.length >= 2;
});
console.log(`Cases without rationale: ${noRat.length}`);

const lines = noRat.map(c => {
  const correct = c.options.find(o => o.is_correct);
  const optText = c.options.map(o => `${o.id}. ${o.text}`).join('\n');
  const q = c.question || c.vignette?.narrative || c.prompt || '';
  return JSON.stringify({
    custom_id: `rationale|${c.meta?.source || 'unknown'}|${c._id}`,
    method: 'POST',
    url: '/v1/chat/completions',
    body: {
      model: 'gpt-4.1-mini',
      max_tokens: 500,
      response_format: { type: 'json_object' },
      messages: [{
        role: 'system',
        content: 'You are a medical education expert. Given a question, options, and correct answer, provide a clear educational rationale. Write in Indonesian. Return JSON: {"rationale":"clear 2-3 sentence explanation of why the correct answer is right and key differentiators","pearl":"one-line clinical pearl for memorization"}'
      }, {
        role: 'user',
        content: `Question: ${q}\n\nOptions:\n${optText}\n\nCorrect answer: ${correct?.id || '?'}. ${correct?.text || '?'}\n\nProvide rationale and clinical pearl in Indonesian.`
      }]
    }
  });
});

// Split into batches of 2000
const CHUNK = 2000;
const chunks = [];
for (let i = 0; i < lines.length; i += CHUNK) {
  chunks.push(lines.slice(i, i + CHUNK));
}

function uploadFile(filepath, filename) {
  return new Promise((resolve, reject) => {
    const fileContent = readFileSync(filepath);
    const boundary = '----FormBoundary' + Date.now();
    let body = `--${boundary}\r\nContent-Disposition: form-data; name="purpose"\r\n\r\nbatch\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/jsonl\r\n\r\n`;
    const prefix = Buffer.from(body);
    const suffix = Buffer.from(`\r\n--${boundary}--\r\n`);
    const fullBody = Buffer.concat([prefix, fileContent, suffix]);
    const req = request({
      hostname: 'api.openai.com', path: '/v1/files', method: 'POST',
      headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': fullBody.length },
    }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => res.statusCode >= 400 ? reject(new Error(`${res.statusCode}: ${d.slice(0,300)}`)) : resolve(JSON.parse(d)));
    });
    req.on('error', reject); req.write(fullBody); req.end();
  });
}

function apiPost(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = request({
      hostname: 'api.openai.com', path, method: 'POST',
      headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
    }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => res.statusCode >= 400 ? reject(new Error(`${res.statusCode}: ${d.slice(0,300)}`)) : resolve(JSON.parse(d)));
    });
    req.on('error', reject); req.write(data); req.end();
  });
}

async function main() {
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const batchPath = join(OUT, `rationale_batch_${i}.jsonl`);
    writeFileSync(batchPath, chunk.join('\n'), 'utf8');
    console.log(`\n📦 Chunk ${i}: ${chunk.length} prompts`);

    console.log('   ⬆️  Uploading...');
    const file = await uploadFile(batchPath, `rationale_batch_${i}.jsonl`);
    console.log(`   File ID: ${file.id}`);

    console.log('   🚀 Submitting batch...');
    const batch = await apiPost('/v1/batches', {
      input_file_id: file.id,
      endpoint: '/v1/chat/completions',
      completion_window: '24h',
      metadata: { description: `Rationale generation chunk ${i} (${chunk.length} cases)` },
    });
    console.log(`   ✅ Batch ID: ${batch.id} | Status: ${batch.status}`);
  }
  console.log(`\n🎯 Total submitted: ${lines.length} | Estimated cost: ~$${(lines.length * 0.0003).toFixed(2)}`);
}

main().catch(err => { console.error('❌', err.message); process.exitCode = 1; });
