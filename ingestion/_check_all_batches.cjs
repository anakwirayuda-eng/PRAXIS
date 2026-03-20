const fs = require('fs');
const k = fs.readFileSync('D:/Dev/MedCase/.env', 'utf-8').match(/OPENAI_API_KEY=(.+)/)?.[1]?.trim();
const god = JSON.parse(fs.readFileSync('D:/Dev/MedCase/ingestion/output/god_tier_batches.json', 'utf-8'));

async function check() {
  for (const [name, id] of Object.entries(god.batches)) {
    const r = await fetch('https://api.openai.com/v1/batches/' + id, {
      headers: { 'Authorization': 'Bearer ' + k }
    });
    const d = await r.json();
    const c = d.request_counts || {};
    const status = d.status;
    const ok = c.completed || 0;
    const fail = c.failed || 0;
    const total = c.total || 0;
    const out = d.output_file_id || 'none';
    const icon = status === 'completed' && fail === 0 ? '✅' : status === 'completed' && fail > 0 ? '⚠️' : status === 'failed' ? '❌' : '🔄';
    console.log(icon + ' ' + name.padEnd(22) + ' ' + status.padEnd(12) + ' ' + ok + '/' + total + ' ok, ' + fail + ' fail  output:' + out);
  }
}
check();
