import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_PATH = path.join(__dirname, '../public/data/compiled_cases.json');
const INFO_PATH = path.join(__dirname, 'output/batch_answer_audit_info.json');
const ENV_PATH = path.join(__dirname, '../.env');
const RESULTS_PATH = path.join(__dirname, 'output/batch_answer_audit_results.jsonl');

const apiKey = fs.readFileSync(ENV_PATH, 'utf-8').match(/OPENAI_API_KEY=(.+)/)?.[1]?.trim();
const info = JSON.parse(fs.readFileSync(INFO_PATH, 'utf-8'));

console.log('═══ Download & Apply Answer Audit Results ═══\n');

// Step 1: Get batch status and output file ID
async function run() {
  console.log('Fetching batch status...');
  const batchRes = await fetch(`https://api.openai.com/v1/batches/${info.batch_id}`, {
    headers: { 'Authorization': `Bearer ${apiKey}` },
  });
  const batch = await batchRes.json();

  if (batch.status !== 'completed') {
    console.log(`Batch status: ${batch.status} — not ready yet.`);
    return;
  }

  const outputFileId = batch.output_file_id;
  console.log(`Batch completed. Downloading output file: ${outputFileId}`);

  // Step 2: Download results
  const fileRes = await fetch(`https://api.openai.com/v1/files/${outputFileId}/content`, {
    headers: { 'Authorization': `Bearer ${apiKey}` },
  });
  const content = await fileRes.text();
  fs.writeFileSync(RESULTS_PATH, content);
  console.log(`Downloaded ${content.split('\n').filter(Boolean).length} results\n`);

  // Step 3: Parse results
  const results = content.trim().split('\n').map(line => {
    try { return JSON.parse(line); }
    catch { return null; }
  }).filter(Boolean);

  const fixes = { HIGH: 0, MEDIUM: 0, LOW: 0, failed: 0, applied: 0 };

  const fixMap = new Map(); // _id -> { correct_option_id, confidence, reasoning }

  for (const result of results) {
    const customId = result.custom_id; // e.g. "answer_audit_12345"
    const caseId = customId.replace('answer_audit_', '');

    try {
      const msg = result.response?.body?.choices?.[0]?.message?.content;
      if (!msg) { fixes.failed++; continue; }

      const parsed = JSON.parse(msg);
      const conf = parsed.confidence || 'LOW';
      fixes[conf] = (fixes[conf] || 0) + 1;

      if (conf === 'HIGH' || conf === 'MEDIUM') {
        const fixData = {
          correct_option_id: parsed.correct_option_id || parsed.correct_answer_id,
          correct_option_text: parsed.correct_option_text || parsed.correct_answer_text,
          confidence: conf,
          reasoning: (parsed.reasoning || parsed.consensus_note || '').substring(0, 500),
        };
        // Store both string and number versions for matching
        fixMap.set(caseId, fixData);
        if (!isNaN(Number(caseId))) fixMap.set(Number(caseId), fixData);
      }
    } catch (e) {
      fixes.failed++;
    }
  }

  console.log('Parse results:');
  console.log(`  HIGH confidence: ${fixes.HIGH}`);
  console.log(`  MEDIUM confidence: ${fixes.MEDIUM}`);
  console.log(`  LOW confidence: ${fixes.LOW}`);
  console.log(`  Parse failures: ${fixes.failed}`);
  console.log(`  Fixable (HIGH+MEDIUM): ${fixMap.size}\n`);

  // Step 4: Apply to database
  console.log('Loading database...');
  const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));

  for (const c of db) {
    const id = c._id;
    const fix = fixMap.get(id);
    if (!fix) continue;

    // Find the correct option and mark it
    let applied = false;
    const optId = fix.correct_option_id;
    // Build set of possible ID matches: 'opd' -> ['opd', 'D', 'd', '4']
    const idVariants = new Set([optId]);
    if (optId?.startsWith('op')) {
      const letter = optId.slice(2).toUpperCase();
      idVariants.add(letter);
      idVariants.add(letter.toLowerCase());
      idVariants.add(optId.toLowerCase());
      // Also index: opa=0, opb=1, opc=2, opd=3
      const idx = optId.charCodeAt(2) - 97; // 'a'=0
      if (idx >= 0 && idx < (c.options || []).length) idVariants.add(String(idx));
    } else if (optId?.length === 1) {
      idVariants.add('op' + optId.toLowerCase());
      idVariants.add(optId.toUpperCase());
      idVariants.add(optId.toLowerCase());
    }

    for (const opt of (c.options || [])) {
      if (idVariants.has(opt.id) || idVariants.has(String(opt.id))) {
        opt.is_correct = true;
        applied = true;
      } else if (fix.confidence === 'HIGH') {
        opt.is_correct = false;
      }
    }

    if (applied) {
      // Update rationale if empty
      if (typeof c.rationale === 'object') {
        if (!c.rationale.correct || c.rationale.correct === 'Explanation unavailable.') {
          c.rationale.correct = fix.reasoning;
        }
      } else if (!c.rationale || c.rationale === 'Explanation unavailable.') {
        c.rationale = fix.reasoning;
      }

      // Clear needs_review flag
      if (c.meta) {
        c.meta.needs_review = false;
        c.meta.ai_audited = true;
        c.meta.audit_confidence = fix.confidence;
      }
      fixes.applied++;
    }
  }

  console.log(`Applied ${fixes.applied} answer key fixes to database`);
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
  console.log('Database saved!\n');

  console.log('═══ SUMMARY ═══');
  console.log(`Total audited: ${results.length}`);
  console.log(`Applied (HIGH+MED): ${fixes.applied}`);
  console.log(`Skipped (LOW): ${fixes.LOW}`);
  console.log(`Failed to parse: ${fixes.failed}`);
}

run().catch(err => console.error('Error:', err.message));
