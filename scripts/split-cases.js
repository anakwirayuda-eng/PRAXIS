/**
 * PRAXIS — Horcrux Protocol: Case Splitter
 * 
 * Splits the 161MB compiled_cases.json into Cloudflare-safe chunks (< 20MB each).
 * Run AFTER obfuscate-dist.js in the build pipeline.
 *
 * Pipeline: vite build → obfuscate-dist.js → split-cases.js
 * Result: dist/data/manifest.json + dist/data/cases_part_1.json ... N
 */
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST_FILE = join(__dirname, '..', 'dist', 'data', 'compiled_cases.json');

if (!existsSync(DIST_FILE)) {
  console.log('[Horcrux] No dist/data/compiled_cases.json found. Skipping.');
  process.exit(0);
}

// ~2.5KB per case → 7000 cases ≈ 17.5MB per chunk (safe under CF 25MiB limit)
const CHUNK_SIZE = 7000;

console.log('[Horcrux] Reading compiled_cases.json...');
const data = JSON.parse(readFileSync(DIST_FILE, 'utf8'));
console.log(`[Horcrux] Total cases: ${data.length}`);

const chunks = [];
for (let i = 0; i < data.length; i += CHUNK_SIZE) {
  const chunkData = data.slice(i, i + CHUNK_SIZE);
  const fileName = `cases_part_${chunks.length + 1}.json`;
  const filePath = join(__dirname, '..', 'dist', 'data', fileName);
  writeFileSync(filePath, JSON.stringify(chunkData));
  const sizeMB = (readFileSync(filePath).length / 1024 / 1024).toFixed(1);
  console.log(`[Horcrux]   ${fileName}: ${chunkData.length} cases (${sizeMB}MB)`);
  chunks.push(fileName);
}

// Write manifest for streaming loader
const manifest = { chunks, totalCases: data.length, version: process.env.VITE_APP_VERSION || '1.0.0' };
writeFileSync(join(__dirname, '..', 'dist', 'data', 'manifest.json'), JSON.stringify(manifest));

// Remove the monster — Cloudflare would reject it anyway
unlinkSync(DIST_FILE);
console.log(`[Horcrux] ✅ Split into ${chunks.length} chunks. Original 161MB file destroyed.`);
console.log(`[Horcrux] Manifest written to dist/data/manifest.json`);
