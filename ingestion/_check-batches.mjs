import { readFileSync } from 'node:fs';
import { get } from 'node:https';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const env = readFileSync(join(__dirname, '..', '.env'), 'utf8');
const API_KEY = env.match(/OPENAI_API_KEY=(.+)/)?.[1]?.trim();

function apiGet(path) {
  return new Promise((resolve, reject) => {
    get({ hostname: 'api.openai.com', path, headers: { 'Authorization': `Bearer ${API_KEY}` } }, (res) => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(JSON.parse(d)));
    }).on('error', reject);
  });
}

async function main() {
  const list = await apiGet('/v1/batches?limit=30');
  console.log('📡 OpenAI Batch Status Report');
  console.log('━'.repeat(90));
  console.log('ID'.padEnd(42) + 'Status'.padEnd(14) + 'Reqs'.padEnd(8) + 'Done'.padEnd(8) + 'Fail'.padEnd(8) + 'Created');
  console.log('─'.repeat(90));
  
  for (const b of list.data) {
    const created = new Date(b.created_at * 1000).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
    const total = b.request_counts?.total || '?';
    const done = b.request_counts?.completed || 0;
    const fail = b.request_counts?.failed || 0;
    const statusIcon = { completed: '✅', in_progress: '⏳', validating: '🔄', failed: '❌', expired: '⏰', cancelling: '🛑', cancelled: '🛑' }[b.status] || '❓';
    console.log(`${b.id}  ${statusIcon} ${b.status.padEnd(12)} ${String(total).padEnd(8)}${String(done).padEnd(8)}${String(fail).padEnd(8)}${created}`);
  }
}

main().catch(console.error);
