import fs from 'fs';

const db = JSON.parse(fs.readFileSync('D:/Dev/MedCase/public/data/compiled_cases.json','utf-8'));
const scts = db.filter(c => c.q_type === 'SCT' && (c.source || '').startsWith('ai-generated'));

console.log('Total AI-generated SCT:', scts.length);

const dist = {'-2':0,'-1':0,'0':0,'+1':0,'+2':0};
scts.forEach(q => {
    const correct = q.options.find(o => o.is_correct);
    if(correct) dist[correct.id]++;
});

console.log('\n=== DISTRIBUSI KUNCI JAWABAN ===');
const labels = {'-2':'Sangat Menyingkirkan','-1':'Menyingkirkan','0':'Tidak Berpengaruh','+1':'Mendukung','+2':'Sangat Mendukung'};
for (const [k,v] of Object.entries(dist)) {
    const pct = ((v/scts.length)*100).toFixed(1);
    const bar = '#'.repeat(v);
    console.log('  ' + k.padStart(2) + ' (' + labels[k].padEnd(22) + '): ' + String(v).padStart(3) + ' soal (' + pct.padStart(5) + '%) ' + bar);
}

// Gray zone ratio
const extreme = dist['-2'] + dist['+2'];
const gray = dist['-1'] + dist['+1'];
const neutral = dist['0'];
console.log('\n=== RINGKASAN ===');
console.log('  Extreme (-2/+2) : ' + extreme + ' soal (' + ((extreme/scts.length)*100).toFixed(1) + '%)');
console.log('  Gray    (-1/+1) : ' + gray + ' soal (' + ((gray/scts.length)*100).toFixed(1) + '%)');
console.log('  Neutral (0)     : ' + neutral + ' soal (' + ((neutral/scts.length)*100).toFixed(1) + '%)');

console.log('\n=== DETAIL PER BATCH ===');
const batches = {};
scts.forEach(q => {
    const b = q.source || 'unknown';
    if(!batches[b]) batches[b] = {'-2':0,'-1':0,'0':0,'+1':0,'+2':0, total:0};
    const correct = q.options.find(o => o.is_correct);
    if(correct) { batches[b][correct.id]++; batches[b].total++; }
});
for (const [b,d] of Object.entries(batches)) {
    console.log('\n  ' + b + ' (' + d.total + ' soal):');
    for (const k of ['-2','-1','0','+1','+2']) {
        if (d[k] > 0) console.log('    ' + k.padStart(2) + ': ' + d[k]);
    }
}

// List all questions with their correct answer
console.log('\n=== DAFTAR SOAL + KUNCI ===');
scts.forEach((q, i) => {
    const correct = q.options.find(o => o.is_correct);
    const key = correct ? correct.id : '?';
    const cat = q.category || '?';
    const id = q._id || q.id;
    console.log('  ' + String(i+1).padStart(2) + '. [' + key.padStart(2) + '] ' + cat.padEnd(15) + ' ' + id);
});
