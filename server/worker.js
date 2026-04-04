/**
 * PRAXIS — Cloudflare Worker Entry Point
 * Hono app exported for CF Workers runtime.
 * D1 database injected via env binding.
 * 
 * Local dev: npx wrangler dev
 * Deploy:    npx wrangler deploy
 */
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { createFeedbackRoutes } from './routes/feedback.js';
import { createAdminRoutes } from './routes/admin.js';

const app = new Hono();

// ═══════════════════════════════════════
// SECURITY MIDDLEWARE
// ═══════════════════════════════════════

// Layer 1: Secure HTTP Headers
app.use('*', async (c, next) => {
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('X-XSS-Protection', '1; mode=block');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
});

// Layer 2: Request Logging
app.use('*', logger());

// Layer 3: CORS
app.use('/api/*', cors({
  origin: (origin) => {
    // Allow configured origins or any for beta
    const allowed = ['http://localhost:5173', 'http://localhost:5174'];
    if (!origin || allowed.includes(origin) || origin.endsWith('.pages.dev')) return origin;
    return null;
  },
  allowMethods: ['GET', 'POST', 'PATCH', 'DELETE'],
  allowHeaders: ['Content-Type', 'X-Admin-Key', 'X-Praxis-Shield'],
  maxAge: 86400,
}));

// Layer 4: Body size limit for public endpoints
app.use('/api/feedback/*', async (c, next) => {
  const contentLength = parseInt(c.req.header('content-length') || '0');
  if (contentLength > 51_200) {
    return c.json({ error: 'Payload too large (max 50KB)' }, 413);
  }
  await next();
});
app.use('/api/telemetry', async (c, next) => {
  const contentLength = parseInt(c.req.header('content-length') || '0');
  if (contentLength > 51_200) {
    return c.json({ error: 'Payload too large (max 50KB)' }, 413);
  }
  await next();
});
app.use('/api/admin/*', async (c, next) => {
  const contentLength = parseInt(c.req.header('content-length') || '0');
  if (contentLength > 1_048_576) {
    return c.json({ error: 'Payload too large (max 1MB)' }, 413);
  }
  await next();
});

// Layer 5: Inject D1 database into context
app.use('/api/*', async (c, next) => {
  c.set('db', c.env.DB);
  c.set('adminKey', c.env?.ADMIN_KEY || '');
  await next();
});

// Layer 6: Global error handler
app.onError((err, c) => {
  console.error(`[ERROR] ${c.req.method} ${c.req.path}:`, err.message);
  return c.json({ error: 'Internal server error' }, 500);
});

// ═══════════════════════════════════════
// ROUTES
// ═══════════════════════════════════════

// Health check
app.get('/api/health', (c) =>
  c.json({ status: 'ok', version: '2.0.0-d1', runtime: 'cloudflare-workers' })
);

// Telemetry beacon
app.post('/api/telemetry', async (c) => {
  try {
    const db = c.get('db');
    const rawBody = await c.req.text();
    const body = rawBody ? JSON.parse(rawBody) : [];
    const events = Array.isArray(body) ? body : [body];
    const batch = events.slice(0, 50);

    const stmts = [];
    for (const e of batch) {
      if (!e.case_id) continue;
      const timeMs = Math.round(parseInt(e.time_ms) || 0);
      if (timeMs < 1500 || timeMs > 3_600_000) continue;
      stmts.push(
        db.prepare(
          'INSERT OR IGNORE INTO telemetry_log (case_id, is_correct, time_ms, user_hash) VALUES (?, ?, ?, ?)'
        ).bind(String(e.case_id), e.is_correct ? 1 : 0, timeMs, String(e.user_hash || '').slice(0, 64))
      );
    }

    if (stmts.length > 0) await db.batch(stmts);
    return c.json({ ok: true, ingested: stmts.length }, 201);
  } catch {
    return c.json({ ok: false }, 400);
  }
});

// API Routes (pass db via context)
app.route('/api/feedback', createFeedbackRoutes());
app.route('/api/admin', createAdminRoutes());

// Honeypots
app.get('/api/admin/system_dump', (c) => {
  console.warn(`🚨 HONEYPOT triggered: ${c.req.url}`);
  return c.text('Anomali terdeteksi. IP Anda telah dikunci oleh PRAXIS Cyber Defense.', 418);
});
app.get('/wp-admin', (c) => c.text('', 418));
app.get('/.env', (c) => c.text('', 418));
app.get('/api/config', (c) => c.text('', 418));

// Export for Cloudflare Workers
export default app;
