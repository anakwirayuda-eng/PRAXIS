
import { runOrchestrator, readCompiledCases } from './openclaw.mjs';

/**
 * OpenClaw Worker: T10 (Missing Rationales)
 * 
 * Target: Cases that do not possess a `rationale.correct` or where it's too short.
 * Operation: Passes the vignette, prompt, and correct option to Gemini 2.0 Flash 
 *            to author a comprehensive, educational medical rationale.
 */

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

function selectorFn(c) {
  // Target cases missing a rationale
  const hasValidRationale = c.rationale?.correct && c.rationale.correct.trim().length > 15;
  const isAlreadyGenerated = c.meta?._openclaw_t10_verified === true;
  return !hasValidRationale && !isAlreadyGenerated;
}

async function clawT10(item) {
  if (!OPENAI_API_KEY) {
     return { success: false, error: 'OPENAI_API_KEY missing from environment (.env).' };
  }

  const optionsText = item.options.map(o => `[${o.id}] ${o.text}`).join('\n');
  const correctOption = item.options.find(o => o.is_correct);
  const currentKey = correctOption?.id || 'UNKNOWN';
  const correctText = correctOption?.text || 'UNKNOWN';

  const prompt = `You are a medical board professor writing clear, educational rationales.
  
Vignette Context: ${item.vignette?.narrative || 'None'}
Question Prompt: ${item.prompt}
Options:
${optionsText}

The Correct Answer is: [${currentKey}]

Your task is to write a concise, educational rationale explaining WHY this answer is correct. 
Do not hallucinate. Do not wrap in markdown. Return EXACTLY this JSON format:
{"rationale": "Your educational paragraph here."}`;

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
        temperature: 0.2,
        response_format: { type: "json_object" }
      })
    });

    if (!res.ok) throw new Error(`OpenAI API HTTP Error: ${res.status}`);
    
    const data = await res.json();
    const textOutput = data.choices?.[0]?.message?.content || '{}';
    
    const parsed = JSON.parse(textOutput);
    
    if (parsed.rationale && parsed.rationale.length > 20) {
       return { 
         success: true, 
         data: { 
           rationale: { correct: parsed.rationale },
           meta: { ...item.meta, _openclaw_t10_verified: true, _rationale_regenerated: true }
         } 
       };
    } else {
       throw new Error('API returned empty or invalid rationale.');
    }

  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function start() {
  const db = await readCompiledCases();
  await runOrchestrator('T10_Missing_Rationales', db, selectorFn, clawT10);
}

start();
