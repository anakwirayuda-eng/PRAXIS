import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { request } from 'node:https';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const ROOT = join(__dirname, '..');
const OUTPUT_ROOT = join(__dirname, 'output', 'readability_ai_packs');
const ENV_FILE = join(ROOT, '.env');
const DEFAULT_PACK_NAME = 'readability-ai-adjudication-wave1';

function parseArgs(argv) {
  const options = {
    packName: DEFAULT_PACK_NAME,
  };

  for (const arg of argv) {
    if (arg.startsWith('--pack-name=')) {
      options.packName = String(arg.slice('--pack-name='.length) || '').trim() || DEFAULT_PACK_NAME;
    }
  }

  return options;
}

function loadEnvValue(key) {
  if (process.env[key]) {
    return process.env[key];
  }
  if (!existsSync(ENV_FILE)) {
    return '';
  }

  const content = readFileSync(ENV_FILE, 'utf8');
  const match = content.match(new RegExp(`^${key}=(.+)$`, 'm'));
  return match?.[1]?.trim() ?? '';
}

function apiGet(path, apiKey) {
  return new Promise((resolve, reject) => {
    const req = request({
      hostname: 'api.openai.com',
      path,
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const body = Buffer.concat(chunks);
        if ((res.statusCode || 500) >= 400) {
          return reject(new Error(`${res.statusCode}: ${body.toString().slice(0, 300)}`));
        }
        resolve(body);
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function writeJsonAtomically(filePath, value) {
  const tempFile = `${filePath}.tmp`;
  writeFileSync(tempFile, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(tempFile, filePath);
}

function ensurePlaceholderResultFiles(resultsDir, manifest, submissions) {
  const openAiFiles = manifest?.files?.openai;
  if (!openAiFiles || typeof openAiFiles !== 'object') {
    return;
  }

  const submittedFiles = new Set(
    (submissions.submissions || [])
      .map((item) => String(item.file || '').split(/[\\/]/).pop())
      .filter(Boolean),
  );

  for (const filePath of Object.values(openAiFiles)) {
    const fileName = String(filePath || '').split(/[\\/]/).pop();
    if (!fileName || submittedFiles.has(fileName)) {
      continue;
    }
    const targetPath = join(resultsDir, fileName);
    if (!existsSync(targetPath)) {
      writeFileSync(targetPath, '', 'utf8');
    }
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const packDir = join(OUTPUT_ROOT, options.packName);
  const manifestFile = join(packDir, 'manifest.json');
  const submissionsFile = join(packDir, 'openai_submissions.json');
  const resultsDir = join(packDir, 'results');

  if (!existsSync(manifestFile)) {
    throw new Error(`Missing manifest file: ${manifestFile}`);
  }
  if (!existsSync(submissionsFile)) {
    throw new Error(`Missing submissions file: ${submissionsFile}`);
  }

  const apiKey = loadEnvValue('OPENAI_API_KEY');
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is missing');
  }

  const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
  const submissions = JSON.parse(readFileSync(submissionsFile, 'utf8'));
  const report = {
    generated_at: new Date().toISOString(),
    pack_name: options.packName,
    downloaded: [],
    pending: [],
    failed: [],
  };

  mkdirSync(resultsDir, { recursive: true });
  ensurePlaceholderResultFiles(resultsDir, manifest, submissions);

  for (const item of submissions.submissions || []) {
    try {
      const batch = JSON.parse((await apiGet(`/v1/batches/${item.batch_id}`, apiKey)).toString());
      item.status = batch.status;
      item.output_file_id = batch.output_file_id ?? null;
      item.error_file_id = batch.error_file_id ?? null;
      item.request_counts = batch.request_counts ?? null;

      if (batch.status !== 'completed' || !batch.output_file_id) {
        report.pending.push({
          playbook: item.playbook,
          batch_id: item.batch_id,
          status: batch.status,
          request_counts: batch.request_counts ?? null,
        });
        continue;
      }

      const output = await apiGet(`/v1/files/${batch.output_file_id}/content`, apiKey);
      const fileName = String(item.file || '').split(/[\\/]/).pop() || `${item.playbook || item.batch_id}.jsonl`;
      const targetPath = join(resultsDir, fileName);
      writeFileSync(targetPath, output);
      report.downloaded.push({
        playbook: item.playbook,
        batch_id: item.batch_id,
        output_file_id: batch.output_file_id,
        bytes: output.length,
        target: targetPath,
      });
    } catch (error) {
      report.failed.push({
        playbook: item.playbook,
        batch_id: item.batch_id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  writeJsonAtomically(submissionsFile, submissions);
  writeJsonAtomically(join(packDir, 'download_report.json'), report);

  console.log('Readability AI pack download complete');
  console.log(`  Pack:        ${options.packName}`);
  console.log(`  Downloaded:  ${report.downloaded.length}`);
  console.log(`  Pending:     ${report.pending.length}`);
  console.log(`  Failed:      ${report.failed.length}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
