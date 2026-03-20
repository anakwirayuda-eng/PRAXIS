/**
 * 🛸 THE UNIVERSAL VACUUM — Download ALL completed batch results from OpenAI
 * Skips already-downloaded files. Safe to re-run anytime.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { request } from 'node:https';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const env = readFileSync(join(__dirname, '..', '.env'), 'utf8');
const API_KEY = env.match(/OPENAI_API_KEY=(.+)/)?.[1]?.trim();
const OUT_DIR = join(__dirname, 'output', 'batch_results');
if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

function apiGet(path) {
  return new Promise((resolve, reject) => {
    const req = request({
      hostname: 'api.openai.com', path, method: 'GET',
      headers: { 'Authorization': `Bearer ${API_KEY}` },
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks);
        if (res.statusCode >= 400) return reject(new Error(`${res.statusCode}: ${body.toString().slice(0, 300)}`));
        resolve(body);
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function main() {
  console.log('🛸 Scanning OpenAI for completed batches...');
  
  // Fetch all batches (paginated)
  let allBatches = [];
  let after = '';
  while (true) {
    const url = `/v1/batches?limit=100${after ? `&after=${after}` : ''}`;
    const data = JSON.parse((await apiGet(url)).toString());
    allBatches.push(...data.data);
    if (!data.has_more) break;
    after = data.data[data.data.length - 1].id;
  }

  const completed = allBatches.filter(b => b.status === 'completed' && b.output_file_id);
  console.log(`📦 Found ${completed.length} completed batches with outputs.`);
  console.log(`   (${allBatches.length - completed.length} failed/cancelled/in-progress skipped)\n`);

  let downloaded = 0;
  let skipped = 0;

  // Process oldest first
  completed.reverse();

  for (const b of completed) {
    const filePath = join(OUT_DIR, `${b.id}.jsonl`);
    if (existsSync(filePath)) {
      skipped++;
      continue;
    }

    const created = new Date(b.created_at * 1000).toLocaleString('id-ID');
    const desc = b.metadata?.description || '?';
    console.log(`⬇️  ${b.id} | ${created} | ${desc}`);
    console.log(`   File: ${b.output_file_id} | Reqs: ${b.request_counts?.completed || '?'}`);

    try {
      const content = await apiGet(`/v1/files/${b.output_file_id}/content`);
      writeFileSync(filePath, content);
      const lines = content.toString().split('\n').filter(Boolean).length;
      console.log(`   ✅ ${(content.length / 1024).toFixed(0)}KB, ${lines} results\n`);
      downloaded++;
    } catch (err) {
      console.error(`   ❌ Failed: ${err.message}\n`);
    }
  }

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`✅ Download complete!`);
  console.log(`   Downloaded: ${downloaded} new files`);
  console.log(`   Skipped: ${skipped} (already exist)`);
  console.log(`   Output: ${OUT_DIR}`);
}

main().catch(err => { console.error('❌', err.message); process.exitCode = 1; });
