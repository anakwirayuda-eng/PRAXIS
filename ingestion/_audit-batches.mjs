/**
 * Full Batch Audit — map ALL batch runs to their purpose and whether results were applied
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, 'output');

// Check what batch info files we have
console.log('═══ BATCH INFO FILES ═══');
const infoFiles = readdirSync(OUT).filter(f => f.includes('info') && f.endsWith('.json'));
for (const f of infoFiles) {
  const data = JSON.parse(readFileSync(join(OUT, f), 'utf8'));
  console.log(`\n📄 ${f}:`);
  if (Array.isArray(data)) {
    data.forEach(b => console.log(`   ${b.id || b.batch_id}: ${b.status || '?'} | ${b.description || b.metadata?.description || '?'}`));
  } else {
    console.log(`   ${JSON.stringify(data).slice(0, 200)}`);
  }
}

// Check result files
console.log('\n\n═══ RESULT FILES (downloaded outputs) ═══');
const resultFiles = readdirSync(OUT).filter(f => f.includes('result') && f.endsWith('.jsonl'));
for (const f of resultFiles) {
  const lines = readFileSync(join(OUT, f), 'utf8').trim().split('\n').filter(Boolean);
  console.log(`  ${f}: ${lines.length} results`);
}

// Check needs_review_batches (input files)
const batchDir = join(OUT, 'needs_review_batches');
if (existsSync(batchDir)) {
  const batchFiles = readdirSync(batchDir).filter(f => f.endsWith('.jsonl'));
  console.log(`\n\n═══ NEEDS_REVIEW_BATCHES (input batch files) ═══`);
  console.log(`  ${batchFiles.length} batch input files`);
  // Check first file for custom_id format
  if (batchFiles.length > 0) {
    const firstLines = readFileSync(join(batchDir, batchFiles[0]), 'utf8').trim().split('\n').slice(0, 2);
    firstLines.forEach(l => {
      try { const p = JSON.parse(l); console.log(`  Sample custom_id: ${p.custom_id}`); } catch {}
    });
  }
}

// Check needs_review_results (output from older batches)
const resultDir = join(OUT, 'needs_review_results');
if (existsSync(resultDir)) {
  const rFiles = readdirSync(resultDir);
  console.log(`\n\n═══ NEEDS_REVIEW_RESULTS (downloaded batch outputs) ═══`);
  console.log(`  ${rFiles.length} files`);
  rFiles.slice(0, 5).forEach(f => console.log(`  ${f}`));
} else {
  console.log('\n\n⚠️  needs_review_results/ directory does NOT exist — batch results NOT downloaded!');
}

// Check holy trinity chunks
console.log('\n\n═══ HOLY TRINITY CHUNKS ═══');
const htFiles = readdirSync(OUT).filter(f => f.startsWith('holy_trinity'));
htFiles.forEach(f => {
  const size = readFileSync(join(OUT, f)).length;
  console.log(`  ${f}: ${(size/1024).toFixed(0)}KB`);
});

// Check god-tier and fase2
console.log('\n\n═══ OTHER BATCH CONFIGS ═══');
const others = ['god_tier_batches.json', 'fase2_batch_chunks.json', 'fase2_batch_info.json'];
for (const f of others) {
  const p = join(OUT, f);
  if (existsSync(p)) {
    const data = JSON.parse(readFileSync(p, 'utf8'));
    console.log(`  ${f}: ${JSON.stringify(data).slice(0, 300)}`);
  }
}
