import fs from 'fs';
try {
  const envContent = fs.readFileSync('.env', 'utf8');
  const match = envContent.match(/OPENAI_API_KEY=(.*)/);
  if (match) process.env.OPENAI_API_KEY = match[1].trim();
} catch (e) {}
process.env.TEST_IDS = '4313,707,12';
import('./openclaw_t9.mjs');
