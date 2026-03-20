/**
 * Full Dataset Audit — find all unwired data
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SOURCES = join(__dirname, 'sources');
const OUTPUT = join(__dirname, 'output');
const DB_PATH = join(__dirname, '..', 'public', 'data', 'compiled_cases.json');

// Get compiled sources
const db = JSON.parse(readFileSync(DB_PATH, 'utf8'));
const compiledSources = {};
for (const c of db) {
  const s = c.meta?.source || 'unknown';
  compiledSources[s] = (compiledSources[s] || 0) + 1;
}

console.log('📋 FULL DATASET AUDIT');
console.log('━'.repeat(80));

// 1. Check source directories
console.log('\n📂 SOURCE DIRECTORIES:');
console.log('─'.repeat(80));
const dirs = readdirSync(SOURCES).filter(d => statSync(join(SOURCES, d)).isDirectory());
for (const d of dirs.sort()) {
  const files = readdirSync(join(SOURCES, d));
  const jsonFiles = files.filter(f => f.endsWith('.json') || f.endsWith('.csv'));
  const totalSize = files.reduce((sum, f) => {
    try { return sum + statSync(join(SOURCES, d, f)).size; } catch { return sum; }
  }, 0);
  
  // Check if this source appears in compiled
  const inCompiled = Object.entries(compiledSources).find(([k]) => k.includes(d.replace('sources/', '')));
  
  let status = '❓ UNKNOWN';
  let sampleLang = '';
  
  if (totalSize < 10) {
    status = '🔴 EMPTY';
  } else if (inCompiled) {
    status = `✅ WIRED (${inCompiled[1].toLocaleString()} cases as "${inCompiled[0]}")`;
  } else {
    status = '🟡 NOT WIRED';
    // Check language
    const rawFile = jsonFiles.find(f => f.includes('raw'));
    if (rawFile) {
      try {
        const raw = JSON.parse(readFileSync(join(SOURCES, d, rawFile), 'utf8'));
        const items = Array.isArray(raw) ? raw : Object.values(raw).flat();
        if (items.length > 0) {
          const sample = items[0];
          const text = sample.question || sample.prompt || sample.vignette || sample.text || JSON.stringify(sample).slice(0, 200);
          status += ` (${items.length} items)`;
          sampleLang = text.slice(0, 100);
        }
      } catch {}
    }
  }
  
  console.log(`  ${d.padEnd(25)} ${(totalSize/1024/1024).toFixed(1).padStart(6)}MB  ${status}`);
  if (sampleLang) console.log(`${''.padEnd(38)}Sample: "${sampleLang}..."`);
}

// 2. Check output raw files
console.log('\n📄 RAW OUTPUT FILES (not in sources/):');
console.log('─'.repeat(80));
const outputFiles = readdirSync(OUTPUT).filter(f => f.endsWith('_raw.json'));
for (const f of outputFiles.sort()) {
  const path = join(OUTPUT, f);
  const size = statSync(path).size;
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    const items = Array.isArray(raw) ? raw : Object.values(raw).flat();
    const sample = items[0];
    const text = (sample?.question || sample?.prompt || sample?.text || '').slice(0, 80);
    const sourceName = f.replace('_raw.json', '').replace(/_/g, '-');
    const inCompiled = Object.entries(compiledSources).find(([k]) => k.includes(sourceName) || sourceName.includes(k));
    
    const status = inCompiled ? `✅ WIRED (${inCompiled[1]})` : '🟡 NOT WIRED';
    console.log(`  ${f.padEnd(30)} ${items.length.toString().padStart(6)} items  ${(size/1024/1024).toFixed(1).padStart(5)}MB  ${status}`);
    if (!inCompiled) console.log(`${''.padEnd(42)}Lang sample: "${text}"`);
  } catch { console.log(`  ${f.padEnd(30)} (parse error)`); }
}

// 3. Language distribution in compiled
console.log('\n🌐 COMPILED SOURCE DISTRIBUTION:');
console.log('─'.repeat(60));
for (const [source, count] of Object.entries(compiledSources).sort((a,b) => b[1]-a[1])) {
  console.log(`  ${source.padEnd(30)} ${count.toLocaleString().padStart(7)}`);
}
