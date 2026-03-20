/**
 * Ingest 3 Completed Batch Results:
 * 1. SCT Factory (500 MCQ→SCT mutations with expert panels)
 * 2. Asian Med translations (TW 1413 + JP 146 → ID)
 * 3. Greek MCQA translations (1602 GR → ID)
 */
const fs = require('fs');
const path = require('path');

const OUTPUT = path.join(__dirname, 'output');

function guessCategory(text) {
  const t = (text || '').toLowerCase();
  if (/cardio|heart|ecg|coronary|myocard|arrhyth|atrial/i.test(t)) return 'cardiology';
  if (/pulmon|lung|pneumon|asthma|copd|bronch/i.test(t)) return 'pulmonology';
  if (/neuro|brain|stroke|seizure|epilep|meningit/i.test(t)) return 'neurology';
  if (/paediatric|pediatric|child|neonat|infant/i.test(t)) return 'pediatrics';
  if (/obstetric|gynae|gynec|pregnan|labour/i.test(t)) return 'obgyn';
  if (/derma|skin|rash|eczema/i.test(t)) return 'dermatology';
  if (/ophthalm|eye|visual|cataract/i.test(t)) return 'ophthalmology';
  if (/psychiatr|depress|anxiety|schizo/i.test(t)) return 'psychiatry';
  if (/surg|fractur|trauma|hernia|orthop/i.test(t)) return 'surgery';
  if (/renal|kidney|nephro|dialys/i.test(t)) return 'nephrology';
  if (/gastro|liver|hepat|bowel|pancrea/i.test(t)) return 'gastroenterology';
  if (/diabet|thyroid|endocrin|insulin/i.test(t)) return 'endocrinology';
  if (/anaemia|anemia|haematol|leukemia/i.test(t)) return 'hematology';
  if (/pharmaco|drug|dose|receptor/i.test(t)) return 'pharmacology';
  if (/anatomy|muscle|nerve|bone/i.test(t)) return 'anatomy';
  if (/micro|bacteri|virus|fungal|parasit/i.test(t)) return 'microbiology';
  if (/forens|autopsy|medico/i.test(t)) return 'forensics';
  return 'internal-medicine';
}

(async () => {
  console.log('═══ Batch Results Ingestion ═══\n');

  const envFile = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf-8');
  const API_KEY = envFile.match(/^OPENAI_API_KEY\s*=\s*['"]?([^'"\r\n]+)['"]?/m)?.[1]?.trim();
  const manifest = JSON.parse(fs.readFileSync(path.join(OUTPUT, 'god_tier_batches.json'), 'utf-8'));

  // Helper: download batch output file
  async function downloadBatchOutput(batchId, label) {
    console.log(`\n📥 ${label}: fetching batch ${batchId}...`);
    const bRes = await fetch(`https://api.openai.com/v1/batches/${batchId}`, {
      headers: { 'Authorization': `Bearer ${API_KEY}` },
    });
    const batch = await bRes.json();
    
    if (batch.status !== 'completed') {
      console.log(`  ⏳ Status: ${batch.status} — skipping`);
      return null;
    }
    
    const fileId = batch.output_file_id;
    if (!fileId) { console.log('  ❌ No output file'); return null; }
    
    console.log(`  Downloading ${fileId}...`);
    const fRes = await fetch(`https://api.openai.com/v1/files/${fileId}/content`, {
      headers: { 'Authorization': `Bearer ${API_KEY}` },
    });
    const text = await fRes.text();
    const lines = text.trim().split('\n').filter(l => l.length > 0);
    console.log(`  Got ${lines.length} responses`);
    return lines;
  }

  // Load master dataset
  const cases = JSON.parse(fs.readFileSync(path.join(OUTPUT, 'compiled_cases.json'), 'utf-8'));
  let nextId = cases.length;
  const startCount = cases.length;

  // ═══════════════════════════════════
  // 1. SCT Factory (500)
  // ═══════════════════════════════════
  const sctLines = await downloadBatchOutput(manifest.batches.sct_factory, 'SCT Factory');
  let sctOk = 0, sctFail = 0;
  if (sctLines) {
    for (const line of sctLines) {
      try {
        const resp = JSON.parse(line);
        const content = resp.response?.body?.choices?.[0]?.message?.content;
        if (!content) { sctFail++; continue; }
        
        const sct = JSON.parse(content);
        if (!sct.scenario || !sct.hypothesis || !sct.new_information) { sctFail++; continue; }
        
        // Build SCT options from expert panel
        const panel = sct.expert_panel || {};
        const directions = ['-2', '-1', '0', '+1', '+2'];
        const labels = ['Sangat menyingkirkan', 'Menyingkirkan', 'Tidak berpengaruh', 'Mendukung', 'Sangat mendukung'];
        
        const correctDir = String(sct.correct_direction);
        const options = directions.map((dir, idx) => ({
          id: dir,
          text: labels[idx],
          is_correct: dir === correctDir,
          sct_panel_votes: panel[dir] || 0,
        }));
        
        // Validate total votes
        const totalVotes = options.reduce((s, o) => s + o.sct_panel_votes, 0);
        if (totalVotes < 10 || totalVotes > 20) {
          // Normalize to 15
          const scale = 15 / (totalVotes || 1);
          options.forEach(o => o.sct_panel_votes = Math.round(o.sct_panel_votes * scale));
        }
        
        if (!options.some(o => o.is_correct)) {
          // Fallback: mark highest-voted as correct
          const maxOpt = options.reduce((a, b) => a.sct_panel_votes > b.sct_panel_votes ? a : b);
          maxOpt.is_correct = true;
        }

        cases.push({
          _id: nextId++,
          q_type: 'SCT',
          category: guessCategory(sct.category || sct.scenario),
          title: sct.scenario.substring(0, 80) + '...',
          vignette: { narrative: sct.scenario, demographics: {} },
          prompt: `Jika Anda berpikir tentang: "${sct.hypothesis}"\nDan kemudian Anda menemukan: "${sct.new_information}"\nMaka hipotesis ini menjadi:`,
          options,
          rationale: { correct: sct.rationale || '', distractors: {}, pearl: '' },
          meta: {
            source: 'sct-factory-v1',
            examType: 'UKMPPD',
            difficulty: sct.difficulty || 2,
            tags: ['SCT', 'AI-Generated', 'Expert-Panel-Synthetic'],
          },
        });
        sctOk++;
      } catch (e) { sctFail++; }
    }
    console.log(`  ✅ SCT: ${sctOk} ingested, ${sctFail} failed`);
  }

  // ═══════════════════════════════════
  // 2. Asian Med Translations (TW + JP → ID)
  // ═══════════════════════════════════
  const asianLines = await downloadBatchOutput(manifest.batches.translate_asian, 'Asian Med Translations');
  let asianOk = 0, asianFail = 0;
  if (asianLines) {
    for (const line of asianLines) {
      try {
        const resp = JSON.parse(line);
        const customId = resp.custom_id || '';
        const content = resp.response?.body?.choices?.[0]?.message?.content;
        if (!content) { asianFail++; continue; }
        
        const q = JSON.parse(content);
        if (!q.question || !q.options || !q.answer) { asianFail++; continue; }
        
        const opts = Object.entries(q.options);
        if (opts.length < 3) { asianFail++; continue; }
        
        const options = opts.map(([letter, text]) => ({
          id: letter,
          text,
          is_correct: letter === q.answer,
        }));
        
        if (!options.some(o => o.is_correct)) { asianFail++; continue; }
        
        const isTW = customId.startsWith('tw_');
        const isJP = customId.startsWith('jp_');
        
        cases.push({
          _id: nextId++,
          q_type: 'MCQ',
          category: guessCategory(q.category || q.question),
          title: q.question.substring(0, 80) + (q.question.length > 80 ? '...' : ''),
          vignette: { narrative: q.question, demographics: {} },
          prompt: 'Pilih jawaban yang paling tepat.',
          options,
          rationale: { correct: '', distractors: {} },
          meta: {
            source: isTW ? 'tw-medqa' : isJP ? 'igakuqa' : 'asian-medqa',
            examType: 'International',
            difficulty: 2,
            tags: [isTW ? 'Taiwan' : isJP ? 'Japan' : 'Asian', 'Translated-ID'],
          },
        });
        asianOk++;
      } catch (e) { asianFail++; }
    }
    console.log(`  ✅ Asian: ${asianOk} ingested, ${asianFail} failed`);
  }

  // ═══════════════════════════════════
  // 3. Greek MCQA Translations (GR → ID)
  // ═══════════════════════════════════
  const greekBatchId = manifest.batches.translate_greek;
  const greekLines = await downloadBatchOutput(greekBatchId, 'Greek MCQA Translations');
  let greekOk = 0, greekFail = 0;
  if (greekLines) {
    for (const line of greekLines) {
      try {
        const resp = JSON.parse(line);
        const content = resp.response?.body?.choices?.[0]?.message?.content;
        if (!content) { greekFail++; continue; }
        
        const q = JSON.parse(content);
        if (!q.question || !q.options || !q.answer) { greekFail++; continue; }
        
        const opts = Object.entries(q.options);
        if (opts.length < 3) { greekFail++; continue; }
        
        const options = opts.map(([letter, text]) => ({
          id: letter,
          text,
          is_correct: letter === q.answer,
        }));
        
        if (!options.some(o => o.is_correct)) { greekFail++; continue; }
        
        cases.push({
          _id: nextId++,
          q_type: 'MCQ',
          category: guessCategory(q.category || q.question),
          title: q.question.substring(0, 80) + (q.question.length > 80 ? '...' : ''),
          vignette: { narrative: q.question, demographics: {} },
          prompt: 'Pilih jawaban yang paling tepat.',
          options,
          rationale: { correct: '', distractors: {} },
          meta: {
            source: 'greek-mcqa',
            examType: 'International',
            difficulty: 2,
            tags: ['Greek', 'Translated-ID'],
          },
        });
        greekOk++;
      } catch (e) { greekFail++; }
    }
    console.log(`  ✅ Greek: ${greekOk} ingested, ${greekFail} failed`);
  }

  // ═══════════════════════════════════
  // Save
  // ═══════════════════════════════════
  const totalAdded = cases.length - startCount;
  console.log(`\n═══ SUMMARY ═══`);
  console.log(`Added: ${totalAdded} new cases`);
  console.log(`  SCT Factory: ${sctOk}`);
  console.log(`  Asian Med:   ${asianOk}`);
  console.log(`  Greek MCQA:  ${greekOk}`);
  
  // Atomic save master
  const tmp1 = path.join(OUTPUT, 'compiled_cases.json.tmp');
  fs.writeFileSync(tmp1, JSON.stringify(cases), 'utf-8');
  fs.renameSync(tmp1, path.join(OUTPUT, 'compiled_cases.json'));
  
  // Payload optimizer: filter quarantined for frontend
  const frontendCases = cases.filter(c => !c.meta?.quarantined && !c.meta?.quarantine_flag);
  const tmp2 = path.join(__dirname, '..', 'public', 'data', 'compiled_cases.json.tmp');
  fs.writeFileSync(tmp2, JSON.stringify(frontendCases), 'utf-8');
  fs.renameSync(tmp2, path.join(__dirname, '..', 'public', 'data', 'compiled_cases.json'));
  
  console.log(`\n🛡️ Master:   ${cases.length.toLocaleString()} cases`);
  console.log(`🚀 Frontend: ${frontendCases.length.toLocaleString()} clean`);
})();
