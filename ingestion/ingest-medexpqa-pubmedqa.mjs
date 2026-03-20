import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_PATH = path.join(__dirname, '../public/data/compiled_cases.json');
console.log('Reading database...');
const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
const existMap = new Set(db.map(c => c._id || c.id));
let added = 0;

// ═══════════════════════════════════════════
// PART 1: MedExpQA (Spanish MIR exam, 5-option MCQ)
// ═══════════════════════════════════════════
console.log('\n═══ PART 1: MedExpQA (Spanish MIR Exam) ═══');
const medexpDir = path.join(__dirname, 'output/medexpqa');
let medexpCount = 0;

for (const split of ['train', 'dev', 'test']) {
  const filePath = path.join(medexpDir, split + '.jsonl');
  if (!fs.existsSync(filePath)) continue;
  const lines = fs.readFileSync(filePath, 'utf-8').trim().split('\n');

  for (const line of lines) {
    const raw = JSON.parse(line);
    const id = 'medexpqa_' + (raw.id || medexpCount);
    if (existMap.has(id)) continue;

    // Build options from numbered keys (1-5)
    const options = [];
    const optionKeys = Object.keys(raw.options || {});
    // If options is a dict like {1: "text", 2: "text"...}
    if (raw.options && typeof raw.options === 'object' && !Array.isArray(raw.options)) {
      for (const k of Object.keys(raw.options)) {
        options.push({
          id: 'op' + k,
          text: raw.options[k],
          is_correct: parseInt(k) === raw.correct_option
        });
      }
    }

    // Build rationale from explanations
    let rationale = raw.full_answer || '';
    if (raw.explanations && raw.explanations[String(raw.correct_option)]) {
      const correctExp = raw.explanations[String(raw.correct_option)];
      if (correctExp.text) rationale = correctExp.text + '\n\n' + rationale;
    }

    const caseObj = {
      _id: id,
      question: raw.full_question || '',
      options: options,
      rationale: rationale,
      q_type: 'MCQ',
      category: raw.category || 'Umum',
      source: 'medexpqa',
      meta: {
        origin: 'MedExpQA (CasiMedicos / Spanish MIR Exam)',
        license: 'CC BY-4.0',
        split: split
      }
    };

    db.push(caseObj);
    existMap.add(id);
    added++;
    medexpCount++;
  }
}
console.log('MedExpQA ingested: ' + medexpCount);

// ═══════════════════════════════════════════
// PART 2: PubMedQA (yes/no/maybe → 3-option MCQ)
// ═══════════════════════════════════════════
console.log('\n═══ PART 2: PubMedQA (Gold-Labeled) ═══');
const pqaPath = path.join(__dirname, 'output/pubmedqa/ori_pqal.json');
let pqaCount = 0;

if (fs.existsSync(pqaPath)) {
  const pqa = JSON.parse(fs.readFileSync(pqaPath, 'utf-8'));

  for (const [pmid, raw] of Object.entries(pqa)) {
    const id = 'pubmedqa_' + pmid;
    if (existMap.has(id)) continue;

    const answer = (raw.final_decision || '').toLowerCase();
    const options = [
      { id: 'yes', text: 'Yes', is_correct: answer === 'yes' },
      { id: 'no', text: 'No', is_correct: answer === 'no' },
      { id: 'maybe', text: 'Maybe', is_correct: answer === 'maybe' }
    ];

    // Build context from CONTEXTS array
    const contextParts = (raw.CONTEXTS || []).map((c, i) => {
      const label = (raw.LABELS && raw.LABELS[i]) || '';
      return label ? label + ': ' + c : c;
    });
    const context = contextParts.join('\n');

    // Use reasoning as rationale
    const rationale = raw.reasoning_required_pred || raw.reasoning_free_pred || '';
    const longAnswer = raw.LONG_ANSWER || '';

    const caseObj = {
      _id: id,
      question: raw.QUESTION || '',
      vignette: context,
      options: options,
      rationale: longAnswer || rationale || context,
      q_type: 'MCQ',
      category: 'Evidence-Based Medicine',
      source: 'pubmedqa',
      meta: {
        origin: 'PubMedQA Gold-Labeled (Jin et al., 2019)',
        license: 'MIT',
        pmid: pmid,
        year: raw.YEAR || '',
        meshTerms: raw.MESHES || []
      }
    };

    db.push(caseObj);
    existMap.add(id);
    added++;
    pqaCount++;
  }
}
console.log('PubMedQA ingested: ' + pqaCount);

// ═══════════════════════════════════════════
// SAVE
// ═══════════════════════════════════════════
console.log('\nTotal new cases added: ' + added);
console.log('New DB size: ' + db.length);
fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
console.log('Saved!');
