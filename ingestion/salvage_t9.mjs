import fs from 'fs';
import { execSync } from 'child_process';
import path from 'path';

import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CORRUPTED_FILE = path.join(__dirname, '..', 'public', 'data', 'compiled_cases.corrupted.json');
const TARGET_FILE = path.join(__dirname, '..', 'public', 'data', 'compiled_cases.json');

console.log('1. Membaca file korup (ratusan MB ke memori)...');
let brokenJSON = fs.readFileSync(CORRUPTED_FILE, 'utf-8');

// The file truncates mid-string or mid-property. 
// Let's find the last clean object boundary. Since we use JSON.stringify(..., null, 2), 
// the boundary between array elements is "  },\n  {"
const lastDelimiter = brokenJSON.lastIndexOf('  },\n  {');
if (lastDelimiter === -1) {
    console.error('Fatal: Tidak dapat menemukan batas objek { pada JSON terpotong.');
    process.exit(1);
}

// Slice until the end of the last complete object's "  }" (excluding the comma), and close the array.
brokenJSON = brokenJSON.substring(0, lastDelimiter + 3) + '\n]';

console.log('2. Memanggil JSON Parser pada raw string yang diselamatkan...');
let salvagedArray;
try {
    salvagedArray = JSON.parse(brokenJSON);
} catch (e) {
    console.error('JSON Parse gagal pada salvage.', e.message);
    process.exit(1);
}

// Filter the ones that were verified
const t9Healed = salvagedArray.filter(c => c.meta?._openclaw_t9_verified === true);
console.log(`> Ditemukan ${t9Healed.length} kasus sukses (ter-heal) dari API semalaman!`);

// Map for quick lookup
const healedMap = new Map();
for (const caseObj of t9Healed) {
    if (caseObj._id) healedMap.set(caseObj._id, caseObj);
}

console.log('3. Merestore Git Checkout untuk `compiled_cases.json` 100% utuh...');
try {
    execSync('git checkout public/data/compiled_cases.json', { cwd: path.join(__dirname, '..') });
} catch (e) {
    console.error('Gagal restore git!', e.message);
    process.exit(1);
}
console.log('> Git Restore tereksekusi.');

console.log('4. Me-load database aseli yang utuh...');
const pureDB = JSON.parse(fs.readFileSync(TARGET_FILE, 'utf-8'));

console.log('5. Menyuntik (Injecting) data hasil AI T9 ke dalam database suci...');
let injectedCount = 0;
for (let i = 0; i < pureDB.length; i++) {
    const originalItem = pureDB[i];
    if (healedMap.has(originalItem._id)) {
        // Tumpukkan / Replace keseluruhan
        pureDB[i] = healedMap.get(originalItem._id);
        injectedCount++;
    }
}

console.log(`> Berhasil menimpa (patching) ${injectedCount} kasus dengan progress mahal OpenAI!`);

// Lakukan True Atomic Save
const TMP_PATH = TARGET_FILE + '.tmp';
console.log('6. Menyimpan Database Gabungan (ATOMIC SAVE)...');
fs.writeFileSync(TMP_PATH, JSON.stringify(pureDB, null, 2), 'utf-8');
fs.renameSync(TMP_PATH, TARGET_FILE);

console.log('✅ OPERASI DARURAT BERHASIL. DATA TERSELAMATKAN PENUH!');
