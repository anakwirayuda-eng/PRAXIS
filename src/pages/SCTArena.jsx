/**
 * PRAXIS — SCT Arena ("The Consuelen Chamber")
 * Dedicated Script Concordance Test training ground.
 *
 * SCIENTIFIC FIXES (Gemini triage):
 * 1. Charlin Method proportional scoring (NO binary is_correct)
 * 2. FSRS/Telemetry quarantine (SCT does NOT enter spaced repetition)
 * 3. Absolute bar normalization (totalVotes, not maxVotes)
 * 5. Hacker detection (localStorage cross-check)
 */
import { useState, useMemo, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion as Motion, AnimatePresence } from 'framer-motion';
import { useStore } from '../data/store';
import { Shield, Lock, Brain, ChevronRight, RotateCcw, Trophy, Star, ArrowRight, Zap, AlertTriangle } from 'lucide-react';

const SCT_UNLOCK_THRESHOLD = 0; // BETA: set to 200 for production launch

const LIKERT_LABELS = {
  '-2': 'Sangat Berkurang',
  '-1': 'Berkurang',
  '0': 'Tetap',
  '+1': 'Menguat',
  '+2': 'Sangat Menguat',
};

// Charlin Method proportional concordance scoring
function charlinScore(options, selectedId) {
  const maxVotes = Math.max(...options.map(o => o.sct_panel_votes || 0), 1);
  const selected = options.find(o => o.id === selectedId);
  return (selected?.sct_panel_votes || 0) / maxVotes;
}

function concordanceColor(score) {
  if (score >= 0.8) return { bg: 'rgba(16,185,129,0.12)', border: '2px solid var(--accent-success)', color: 'var(--accent-success)' };
  if (score >= 0.4) return { bg: 'rgba(245,158,11,0.12)', border: '2px solid var(--accent-warning)', color: 'var(--accent-warning)' };
  if (score > 0)    return { bg: 'rgba(148,163,184,0.12)', border: '2px solid rgba(148,163,184,0.4)', color: 'var(--text-muted)' };
  return              { bg: 'rgba(239,68,68,0.08)', border: '2px solid rgba(239,68,68,0.3)', color: 'var(--accent-danger)' };
}

function concordanceLabel(score) {
  if (score >= 0.8) return 'Ekselen — selaras dengan mayoritas panel';
  if (score >= 0.4) return 'Parsial — didukung sebagian panel';
  if (score > 0)    return 'Minoritas — hanya sedikit panel yang setuju';
  return 'Tidak konkorden — panel tidak memilih opsi ini';
}

// VIP Backdoor for beta testers (F12 → localStorage.setItem('PRAXIS_VIP','GOD_MODE'))
function isBetaVIP() {
  try { return localStorage.getItem('PRAXIS_VIP') === 'GOD_MODE'; } catch { return false; }
}

export default function SCTArena() {
  const navigate = useNavigate();
  const { totalAnswered, completedCases } = useStore();
  const [sctCases, setSctCases] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState(null);
  const [isReviewing, setIsReviewing] = useState(false);
  const [sessionStats, setSessionStats] = useState({ total: 0, sumScore: 0 });
  const [isLoading, setIsLoading] = useState(true);

  const isUnlocked = totalAnswered >= SCT_UNLOCK_THRESHOLD || isBetaVIP();
  const progress = Math.min(100, Math.round((totalAnswered / SCT_UNLOCK_THRESHOLD) * 100));

  // Fix #5: Hacker detection — cross-check totalAnswered vs completedCases
  const isSuspicious = totalAnswered >= SCT_UNLOCK_THRESHOLD && completedCases.length < Math.floor(SCT_UNLOCK_THRESHOLD * 0.5);

  // Load SCT cases
  useEffect(() => {
    if (!isUnlocked || isSuspicious) { setIsLoading(false); return; }

    const loadSCT = async () => {
      try {
        const { ensureCaseBankLoaded } = await import('../data/caseLoader');
        const allCases = await ensureCaseBankLoaded();
        const sct = allCases.filter(c => c.q_type === 'SCT');
        for (let i = sct.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [sct[i], sct[j]] = [sct[j], sct[i]];
        }
        setSctCases(sct);
      } catch (err) {
        console.error('[SCTArena] Failed to load cases:', err);
      } finally {
        setIsLoading(false);
      }
    };
    loadSCT();
  }, [isUnlocked, isSuspicious]);

  const caseData = sctCases[currentIndex] || null;
  const options = caseData?.options ?? [];

  const handleSelect = useCallback((optId) => {
    if (isReviewing) return;
    setSelectedAnswer(optId);
  }, [isReviewing]);

  const handleSubmit = useCallback(() => {
    if (!selectedAnswer || isReviewing) return;
    const score = charlinScore(options, selectedAnswer);
    setSessionStats(prev => ({
      total: prev.total + 1,
      sumScore: prev.sumScore + score,
    }));
    setIsReviewing(true);
    // Fix #2: NO submitAnswer(), NO telemetry beacon — SCT is quarantined
  }, [selectedAnswer, isReviewing, options]);

  const handleNext = useCallback(() => {
    setSelectedAnswer(null);
    setIsReviewing(false);
    setCurrentIndex(prev => prev + 1);
  }, []);

  // Fix #3: Absolute normalization — use totalVotes, not maxVotes
  const totalVotes = useMemo(() => 
    options.reduce((sum, o) => sum + (o.sct_panel_votes || 0), 0) || 1
  , [options]);

  const currentScore = selectedAnswer ? charlinScore(options, selectedAnswer) : null;
  const sessionConcordance = sessionStats.total > 0 
    ? Math.round((sessionStats.sumScore / sessionStats.total) * 100)
    : 0;

  // ═══════════════════════════════════════
  // Fix #5: HACKER EASTER EGG
  // ═══════════════════════════════════════
  if (isSuspicious) {
    return (
      <Motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} style={{ maxWidth: 640, margin: '0 auto' }}>
        <div className="glass-card" style={{ padding: 'var(--sp-8)', textAlign: 'center' }}>
          <AlertTriangle size={64} style={{ color: 'var(--accent-warning)', marginBottom: 'var(--sp-4)' }} />
          <h1 style={{ fontSize: 'var(--fs-2xl)', marginBottom: 'var(--sp-2)' }}>
            👨‍💻 Ah, a Hacker in the Ward!
          </h1>
          <p style={{ color: 'var(--text-muted)', marginBottom: 'var(--sp-4)', lineHeight: 1.7 }}>
            Kami mendeteksi manipulasi dimensi localStorage, dr. Robot.<br/>
            Tapi ingat, <strong>Konsulen sejati tidak pernah memotong kompas di IGD.</strong><br/>
            Kembali ke garis depan dan selesaikan kasus Anda dengan jujur!
          </p>
          <div style={{ padding: 'var(--sp-3)', background: 'rgba(245,158,11,0.06)', borderRadius: 'var(--radius-md)', border: '1px solid rgba(245,158,11,0.15)', fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>
            Claimed: {totalAnswered} answered · Verified: {completedCases.length} unique cases
          </div>
          <button className="btn btn-primary" style={{ width: '100%', marginTop: 'var(--sp-4)' }} onClick={() => navigate('/cases')}>
            Kembali ke Case Browser
          </button>
        </div>
      </Motion.div>
    );
  }

  // ═══════════════════════════════════════
  // LOCKED STATE
  // ═══════════════════════════════════════
  if (!isUnlocked) {
    return (
      <Motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} style={{ maxWidth: 640, margin: '0 auto' }}>
        <div className="glass-card" style={{ padding: 'var(--sp-8)', textAlign: 'center' }}>
          <Motion.div
            animate={{ rotateY: [0, 10, -10, 0] }}
            transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
            style={{ display: 'inline-block', marginBottom: 'var(--sp-4)' }}
          >
            <Lock size={64} style={{ color: 'var(--accent-warning)' }} />
          </Motion.div>

          <h1 style={{ fontSize: 'var(--fs-2xl)', marginBottom: 'var(--sp-2)' }}>🧠 SCT Arena</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: 'var(--fs-lg)', marginBottom: 'var(--sp-2)' }}>
            <em>Ruang Latihan Para Konsulen</em>
          </p>
          <p style={{ color: 'var(--text-muted)', marginBottom: 'var(--sp-6)', lineHeight: 1.6 }}>
            Script Concordance Test melatih <strong>Probabilistic Reasoning</strong> — 
            kemampuan merevisi hipotesis saat dihadapkan data klinis baru. 
            Ini bukan soal benar/salah, melainkan seberapa <em>konkorden</em> pikiran Anda dengan panel konsulen.
          </p>

          <div style={{ background: 'rgba(99,102,241,0.08)', borderRadius: 'var(--radius-lg)', padding: 'var(--sp-4)', marginBottom: 'var(--sp-4)', border: '1px solid rgba(99,102,241,0.15)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--sp-2)' }}>
              <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>Progress Unlock</span>
              <span style={{ fontSize: 'var(--fs-sm)', fontWeight: 700, color: 'var(--accent-primary)' }}>
                {totalAnswered} / {SCT_UNLOCK_THRESHOLD} MCQ
              </span>
            </div>
            <div style={{ height: 8, background: 'rgba(148,163,184,0.1)', borderRadius: 'var(--radius-full)', overflow: 'hidden' }}>
              <Motion.div
                initial={{ width: 0 }}
                animate={{ width: `${progress}%` }}
                transition={{ duration: 1.5, ease: [0.16, 1, 0.3, 1] }}
                style={{ height: '100%', borderRadius: 'var(--radius-full)', background: 'linear-gradient(90deg, var(--accent-primary), var(--accent-secondary))' }}
              />
            </div>
          </div>

          <button className="btn btn-primary" style={{ width: '100%', gap: 'var(--sp-2)' }} onClick={() => navigate('/cases')}>
            <ArrowRight size={18} />
            Latihkan {SCT_UNLOCK_THRESHOLD - totalAnswered} MCQ lagi untuk membuka SCT Arena
          </button>
        </div>
      </Motion.div>
    );
  }

  // Loading / No cases / Session complete states
  if (isLoading) {
    return (
      <div className="glass-card" style={{ padding: 'var(--sp-8)', textAlign: 'center', maxWidth: 640, margin: '0 auto' }}>
        <Brain size={32} style={{ color: 'var(--accent-primary)', marginBottom: 'var(--sp-3)' }} />
        <h2>Memuat kasus SCT...</h2>
        <p style={{ color: 'var(--text-muted)' }}>Menyiapkan panel konsensus konsulen.</p>
      </div>
    );
  }

  if (sctCases.length === 0) {
    return (
      <div className="glass-card" style={{ padding: 'var(--sp-8)', textAlign: 'center', maxWidth: 640, margin: '0 auto' }}>
        <Shield size={32} style={{ color: 'var(--text-muted)', marginBottom: 'var(--sp-3)' }} />
        <h2>Belum ada kasus SCT</h2>
        <p style={{ color: 'var(--text-muted)' }}>Kasus SCT sedang dalam proses kurasi.</p>
      </div>
    );
  }

  if (currentIndex >= sctCases.length) {
    return (
      <Motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} style={{ maxWidth: 640, margin: '0 auto' }}>
        <div className="glass-card" style={{ padding: 'var(--sp-8)', textAlign: 'center' }}>
          <Trophy size={48} style={{ color: 'var(--accent-warning)', marginBottom: 'var(--sp-4)' }} />
          <h1 style={{ fontSize: 'var(--fs-2xl)', marginBottom: 'var(--sp-2)' }}>SCT Session Selesai!</h1>
          <p style={{ color: 'var(--text-muted)', marginBottom: 'var(--sp-4)' }}>
            Anda telah menyelesaikan semua {sctCases.length} kasus SCT.
          </p>

          <div style={{ display: 'flex', gap: 'var(--sp-4)', justifyContent: 'center', marginBottom: 'var(--sp-6)' }}>
            <div className="glass-card" style={{ padding: 'var(--sp-4)', minWidth: 100 }}>
              <div style={{ fontSize: 'var(--fs-2xl)', fontWeight: 700, color: 'var(--accent-primary)' }}>{sessionStats.total}</div>
              <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>Dijawab</div>
            </div>
            <div className="glass-card" style={{ padding: 'var(--sp-4)', minWidth: 100 }}>
              <div style={{ fontSize: 'var(--fs-2xl)', fontWeight: 700, color: sessionConcordance >= 70 ? 'var(--accent-success)' : 'var(--accent-warning)' }}>{sessionConcordance}%</div>
              <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>Konkordansi</div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 'var(--sp-3)' }}>
            <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => { setCurrentIndex(0); setSessionStats({ total: 0, sumScore: 0 }); }}>
              <RotateCcw size={16} /> Ulang Sesi
            </button>
            <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => navigate('/')}>Dashboard</button>
          </div>
        </div>
      </Motion.div>
    );
  }

  // ═══════════════════════════════════════
  // MAIN SCT GAMEPLAY (Charlin Proportional Scoring)
  // ═══════════════════════════════════════
  return (
    <div style={{ maxWidth: 780, margin: '0 auto' }}>
      {/* Header Bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--sp-4)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)' }}>
          <Brain size={20} style={{ color: 'var(--accent-primary)' }} />
          <h2 style={{ fontSize: 'var(--fs-lg)', margin: 0 }}>SCT Arena</h2>
          <span className="badge badge-warning" style={{ fontSize: 'var(--fs-xs)' }}>
            {currentIndex + 1} / {sctCases.length}
          </span>
        </div>
        <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>
          <Zap size={14} style={{ display: 'inline', verticalAlign: '-2px', color: 'var(--accent-warning)' }} /> {sessionConcordance}% konkordansi
        </span>
      </div>

      <AnimatePresence mode="wait">
        <Motion.div
          key={caseData._id}
          initial={{ opacity: 0, x: 40 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -40 }}
          transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
        >
          {/* Vignette Card */}
          <div className="glass-card" style={{ padding: 'var(--sp-6)', marginBottom: 'var(--sp-4)' }}>
            <div style={{ display: 'flex', gap: 'var(--sp-2)', marginBottom: 'var(--sp-3)', flexWrap: 'wrap' }}>
              <span className="badge badge-warning">SCT</span>
              {caseData.category && <span className="badge badge-info">{caseData.category}</span>}
              {caseData.case_code && <span className="badge" style={{ opacity: 0.6 }}>{caseData.case_code}</span>}
            </div>

            {caseData.vignette?.narrative && (
              <div style={{ 
                background: 'rgba(99,102,241,0.04)', borderRadius: 'var(--radius-md)', 
                padding: 'var(--sp-4)', marginBottom: 'var(--sp-4)', border: '1px solid rgba(99,102,241,0.08)',
                lineHeight: 1.7, fontSize: 'var(--fs-base)',
              }}>
                {caseData.vignette.narrative}
              </div>
            )}

            <h3 style={{ fontSize: 'var(--fs-lg)', marginBottom: 'var(--sp-2)', lineHeight: 1.5 }}>
              {caseData.prompt || caseData.title}
            </h3>
            <p style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-sm)', marginBottom: 'var(--sp-4)' }}>
              Seberapa besar informasi baru ini mengubah hipotesis Anda?
            </p>
          </div>

          {/* Likert Scale — Heatmap scoring, NOT binary */}
          <div className="glass-card" style={{ padding: 'var(--sp-6)', marginBottom: 'var(--sp-4)' }}>
            <div style={{ display: 'flex', gap: 'var(--sp-2)', justifyContent: 'center', flexWrap: 'wrap', marginBottom: isReviewing ? 'var(--sp-4)' : 0 }}>
              {options.map(opt => {
                const label = LIKERT_LABELS[opt.id] || opt.text;
                let bg = 'rgba(148,163,184,0.06)';
                let border = '2px solid rgba(148,163,184,0.15)';
                let color = 'var(--text-primary)';

                if (selectedAnswer === opt.id && !isReviewing) {
                  bg = 'rgba(99,102,241,0.15)';
                  border = '2px solid var(--accent-primary)';
                  color = 'var(--accent-primary)';
                }

                // Fix #1: Heatmap coloring based on concordance score, NOT is_correct
                if (isReviewing && selectedAnswer === opt.id) {
                  const styles = concordanceColor(currentScore);
                  bg = styles.bg;
                  border = styles.border;
                  color = styles.color;
                }

                // Highlight the modal response (max votes) with subtle outline
                const maxVotes = Math.max(...options.map(o => o.sct_panel_votes || 0));
                if (isReviewing && opt.sct_panel_votes === maxVotes && selectedAnswer !== opt.id) {
                  border = '2px dashed rgba(16,185,129,0.4)';
                }

                return (
                  <Motion.button
                    key={opt.id}
                    className="btn"
                    onClick={() => handleSelect(opt.id)}
                    whileHover={!isReviewing ? { scale: 1.05, y: -2 } : {}}
                    whileTap={!isReviewing ? { scale: 0.95 } : {}}
                    style={{
                      background: bg, border, color, flexDirection: 'column',
                      padding: 'var(--sp-3) var(--sp-4)', minWidth: 100, gap: 4,
                      cursor: isReviewing ? 'default' : 'pointer', transition: 'all 0.2s ease',
                    }}
                  >
                    <span style={{ fontSize: 'var(--fs-xl)', fontWeight: 700 }}>{opt.id}</span>
                    <span style={{ fontSize: 'var(--fs-xs)', opacity: 0.8, maxWidth: 90, lineHeight: 1.3 }}>{label}</span>
                  </Motion.button>
                );
              })}
            </div>

            {/* Concordance result + Expert Panel Distribution */}
            {isReviewing && (
              <Motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
                {/* Fix #1: Concordance score display (not binary) */}
                <div style={{ 
                  textAlign: 'center', marginBottom: 'var(--sp-4)', padding: 'var(--sp-3)', 
                  borderRadius: 'var(--radius-md)', ...concordanceColor(currentScore),
                  background: concordanceColor(currentScore).bg,
                }}>
                  <div style={{ fontSize: 'var(--fs-2xl)', fontWeight: 700 }}>
                    {Math.round(currentScore * 100)}%
                  </div>
                  <div style={{ fontSize: 'var(--fs-sm)', opacity: 0.9 }}>
                    {concordanceLabel(currentScore)}
                  </div>
                </div>

                {/* Fix #3: Absolute normalization bars */}
                <div style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--text-muted)', marginBottom: 'var(--sp-3)' }}>
                  <Star size={14} style={{ display: 'inline', verticalAlign: '-2px', color: 'var(--accent-warning)' }} /> Distribusi Panel Konsulen (n={totalVotes})
                </div>
                {options.map(opt => {
                  const pct = Math.round(((opt.sct_panel_votes || 0) / totalVotes) * 100);
                  const isSelected = selectedAnswer === opt.id;
                  return (
                    <div key={opt.id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', marginBottom: 'var(--sp-2)' }}>
                      <span style={{ 
                        width: 30, fontSize: 'var(--fs-sm)', fontWeight: 700, textAlign: 'center',
                        color: isSelected ? concordanceColor(currentScore).color : 'var(--text-secondary)',
                      }}>
                        {opt.id}
                      </span>
                      <div style={{ flex: 1, height: 22, borderRadius: 'var(--radius-sm)', background: 'rgba(148,163,184,0.06)', overflow: 'hidden' }}>
                        <Motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${pct}%` }}
                          transition={{ delay: 0.4, duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
                          style={{
                            height: '100%', borderRadius: 'var(--radius-sm)',
                            background: isSelected
                              ? `linear-gradient(90deg, ${concordanceColor(currentScore).color}, ${concordanceColor(currentScore).color}88)`
                              : 'linear-gradient(90deg, var(--accent-primary), var(--accent-secondary))',
                          }}
                        />
                      </div>
                      <span style={{ width: 55, fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', textAlign: 'right', fontWeight: 600 }}>
                        {opt.sct_panel_votes || 0} ({pct}%)
                      </span>
                    </div>
                  );
                })}
              </Motion.div>
            )}
          </div>

          {/* Rationale */}
          {isReviewing && caseData.rationale?.correct && (
            <Motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}
              className="glass-card" style={{ padding: 'var(--sp-6)', marginBottom: 'var(--sp-4)', borderLeft: '3px solid var(--accent-primary)' }}>
              <h4 style={{ marginBottom: 'var(--sp-2)', color: 'var(--accent-primary)' }}>Penjelasan Panel Konsulen</h4>
              <p style={{ lineHeight: 1.7, color: 'var(--text-secondary)' }}>{caseData.rationale.correct}</p>
              {caseData.rationale.pearl && (
                <div style={{ marginTop: 'var(--sp-3)', padding: 'var(--sp-3)', background: 'rgba(245,158,11,0.06)', borderRadius: 'var(--radius-md)', border: '1px solid rgba(245,158,11,0.15)' }}>
                  <strong style={{ color: 'var(--accent-warning)' }}>💎 Clinical Pearl:</strong>{' '}
                  <span style={{ color: 'var(--text-secondary)' }}>{caseData.rationale.pearl}</span>
                </div>
              )}
            </Motion.div>
          )}

          {/* Action Buttons */}
          <div style={{ display: 'flex', gap: 'var(--sp-3)' }}>
            {!isReviewing ? (
              <button
                className="btn btn-primary"
                style={{ flex: 1, opacity: selectedAnswer ? 1 : 0.5 }}
                disabled={!selectedAnswer}
                onClick={handleSubmit}
              >
                Submit Concordance
              </button>
            ) : (
              <button className="btn btn-primary" style={{ flex: 1, gap: 'var(--sp-2)' }} onClick={handleNext}>
                Next Case <ChevronRight size={16} />
              </button>
            )}
          </div>
        </Motion.div>
      </AnimatePresence>
    </div>
  );
}
