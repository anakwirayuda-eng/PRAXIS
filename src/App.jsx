/**
 * PRAXIS (MedCase Pro) — The Citadel Router
 * Engineered for Offline-First Resilience, A11y, & High-Availability
 */
import { Suspense, lazy, useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, useLocation, useNavigationType, Navigate, useNavigate } from 'react-router-dom';
import ErrorBoundary from './components/ErrorBoundary';
import GlobalWatchdog from './components/GlobalWatchdog';
import Layout from './components/Layout';
import { hasStoredAdminKey, hasVerifiedAdminSession } from './lib/adminSession';
import { initSecuritySuite } from './lib/securitySuite';

// Sprint 2: Boot security defenses before React tree mounts
initSecuritySuite();

// ═══════════════════════════════════════
// Sage Fix #1: Self-Healing lazyWithRetry (Immortal Edition)
// Clears sessionStorage flag after successful load so retry works forever
// ═══════════════════════════════════════
const lazyWithRetry = (componentImport) =>
  lazy(async () => {
    // Per-route retry key derived from import function identity
    const retryKey = `retry-lazy-${componentImport.toString().slice(0, 64).replace(/\W/g, '')}`;
    const hasRetried = sessionStorage.getItem(retryKey) === 'true';
    try {
      const component = await componentImport();
      // Clear the curse after successful chunk load
      if (hasRetried) sessionStorage.removeItem(retryKey);
      return component;
    } catch (error) {
      if (!hasRetried) {
        sessionStorage.setItem(retryKey, 'true');
        window.location.reload();
      }
      throw error;
    }
  });

// Public pages
const Dashboard = lazyWithRetry(() => import('./pages/Dashboard'));
const CaseBrowser = lazyWithRetry(() => import('./pages/CaseBrowser'));
const CasePlayer = lazyWithRetry(() => import('./pages/CasePlayer'));
const Analytics = lazyWithRetry(() => import('./pages/Analytics'));
const ExamMode = lazyWithRetry(() => import('./pages/ExamMode'));
const MedBlitz = lazyWithRetry(() => import('./pages/MedBlitz'));
const PassPredictor = lazyWithRetry(() => import('./pages/PassPredictor'));
const ReviewPage = lazyWithRetry(() => import('./pages/ReviewPage'));
const NotFound = lazyWithRetry(() => import('./pages/NotFound'));
const SCTArena = lazyWithRetry(() => import('./pages/SCTArena'));

// Admin pages
const DataQuality = lazyWithRetry(() => import('./pages/DataQuality'));
const WatchdogInbox = lazyWithRetry(() => import('./pages/WatchdogInbox'));
const AdminPanel = lazyWithRetry(() => import('./pages/AdminPanel'));

// ═══════════════════════════════════════
// Sage Fix #2: Smart Scroll Restoration
// Only scroll to top on PUSH (new link), NOT on POP (Back button)
// ═══════════════════════════════════════
function ScrollToTop() {
  const { pathname } = useLocation();
  const navType = useNavigationType();

  useEffect(() => {
    if (navType !== 'POP') {
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    }
  }, [pathname, navType]);
  return null;
}

// ═══════════════════════════════════════
// Sage Fix #3: Admin Route Guard
// Redirects non-admin users silently to Dashboard
// ═══════════════════════════════════════
function AdminRoute({ children }) {
  const navigate = useNavigate();
  const [countdown, setCountdown] = useState(3);
  const hasKey = hasStoredAdminKey();
  const isAdmin = hasVerifiedAdminSession();

  useEffect(() => {
    if (!isAdmin) {
      if (countdown <= 0) {
        navigate(hasKey ? '/admin' : '/', { replace: true });
        return;
      }
      const timer = setTimeout(() => setCountdown(c => c - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [isAdmin, countdown, navigate]);

  if (!isAdmin) return (
    <div className="glass-card" role="alert" style={{ padding: 'var(--sp-8)', textAlign: 'center', maxWidth: 480, margin: '10vh auto 0' }}>
      <h2 style={{ marginBottom: 'var(--sp-2)', color: 'var(--accent-warning)' }}>🔒 Akses Terbatas</h2>
      <p style={{ color: 'var(--text-muted)', marginBottom: 'var(--sp-4)' }}>
        {hasKey
          ? 'Sesi admin perlu diverifikasi ulang sebelum membuka halaman ini.'
          : 'Halaman ini hanya tersedia untuk administrator.'}
        <br />
        Dialihkan ke <strong>{hasKey ? 'Admin Panel' : 'Dashboard'}</strong> dalam <strong>{countdown} detik</strong>.
      </p>
      <div className="loader-dots" style={{ margin: 'var(--sp-4) auto' }} />
    </div>
  );
  return children;
}

function RouteFallback() {
  return (
    <div className="glass-card" role="status" aria-live="polite" style={{ padding: 'var(--sp-8)', textAlign: 'center', maxWidth: 720, margin: '10vh auto 0' }}>
      <h2 style={{ marginBottom: 'var(--sp-2)' }}>Memuat Ruang Klinis...</h2>
      <p style={{ color: 'var(--text-muted)' }}>Menyiapkan simulasi PRAXIS berikutnya.</p>
    </div>
  );
}

function RouteBoundary({ children }) {
  return <ErrorBoundary>{children}</ErrorBoundary>;
}

function renderRoute(element, requireAdmin = false) {
  const content = requireAdmin ? <AdminRoute>{element}</AdminRoute> : element;
  return (
    <RouteBoundary>
      <Suspense fallback={<RouteFallback />}>
        {content}
      </Suspense>
    </RouteBoundary>
  );
}

const skipLinkStyle = {
  position: 'fixed', top: 'var(--sp-3)', left: 'var(--sp-3)', zIndex: 5000,
  padding: 'var(--sp-2) var(--sp-3)', borderRadius: 'var(--radius-md)',
  background: 'var(--surface-elevated)', color: 'var(--text-primary)',
  border: 'var(--border-strong)', transform: 'translateY(-150%)', transition: 'transform 0.2s ease',
};

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter basename={import.meta.env.BASE_URL}>
        <ScrollToTop />
        <a
          href="#main-content"
          style={skipLinkStyle}
          onFocus={(e) => { e.currentTarget.style.transform = 'translateY(0)'; }}
          onBlur={(e) => { e.currentTarget.style.transform = 'translateY(-150%)'; }}
        >
          Lewati ke konten utama
        </a>
        <GlobalWatchdog />
        <Layout>
          {/* Sage Fix #4: outline:'none' kills ugly blue focus ring on Chrome */}
          <main id="main-content" tabIndex={-1} style={{ outline: 'none' }}>
            <Routes>
              {/* Public Routes */}
              <Route path="/" element={renderRoute(<Dashboard />)} />
              <Route path="/cases" element={renderRoute(<CaseBrowser />)} />
              <Route path="/case/:id" element={renderRoute(<CasePlayer />)} />
              <Route path="/analytics" element={renderRoute(<Analytics />)} />
              <Route path="/exam" element={renderRoute(<ExamMode />)} />
              <Route path="/blitz" element={renderRoute(<MedBlitz />)} />
              <Route path="/predict" element={renderRoute(<PassPredictor />)} />
              <Route path="/review" element={renderRoute(<ReviewPage />)} />
              <Route path="/sct" element={renderRoute(<SCTArena />)} />

              {/* Protected Admin Routes */}
              <Route path="/quality" element={renderRoute(<DataQuality />, true)} />
              <Route path="/watchdog" element={renderRoute(<WatchdogInbox />, true)} />
              <Route path="/admin" element={renderRoute(<AdminPanel />)} />

              <Route path="*" element={renderRoute(<NotFound />)} />
            </Routes>
          </main>
        </Layout>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
