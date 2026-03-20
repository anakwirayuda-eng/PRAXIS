/**
 * Download international medical MCQ datasets from HuggingFace
 * 1. FrenchMedMCQA (3,105 French pharmacy — needs future translation)
 * 2. Med-Dataset (English MCQs with explanations)
 * 
 * Usage: node ingestion/download-international.cjs
 */
const fs = require('fs');
const path = require('path');

const OUTPUT_DIR = path.join(__dirname, 'output');
const COMPILED = path.join(OUTPUT_DIR, 'compiled_cases.json');
const PUBLIC_COMPILED = path.join(__dirname, '..', 'public', 'data', 'compiled_cases.json');
const HF = 'https://datasets-server.huggingface.co/rows';

console.log('══════════════════════════════════════════════════');
console.log(' International Medical MCQ Downloader');
console.log('══════════════════════════════════════════════════\n');

let cases = JSON.parse(fs.readFileSync(COMPILED, 'utf-8'));
const existingHashes = new Set(cases.map(c => c.hash_id).filter(Boolean));
let nextId = 970000 + cases.filter(c => c._id >= 970000).length;
console.log(`📦 Existing: ${cases.length.toLocaleString()} cases\n`);

async function fetchRows(dataset, config, split, offset, length) {
  const url = `${HF}?dataset=${encodeURIComponent(dataset)}&config=${config}&split=${split}&offset=${offset}&length=${length}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).substring(0, 100)}`);
  return res.json();
}

async function downloadDataset(name, dataset, config, splits, sourceTag, examType, trust, transformFn) {
  console.log(`━━━ ${name} ━━━`);
  let totalAdded = 0;
  
  for (const split of splits) {
    let offset = 0, added = 0;
    while (true) {
      try {
        const data = await fetchRows(dataset, config, split, offset, 100);
        const rows = data.rows || [];
        if (rows.length === 0) break;

        for (let i = 0; i < rows.length; i++) {
          const r = rows[i].row;
          const hashId = `${sourceTag}_${split}_${offset + i}`;
          if (existingHashes.has(hashId)) continue;
          existingHashes.add(hashId);

          const parsed = transformFn(r);
          if (!parsed || !parsed.question || parsed.options.length < 2) continue;

          cases.push({
            _id: nextId++,
            hash_id: hashId,
            q_type: 'MCQ',
            confidence: trust,
            category: parsed.category || 'General Medicine',
            title: parsed.question.substring(0, 80) + (parsed.question.length > 80 ? '...' : ''),
            vignette: { demographics: { age: null, sex: null }, narrative: parsed.question },
            prompt: '',
            options: parsed.options,
            rationale: { correct: parsed.explanation || '', distractors: {} },
            meta: {
              source: sourceTag, examType, difficulty: 3,
              hasVerifiedAnswer: true, hf_split: split,
              needsTranslation: parsed.needsTranslation || false,
              originalLanguage: parsed.language || 'en',
            },
            validation: {
              overallScore: trust,
              layers: { content: 4, answer: 4, format: 4, image: 5, explanation: parsed.explanation ? 4 : 1, source: 4 },
              standard: 'huggingface', warnings: parsed.needsTranslation ? ['needs_translation'] : [],
            },
          });
          added++;
        }

        offset += rows.length;
        process.stdout.write(`\r  ${split}: ${offset} fetched, ${added} added`);
        if (rows.length < 100) break;
        await new Promise(r => setTimeout(r, 150));
      } catch (e) {
        console.log(`\n  Error at offset ${offset}: ${e.message}`);
        break;
      }
    }
    console.log(`\n  ${split}: ${added} added`);
    totalAdded += added;
  }
  console.log(`  ✅ Total: ${totalAdded}\n`);
  return totalAdded;
}

(async () => {
  let grand = 0;

  // 1. FrenchMedMCQA (French — tag for translation)
  grand += await downloadDataset(
    'FrenchMedMCQA', 'nthngdy/frenchmedmcqa', 'default',
    ['train', 'validation', 'test'],
    'frenchmedmcqa', 'French-Pharmacy', 4.0,
    (r) => {
      const correctIdx = typeof r.correct_answers === 'number' ? r.correct_answers : 0;
      const optTexts = [r.answer_a, r.answer_b, r.answer_c, r.answer_d, r.answer_e].filter(Boolean);
      return {
        question: r.question || '',
        options: optTexts.map((t, i) => ({ id: String.fromCharCode(65 + i), text: t, is_correct: i === correctIdx })),
        explanation: '',
        category: 'Pharmacy',
        needsTranslation: true,
        language: 'fr',
      };
    }
  );

  // 2. Med-Dataset (English MCQs with explanations)
  grand += await downloadDataset(
    'Med-Dataset', 'Med-dataset/Med_Dataset', 'default',
    ['test'],
    'med-dataset', 'Medical-Mixed', 3.8,
    (r) => {
      // Format: instruction + input (Question: ... Options: (A)... Answer:) + output
      const input = r.input || '';
      const qMatch = input.match(/Question:\s*(.+?)(?:\nOptions:|\n\(A\))/s);
      const question = qMatch ? qMatch[1].trim() : input.split('\n')[0];
      
      // Extract options
      const optMatches = [...input.matchAll(/\(([A-D])\)\s*(.+?)(?=\n\(|$|\nAnswer)/gs)];
      const options = optMatches.map(m => ({
        id: m[1],
        text: m[2].trim(),
        is_correct: (r.output || '').trim() === m[2].trim(),
      }));
      
      // If no option marked correct, try matching by letter
      if (!options.some(o => o.is_correct) && r.output) {
        const ansLetter = r.output.trim().match(/^\(?([A-D])\)?$/)?.[1];
        if (ansLetter) {
          for (const o of options) { if (o.id === ansLetter) o.is_correct = true; }
        }
      }

      return { question, options, explanation: r.output || '' };
    }
  );

  if (grand > 0) {
    fs.writeFileSync(COMPILED, JSON.stringify(cases), 'utf-8');
    fs.copyFileSync(COMPILED, PUBLIC_COMPILED);
  }

  console.log(`\n═══════════════════════════════════════`);
  console.log(`📦 Total cases: ${cases.length.toLocaleString()}`);
  console.log(`  New international: ${grand}`);
  console.log(`  French (needs translation): ${cases.filter(c => c.meta?.needsTranslation).length}`);
  console.log(`✅ Done!\n`);
})();
