import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const ENV_FILE = path.join(ROOT, '.env');
const OUTPUT_ROOT = path.join(ROOT, 'ingestion', 'output', 'category_ai_packs');
const DEFAULT_MODEL = 'gemini-2.5-flash';

function parseArgs(argv) {
  const options = {
    packName: '',
    model: DEFAULT_MODEL,
    limit: 0,
    delayMs: 750,
    timeoutMs: 90000,
    bucketPattern: '',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--pack-name') {
      options.packName = argv[index + 1] || '';
      index += 1;
    } else if (arg.startsWith('--pack-name=')) {
      options.packName = arg.slice('--pack-name='.length);
    } else if (arg === '--model') {
      options.model = argv[index + 1] || options.model;
      index += 1;
    } else if (arg.startsWith('--model=')) {
      options.model = arg.slice('--model='.length) || options.model;
    } else if (arg === '--limit') {
      options.limit = Number(argv[index + 1] || 0);
      index += 1;
    } else if (arg.startsWith('--limit=')) {
      options.limit = Number(arg.slice('--limit='.length) || 0);
    } else if (arg === '--delay-ms') {
      options.delayMs = Number(argv[index + 1] || options.delayMs);
      index += 1;
    } else if (arg.startsWith('--delay-ms=')) {
      options.delayMs = Number(arg.slice('--delay-ms='.length) || options.delayMs);
    } else if (arg === '--timeout-ms') {
      options.timeoutMs = Number(argv[index + 1] || options.timeoutMs);
      index += 1;
    } else if (arg.startsWith('--timeout-ms=')) {
      options.timeoutMs = Number(arg.slice('--timeout-ms='.length) || options.timeoutMs);
    } else if (arg === '--bucket-pattern') {
      options.bucketPattern = argv[index + 1] || '';
      index += 1;
    } else if (arg.startsWith('--bucket-pattern=')) {
      options.bucketPattern = arg.slice('--bucket-pattern='.length);
    }
  }

  return options;
}

function loadEnvValue(key) {
  if (process.env[key]) return process.env[key];
  if (!existsSync(ENV_FILE)) return '';
  const content = readFileSync(ENV_FILE, 'utf8');
  const match = content.match(new RegExp(`^${key}=(.+)$`, 'm'));
  return match?.[1]?.trim() ?? '';
}

function ensureDir(dir) {
  mkdirSync(dir, { recursive: true });
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function readJsonl(filePath) {
  if (!existsSync(filePath)) return [];
  return readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function writeJson(filePath, value) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function appendJsonl(filePath, row) {
  writeFileSync(filePath, `${JSON.stringify(row)}\n`, { encoding: 'utf8', flag: 'a' });
}

function getReportPath(packDir) {
  return path.join(packDir, 'gemini_run_report.json');
}

function getMessageContent(request, role) {
  const message = request?.body?.messages?.find((item) => item?.role === role);
  if (!message) return '';
  if (typeof message.content === 'string') return message.content;
  if (Array.isArray(message.content)) {
    return message.content
      .map((part) => part?.text ?? part?.content ?? '')
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

function getCompletedCustomIds(resultFile) {
  const ids = new Set();
  for (const row of readJsonl(resultFile)) {
    if (row?.custom_id) ids.add(String(row.custom_id));
  }
  return ids;
}

function buildGeminiBody(request) {
  const system = getMessageContent(request, 'system');
  const user = getMessageContent(request, 'user');
  return {
    systemInstruction: {
      parts: [{ text: system }],
    },
    contents: [
      {
        role: 'user',
        parts: [{ text: user }],
      },
    ],
    generationConfig: {
      temperature: 0,
      responseMimeType: 'application/json',
    },
  };
}

function extractGeminiText(body) {
  const parts = body?.candidates?.[0]?.content?.parts;
  if (Array.isArray(parts)) {
    const text = parts.map((part) => part?.text || '').filter(Boolean).join('\n').trim();
    if (text) return text;
  }
  if (typeof body?.text === 'string') return body.text.trim();
  return '';
}

async function callGemini(request, apiKey, model, timeoutMs, attempt = 1) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildGeminiBody(request)),
      signal: controller.signal,
    });
  } catch (error) {
    if (attempt < 5) {
      await sleep(1500 * attempt * attempt);
      return callGemini(request, apiKey, model, timeoutMs, attempt + 1);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text };
  }

  if (!response.ok) {
    const retryable = [429, 500, 502, 503, 504].includes(response.status);
    if (retryable && attempt < 5) {
      await sleep(1500 * attempt * attempt);
      return callGemini(request, apiKey, model, timeoutMs, attempt + 1);
    }
    throw new Error(`Gemini ${response.status}: ${text.slice(0, 500)}`);
  }

  const content = extractGeminiText(body);
  if (!content) {
    throw new Error(`Gemini returned empty content: ${JSON.stringify(body).slice(0, 500)}`);
  }

  return {
    response: {
      status_code: response.status,
      body: {
        choices: [
          {
            message: {
              content,
            },
          },
        ],
        usage: body?.usageMetadata || null,
        model,
      },
    },
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.packName) {
    throw new Error('Missing --pack-name');
  }

  const apiKey = loadEnvValue('GEMINI_API_KEY');
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not available in environment or .env');
  }

  const packDir = path.join(OUTPUT_ROOT, options.packName);
  const manifestPath = path.join(packDir, 'manifest.json');
  if (!existsSync(manifestPath)) {
    throw new Error(`Missing manifest: ${manifestPath}`);
  }

  const bucketRegex = options.bucketPattern ? new RegExp(options.bucketPattern) : null;
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const resultsDir = path.join(packDir, 'results');
  ensureDir(resultsDir);

  const report = {
    generated_at: new Date().toISOString(),
    pack_name: options.packName,
    model: options.model,
    limit: options.limit,
    delay_ms: options.delayMs,
    timeout_ms: options.timeoutMs,
    attempted: 0,
    processed: 0,
    skipped_existing: 0,
    quota_exhausted: false,
    failed: [],
    by_bucket: {},
  };
  const reportPath = getReportPath(packDir);

  outer:
  for (const bucket of manifest.buckets || []) {
    if (!bucket?.total_items || !bucket?.files?.openai) continue;
    if (bucketRegex && !bucketRegex.test(bucket.id)) continue;
    if (options.limit > 0 && report.processed >= options.limit) break;

    const requestPath = path.join(ROOT, bucket.files.openai);
    const resultPath = path.join(resultsDir, path.basename(bucket.files.openai));
    const completedIds = getCompletedCustomIds(resultPath);
    const requests = readJsonl(requestPath);

    for (const request of requests) {
      if (options.limit > 0 && report.attempted >= options.limit) break outer;
      if (completedIds.has(String(request.custom_id))) {
        report.skipped_existing += 1;
        continue;
      }

      report.attempted += 1;
      try {
        const response = await callGemini(request, apiKey, options.model, options.timeoutMs);
        appendJsonl(resultPath, {
          custom_id: request.custom_id,
          ...response,
        });
        report.processed += 1;
        report.by_bucket[bucket.id] = (report.by_bucket[bucket.id] || 0) + 1;
        writeJson(reportPath, report);
        console.log(`[gemini] ok ${report.processed}: ${request.custom_id}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        report.failed.push({
          custom_id: request.custom_id,
          bucket_id: bucket.id,
          error: message,
        });
        if (/RESOURCE_EXHAUSTED|Quota exceeded|generate_content_free_tier_requests/i.test(message)) {
          report.quota_exhausted = true;
        }
        writeJson(reportPath, report);
        console.log(`[gemini] failed ${report.failed.length}: ${request.custom_id}`);
        if (report.quota_exhausted) break outer;
      }

      if (options.delayMs > 0) {
        await sleep(options.delayMs);
      }
    }
  }

  writeJson(reportPath, report);

  console.log('Gemini category adjudication run complete');
  console.log(`  Pack:      ${options.packName}`);
  console.log(`  Model:     ${options.model}`);
  console.log(`  Processed: ${report.processed}`);
  console.log(`  Existing:  ${report.skipped_existing}`);
  console.log(`  Failed:    ${report.failed.length}`);
  console.log(`  Report:    ${reportPath}`);
  if (report.failed.length) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
