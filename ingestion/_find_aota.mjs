import fs from 'fs';

const db = JSON.parse(fs.readFileSync('D:/Dev/MedCase/public/data/compiled_cases.json','utf-8'));

// Find questions with "All of the above" or "None of the above" options
const suspicious = db.filter(q => {
    if (!q.options || q.q_type === 'SCT') return false;
    return q.options.some(o => {
        const t = (o.text || '').toLowerCase();
        return t.includes('all of the above') || t.includes('none of the above') ||
               t.includes('all are correct') || t.includes('all are true') ||
               t.includes('semua benar') || t.includes('semua di atas');
    });
});

console.log(`Total "All/None of the above" questions: ${suspicious.length}`);

// Categorize by source
const sources = {};
suspicious.forEach(q => {
    const s = q.source || q.meta?.source || 'unknown';
    sources[s] = (sources[s] || 0) + 1;
});
console.log('\nBy source:');
Object.entries(sources).sort((a,b) => b[1]-a[1]).forEach(([k,v]) => console.log(`  ${k}: ${v}`));

// Find ones where "All of the above" IS the correct answer vs NOT
let aotaCorrect = 0, aotaWrong = 0;
suspicious.forEach(q => {
    const correctOpt = q.options.find(o => o.is_correct || o.correct);
    if (!correctOpt) return;
    const t = (correctOpt.text || '').toLowerCase();
    if (t.includes('all of the above') || t.includes('all are correct') || t.includes('all are true')) aotaCorrect++;
    else aotaWrong++;
});
console.log(`\n"All of the above" IS correct: ${aotaCorrect}`);
console.log(`"All of the above" is NOT correct (like the LDL case): ${aotaWrong}`);

// Export first 20 suspicious ones for the prompt
const sample = suspicious.slice(0, 20).map(q => ({
    _id: q._id,
    question: q.question || q.vignette || q.prompt,
    options: q.options.map(o => ({ id: o.id, text: o.text, is_correct: o.is_correct || o.correct || false })),
    current_answer: (q.options.find(o => o.is_correct || o.correct) || {}).text,
    rationale: q.rationale || q.explanation || ''
}));

fs.writeFileSync('D:/Dev/MedCase/ingestion/_aota_sample.json', JSON.stringify(sample, null, 2));
console.log(`\nExported ${sample.length} sample questions to _aota_sample.json`);
