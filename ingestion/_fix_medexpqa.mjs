import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = path.join(__dirname, '../public/data/compiled_cases.json');

console.log('Reading database...');
const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));

// Remove old medexpqa entries and re-ingest with fixes
const beforeCount = db.length;
const cleaned = db.filter(q => q.source !== 'medexpqa');
console.log('Removed', beforeCount - cleaned.length, 'old MedExpQA entries');

const existMap = new Set(cleaned.map(c => c._id || c.id));
let added = 0;
const medexpDir = path.join(__dirname, 'output/medexpqa');

for (const split of ['train', 'dev', 'test']) {
  const filePath = path.join(medexpDir, split + '.jsonl');
  if (!fs.existsSync(filePath)) continue;
  const lines = fs.readFileSync(filePath, 'utf-8').trim().split('\n');

  for (const line of lines) {
    const raw = JSON.parse(line);
    const id = 'medexpqa_' + (raw.id || raw.question_id_specific || ('s' + split + '_' + added));
    if (existMap.has(id)) continue;

    // Build options — only include non-null entries
    const options = [];
    if (raw.options && typeof raw.options === 'object') {
      for (const k of Object.keys(raw.options)) {
        const text = raw.options[k];
        if (text && text.trim()) {
          options.push({
            id: 'op' + k,
            text: text.trim(),
            is_correct: parseInt(k) === raw.correct_option
          });
        }
      }
    }

    // Skip if less than 2 options (broken question)
    if (options.length < 2) continue;

    // Use full_question which is the proper clinical vignette with question
    const fullQ = (raw.full_question || '').trim();

    // Build rationale
    let rationale = raw.full_answer || '';
    if (raw.explanations && raw.explanations[String(raw.correct_option)]) {
      const exp = raw.explanations[String(raw.correct_option)];
      if (exp.text && exp.text.trim()) {
        rationale = exp.text.trim() + (rationale ? '\n\n' + rationale : '');
      }
    }

    const caseObj = {
      _id: id,
      question: fullQ,
      options: options,
      rationale: rationale || '',
      q_type: 'MCQ',
      category: raw.type || 'Umum',
      source: 'medexpqa',
      meta: {
        origin: 'MedExpQA (CasiMedicos / Spanish MIR Exam)',
        license: 'CC BY-4.0',
        split: split,
        year: raw.year || ''
      }
    };

    cleaned.push(caseObj);
    existMap.add(id);
    added++;
  }
}

console.log('MedExpQA re-ingested: ' + added + ' (with null-option fix)');
console.log('New DB size: ' + cleaned.length);
fs.writeFileSync(DB_PATH, JSON.stringify(cleaned, null, 2));
console.log('Saved!');
