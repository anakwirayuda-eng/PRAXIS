import fs from 'fs';

import { openCaseStorage } from './case-storage.mjs';

const IS_DRY_RUN = !process.argv.includes('--write');
const RAW_PATH = 'ingestion/sources/medmcqa/medmcqa_raw.json';
const LOG_PATH = 'ingestion/output/radar_audit.json';

const raw = JSON.parse(fs.readFileSync(RAW_PATH, 'utf8'));

console.log('THE SEMANTIC DISSONANCE RADAR ($0 LOCAL CHECK)');
console.log(`MODE: ${IS_DRY_RUN ? 'DRY RUN (READ ONLY)' : 'PRODUCTION WRITE ENABLED'}\n`);

const stopWords = new Set([
  'the', 'and', 'for', 'with', 'are', 'was', 'were', 'that', 'this', 'from',
  'most', 'least', 'which', 'what', 'when', 'where', 'why', 'how', 'not',
  'has', 'have', 'had', 'been', 'will', 'would', 'could', 'should', 'may',
  'can', 'about', 'because', 'yang', 'dan', 'atau', 'untuk', 'dari', 'pada',
  'dalam', 'dengan', 'adalah', 'bisa', 'akan', 'telah', 'oleh', 'juga',
  'sebagai', 'ini', 'itu', 'saya', 'anda', 'mereka', 'kita', 'kami',
  'lebih', 'paling', 'sangat', 'tidak', 'bukan',
  'both', 'these', 'those', 'their', 'there', 'here', 'only', 'also', 'into',
  'upon', 'some', 'many', 'much', 'more', 'most', 'then', 'than', 'when',
  'what', 'where', 'which', 'while', 'until', 'after', 'before', 'above',
  'below', 'under', 'over', 'between', 'among', 'through', 'during',
  'against', 'without', 'within', 'having', 'being', 'doing', 'does',
]);

const weakSignalTokens = new Set([
  'people', 'individuals', 'healthy', 'children', 'pregnancy', 'completed',
  'normal', 'stay', 'termination', 'gestational', 'days', 'day', 'weeks', 'week',
  'years', 'year', 'hours', 'hour', 'minutes', 'minute', 'mins', 'seconds', 'second',
  'units', 'breaths', 'chances', 'types', 'rather', 'exception', 'slower', 'acting',
  'less', 'safer', 'late', 'post', 'operative', 'prescribed', 'instituted',
  'injuries', 'intensive', 'estimation', 'litre', 'micrograms', 'microns', 'degrees',
  'following', 'delivery', 'limits', 'till', 'soon',
]);

const tokenSynonyms = new Map([
  ['individuals', ['individuals', 'individual', 'people', 'person', 'persons']],
  ['breaths', ['breaths', 'breathing']],
  ['pog', ['pog', 'gestationalage', 'gestation', 'periodofgestation']],
  ['x0', ['x0', 'xo']],
  ['1o', ['1o', '10']],
  ['15yrs', ['15yrs', '15year', '15years', '15yr']],
  ['24deg', ['24deg', '24degree', '24degrees', '24degress']],
  ['il', ['il', 'interleukin']],
  ['ifn', ['ifn', 'interferon']],
  ['u5mr', ['u5mr', 'underfivemortalityrate', 'under5mortalityrate', 'under5moalityrate']],
  ['serms', ['serms', 'selectiveestrogenreceptormodulator']],
  ['lt', ['lt', 'leukotriene']],
  ['genome', ['genome', 'genotype']],
  ['ansd', ['ansd', 'asd']],
  ['parturition', ['parturition', 'delivery', 'labor', 'labour']],
  ['systolic', ['systolic', 'sbp']],
  ['diastolic', ['diastolic', 'dbp']],
  ['lakh', ['lakh', '100000']],
  ['po4', ['po4', 'phosphate', 'phosphorus']],
  ['intramuscularly', ['intramuscularly', 'intramuscular', 'im']],
  ['limits', ['limits', 'range']],
]);

function normalizeCompact(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function extractTokens(text) {
  if (!text) return [];
  const matches = String(text).match(/\b([A-Z0-9]{2,}|[a-zA-Z0-9]{4,})\b/g) || [];
  const tokens = [];
  for (const word of matches) {
    const lower = word.toLowerCase();
    if (/^\d+$/.test(lower)) continue;
    if (!stopWords.has(lower)) tokens.push(lower);
  }
  return [...new Set(tokens)];
}

function isWeakSignalToken(token) {
  if (weakSignalTokens.has(token)) return true;
  if (/^\d+$/.test(token)) return true;
  if (/^[a-z]?\d+[a-z]?$/i.test(token) && token.length <= 4) return true;
  if (/^\d+[a-z]+$/i.test(token)) return true;
  if (/^(mmhg|mm|mg|ml|cm|kg|gm|yrs?|deg(?:ree|rees|ress)?|days?|weeks?|years?|hours?|mins?|seconds?)$/.test(token)) {
    return true;
  }
  return false;
}

function buildTokenVariants(token) {
  const variants = new Set([token]);
  for (const alias of tokenSynonyms.get(token) || []) {
    variants.add(alias);
  }
  if (token.endsWith('s') && token.length > 4) {
    variants.add(token.slice(0, -1));
  }
  if (/[a-z]/.test(token) && token.includes('0')) {
    variants.add(token.replace(/0/g, 'o'));
  }
  if (/[a-z]/.test(token) && token.includes('1')) {
    variants.add(token.replace(/1/g, 'i'));
    variants.add(token.replace(/1/g, 'l'));
  }
  return [...variants].map(normalizeCompact).filter(Boolean);
}

const rawArray = Array.isArray(raw) ? raw : raw.rows || raw.data || [];
const rawMap = new Map();
for (const row of rawArray) {
  const data = row.row || row;
  if (data.id) rawMap.set(`medmcqa_${data.id}`, data);
}

const stats = {
  checkedAndPassed: 0,
  skippedNegations: 0,
  skippedWeakSignal: 0,
  staleDissonanceCleared: 0,
  dissonanceApplied: 0,
  quarantinedDissonance: [],
};

const nextDissonanceById = new Map();
const storage = await openCaseStorage();

try {
  console.log(`Storage backend: ${storage.label}\n`);
  const dataset = storage.dataset;

  for (const item of dataset) {
    const isTargetSource =
      item.meta?.source?.toLowerCase() === 'medmcqa' ||
      /^medmcqa_[a-z0-9-]+$/i.test(String(item.hash_id));
    if (!isTargetSource || !item.hash_id) continue;

    const currentStatus = item.meta?.status;
    if (currentStatus?.startsWith('QUARANTINED') && currentStatus !== 'QUARANTINED_DISSONANCE') continue;

    const rawItem = rawMap.get(item.hash_id);
    if (!rawItem?.exp || rawItem.exp.trim().length < 50) continue;

    const promptText = String(item.prompt || '').toLowerCase();
    if (/\b(kecuali|exc?ept|not|bukan|least likely|false statement|incorrect|does not|wrong)\b/i.test(promptText)) {
      stats.skippedNegations++;
      continue;
    }

    const correctOption = item.options?.find((option) => option.is_correct);
    if (!correctOption?.text) continue;

    const tokens = extractTokens(correctOption.text).filter((token) => !isWeakSignalToken(token));
    if (tokens.length === 0) {
      stats.skippedWeakSignal++;
      continue;
    }

    const rawExpCompact = normalizeCompact(rawItem.exp);
    const matchFound = tokens.some((token) =>
      buildTokenVariants(token).some((variant) => rawExpCompact.includes(variant)),
    );

    if (!matchFound) {
      nextDissonanceById.set(item._id, tokens);
      stats.quarantinedDissonance.push({ id: item._id, tokens, answer: correctOption.text });
    } else {
      stats.checkedAndPassed++;
    }
  }

  if (!IS_DRY_RUN) {
    const modifiedById = new Map();

    for (const item of dataset) {
      if (item.meta?.status === 'QUARANTINED_DISSONANCE' && !nextDissonanceById.has(item._id)) {
        delete item.meta.status;
        delete item.meta.radar_tokens;
        modifiedById.set(item._id, item);
        stats.staleDissonanceCleared++;
      }
    }

    for (const item of dataset) {
      const tokens = nextDissonanceById.get(item._id);
      if (!tokens) continue;
      item.meta = item.meta || {};
      item.meta.status = 'QUARANTINED_DISSONANCE';
      item.meta.radar_tokens = tokens;
      modifiedById.set(item._id, item);
      stats.dissonanceApplied++;
    }

    if (modifiedById.size > 0) {
      await storage.persistCases([...modifiedById.values()], { fullDataset: dataset });
    }
  }
} finally {
  await storage.close();
}

if (!fs.existsSync('ingestion/output')) {
  fs.mkdirSync('ingestion/output', { recursive: true });
}
fs.writeFileSync(LOG_PATH, JSON.stringify(stats, null, 2), 'utf8');

console.log('DISSONANCE RADAR COMPLETE');
console.log(`   Checked & Passed against raw.exp: ${stats.checkedAndPassed}`);
console.log(`   Skipped (Negations):              ${stats.skippedNegations}`);
console.log(`   Skipped (Weak Signal):            ${stats.skippedWeakSignal}`);
console.log(`   QUARANTINED (False Key):          ${stats.quarantinedDissonance.length}`);
if (!IS_DRY_RUN) {
  console.log(`   Cleared stale dissonance:         ${stats.staleDissonanceCleared}`);
  console.log(`   Applied fresh dissonance set:     ${stats.dissonanceApplied}`);
}
console.log(`\nDetailed log saved to: ${LOG_PATH}`);
