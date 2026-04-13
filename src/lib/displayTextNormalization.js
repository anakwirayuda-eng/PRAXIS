const BASIC_HTML_ENTITIES = new Map([
  ['amp', '&'],
  ['lt', '<'],
  ['gt', '>'],
  ['quot', '"'],
  ['apos', '\''],
  ['nbsp', ' '],
  ['rsquo', '\''],
  ['lsquo', '\''],
  ['rdquo', '"'],
  ['ldquo', '"'],
  ['ndash', '-'],
  ['mdash', '--'],
  ['hellip', '...'],
  ['deg', '\u00B0'],
]);

export function decodeBasicHtmlEntities(value) {
  if (typeof value !== 'string' || value.length === 0) {
    return value;
  }

  return value
    .replace(/&#(\d+);/g, (_, codePoint) => String.fromCodePoint(Number.parseInt(codePoint, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hexPoint) => String.fromCodePoint(Number.parseInt(hexPoint, 16)))
    .replace(/&([a-z]+);/gi, (match, entity) => BASIC_HTML_ENTITIES.get(entity.toLowerCase()) ?? match);
}

export function normalizeDisplayText(value) {
  if (typeof value !== 'string') {
    return value;
  }

  const decoded = decodeBasicHtmlEntities(value)
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/^\[RESTORED SOURCE\]\s*/i, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?p\b[^>]*>/gi, '\n')
    .replace(/<\/p\b[^>]*>?/gi, '\n')
    .replace(/<\\p>/gi, '\n');

  return decoded
    .replace(/(?:&;){2,}/g, '&;')
    .replace(/(^|[\s([{])&;([^&]+?)&;(?=$|[\s().,;:!?}\]])/g, '$1"$2"')
    .replace(/(^|[\s([{])&;([^&'\n]+?)'(?=$|[\s).,;:!?}\]-])/g, "$1'$2'")
    .replace(/([A-Za-z0-9])&;(?=-)/g, '$1\'')
    .replace(/([A-Za-z0-9])&;(?=[A-Za-z0-9])/g, '$1\'')
    .replace(/([A-Za-z0-9])&;(?=(?:\s|$|[.,;:!?)}\]]))/g, '$1\'')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function normalizeDisplayTextList(values) {
  if (!Array.isArray(values)) {
    return values;
  }

  return values
    .map((value) => normalizeDisplayText(typeof value === 'string' ? value : String(value ?? '')))
    .filter(Boolean);
}

export function countDisplayTextRepairs(value) {
  if (typeof value !== 'string') {
    return 0;
  }

  const normalized = normalizeDisplayText(value);
  return normalized !== value ? 1 : 0;
}
