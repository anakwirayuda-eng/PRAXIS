import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const OUTPUT_ROOT = join(__dirname, 'output', 'category_ai_packs');
const DEFAULT_PACK = 'medmcqa-category-adjudication-wave1';
const DEFAULT_INTERVAL_SECONDS = 60;

function parseArgs(argv) {
  const options = {
    packName: DEFAULT_PACK,
    intervalSeconds: DEFAULT_INTERVAL_SECONDS,
    rerunCategoryAudit: false,
    rerunIntegrityCheck: true,
  };

  for (const arg of argv) {
    if (arg.startsWith('--pack-name=')) {
      options.packName = String(arg.slice('--pack-name='.length) || '').trim() || DEFAULT_PACK;
      continue;
    }
    if (arg.startsWith('--interval-seconds=')) {
      const parsed = Number.parseInt(arg.slice('--interval-seconds='.length), 10);
      options.intervalSeconds = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_INTERVAL_SECONDS;
      continue;
    }
    if (arg === '--no-category-audit') {
      options.rerunCategoryAudit = false;
      continue;
    }
    if (arg === '--category-audit') {
      options.rerunCategoryAudit = true;
      continue;
    }
    if (arg === '--no-integrity-check') {
      options.rerunIntegrityCheck = false;
    }
  }

  return options;
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runNodeScript(scriptName, args = []) {
  execFileSync(process.execPath, [join(__dirname, scriptName), ...args], {
    cwd: join(__dirname, '..'),
    stdio: 'inherit',
  });
}

function runOptionalNodeScript(scriptName, args = []) {
  try {
    runNodeScript(scriptName, args);
    return true;
  } catch (error) {
    console.warn(`[warn] optional step failed: ${scriptName}`);
    console.warn(error instanceof Error ? error.message : String(error));
    return false;
  }
}

function summarizeSubmission(item) {
  const counts = item.request_counts ?? {};
  return `${item.bucket_id}: status=${item.status} completed=${counts.completed ?? 0}/${counts.total ?? 0} failed=${counts.failed ?? 0}`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const packDir = join(OUTPUT_ROOT, options.packName);
  const submissionsFile = join(packDir, 'openai_submissions.json');

  if (!existsSync(submissionsFile)) {
    throw new Error(`Missing submissions file: ${submissionsFile}`);
  }

  while (true) {
    console.log(`[${new Date().toISOString()}] polling ${options.packName}`);
    runNodeScript('download-category-adjudication-pack-results.mjs', [`--pack-name=${options.packName}`]);

    const submissions = readJson(submissionsFile);
    const items = Array.isArray(submissions.submissions) ? submissions.submissions : [];
    for (const item of items) {
      console.log(`  ${summarizeSubmission(item)}`);
    }

    const terminalFailure = items.find((item) => ['failed', 'expired', 'cancelled'].includes(item.status));
    if (terminalFailure) {
      throw new Error(`Batch ended in terminal state for ${terminalFailure.bucket_id}: ${terminalFailure.status}`);
    }

    const allCompleted = items.length > 0 && items.every((item) => item.status === 'completed' && item.output_file_id);
    if (allCompleted) {
      console.log(`[${new Date().toISOString()}] applying ${options.packName}`);
      runNodeScript('apply-category-adjudication-pack.mjs', [`--pack-name=${options.packName}`]);
      if (options.rerunCategoryAudit) {
        runOptionalNodeScript('apply-category-resolution-sqlite.mjs');
      }
      if (options.rerunIntegrityCheck) {
        runNodeScript('verify-casebank-sqlite.mjs');
      }
      console.log(`[${new Date().toISOString()}] completed apply for ${options.packName}`);
      return;
    }

    await sleep(options.intervalSeconds * 1000);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
