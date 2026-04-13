import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const ENV_FILE = path.join(ROOT, '.env');
const OUTPUT_ROOT = path.join(ROOT, 'ingestion', 'output', 'category_ai_packs');
const DEFAULT_PACK_NAME = 'medmcqa-category-adjudication-wave1';
const DEFAULT_COMPLETION_WINDOW = '24h';

function parseArgs(argv) {
  const options = {
    packName: DEFAULT_PACK_NAME,
    completionWindow: DEFAULT_COMPLETION_WINDOW,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--pack-name') {
      options.packName = argv[index + 1] || options.packName;
      index += 1;
    } else if (arg === '--completion-window') {
      options.completionWindow = argv[index + 1] || options.completionWindow;
      index += 1;
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

  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Missing manifest: ${manifestPath}`);
  }

  const apiKey = loadEnvValue('OPENAI_API_KEY');
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not available in environment or .env');
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const submissions = [];

  for (const bucket of manifest.buckets || []) {
    if (!bucket?.total_items) continue;
    const jsonlPath = path.join(ROOT, bucket.files.openai);
    const result = await uploadOpenAiBatch(
      jsonlPath,
      {
        purpose: 'category-adjudication',
        playbook: manifest.playbook || 'category_adjudication',
        pack_name: manifest.pack_name,
        bucket_id: bucket.id,
        source: manifest.source || 'unknown',
      },
      apiKey,
      options.completionWindow,
    );
    submissions.push({
      bucket_id: bucket.id,
      bucket_label: bucket.label,
      item_count: bucket.total_items,
      file: bucket.files.openai,
      ...result,
    });
  }

  const outputPath = path.join(packDir, 'openai_submissions.json');
  writeJson(outputPath, {
    generated_at: new Date().toISOString(),
    pack_name: manifest.pack_name,
    model: manifest.model,
    completion_window: options.completionWindow,
    submissions,
  });

  console.log('Category adjudication batch submission complete');
  console.log(`Pack:        ${packDir}`);
  console.log(`Submissions: ${submissions.length}`);
  console.log(`Output:      ${outputPath}`);
  for (const item of submissions) {
    console.log(`  ${item.bucket_id}: ${item.batch_id} (${item.status})`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
