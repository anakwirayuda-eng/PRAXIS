/**
 * MedCase Pro — Dashboard Page
 * Hero stats, quick-start actions, category progress, recent activity
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../data/store';
import { CATEGORIES, useCaseBank } from '../data/caseLoader';
import { getCaseRouteId } from '../data/caseIdentity';
import Play from 'lucide-react/dist/esm/icons/play';
import Shuffle from 'lucide-react/dist/esm/icons/shuffle';
import Clock from 'lucide-react/dist/esm/icons/clock';
import BookOpen from 'lucide-react/dist/esm/icons/book-open';
import Target from 'lucide-react/dist/esm/icons/target';
import TrendingUp from 'lucide-react/dist/esm/icons/trending-up';
import ArrowRight from 'lucide-react/dist/esm/icons/arrow-right';
import Zap from 'lucide-react/dist/esm/icons/zap';
import Award from 'lucide-react/dist/esm/icons/award';
import Brain from 'lucide-react/dist/esm/icons/brain';
import Stethoscope from 'lucide-react/dist/esm/icons/stethoscope';
import BarChart3 from 'lucide-react/dist/esm/icons/bar-chart-3';
import ShieldCheck from 'lucide-react/dist/esm/icons/shield-check';

function ProgressRing({ value, size = 80, stroke = 6, color = 'var(--accent-primary)' }) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (value / 100) * circumference;

  return (
    <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="rgba(148,163,184,0.1)" strokeWidth={stroke} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={color}
        strokeWidth={stroke}
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        style={{ transition: 'stroke-dashoffset 1s cubic-bezier(0.16, 1, 0.3, 1)' }}
      />
    </svg>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const { totalAnswered, streak, completedCases, getAccuracy, categoryScores } = useStore();
  const { cases: caseBank, totalCases, handCraftedCount, status, isLoading } = useCaseBank();
  const [isCompactMobile, setIsCompactMobile] = useState(() => typeof window !== 'undefined' ? window.innerWidth <= 480 : false);
  const accuracy = getAccuracy();
  const totalCasesLabel = totalCases.toLocaleString();
  const isColdStart = totalAnswered === 0 && completedCases.length === 0;

  useEffect(() => {
    const handleResize = () => setIsCompactMobile(window.innerWidth <= 480);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // 🚀 O(N) Category Stats — single pass replaces O(N³) inner loop
  const categoryStats = useMemo(() => {
    const stats = {};
    Object.keys(CATEGORIES).forEach(k => stats[k] = { total: 0, completed: 0 });
    const completedSet = new Set(completedCases);
    for (let i = 0; i < caseBank.length; i++) {
      const c = caseBank[i];
      if (c.category && stats[c.category]) {
        stats[c.category].total++;
        if (completedSet.has(c._id || c.id)) stats[c.category].completed++;
      }
    }
    return stats;
  }, [caseBank, completedCases]);

  const startRandomCase = () => {
    const completedSet = new Set(completedCases);
    const qualityPool = caseBank.filter(c => !c.meta?.quarantined && !c.meta?.needs_review && !c.meta?.truncated);
    const unseenPool = qualityPool.filter(c => !completedSet.has(c._id || c.id));
    const pool = unseenPool.length > 0 ? unseenPool : qualityPool;
    if (pool.length === 0) return;
    const caseData = pool[Math.floor(Math.random() * pool.length)];
    navigate(`/case/${encodeURIComponent(getCaseRouteId(caseData))}`);
  };

  // 🎰 SCT Roulette — random unseen SCT case, not always the first one
  const openSctPractice = () => {
    const completedSet = new Set(completedCases);
    const sctPool = caseBank.filter(c =>
      c.q_type === 'SCT' &&
      (c.meta?.examType === 'UKMPPD' || c.meta?.examType === 'BOTH') &&
      !c.meta?.quarantined && !c.meta?.needs_review && !c.meta?.truncated &&
      !completedSet.has(c._id || c.id)
    );
    if (sctPool.length > 0) {
      const pick = sctPool[Math.floor(Math.random() * sctPool.length)];
      navigate(`/case/${encodeURIComponent(getCaseRouteId(pick))}`);
    } else {
      navigate('/cases?type=SCT&exam=UKMPPD');
    }
  };

  // 🧠 SCT-specific stats for the dedicated SCT Command Center
  const sctStats = useMemo(() => {
    const completedSet = new Set(completedCases);
    const sctCases = caseBank.filter(c => c.q_type === 'SCT' && !c.meta?.quarantined && !c.meta?.needs_review && !c.meta?.truncated);
    const sctCompleted = sctCases.filter(c => completedSet.has(c._id || c.id)).length;
    return { total: sctCases.length, completed: sctCompleted };
  }, [caseBank, completedCases]);

  const dataQuality = useMemo(() => {
    let needsReview = 0;
    let truncated = 0;
    let quarantined = 0;
    let aiAudited = 0;

    for (const caseData of caseBank) {
      if (caseData.meta?.quarantined === true) quarantined++;
      if (caseData.meta?.needs_review === true) needsReview++;
      if (caseData.meta?.truncated === true) truncated++;
      if (caseData.meta?.ai_audited === true) aiAudited++;
    }

    return {
      total: caseBank.length,
      clean: caseBank.length - quarantined - needsReview,
      quarantined,
      needsReview,
      truncated,
      aiAudited,
    };
  }, [caseBank]);

  const stats = [
    { label: 'Cases Completed', value: completedCases.length, icon: BookOpen, color: 'var(--accent-primary)' },
    { label: 'Questions Answered', value: totalAnswered, icon: Target, color: 'var(--accent-info)' },
    { label: 'Accuracy', value: `${accuracy}%`, icon: TrendingUp, color: 'var(--accent-success)' },
    { label: 'Study Streak', value: `${streak}d`, icon: Zap, color: 'var(--accent-warning)' },
  ];

  const [isBannerDismissed, setIsBannerDismissed] = useState(() => {
    if (typeof window === 'undefined') return true;
    return !!localStorage.getItem('praxis_banner_q1_dismissed');
  });

  return (
    <div>
      {/* Clinical Calibration Banner — Q1 2026 Data Harmonization (Sunset: 7 days) */}
      {(() => {
        const isExpired = Date.now() > new Date('2026-03-26T23:59:59+07:00').getTime();
        if (isBannerDismissed || isExpired) return null;
        return (
          <div style={{
            position: 'relative',
            background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)',
            padding: 'var(--sp-5)', borderRadius: 'var(--radius-xl)',
            display: 'flex', alignItems: 'flex-start', gap: 'var(--sp-4)',
            marginBottom: 'var(--sp-6)', boxShadow: '0 4px 24px rgba(16,185,129,0.05)',
          }}>
            <button
              onClick={() => { localStorage.setItem('praxis_banner_q1_dismissed', 'true'); setIsBannerDismissed(true); }}
              style={{
                position: 'absolute', top: 12, right: 12, background: 'none', border: 'none',
                color: 'rgba(52,211,153,0.4)', cursor: 'pointer', padding: 4, borderRadius: 'var(--radius-sm)',
                fontSize: 18, lineHeight: 1,
              }}
              title="Dismiss"
            >×</button>
            <div style={{
              background: 'rgba(16,185,129,0.15)', padding: '10px', borderRadius: 'var(--radius-lg)',
              color: '#34d399', flexShrink: 0, marginTop: 2,
            }}>
              <ShieldCheck size={22} strokeWidth={2.5} />
            </div>
            <div style={{ paddingRight: 24 }}>
              <h4 style={{
                color: '#34d399', fontWeight: 700, fontSize: 'var(--fs-xs)',
                textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6,
                display: 'flex', alignItems: 'center', gap: 8,
              }}>
                Q1 2026 Clinical Alignment Update
                <span style={{
                  background: 'rgba(16,185,129,0.2)', color: '#6ee7b7',
                  padding: '2px 8px', borderRadius: 4, fontSize: '10px', fontWeight: 800,
                }}>COMPLETED</span>
              </h4>
              <p style={{ color: 'var(--text-secondary)', fontSize: 'var(--fs-sm)', lineHeight: 1.7, maxWidth: 640 }}>
                Medical Board PRAXIS telah merampungkan kalibrasi <strong style={{ color: 'var(--text-primary)' }}>28.814 kasus klinis</strong> (AIIMS/NEET Standards)
                untuk memastikan keselarasan absolut dengan pedoman tatalaksana terbaru.
                <br />
                <span style={{ color: 'rgba(52,211,153,0.8)', fontWeight: 500, display: 'inline-block', marginTop: 8, fontSize: 'var(--fs-xs)' }}>
                  ⚙️ Algoritma FSRS telah di-reset otomatis pada kasus yang terkoreksi (Amnesia Protocol).
                </span>
              </p>
            </div>
          </div>
        );
      })()}

      {/* Cold Start Onboarding — shown when user has zero activity */}
      {isColdStart && (
        <div style={{
          position: 'relative',
          minHeight: isCompactMobile ? 'auto' : '40vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 'var(--sp-8)',
        }}>
          {/* Blurred placeholder dashboard behind */}
          <div style={{
            position: 'absolute', inset: 0, opacity: 0.15,
            filter: 'blur(8px) grayscale(1)', pointerEvents: 'none', userSelect: 'none',
          }}>
            <div style={{ width: '100%', height: 160, background: 'rgba(30,41,59,0.8)', borderRadius: 'var(--radius-xl)', marginBottom: 'var(--sp-4)' }} />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--sp-4)' }}>
              <div style={{ height: 100, background: 'rgba(30,41,59,0.8)', borderRadius: 'var(--radius-xl)' }} />
              <div style={{ height: 100, background: 'rgba(30,41,59,0.8)', borderRadius: 'var(--radius-xl)' }} />
            </div>
          </div>

          {/* Mission Card */}
          <div className="glass-card" style={{
            position: 'relative', zIndex: 10, maxWidth: 420, padding: isCompactMobile ? 'var(--sp-6) var(--sp-4)' : 'var(--sp-8) var(--sp-6)',
            textAlign: 'center', border: '1px solid rgba(99,102,241,0.3)',
            boxShadow: '0 0 80px rgba(99,102,241,0.1)',
          }}>
            <div style={{
              width: 72, height: 72, borderRadius: 'var(--radius-full)',
              background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              margin: '0 auto var(--sp-5)',
              boxShadow: '0 8px 32px rgba(99,102,241,0.3)',
            }}>
              <Target size={32} style={{ color: '#fff' }} />
            </div>
            <h2 style={{ fontSize: 'var(--fs-2xl)', fontFamily: 'var(--font-heading)', marginBottom: 'var(--sp-3)' }}>
              Kalibrasi FSRS
            </h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: 'var(--fs-sm)', marginBottom: 'var(--sp-6)', lineHeight: 1.7 }}>
              Sistem <strong style={{ color: 'var(--accent-primary)' }}>Spaced Repetition</strong> belum memiliki data baseline klinis Anda.
              Selesaikan 10 kasus pertama agar kami dapat meracik jadwal belajar optimal.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
              <button className="btn btn-primary btn-lg" onClick={startRandomCase} style={{ width: '100%' }}>
                <Play size={18} /> Mulai Diagnostic Test
              </button>
              <button className="btn btn-ghost btn-lg" onClick={() => navigate('/cases')} style={{ width: '100%' }}>
                <BookOpen size={18} /> Jelajahi Library Dulu
              </button>
            </div>
            <p style={{ marginTop: 'var(--sp-3)', fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>
              {status === 'ready' ? `${totalCasesLabel} kasus tersedia` : 'Memuat bank soal...'}
            </p>
          </div>
        </div>
      )}
      {!isColdStart && (
        <div className="glass-card" style={{ padding: isCompactMobile ? 'var(--sp-6) var(--sp-4)' : 'var(--sp-8)', marginBottom: 'var(--sp-8)', overflow: 'visible' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 'var(--sp-6)' }}>
            <div style={{ flex: 1, minWidth: isCompactMobile ? 0 : 280 }}>
              <div className="badge badge-primary" style={{ marginBottom: 'var(--sp-3)' }}>
                <Stethoscope size={12} /> UKMPPD & USMLE
              </div>
              <h1 style={{ fontSize: 'var(--fs-4xl)', fontFamily: 'var(--font-heading)', marginBottom: 'var(--sp-3)', lineHeight: 1.1 }}>
                Master Clinical
                <br />
                <span style={{ background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                  Reasoning
                </span>
               </h1>
               <p style={{ color: 'var(--text-secondary)', maxWidth: 420, marginBottom: 'var(--sp-6)' }}>
                 Practice with {status === 'ready' ? `${dataQuality.clean.toLocaleString()}+ verified cases` : 'a fast-loading case library'}, SCT drills, and intelligent analytics.
                 Your path to passing UKMPPD & USMLE starts here.
               </p>
               <div style={{ display: 'flex', gap: isCompactMobile ? 'var(--sp-2)' : 'var(--sp-3)', flexWrap: 'wrap', width: '100%', maxWidth: 560 }}>
                <button className="btn btn-primary btn-lg" onClick={startRandomCase} style={{ flex: `1 1 ${isCompactMobile ? 140 : 170}px`, justifyContent: 'center' }}>
                  <Shuffle size={18} /> Random Case
                </button>
                 <button className="btn btn-ghost btn-lg" data-testid="dashboard-browse-cases" onClick={() => navigate('/cases')} style={{ flex: `1 1 ${isCompactMobile ? 140 : 170}px`, justifyContent: 'center' }}>
                   <BookOpen size={18} /> Browse Cases
                 </button>
                 <button className="btn btn-ghost btn-lg" onClick={() => navigate('/exam')} style={{ flex: `1 1 ${isCompactMobile ? 140 : 170}px`, justifyContent: 'center' }}>
                   <Clock size={18} /> Exam Mode
                 </button>
               </div>
               {status !== 'ready' && (
                 <p style={{ marginTop: 'var(--sp-4)', fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>
                   {isLoading
                     ? `Loading the full case library in the background. ${totalCasesLabel} starter cases are ready now.`
                     : `Showing ${totalCasesLabel} starter cases. The compiled library is unavailable right now.`}
                 </p>
               )}
             </div>
            <div style={{ position: 'relative' }}>
              <ProgressRing value={accuracy} size={160} stroke={10} />
              <div style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
              }}>
                <span style={{ fontSize: 'var(--fs-3xl)', fontWeight: 800, fontFamily: 'var(--font-heading)' }}>{accuracy}%</span>
                <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>Accuracy</span>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-4 stagger" style={{ marginBottom: 'var(--sp-8)' }}>
        {stats.map((stat) => (
          <div key={stat.label} className="glass-card" style={{ padding: 'var(--sp-5)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--sp-3)' }}>
              <div style={{
                width: 40,
                height: 40,
                borderRadius: 'var(--radius-md)',
                background: `${stat.color}15`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}>
                <stat.icon size={20} style={{ color: stat.color }} />
              </div>
            </div>
            <div className="stat-value" style={{ marginBottom: 'var(--sp-1)', fontSize: 'var(--fs-2xl)' }}>{stat.value}</div>
            <div className="stat-label">{stat.label}</div>
          </div>
        ))}
      </div>

      {/* Data Quality Bar */}
      <div className="glass-card" style={{ padding: 'var(--sp-4) var(--sp-5)', marginBottom: 'var(--sp-8)', display: 'flex', alignItems: 'center', gap: 'var(--sp-4)', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>📊 Data Quality</span>
        <div style={{ flex: 1, minWidth: 200, height: 8, borderRadius: 4, background: 'rgba(148,163,184,0.1)', overflow: 'hidden', display: 'flex' }}>
          <div style={{ width: `${(dataQuality.clean / dataQuality.total * 100)}%`, background: 'var(--accent-success)', transition: 'width 1s ease' }} />
          <div style={{ width: `${(dataQuality.truncated / dataQuality.total * 100)}%`, background: 'var(--accent-warning)', transition: 'width 1s ease' }} />
          <div style={{ width: `${(dataQuality.needsReview / dataQuality.total * 100)}%`, background: '#f97316', transition: 'width 1s ease' }} />
          <div style={{ width: `${(dataQuality.quarantined / dataQuality.total * 100)}%`, background: 'var(--accent-danger)', transition: 'width 1s ease' }} />
        </div>
        <div style={{ display: 'flex', gap: 'var(--sp-4)', fontSize: 'var(--fs-xs)', flexWrap: 'wrap' }}>
          <span style={{ color: 'var(--accent-success)' }}>✅ {dataQuality.clean.toLocaleString()} Clean</span>
          {dataQuality.truncated > 0 && <span style={{ color: 'var(--accent-warning)' }}>📝 {dataQuality.truncated.toLocaleString()} Truncated</span>}
          {dataQuality.needsReview > 0 && <span style={{ color: '#f97316' }}>⚠️ {dataQuality.needsReview.toLocaleString()} Review</span>}
          {dataQuality.quarantined > 0 && <span style={{ color: 'var(--accent-danger)' }}>🚫 {dataQuality.quarantined.toLocaleString()} Quarantined</span>}
        </div>
      </div>

      <div
        className="glass-card"
        style={{
          padding: 'var(--sp-6)',
          marginBottom: 'var(--sp-8)',
          background: 'linear-gradient(135deg, rgba(16,185,129,0.08) 0%, rgba(56,189,248,0.06) 50%, rgba(245,158,11,0.06) 100%)',
          border: '1px solid rgba(56,189,248,0.18)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 'var(--sp-4)' }}>
          <div style={{ minWidth: 220 }}>
            <div className="badge badge-info" style={{ marginBottom: 'var(--sp-3)' }}>
              <BarChart3 size={12} /> Data Quality
            </div>
            <h2 style={{ fontSize: 'var(--fs-xl)', marginBottom: 'var(--sp-2)' }}>Library Health</h2>
            <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)', maxWidth: 420 }}>
              Live quality counts from the compiled case library. Truncated cases can overlap with the clean or review buckets.
            </p>
          </div>

          <div style={{ display: 'flex', gap: 'var(--sp-3)', flexWrap: 'wrap' }}>
            {[
              { label: 'Clean', value: dataQuality.clean, accent: '#22c55e', icon: '✅' },
              { label: 'Needs Review', value: dataQuality.needsReview, accent: '#f59e0b', icon: '⚠️' },
              { label: 'Truncated', value: dataQuality.truncated, accent: '#38bdf8', icon: '📝' },
            ].map((item) => (
              <div
                key={item.label}
                style={{
                  minWidth: 170,
                  padding: 'var(--sp-4)',
                  borderRadius: 'var(--radius-lg)',
                  background: 'rgba(15,23,42,0.24)',
                  border: `1px solid ${item.accent}33`,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', marginBottom: 'var(--sp-2)' }}>
                  <span aria-hidden="true" style={{ fontSize: '1rem' }}>{item.icon}</span>
                  <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                    {item.label}
                  </span>
                </div>
                <div style={{ fontSize: 'var(--fs-2xl)', fontWeight: 800, color: item.accent }}>
                  {item.value.toLocaleString()}
                </div>
              </div>
            ))}
          </div>
        </div>

        {status !== 'ready' && (
          <p style={{ marginTop: 'var(--sp-4)', fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>
            Quality totals expand automatically while the full compiled library finishes loading.
          </p>
        )}
        {status === 'ready' && (
          <p style={{ marginTop: 'var(--sp-4)', fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>
            Based on {dataQuality.total.toLocaleString()} compiled cases.
          </p>
        )}
      </div>

      <h2 style={{ fontSize: 'var(--fs-xl)', marginBottom: 'var(--sp-4)' }}>
        <Brain size={20} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 'var(--sp-2)' }} />
        Category Progress
      </h2>
      <div className="grid grid-2 stagger" style={{ marginBottom: 'var(--sp-8)' }}>
        {Object.entries(CATEGORIES).map(([key, cat]) => {
          const { total, completed } = categoryStats[key] || { total: 0, completed: 0 };
          const catAccuracy = categoryScores[key]
            ? Math.round((categoryScores[key].correct / categoryScores[key].total) * 100) || 0
            : 0;
          const progress = total > 0 ? Math.round((completed / total) * 100) : 0;

          return (
            <button
              key={key}
              type="button"
              className="glass-card glass-card-interactive"
              onClick={() => navigate(`/cases?category=${encodeURIComponent(key)}`)}
              style={{ padding: 'var(--sp-5)', cursor: 'pointer', textAlign: 'left', border: 'var(--border-glass)' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--sp-3)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)' }}>
                  <div style={{ width: 10, height: 10, borderRadius: 'var(--radius-full)', background: cat.color }} />
                  <span style={{ fontWeight: 600, fontSize: 'var(--fs-sm)' }}>{cat.label}</span>
                  {cat.labelEn && <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>({cat.labelEn})</span>}
                </div>
                <ArrowRight size={14} style={{ color: 'var(--text-muted)' }} />
              </div>
              <div className="progress-bar" style={{ marginBottom: 'var(--sp-2)' }}>
                <div className="progress-bar-fill" style={{ width: `${progress}%`, background: cat.color }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>
                <span>{completed}/{total} cases</span>
                <span>Accuracy: {catAccuracy}%</span>
              </div>
            </button>
          );
        })}
      </div>

      {/* 🧠 SCT COMMAND CENTER — Prominent hero section for the new UKMPPD format */}
      <div className="glass-card" style={{
        padding: 'var(--sp-6)',
        marginBottom: 'var(--sp-6)',
        background: 'linear-gradient(135deg, rgba(168,85,247,0.08) 0%, rgba(99,102,241,0.06) 50%, rgba(56,189,248,0.05) 100%)',
        border: '1px solid rgba(168,85,247,0.2)',
        position: 'relative',
        overflow: 'hidden',
      }}>
        {/* Decorative glow */}
        <div style={{
          position: 'absolute', top: -60, right: -60,
          width: 200, height: 200, borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(168,85,247,0.15) 0%, transparent 70%)',
          pointerEvents: 'none',
        }} />

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 'var(--sp-5)' }}>
          <div style={{ flex: 1, minWidth: 280 }}>
            {/* Badge */}
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '4px 12px', borderRadius: 'var(--radius-full)',
              background: 'rgba(168,85,247,0.15)',
              color: '#c084fc',
              fontSize: 'var(--fs-xs)', fontWeight: 700,
              letterSpacing: '0.05em',
              marginBottom: 'var(--sp-3)',
            }}>
              <Award size={12} /> ANGKATAN PERTAMA • FORMAT BARU UKMPPD
            </div>

            <h2 style={{
              fontSize: 'var(--fs-2xl)',
              fontFamily: 'var(--font-heading)',
              marginBottom: 'var(--sp-2)',
              lineHeight: 1.2,
            }}>
              Script Concordance Test
              <span style={{
                display: 'block',
                fontSize: 'var(--fs-base)',
                fontWeight: 400,
                color: 'var(--text-secondary)',
                marginTop: 4,
              }}>
                Latihan penalaran klinis berbasis panel pakar
              </span>
            </h2>

            <p style={{
              color: 'var(--text-muted)',
              fontSize: 'var(--fs-sm)',
              marginBottom: 'var(--sp-4)',
              maxWidth: 440,
              lineHeight: 1.6,
            }}>
              Format SCT menguji kemampuan berpikir saat menghadapi ketidakpastian klinis —
              persis seperti dokter sungguhan. Berbeda dari MCQ, tidak ada yang 100% benar atau salah.
            </p>

            {/* Quick Stats Row */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 'var(--sp-4)', marginBottom: 'var(--sp-4)' }}>
              <div>
                <div style={{ fontSize: 'var(--fs-2xl)', fontWeight: 800, color: '#c084fc' }}>
                  {sctStats.total.toLocaleString()}
                </div>
                <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>Playable SCT</div>
              </div>
              <div>
                <div style={{ fontSize: 'var(--fs-2xl)', fontWeight: 800, color: 'var(--text-muted)' }}>
                  —
                </div>
                <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>Session-only</div>
              </div>
            </div>
            <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', marginBottom: 'var(--sp-3)' }}>
              SCT Arena menggunakan concordance scoring dan tidak mencatat progress permanen.
            </div>

            {/* Action Buttons */}
            <div style={{ display: 'flex', gap: 'var(--sp-3)', flexWrap: 'wrap' }}>
              <button
                className="btn btn-lg"
                onClick={openSctPractice}
                style={{
                  background: 'linear-gradient(135deg, #a855f7, #6366f1)',
                  color: '#fff',
                  border: 'none',
                  fontWeight: 600,
                  boxShadow: '0 4px 20px rgba(168,85,247,0.3)',
                }}
              >
                <Play size={16} /> Mulai Latihan SCT
              </button>
              <button
                className="btn btn-ghost btn-lg"
                onClick={() => navigate('/cases?type=SCT')}
                style={{ borderColor: 'rgba(168,85,247,0.3)', color: '#c084fc' }}
              >
                <BookOpen size={16} /> Lihat Semua SCT
              </button>
            </div>
          </div>

            {/* SCT readiness ring — SCT progress is not persisted */}
            <div style={{ position: 'relative', flexShrink: 0 }}>
              <ProgressRing
                value={sctStats.total > 0 ? 100 : 0}
              size={130}
              stroke={8}
              color="#a855f7"
            />
            <div style={{
              position: 'absolute', inset: 0,
              display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center',
              }}>
              <span style={{ fontSize: 'var(--fs-xl)', fontWeight: 800, color: '#c084fc' }}>
                {sctStats.total > 0 ? 'LIVE' : 'LOCK'}
              </span>
              <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 600 }}>SCT READY</span>
            </div>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 'var(--sp-4)', flexWrap: 'wrap' }}>
        <div className="glass-card" style={{ flex: 1, minWidth: 260, padding: 'var(--sp-6)' }}>
          <Target size={24} style={{ color: 'var(--accent-info)', marginBottom: 'var(--sp-3)' }} />
          <h3 style={{ fontSize: 'var(--fs-lg)', marginBottom: 'var(--sp-2)' }}>Weak Areas</h3>
          <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)', marginBottom: 'var(--sp-4)' }}>
            {totalAnswered > 0
              ? 'Focus on categories where your accuracy is below 70%.'
              : 'Start answering cases to discover your weak areas.'}
          </p>
          <button className="btn btn-ghost" onClick={() => navigate('/analytics')}>
            <BarChart3 size={14} /> View Analytics
          </button>
        </div>
      </div>
    </div>
  );
}
