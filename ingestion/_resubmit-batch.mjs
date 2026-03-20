/**
 * Submit next Holy Trinity chunk from remaining.jsonl
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { request } from 'node:https';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = join(__dirname, 'output');
const env = readFileSync(join(__dirname, '..', '.env'), 'utf8');
const API_KEY = env.match(/OPENAI_API_KEY=(.+)/)?.[1]?.trim();

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
    }, (res) => {
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
    }, (res) => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => res.statusCode >= 400 ? reject(new Error(`${res.statusCode}: ${d.slice(0,300)}`)) : resolve(JSON.parse(d)));
    });
    req.on('error', reject); req.write(data); req.end();
  });
}

async function main() {
  const CHUNK_SIZE = 2000;
  const remainingPath = join(OUTPUT_DIR, 'holy_trinity_remaining.jsonl');
  
  if (!existsSync(remainingPath)) {
    console.log('No remaining.jsonl found — all chunks submitted!');
    return;
  }

  const allLines = readFileSync(remainingPath, 'utf8').trim().split('\n');
  console.log(`📦 Remaining: ${allLines.length} requests`);

  const chunk = allLines.slice(0, CHUNK_SIZE);
  const remaining = allLines.slice(CHUNK_SIZE);
  const chunkNum = String.fromCharCode(66 + Math.floor((16000 - allLines.length) / CHUNK_SIZE)); // B, C, D...

  const chunkPath = join(OUTPUT_DIR, `holy_trinity_chunk_${chunkNum.toLowerCase()}.jsonl`);
  writeFileSync(chunkPath, chunk.join('\n'), 'utf8');

  if (remaining.length > 0) {
    writeFileSync(remainingPath, remaining.join('\n'), 'utf8');
  } else {
    writeFileSync(remainingPath, '', 'utf8');
  }

  console.log(`   Chunk ${chunkNum}: ${chunk.length} requests (submitting)`);
  console.log(`   Still remaining: ${remaining.length}`);

  console.log('\n⬆️  Uploading...');
  const file = await uploadFile(chunkPath, `holy_trinity_chunk_${chunkNum.toLowerCase()}.jsonl`);
  console.log(`   File ID: ${file.id}`);

  console.log('🚀 Submitting batch...');
  const batch = await apiPost('/v1/batches', {
    input_file_id: file.id,
    endpoint: '/v1/chat/completions',
    completion_window: '24h',
    metadata: { description: `Holy Trinity chunk ${chunkNum} (2K)` },
  });

  console.log(`✅ Batch ID: ${batch.id} | Status: ${batch.status}`);
  console.log(`\n⏳ Run this script again after completion for next chunk.`);
}

main().catch(err => { console.error('❌', err.message); process.exitCode = 1; });
