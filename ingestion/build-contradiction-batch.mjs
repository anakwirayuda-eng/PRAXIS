import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_PATH = path.join(__dirname, '../public/data/compiled_cases.json');
const REPORT_PATH = path.join(__dirname, 'output/quality_report_full.json');
const OUTPUT_DIR = path.join(__dirname, 'output');
const QUARANTINE_PATH = path.join(__dirname, '../public/data/quarantine_manifest.json');
const ENV_PATH = path.join(__dirname, '../.env');

console.log('═══ Contradiction + EXCEPT Batch Factory ═══\n');

// Read report to get case IDs
const report = JSON.parse(fs.readFileSync(REPORT_PATH, 'utf-8'));
const contradictionIds = new Set((report.by_category.rationale_contradicts_answer?.case_ids || []).map(id => typeof id === 'string' ? id : Number(id)));
const exceptIds = new Set((report.by_category.except_logic_suspect?.case_ids || []).map(id => typeof id === 'string' ? id : Number(id)));
const allTargetIds = new Set([...contradictionIds, ...exceptIds]);

console.log(`Contradiction cases: ${contradictionIds.size}`);
console.log(`EXCEPT logic suspects: ${exceptIds.size}`);
console.log(`Total unique targets: ${allTargetIds.size}\n`);

// Read database
const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
const targets = db.filter(c => allTargetIds.has(c._id));
console.log(`Matched ${targets.length} cases in database\n`);

// Build quarantine manifest
const quarantine = targets.map(c => ({
  id: c._id,
  reason: contradictionIds.has(c._id) ? 'rationale_contradicts_answer' : 'except_logic_suspect',
}));
fs.writeFileSync(QUARANTINE_PATH, JSON.stringify(quarantine, null, 2));
console.log(`✅ Quarantine manifest: ${quarantine.length} cases hidden from frontend\n`);

// Build batch JSONL
const SYSTEM_PROMPT = `You are a panel of 3 medical experts (Clinician, Board Examiner, Pharmacologist) auditing MCQ answer keys.

PROBLEM: These questions have a CONTRADICTION — the rationale/explanation says one thing but the marked answer says something else. OR they are "EXCEPT/FALSE/NOT" questions where the answer logic may be inverted.

YOUR TASK: Determine the ACTUALLY correct answer based on medical knowledge.

For EXCEPT/FALSE/NOT questions:
- The correct answer is the OUTLIER — the one that does NOT belong
- All other options should be medically valid/true
- Example: "Transmitted by all EXCEPT" → correct = the one NOT transmitted

RULES:
- Be deterministic (temperature 0)
- Base answers on Harrison's, Robbins, Guyton, reputable sources
- If question is ambiguous or truncated: confidence = "LOW"

OUTPUT (strict JSON only):
{
  "status": "FIXED",
  "_id": "case_id",
  "correct_option_id": "A|B|C|D|opa|opb|opc|opd",
  "correct_option_text": "text of correct answer",
  "confidence": "HIGH|MEDIUM|LOW",
  "reasoning": "2-3 sentence explanation with reference",
  "issue_type": "rationale_contradiction|except_logic_inverted|answer_confirmed"
}`;

const batchRequests = [];

targets.forEach(c => {
  const optionsText = (c.options || []).map(o => {
    const marker = o.is_correct ? ' [CURRENTLY MARKED CORRECT]' : '';
    return `[${o.id}] ${o.text || '(empty)'}${marker}`;
  }).join('\n');

  const qText = c.question
    || (typeof c.vignette === 'string' ? c.vignette : c.vignette?.narrative)
    || c.prompt || '(no question text)';

  const rationale = typeof c.rationale === 'string'
    ? c.rationale
    : c.rationale?.correct || '';

  const issueType = contradictionIds.has(c._id) ? 'RATIONALE CONTRADICTS ANSWER' : 'EXCEPT/FALSE LOGIC SUSPECT';

  const userContent = [
    `⚠️ ISSUE: ${issueType}`,
    `ID: ${c._id}`,
    `Question: ${qText}`,
    `Options:`,
    optionsText,
    rationale ? `\nRationale (may contradict the answer): ${rationale.substring(0, 500)}` : '',
    `\nDetermine the ACTUALLY correct answer. Output JSON only.`
  ].filter(Boolean).join('\n');

  batchRequests.push({
    custom_id: `contradiction_audit_${c._id}`,
    method: "POST",
    url: "/v1/chat/completions",
    body: {
      model: "gpt-4.1-mini",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userContent }
      ]
    }
  });
});

const batchPath = path.join(OUTPUT_DIR, 'batch_contradiction_audit.jsonl');
fs.writeFileSync(batchPath, batchRequests.map(r => JSON.stringify(r)).join('\n'));
console.log(`✅ Wrote ${batchRequests.length} requests to batch file\n`);

// Submit to OpenAI
const apiKey = fs.readFileSync(ENV_PATH, 'utf-8').match(/OPENAI_API_KEY=(.+)/)?.[1]?.trim();
if (!apiKey) { console.log('No API key — batch file created but not submitted.'); process.exit(0); }

async function submit() {
  console.log('Uploading to OpenAI...');
  const formData = new FormData();
  formData.append('purpose', 'batch');
  formData.append('file', new Blob([fs.readFileSync(batchPath)]), 'batch_contradiction_audit.jsonl');

  const upload = await fetch('https://api.openai.com/v1/files', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}` },
    body: formData,
  });
  const uploadData = await upload.json();
  if (!uploadData.id) { console.error('Upload failed:', uploadData); return; }
  console.log(`File uploaded: ${uploadData.id}`);

  const batchRes = await fetch('https://api.openai.com/v1/batches', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      input_file_id: uploadData.id,
      endpoint: '/v1/chat/completions',
      completion_window: '24h',
      metadata: { description: 'MedCase contradiction + EXCEPT logic audit' },
    }),
  });
  const batchData = await batchRes.json();

  console.log(`\n🚀 BATCH SUBMITTED!`);
  console.log(`   Batch ID: ${batchData.id}`);
  console.log(`   Status: ${batchData.status}`);
  console.log(`   Cases: ${batchRequests.length}`);

  fs.writeFileSync(path.join(OUTPUT_DIR, 'batch_contradiction_info.json'), JSON.stringify({
    batch_id: batchData.id,
    file_id: uploadData.id,
    count: batchRequests.length,
    model: 'gpt-4.1-mini',
    submitted_at: new Date().toISOString(),
    categories: { contradictions: contradictionIds.size, except_logic: exceptIds.size },
  }, null, 2));
}

submit().catch(err => console.error('Error:', err.message));
