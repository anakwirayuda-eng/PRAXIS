/**
 * PRAXIS — Sprint 2 Security Suite
 * "Asymmetric Profilaxis" — layered defenses against piracy & tampering
 * 
 * Features:
 *   1. React DevTools Killswitch (production only)
 *   2. Forensic Steganography (zero-width user fingerprint)
 *   3. State Tamper-Proofing (Zustand hash seal)
 *   4. Console honeypot warning  
 */

// ═══════════════════════════════════════
// 1. REACT DEVTOOLS KILLSWITCH
// Disables React DevTools extension in production
// ═══════════════════════════════════════
export function killDevTools() {
  if (import.meta.env.DEV) return; // Allow in dev mode
  
  try {
    // Method 1: Neuter React DevTools global hook
    if (typeof window.__REACT_DEVTOOLS_GLOBAL_HOOK__ === 'object') {
      const noop = () => {};
      const hook = window.__REACT_DEVTOOLS_GLOBAL_HOOK__;
      // Freeze all methods to prevent tree inspection
      for (const prop of Object.keys(hook)) {
        if (typeof hook[prop] === 'function') {
          hook[prop] = noop;
        }
      }
      hook.inject = noop;
      hook.onCommitFiberRoot = noop;
      hook.onCommitFiberUnmount = noop;
    }

    // Method 2: Prevent future injection
    Object.defineProperty(window, '__REACT_DEVTOOLS_GLOBAL_HOOK__', {
      value: { isDisabled: true },
      writable: false,
      configurable: false,
    });
  } catch { /* silently fail in restricted environments */ }
}

// ═══════════════════════════════════════
// 2. FORENSIC STEGANOGRAPHY
// Invisible zero-width character fingerprint embedded in displayed text.
// If someone copies rationale text → fingerprint goes with it.
// We can trace which user leaked the content.
// ═══════════════════════════════════════
const ZWSP = '\u200B'; // zero-width space
const ZWJ  = '\u200D'; // zero-width joiner

function textToBinary(text) {
  return Array.from(text).map(c => c.charCodeAt(0).toString(2).padStart(8, '0')).join('');
}

/**
 * Embed an invisible fingerprint into text using zero-width characters.
 * @param {string} text - The visible text to watermark
 * @param {string} userId - User hash to embed (max 8 chars for reasonable length)
 * @returns {string} Same visible text, but with invisible fingerprint
 */
export function embedFingerprint(text, userId) {
  if (!text || !userId) return text;
  const short = userId.slice(0, 8);
  const binary = textToBinary(short);
  // Encode binary: 0 = ZWSP, 1 = ZWJ
  const stegoChars = binary.split('').map(b => b === '0' ? ZWSP : ZWJ).join('');
  // Insert fingerprint after first sentence or at position 50
  const insertPos = Math.min(text.indexOf('. ') + 2 || 50, 50);
  return text.slice(0, insertPos) + stegoChars + text.slice(insertPos);
}

/**
 * Extract fingerprint from watermarked text.
 * @param {string} text - Potentially watermarked text
 * @returns {string|null} Extracted user hash or null
 */
export function extractFingerprint(text) {
  if (!text) return null;
  const stegoChars = text.replace(/[^\u200B\u200D]/g, '');
  if (stegoChars.length < 8) return null;
  const binary = stegoChars.split('').map(c => c === ZWSP ? '0' : '1').join('');
  const chars = [];
  for (let i = 0; i < binary.length; i += 8) {
    const byte = binary.slice(i, i + 8);
    if (byte.length === 8) chars.push(String.fromCharCode(parseInt(byte, 2)));
  }
  return chars.join('') || null;
}

// ═══════════════════════════════════════
// 3. STATE TAMPER-PROOFING (Hash Seal)
// Creates a hash of critical state to detect localStorage manipulation.
// ═══════════════════════════════════════
const SEAL_KEY = 'PRAXIS_INTEGRITY_2026';

async function hashData(data) {
  const msgBuffer = new TextEncoder().encode(data + SEAL_KEY);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Seal state data with integrity hash.
 * Store the returned seal alongside your data.
 */
export async function sealState(key, data) {
  try {
    const json = JSON.stringify(data);
    const hash = await hashData(json);
    localStorage.setItem(key, json);
    localStorage.setItem(`${key}_seal`, hash);
    return true;
  } catch {
    return false;
  }
}

/**
 * Verify and retrieve sealed state.
 * Returns null if tampered (hash mismatch).
 */
export async function unsealState(key) {
  try {
    const json = localStorage.getItem(key);
    const storedHash = localStorage.getItem(`${key}_seal`);
    if (!json || !storedHash) return null;
    const computedHash = await hashData(json);
    if (computedHash !== storedHash) {
      console.warn(`🚨 [PRAXIS] State tampering detected on key: ${key}`);
      // Wipe compromised data
      localStorage.removeItem(key);
      localStorage.removeItem(`${key}_seal`);
      return null;
    }
    return JSON.parse(json);
  } catch {
    return null;
  }
}

// ═══════════════════════════════════════
// 4. CONSOLE HONEYPOT WARNING
// Intimidating message to deter casual tamperers
// ═══════════════════════════════════════
export function deployConsoleWarning() {
  if (import.meta.env.DEV) return;
  
  console.log(
    '%c⚠️ PRAXIS CYBER DEFENSE ACTIVE ⚠️',
    'color: #ff4444; font-size: 24px; font-weight: bold; text-shadow: 2px 2px #000;'
  );
  console.log(
    '%cArea ini dimonitor. Aktivitas mencurigakan akan dilaporkan ke sistem Aegis Shield dan dicatat untuk audit forensik.',
    'color: #ffaa00; font-size: 14px;'
  );
  console.log(
    '%c— Dr. Anak Agung Bagus Wirayuda, MD PhD\n   Institut Teknologi Sepuluh Nopember',
    'color: #888; font-size: 11px; font-style: italic;'
  );
}

// ═══════════════════════════════════════
// 5. BOOT — Call this once in App.jsx
// ═══════════════════════════════════════
export function initSecuritySuite() {
  killDevTools();
  deployConsoleWarning();
}
