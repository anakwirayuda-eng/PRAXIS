import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, '..', 'public', 'data', 'compiled_cases.json');
const IGK_PATH = join(__dirname, 'output', 'igakuqa_translated.json');

const db = JSON.parse(readFileSync(DB_PATH, 'utf8'));
const igk = JSON.parse(readFileSync(IGK_PATH, 'utf8'));

// Assign proper _id starting after max existing
const maxId = Math.max(...db.map(c => c._id || 0));
igk.forEach((c, i) => { c._id = maxId + 1 + i; });

db.push(...igk);
console.log(`Wired ${igk.length} IgakuQA cases. Total: ${db.length}`);

writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf8');
console.log('Saved.');
