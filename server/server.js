/**
 * PRAXIS — Backend Server (Hono + better-sqlite3)
 * 
 * Usage:
 *   node server/server.js          (production: API-only, frontend on Cloudflare Pages)
 *   node server/server.js --dev    (dev: API only, Vite proxies /api)
 */
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { serve } from '@hono/node-server';
import { createFeedbackRoutes } from './routes/feedback.js';
import { createAdminRoutes } from './routes/admin.js';
import { createD1Shim } from './d1-shim.js';
import { db, insertTelemetry } from './db.js';

const app = new Hono();
const PORT = parseInt(process.env.PORT || '3001');
const isDev = process.argv.includes('--dev');
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'http://localhost:5173,http://localhost:5174')
  .split(',').map(o => o.trim());
const appDb = createD1Shim(db);

// ═══════════════════════════════════════
// SECURITY MIDDLEWARE (7-Layer Defense)
// ═══════════════════════════════════════

// Layer 1: Secure HTTP Headers (Helmet-equivalent)
app.use('*', async (c, next) => {
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('X-XSS-Protection', '1; mode=block');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (!isDev) {
    c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    c.header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'");
  }
});

// Layer 2: Request Logging
app.use('*', logger());

// Layer 3: CORS — locked to explicit origins (no wildcard in production)
app.use('/api/*', cors({
  origin: isDev ? ALLOWED_ORIGINS : ALLOWED_ORIGINS,
  allowMethods: ['GET', 'POST', 'PATCH', 'DELETE'],
  allowHeaders: ['Content-Type', 'X-Admin-Key', 'X-Praxis-Shield'],
  maxAge: 86400,
}));

app.use('/api/*', async (c, next) => {
  c.set('db', appDb);
  await next();
});

// Layer 4: Shield Header — reject direct attacks bypassing Cloudflare
// In production, Cloudflare Transform Rule injects X-Praxis-Shield header.
// Requests without it are attackers hitting Fly.io directly.
const SHIELD_SECRET = process.env.PRAXIS_SHIELD_KEY || '';
if (!isDev && SHIELD_SECRET) {
  app.use('/api/*', async (c, next) => {
    // Allow health check without shield (for UptimeRobot)
    if (c.req.path === '/api/health') return next();
    const shield = c.req.header('X-Praxis-Shield');
    if (shield !== SHIELD_SECRET) {
      console.warn(`🚨 SHIELD BLOCK: Missing/invalid shield header from ${c.req.header('cf-connecting-ip') || 'unknown'}`);
      return c.json({ error: 'Forbidden' }, 403);
    }
    return next();
  });
}

// Void Spot #3 fix: Tight body limit (50KB for public, prevents JSON asphyxiation)
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
// Admin endpoints keep 1MB limit for case editing
app.use('/api/admin/*', async (c, next) => {
  const contentLength = parseInt(c.req.header('content-length') || '0');
  if (contentLength > 1_048_576) {
    return c.json({ error: 'Payload too large (max 1MB)' }, 413);
  }
  await next();
});

// Layer 5: Global error handler (prevents stack trace leaks)
app.onError((err, c) => {
  console.error(`[ERROR] ${c.req.method} ${c.req.path}:`, err.message);
  return c.json({
    error: isDev ? err.message : 'Internal server error',
  }, 500);
});

// Health check
app.get('/api/health', (c) =>
  c.json({
    status: 'ok',
    version: '1.0.0',
    uptime: Math.round(process.uptime()),
  })
);

// API Routes
app.route('/api/feedback', createFeedbackRoutes());
app.route('/api/admin', createAdminRoutes());

// ═══════════════════════════════════════
// TELEMETRY BEACON (Bomb #1 + #2 fixed)
// ═══════════════════════════════════════

// Bomb #2 fix: Batch transaction — 1 disk write instead of N
// Void Spot #4 fix: Biological filter + INSERT OR IGNORE for idempotency
const insertTelemetryBatch = db.transaction((eventsArray) => {
  for (const e of eventsArray) {
    if (!e.case_id) continue;
    const timeMs = Math.round(parseInt(e.time_ms) || 0);
    // Biological filter: humans can't read a clinical vignette in <1.5s or >1hr
    if (timeMs < 1500 || timeMs > 3_600_000) continue;
    insertTelemetry.run({
      case_id: String(e.case_id),
      is_correct: e.is_correct ? 1 : 0,
      time_ms: timeMs,
      user_hash: String(e.user_hash || '').slice(0, 64),
    });
  }
});

app.post('/api/telemetry', async (c) => {
  try {
    // Bomb #1 fix: sendBeacon sends text/plain, not application/json
    const rawBody = await c.req.text();
    const body = rawBody ? JSON.parse(rawBody) : [];
    const events = Array.isArray(body) ? body : [body];
    const batch = events.slice(0, 50);
    
    insertTelemetryBatch(batch);
    
    return c.json({ ok: true, ingested: batch.length }, 201);
  } catch {
    return c.json({ ok: false }, 400);
  }
});

// Void Spot #1 partial: Honeypot (Cyber Tarpit for scanners)
app.get('/api/admin/system_dump', (c) => {
  const ip = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || 'unknown';
  console.warn(`🚨 HONEYPOT triggered by IP: ${ip} — ${c.req.url}`);
  return c.text('Anomali terdeteksi. IP Anda telah dikunci oleh PRAXIS Cyber Defense.', 418);
});
app.get('/wp-admin', (c) => c.text('', 418));
app.get('/.env', (c) => c.text('', 418));
app.get('/api/config', (c) => c.text('', 418));

// ═══════════════════════════════════════
// SERVER START + GRACEFUL SHUTDOWN
// ═══════════════════════════════════════

// Bomb #3 fix: NO serveStatic in production.
// Frontend deploys to Cloudflare Pages. Backend is API-only.
// (Dev mode: Vite proxy handles /api → :3001)

const httpServer = serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`\n🏥 PRAXIS Backend v1.1.0`);
  console.log(`   Mode:  ${isDev ? '🔧 Development' : '🚀 Production (API-only)'}`);
  console.log(`   Port:  ${PORT}`);
  console.log(`   API:   http://localhost:${PORT}/api/health`);
  console.log('');
});

// Bomb #4 fix: Drain HTTP connections before closing DB
const shutdown = (signal) => {
  console.log(`\n⚡ ${signal}: Draining HTTP requests...`);
  httpServer.close(() => {
    console.log('   ✅ HTTP server closed. Checkpointing SQLite WAL...');
    try {
      db.pragma('wal_checkpoint(TRUNCATE)');
      db.close();
      console.log('   ✅ Database closed safely.');
    } catch (e) {
      console.error('   ❌ DB close error:', e.message);
    }
    process.exit(0);
  });

  // Failsafe: force kill after 5s if requests are stuck
  setTimeout(() => process.exit(1), 5000).unref();
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
