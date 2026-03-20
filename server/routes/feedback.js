/**
 * PRAXIS — Feedback API Routes
 * 6 Logic Bombs defused (Gemini triage 20 Mar 2026)
 */
import { Hono } from 'hono';
import {
  db,
  insertFeedback,
  getAllFeedback,
  getFeedbackByCase,
  getFeedbackById,
  updateFeedbackStatus,
  getFeedbackStats,
  countFeedback,
  insertAudit,
  insertProposal,
  getPendingProposals,
  countProposalsByUser,
  isShadowbanned,
  addShadowban,
} from '../db.js';

const feedback = new Hono();

// ═══════════════════════════════════════
// SECURITY PRIMITIVES
// ═══════════════════════════════════════

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

// Bomb #2 fix: HTML escaping (NOT DOMPurify — preserves medical < > symbols)
// "Trombosit < 150.000" stays intact, but <script> becomes &lt;script&gt;
function escapeText(str, maxLen = 500) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .trim()
    .slice(0, maxLen);
}

// Bomb #4 fix: NaN-safe pagination helpers
function parseLimit(val) {
  const n = parseInt(val);
  return isNaN(n) || n < 1 ? 50 : Math.min(n, 200);
}
function parseOffset(val) {
  const n = parseInt(val);
  return isNaN(n) || n < 0 ? 0 : n;
}

// ═══════════════════════════════════════
// Bomb #6 fix: Transactional writes (atomic — no split brain)
// ═══════════════════════════════════════

const submitFeedbackTx = db.transaction((data) => {
  const result = insertFeedback.run(data.fb);
  insertAudit.run({
    action: 'feedback_created',
    entity_type: 'feedback',
    entity_id: String(result.lastInsertRowid),
    details: JSON.stringify({ case_id: data.fb.case_id, tags: data.tagsArray }),
  });
  return result.lastInsertRowid;
});

const submitProposalTx = db.transaction((data) => {
  const result = insertProposal.run(data.prop);
  insertAudit.run({
    action: 'proposal_submitted',
    entity_type: 'pending_edit',
    entity_id: String(result.lastInsertRowid),
    details: JSON.stringify({ case_id: data.prop.case_id, field: data.prop.field }),
  });
  return result.lastInsertRowid;
});

// ═══════════════════════════════════════
// PUBLIC ROUTES (Mahasiswa — no admin key needed)
// ═══════════════════════════════════════

// POST /api/feedback — Submit new feedback
feedback.post('/', async (c) => {
  try {
    const body = await c.req.json();
    const { case_id, case_code, tags, comment, user_fingerprint } = body;

    if (!case_id || !Array.isArray(tags) || tags.length === 0) {
      return c.json({ error: 'case_id and tags[] are required' }, 400);
    }

    const cleanCaseId = String(case_id).replace(/[^a-zA-Z0-9_-]/g, '');
    if (!cleanCaseId) return c.json({ error: 'Invalid case_id format' }, 400);

    const validTags = tags.filter(t => VALID_TAGS.has(t));
    if (validTags.length === 0) return c.json({ error: 'No valid tags provided' }, 400);

    const id = submitFeedbackTx({
      fb: {
        case_id: cleanCaseId,
        case_code: escapeText(case_code, 50),
        tags: JSON.stringify(validTags),
        comment: escapeText(comment, 1000),
        user_fingerprint: escapeText(user_fingerprint, 64),
      },
      tagsArray: validTags,
    });

    return c.json({ id, status: 'created' }, 201);
  } catch (err) {
    console.error('[Feedback] POST error:', err.message);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

// POST /api/feedback/propose — "Heal This Case" (public, shadowban-gated)
feedback.post('/propose', async (c) => {
  try {
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

    // Shadow Realm: trolls get 200 OK but data → /dev/null
    if (isShadowbanned.get({ user_hash: cleanHash })) {
      return c.json({ id: 0, status: 'received' }, 200);
    }

    // Bomb #5 fix: Limit JSON.stringify payload to prevent Event Loop freeze
    const oldValStr = JSON.stringify(old_value ?? null);
    const newValStr = JSON.stringify(new_value);
    if (oldValStr.length > 10_000 || newValStr.length > 10_000) {
      return c.json({ error: 'Payload too large (max 10KB per field)' }, 413);
    }

    const id = submitProposalTx({
      prop: {
        case_id: escapeText(String(case_id), 30),
        user_hash: cleanHash,
        field,
        old_value: oldValStr,
        new_value: newValStr,
        reference: escapeText(reference, 300),
      },
    });

    // Bomb #1 fix: NO auto-shadowban here!
    // Shadowban decisions belong in admin REJECT flow or Nightly AI Bouncer,
    // not in the submission route. Otherwise we execute our best contributors.

    return c.json({ id, status: 'received' }, 201);
  } catch (err) {
    console.error('[Proposal] POST error:', err.message);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

// ═══════════════════════════════════════
// ADMIN-PROTECTED ROUTES
// Bomb #3 fix: These need X-Admin-Key header (enforced in server.js routing)
// ═══════════════════════════════════════

// GET /api/feedback — List all feedback
feedback.get('/', (c) => {
  const limit = parseLimit(c.req.query('limit'));
  const offset = parseOffset(c.req.query('offset'));

  try {
    const rows = getAllFeedback.all({ limit, offset });
    const parsed = rows.map(r => ({ ...r, tags: JSON.parse(r.tags || '[]') }));
    return c.json({ data: parsed, limit, offset });
  } catch (err) {
    console.error('[Feedback] GET error:', err.message);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

// GET /api/feedback/stats — Aggregated statistics
feedback.get('/stats', (c) => {
  const limit = parseLimit(c.req.query('limit'));

  try {
    const counts = countFeedback.get();
    const topCases = getFeedbackStats.all({ limit });
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

// GET /api/feedback/case/:caseId — Feedback for a specific case
feedback.get('/case/:caseId', (c) => {
  const case_id = String(c.req.param('caseId')).replace(/[^a-zA-Z0-9_-]/g, '');
  if (!case_id) return c.json({ error: 'Invalid case_id' }, 400);

  try {
    const rows = getFeedbackByCase.all({ case_id });
    const parsed = rows.map(r => ({ ...r, tags: JSON.parse(r.tags || '[]') }));
    return c.json({ data: parsed });
  } catch (err) {
    console.error('[Feedback] Case error:', err.message);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

// PATCH /api/feedback/:id — Update feedback status (admin)
feedback.patch('/:id', async (c) => {
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) return c.json({ error: 'Invalid ID' }, 400);

  try {
    const body = await c.req.json();
    const { status, note } = body;

    if (!['open', 'resolved', 'dismissed', 'wontfix'].includes(status)) {
      return c.json({ error: 'Invalid status' }, 400);
    }

    const existing = getFeedbackById.get({ id });
    if (!existing) return c.json({ error: 'Not found' }, 404);

    // Atomic: update + audit in transaction
    db.transaction(() => {
      updateFeedbackStatus.run({ id, status, note: escapeText(note, 500) });
      insertAudit.run({
        action: 'feedback_status_changed',
        entity_type: 'feedback',
        entity_id: String(id),
        details: JSON.stringify({ from: existing.status, to: status }),
      });
    })();

    return c.json({ id, status });
  } catch (err) {
    console.error('[Feedback] PATCH error:', err.message);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

// GET /api/feedback/proposals — List pending proposals (admin)
feedback.get('/proposals', (c) => {
  const limit = parseLimit(c.req.query('limit'));
  const offset = parseOffset(c.req.query('offset'));

  try {
    const rows = getPendingProposals.all({ limit, offset });
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

export default feedback;
