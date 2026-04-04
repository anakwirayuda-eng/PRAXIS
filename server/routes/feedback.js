/**
 * PRAXIS — Feedback API Routes (Cloudflare D1 version)
 * All DB operations are async via D1 binding.
 */
import { Hono } from 'hono';

// Tag whitelist (O(1) validation)
const VALID_TAGS = new Set([
  'wrong_answer', 'unclear', 'incomplete', 'bad_options',
  'bad_rationale', 'duplicate', 'excellent', 'flagged',
]);

// Proposal field whitelist
const VALID_PROPOSAL_FIELDS = new Set([
  'prompt', 'options', 'rationale.correct', 'rationale.pearl',
  'rationale.distractors', 'answer_key', 'vignette',
]);

// HTML escaping (preserves medical < > symbols)
function escapeText(str, maxLen = 500) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .trim()
    .slice(0, maxLen);
}

function parseLimit(val) {
  const n = parseInt(val);
  return isNaN(n) || n < 1 ? 50 : Math.min(n, 200);
}
function parseOffset(val) {
  const n = parseInt(val);
  return isNaN(n) || n < 0 ? 0 : n;
}

function waitUntil(c, task) {
  if (c.executionCtx?.waitUntil) {
    c.executionCtx.waitUntil(task);
    return;
  }
  Promise.resolve(task).catch((error) => {
    console.error('[Feedback] Background task failed:', error?.message || error);
  });
}

export function createFeedbackRoutes() {
  const feedback = new Hono();

  // POST /api/feedback — Submit new feedback
  feedback.post('/', async (c) => {
    try {
      const db = c.get('db');
      const body = await c.req.json();
      const { case_id, case_code, tags, comment, user_fingerprint } = body;

      if (!case_id || !Array.isArray(tags) || tags.length === 0) {
        return c.json({ error: 'case_id and tags[] are required' }, 400);
      }

      const cleanCaseId = String(case_id).replace(/[^a-zA-Z0-9_-]/g, '');
      if (!cleanCaseId) return c.json({ error: 'Invalid case_id format' }, 400);

      const validTags = tags.filter(t => VALID_TAGS.has(t));
      if (validTags.length === 0) return c.json({ error: 'No valid tags provided' }, 400);

      const fbData = {
        case_id: cleanCaseId,
        case_code: escapeText(case_code, 50),
        tags: JSON.stringify(validTags),
        comment: escapeText(comment, 1000),
        user_fingerprint: escapeText(user_fingerprint, 64),
      };

      // D1 batch = atomic transaction
      const results = await db.batch([
        db.prepare(
          'INSERT INTO feedback (case_id, case_code, tags, comment, user_fingerprint) VALUES (?, ?, ?, ?, ?)'
        ).bind(fbData.case_id, fbData.case_code, fbData.tags, fbData.comment, fbData.user_fingerprint),
        db.prepare('SELECT last_insert_rowid() as id'),
      ]);

      const id = results[1].results[0]?.id || 0;

      // Fire-and-forget audit (non-blocking)
      waitUntil(
        c,
        db.prepare(
          'INSERT INTO audit_log (action, entity_type, entity_id, details) VALUES (?, ?, ?, ?)'
        ).bind('feedback_created', 'feedback', String(id), JSON.stringify({ case_id: cleanCaseId, tags: validTags })).run()
      );

      return c.json({ id, status: 'created' }, 201);
    } catch (err) {
      console.error('[Feedback] POST error:', err.message);
      return c.json({ error: 'Internal server error' }, 500);
    }
  });

  // POST /api/feedback/propose — "Heal This Case" (public, shadowban-gated)
  feedback.post('/propose', async (c) => {
    try {
      const db = c.get('db');
      const body = await c.req.json();
      const { case_id, user_hash, field, old_value, new_value, reference } = body;

      if (!case_id || !field || new_value === undefined) {
        return c.json({ error: 'case_id, field, and new_value are required' }, 400);
      }
      if (!VALID_PROPOSAL_FIELDS.has(field)) {
        return c.json({ error: `Invalid field: ${field}` }, 400);
      }
      if (!reference || escapeText(reference, 300).length < 5) {
        return c.json({ error: 'Reference (book/journal) required (min 5 chars)' }, 400);
      }

      const cleanHash = escapeText(user_hash || 'anonymous', 64);

      // Shadow Realm check
      const banned = await db.prepare('SELECT * FROM shadowban WHERE user_hash = ?').bind(cleanHash).first();
      if (banned) {
        return c.json({ id: 0, status: 'received' }, 200);
      }

      const oldValStr = JSON.stringify(old_value ?? null);
      const newValStr = JSON.stringify(new_value);
      if (oldValStr.length > 10_000 || newValStr.length > 10_000) {
        return c.json({ error: 'Payload too large (max 10KB per field)' }, 413);
      }

      const cleanCaseId = escapeText(String(case_id), 30);

      const results = await db.batch([
        db.prepare(
          'INSERT INTO pending_edits (case_id, user_hash, field, old_value, new_value, reference) VALUES (?, ?, ?, ?, ?, ?)'
        ).bind(cleanCaseId, cleanHash, field, oldValStr, newValStr, escapeText(reference, 300)),
        db.prepare('SELECT last_insert_rowid() as id'),
      ]);

      const id = results[1].results[0]?.id || 0;

      waitUntil(
        c,
        db.prepare(
          'INSERT INTO audit_log (action, entity_type, entity_id, details) VALUES (?, ?, ?, ?)'
        ).bind('proposal_submitted', 'pending_edit', String(id), JSON.stringify({ case_id: cleanCaseId, field })).run()
      );

      return c.json({ id, status: 'received' }, 201);
    } catch (err) {
      console.error('[Proposal] POST error:', err.message);
      return c.json({ error: 'Internal server error' }, 500);
    }
  });

  // GET /api/feedback — List all feedback (admin)
  feedback.get('/', async (c) => {
    const db = c.get('db');
    const limit = parseLimit(c.req.query('limit'));
    const offset = parseOffset(c.req.query('offset'));

    try {
      const { results: rows } = await db.prepare(
        'SELECT * FROM feedback ORDER BY created_at DESC LIMIT ? OFFSET ?'
      ).bind(limit, offset).all();

      const parsed = rows.map(r => ({ ...r, tags: JSON.parse(r.tags || '[]') }));
      return c.json({ data: parsed, limit, offset });
    } catch (err) {
      console.error('[Feedback] GET error:', err.message);
      return c.json({ error: 'Internal server error' }, 500);
    }
  });

  // GET /api/feedback/stats
  feedback.get('/stats', async (c) => {
    const db = c.get('db');
    const limit = parseLimit(c.req.query('limit'));

    try {
      const counts = await db.prepare(`
        SELECT 
          COUNT(*) as total,
          SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) as open,
          SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) as resolved,
          SUM(CASE WHEN status = 'dismissed' THEN 1 ELSE 0 END) as dismissed
        FROM feedback
      `).first();

      const { results: topCases } = await db.prepare(`
        SELECT case_id, case_code, COUNT(*) as report_count,
          GROUP_CONCAT(DISTINCT json_each.value) as all_tags,
          MIN(created_at) as first_reported, MAX(created_at) as last_reported,
          SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) as open_count
        FROM feedback, json_each(feedback.tags)
        GROUP BY case_id ORDER BY report_count DESC LIMIT ?
      `).bind(limit).all();

      return c.json({
        counts,
        top_flagged: topCases.map(r => ({
          ...r,
          all_tags: r.all_tags ? r.all_tags.split(',') : [],
        })),
      });
    } catch (err) {
      console.error('[Feedback] Stats error:', err.message);
      return c.json({ error: 'Internal server error' }, 500);
    }
  });

  // GET /api/feedback/case/:caseId
  feedback.get('/case/:caseId', async (c) => {
    const db = c.get('db');
    const case_id = String(c.req.param('caseId')).replace(/[^a-zA-Z0-9_-]/g, '');
    if (!case_id) return c.json({ error: 'Invalid case_id' }, 400);

    try {
      const { results: rows } = await db.prepare(
        'SELECT * FROM feedback WHERE case_id = ? ORDER BY created_at DESC'
      ).bind(case_id).all();
      const parsed = rows.map(r => ({ ...r, tags: JSON.parse(r.tags || '[]') }));
      return c.json({ data: parsed });
    } catch (err) {
      console.error('[Feedback] Case error:', err.message);
      return c.json({ error: 'Internal server error' }, 500);
    }
  });

  // PATCH /api/feedback/:id — Update feedback status (admin)
  feedback.patch('/:id', async (c) => {
    const db = c.get('db');
    const id = parseInt(c.req.param('id'));
    if (isNaN(id)) return c.json({ error: 'Invalid ID' }, 400);

    try {
      const body = await c.req.json();
      const { status, note } = body;

      if (!['open', 'resolved', 'dismissed', 'wontfix'].includes(status)) {
        return c.json({ error: 'Invalid status' }, 400);
      }

      const existing = await db.prepare('SELECT * FROM feedback WHERE id = ?').bind(id).first();
      if (!existing) return c.json({ error: 'Not found' }, 404);

      await db.batch([
        db.prepare(
          'UPDATE feedback SET status = ?, resolved_note = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
        ).bind(status, escapeText(note, 500), id),
        db.prepare(
          'INSERT INTO audit_log (action, entity_type, entity_id, details) VALUES (?, ?, ?, ?)'
        ).bind('feedback_status_changed', 'feedback', String(id), JSON.stringify({ from: existing.status, to: status })),
      ]);

      return c.json({ id, status });
    } catch (err) {
      console.error('[Feedback] PATCH error:', err.message);
      return c.json({ error: 'Internal server error' }, 500);
    }
  });

  // GET /api/feedback/proposals — List pending proposals (admin)
  feedback.get('/proposals', async (c) => {
    const db = c.get('db');
    const limit = parseLimit(c.req.query('limit'));
    const offset = parseOffset(c.req.query('offset'));

    try {
      const { results: rows } = await db.prepare(
        "SELECT * FROM pending_edits WHERE status = 'pending' OR status = 'ai_valid' ORDER BY created_at DESC LIMIT ? OFFSET ?"
      ).bind(limit, offset).all();

      const parsed = rows.map(r => ({
        ...r,
        old_value: JSON.parse(r.old_value || 'null'),
        new_value: JSON.parse(r.new_value || 'null'),
        ai_verdict: JSON.parse(r.ai_verdict || '{}'),
      }));
      return c.json({ data: parsed, limit, offset });
    } catch (err) {
      console.error('[Proposals] GET error:', err.message);
      return c.json({ error: 'Internal server error' }, 500);
    }
  });

  return feedback;
}
