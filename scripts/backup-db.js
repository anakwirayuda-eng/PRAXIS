/**
 * PRAXIS — Database Backup Script
 * Downloads SQLite database from Fly.io to local machine.
 * 
 * Usage: node scripts/backup-db.js
 * Requires: Fly CLI installed and authenticated
 */
import { execSync } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BACKUP_DIR = join(__dirname, '..', 'backups');
const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

if (!existsSync(BACKUP_DIR)) mkdirSync(BACKUP_DIR, { recursive: true });

console.log(`[Backup] ${timestamp} — Downloading database from Fly.io...`);

try {
  execSync(`fly sftp get /data/praxis.db "${join(BACKUP_DIR, `praxis_${timestamp}.db`)}"`, { stdio: 'inherit' });
  console.log(`[Backup] ✅ Saved to backups/praxis_${timestamp}.db`);
} catch (e) {
  console.error('[Backup] ❌ Failed:', e.message);
  console.log('[Backup] Make sure Fly CLI is installed and you are authenticated (fly auth login)');
  process.exit(1);
}
