import fs from 'fs';

import { runOrchestrator } from './openclaw.mjs';
import { openCaseStorage } from './case-storage.mjs';

try {
  const envContent = fs.readFileSync('.env', 'utf8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx > 0) {
      const key = trimmed.slice(0, eqIdx).trim();
      const value = trimmed.slice(eqIdx + 1).trim();
      if (!process.env[key]) process.env[key] = value;
    }
  }
} catch {}

const args = process.argv.slice(2);
const getNumericArg = (name, fallback) => {
  const found = args.find((arg) => arg.startsWith(`--${name}=`));
  return found ? Number(found.split('=')[1]) : fallback;
};

const MAX_TARGETS = getNumericArg('max', 25);
const START_AFTER_ID = getNumericArg('after', 0);
const BATCH_SIZE = getNumericArg('batch-size', 5);
const DELAY_MS = getNumericArg('delay-ms', 2000);
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

if (!OPENAI_API_KEY) {
  console.error('OPENAI_API_KEY not found in .env or environment. Aborting.');
  process.exit(1);
}

function normalizeComparable(str) {
  if (!str) return '';
  return String(str)
    .replace(/<[^>]*>?/gm, '')
    .replace(/[.,/#!$%^&*;:{}=\-_`~()]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

async function clawT9v2(item) {
  let optionsText = '';
  const indexMap = {};
  item.options.forEach((option, index) => {
    const maskedIndex = index + 1;
    indexMap[maskedIndex] = option.id;
    optionsText += `[${maskedIndex}] ${option.text}\n`;
  });

  const prompt = `You are a ruthless Medical Board Examiner. You will be given a medical vignette and an array of options. DO NOT use external formatting. Output ONLY a valid JSON object with the exact text of the single most clinically accurate option.

Vignette Context: ${item.vignette?.narrative || 'None'}
Question Prompt: ${item.prompt}

Options:
${optionsText}

Choose the single most clinically accurate option. Return ONLY JSON in this format: { "correct_index": <int_id>, "reasoning": "1 sentence why" }`;

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
        temperature: 0.1,
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

    if (!parsed.correct_index || !indexMap[parsed.correct_index]) {
      return { success: false, error: 'AI failed to return a valid correct_index' };
    }

    const aiSuggestedId = indexMap[parsed.correct_index];
    const aiSuggestedOption = item.options.find((option) => option.id === aiSuggestedId);
    if (!aiSuggestedOption) {
      return { success: false, error: 'AI index mapped to missing option' };
    }

    const aiTruthText = normalizeComparable(aiSuggestedOption.text);
    const dbCorrectOption = item.options.find((option) => option.is_correct);
    const baselineTruthText = dbCorrectOption ? normalizeComparable(dbCorrectOption.text) : '';

    if (aiTruthText === baselineTruthText) {
      return {
        success: true,
        data: {
          meta: {
            ...item.meta,
            _openclaw_t9_v2: true,
            clinical_consensus: 'AI_AGREES_WITH_BASELINE',
          },
        },
      };
    }

    return {
      success: true,
      data: {
        meta: {
          ...item.meta,
          _openclaw_t9_v2: true,
          status: 'QUARANTINED_AI_CONFLICT',
          ai_suggested_answer: aiSuggestedOption.text,
          ai_reasoning: parsed.reasoning,
        },
      },
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

console.log('\nT9 CANARY MODE');
console.log(`   MAX_TARGETS: ${MAX_TARGETS}`);
console.log(`   START_AFTER_ID: ${START_AFTER_ID}`);
console.log(`   BATCH_SIZE: ${BATCH_SIZE}`);
console.log(`   DELAY_MS: ${DELAY_MS}`);
console.log('   Quarantine: EXCLUDED');

const storage = await openCaseStorage();
console.log(`   Storage: ${storage.label}\n`);

let selectedCount = 0;
function canarySelectorFn(item) {
  if (selectedCount >= MAX_TARGETS) return false;
  const isMedMcqa = item.meta?.source === 'medmcqa';
  const isNotQuarantined = !item.meta?.status?.startsWith('QUARANTINED');
  const isPending = item.meta?._openclaw_t9_v2 !== true;
  const isAfterCursor = item._id > START_AFTER_ID;

  if (isMedMcqa && isNotQuarantined && isPending && isAfterCursor) {
    selectedCount++;
    return true;
  }
  return false;
}

try {
  const dataset = storage.dataset;
  const result = await runOrchestrator(
    `T9_Canary_max${MAX_TARGETS}_after${START_AFTER_ID}`,
    dataset,
    canarySelectorFn,
    clawT9v2,
    { BATCH_SIZE, DELAY_MS, saveFn: storage.saveFn },
  );

  const aiAgrees = dataset.filter(
    (item) => item.meta?._openclaw_t9_v2 && item.meta?.clinical_consensus === 'AI_AGREES_WITH_BASELINE',
  ).length;
  const aiConflict = dataset.filter((item) => item.meta?.status === 'QUARANTINED_AI_CONFLICT').length;
  const t9Total = dataset.filter((item) => item.meta?._openclaw_t9_v2).length;
  const remainingPending = dataset.filter(
    (item) =>
      item.meta?.source === 'medmcqa' &&
      !item.meta?.status?.startsWith('QUARANTINED') &&
      item.meta?._openclaw_t9_v2 !== true,
  ).length;

  console.log(`\n${'='.repeat(50)}`);
  console.log('T9 CANARY REPORT');
  console.log(`${'='.repeat(50)}`);
  console.log(`   This run:   ${result.successCount} processed | ${result.failCount} failed`);
  console.log(`   Cumulative: ${t9Total} T9-done | ${aiAgrees} AI_AGREES | ${aiConflict} AI_CONFLICT`);
  console.log(`   Remaining:  ${remainingPending} pending`);
  console.log(`${'='.repeat(50)}\n`);
} finally {
  await storage.close();
}
