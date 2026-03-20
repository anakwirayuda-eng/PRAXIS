import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const COMPILED_PATH = join(__dirname, '..', 'public', 'data', 'compiled_cases.json');
const MANIFEST_PATH = join(__dirname, '..', 'public', 'data', 'quarantine_manifest.json');
const PROGRESS_PATH = join(__dirname, 'reports', 'ai_triage_progress.json');
const RESULTS_PATH = join(__dirname, 'reports', 'ai_triage_results.json');
const REMEDIATION_LOG_PATH = join(__dirname, 'reports', 'remediation_log_phase3.json');

const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) {
  console.error('ERROR: Set GEMINI_API_KEY environment variable first.');
  process.exit(1);
}

const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${API_KEY}`;
const DELAY_MS = 4500; // Free tier: 15 RPM = 1 every 4s + margin
const SAVE_EVERY = 50;
const MAX_RETRIES = 3;

function readJson(p) { return JSON.parse(readFileSync(p, 'utf8')); }
function writeJson(p, v) { writeFileSync(p, JSON.stringify(v, null, 2) + '\n', 'utf8'); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function getPromptText(c) {
  return String(c?.prompt || c?.question || c?.vignette?.narrative || '').trim();
}
function getRationale(c) {
  if (typeof c?.rationale === 'string') return c.rationale.trim();
  if (typeof c?.rationale?.correct === 'string') return c.rationale.correct.trim();
  return '';
}
function getOptions(c) { return Array.isArray(c?.options) ? c.options : []; }
function getCorrectIndex(c) {
  const opts = getOptions(c);
  return opts.findIndex(o => o?.is_correct === true);
}

const LETTERS = ['A', 'B', 'C', 'D', 'E'];

function buildPrompt(caseRecord) {
  const prompt = getPromptText(caseRecord);
  const opts = getOptions(caseRecord);
  const correctIdx = getCorrectIndex(caseRecord);
  const rationale = getRationale(caseRecord);

  const optionLines = opts.map((o, i) =>
    `${LETTERS[i]}. ${String(o?.text || '').trim()}`
  ).join('\n');

  const correctLetter = LETTERS[correctIdx] || '?';
  const correctText = opts[correctIdx]?.text || '?';

  return `You are a medical education expert reviewing an MCQ question bank for accuracy.

QUESTION: ${prompt}

OPTIONS:
${optionLines}

MARKED CORRECT: ${correctLetter}. ${correctText}

RATIONALE PROVIDED:
${rationale.slice(0, 1500)}

Analyze whether:
1. The rationale is discussing the SAME medical topic as the question
2. The marked correct answer is actually supported by the rationale
3. If the rationale suggests a DIFFERENT answer, which one?

Respond in EXACTLY this JSON format, nothing else:
{"verdict":"KEEP"|"UNQUARANTINE"|"FIX","reason":"brief explanation","suggested_correct":"A"|"B"|"C"|"D"|null,"confidence":"high"|"medium"|"low"}

Rules:
- UNQUARANTINE if rationale matches the question topic and supports the marked answer (even using different terminology/synonyms)
- KEEP if rationale truly discusses a completely different topic/question
- FIX if rationale clearly supports a DIFFERENT option than marked correct — set suggested_correct to that option letter
- confidence: high = very sure, medium = likely, low = uncertain`;
}

async function callGemini(promptText, retries = 0) {
  const body = {
    contents: [{ parts: [{ text: promptText }] }],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 200,
    }
  };

  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (res.status === 429 && retries < MAX_RETRIES) {
      console.log(`  Rate limited, waiting 10s (retry ${retries + 1})...`);
      await sleep(10000);
      return callGemini(promptText, retries + 1);
    }

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`API ${res.status}: ${errText.slice(0, 200)}`);
    }

    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    
    // Extract JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error(`No JSON in response: ${text.slice(0, 100)}`);
    
    return JSON.parse(jsonMatch[0]);
  } catch (err) {
    if (retries < MAX_RETRIES) {
      console.log(`  Error: ${err.message}, retrying...`);
      await sleep(2000);
      return callGemini(promptText, retries + 1);
    }
    throw err;
  }
}

async function main() {
  const compiledCases = readJson(COMPILED_PATH);
  const manifest = readJson(MANIFEST_PATH);
  const caseMap = new Map(compiledCases.map(c => [String(c._id), c]));
  const quarantineIds = new Set(manifest.map(e => String(e.id)));

  // Load progress if resuming
  let progress = [];
  const processedIds = new Set();
  if (existsSync(PROGRESS_PATH)) {
    progress = readJson(PROGRESS_PATH);
    progress.forEach(r => processedIds.add(String(r._id)));
    console.log(`Resuming: ${processedIds.size} already processed.`);
  }

  // Get quarantined cases to process
  const toProcess = manifest
    .filter(e => !processedIds.has(String(e.id)))
    .map(e => ({ entry: e, caseRecord: caseMap.get(String(e.id)) }))
    .filter(x => x.caseRecord);

  console.log(`=== PHASE 3 AI TRIAGE ===`);
  console.log(`Total quarantined: ${manifest.length}`);
  console.log(`Already processed: ${processedIds.size}`);
  console.log(`To process: ${toProcess.length}`);
  console.log('');

  let done = 0;
  let errors = 0;

  for (const { entry, caseRecord } of toProcess) {
    const id = caseRecord._id;
    const code = caseRecord.case_code || '';
    
    try {
      const prompt = buildPrompt(caseRecord);
      const result = await callGemini(prompt);
      
      progress.push({
        _id: id,
        case_code: code,
        verdict: result.verdict || 'KEEP',
        reason: result.reason || '',
        suggested_correct: result.suggested_correct || null,
        confidence: result.confidence || 'low',
      });
      
      done++;
      const pct = ((processedIds.size + done) / manifest.length * 100).toFixed(1);
      if (done % 10 === 0 || done <= 5) {
        console.log(`[${pct}%] #${done} _id=${id} ${code} → ${result.verdict} (${result.confidence}): ${(result.reason || '').slice(0, 60)}`);
      }
    } catch (err) {
      console.log(`[ERROR] _id=${id} ${code}: ${err.message}`);
      progress.push({
        _id: id,
        case_code: code,
        verdict: 'ERROR',
        reason: err.message,
        suggested_correct: null,
        confidence: 'low',
      });
      errors++;
    }

    // Save progress periodically
    if ((done + errors) % SAVE_EVERY === 0) {
      writeJson(PROGRESS_PATH, progress);
      console.log(`  (progress saved: ${done + errors} processed)`);
    }

    await sleep(DELAY_MS);
  }

  // Final save
  writeJson(PROGRESS_PATH, progress);
  writeJson(RESULTS_PATH, progress);

  // === Apply changes ===
  const stats = { unquarantine: 0, fix_applied: 0, fix_logged: 0, keep: 0, error: 0 };
  const remediationLog = [];
  const unquarantineIds = new Set();

  for (const r of progress) {
    if (r.verdict === 'ERROR') { stats.error++; continue; }
    if (r.verdict === 'KEEP') { stats.keep++; continue; }
    
    if (r.verdict === 'UNQUARANTINE') {
      stats.unquarantine++;
      unquarantineIds.add(String(r._id));
      const c = caseMap.get(String(r._id));
      if (c) {
        if (!c.meta) c.meta = {};
        c.meta.ai_triage_cleared = true;
      }
    }

    if (r.verdict === 'FIX') {
      const c = caseMap.get(String(r._id));
      if (!c) continue;
      
      const opts = getOptions(c);
      const sugIdx = LETTERS.indexOf(r.suggested_correct);
      
      if (r.confidence === 'high' && sugIdx >= 0 && sugIdx < opts.length) {
        // Apply fix
        const oldIdx = getCorrectIndex(c);
        opts.forEach((o, i) => { o.is_correct = (i === sugIdx); });
        if (!c.meta) c.meta = {};
        c.meta.ai_triage_fixed = true;
        stats.fix_applied++;
        unquarantineIds.add(String(r._id));
        remediationLog.push({
          _id: r._id,
          case_code: r.case_code,
          action: 'ai_triage_fix',
          from_index: oldIdx,
          to_index: sugIdx,
          reason: r.reason,
          confidence: r.confidence,
          timestamp: new Date().toISOString(),
        });
      } else {
        // Log only, keep quarantined
        stats.fix_logged++;
        remediationLog.push({
          _id: r._id,
          case_code: r.case_code,
          action: 'ai_triage_suggestion_only',
          suggested_index: sugIdx,
          reason: r.reason,
          confidence: r.confidence,
          timestamp: new Date().toISOString(),
        });
      }
    }
  }

  // Update manifest
  const newManifest = manifest.filter(e => !unquarantineIds.has(String(e.id)));
  
  // Write everything
  writeJson(COMPILED_PATH.replace('.json', '.json'), compiledCases);
  writeFileSync(COMPILED_PATH, JSON.stringify(compiledCases), 'utf8');
  writeJson(MANIFEST_PATH, newManifest);
  if (remediationLog.length > 0) writeJson(REMEDIATION_LOG_PATH, remediationLog);

  const cleanCount = compiledCases.length - newManifest.length;

  console.log('');
  console.log('=== PHASE 3 RESULTS ===');
  console.log(`Total triaged: ${progress.length}`);
  console.log(`UNQUARANTINE: ${stats.unquarantine}`);
  console.log(`FIX (applied, high confidence): ${stats.fix_applied}`);
  console.log(`FIX (logged only, med/low): ${stats.fix_logged}`);
  console.log(`KEEP (confirmed bad): ${stats.keep}`);
  console.log(`ERRORS/skipped: ${stats.error}`);
  console.log(`Final quarantine: ${newManifest.length}`);
  console.log(`Final clean: ${cleanCount}`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
