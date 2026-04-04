/**
 * MedCase Pro — FSRS Review Page (Due Cards)
 * Shows cases due for review based on FSRS retrievability decay
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion as Motion } from 'framer-motion';
import { CATEGORIES, useCaseBank } from '../data/caseLoader';
import { getCaseRouteId } from '../data/caseIdentity';
import { getDueCards, getBrainStats, getCaseState } from '../data/fsrs';
import { useStore } from '../data/store';
import Brain from 'lucide-react/dist/esm/icons/brain';
import RotateCcw from 'lucide-react/dist/esm/icons/rotate-ccw';
import Play from 'lucide-react/dist/esm/icons/play';
import Clock from 'lucide-react/dist/esm/icons/clock';
import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle';
import CheckCircle from 'lucide-react/dist/esm/icons/check-circle';
import Zap from 'lucide-react/dist/esm/icons/zap';
import BookOpen from 'lucide-react/dist/esm/icons/book-open';

function RetentionBar({ value }) {
  const color = value >= 0.9 ? 'var(--accent-success)' : value >= 0.7 ? 'var(--accent-warning)' : 'var(--accent-danger)';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', minWidth: 100 }}>
      <div className="progress-bar" style={{ flex: 1, height: 6 }}>
        <div className="progress-bar-fill" style={{ width: `${value * 100}%`, background: color }} />
      </div>
      <span style={{ fontSize: 'var(--fs-xs)', fontWeight: 600, color, minWidth: 32, textAlign: 'right' }}>
        {Math.round(value * 100)}%
      </span>
    </div>
  );
}

export default function ReviewPage() {
  const navigate = useNavigate();
  const { totalAnswered } = useStore();
  const { cases: caseBank, totalCases, status, isLoading } = useCaseBank();
  const isLibraryReady = status === 'ready';
  const [threshold, setThreshold] = useState(0.9);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const minuteTick = Math.floor(nowMs / 60000);
  const loadedCases = useMemo(() => caseBank.slice(0, totalCases), [caseBank, totalCases]);
  const casesById = useMemo(
    () => new Map(loadedCases.map((caseData) => [caseData._id, caseData])),
    [loadedCases],
  );

  const validIds = useMemo(() => {
    const valid = new Set();
    casesById.forEach((c, id) => {
      if (!c.meta?.quarantined && !c.meta?.truncated && !c.meta?.needs_review) {
        valid.add(id);
      }
    });
    return valid;
  }, [casesById]);

  // Clean stats — immune from quarantined/truncated memory
  const brainStats = useMemo(() => getBrainStats(validIds), [validIds, minuteTick]);

  const dueCards = useMemo(() => {
    return getDueCards(threshold, 50, validIds);
  }, [validIds, threshold, minuteTick]);

  const reviewPlaylist = useMemo(
    () => dueCards
      .map((due) => casesById.get(due.caseId))
      .filter(Boolean)
      .map(getCaseRouteId),
    [casesById, dueCards],
  );

  useEffect(() => {
    let intervalId = null;
    let timeoutId = null;
    const syncClock = () => setNowMs(Date.now());

    syncClock();
    timeoutId = window.setTimeout(() => {
      syncClock();
      intervalId = window.setInterval(syncClock, 60000);
    }, 60000 - (Date.now() % 60000));

    return () => {
      if (timeoutId !== null) window.clearTimeout(timeoutId);
      if (intervalId !== null) window.clearInterval(intervalId);
    };
  }, []);

  const openReviewCase = (caseId) => {
    const targetCase = casesById.get(caseId);
    if (!targetCase) return;

    navigate(`/case/${encodeURIComponent(getCaseRouteId(targetCase))}`, {
      state: {
        playlist: reviewPlaylist,
        returnTo: '/review',
        reviewSession: true,
      },
    });
  };

  const startReviewSession = () => {
    if (dueCards.length > 0) {
      openReviewCase(dueCards[0].caseId);
    }
  };

  const getTimeSinceReview = (caseId) => {
    const state = getCaseState(caseId);
    if (!state || state.lastReview === 0) return 'Never';
    const hours = (nowMs / 1000 - state.lastReview) / 3600;
    if (hours < 1) return `${Math.round(hours * 60)}m ago`;
    if (hours < 24) return `${Math.round(hours)}h ago`;
    return `${Math.round(hours / 24)}d ago`;
  };

  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      <h1 className="page-title" style={{ marginBottom: 'var(--sp-2)' }}>
        <RotateCcw size={28} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 'var(--sp-2)' }} />
        Spaced Review
      </h1>
      <p className="page-subtitle" style={{ marginBottom: 'var(--sp-8)' }}>
        FSRS v5 identifies cases where your memory is fading. Review them before you forget.
      </p>
      {status !== 'ready' && (
        <div className="glass-card" style={{ padding: 'var(--sp-3) var(--sp-4)', marginBottom: 'var(--sp-6)' }}>
          <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>
            {isLoading
              ? 'Loading the full case library in the background. Some due cards may appear progressively.'
              : 'Compiled case library is unavailable. Review is limited to starter cases.'}
          </span>
        </div>
      )}

      {/* Brain Stats */}
      <div className="grid grid-4 stagger" style={{ marginBottom: 'var(--sp-6)' }}>
        {[
          { label: 'Reviewed', value: brainStats.totalReviewed, icon: BookOpen, color: 'var(--accent-primary)' },
          { label: 'Retention', value: `${brainStats.averageRetention}%`, icon: Brain, color: brainStats.averageRetention >= 70 ? 'var(--accent-success)' : 'var(--accent-warning)' },
          { label: 'Due Now', value: dueCards.length, icon: AlertTriangle, color: dueCards.length > 0 ? 'var(--accent-danger)' : 'var(--accent-success)' },
          { label: 'Memory', value: brainStats.memoryStrength, icon: Zap, color: 'var(--accent-info)' },
        ].map((stat, i) => (
          <div key={i} className="glass-card" style={{ padding: 'var(--sp-4)' }}>
            <stat.icon size={18} style={{ color: stat.color, marginBottom: 'var(--sp-2)' }} />
            <div style={{ fontSize: 'var(--fs-xl)', fontWeight: 800 }}>{stat.value}</div>
            <div className="stat-label">{stat.label}</div>
          </div>
        ))}
      </div>

      {/* Controls */}
      <div className="glass-card" style={{ padding: 'var(--sp-4)', marginBottom: 'var(--sp-6)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 'var(--sp-3)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>Retention threshold:</span>
          {[0.95, 0.9, 0.8, 0.7].map(t => (
            <button key={t} className={`btn ${threshold === t ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setThreshold(t)} style={{ fontSize: 'var(--fs-sm)' }}>
              {Math.round(t * 100)}%
            </button>
          ))}
        </div>
        <button className="btn btn-primary btn-lg" onClick={startReviewSession} disabled={dueCards.length === 0}>
          <Play size={18} /> Start Review ({dueCards.length} cards)
        </button>
      </div>

      {/* Due Cards List */}
      {dueCards.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
          {dueCards.map((due, i) => {
            const c = casesById.get(due.caseId);
            if (!c) return null;
            const cat = CATEGORIES[c.category];
            const state = getCaseState(due.caseId);

            return (
              <Motion.button key={due.caseId} type="button" className="glass-card glass-card-interactive"
                onClick={() => openReviewCase(due.caseId)}
                initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.03 }}
                style={{ padding: 'var(--sp-4)', display: 'flex', alignItems: 'center', gap: 'var(--sp-4)', flexWrap: 'wrap', width: '100%', textAlign: 'left', background: 'transparent', border: 'var(--border-glass)', cursor: 'pointer' }}>
                
                {/* Priority badge */}
                <div style={{
                  width: 32, height: 32, borderRadius: 'var(--radius-md)',
                  background: due.retrievability < 0.5 ? 'rgba(239,68,68,0.1)' : due.retrievability < 0.7 ? 'rgba(245,158,11,0.1)' : 'rgba(148,163,184,0.06)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 'var(--fs-sm)', fontWeight: 700,
                  color: due.retrievability < 0.5 ? 'var(--accent-danger)' : due.retrievability < 0.7 ? 'var(--accent-warning)' : 'var(--text-muted)',
                }}>
                  {i + 1}
                </div>

                {/* Info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', marginBottom: 'var(--sp-1)', flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 600, fontSize: 'var(--fs-sm)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {c.title}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', flexWrap: 'wrap' }}>
                    <span style={{ color: cat?.color }}>●</span>
                    <span>{cat?.label || c.category}</span>
                    <span>•</span>
                    <span><Clock size={10} style={{ display: 'inline' }} /> {getTimeSinceReview(due.caseId)}</span>
                    {state && <><span>•</span><span>Lapses: {state.lapses}</span></>}
                  </div>
                </div>

                {/* Retention */}
                <div style={{ minWidth: 100, flex: '1 1 100px' }}>
                  <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', marginBottom: 2 }}>Retention</div>
                  <RetentionBar value={due.retrievability} />
                </div>
              </Motion.button>
            );
          })}
        </div>
      ) : totalAnswered > 0 ? (
        <div className="glass-card" style={{ padding: 'var(--sp-8)', textAlign: 'center' }}>
          {isLibraryReady ? (
            <>
              <CheckCircle size={48} style={{ color: 'var(--accent-success)', marginBottom: 'var(--sp-4)' }} />
              <h3 style={{ marginBottom: 'var(--sp-2)', color: 'var(--accent-success)' }}>All caught up!</h3>
              <p style={{ color: 'var(--text-muted)' }}>No cards due for review. Your memory retention is above {Math.round(threshold * 100)}% for all reviewed cases.</p>
            </>
          ) : (
            <>
              <AlertTriangle size={48} style={{ color: 'var(--accent-warning)', marginBottom: 'var(--sp-4)' }} />
              <h3 style={{ marginBottom: 'var(--sp-2)', color: 'var(--accent-warning)' }}>Review queue still loading</h3>
              <p style={{ color: 'var(--text-muted)' }}>
                The full case library is still loading, so additional due cards may appear once hydration finishes.
              </p>
            </>
          )}
        </div>
      ) : (
        <div className="glass-card" style={{ padding: 'var(--sp-8)', textAlign: 'center' }}>
          <Brain size={48} style={{ color: 'var(--text-muted)', marginBottom: 'var(--sp-4)' }} />
          <h3 style={{ marginBottom: 'var(--sp-2)' }}>No review data yet</h3>
          <p style={{ color: 'var(--text-muted)' }}>Start answering cases and grading your memory to build your review queue.</p>
        </div>
      )}
    </div>
  );
}
