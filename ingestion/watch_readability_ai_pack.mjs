import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const OUTPUT_ROOT = join(__dirname, 'output', 'readability_ai_packs');
const DEFAULT_PACK = 'readability-ai-adjudication-wave1';
const DEFAULT_INTERVAL_SECONDS = 60;

function parseArgs(argv) {
  const options = {
    packName: DEFAULT_PACK,
    intervalSeconds: DEFAULT_INTERVAL_SECONDS,
    rerunAudit: true,
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
    if (arg === '--no-audit') {
      options.rerunAudit = false;
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

function runNodeScript(scriptName, args) {
  execFileSync(process.execPath, [join(__dirname, scriptName), ...args], {
    cwd: join(__dirname, '..'),
    stdio: 'inherit',
  });
}

function runPython(scriptName) {
  execFileSync('python', [join(__dirname, scriptName)], {
    cwd: join(__dirname, '..'),
    stdio: 'inherit',
  });
}

function summarizeSubmission(item) {
  const counts = item.request_counts ?? {};
  return `${item.playbook}: status=${item.status} completed=${counts.completed ?? 0}/${counts.total ?? 0} failed=${counts.failed ?? 0}`;
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
    runNodeScript('download_readability_ai_pack_results.mjs', [`--pack-name=${options.packName}`]);

    const submissions = readJson(submissionsFile);
    const items = Array.isArray(submissions.submissions) ? submissions.submissions : [];
    for (const item of items) {
      console.log(`  ${summarizeSubmission(item)}`);
    }

    const terminalFailure = items.find((item) => ['failed', 'expired', 'cancelled'].includes(item.status));
    if (terminalFailure) {
      throw new Error(`Batch ended in terminal state for ${terminalFailure.playbook}: ${terminalFailure.status}`);
    }

    const allCompleted = items.length > 0 && items.every((item) => item.status === 'completed' && item.output_file_id);
    if (allCompleted) {
      console.log(`[${new Date().toISOString()}] applying ${options.packName}`);
      runNodeScript('apply_readability_ai_pack.mjs', [`--pack-name=${options.packName}`]);
      if (options.rerunAudit) {
        runPython('audit_readability.py');
        runPython('triage_readability_manual_queue.py');
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
