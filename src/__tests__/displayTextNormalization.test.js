import { describe, expect, it } from 'vitest';

import { normalizeDisplayText } from '../lib/displayTextNormalization';

describe('displayTextNormalization', () => {
  it('repairs broken apostrophes, quote pairs, and entities', () => {
    expect(normalizeDisplayText('Lombard&;s test')).toBe("Lombard's test");
    expect(normalizeDisplayText('doesn&;t')).toBe("doesn't");
    expect(normalizeDisplayText('Lines of Blaschko&;s are &;well known&;')).toBe('Lines of Blaschko\'s are "well known"');
    expect(normalizeDisplayText('Temperature 38&deg;C')).toBe('Temperature 38\u00B0C');
  });

  it('strips restored-source wrappers and simple html paragraph tags', () => {
    expect(normalizeDisplayText('[RESTORED SOURCE] <p>Line one</p><p>Line two</p>')).toBe('Line one\n\nLine two');
  });

  it('repairs repeated broken entities, malformed closing tags, and dangling open quotes', () => {
    expect(normalizeDisplayText('3&;-UTR')).toBe("3'-UTR");
    expect(normalizeDisplayText('Harrison&;&;s principle')).toBe("Harrison's principle");
    expect(normalizeDisplayText('&;Tennis elbow\', is characterized by -')).toBe("'Tennis elbow', is characterized by -");
    expect(normalizeDisplayText('quoted &;family size&;(')).toBe('quoted "family size"(');
    expect(normalizeDisplayText('tail</p.')).toBe('tail');
  });
});
