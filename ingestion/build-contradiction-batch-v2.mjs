import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_PATH = path.join(__dirname, '../public/data/compiled_cases.json');
const OUTPUT_DIR = path.join(__dirname, 'output');
const ENV_PATH = path.join(__dirname, '../.env');

console.log('═══ Contradiction Batch v2 — Direct DB Scan ═══\n');
const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));

const targets = [];

db.forEach((c, idx) => {
  if (c.q_type === 'SCT') return;
  if (c.meta?.quarantined) return;

  const correctOpt = (c.options || []).find(o => o.is_correct);
  if (!correctOpt) return; // no answer = already handled by batch 1

  const qText = (c.question || c.vignette?.narrative || c.prompt || '').toLowerCase();
  const ratText = (typeof c.rationale === 'string' ? c.rationale : c.rationale?.correct || '').toLowerCase();
  
  // AUDIT 1: Rationale contradicts answer
  // Check if rationale mentions a DIFFERENT option's text as the answer
  if (ratText.length > 20) {
    for (const opt of (c.options || [])) {
      if (opt.is_correct) continue;
      const optTextLower = (opt.text || '').toLowerCase().trim();
      if (optTextLower.length < 4) continue;
      // If rationale explicitly mentions another option's text with keywords
      if (ratText.includes(optTextLower) && (
        ratText.includes(`answer is ${optTextLower}`) ||
        ratText.includes(`correct answer is ${optTextLower}`) ||
        ratText.includes(`${optTextLower} is correct`) ||
        ratText.includes(`${optTextLower} is the answer`) ||
        ratText.includes(`${optTextLower} is the correct`)
      )) {
        targets.push({ case: c, idx, reason: 'rationale_contradicts_answer' });
        break;
      }
    }
  }

  // AUDIT 2: EXCEPT/FALSE/NOT logic traps
  if (/\b(except|false|incorrect|not true|wrong|least likely|not a feature|not seen|not associated|not included|is not)\b/i.test(qText)) {
    // The correct answer should be the OUTLIER
    // Simple heuristic: if rationale explains WHY the correct answer is TRUE (not false), logic may be inverted
    if (ratText.length > 20 && correctOpt.text) {
      const correctTextLower = correctOpt.text.toLowerCase();
      // If rationale says the "correct" answer is actually true/valid, then the EXCEPT logic is inverted
      if (
        ratText.includes(`${correctTextLower} is true`) ||
        ratText.includes(`${correctTextLower} is correct`) ||
        ratText.includes(`${correctTextLower} is a feature`) ||
        ratText.includes(`${correctTextLower} is seen in`) ||
        ratText.includes(`${correctTextLower} is associated`)
      ) {
        targets.push({ case: c, idx, reason: 'except_logic_suspect' });
      }
    }
  }
});

// Deduplicate
const seen = new Set();
const unique = targets.filter(t => {
  if (seen.has(t.case._id)) return false;
  seen.add(t.case._id);
  return true;
});

console.log(`Found ${unique.length} cases by direct DB scan`);
console.log(`  - rationale_contradicts_answer: ${unique.filter(t => t.reason === 'rationale_contradicts_answer').length}`);
console.log(`  - except_logic_suspect: ${unique.filter(t => t.reason === 'except_logic_suspect').length}\n`);

if (unique.length === 0) {
  console.log('No contradiction cases found. The previous batch + manual fixes may have resolved them.');
  process.exit(0);
}

// Build batch JSONL
const SYSTEM_PROMPT = `You are 3 medical experts (Clinician, Board Examiner, Pharmacologist) auditing MCQ answer keys.

PROBLEM: These questions have issues — either the rationale contradicts the marked answer, or an EXCEPT/FALSE question may have inverted logic.

For EXCEPT/FALSE/NOT questions: the correct answer is the OUTLIER that does NOT belong.

OUTPUT (strict JSON only):
{
  "status": "FIXED|VERIFIED",
  "_id": "case_id",
  "correct_option_id": "A|B|C|D",
  "correct_option_text": "text",
  "confidence": "HIGH|MEDIUM|LOW",
  "reasoning": "2-3 sentence explanation"
}`;

const batchRequests = unique.map(t => {
  const c = t.case;
  const optionsText = (c.options || []).map(o => {
    const marker = o.is_correct ? ' [CURRENTLY MARKED CORRECT]' : '';
    return `[${o.id}] ${o.text || '(empty)'}${marker}`;
  }).join('\n');

  const qText = c.question || c.vignette?.narrative || c.prompt || '';
  const rationale = typeof c.rationale === 'string' ? c.rationale : c.rationale?.correct || '';

  return {
    custom_id: `contradiction_v2_${c._id}`,
    method: "POST",
    url: "/v1/chat/completions",
    body: {
      model: "gpt-4.1-mini",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `⚠️ ${t.reason}\nID: ${c._id}\nQ: ${qText}\nOptions:\n${optionsText}\nRationale: ${rationale.substring(0,500)}\n\nDetermine correct answer. JSON only.` }
      ]
    }
  };
});

const batchPath = path.join(OUTPUT_DIR, 'batch_contradiction_v2.jsonl');
fs.writeFileSync(batchPath, batchRequests.map(r => JSON.stringify(r)).join('\n'));
console.log(`✅ Wrote ${batchRequests.length} requests\n`);

// Submit
const apiKey = fs.readFileSync(ENV_PATH, 'utf-8').match(/OPENAI_API_KEY=(.+)/)?.[1]?.trim();
if (!apiKey) { console.log('No API key'); process.exit(0); }

async function submit() {
  console.log('Uploading...');
  const formData = new FormData();
  formData.append('purpose', 'batch');
  formData.append('file', new Blob([fs.readFileSync(batchPath)]), 'batch_contradiction_v2.jsonl');

  const upload = await fetch('https://api.openai.com/v1/files', {
    method: 'POST', headers: { 'Authorization': `Bearer ${apiKey}` }, body: formData,
  });
  const uploadData = await upload.json();
  if (!uploadData.id) { console.error('Upload failed:', uploadData); return; }

  const batchRes = await fetch('https://api.openai.com/v1/batches', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      input_file_id: uploadData.id,
      endpoint: '/v1/chat/completions',
      completion_window: '24h',
      metadata: { description: 'MedCase contradiction audit v2 (direct DB scan)' },
    }),
  });
  const batchData = await batchRes.json();
  console.log(`🚀 BATCH SUBMITTED: ${batchData.id} (${batchRequests.length} cases)`);

  fs.writeFileSync(path.join(OUTPUT_DIR, 'batch_contradiction_v2_info.json'), JSON.stringify({
    batch_id: batchData.id, count: batchRequests.length, submitted_at: new Date().toISOString(),
  }, null, 2));
}

submit().catch(err => console.error('Error:', err.message));
