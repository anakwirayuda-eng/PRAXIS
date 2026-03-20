import fs from 'fs';

// Usage: node ingestion/_extract_aota_batch.mjs [batchNumber]
// Extracts 20 "All of the Above" questions per batch for deep-think audit

const BATCH_SIZE = 20;
const batchNum = parseInt(process.argv[2] || '1');
const startIdx = (batchNum - 1) * BATCH_SIZE;

const db = JSON.parse(fs.readFileSync('D:/Dev/MedCase/public/data/compiled_cases.json','utf-8'));

const suspicious = db.filter(q => {
    if (!q.options || q.q_type === 'SCT') return false;
    return q.options.some(o => {
        const t = (o.text || '').toLowerCase();
        return t.includes('all of the above') || t.includes('none of the above') ||
               t.includes('all are correct') || t.includes('all are true') ||
               t.includes('semua benar') || t.includes('semua di atas');
    });
});

const totalBatches = Math.ceil(suspicious.length / BATCH_SIZE);
console.log('Total AOTA questions: ' + suspicious.length);
console.log('Total batches (' + BATCH_SIZE + '/batch): ' + totalBatches);
console.log('Extracting batch ' + batchNum + '/' + totalBatches + ' (index ' + startIdx + '-' + (startIdx + BATCH_SIZE - 1) + ')\n');

const batch = suspicious.slice(startIdx, startIdx + BATCH_SIZE).map(q => ({
    _id: q._id,
    question: q.question || q.vignette || q.prompt || '',
    options: (q.options || []).map(o => ({
        id: o.id,
        text: o.text,
        is_correct: !!(o.is_correct || o.correct)
    })),
    category: q.category || q.subject || '',
    source: q.source || ''
}));

if (batch.length === 0) {
    console.log('No more questions in this batch range.');
    process.exit(0);
}

const output = JSON.stringify(batch, null, 2);
const outPath = 'D:/Dev/MedCase/ingestion/_aota_batch_' + batchNum + '.json';
fs.writeFileSync(outPath, output);
console.log('Batch ' + batchNum + ' exported to: ' + outPath);
console.log('Contains ' + batch.length + ' questions.\n');
