import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const ENV_FILE = path.join(ROOT, '.env');
const OUTPUT_ROOT = path.join(ROOT, 'ingestion', 'output', 'readability_ai_packs');
const DEFAULT_PACK_NAME = 'readability-ai-adjudication-wave1';
const DEFAULT_COMPLETION_WINDOW = '24h';
const PLAYBOOK_ORDER = [
  'answer_key_adjudication',
  'needs_review_adjudication',
  'ambiguity_rewrite',
  'clinical_rewrite',
];

function parseArgs(argv) {
  const options = {
    packName: DEFAULT_PACK_NAME,
    completionWindow: DEFAULT_COMPLETION_WINDOW,
    force: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--pack-name') {
      options.packName = argv[index + 1] || options.packName;
      index += 1;
    } else if (arg.startsWith('--pack-name=')) {
      options.packName = arg.slice('--pack-name='.length) || options.packName;
    } else if (arg === '--completion-window') {
      options.completionWindow = argv[index + 1] || options.completionWindow;
      index += 1;
    } else if (arg.startsWith('--completion-window=')) {
      options.completionWindow = arg.slice('--completion-window='.length) || options.completionWindow;
    } else if (arg === '--force') {
      options.force = true;
    }
  }

  return options;
}

function loadEnvValue(key) {
  if (process.env[key]) return process.env[key];
  if (!fs.existsSync(ENV_FILE)) return '';
  const content = fs.readFileSync(ENV_FILE, 'utf8');
  const match = content.match(new RegExp(`^${key}=(.+)$`, 'm'));
  return match?.[1]?.trim() ?? '';
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function uploadOpenAiBatch(jsonlPath, metadata, apiKey, completionWindow) {
  const formData = new FormData();
  formData.append('purpose', 'batch');
  formData.append(
    'file',
    new Blob([fs.readFileSync(jsonlPath)]),
    path.basename(jsonlPath),
  );

  const uploadResponse = await fetch('https://api.openai.com/v1/files', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: formData,
  });
  const uploadBody = await uploadResponse.json();
  if (!uploadResponse.ok || !uploadBody?.id) {
    throw new Error(`OpenAI file upload failed for ${path.basename(jsonlPath)}: ${JSON.stringify(uploadBody)}`);
  }

  const batchResponse = await fetch('https://api.openai.com/v1/batches', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      input_file_id: uploadBody.id,
      endpoint: '/v1/chat/completions',
      completion_window: completionWindow,
      metadata,
    }),
  });
  const batchBody = await batchResponse.json();
  if (!batchResponse.ok || !batchBody?.id) {
    throw new Error(`OpenAI batch creation failed for ${path.basename(jsonlPath)}: ${JSON.stringify(batchBody)}`);
  }

  return {
    file_id: uploadBody.id,
    batch_id: batchBody.id,
    status: batchBody.status,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const packDir = path.join(OUTPUT_ROOT, options.packName);
  const manifestPath = path.join(packDir, 'manifest.json');
  const submissionsPath = path.join(packDir, 'openai_submissions.json');

  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Missing manifest: ${manifestPath}`);
  }

  if (fs.existsSync(submissionsPath) && !options.force) {
    throw new Error(`Submissions already exist for ${options.packName}; rerun with --force if you really want to replace them.`);
  }

  const apiKey = loadEnvValue('OPENAI_API_KEY');
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not available in environment or .env');
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const submissions = [];

  for (const playbook of PLAYBOOK_ORDER) {
    const itemCount = Number(manifest?.counts?.by_playbook?.[playbook] || 0);
    if (itemCount <= 0) continue;

    const relativeFile = manifest?.files?.openai?.[playbook];
    if (!relativeFile) {
      throw new Error(`Manifest is missing openai file entry for ${playbook}`);
    }

    const jsonlPath = path.join(ROOT, relativeFile);
    if (!fs.existsSync(jsonlPath)) {
      throw new Error(`Missing JSONL file for ${playbook}: ${jsonlPath}`);
    }

    const result = await uploadOpenAiBatch(
      jsonlPath,
      {
        purpose: 'readability-ai-adjudication',
        playbook,
        pack_name: manifest.pack_name,
        source_filter: Array.isArray(manifest.source_filter) && manifest.source_filter.length > 0
          ? manifest.source_filter.join(',')
          : 'all',
      },
      apiKey,
      options.completionWindow,
    );

    submissions.push({
      playbook,
      item_count: itemCount,
      file: relativeFile,
      ...result,
    });
  }

  writeJson(submissionsPath, {
    generated_at: new Date().toISOString(),
    pack_name: manifest.pack_name,
    model: manifest.model,
    completion_window: options.completionWindow,
    submissions,
  });

  console.log('Readability AI pack submission complete');
  console.log(`Pack:        ${packDir}`);
  console.log(`Submissions: ${submissions.length}`);
  console.log(`Output:      ${submissionsPath}`);
  for (const item of submissions) {
    console.log(`  ${item.playbook}: ${item.batch_id} (${item.status})`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
