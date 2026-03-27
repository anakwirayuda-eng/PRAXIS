import { runOrchestrator, readCompiledCases } from './openclaw.mjs';

/**
 * OpenClaw Worker: T6 (Zero-Cost Data Remediation)
 * 
 * Target: Cases exhibiting leaked HTML tags (<br>, <img>) or structural abnormalities
 * Operation: Locates and strips raw HTML using RegEx to clean up the content. 
 *            No API required. Costs $0.00.
 */

function selectorFn(c) {
  const hasHTML = /<[a-z][\s\S]*>/i;
  // If the vignette narrative or prompt contains HTML tags
  const isContaminated = (c.vignette?.narrative && hasHTML.test(c.vignette.narrative)) || 
                         (c.prompt && hasHTML.test(c.prompt));
  
  const isAlreadyCleaned = c.meta?._openclaw_t6_verified === true;
  return isContaminated && !isAlreadyCleaned;
}

async function clawT6(item) {
  // Sync string replacement - NO API CALLS!
  const stripHtml = (str) => {
    if (!str) return str;
    return str.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
  };

  const newData = {};
  let modified = false;

  if (item.vignette?.narrative) {
    const cleanNarrative = stripHtml(item.vignette.narrative);
    if (cleanNarrative !== item.vignette.narrative) {
      newData.vignette = { ...item.vignette, narrative: cleanNarrative };
      modified = true;
    }
  }

  if (item.prompt) {
    const cleanPrompt = stripHtml(item.prompt);
    if (cleanPrompt !== item.prompt) {
      newData.prompt = cleanPrompt;
      modified = true;
    }
  }

  if (modified) {
    return { 
      success: true, 
      data: { 
        ...newData, 
        meta: { ...item.meta, _openclaw_t6_verified: true, _html_stripped: true }
      } 
    };
  } else {
    // False positive
    return { 
      success: true, 
      data: { meta: { ...item.meta, _openclaw_t6_verified: true } }
    };
  }
}

async function start() {
  const db = await readCompiledCases();
  await runOrchestrator('T6_Zero_Cost_HTML_Purge', db, selectorFn, clawT6, {
    BATCH_SIZE: 1000,
    DELAY_MS: 0,
    MAX_RETRIES: 0
  });
}

start();
