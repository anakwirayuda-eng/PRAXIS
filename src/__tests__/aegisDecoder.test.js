import { describe, expect, it } from 'vitest';

import { deobfuscateCase, isAuthorizedAegisHost, isObfuscated } from '../lib/aegisDecoder.js';

const KEY = 'PRAXIS_AEGIS_2026_SEAL';

function xorEncode(text, key = KEY) {
  const payload = new TextEncoder().encode(text);
  const keyBytes = new TextEncoder().encode(key);
  const bytes = new Uint8Array(payload.length);

  for (let index = 0; index < payload.length; index += 1) {
    bytes[index] = payload[index] ^ keyBytes[index % keyBytes.length];
  }

  return Buffer.from(bytes).toString('base64');
}

describe('aegisDecoder host authorization', () => {
  it('accepts the current Pages production and deployment hosts', () => {
    expect(isAuthorizedAegisHost('localhost')).toBe(true);
    expect(isAuthorizedAegisHost('praxis.pages.dev')).toBe(true);
    expect(isAuthorizedAegisHost('praxis-el6.pages.dev')).toBe(true);
    expect(isAuthorizedAegisHost('praxis-el6-e4n.pages.dev')).toBe(true);
    expect(isAuthorizedAegisHost('66b90ea7.praxis-el6.pages.dev')).toBe(true);
    expect(isAuthorizedAegisHost('66b90ea7.praxis-el6-e4n.pages.dev')).toBe(true);
  });

  it('rejects unrelated hosts', () => {
    expect(isAuthorizedAegisHost('example.com')).toBe(false);
    expect(isAuthorizedAegisHost('praxis.evil.com')).toBe(false);
    expect(isAuthorizedAegisHost('praxis-pages.dev')).toBe(false);
  });
});

describe('aegisDecoder payload restoration', () => {
  it('detects obfuscated payloads and restores rationale plus answer bitmap', () => {
    const rawCase = {
      rationale: {
        _xc: xorEncode('Chymotrypsinogen is the inactive zymogen precursor of chymotrypsin.'),
        _xp: xorEncode('Remember the -ogen suffix often marks an inactive precursor – before activation.'),
      },
      options: [
        { id: 'A', text: 'Transaminase' },
        { id: 'B', text: 'Zymogen' },
        { id: 'C', text: 'Clot lysing protein' },
      ],
      _xbm: xorEncode('010'),
    };

    expect(isObfuscated(rawCase)).toBe(true);

    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { hostname: 'praxis-el6.pages.dev' },
    });

    const decoded = deobfuscateCase(rawCase);

    expect(decoded.rationale.correct).toContain('inactive zymogen precursor');
    expect(decoded.rationale.pearl).toContain('inactive precursor – before activation');
    expect(decoded.options.map((option) => option.is_correct)).toEqual([false, true, false]);
    expect(decoded.rationale._xc).toBeUndefined();
    expect(decoded.rationale._xp).toBeUndefined();
    expect(decoded._xbm).toBeUndefined();
  });
});
