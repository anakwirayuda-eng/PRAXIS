/**
 * PRAXIS — Cognitive Simulator Layout
 * Engineered for Zero-Fatigue & Flow State
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { motion as Motion, AnimatePresence } from 'framer-motion';
import { useStore } from '../data/store';
import { hasVerifiedAdminSession } from '../lib/adminSession';
import { useRuntimeWatchdog } from '../lib/runtimeWatchdog';
import {
  LayoutDashboard, BookOpen, BarChart3, Clock, Bookmark,
  Settings, Menu, Zap, Trophy, RotateCcw, Dices, Shield, Bug, Eye, Search, Command, Brain, Moon, Monitor
} from 'lucide-react';

const THEMES = [
  { id: 'surgical-slate', label: '🌙 Surgical Slate', desc: 'Optimal Dark' },
  { id: 'textbook-sepia', label: '📜 Textbook Sepia', desc: 'Zero-Fatigue' },
  { id: 'prometric', label: '🏢 Prometric', desc: 'CBT Authentic' },
];

const THEME_ICONS = {
  'surgical-slate': Moon,
  'textbook-sepia': BookOpen,
  prometric: Monitor,
};

const baseNavItems = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/cases', icon: BookOpen, label: 'Case Browser' },
  { to: '/review', icon: RotateCcw, label: 'Spaced Review', badge: 'FSRS' },
  { to: '/exam', icon: Clock, label: 'Exam Mode' },
  { to: '/blitz', icon: Zap, label: 'MedBlitz' },
  { to: '/sct', icon: Brain, label: 'SCT Arena', badge: 'PRO' },
  { to: '/predict', icon: Dices, label: 'Pass Predictor', badge: 'NEW' },
  { to: '/analytics', icon: BarChart3, label: 'Analytics' },
  { to: '/quality', icon: Shield, label: 'Data Quality' },
];

export default function Layout({ children }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsButtonRef = useRef(null);
  const settingsPopoverRef = useRef(null);
  const lastNonPrometricThemeRef = useRef(0);
  const [settingsPopoverStyle, setSettingsPopoverStyle] = useState(null);
  const { count: runtimeIssueCount } = useRuntimeWatchdog();

  const {
    sidebarOpen, setSidebarOpen, toggleSidebar, toggleTimer, timerEnabled,
    getAccuracy, streak, totalAnswered, completedCases, bookmarks,
  } = useStore();

  const accuracy = getAccuracy();

  // Reactive Mobile Detection (via matchMedia, not noisy resize events)
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(max-width: 768px)').matches;
  });
  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 768px)');
    const handleChange = (event) => setIsMobile(event.matches);
    setIsMobile(mediaQuery.matches);
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  // ═══════════════════════════════════════════
  // 👁️ CLINICAL THEME ENGINE + CINEMATIC MORPHING
  // ═══════════════════════════════════════════
  const [themeIndex, setThemeIndex] = useState(() => {
    try {
      const saved = localStorage.getItem('praxis_theme');
      const idx = THEMES.findIndex(t => t.id === saved);
      return idx >= 0 ? idx : 0;
    } catch { return 0; }
  });

  const isPrometric = THEMES[themeIndex].id === 'prometric';
  const CurrentThemeIcon = THEME_ICONS[THEMES[themeIndex].id] ?? Eye;

  useEffect(() => {
    if (!isPrometric) {
      lastNonPrometricThemeRef.current = themeIndex;
    }
  }, [isPrometric, themeIndex]);

  const applyThemeToDOM = useCallback((idx) => {
    const theme = THEMES[idx];
    document.documentElement.setAttribute('data-theme', theme.id === 'surgical-slate' ? '' : theme.id);
    document.body.classList.remove('theme-cbt'); // Clean up legacy class
    try { localStorage.setItem('praxis_theme', theme.id); } catch {}
  }, []);

  const changeThemeSmoothly = useCallback((newIdx) => {
    setThemeIndex(newIdx);
    // Cinematic View Transitions (Anti-Flashbang)
    if (document.startViewTransition) {
      document.startViewTransition(() => applyThemeToDOM(newIdx));
    } else {
      applyThemeToDOM(newIdx);
    }
  }, [applyThemeToDOM]);

  const cycleTheme = useCallback(() => {
    changeThemeSmoothly((themeIndex + 1) % THEMES.length);
  }, [themeIndex, changeThemeSmoothly]);

  useEffect(() => {
    applyThemeToDOM(themeIndex);

    const handleGlobalKeys = (e) => {
      if (e.altKey && e.key.toLowerCase() === 't') {
        e.preventDefault();
        cycleTheme();
      }
    };
    window.addEventListener('keydown', handleGlobalKeys);
    return () => window.removeEventListener('keydown', handleGlobalKeys);
  }, [themeIndex, cycleTheme, applyThemeToDOM]);

  // Scroll-Bleed Guillotine — lock background scroll when mobile sidebar open
  useEffect(() => {
    if (isMobile && sidebarOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [isMobile, sidebarOpen]);

  // Close sidebar on mobile navigation
  useEffect(() => {
    if (isMobile && sidebarOpen) setSidebarOpen(false);
  }, [location.pathname]);

  // Click outside settings
  useEffect(() => {
    if (!settingsOpen) return;
    const handlePointerDown = (e) => {
      const clickedButton = settingsButtonRef.current?.contains(e.target);
      const clickedPopover = settingsPopoverRef.current?.contains(e.target);
      if (!clickedButton && !clickedPopover) setSettingsOpen(false);
    };
    const handleKeyDown = (e) => { if (e.key === 'Escape') setSettingsOpen(false); };
    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => { window.removeEventListener('pointerdown', handlePointerDown); window.removeEventListener('keydown', handleKeyDown); };
  }, [settingsOpen]);

  useEffect(() => {
    if (!settingsOpen) return undefined;

    const updatePopoverPosition = () => {
      const button = settingsButtonRef.current;
      if (!button) return;

      const rect = button.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const rightGap = Math.max(12, viewportWidth - rect.right);
      const top = rect.bottom + 10;

      setSettingsPopoverStyle({
        position: 'fixed',
        top: `${top}px`,
        right: `${rightGap}px`,
        left: 'auto',
        minWidth: isMobile ? '200px' : '220px',
        maxWidth: 'calc(100vw - 24px)',
        zIndex: 400,
      });
    };

    updatePopoverPosition();
    window.addEventListener('resize', updatePopoverPosition);
    window.addEventListener('scroll', updatePopoverPosition, true);
    return () => {
      window.removeEventListener('resize', updatePopoverPosition);
      window.removeEventListener('scroll', updatePopoverPosition, true);
    };
  }, [isMobile, settingsOpen]);

  const isAdmin = hasVerifiedAdminSession();
  const openHeaderSearch = () => {
    if (location.pathname === '/cases') {
      window.dispatchEvent(new Event('praxis:focus-case-search'));
      return;
    }
    navigate('/cases', { state: { focusSearch: true } });
  };

  const runtimeIssueBadge = runtimeIssueCount > 99 ? '99+' : String(runtimeIssueCount);
  const navItems = [
    ...baseNavItems.filter(item => isAdmin || item.label !== 'Data Quality'),
    ...(isAdmin ? [{ to: '/watchdog', icon: Bug, label: 'Watchdog', badge: runtimeIssueCount > 0 ? runtimeIssueBadge : null }] : [])
  ];

  return (
    <div className="app-layout">
      {sidebarOpen && isMobile && (
        <button type="button" className="sidebar-backdrop" aria-label="Close nav" onClick={() => setSidebarOpen(false)} />
      )}

      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="sidebar-header">
          <div className="sidebar-brand" style={{ cursor: 'pointer' }} onClick={() => navigate('/')}>
            <div className="sidebar-brand-icon">
              <img src={`${import.meta.env.BASE_URL}praxis-logo.png`} alt="PRAXIS" style={{ width: 28, height: 28, borderRadius: 6 }} />
            </div>
            <div className="sidebar-brand-text">
              <h1 style={{ letterSpacing: '0.05em' }}>PRAXIS</h1>
              <p>Clinical Case Simulator</p>
            </div>
          </div>
        </div>

        <nav className="sidebar-nav">
          <span className="sidebar-section-label">Navigation</span>
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
              end={item.to === '/'}
              onClick={() => { setSettingsOpen(false); if (isMobile) setSidebarOpen(false); }}
            >
              <item.icon size={18} />
              <span>{item.label}</span>
              {item.badge && (
                <span className="nav-link-badge" style={item.badge === 'FSRS' ? { background: 'var(--accent-primary)' } : {}}>
                  {item.badge}
                </span>
              )}
            </NavLink>
          ))}

          {/* Hide Quick Stats in Prometric mode for authenticity */}
          {!isPrometric && (
            <>
              <span className="sidebar-section-label" style={{ marginTop: 'var(--sp-4)' }}>Quick Stats</span>
              <div className="glass-card" style={{ padding: 'var(--sp-4)', margin: 'var(--sp-2) 0', background: 'var(--accent-primary-glow)', border: '1px solid var(--border-glass)' }}>
                <div style={{ display: 'flex', alignItems: 'center', marginBottom: '8px' }}>
                  <Zap size={14} style={{ color: 'var(--accent-warning)', marginRight: 8 }} />
                  <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>Streak</span>
                  <span style={{ marginLeft: 'auto', fontWeight: 700, color: 'var(--accent-warning)' }}>{streak > 0 ? `${streak} day${streak > 1 ? 's' : ''}` : '0 days'}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', marginBottom: '8px' }}>
                  <Trophy size={14} style={{ color: 'var(--accent-success)', marginRight: 8 }} />
                  <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>Accuracy</span>
                  <span style={{ marginLeft: 'auto', fontWeight: 700, color: 'var(--accent-success)' }}>{accuracy}%</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <BookOpen size={14} style={{ color: 'var(--accent-info)', marginRight: 8 }} />
                  <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>Answered</span>
                  <span style={{ marginLeft: 'auto', fontWeight: 700, color: 'var(--accent-info)' }}>{totalAnswered}</span>
                </div>
              </div>
            </>
          )}
        </nav>

        <div className="sidebar-footer">
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', opacity: 0.8 }}>
            <div style={{
              width: 32, height: 32, borderRadius: 'var(--radius-full)',
              background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 'var(--fs-sm)', fontWeight: 700, color: 'white',
            }}>M</div>
            <div>
              <div style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, lineHeight: 1.2 }}>Medical Student</div>
              <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>{completedCases.length} cases completed</div>
            </div>
          </div>
          {/* Institutional Credit */}
          <div style={{ marginTop: 'var(--sp-4)', paddingTop: 'var(--sp-3)', borderTop: '1px solid rgba(148,163,184,0.08)', textAlign: 'center' }}>
            <div style={{ fontSize: '10px', color: 'var(--text-muted)', lineHeight: 1.5 }}>
              <div style={{ fontWeight: 600, letterSpacing: '0.03em' }}>Institut Teknologi Sepuluh Nopember</div>
              <div style={{ marginTop: 2 }}>© {new Date().getFullYear()} Anak Agung Bagus Wirayuda, MD PhD</div>
            </div>
          </div>
        </div>
      </aside>

      <main className={`main-content ${sidebarOpen && !isMobile ? 'sidebar-visible' : 'sidebar-hidden'}`}>
        <header className="header">
          <div className="header-left" style={{ display: 'flex', gap: 'var(--sp-4)', alignItems: 'center' }}>
            <button className="btn btn-icon btn-ghost header-menu-btn" onClick={toggleSidebar} aria-label="Toggle navigation">
              <Menu size={18} />
            </button>

            {/* OMNI-COMMAND SEED — Ghost Trigger (Ctrl+K) */}
            {!isMobile && (
              <button
                className="btn btn-ghost header-search-trigger"
                style={{
                  width: '260px',
                  justifyContent: 'flex-start',
                }}
                onClick={openHeaderSearch}
                title="Open Case Browser search"
              >
                <Search size={14} style={{ opacity: 0.5 }} />
                <span style={{ fontSize: 'var(--fs-sm)', flex: 1, textAlign: 'left' }}>Search PRAXIS...</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '2px', opacity: 0.5 }}>
                  <Command size={12} /> <span style={{ fontSize: '10px', fontWeight: 'bold', fontFamily: 'var(--font-mono)' }}>K</span>
                </div>
              </button>
            )}
          </div>

          <div className="header-right">
            {isAdmin && runtimeIssueCount > 0 && (
              <button className="btn btn-ghost" style={{ gap: 'var(--sp-2)', color: 'var(--accent-danger)' }} aria-label="View watchdog issues" onClick={() => navigate('/watchdog')}>
                <Bug size={16} />
                <span className="nav-link-badge" style={{ background: 'var(--accent-danger)' }}>{runtimeIssueBadge}</span>
              </button>
            )}

            <button
              className="btn btn-ghost"
              style={{ gap: 'var(--sp-2)', minWidth: 'auto' }}
              onClick={cycleTheme}
              title={`Theme: ${THEMES[themeIndex].label} (Alt+T)`}
              aria-label="Cycle theme"
            >
              <CurrentThemeIcon size={16} />
              {!isMobile && <span style={{ fontSize: 'var(--fs-xs)' }}>{THEMES[themeIndex].desc}</span>}
            </button>

            <button className="btn btn-ghost" style={{ gap: 'var(--sp-2)' }} aria-label="View bookmarks" onClick={() => navigate('/cases?bookmarks=1')}>
              <Bookmark size={16} />
              <span className="nav-link-badge">{bookmarks.length}</span>
            </button>

            <div className="header-controls">
              <button
                ref={settingsButtonRef}
                className={`btn btn-icon ${settingsOpen ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => setSettingsOpen(!settingsOpen)}
                aria-label="Settings"
                aria-expanded={settingsOpen}
                aria-haspopup="menu"
              >
                <Settings size={16} />
              </button>

              {false && settingsOpen && (
                <div className="glass-card header-popover">
                  <button className="btn btn-ghost" style={{ justifyContent: 'flex-start', width: '100%' }} onClick={() => { setSettingsOpen(false); toggleTimer(); }}>
                    <Clock size={16} /> <span>{timerEnabled ? 'Hide HUD Timer' : 'Show HUD Timer'}</span>
                  </button>
                  <button className="btn btn-ghost" style={{ justifyContent: 'flex-start', width: '100%' }} onClick={() => { setSettingsOpen(false); navigate('/review'); }}>
                    <RotateCcw size={16} /> <span>Open FSRS Review</span>
                  </button>

                  <div style={{ width: '100%', height: '1px', background: 'rgba(148, 163, 184, 0.1)', margin: '4px 0' }} />

                  {/* Single Source of Truth — Exam Day Simulator toggle */}
                  <button
                    className="btn btn-ghost"
                    style={{
                      justifyContent: 'flex-start', width: '100%',
                      ...(isPrometric ? { background: 'rgba(239,68,68,0.12)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.3)' } : {})
                    }}
                    onClick={() => { setSettingsOpen(false); changeThemeSmoothly(isPrometric ? lastNonPrometricThemeRef.current : 2); }}
                  >
                    🏥 <span>{isPrometric ? 'Exit CBT Mode' : 'Exam Day Simulator'}</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        {settingsOpen && typeof document !== 'undefined' && createPortal(
          <div
            ref={settingsPopoverRef}
            className="glass-card header-popover"
            style={settingsPopoverStyle ?? undefined}
            role="menu"
            aria-label="Page settings"
          >
            <button role="menuitem" className="btn btn-ghost" style={{ justifyContent: 'flex-start', width: '100%' }} onClick={() => { setSettingsOpen(false); toggleTimer(); }}>
              <Clock size={16} /> <span>{timerEnabled ? 'Hide HUD Timer' : 'Show HUD Timer'}</span>
            </button>
            <button role="menuitem" className="btn btn-ghost" style={{ justifyContent: 'flex-start', width: '100%' }} onClick={() => { setSettingsOpen(false); navigate('/review'); }}>
              <RotateCcw size={16} /> <span>Open FSRS Review</span>
            </button>

            <div style={{ width: '100%', height: '1px', background: 'rgba(148, 163, 184, 0.1)', margin: '4px 0' }} />

            <button
              role="menuitem"
              className="btn btn-ghost"
              style={{
                justifyContent: 'flex-start', width: '100%',
                ...(isPrometric ? { background: 'rgba(239,68,68,0.12)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.3)' } : {})
              }}
              onClick={() => { setSettingsOpen(false); changeThemeSmoothly(isPrometric ? lastNonPrometricThemeRef.current : 2); }}
            >
              <span aria-hidden="true">🏥</span> <span>{isPrometric ? 'Exit CBT Mode' : 'Exam Day Simulator'}</span>
            </button>
          </div>,
          document.body
        )}

        <AnimatePresence mode="wait">
          <Motion.div
            key={location.pathname}
            initial={{ opacity: 0, y: isPrometric ? 0 : 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: isPrometric ? 0 : -8 }}
            transition={{ duration: isPrometric ? 0 : 0.25, ease: [0.16, 1, 0.3, 1] }}
            className="page-content"
          >
            {children}
          </Motion.div>
        </AnimatePresence>
      </main>
    </div>
  );
}
