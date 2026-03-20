const fs = require('fs');
const k = fs.readFileSync('D:/Dev/MedCase/.env', 'utf-8').match(/OPENAI_API_KEY=(.+)/)?.[1]?.trim();
const chunks = JSON.parse(fs.readFileSync('D:/Dev/MedCase/ingestion/output/fase2_batch_chunks.json', 'utf-8'));

async function check() {
  for (const b of chunks) {
    const r = await fetch('https://api.openai.com/v1/batches/' + b.id, {
      headers: { 'Authorization': 'Bearer ' + k }
    });
    const d = await r.json();
    console.log(`Chunk ${b.chunk}: ${d.status} (${d.request_counts?.completed||0}/${d.request_counts?.total||0}, failed:${d.request_counts?.failed||0}) output:${d.output_file_id||'none'}`);
    if (d.errors?.data?.length) console.log('  Error:', d.errors.data[0].message);
  }
}
check();
