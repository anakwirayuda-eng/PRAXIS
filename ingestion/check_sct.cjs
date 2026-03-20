const fs = require('fs');
const lines = fs.readFileSync('D:/Dev/MedCase/ingestion/output/sct_batch_result.jsonl', 'utf-8').split('\n').filter(l => l.trim());
const r = JSON.parse(lines[0]);
const content = JSON.parse(r.response.body.choices[0].message.content);
console.log('custom_id:', r.custom_id);
console.log(JSON.stringify(content, null, 2));

// Also check a source case
const cases = JSON.parse(fs.readFileSync('D:/Dev/MedCase/ingestion/output/compiled_cases.json', 'utf-8'));
const sourceId = parseInt(r.custom_id.replace('sct_', ''), 10);
const src = cases.find(c => c._id === sourceId);
if (src) {
  console.log('\n--- SOURCE CASE ---');
  console.log('narrative:', (src.vignette?.narrative || '').substring(0, 200));
  console.log('prompt:', src.prompt);
}
