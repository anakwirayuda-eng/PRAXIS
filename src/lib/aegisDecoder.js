/**
 * PRAXIS Aegis runtime decoder.
 *
 * Sensitive rationale fields are XOR-obfuscated in production builds and
 * transparently restored on approved PRAXIS Pages hosts.
 */

const AUTHORIZED_DOMAINS_EXACT = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
]);

// Allow both the project host and hashed deployment subdomains, for example:
// - praxis.pages.dev
// - praxis-el6.pages.dev
// - praxis-el6-e4n.pages.dev
// - 66b90ea7.praxis-el6.pages.dev
// - 66b90ea7.praxis-el6-e4n.pages.dev
const BLOODLINE_REGEX = /^(?:[a-z0-9-]+\.)?praxis(?:-[a-z0-9]+)*\.pages\.dev$/;

export function isAuthorizedAegisHost(host) {
  if (typeof host !== 'string') return false;
  const normalizedHost = host.trim().toLowerCase();
  if (!normalizedHost) return false;
  return AUTHORIZED_DOMAINS_EXACT.has(normalizedHost) || BLOODLINE_REGEX.test(normalizedHost);
}

function getRuntimeHost() {
  try {
    return window.location.hostname;
  } catch {
    return '';
  }
}

function getDecryptionKey() {
  if (isAuthorizedAegisHost(getRuntimeHost())) {
    return 'PRAXIS_AEGIS_2026_SEAL';
  }

  console.warn('[AEGIS] Unauthorized host detected. Returning decoy key.');
  return 'MALING_DETECTED_DEBU_KOSMIK';
}

function xorDecode(encoded, key) {
  if (!encoded || typeof encoded !== 'string') return '';

  try {
    const payload = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
    const keyBytes = new TextEncoder().encode(key);
    const result = new Uint8Array(payload.length);

    for (let index = 0; index < payload.length; index += 1) {
      result[index] = payload[index] ^ keyBytes[index % keyBytes.length];
    }

    return new TextDecoder().decode(result);
  } catch {
    return '[Decryption failed]';
  }
}

export function deobfuscateCase(rawCase) {
  if (!rawCase) return rawCase;

  const key = getDecryptionKey();

  if (rawCase.rationale?._xc) {
    rawCase.rationale.correct = xorDecode(rawCase.rationale._xc, key);
    delete rawCase.rationale._xc;
  }

  if (rawCase.rationale?._xp) {
    rawCase.rationale.pearl = xorDecode(rawCase.rationale._xp, key);
    delete rawCase.rationale._xp;
  }

  if (rawCase._xbm && Array.isArray(rawCase.options)) {
    const bitmap = xorDecode(rawCase._xbm, key);
    rawCase.options.forEach((option, index) => {
      option.is_correct = bitmap[index] === '1';
    });
    delete rawCase._xbm;
  }

  return rawCase;
}

export function isObfuscated(sampleCase) {
  return Boolean(sampleCase?.rationale?._xc || sampleCase?._xbm);
}
