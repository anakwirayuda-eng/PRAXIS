import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = dirname(fileURLToPath(import.meta.url));
const src = JSON.parse(readFileSync(join(__dirname, 'output', 'igakuqa_raw.json'), 'utf8'));
const translated = JSON.parse(readFileSync(join(__dirname, 'output', 'igakuqa_translated.json'), 'utf8'));
const existingIds = new Set(translated.map(c => c.meta.original_id));
const skipped = src.filter(q => !existingIds.has(q.sample_id));

let out = '# 9 IgakuQA — Tolong Translate ke English\n\n';
out += 'Translate setiap soal + opsi + jawaban benar ke bahasa Inggris, lalu berikan penjelasan singkat kenapa jawaban itu benar.\n\n---\n\n';

skipped.forEach((q, i) => {
  const correctLetter = String.fromCharCode(65 + q.answer_idx);
  out += `## Soal ${i+1} (${q.sample_id}, ${q.year})\n\n`;
  out += `**Question:** ${q.question}\n\n`;
  q.options.forEach((o, j) => {
    const letter = String.fromCharCode(65 + j);
    const mark = j === q.answer_idx ? ' ✅' : '';
    out += `- **${letter}.** ${o}${mark}\n`;
  });
  out += `\n**Correct Answer:** ${correctLetter}. ${q.correct_answer}\n\n---\n\n`;
});

const outPath = join(__dirname, '..', 'igakuqa_9_untranslated.md');
writeFileSync(outPath, out, 'utf8');
console.log('Written to:', outPath);
console.log(`${skipped.length} questions exported.`);
