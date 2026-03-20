/**
 * Universal Anki .apkg Parser → MedCase Pro JSON
 * 
 * Works with ANY medical Anki deck (PLAB, AMC, Step 2 CK, FMGE, etc.)
 * 
 * How .apkg works:
 *   .apkg = ZIP file containing:
 *     - collection.anki2 (SQLite database)
 *     - media (numbered files: 0, 1, 2... = images)
 * 
 * The SQLite `notes` table contains:
 *   - flds: tab-separated fields (front/back/extra)
 *   - tags: space-separated tags
 *   - mid: model ID (links to note type)
 * 
 * Usage: node ingestion/parse-anki.cjs <path-to-apkg-file> [deck-name]
 * Example: node ingestion/parse-anki.cjs "TXT referensi/PLAB1.apkg" plab1
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const Database = require('better-sqlite3');

const apkgPath = process.argv[2];
const deckName = process.argv[3] || path.basename(apkgPath || '', '.apkg').toLowerCase().replace(/\s+/g, '-');

if (!apkgPath || !fs.existsSync(apkgPath)) {
  console.log('Usage: node ingestion/parse-anki.cjs <path-to-apkg-file> [deck-name]');
  console.log('Example: node ingestion/parse-anki.cjs "TXT referensi/PLAB1.apkg" plab1');
  process.exit(1);
}

console.log(`═══ Anki Parser: ${path.basename(apkgPath)} ═══\n`);

// 1. Unzip .apkg (it's just a ZIP)
const tmpDir = path.join(__dirname, 'output', `_anki_tmp_${Date.now()}`);
fs.mkdirSync(tmpDir, { recursive: true });

try {
  // Use PowerShell's Expand-Archive
  execSync(`powershell -Command "Expand-Archive -Path '${path.resolve(apkgPath)}' -DestinationPath '${tmpDir}' -Force"`, { stdio: 'pipe' });
} catch (e) {
  console.log('Unzip failed, trying rename to .zip first...');
  const zipPath = apkgPath.replace('.apkg', '.zip');
  fs.copyFileSync(apkgPath, zipPath);
  execSync(`powershell -Command "Expand-Archive -Path '${path.resolve(zipPath)}' -DestinationPath '${tmpDir}' -Force"`, { stdio: 'pipe' });
  fs.unlinkSync(zipPath);
}

// 2. Find SQLite database
const dbFiles = fs.readdirSync(tmpDir).filter(f => f.endsWith('.anki2') || f.endsWith('.anki21') || f === 'collection.anki2');
if (dbFiles.length === 0) {
  console.log('No .anki2 database found in archive!');
  console.log('Files:', fs.readdirSync(tmpDir));
  process.exit(1);
}

const dbPath = path.join(tmpDir, dbFiles[0]);
console.log(`Database: ${dbFiles[0]}`);

// 3. Open SQLite and extract notes
const db = new Database(dbPath, { readonly: true });

// Get models (note types) for field name mapping
const colRow = db.prepare('SELECT models FROM col').get();
let models = {};
if (colRow) {
  try {
    models = JSON.parse(colRow.models);
  } catch (e) {
    console.log('Could not parse models metadata');
  }
}

// Get all notes
const notes = db.prepare('SELECT id, mid, flds, tags FROM notes').all();
console.log(`Notes: ${notes.length}`);
console.log(`Models: ${Object.keys(models).length}`);

// Log model info
for (const [mid, model] of Object.entries(models)) {
  const fieldNames = (model.flds || []).map(f => f.name);
  console.log(`  Model "${model.name}": ${fieldNames.join(', ')}`);
}

// 4. Parse notes into questions
function stripHtml(html) {
  if (!html) return '';
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<div>/gi, '\n')
    .replace(/<\/div>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\{\{c\d+::(.*?)(?:::.*?)?\}\}/gi, '[$1]')  // Cloze → [answer]
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function isCloze(text) {
  return /\{\{c\d+::/.test(text);
}

function extractClozeAnswer(text) {
  const matches = text.match(/\{\{c\d+::(.*?)(?:::.*?)?\}\}/gi);
  if (!matches) return [];
  return matches.map(m => {
    const inner = m.match(/\{\{c\d+::(.*?)(?:::.*?)?\}\}/i);
    return inner ? inner[1] : '';
  });
}

const questions = [];
let clozeCount = 0;
let basicCount = 0;
let skipped = 0;

for (const note of notes) {
  const fields = note.flds.split('\x1f'); // Anki uses \x1f as field separator
  const tags = (note.tags || '').trim().split(/\s+/).filter(t => t);
  const model = models[String(note.mid)];
  const fieldNames = model ? (model.flds || []).map(f => f.name) : [];

  // Build field map
  const fieldMap = {};
  for (let i = 0; i < fields.length; i++) {
    const name = fieldNames[i] || `field${i}`;
    fieldMap[name.toLowerCase()] = stripHtml(fields[i]);
  }

  const front = stripHtml(fields[0] || '');
  const back = stripHtml(fields[1] || '');
  const extra = stripHtml(fields[2] || '');

  if (front.length < 10) { skipped++; continue; }

  // Check if this is a Cloze card
  if (isCloze(fields[0])) {
    // Cloze → store as fact for later MCQ conversion
    const answers = extractClozeAnswer(fields[0]);
    const cleanQ = stripHtml(fields[0]); // Has [answer] placeholders
    
    questions.push({
      q_type: 'CLOZE',
      raw_front: cleanQ,
      raw_back: back,
      cloze_answers: answers,
      tags,
      category: guessCategory(front + ' ' + back + ' ' + tags.join(' ')),
      meta: {
        source: `anki-${deckName}`,
        examType: 'International',
        tags: [...tags, deckName],
        needsMCQConversion: true,
      },
    });
    clozeCount++;
  } else {
    // Basic card — check if it looks like MCQ
    const mcqMatch = back.match(/([A-E])\s*[\.\)]\s/);
    
    questions.push({
      q_type: mcqMatch ? 'MCQ' : 'BASIC',
      raw_front: front,
      raw_back: back,
      raw_extra: extra,
      tags,
      category: guessCategory(front + ' ' + back + ' ' + tags.join(' ')),
      meta: {
        source: `anki-${deckName}`,
        examType: 'International',
        tags: [...tags, deckName],
        needsMCQConversion: !mcqMatch,
      },
    });
    basicCount++;
  }
}

function guessCategory(t) {
  t = t.toLowerCase();
  if (/cardio|heart|ecg|ekg|murmur|atrial|ventricul/i.test(t)) return 'cardiology';
  if (/pulmon|lung|pneumon|asthma|copd|bronch/i.test(t)) return 'pulmonology';
  if (/neuro|brain|stroke|seizure|epilep|meningit/i.test(t)) return 'neurology';
  if (/paediatric|pediatric|child|neonat|infant/i.test(t)) return 'pediatrics';
  if (/obstetric|gynae|pregnan|labour|fetus|contracepti/i.test(t)) return 'obgyn';
  if (/derma|skin|rash|eczema|psoriasis/i.test(t)) return 'dermatology';
  if (/ophthalm|eye|visual|cataract|glaucoma|retina/i.test(t)) return 'ophthalmology';
  if (/ent|ear|nose|throat|otitis|tonsil/i.test(t)) return 'ent';
  if (/psychiatr|depress|anxiety|schizophren|bipolar/i.test(t)) return 'psychiatry';
  if (/surg|fractur|wound|trauma|hernia|appendic/i.test(t)) return 'surgery';
  if (/renal|kidney|uro|uret|creatin/i.test(t)) return 'nephrology';
  if (/gastro|liver|hepat|bowel|colon|pancrea/i.test(t)) return 'gastroenterology';
  if (/diabet|thyroid|endocrin|insulin|adrenal/i.test(t)) return 'endocrinology';
  if (/anaemia|anemia|haematol|platelet|coagul/i.test(t)) return 'hematology';
  if (/forens|autopsy|medico.?legal/i.test(t)) return 'forensics';
  if (/pharmaco|drug|dose|adverse/i.test(t)) return 'pharmacology';
  if (/micro|bacteri|virus|fungal|parasit/i.test(t)) return 'microbiology';
  return 'internal-medicine';
}

console.log(`\nParsed:`);
console.log(`  Cloze cards: ${clozeCount}`);
console.log(`  Basic/MCQ cards: ${basicCount}`);
console.log(`  Skipped (too short): ${skipped}`);
console.log(`  Total usable: ${questions.length}`);

// Save parsed data
const outPath = path.join(__dirname, 'output', `anki_${deckName}_parsed.json`);
fs.writeFileSync(outPath, JSON.stringify(questions, null, 2));
console.log(`\nSaved: ${outPath}`);

// Category breakdown
const cats = {};
for (const q of questions) { cats[q.category] = (cats[q.category] || 0) + 1; }
console.log('\nCategory breakdown:');
for (const [cat, count] of Object.entries(cats).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${cat.padEnd(22)} ${count}`);
}

// Cleanup
db.close();
fs.rmSync(tmpDir, { recursive: true, force: true });

console.log(`\n═══ Next Steps ═══`);
console.log(`If most cards are CLOZE, run the Cloze→MCQ batch converter:`);
console.log(`  node ingestion/cloze-to-mcq-batch.cjs anki_${deckName}_parsed.json`);
console.log(`This will create a Batch API job to convert cloze facts → UKMPPD-style MCQs.`);
