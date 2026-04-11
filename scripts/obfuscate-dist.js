/**
 * PRAXIS — Aegis Seal 1: Post-Build XOR Obfuscation
 * 
 * Encrypts sensitive fields in dist/data/compiled_cases.json AFTER vite build.
 * This way, public/data/ stays clean for local dev, and only the deployed
 * bundle is encrypted.
 *
 * Usage: Added to package.json build script:
 *   "build": "vite build && node scripts/obfuscate-dist.js"
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST_FILE = join(__dirname, '..', 'dist', 'data', 'compiled_cases.json');

if (!existsSync(DIST_FILE)) {
  console.log('[Aegis] No dist/data/compiled_cases.json found. Run `vite build` first.');
  process.exit(0);
}

// ─── XOR Engine ───
const OBFUSCATION_KEY = process.env.PRAXIS_OBF_KEY || 'PRAXIS_AEGIS_2026_SEAL';

function xorEncode(text, key) {
  if (!text || typeof text !== 'string') return text;
  const payload = new TextEncoder().encode(text);
  const keyBytes = new TextEncoder().encode(key);
  const result = new Uint8Array(payload.length);
  for (let i = 0; i < payload.length; i++) {
    result[i] = payload[i] ^ keyBytes[i % keyBytes.length];
  }
  return Buffer.from(result).toString('base64');
}

function obfuscateCase(c) {
  if (c.rationale) {
    if (c.rationale.correct) {
      c.rationale._xc = xorEncode(c.rationale.correct, OBFUSCATION_KEY);
      delete c.rationale.correct;
    }
    if (c.rationale.pearl) {
      c.rationale._xp = xorEncode(c.rationale.pearl, OBFUSCATION_KEY);
      delete c.rationale.pearl;
    }
  }
  if (Array.isArray(c.options)) {
    const bitmap = c.options.map(o => o.is_correct ? 1 : 0).join('');
    c._xbm = xorEncode(bitmap, OBFUSCATION_KEY);
    c.options.forEach(o => delete o.is_correct);
  }
  return c;
}

console.log('[Aegis] Encrypting dist/data/compiled_cases.json (post-build)...');
const cases = JSON.parse(readFileSync(DIST_FILE, 'utf8'));
for (const c of cases) obfuscateCase(c);
writeFileSync(DIST_FILE, JSON.stringify(cases));
const sizeMB = (readFileSync(DIST_FILE).length / 1024 / 1024).toFixed(1);
console.log(`[Aegis] ✅ ${cases.length} cases encrypted. Output: ${sizeMB}MB`);
console.log('[Aegis] public/data/ remains clean for local development.');
