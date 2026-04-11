/**
 * PRAXIS — Aegis Seal 1: XOR Obfuscation Pipeline
 * 
 * Pre-build script that encrypts sensitive fields (rationale, is_correct)
 * in compiled_cases.json. The runtime decrypts using a domain-bound key.
 *
 * Usage: node scripts/obfuscate-cases.js
 * Run BEFORE `vite build` in production. Add to package.json build script.
 */
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const INPUT = join(__dirname, '..', 'public', 'data', 'compiled_cases.json');
const OUTPUT = INPUT; // Overwrite in-place (git tracks original)

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

// ─── Fields to Protect ───
// - rationale.correct (AI explanations — core IP)
// - rationale.pearl (clinical pearls)
// - options[].is_correct (answer key)
function obfuscateCase(c) {
  // Protect rationale
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

  // Protect answer key — shuffle is_correct into XOR'd bitmap
  if (Array.isArray(c.options)) {
    const bitmap = c.options.map(o => o.is_correct ? 1 : 0).join('');
    c._xbm = xorEncode(bitmap, OBFUSCATION_KEY);
    c.options.forEach(o => delete o.is_correct);
  }

  return c;
}

// ─── Main ───
console.log('[Aegis] Reading compiled_cases.json...');
const cases = JSON.parse(readFileSync(INPUT, 'utf8'));
console.log(`[Aegis] Obfuscating ${cases.length} cases...`);

let protected_count = 0;
for (const c of cases) {
  obfuscateCase(c);
  protected_count++;
}

writeFileSync(OUTPUT, JSON.stringify(cases));
const sizeMB = (readFileSync(OUTPUT).length / 1024 / 1024).toFixed(1);
console.log(`[Aegis] ✅ ${protected_count} cases obfuscated. Output: ${sizeMB}MB`);
console.log(`[Aegis] Fields encrypted: rationale.correct → _xc, rationale.pearl → _xp, is_correct → _xbm`);
