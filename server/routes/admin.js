/**
 * PRAXIS — Admin API Routes
 * Protected by ADMIN_KEY header (timing-safe comparison)
 */
import { Hono } from 'hono';
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { timingSafeEqual } from 'node:crypto';
import {
  db,
  insertEdit,
  getEditsByCase,
  getAllEdits,
  getAuditLog,
  insertAudit,
} from '../db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, '..', '..', 'public', 'data', 'compiled_cases.json');

const admin = new Hono();

// Timing-safe key comparison (prevents timing attacks)
function verifyKey(input, expected) {
  if (!input || !expected) return false;
  const a = Buffer.from(input);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// Middleware: check ADMIN_KEY
admin.use('*', async (c, next) => {
  const key = c.req.header('X-Admin-Key') || c.req.query('key');
  const expected = process.env.ADMIN_KEY || 'praxis-admin-2026';

  if (!verifyKey(key, expected)) {
    return c.json({ error: 'Unauthorized. Set X-Admin-Key header.' }, 401);
  }
  await next();
});

// Helper: load case DB
function loadCases() {
  return JSON.parse(readFileSync(DB_PATH, 'utf-8'));
}

// Helper: find case
function findCase(cases, caseId) {
  const id = parseInt(caseId);
  return cases.find(c => c._id === id || c.case_code === caseId);
}

// GET /api/admin/cases/:id — Get single case
admin.get('/cases/:id', (c) => {
  const caseId = c.req.param('id');
  const cases = loadCases();
  const found = findCase(cases, caseId);

  if (!found) return c.json({ error: 'Case not found' }, 404);

  const edits = getEditsByCase.all({ case_id: String(found._id) });

  return c.json({ case: found, edits });
});

// PATCH /api/admin/cases/:id — Edit case field
admin.patch('/cases/:id', async (c) => {
  const caseId = c.req.param('id');
  const body = await c.req.json();
  const { field, value, note } = body;

  const allowedFields = [
    'rationale.correct', 'rationale.pearl',
    'options', 'prompt', 'meta.is_decayed',
    'meta.quarantined', 'meta.quarantine_reason',
  ];

  if (!field || !allowedFields.includes(field)) {
    return c.json({ error: `Field must be one of: ${allowedFields.join(', ')}` }, 400);
  }

  try {
    const cases = loadCases();
    const found = findCase(cases, caseId);
    if (!found) return c.json({ error: 'Case not found' }, 404);

    // Get old value
    const parts = field.split('.');
    let oldValue;
    if (parts.length === 1) {
      oldValue = found[parts[0]];
    } else {
      oldValue = found[parts[0]]?.[parts[1]];
    }

    // Set new value
    if (parts.length === 1) {
      found[parts[0]] = value;
    } else {
      if (!found[parts[0]]) found[parts[0]] = {};
      found[parts[0]][parts[1]] = value;
    }

    // Save DB
    writeFileSync(DB_PATH, JSON.stringify(cases, null, 0), 'utf-8');

    // Record edit
    insertEdit.run({
      case_id: String(found._id),
      field,
      old_value: JSON.stringify(oldValue),
      new_value: JSON.stringify(value),
      admin_note: note || '',
    });

    insertAudit.run({
      action: 'case_edited',
      entity_type: 'case',
      entity_id: String(found._id),
      details: JSON.stringify({ field, note }),
    });

    return c.json({ success: true, case_id: found._id, field });
  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
});

// GET /api/admin/edits — All edits history
admin.get('/edits', (c) => {
  const limit = Math.min(parseInt(c.req.query('limit') || '50'), 200);
  const offset = parseInt(c.req.query('offset') || '0');

  const rows = getAllEdits.all({ limit, offset });
  return c.json({ data: rows, limit, offset });
});

// GET /api/admin/audit — Audit log
admin.get('/audit', (c) => {
  const limit = Math.min(parseInt(c.req.query('limit') || '100'), 500);
  const offset = parseInt(c.req.query('offset') || '0');

  const rows = getAuditLog.all({ limit, offset });
  const parsed = rows.map(r => ({ ...r, details: JSON.parse(r.details || '{}') }));
  return c.json({ data: parsed, limit, offset });
});

// GET /api/admin/overview — Quick dashboard stats
admin.get('/overview', (c) => {
  const cases = loadCases();

  const stats = {
    total_cases: cases.length,
    sources: {},
    categories: {},
    quality_flags: {
      decayed: cases.filter(c => c.meta?.is_decayed).length,
      quarantined: cases.filter(c => c.meta?.quarantined).length,
      negation_blindspot: cases.filter(c => c.meta?.negation_blindspot).length,
      do_not_shuffle: cases.filter(c => c.meta?.do_not_shuffle).length,
    },
  };

  for (const c of cases) {
    const src = c.meta?.source || 'unknown';
    stats.sources[src] = (stats.sources[src] || 0) + 1;
    const cat = c.category || 'uncategorized';
    stats.categories[cat] = (stats.categories[cat] || 0) + 1;
  }

  return c.json(stats);
});

// GET /api/admin/patches?since=<unix_ms> — Delta-Patch Sync (DeepThink #2)
// Returns only cases edited since the given timestamp
admin.get('/patches', (c) => {
  const since = parseInt(c.req.query('since') || '0');
  
  // Get all edits since timestamp
  const recentEdits = db.prepare(`
    SELECT DISTINCT case_id FROM edits 
    WHERE created_at > datetime(@since / 1000, 'unixepoch')
    ORDER BY created_at DESC
  `).all({ since });
  
  if (recentEdits.length === 0) {
    return c.json({ patches: [], count: 0, since });
  }

  const cases = loadCases();
  const editedIds = new Set(recentEdits.map(e => e.case_id));
  const patches = cases
    .filter(cs => editedIds.has(String(cs._id)))
    .map(cs => ({ _id: cs._id, case_code: cs.case_code, options: cs.options, rationale: cs.rationale, meta: cs.meta }));

  return c.json({ patches, count: patches.length, since });
});

export default admin;
