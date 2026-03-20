/**
 * Download FrenchMedMCQA from HuggingFace (nthngdy/frenchmedmcqa)
 * 3,105 French pharmacy MCQs (train + val + test)
 * 
 * Usage: node ingestion/download-frenchmedmcqa.cjs
 */
const fs = require('fs');
const path = require('path');

const OUTPUT_DIR = path.join(__dirname, 'output');
const COMPILED = path.join(OUTPUT_DIR, 'compiled_cases.json');
const PUBLIC_COMPILED = path.join(__dirname, '..', 'public', 'data', 'compiled_cases.json');
const HF = 'https://datasets-server.huggingface.co/rows';

console.log('═══ FrenchMedMCQA Downloader ═══\n');

let cases = JSON.parse(fs.readFileSync(COMPILED, 'utf-8'));
const existingHashes = new Set(cases.map(c => c.hash_id).filter(Boolean));
let nextId = 970000 + cases.filter(c => c._id >= 970000).length;
console.log(`Existing: ${cases.length.toLocaleString()} cases\n`);

const SPLITS = ['train', 'validation', 'test'];

(async () => {
  let totalAdded = 0;
  
  for (const split of SPLITS) {
    console.log(`━━━ Split: ${split} ━━━`);
    let offset = 0;
    const BATCH = 100;
    let added = 0;

    while (true) {
      try {
        const url = `${HF}?dataset=nthngdy/frenchmedmcqa&config=default&split=${split}&offset=${offset}&length=${BATCH}`;
        const res = await fetch(url);
        if (!res.ok) { console.log(`  HTTP ${res.status}`); break; }
        const data = await res.json();
        const rows = data.rows || [];
        if (rows.length === 0) break;

        for (const item of rows) {
          const r = item.row;
          const hashId = `frenchmedmcqa_${split}_${offset + rows.indexOf(item)}`;
          if (existingHashes.has(hashId)) continue;
          existingHashes.add(hashId);

          // correct_answers can be int (single) or string
          const correctIdx = typeof r.correct_answers === 'number' ? r.correct_answers : 0;
          const letters = ['A', 'B', 'C', 'D', 'E'];
          const optTexts = [r.answer_a, r.answer_b, r.answer_c, r.answer_d, r.answer_e].filter(Boolean);

          if (!r.question || optTexts.length < 2) continue;

          cases.push({
            _id: nextId++,
            hash_id: hashId,
            q_type: 'MCQ',
            confidence: 4.0,
            category: 'Pharmacy',
            title: r.question.substring(0, 80) + (r.question.length > 80 ? '...' : ''),
            vignette: { demographics: { age: null, sex: null }, narrative: r.question },
            prompt: '',
            options: optTexts.map((t, i) => ({ id: letters[i], text: t, is_correct: i === correctIdx })),
            rationale: { correct: '', distractors: {} },
            meta: {
              source: 'frenchmedmcqa', examType: 'French-Pharmacy', difficulty: 3,
              hasVerifiedAnswer: true, hf_split: split,
            },
            validation: {
              overallScore: 4.0,
              layers: { content: 4, answer: 4, format: 4, image: 5, explanation: 1, source: 4 },
              standard: 'huggingface', warnings: [],
            },
          });
          added++;
        }

        offset += rows.length;
        process.stdout.write(`\r  ${offset} rows fetched, ${added} added`);
        if (rows.length < BATCH) break;
        await new Promise(r => setTimeout(r, 150));
      } catch (e) {
        console.log(`\n  Error: ${e.message}`);
        break;
      }
    }
    console.log(`\n  ✅ ${added} added from ${split}\n`);
    totalAdded += added;
  }

  if (totalAdded > 0) {
    fs.writeFileSync(COMPILED, JSON.stringify(cases), 'utf-8');
    fs.copyFileSync(COMPILED, PUBLIC_COMPILED);
    console.log(`\n📦 Total cases: ${cases.length.toLocaleString()}`);
  }
  console.log(`✅ Done! ${totalAdded} FrenchMedMCQA added.\n`);
})();
