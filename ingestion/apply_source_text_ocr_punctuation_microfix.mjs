import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createCasebankRepository } from '../server/casebank-repository.js';
import { normalizeDisplayText } from '../src/lib/displayTextNormalization.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DATA_FILE = join(__dirname, '..', 'public', 'data', 'compiled_cases.json');
const REPORT_FILE = join(__dirname, 'output', 'source_text_ocr_microfix_report.json');

const CASE_SPECIFIC_FIELD_SETS = new Map([
  [21407, new Map([
    ['rationale.correct', 'Uric acid stones are radiolucent on abdominal x-ray. In a patient with leukemia receiving chemotherapy, tumor lysis can increase uric acid production and cause uric acid nephrolithiasis, especially in acidic urine.'],
  ])],
  [27484, new Map([
    ['rationale.correct', 'Minimal change disease is the most likely diagnosis. The patient has nephrotic syndrome with edema, severe hypoalbuminemia, heavy proteinuria, and fatty casts. Minimal change disease is classically associated with Hodgkin lymphoma.'],
  ])],
  [56503, new Map([
    ['vignette.narrative', 'Chemiosmosis occurs in I. Mitochondria; II. Nuclei; III. Chloroplasts.'],
  ])],
]);

const EXACT_REPLACEMENTS = [
  [/\bdetection of of STD\b/g, 'detection of STDs'],
  [/\bSTD S\.here\b/g, 'STDs. Here'],
  [/\bsex ho move\b/g, 'sex who move'],
  [/\benvironment\.these\b/g, 'environment. These'],
  [/\bscreened \.this\b/g, 'screened. This'],
  [/\btechnique ha been\b/g, 'technique has been'],
  [/\bQ\.Steadies\b/g, 'It steadies'],
  [/\bVitamin C\.Minerals\b/g, 'Vitamin C. Minerals'],
  [/\bQ\.Prophylactic\b/g, 'Prophylactic'],
  [/\bC\.N\.Sacral\b/g, 'Craniosacral'],
  [/\bI\.Normal vision\b/g, 'Normal vision'],
  [/\bJ\.E\.Killed H1N1\b/g, 'Japanese encephalitis; killed H1N1'],
  [/\bQ\.Bilirubin\b/g, 'Bilirubin'],
  [/\bA\.Intratemporal:/g, 'A. Intratemporal:'],
  [/\bB\.Intracranial:/g, 'B. Intracranial:'],
  [/\bX\.Clinical manifestations\b/g, 'X. Clinical manifestations'],
  [/\bB\.Type A\b/g, 'B. Type A'],
  [/\bQ\.Primary acantholysis\b/g, 'Primary acantholysis'],
  [/\bS\.Indications\b/g, 'S. Indications'],
  [/\bQ\.Genetic code\b/g, 'Genetic code'],
  [/\bQ\.Most of the iron\b/g, 'Most of the iron'],
  [/\bA\.From the discussion\b/g, 'From the discussion'],
  [/\bB\.Drug of choice\b/g, 'Drug of choice'],
  [/\bS\.Vitamin B1\b/g, 'S. Vitamin B1'],
  [/\bQ\.Infact\b/g, 'In fact'],
  [/\bK\.Dichotomous Scale\b/g, 'Dichotomous scale'],
  [/\bC\.Clinical manifestations\b/g, 'Clinical manifestations'],
  [/\bT\.Lithium\b/g, 'Lithium'],
  [/\bA\.Etiological:/g, 'A. Etiological:'],
  [/\bC\.Enterotoxin B\b/g, 'Enterotoxin B'],
  [/\bA\.Fanconi's syndrome\b/g, "Fanconi's syndrome"],
  [/\bQ\.Anti GBM\b/g, 'Anti-GBM'],
  [/\bF\.Both are accompanied\b/g, 'Both are accompanied'],
  [/\bP\.Selectin\b/g, 'P-selectin'],
  [/\bT\.Metronidazole\b/g, 'Metronidazole'],
  [/\bT\.Secnidazole\b/g, 'Secnidazole'],
  [/\bL\.Markedly elevated\b/g, 'Markedly elevated'],
  [/\bI\.Also,/g, 'Also,'],
  [/\be\.g\.accidental\b/g, 'e.g. accidental'],
  [/\bb\.w\.The\b/g, 'b.w. The'],
  [/\b0 C\.Pada\b/g, '0 C. Pada'],
  [/\bS\.flexineri\b/g, 'S. flexneri'],
  [/\bB\.peusis\b/g, 'B. pertussis'],
  [/\bpeussis vaccine\b/g, 'pertussis vaccine'],
  [/\bV\.chloerae\b/g, 'V. cholerae'],
  [/\bC\.difficle\b/g, 'C. difficile'],
  [/\bH\.Pyloric infection\b/g, 'H. pylori infection'],
  [/\bH\.nanan\b/g, 'H. nana'],
  [/\bE\.chaffnessis\b/g, 'E. chaffeensis'],
  [/\bE\.colio E\.coli\b/g, 'E. coli. E. coli'],
  [/\bS\.angionosus\b/g, 'S. anginosus'],
  [/\bU\.XRadio Lucent stones are Uric acid and Xanthine stones\b/g, 'Radiolucent stones are uric acid and xanthine stones'],
];

const CANONICAL_TOKENS = new Map([
  ['c.dutta', 'C. Dutta'],
  ['c.dutta', 'C. Dutta'],
  ['d.tripathi', 'D. Tripathi'],
  ['d.trkpathi', 'D. Tripathi'],
  ['j.kishore', 'J. Kishore'],
  ['k.datta', 'K. Datta'],
  ['k.jain', 'K. Jain'],
  ['k.khurana', 'K. Khurana'],
  ['k.park', 'K. Park'],
  ['n.chugh', 'N. Chugh'],
  ['p.ghai', 'P. Ghai'],
  ['s.das', 'S. Das'],
  ['a.bignami', 'A. Bignami'],
  ['b.grassi', 'B. Grassi'],
  ['g.bastianelli', 'G. Bastianelli'],
  ['f.kennedy', 'F. Kennedy'],
  ['m.cola', 'M. Cola'],

  ['b.cepacia', 'B. cepacia'],
  ['b.cereus', 'B. cereus'],
  ['b.henselae', 'B. henselae'],
  ['b.melitensis', 'B. melitensis'],
  ['b.pseudomallei', 'B. pseudomallei'],
  ['b.quintana', 'B. quintana'],
  ['c.albicans', 'C. albicans'],
  ['c.burnetii', 'C. burnetii'],
  ['c.difficile', 'C. difficile'],
  ['c.diphtheriae', 'C. diphtheriae'],
  ['c.gattii', 'C. gattii'],
  ['c.neoformans', 'C. neoformans'],
  ['c.perfringens', 'C. perfringens'],
  ['c.sinensis', 'C. sinensis'],
  ['c.tetani', 'C. tetani'],
  ['c.trachomatis', 'C. trachomatis'],
  ['c.ulcerans', 'C. ulcerans'],
  ['c.vishnuii', 'C. vishnuii'],
  ['e.chaffeensis', 'E. chaffeensis'],
  ['e.coli', 'E. coli'],
  ['e.histolytica', 'E. histolytica'],
  ['h.aegypticus', 'H. aegypticus'],
  ['h.ducreyi', 'H. ducreyi'],
  ['h.influenzae', 'H. influenzae'],
  ['h.nana', 'H. nana'],
  ['h.pylori', 'H. pylori'],
  ['h.pyloric', 'H. pylori'],
  ['k.ozaenae', 'K. ozaenae'],
  ['m.audounii', 'M. audouinii'],
  ['m.canis', 'M. canis'],
  ['m.gypseum', 'M. gypseum'],
  ['m.leprae', 'M. leprae'],
  ['m.tuberculosis', 'M. tuberculosis'],
  ['n.asteroides', 'N. asteroides'],
  ['n.bresiliensis', 'N. brasiliensis'],
  ['n.meningitides', 'N. meningitidis'],
  ['p.aeruginosa', 'P. aeruginosa'],
  ['p.falciparum', 'P. falciparum'],
  ['p.jirovecii', 'P. jirovecii'],
  ['p.malariae', 'P. malariae'],
  ['p.ovale', 'P. ovale'],
  ['p.vivax', 'P. vivax'],
  ['r.prowazekii', 'R. prowazekii'],
  ['s.aureus', 'S. aureus'],
  ['s.bovis', 'S. bovis'],
  ['s.boydii', 'S. boydii'],
  ['s.haematobium', 'S. haematobium'],
  ['s.japonicum', 'S. japonicum'],
  ['s.mansoni', 'S. mansoni'],
  ['s.paratyphi', 'S. paratyphi'],
  ['s.pneumoniae', 'S. pneumoniae'],
  ['s.pyogenes', 'S. pyogenes'],
  ['s.sonnei', 'S. sonnei'],
  ['s.typhi', 'S. typhi'],
  ['t.cruzi', 'T. cruzi'],
  ['t.gonidii', 'T. gondii'],
  ['t.saginata', 'T. saginata'],
  ['t.schoenleinii', 'T. schoenleinii'],
  ['t.solium', 'T. solium'],
  ['t.tonsurans', 'T. tonsurans'],
  ['t.vaginalis', 'T. vaginalis'],
  ['t.violaceum', 'T. violaceum'],
  ['v.alginolyticus', 'V. alginolyticus'],
  ['v.parahaemolyticus', 'V. parahaemolyticus'],
  ['w.bancrofti', 'W. bancrofti'],
]);

const LOWERCASE_INITIAL_SKIP = new Set([
  'j.ajem',
  'j.annemergmed',
]);

function writeJsonAtomically(filePath, value, pretty = true) {
  const tempFile = `${filePath}.tmp`;
  const payload = pretty ? `${JSON.stringify(value, null, 2)}\n` : JSON.stringify(value);
  writeFileSync(tempFile, payload, 'utf8');
  try {
    renameSync(tempFile, filePath);
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || !['EPERM', 'EBUSY'].includes(error.code)) {
      throw error;
    }
    writeFileSync(filePath, payload, 'utf8');
    rmSync(tempFile, { force: true });
  }
}

function titleCase(value) {
  return value
    .toLowerCase()
    .replace(/(^|[-'])([a-z])/g, (_, prefix, letter) => `${prefix}${letter.toUpperCase()}`);
}

function normalizeInitialDotToken(match, initial, word) {
  const rawKey = `${initial}.${word}`.toLowerCase();
  if (LOWERCASE_INITIAL_SKIP.has(rawKey)) {
    return match;
  }

  const canonical = CANONICAL_TOKENS.get(rawKey);
  if (canonical) {
    return canonical;
  }

  if (/^[A-Z]{2,4}$/.test(word)) {
    return `${initial}. ${word}`;
  }

  if (/^[A-Z]{5,}$/.test(word)) {
    return `${initial}. ${titleCase(word)}`;
  }

  return `${initial}. ${word}`;
}

function normalizeOcrPunctuation(value) {
  if (typeof value !== 'string' || value.length === 0) {
    return value;
  }

  let next = value;
  for (const [pattern, replacement] of EXACT_REPLACEMENTS) {
    next = next.replace(pattern, replacement);
  }

  next = next
    .replace(/\b([A-Za-z])\.([A-Za-z]{3,})\b/g, normalizeInitialDotToken)
    .replace(/\bS\. Spinosum\b/g, 'stratum spinosum')
    .replace(/\bS\. Granulosum\b/g, 'stratum granulosum')
    .replace(/\bD\. The\b/g, 'D. The')
    .replace(/\bT\. The\b/g, 'T. The')
    .replace(/\bI\. The\b/g, 'I. The');

  return normalizeDisplayText(next)
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/([.;:!?])(?=[A-Z][a-z])/g, '$1 ')
    .trim();
}

function getStringField(caseRecord, path) {
  const segments = path.split('.');
  let current = caseRecord;
  for (const segment of segments) {
    if (!current || typeof current !== 'object') {
      return '';
    }
    current = current[segment];
  }
  return typeof current === 'string' ? current : '';
}

function setStringField(caseRecord, path, value) {
  const segments = path.split('.');
  let current = caseRecord;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index];
    if (!current[segment] || typeof current[segment] !== 'object' || Array.isArray(current[segment])) {
      current[segment] = {};
    }
    current = current[segment];
  }
  current[segments.at(-1)] = value;
}

function collectStringFieldPaths(caseRecord) {
  const paths = ['title', 'prompt', 'question'];

  if (typeof caseRecord.vignette === 'string') {
    paths.push('vignette');
  } else if (caseRecord.vignette && typeof caseRecord.vignette === 'object') {
    paths.push('vignette.narrative', 'vignette.labFindings');
  }

  if (typeof caseRecord.rationale === 'string') {
    paths.push('rationale');
  } else if (caseRecord.rationale && typeof caseRecord.rationale === 'object') {
    paths.push('rationale.correct', 'rationale.pearl');
    for (const key of Object.keys(caseRecord.rationale.distractors ?? {})) {
      paths.push(`rationale.distractors.${key}`);
    }
  }

  return paths;
}

function compact(value, limit = 220) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function applyCaseSpecificSets(caseRecord, changes) {
  const sets = CASE_SPECIFIC_FIELD_SETS.get(caseRecord?._id);
  if (!sets) {
    return false;
  }

  let changed = false;
  for (const [fieldPath, nextValue] of sets.entries()) {
    const current = getStringField(caseRecord, fieldPath);
    const next = normalizeDisplayText(nextValue);
    if (current && current !== next) {
      setStringField(caseRecord, fieldPath, next);
      changes.push({
        field: fieldPath,
        rule: 'case_specific_set',
        before: compact(current),
        after: compact(next),
      });
      changed = true;
    }
  }
  return changed;
}

function mutateCase(caseRecord) {
  const changes = [];
  let changed = applyCaseSpecificSets(caseRecord, changes);

  for (const fieldPath of collectStringFieldPaths(caseRecord)) {
    const current = getStringField(caseRecord, fieldPath);
    if (!current) {
      continue;
    }

    const next = normalizeOcrPunctuation(current);
    if (next !== current) {
      setStringField(caseRecord, fieldPath, next);
      changes.push({
        field: fieldPath,
        rule: 'initial_dot_ocr_punctuation',
        before: compact(current),
        after: compact(next),
      });
      changed = true;
    }
  }

  if (changed) {
    caseRecord.meta = caseRecord.meta || {};
    const previous = caseRecord.meta._source_text_ocr_microfix || {};
    caseRecord.meta._source_text_ocr_microfix = {
      applied_at: new Date().toISOString(),
      previous_applied_at: previous.applied_at || null,
      changed_fields: changes.map((change) => change.field),
      rule: 'initial-dot punctuation normalization with targeted OCR typo repairs',
    };
  }

  return changes;
}

function main() {
  const publicCases = JSON.parse(readFileSync(DATA_FILE, 'utf8'));
  const publicMap = new Map(publicCases.map((caseRecord) => [String(caseRecord._id), caseRecord]));

  const repository = createCasebankRepository();
  const dbCases = repository.getAllCases();
  const dbMap = new Map(dbCases.map((caseRecord) => [String(caseRecord._id), caseRecord]));

  const modifiedDbCases = [];
  const report = {
    generated_at: new Date().toISOString(),
    modified_cases: [],
  };

  try {
    for (const publicCase of publicCases) {
      const publicChanges = mutateCase(publicCase);
      if (publicChanges.length === 0) {
        continue;
      }

      const dbCase = dbMap.get(String(publicCase._id));
      if (dbCase) {
        const dbChanges = mutateCase(dbCase);
        if (dbChanges.length > 0) {
          modifiedDbCases.push(dbCase);
        }
      }

      const source = publicCase?.meta?.source || publicCase?.source || 'unknown';
      report.modified_cases.push({
        _id: publicCase._id,
        case_code: publicCase.case_code || '',
        source,
        changes: publicChanges,
      });
      publicMap.set(String(publicCase._id), publicCase);
    }

    if (modifiedDbCases.length > 0) {
      repository.updateCaseSnapshots(modifiedDbCases);
    }

    writeJsonAtomically(DATA_FILE, publicCases, true);
    writeJsonAtomically(REPORT_FILE, report, true);

    console.log('Source text OCR punctuation microfix applied');
    console.log(`  Modified cases: ${report.modified_cases.length}`);
    console.log(`  Modified DB cases: ${modifiedDbCases.length}`);
    console.log(`  Report: ${REPORT_FILE}`);
  } finally {
    repository.close();
  }
}

main();
