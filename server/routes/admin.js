/**
 * PRAXIS — Admin API Routes (Cloudflare D1 version)
 * Protected by ADMIN_KEY header (timing-safe comparison)
 */
import { Hono } from 'hono';

// Timing-safe key comparison
function verifyKey(input, expected) {
  if (!input || !expected) return false;
  if (input.length !== expected.length) return false;
  let result = 0;
  for (let i = 0; i < input.length; i++) {
    result |= input.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return result === 0;
}

export function createAdminRoutes() {
  const admin = new Hono();

  // Middleware: check ADMIN_KEY
  admin.use('*', async (c, next) => {
    const key = c.req.header('X-Admin-Key') || c.req.query('key');
    const expected = c.env?.ADMIN_KEY || 'praxis-admin-2026';

    if (!verifyKey(key, expected)) {
      return c.json({ error: 'Unauthorized. Set X-Admin-Key header.' }, 401);
    }
    await next();
  });

  // GET /api/admin/cases/:id — Get single case (read-only on Workers)
  admin.get('/cases/:id', async (c) => {
    const db = c.get('db');
    const caseId = c.req.param('id');

    const { results: edits } = await db.prepare(
      'SELECT * FROM edits WHERE case_id = ? ORDER BY created_at DESC'
    ).bind(String(caseId)).all();

    return c.json({ case: null, edits, note: 'Case data is client-side. Edits shown from D1.' });
  });

  // PATCH /api/admin/cases/:id — Record an edit (metadata only, no filesystem)
  admin.patch('/cases/:id', async (c) => {
    const db = c.get('db');
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
      await db.batch([
        db.prepare(
          'INSERT INTO edits (case_id, field, old_value, new_value, admin_note) VALUES (?, ?, ?, ?, ?)'
        ).bind(String(caseId), field, null, JSON.stringify(value), note || ''),
        db.prepare(
          'INSERT INTO audit_log (action, entity_type, entity_id, details) VALUES (?, ?, ?, ?)'
        ).bind('case_edited', 'case', String(caseId), JSON.stringify({ field, note })),
      ]);

      return c.json({ success: true, case_id: caseId, field, note: 'Edit recorded in D1. Apply locally and redeploy.' });
    } catch (err) {
      return c.json({ error: err.message }, 500);
    }
  });

  // PATCH /api/admin/proposals/:id — Approve/reject proposal
  admin.patch('/proposals/:id', async (c) => {
    const db = c.get('db');
    const id = parseInt(c.req.param('id'));
    if (isNaN(id)) return c.json({ error: 'Invalid ID' }, 400);

    try {
      const body = await c.req.json();
      const { status, note } = body;

      if (!['approved', 'rejected', 'ai_valid', 'ai_invalid'].includes(status)) {
        return c.json({ error: 'Invalid status' }, 400);
      }

      const existing = await db.prepare('SELECT * FROM pending_edits WHERE id = ?').bind(id).first();
      if (!existing) return c.json({ error: 'Not found' }, 404);

      await db.batch([
        db.prepare(
          'UPDATE pending_edits SET status = ?, admin_note = ? WHERE id = ?'
        ).bind(status, note || '', id),
        db.prepare(
          'INSERT INTO audit_log (action, entity_type, entity_id, details) VALUES (?, ?, ?, ?)'
        ).bind('proposal_reviewed', 'pending_edit', String(id), JSON.stringify({ from: existing.status, to: status })),
      ]);

      return c.json({ id, status });
    } catch (err) {
      return c.json({ error: err.message }, 500);
    }
  });

  // GET /api/admin/edits — All edits history
  admin.get('/edits', async (c) => {
    const db = c.get('db');
    const limit = Math.min(parseInt(c.req.query('limit') || '50'), 200);
    const offset = parseInt(c.req.query('offset') || '0');

    const { results: rows } = await db.prepare(
      'SELECT * FROM edits ORDER BY created_at DESC LIMIT ? OFFSET ?'
    ).bind(limit, offset).all();

    return c.json({ data: rows, limit, offset });
  });

  // GET /api/admin/audit — Audit log
  admin.get('/audit', async (c) => {
    const db = c.get('db');
    const limit = Math.min(parseInt(c.req.query('limit') || '100'), 500);
    const offset = parseInt(c.req.query('offset') || '0');

    const { results: rows } = await db.prepare(
      'SELECT * FROM audit_log ORDER BY created_at DESC LIMIT ? OFFSET ?'
    ).bind(limit, offset).all();

    const parsed = rows.map(r => ({ ...r, details: JSON.parse(r.details || '{}') }));
    return c.json({ data: parsed, limit, offset });
  });

  // GET /api/admin/overview — Quick dashboard stats (D1 only, no JSON file)
  admin.get('/overview', async (c) => {
    const db = c.get('db');

    const feedbackCount = await db.prepare('SELECT COUNT(*) as total FROM feedback').first();
    const openCount = await db.prepare("SELECT COUNT(*) as cnt FROM feedback WHERE status = 'open'").first();
    const editCount = await db.prepare('SELECT COUNT(*) as total FROM edits').first();
    const proposalCount = await db.prepare("SELECT COUNT(*) as total FROM pending_edits WHERE status = 'pending'").first();
    const telemetryCount = await db.prepare('SELECT COUNT(*) as total FROM telemetry_log').first();

    return c.json({
      feedback: { total: feedbackCount?.total || 0, open: openCount?.cnt || 0 },
      edits: editCount?.total || 0,
      proposals_pending: proposalCount?.total || 0,
      telemetry_events: telemetryCount?.total || 0,
    });
  });

  // GET /api/admin/patches?since= — Delta-Patch Sync
  admin.get('/patches', async (c) => {
    const db = c.get('db');
    const since = parseInt(c.req.query('since') || '0');

    const { results: recentEdits } = await db.prepare(
      `SELECT DISTINCT case_id FROM edits 
       WHERE created_at > datetime(? / 1000, 'unixepoch')
       ORDER BY created_at DESC`
    ).bind(since).all();

    return c.json({
      edited_case_ids: recentEdits.map(e => e.case_id),
      count: recentEdits.length,
      since,
      note: 'Case data is client-side. Only edit IDs returned from D1.',
    });
  });

  return admin;
}
