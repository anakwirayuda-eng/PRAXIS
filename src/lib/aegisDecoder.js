/**
 * PRAXIS — Aegis Runtime Decoder
 * Domain-bound XOR decryption for obfuscated case data.
 * 
 * Only decrypts correctly when running on authorized domains.
 * On pirated domains, rationale/answers become gibberish.
 */

// Authorized domains — update when deploying to new domains
const AUTHORIZED_DOMAINS = [
  'localhost',
  'praxis.pages.dev',
  // Add your custom domain here when ready:
  // 'praxis-medcase.com',
];

function getDecryptionKey() {
  try {
    const host = window.location.hostname;
    if (AUTHORIZED_DOMAINS.some(d => host === d || host.endsWith(`.${d}`))) {
      return 'PRAXIS_AEGIS_2026_SEAL'; // Must match obfuscate-cases.js
    }
  } catch { /* SSR/test environment */ }
  return 'MALING_DETECTED_DEBU_KOSMIK'; // Wrong key = gibberish output
}

function xorDecode(encoded, key) {
  if (!encoded || typeof encoded !== 'string') return '';
  try {
    // Decode base64 → binary → XOR with key
    const bytes = atob(encoded);
    const result = [];
    for (let i = 0; i < bytes.length; i++) {
      result.push(String.fromCharCode(bytes.charCodeAt(i) ^ key.charCodeAt(i % key.length)));
    }
    return result.join('');
  } catch {
    return '[Decryption failed]';
  }
}

/**
 * Decode obfuscated fields on a single case object.
 * Called during normalization in caseLoader.js.
 * 
 * Encrypted fields:
 *   _xc  → rationale.correct
 *   _xp  → rationale.pearl  
 *   _xbm → options[].is_correct (bitmap string "01001")
 */
export function deobfuscateCase(rawCase) {
  if (!rawCase) return rawCase;
  
  const key = getDecryptionKey();
  
  // Decode rationale
  if (rawCase.rationale?._xc) {
    rawCase.rationale.correct = xorDecode(rawCase.rationale._xc, key);
    delete rawCase.rationale._xc;
  }
  if (rawCase.rationale?._xp) {
    rawCase.rationale.pearl = xorDecode(rawCase.rationale._xp, key);
    delete rawCase.rationale._xp;
  }
  
  // Decode answer bitmap
  if (rawCase._xbm && Array.isArray(rawCase.options)) {
    const bitmap = xorDecode(rawCase._xbm, key);
    rawCase.options.forEach((opt, i) => {
      opt.is_correct = bitmap[i] === '1';
    });
    delete rawCase._xbm;
  }
  
  return rawCase;
}

/**
 * Check if case data is obfuscated (has _xc or _xbm fields).
 * Used to decide whether to run deobfuscation pass.
 */
export function isObfuscated(sampleCase) {
  return !!(sampleCase?.rationale?._xc || sampleCase?._xbm);
}
