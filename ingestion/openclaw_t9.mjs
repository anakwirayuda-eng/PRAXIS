
import { runOrchestrator, readCompiledCases } from './openclaw.mjs';

/**
 * OpenClaw Worker: T9 (MedMCQA Answer-Key Mismatches)
 * 
 * Target: All cases with provenance == "MedMCQA".
 * Operation: Passes the vignette, prompt, and options to Gemini 2.0 Flash to verify 
 *            if the current `is_correct` option is actually medically accurate.
 *            If Gemini confidently marks it as a mismatch, the key is updated.
 */

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

function selectorFn(c) {
  // T9 looks for MedMCQA cases that haven't been verified by OpenClaw yet
  const isMedMCQA = Array.isArray(c.meta?.provenance) && c.meta.provenance.some(p => p.includes('MedMCQA'));
  const isAlreadyVerified = c.meta?._openclaw_t9_verified === true;
  return isMedMCQA && !isAlreadyVerified;
}

async function clawT9(item) {
  if (!OPENAI_API_KEY) {
     return { success: false, error: 'OPENAI_API_KEY missing from environment.' };
  }

  const optionsText = item.options.map(o => `[${o.id}] ${o.text}`).join('\n');
  const currentKey = item.options.find(o => o.is_correct)?.id || 'UNKNOWN';

  const prompt = `You are a medical board examiner reviewing a multiple choice question.
  
Vignette Context: ${item.vignette?.narrative || 'None'}
Question Prompt: ${item.prompt}

Options:
${optionsText}

The current active Answer Key is: [${currentKey}]. 
Verify if option [${currentKey}] is factually correct.
If [${currentKey}] is the BEST answer, return: {"status": "correct", "correct_id": "${currentKey}"}
If [${currentKey}] is WRONG, and another option is demonstrably the TRUE correct answer, return: {"status": "mismatch", "correct_id": "THE_TRUE_OPTION_ID"}

Respond ONLY with valid JSON.`;

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.1,
        response_format: { type: "json_object" }
      })
    });

    if (!res.ok) throw new Error(`OpenAI API HTTP Error: ${res.status}`);
    
    const data = await res.json();
    const textOutput = data.choices?.[0]?.message?.content || '{}';
    
    const parsed = JSON.parse(textOutput);
    
    if (parsed.status === 'mismatch' && parsed.correct_id && parsed.correct_id !== currentKey) {
       // Apply the mismatch fix: Flip the boolean keys
       const patchedOptions = item.options.map(o => ({
         ...o,
         is_correct: o.id === parsed.correct_id
       }));

       return { 
         success: true, 
         data: { 
           options: patchedOptions,
           meta: { ...item.meta, _openclaw_t9_verified: true, _key_mismatch_fixed: true }
         } 
       };
    } else {
       // Correct. No patch needed, just mark as verified.
       return { 
         success: true, 
         data: { 
           meta: { ...item.meta, _openclaw_t9_verified: true }
         } 
       };
    }

  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function start() {
  const db = await readCompiledCases();
  await runOrchestrator('T9_MedMCQA_Mismatch_Heal', db, selectorFn, clawT9);
}

start();
