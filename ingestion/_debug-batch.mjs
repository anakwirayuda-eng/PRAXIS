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
  const failedIds = [
    'batch_69bb15f2e09881909aa0f22b7c94a55e',
    'batch_69bb15e1a0a48190b6e1313e73357b63',
  ];
  
  for (const id of failedIds) {
    console.log(`\n🔍 Checking ${id}...`);
    const batch = await apiGet(`/v1/batches/${id}`);
    console.log(`   Status: ${batch.status}`);
    console.log(`   Errors:`, JSON.stringify(batch.errors, null, 2));
    if (batch.error_file_id) {
      console.log(`   Error file: ${batch.error_file_id}`);
      try {
        const errContent = await apiGet(`/v1/files/${batch.error_file_id}/content`);
        console.log(`   Error content (first 500 chars):`, typeof errContent === 'string' ? errContent.slice(0, 500) : JSON.stringify(errContent).slice(0, 500));
      } catch (e) { console.log(`   Could not read error file: ${e.message}`); }
    }
  }
}

main().catch(console.error);
