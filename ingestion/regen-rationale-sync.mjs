/**
 * PRAXIS — Rationale Regeneration (Post-Antidote Cleanup)
 * Re-generates rationales for 7,904 cases with CORRECT answer anchors
 * Uses GPT-4o-mini Sync API with p-limit concurrency
 * Usage: node ingestion/regen-rationale-sync.mjs
 */
import fs from 'fs';
import path from 'path';

const DB_PATH = path.resolve('public/data/compiled_cases.json');
const SUSPECTS_PATH = path.resolve('ingestion/output/ai_rebellion_suspects.json');
const API_KEY = process.env.OPENAI_API_KEY;
const CONCURRENCY = 15;
const MODEL = 'gpt-4o-mini';

if (!API_KEY) {
  // Try loading from .env
  const envPath = path.resolve('.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf-8');
    const match = envContent.match(/OPENAI_API_KEY=(.+)/);
    if (match) process.env.OPENAI_API_KEY = match[1].trim();
  }
}

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) { console.error('❌ No OPENAI_API_KEY found'); process.exit(1); }

// Simple p-limit implementation
function pLimit(concurrency) {
  let active = 0;
  const queue = [];
  const next = () => { if (queue.length > 0 && active < concurrency) { active++; const { fn, resolve, reject } = queue.shift(); fn().then(resolve, reject).finally(() => { active--; next(); }); } };
  return (fn) => new Promise((resolve, reject) => { queue.push({ fn, resolve, reject }); next(); });
}

async function callOpenAI(question, options, correctOpt) {
  const optionText = options.map(o => `${o.id}. ${o.text}`).join('\n');
  
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.3,
      max_tokens: 400,
      messages: [
        {
          role: 'system',
          content: `You are a strict Board Examiner for medical licensing (USMLE/AIIMS/NEET). Previously, this question had an incorrect answer key that has been corrected. The ONLY absolute correct answer is Option ${correctOpt.id}: "${correctOpt.text}". Do NOT second-guess it. Explain the pathophysiology/clinical reasoning for why this answer is correct, and briefly why each distractor is wrong. Be concise (2-3 paragraphs max). Write in English.`
        },
        {
          role: 'user', 
          content: `Question: ${question}\n\nOptions:\n${optionText}\n\nCorrect Answer: ${correctOpt.id}. ${correctOpt.text}\n\nExplain why ${correctOpt.id} is correct and why others are wrong.`
        }
      ]
    })
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`API ${response.status}: ${err.slice(0, 200)}`);
  }
  
  const data = await response.json();
  return data.choices?.[0]?.message?.content || '';
}

async function main() {
  console.log('🔄 PRAXIS Rationale Regeneration (Sync API)\n');
  
  const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
  
  // Collect all IDs needing regeneration
  const suspectIds = new Set();
  
  // 1. Antidote flagged (needs_rationale_regen)
  db.forEach(c => { if (c.meta?.needs_rationale_regen) suspectIds.add(c._id); });
  console.log(`📋 Antidote needs_regen: ${[...suspectIds].length}`);
  
  // 2. AI Rebellion suspects
  if (fs.existsSync(SUSPECTS_PATH)) {
    const rebellionIds = JSON.parse(fs.readFileSync(SUSPECTS_PATH, 'utf-8'));
    rebellionIds.forEach(id => suspectIds.add(id));
    console.log(`📋 AI Rebellion suspects: ${rebellionIds.length}`);
  }
  
  const targetCases = db.filter(c => suspectIds.has(c._id));
  console.log(`\n🎯 Total targets: ${targetCases.length}`);
  console.log(`💰 Estimated cost: ~$${(targetCases.length * 0.0007).toFixed(2)} (GPT-4o-mini)\n`);
  
  const limit = pLimit(CONCURRENCY);
  let done = 0, errors = 0;
  const startTime = Date.now();
  
  const tasks = targetCases.map(c => limit(async () => {
    try {
      const correctOpt = c.options?.find(o => o.is_correct);
      if (!correctOpt) return;
      
      const question = c.vignette?.narrative || c.prompt || '';
      if (question.length < 10) return;
      
      const rationale = await callOpenAI(question, c.options, correctOpt);
      
      if (rationale && rationale.length > 50) {
        c.rationale = c.rationale || {};
        c.rationale.correct = rationale;
        delete c.meta.needs_rationale_regen;
        c.meta.rationale_regenerated = true;
      }
      
      done++;
      if (done % 100 === 0) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
        const rate = (done / (elapsed / 60)).toFixed(0);
        console.log(`  ✅ ${done}/${targetCases.length} (${rate}/min, ${elapsed}s elapsed, ${errors} errors)`);
      }
    } catch (err) {
      errors++;
      if (errors <= 5) console.log(`  ⚠️ Error on ${c._id}: ${err.message.slice(0, 100)}`);
    }
  }));
  
  await Promise.all(tasks);
  
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n💾 Saving...`);
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 0), 'utf-8');
  
  console.log(`\n✅ REGENERATION COMPLETE in ${elapsed}s`);
  console.log(`   ✅ Success: ${done}`);
  console.log(`   ❌ Errors: ${errors}`);
}

main().catch(err => { console.error('❌ Fatal:', err); process.exit(1); });
