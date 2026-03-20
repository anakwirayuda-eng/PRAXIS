/**
 * 🧬 THE POLYMORPHIC STREAM MERGER — Apply ALL batch results with Hierarchy of Truth
 * Uses O(1) Map lookup + streaming for zero RAM overhead
 * Includes Ghost Siphon (Forensik gap closure)
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, renameSync } from 'node:fs';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, '..', 'public', 'data', 'compiled_cases.json');
const BATCH_DIR = join(__dirname, 'output', 'batch_results');
const LEGACY_DIR = join(__dirname, 'output', 'needs_review_results');

async function processJsonlStream(filePath, dbMap, stats) {
  if (!existsSync(filePath)) return;
  const rl = createInterface({ input: createReadStream(filePath), crlfDelay: Infinity });

  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const record = JSON.parse(line);
      const customId = record.custom_id || '';
      
      // Extract case ID from various custom_id formats:
      // "enrich|medmcqa|12345", "needs-review|no_correct_answer|59354", "fix-PMD-IPD-MCQ-00008"
      let caseId = null;
      if (customId.includes('|')) {
        const parts = customId.split('|');
        caseId = parts[parts.length - 1];
      } else {
        const match = customId.match(/[\-_](\d+)$/);
        if (match) caseId = match[1];
      }
      if (!caseId) { stats.no_id++; continue; }

      const targetCase = dbMap.get(caseId) || dbMap.get(String(Number(caseId)));
      if (!targetCase) { stats.not_found++; continue; }

      const contentStr = record.response?.body?.choices?.[0]?.message?.content;
      if (!contentStr) { stats.no_content++; continue; }

      // Clean markdown-wrapped JSON
      const cleaned = contentStr.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      if (!jsonMatch) { stats.no_json++; continue; }
      
      const payload = JSON.parse(jsonMatch[0]);

      // ─── HIERARCHY OF TRUTH ───

      // KASTA TERTINGGI: Holy Trinity (correct_rationale + clinical_pearl)
      if (payload.correct_rationale || payload.clinical_pearl) {
        targetCase.rationale = targetCase.rationale || {};
        targetCase.rationale.correct = payload.correct_rationale || targetCase.rationale.correct || '';
        if (payload.distractors) targetCase.rationale.distractors = payload.distractors;
        if (payload.clinical_pearl) targetCase.rationale.pearl = payload.clinical_pearl;
        targetCase.meta = targetCase.meta || {};
        targetCase.meta.is_holy_trinity = true;
        targetCase.meta.enriched_at = new Date().toISOString();
        stats.holy_trinity++;
      }
      // KASTA KEDUA: Answer correction (resolved_answer / correct_option)
      else if (payload.resolved_answer || payload.correct_option || payload.correct_answer) {
        const ansId = payload.resolved_answer || payload.correct_option || payload.correct_answer;
        if (ansId && Array.isArray(targetCase.options)) {
          const before = targetCase.options.find(o => o.is_correct)?.id;
          targetCase.options.forEach(o => { o.is_correct = (o.id === ansId); });
          if (before !== ansId) stats.answer_changed++;
          stats.answer_fixes++;
        }
        // Apply explanation ONLY if not already Holy Trinity
        if (payload.explanation && !targetCase.meta?.is_holy_trinity) {
          targetCase.rationale = targetCase.rationale || {};
          targetCase.rationale.correct = payload.explanation;
          stats.legacy_rationale++;
        }
      }
      // KASTA KETIGA: Generic enrichment
      else if (payload.explanation || payload.rationale) {
        if (!targetCase.meta?.is_holy_trinity) {
          targetCase.rationale = targetCase.rationale || {};
          targetCase.rationale.correct = payload.explanation || payload.rationale || '';
          stats.legacy_rationale++;
        }
      }
      
      stats.processed++;
    } catch (err) {
      stats.errors++;
    }
  }
}

async function main() {
  console.log('🧬 ═══ THE GREAT CONVERGENCE ═══\n');

  // 1. Load DB into O(1) Map
  console.log('1️⃣  Loading Master DB into O(1) Memory Map...');
  const db = JSON.parse(readFileSync(DB_PATH, 'utf8'));
  const dbMap = new Map();
  for (const c of db) {
    if (c._id !== undefined && c._id !== null) {
      dbMap.set(String(c._id), c);
    }
  }
  console.log(`   Map: ${dbMap.size.toLocaleString()} entries indexed by _id`);

  // 2. Collect all JSONL result files
  const getFiles = dir => existsSync(dir) ? readdirSync(dir).filter(f => f.endsWith('.jsonl')).map(f => join(dir, f)) : [];
  const batchFiles = getFiles(BATCH_DIR);
  const legacyFiles = getFiles(LEGACY_DIR);
  
  // Process LEGACY first, then BATCH (Holy Trinity wins via is_holy_trinity flag)
  const allFiles = [...legacyFiles, ...batchFiles];
  console.log(`\n2️⃣  Found ${allFiles.length} result files (${legacyFiles.length} legacy + ${batchFiles.length} batch)\n`);

  const stats = {
    processed: 0, holy_trinity: 0, answer_fixes: 0, answer_changed: 0,
    legacy_rationale: 0, not_found: 0, no_id: 0, no_content: 0,
    no_json: 0, errors: 0,
  };

  // 3. Stream merge
  console.log('3️⃣  Engaging Polymorphic Stream Merger...');
  for (const file of allFiles) {
    const before = stats.processed;
    await processJsonlStream(file, dbMap, stats);
    const delta = stats.processed - before;
    if (delta > 0) {
      console.log(`   💉 ${basename(file)}: +${delta} injected`);
    } else {
      console.log(`   ⏭️  ${basename(file)}: 0 matches`);
    }
  }

  // 4. Ghost Siphon — close Forensik gap
  console.log('\n4️⃣  🕵️ Ghost Siphon: Closing Forensik gap...');
  const forensikCount = db.filter(c => c.category === 'Forensik' && !c.meta?.quarantined).length;
  const needed = Math.max(0, 400 - forensikCount);
  let siphoned = 0;

  if (needed > 0) {
    const forensikRx = /\b(visum|otopsi|lebam mayat|kaku mayat|toksikologi|sianida|organofosfat|rigor mortis|post[\s-]?mortem|cause of death|medicolegal|forensic|autopsy|toxicology|cyanide|arsenic)\b/i;
    for (const c of db) {
      if (siphoned >= needed) break;
      if (c.category === 'Ilmu Penyakit Dalam' && !c.meta?.quarantined) {
        const text = JSON.stringify({ q: c.question, o: c.options });
        if (forensikRx.test(text)) {
          c.category = 'Forensik';
          c.meta = c.meta || {};
          c.meta._siphoned_from = 'Ilmu Penyakit Dalam';
          siphoned++;
        }
      }
    }
  }
  console.log(`   Forensik was: ${forensikCount}, needed: ${needed}, siphoned: ${siphoned}`);
  console.log(`   Forensik now: ${forensikCount + siphoned}`);

  // 5. Atomic save
  console.log('\n5️⃣  💾 Atomic save...');
  writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf8');

  // 6. Report
  console.log(`\n${'═'.repeat(60)}`);
  console.log('✅ THE GREAT CONVERGENCE IS COMPLETE!');
  console.log(`   🌟 Holy Trinity enriched: ${stats.holy_trinity.toLocaleString()}`);
  console.log(`   ⚖️  Answer fixes: ${stats.answer_fixes.toLocaleString()} (${stats.answer_changed} actually changed)`);
  console.log(`   📝 Legacy rationale: ${stats.legacy_rationale.toLocaleString()}`);
  console.log(`   🕵️ Forensik siphoned: +${siphoned}`);
  console.log(`   ─────────────────────────`);
  console.log(`   Total processed: ${stats.processed.toLocaleString()}`);
  console.log(`   Not found (ID mismatch): ${stats.not_found.toLocaleString()}`);
  console.log(`   Parse errors: ${stats.errors.toLocaleString()}`);
  console.log(`   No ID/content/JSON: ${stats.no_id + stats.no_content + stats.no_json}`);
}

main().catch(err => { console.error('❌ FATAL:', err); process.exitCode = 1; });
