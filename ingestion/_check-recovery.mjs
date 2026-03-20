/**
 * Check if MedMCQA source has the missing question text
 * that we can use to recover 11,454 empty-question cases
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = dirname(fileURLToPath(import.meta.url));

// Load MedMCQA source
const srcPath = join(__dirname, 'sources', 'medmcqa');
const { readdirSync } = await import('node:fs');
const files = readdirSync(srcPath);
console.log('MedMCQA source files:', files);

// Find the raw data files
for (const f of files) {
  if (f.endsWith('.json') || f.endsWith('.jsonl') || f.endsWith('.csv')) {
    const path = join(srcPath, f);
    const stat = readFileSync(path).length;
    console.log(`\n${f}: ${(stat/1024/1024).toFixed(1)}MB`);
    
    // Read first few entries
    const content = readFileSync(path, 'utf8');
    let items;
    try {
      items = JSON.parse(content);
      if (!Array.isArray(items)) items = Object.values(items).flat();
    } catch {
      // JSONL?
      items = content.trim().split('\n').slice(0, 5).map(l => JSON.parse(l));
    }
    
    console.log(`Items: ${items.length}`);
    console.log('Keys:', Object.keys(items[0] || {}).join(', '));
    
    // Check if question field exists
    const sample = items[0];
    const qField = sample?.question || sample?.q || sample?.text || sample?.prompt;
    console.log('Has question?', !!qField);
    console.log('Sample Q:', (qField || '').slice(0, 120));
    
    // Check specific IDs that we know are empty
    const emptyIds = [7635, 3331, 1046, 2110, 312];
    for (const id of emptyIds) {
      const match = items.find(i => i._id === id || i.id === id || i.original_index === id);
      if (match) {
        console.log(`\nRecovery check _id=${id}:`);
        console.log(`  Source Q: "${(match.question || match.q || '').slice(0, 100)}"`);
      }
    }
  }
}
