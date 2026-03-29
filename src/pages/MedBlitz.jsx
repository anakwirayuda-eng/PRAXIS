/**
 * MedCase Pro — MedBlitz Speed Drill
 * Rapid-fire MCQ mode for short-narrative / flashcard questions
 * 15-second timer per question, streak tracking, source labels
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion as Motion, AnimatePresence } from 'framer-motion';
import { useCaseBank } from '../data/caseLoader';
import Zap from 'lucide-react/dist/esm/icons/zap';
import Clock from 'lucide-react/dist/esm/icons/clock';
import Trophy from 'lucide-react/dist/esm/icons/trophy';
import Flame from 'lucide-react/dist/esm/icons/flame';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right';
import CheckCircle from 'lucide-react/dist/esm/icons/check-circle';
import XCircle from 'lucide-react/dist/esm/icons/x-circle';
import Home from 'lucide-react/dist/esm/icons/home';
import RotateCcw from 'lucide-react/dist/esm/icons/rotate-ccw';
import ArrowRight from 'lucide-react/dist/esm/icons/arrow-right';
import Star from 'lucide-react/dist/esm/icons/star';
import Heart from 'lucide-react/dist/esm/icons/heart';

const TIME_PER_Q = 15; // seconds
const BLITZ_SIZE = 30; // questions per round

export default function MedBlitz() {
  const navigate = useNavigate();
  const { cases: caseBank, totalCases, status } = useCaseBank();

  const [phase, setPhase] = useState('READY'); // READY | PLAYING | RESULT
  const [queue, setQueue] = useState([]);
  const [idx, setIdx] = useState(0);
  const [selected, setSelected] = useState(null);
  const [revealed, setRevealed] = useState(false);
  const [answers, setAnswers] = useState([]);
  const [timer, setTimer] = useState(TIME_PER_Q);
  const [streak, setStreak] = useState(0);
  const [maxStreak, setMaxStreak] = useState(0);
  const [comboFx, setComboFx] = useState(false);
  const timerRef = useRef(null);
  const comboTimeoutRef = useRef(null);

  // Filter: short-narrative flashcards + all sources
  const pool = useMemo(() => {
    if (status !== 'ready') return [];
    return caseBank.filter(c =>
      c.q_type === 'MCQ' &&
      c.options?.length >= 2 &&
      c.options.some(o => o.is_correct) &&
      !c.meta?.quarantined &&        // Quality gate
      !c.meta?.truncated &&          // Quality gate
      !c.meta?.needs_review &&       // Quality gate
      (c.vignette?.narrative?.length < 200 || c.meta?.questionMode === 'rapid_recall')
    );
  }, [caseBank, status]);

  const current = queue[idx] || null;
  const correctOpt = current?.options?.find(o => o.is_correct);
  const progress = queue.length > 0 ? ((idx + 1) / queue.length) * 100 : 0;
  const timerPct = (timer / TIME_PER_Q) * 100;
  const isTimeCritical = timer <= 5;

  // Timer
  useEffect(() => {
    if (phase !== 'PLAYING' || revealed) return;
    timerRef.current = window.setInterval(() => {
      setTimer(t => {
        if (t <= 1) {
          window.clearInterval(timerRef.current);
          handleTimeout();
          return 0;
        }
        return t - 1;
      });
    }, 1000);
    return () => window.clearInterval(timerRef.current);
  }, [phase, revealed, idx]);

  useEffect(() => () => {
    window.clearInterval(timerRef.current);
    window.clearTimeout(comboTimeoutRef.current);
  }, []);

  const handleTimeout = () => {
    setRevealed(true);
    setStreak(0);
    setAnswers(a => [...a, { caseId: current?._id, correct: false, timedOut: true }]);
  };

  const startBlitz = useCallback(() => {
    const shuffled = [...pool].sort(() => Math.random() - 0.5);
    const selected = shuffled.slice(0, BLITZ_SIZE);
    setQueue(selected);
    setIdx(0);
    setSelected(null);
    setRevealed(false);
    setAnswers([]);
    setTimer(TIME_PER_Q);
    setStreak(0);
    setMaxStreak(0);
    setPhase('PLAYING');
  }, [pool]);

  const handleSelect = (optId) => {
    if (revealed || selected) return;
    window.clearInterval(timerRef.current);
    setSelected(optId);
    setRevealed(true);

    const isCorrect = optId === correctOpt?.id;
    setAnswers(a => [...a, { caseId: current?._id, correct: isCorrect, timedOut: false }]);

    if (isCorrect) {
      const newStreak = streak + 1;
      setStreak(newStreak);
      setMaxStreak(m => Math.max(m, newStreak));
      if (newStreak >= 3 && newStreak % 3 === 0) {
        setComboFx(true);
        window.clearTimeout(comboTimeoutRef.current);
        comboTimeoutRef.current = window.setTimeout(() => setComboFx(false), 800);
      }
    } else {
      setStreak(0);
    }
  };

  const handleNext = () => {
    if (idx + 1 >= queue.length) {
      setPhase('RESULT');
      return;
    }
    setIdx(i => i + 1);
    setSelected(null);
    setRevealed(false);
    setTimer(TIME_PER_Q);
  };

  // ─── READY SCREEN ───
  if (phase === 'READY') {
    return (
      <div style={{ maxWidth: 600, margin: '0 auto', padding: 'var(--sp-6)', textAlign: 'center' }}>
        <Motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.5, type: 'spring' }}>
          <div style={{
            width: 80, height: 80, borderRadius: '50%', margin: '0 auto var(--sp-4)',
            background: 'linear-gradient(135deg, #f59e0b, #ef4444)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 0 30px rgba(245,158,11,0.4)',
          }}>
            <Zap size={40} color="#fff" />
          </div>
          <h1 style={{ fontSize: 'var(--fs-3xl)', fontWeight: 800, background: 'linear-gradient(135deg, #f59e0b, #ef4444)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            MedBlitz
          </h1>
          <p style={{ color: 'var(--text-muted)', marginBottom: 'var(--sp-6)', fontSize: 'var(--fs-lg)' }}>
            Speed Drill — {TIME_PER_Q}s per question, {BLITZ_SIZE} rapid-fire rounds
          </p>

          <div style={{
            background: 'rgba(148,163,184,0.06)', border: 'var(--border-subtle)',
            borderRadius: 'var(--radius-lg)', padding: 'var(--sp-4)', marginBottom: 'var(--sp-6)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-around', gap: 'var(--sp-4)', flexWrap: 'wrap' }}>
              <div><div style={{ fontSize: 'var(--fs-2xl)', fontWeight: 700, color: 'var(--accent-primary)' }}>{pool.length.toLocaleString()}</div><div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>Available</div></div>
              <div><div style={{ fontSize: 'var(--fs-2xl)', fontWeight: 700, color: '#f59e0b' }}>{TIME_PER_Q}s</div><div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>Per Question</div></div>
              <div><div style={{ fontSize: 'var(--fs-2xl)', fontWeight: 700, color: '#ef4444' }}>{BLITZ_SIZE}</div><div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>Questions</div></div>
            </div>
          </div>

          <button
            id="start-blitz"
            onClick={startBlitz}
            disabled={pool.length < 2}
            style={{
              width: '100%', padding: 'var(--sp-4)', border: 'none', borderRadius: 'var(--radius-lg)',
              background: pool.length >= 2 ? 'linear-gradient(135deg, #f59e0b, #ef4444)' : '#333',
              color: '#fff', fontSize: 'var(--fs-lg)', fontWeight: 700, cursor: pool.length >= 2 ? 'pointer' : 'not-allowed',
              transition: 'transform 0.2s, box-shadow 0.2s',
              boxShadow: '0 4px 20px rgba(245,158,11,0.3)',
            }}
            onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.02)'; e.currentTarget.style.boxShadow = '0 6px 30px rgba(245,158,11,0.5)'; }}
            onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.boxShadow = '0 4px 20px rgba(245,158,11,0.3)'; }}
          >
            <Zap size={20} style={{ verticalAlign: 'middle', marginRight: 8 }} /> START BLITZ
          </button>

          <button onClick={() => navigate('/')} style={{
            marginTop: 'var(--sp-3)', background: 'transparent', border: 'var(--border-subtle)',
            color: 'var(--text-muted)', padding: 'var(--sp-2) var(--sp-4)', borderRadius: 'var(--radius-md)',
            cursor: 'pointer',
          }}>
            <Home size={16} style={{ verticalAlign: 'middle', marginRight: 4 }} /> Back
          </button>
        </Motion.div>
      </div>
    );
  }

  // ─── RESULT SCREEN ───
  if (phase === 'RESULT') {
    const correct = answers.filter(a => a.correct).length;
    const total = answers.length;
    const pct = total > 0 ? Math.round((correct / total) * 100) : 0;
    const timedOut = answers.filter(a => a.timedOut).length;

    return (
      <div style={{ maxWidth: 600, margin: '0 auto', padding: 'var(--sp-6)', textAlign: 'center' }}>
        <Motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.5, type: 'spring' }}>
          <Trophy size={64} style={{ color: pct >= 80 ? '#f59e0b' : pct >= 50 ? 'var(--accent-primary)' : 'var(--text-muted)', marginBottom: 'var(--sp-4)' }} />
          <h1 style={{ fontSize: 'var(--fs-3xl)', fontWeight: 800, marginBottom: 'var(--sp-2)' }}>Blitz Complete!</h1>
          <div style={{ fontSize: 'var(--fs-5xl)', fontWeight: 900, background: pct >= 80 ? 'linear-gradient(135deg, #f59e0b, #ef4444)' : 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', marginBottom: 'var(--sp-4)' }}>
            {pct}%
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 'var(--sp-3)', marginBottom: 'var(--sp-6)' }}>
            <div style={{ background: 'rgba(34,197,94,0.08)', borderRadius: 'var(--radius-md)', padding: 'var(--sp-3)' }}>
              <CheckCircle size={20} style={{ color: 'rgb(34,197,94)' }} />
              <div style={{ fontSize: 'var(--fs-xl)', fontWeight: 700 }}>{correct}</div>
              <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>Correct</div>
            </div>
            <div style={{ background: 'rgba(239,68,68,0.08)', borderRadius: 'var(--radius-md)', padding: 'var(--sp-3)' }}>
              <XCircle size={20} style={{ color: 'rgb(239,68,68)' }} />
              <div style={{ fontSize: 'var(--fs-xl)', fontWeight: 700 }}>{total - correct}</div>
              <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>Wrong{timedOut > 0 ? ` (${timedOut} timed out)` : ''}</div>
            </div>
            <div style={{ background: 'rgba(245,158,11,0.08)', borderRadius: 'var(--radius-md)', padding: 'var(--sp-3)' }}>
              <Flame size={20} style={{ color: '#f59e0b' }} />
              <div style={{ fontSize: 'var(--fs-xl)', fontWeight: 700 }}>{maxStreak}</div>
              <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>Best Streak</div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 'var(--sp-3)', justifyContent: 'center', flexWrap: 'wrap' }}>
            <button id="retry-blitz" onClick={startBlitz} style={{
              padding: 'var(--sp-3) var(--sp-5)', border: 'none', borderRadius: 'var(--radius-lg)',
              background: 'linear-gradient(135deg, #f59e0b, #ef4444)', color: '#fff', fontWeight: 700,
              cursor: 'pointer', fontSize: 'var(--fs-md)',
            }}>
              <RotateCcw size={16} style={{ verticalAlign: 'middle', marginRight: 4 }} /> Play Again
            </button>
            <button onClick={() => navigate('/')} style={{
              padding: 'var(--sp-3) var(--sp-5)', border: 'var(--border-subtle)', borderRadius: 'var(--radius-lg)',
              background: 'transparent', color: 'var(--text-primary)', cursor: 'pointer', fontSize: 'var(--fs-md)',
            }}>
              <Home size={16} style={{ verticalAlign: 'middle', marginRight: 4 }} /> Home
            </button>
          </div>
        </Motion.div>
      </div>
    );
  }

  // ─── PLAYING SCREEN ───
  if (!current) return null;
  const sourceLabel = current.meta?.sourceLabel || current.meta?.source || '?';

  return (
    <div style={{ maxWidth: 640, margin: '0 auto', padding: 'var(--sp-4)' }}>
      {/* Header: Timer + Progress + Streak */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', marginBottom: 'var(--sp-3)' }}>
        {/* Timer Circle */}
        <div style={{
          width: 52, height: 52, borderRadius: '50%', position: 'relative',
          background: isTimeCritical ? 'rgba(239,68,68,0.15)' : 'rgba(148,163,184,0.08)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          border: `2px solid ${isTimeCritical ? 'rgba(239,68,68,0.5)' : 'rgba(148,163,184,0.2)'}`,
          animation: isTimeCritical ? 'pulse 0.5s infinite alternate' : 'none',
        }}>
          <span style={{ fontSize: 'var(--fs-lg)', fontWeight: 800, color: isTimeCritical ? '#ef4444' : 'var(--text-primary)' }}>
            {timer}
          </span>
        </div>

        {/* Progress bar */}
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>
            <span>Q{idx + 1}/{queue.length}</span>
            <span style={{ color: '#f59e0b' }}>
              {streak > 0 && <><Flame size={12} style={{ verticalAlign: 'middle' }} /> {streak} streak</>}
            </span>
          </div>
          <div style={{ height: 6, background: 'rgba(148,163,184,0.1)', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${progress}%`, background: 'linear-gradient(90deg, #f59e0b, #ef4444)', borderRadius: 3, transition: 'width 0.3s' }} />
          </div>
          {/* Timer bar */}
          <div style={{ height: 3, background: 'rgba(148,163,184,0.06)', borderRadius: 2, marginTop: 2, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${timerPct}%`, background: isTimeCritical ? '#ef4444' : 'var(--accent-primary)', borderRadius: 2, transition: 'width 1s linear' }} />
          </div>
        </div>
      </div>

      {/* Combo Effect */}
      <AnimatePresence>
        {comboFx && (
          <Motion.div
            initial={{ scale: 0.5, opacity: 0, y: -20 }}
            animate={{ scale: 1.2, opacity: 1, y: 0 }}
            exit={{ scale: 0.5, opacity: 0, y: -20 }}
            style={{ textAlign: 'center', fontSize: 'var(--fs-2xl)', fontWeight: 900, color: '#f59e0b', marginBottom: 'var(--sp-2)' }}
          >
            🔥 {streak}x COMBO!
          </Motion.div>
        )}
      </AnimatePresence>

      {/* Question Card */}
      <AnimatePresence mode="wait">
        <Motion.div
          key={idx}
          initial={{ x: 60, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: -60, opacity: 0 }}
          transition={{ duration: 0.25 }}
          style={{
            background: 'rgba(148,163,184,0.04)', border: 'var(--border-subtle)',
            borderRadius: 'var(--radius-lg)', padding: 'var(--sp-4)', marginBottom: 'var(--sp-3)',
          }}
        >
          {/* Source tag + category */}
          <div style={{ display: 'flex', gap: 'var(--sp-2)', marginBottom: 'var(--sp-3)', flexWrap: 'wrap' }}>
            <span style={{
              fontSize: 'var(--fs-xs)', padding: '2px 8px', borderRadius: 'var(--radius-sm)',
              background: 'linear-gradient(135deg, rgba(245,158,11,0.15), rgba(239,68,68,0.15))',
              color: '#f59e0b', fontWeight: 700, letterSpacing: '0.5px',
            }}>
              {sourceLabel}
            </span>
            <span style={{
              fontSize: 'var(--fs-xs)', padding: '2px 8px', borderRadius: 'var(--radius-sm)',
              background: 'rgba(99,102,241,0.1)', color: 'var(--accent-primary)', fontWeight: 600,
            }}>
              {current.category}
            </span>
          </div>

          {/* Question text */}
          <p style={{ fontSize: 'var(--fs-md)', lineHeight: 1.6, color: 'var(--text-primary)', marginBottom: 'var(--sp-4)' }}>
            {current.vignette?.narrative || current.title}
          </p>

          {/* Options */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' }}>
            {current.options.map(opt => {
              const isSelected = selected === opt.id;
              const isCorrect = opt.is_correct;
              let bg = 'rgba(148,163,184,0.06)';
              let border = 'var(--border-subtle)';
              let textColor = 'var(--text-primary)';

              if (revealed) {
                if (isCorrect) {
                  bg = 'rgba(34,197,94,0.12)';
                  border = '1px solid rgba(34,197,94,0.4)';
                  textColor = 'rgb(34,197,94)';
                } else if (isSelected && !isCorrect) {
                  bg = 'rgba(239,68,68,0.12)';
                  border = '1px solid rgba(239,68,68,0.4)';
                  textColor = 'rgb(239,68,68)';
                }
              } else if (isSelected) {
                bg = 'rgba(99,102,241,0.12)';
                border = '1px solid rgba(99,102,241,0.4)';
              }

              return (
                <button
                  key={opt.id}
                  id={`blitz-opt-${opt.id}`}
                  onClick={() => handleSelect(opt.id)}
                  disabled={revealed}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 'var(--sp-3)',
                    padding: 'var(--sp-3)', background: bg, border, borderRadius: 'var(--radius-md)',
                    cursor: revealed ? 'default' : 'pointer', textAlign: 'left',
                    color: textColor, fontSize: 'var(--fs-sm)', fontWeight: isSelected || (revealed && isCorrect) ? 600 : 400,
                    transition: 'all 0.15s',
                    width: '100%',
                  }}
                >
                  <span style={{
                    width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: revealed && isCorrect ? 'rgba(34,197,94,0.2)' : revealed && isSelected ? 'rgba(239,68,68,0.2)' : 'rgba(148,163,184,0.1)',
                    fontSize: 'var(--fs-xs)', fontWeight: 700, flexShrink: 0,
                  }}>
                    {revealed && isCorrect ? <CheckCircle size={16} /> : revealed && isSelected && !isCorrect ? <XCircle size={16} /> : opt.id}
                  </span>
                  <span style={{ flex: 1 }}>{opt.text}</span>
                </button>
              );
            })}
          </div>
        </Motion.div>
      </AnimatePresence>

      {/* Next button (after reveal) */}
      {revealed && (
        <Motion.button
          initial={{ y: 10, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          id="blitz-next"
          onClick={handleNext}
          style={{
            width: '100%', padding: 'var(--sp-3)', border: 'none', borderRadius: 'var(--radius-lg)',
            background: 'linear-gradient(135deg, #f59e0b, #ef4444)', color: '#fff',
            fontSize: 'var(--fs-md)', fontWeight: 700, cursor: 'pointer',
            boxShadow: '0 4px 20px rgba(245,158,11,0.3)',
          }}
        >
          {idx + 1 >= queue.length ? 'See Results' : 'Next'} <ArrowRight size={16} style={{ verticalAlign: 'middle', marginLeft: 4 }} />
        </Motion.button>
      )}

      {/* CSS for pulse animation */}
      <style>{`
        @keyframes pulse {
          from { transform: scale(1); }
          to { transform: scale(1.08); }
        }
      `}</style>
    </div>
  );
}
