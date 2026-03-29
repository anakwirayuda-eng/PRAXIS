import { runOrchestrator } from './openclaw.mjs';
import { openCaseStorage } from './case-storage.mjs';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

function selectorFn(item) {
  if (item.meta?._openclaw_t10_verified === true) return false;

  const isTargetSource =
    item.meta?.source?.toLowerCase() === 'medmcqa' ||
    /^medmcqa_[a-z0-9-]+$/i.test(String(item.hash_id));

  if (isTargetSource && item.meta?.clinical_consensus !== 'AI_AGREES_WITH_BASELINE') {
    return false;
  }

  const rationale = item.rationale?.correct || '';
  const trimmed = rationale.trim();
  const isTooShort = trimmed.length < 80;
  const isAnswerEcho =
    /^ans(?:wer)?[\s:.]|^ans\s*['"]?[a-e]['"]?\s*i\.e\.|^s\s*['"]?[a-e]['"]?\s*i\.e\./i.test(trimmed);

  return isTooShort || isAnswerEcho;
}

async function clawT10(item) {
  if (!OPENAI_API_KEY) {
    return { success: false, error: 'OPENAI_API_KEY missing from environment (.env).' };
  }

  const optionsText = item.options.map((option) => `[${option.id}] ${option.text}`).join('\n');
  const correctOption = item.options.find((option) => option.is_correct);
  const currentKey = correctOption?.id || 'UNKNOWN';

  const prompt = `You are a medical board professor writing high-yield, comprehensive educational rationales.
  
Vignette Context: ${item.vignette?.narrative || 'None'}
Question Prompt: ${item.prompt}

Options:
${optionsText}

The Correct Answer is: [${currentKey}]

Your task is to write a single, rigorous educational paragraph (100-200 words) explaining EXACTLY WHY option [${currentKey}] is correct, and briefly why the distractors are incorrect or less appropriate.
- Do not repeat the vignette.
- Do not hallucinate.
- Focus on the clinical mechanism, guideline, or pathognomonic finding.
- Do not wrap in markdown or include "The correct answer is...". Just give the raw explanation.

Return EXACTLY this JSON format:
{"rationale": "Your educational paragraph here."}`;

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,
        response_format: { type: 'json_object' },
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        const retryAfter = parseInt(response.headers.get('retry-after') || '0', 10) || 0;
        return { success: false, error: 'OpenAI API HTTP Error: 429', retryAfter };
      }
      throw new Error(`OpenAI API HTTP Error: ${response.status}`);
    }

    const data = await response.json();
    const parsed = JSON.parse(data.choices?.[0]?.message?.content || '{}');
    if (!parsed.rationale || parsed.rationale.length <= 20) {
      throw new Error('API returned empty or invalid rationale.');
    }

    return {
      success: true,
      data: {
        rationale: { correct: parsed.rationale },
        meta: { ...item.meta, _openclaw_t10_verified: true, _rationale_regenerated: true },
      },
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function start() {
  const storage = await openCaseStorage();
  console.log(`T10 storage backend: ${storage.label}`);

  try {
    await runOrchestrator('T10_Missing_Rationales', storage.dataset, selectorFn, clawT10, {
      BATCH_SIZE: 10,
      DELAY_MS: 5000,
      saveFn: storage.saveFn,
    });
  } finally {
    await storage.close();
  }
}

start();
