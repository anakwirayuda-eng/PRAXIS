/**
 * Submit 303 no-correct-answer cases to OpenAI batch to determine correct answers
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { request } from 'node:https';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const env = readFileSync(join(__dirname, '..', '.env'), 'utf8');
const API_KEY = env.match(/OPENAI_API_KEY=(.+)/)?.[1]?.trim();
const OUT = join(__dirname, 'output');

const cases = JSON.parse(readFileSync(join(OUT, 'fix_124_no_answer.json'), 'utf8'));
console.log(`📋 Cases to fix: ${cases.length}`);

// Build JSONL
const lines = cases.map(c => {
  const optText = c.options.map(o => `${o.id}. ${o.text}`).join('\n');
  return JSON.stringify({
    custom_id: `fix-answer|${c.meta?.source || 'unknown'}|${c._id}`,
    method: 'POST',
    url: '/v1/chat/completions',
    body: {
      model: 'gpt-4.1-mini',
      max_tokens: 200,
      response_format: { type: 'json_object' },
      messages: [{
        role: 'system',
        content: 'You are a medical board exam expert. Given a question and options, determine the correct answer. Return JSON: {"correct_answer":"A","explanation":"brief reason"}'
      }, {
        role: 'user',
        content: `Question: ${c.question}\n\nOptions:\n${optText}\n\nWhich option is correct? Return JSON with correct_answer (letter) and explanation.`
      }]
    }
  });
});

const batchPath = join(OUT, 'fix_303_batch.jsonl');
writeFileSync(batchPath, lines.join('\n'), 'utf8');
console.log(`📝 Wrote ${lines.length} prompts to fix_303_batch.jsonl`);

// Upload and submit
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
  console.log('\n⬆️  Uploading...');
  const file = await uploadFile(batchPath, 'fix_303_batch.jsonl');
  console.log(`   File ID: ${file.id}`);

  console.log('🚀 Submitting batch...');
  const batch = await apiPost('/v1/batches', {
    input_file_id: file.id,
    endpoint: '/v1/chat/completions',
    completion_window: '24h',
    metadata: { description: 'Fix 303 no-correct-answer cases' },
  });
  console.log(`✅ Batch ID: ${batch.id} | Status: ${batch.status}`);
  console.log(`   Cost estimate: ~$0.09`);
}

main().catch(err => { console.error('❌', err.message); process.exitCode = 1; });
