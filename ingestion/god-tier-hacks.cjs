/**
 * GEMINI GOD-TIER HACKS — Unified Batch Launcher
 * 
 * Hack 1: FASE 2 retry with o4-mini + Classic JSON Mode (33K MedMCQA)
 * Hack 2: Indonesian Oracle — UKMPPD answer keys + explanations via gpt-5.4
 * Hack 5: Nano-Nuke sweep — contradiction detection on 9K GPT-gen explanations
 *
 * Usage: node ingestion/god-tier-hacks.cjs
 */
const fs = require('fs');
const path = require('path');
const envFile = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf-8');
const API_KEY = envFile.match(/OPENAI_API_KEY=(.+)/)?.[1]?.trim();
const COMPILED = path.join(__dirname, 'output', 'compiled_cases.json');
const OUTPUT_DIR = path.join(__dirname, 'output');

console.log('🔥 GEMINI GOD-TIER HACKS — Batch Launcher\n');

const cases = JSON.parse(fs.readFileSync(COMPILED, 'utf-8'));
console.log(`📦 Total cases: ${cases.length.toLocaleString()}\n`);

// ═══════════════════════════════════════════════════════════
// HACK 1: FASE 2 MedMCQA Audit (o4-mini + Classic JSON)
// ═══════════════════════════════════════════════════════════
function generateHack1() {
  const medmcqa = cases.filter(c => 
    c.meta?.source === 'medmcqa' && 
    c.options?.length >= 2 &&
    c.vignette?.narrative?.length > 10
  );
  console.log(`📋 HACK 1: ${medmcqa.length} MedMCQA cases for audit`);

  const lines = medmcqa.map(c => {
    const optStr = c.options.map(o => `${o.id}. ${o.text}${o.is_correct ? ' ✓' : ''}`).join('\n');
    return JSON.stringify({
      custom_id: `fase2_${c._id}`,
      method: 'POST',
      url: '/v1/chat/completions',
      body: {
        model: 'o4-mini',
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: 'You are a pragmatic ER Doctor verifying medical exam questions. Output ONLY valid JSON: {"reasoning": "1 sentence CoT", "severity": "FATAL"|"MINOR"|"NONE", "correct_answer": "A-E letter", "quarantine_flag": true|false}. Check if the marked Answer Key (✓) would cause a FATAL MEDICAL ERROR if a student memorized it as truth. FATAL = wrong answer that could kill a patient. MINOR = debatable but not dangerous. NONE = answer is correct.'
          },
          {
            role: 'user',
            content: `QUESTION: ${c.vignette.narrative}\n\nOPTIONS:\n${optStr}\n\nIs the marked answer (✓) correct? Would memorizing this answer cause medical harm?`
          }
        ]
      }
    });
  });

  // Split into 8K chunks
  const CHUNK_SIZE = 8000;
  const chunks = [];
  for (let i = 0; i < lines.length; i += CHUNK_SIZE) {
    chunks.push(lines.slice(i, i + CHUNK_SIZE));
  }

  const chunkFiles = [];
  for (let i = 0; i < chunks.length; i++) {
    const file = path.join(OUTPUT_DIR, `hack1_fase2_chunk${i}.jsonl`);
    fs.writeFileSync(file, chunks[i].join('\n'), 'utf-8');
    chunkFiles.push(file);
    console.log(`  Chunk ${i}: ${chunks[i].length} prompts → ${file}`);
  }
  return chunkFiles;
}

// ═══════════════════════════════════════════════════════════
// HACK 2: UKMPPD Answer Keys + Explanations (gpt-5.4)
// ═══════════════════════════════════════════════════════════
function generateHack2() {
  const ukmppd = cases.filter(c =>
    c.meta?.examType === 'UKMPPD' &&
    c.q_type === 'MCQ' &&
    !c.meta?.hasVerifiedAnswer &&
    c.options?.length >= 2 &&
    c.vignette?.narrative?.length > 20
  );
  console.log(`\n👑 HACK 2: ${ukmppd.length} UKMPPD cases for answer key + explanation`);

  const lines = ukmppd.map(c => {
    const optStr = c.options.map(o => `${o.id}. ${o.text}`).join('\n');
    return JSON.stringify({
      custom_id: `ukmppd_oracle_${c._id}`,
      method: 'POST',
      url: '/v1/chat/completions',
      body: {
        model: 'gpt-5.4',
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: 'Kamu adalah Dosen Penguji UKMPPD Indonesia yang berpengalaman 20 tahun. Baca VIGNETTE dan OPSI soal ini. Tentukan SATU Kunci Jawaban yang paling tepat berdasarkan:\n1. Panduan Praktik Klinis (PPK) Kemenkes RI\n2. Pedoman IDI terbaru\n3. Buku Ajar Ilmu Penyakit Dalam (IPD) / Buku Ajar FK UI\n\nABAIKAN pedoman USMLE/Harrison jika bertentangan dengan PPK Indonesia.\n\nOutput JSON: {"correct_answer": "A-E", "confidence": 1-5, "explanation": "2 paragraf rasionalisasi klinis dalam Bahasa Indonesia. Jelaskan mengapa jawaban benar dan mengapa opsi lain salah.", "category": "nama spesialisasi medis (Bahasa Inggris)"}'
          },
          {
            role: 'user',
            content: `SOAL UKMPPD:\n${c.vignette.narrative}\n\nOPSI:\n${optStr}`
          }
        ]
      }
    });
  });

  const file = path.join(OUTPUT_DIR, 'hack2_ukmppd_oracle.jsonl');
  fs.writeFileSync(file, lines.join('\n'), 'utf-8');
  console.log(`  ${lines.length} prompts → ${file}`);
  return file;
}

// ═══════════════════════════════════════════════════════════
// HACK 5: Nano-Nuke Sweep (gpt-5-nano contradiction check)
// ═══════════════════════════════════════════════════════════
function generateHack5() {
  const gptExplanations = cases.filter(c =>
    (c.meta?.source === 'headqa' || c.meta?.source?.startsWith('mmlu')) &&
    c.rationale?.correct?.length > 20 &&
    c.options?.length >= 2
  );
  console.log(`\n🧹 HACK 5: ${gptExplanations.length} GPT-generated explanations for contradiction check`);

  const lines = gptExplanations.map(c => {
    const correctOpt = c.options.find(o => o.is_correct);
    const optStr = c.options.map(o => `${o.id}. ${o.text}${o.is_correct ? ' ✓' : ''}`).join('\n');
    return JSON.stringify({
      custom_id: `nanonuke_${c._id}`,
      method: 'POST',
      url: '/v1/chat/completions',
      body: {
        model: 'gpt-5-nano',
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: 'You verify medical explanations. Output JSON: {"verdict": "AGREE"|"CONTRADICT"|"UNSURE", "reason": "1 sentence"}. CONTRADICT = the explanation contradicts the marked answer or contains a dangerous medical error.'
          },
          {
            role: 'user',
            content: `QUESTION: ${c.vignette?.narrative || c.title}\nCORRECT ANSWER: ${correctOpt?.id}. ${correctOpt?.text}\nEXPLANATION: ${c.rationale.correct.substring(0, 500)}\n\nDoes the explanation AGREE with or CONTRADICT the correct answer?`
          }
        ]
      }
    });
  });

  const file = path.join(OUTPUT_DIR, 'hack5_nanonuke.jsonl');
  fs.writeFileSync(file, lines.join('\n'), 'utf-8');
  console.log(`  ${lines.length} prompts → ${file}`);
  return file;
}

// ═══════════════════════════════════════════════════════════
// BATCH SUBMISSION
// ═══════════════════════════════════════════════════════════
async function uploadAndSubmit(filePath, label) {
  console.log(`\n📤 Uploading ${label}...`);
  
  // Upload file
  const formData = new FormData();
  formData.append('file', new Blob([fs.readFileSync(filePath)]), path.basename(filePath));
  formData.append('purpose', 'batch');

  const uploadRes = await fetch('https://api.openai.com/v1/files', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${API_KEY}` },
    body: formData,
  });
  
  if (!uploadRes.ok) {
    const err = await uploadRes.text();
    console.log(`  ❌ Upload failed: ${err.substring(0, 200)}`);
    return null;
  }
  
  const uploadData = await uploadRes.json();
  console.log(`  File ID: ${uploadData.id}`);

  // Create batch
  const batchRes = await fetch('https://api.openai.com/v1/batches', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      input_file_id: uploadData.id,
      endpoint: '/v1/chat/completions',
      completion_window: '24h',
    }),
  });

  if (!batchRes.ok) {
    const err = await batchRes.text();
    console.log(`  ❌ Batch create failed: ${err.substring(0, 200)}`);
    return null;
  }

  const batchData = await batchRes.json();
  console.log(`  ✅ Batch: ${batchData.id} (status: ${batchData.status})`);
  return batchData.id;
}

// ═══════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════
(async () => {
  // Generate all JSONL files
  const hack1Files = generateHack1();
  const hack2File = generateHack2();
  const hack5File = generateHack5();

  console.log('\n════════════════════════════════════════');
  console.log(' SUBMITTING BATCHES');
  console.log('════════════════════════════════════════\n');

  const batchIds = {};

  // Submit Hack 2 first (UKMPPD - small, high value)
  batchIds.hack2 = await uploadAndSubmit(hack2File, 'HACK 2: UKMPPD Oracle');

  // Submit Hack 5 (Nano-Nuke - medium size, cheap)
  batchIds.hack5 = await uploadAndSubmit(hack5File, 'HACK 5: Nano-Nuke');

  // Submit Hack 1 chunk 0 (FASE 2 - start with first chunk)
  if (hack1Files.length > 0) {
    batchIds.hack1_chunk0 = await uploadAndSubmit(hack1Files[0], 'HACK 1: FASE 2 Chunk 0');
  }

  // Save batch IDs
  const manifest = {
    timestamp: new Date().toISOString(),
    batches: batchIds,
    hack1_remaining_chunks: hack1Files.slice(1).map(f => path.basename(f)),
  };
  fs.writeFileSync(path.join(OUTPUT_DIR, 'god_tier_batches.json'), JSON.stringify(manifest, null, 2));

  console.log('\n════════════════════════════════════════');
  console.log(' BATCH MANIFEST');
  console.log('════════════════════════════════════════');
  console.log(JSON.stringify(manifest, null, 2));
  console.log('\n✅ All batches submitted! Monitor with check_batches.cjs');
})();
