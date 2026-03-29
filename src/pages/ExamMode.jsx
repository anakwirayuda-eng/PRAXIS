/**
 * MedCase Pro - Exam Mode Page
 * Timed exam simulation with configurable parameters.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle';
import ArrowRight from 'lucide-react/dist/esm/icons/arrow-right';
import CheckCircle from 'lucide-react/dist/esm/icons/check-circle';
import Clock from 'lucide-react/dist/esm/icons/clock';
import Home from 'lucide-react/dist/esm/icons/home';
import Play from 'lucide-react/dist/esm/icons/play';
import RotateCcw from 'lucide-react/dist/esm/icons/rotate-ccw';
import Settings from 'lucide-react/dist/esm/icons/settings';
import Trophy from 'lucide-react/dist/esm/icons/trophy';
import XCircle from 'lucide-react/dist/esm/icons/x-circle';
import Zap from 'lucide-react/dist/esm/icons/zap';
import { CATEGORIES, useCaseBank } from '../data/caseLoader';
import { useStore } from '../data/store';

const PRESETS = [
  { label: 'UKMPPD Quick Drill', questions: 10, time: 20, exam: 'UKMPPD', icon: 'ID' },
  { label: 'USMLE Mini Block', questions: 20, time: 30, exam: 'USMLE', icon: 'US' },
  { label: 'Full Mock Mixed', questions: 50, time: 60, exam: 'all', icon: 'ALL' },
  { label: 'Hard Cases Only', questions: 10, time: 25, exam: 'all', icon: 'HARD', difficulty: '3' },
  { label: 'Flashcard Sprint', questions: 20, time: 10, exam: 'all', icon: '⚡', questionMode: 'rapid_recall' },
];

function TimerRing({ value, max, size = 52, stroke = 4 }) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (value / max) * circumference;
  const isUrgent = value <= 60;
  const color = isUrgent ? 'var(--accent-danger)' : 'var(--accent-primary)';
  
  return (
    <div style={{ position: 'relative', width: size, height: size, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(15,23,42,0.4)', borderRadius: '50%', boxShadow: isUrgent ? '0 0 16px rgba(239,68,68,0.2)' : 'none', transition: 'box-shadow 0.3s' }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)', position: 'absolute', top: 0, left: 0 }}>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="rgba(148,163,184,0.15)" strokeWidth={stroke} />
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
          style={{ transition: 'stroke-dashoffset 1s linear, stroke 0.3s ease' }}
        />
      </svg>
      <div style={{ position: 'relative', zIndex: 2, fontSize: 11, fontWeight: 700, color: isUrgent ? 'var(--accent-danger)' : 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }} aria-label={`${Math.floor(value / 60)} minutes and ${value % 60} seconds remaining`}>
        {Math.floor(value / 60)}:{String(value % 60).padStart(2, '0')}
      </div>
    </div>
  );
}

function buildPresetConfig(preset) {
  return {
    questionCount: preset.questions,
    timeLimit: preset.time,
    categories: 'all',
    difficulty: preset.difficulty || 'all',
    examType: preset.exam,
    questionMode: preset.questionMode || 'all',
  };
}

export default function ExamMode() {
  const navigate = useNavigate();
  const { cases: caseBank, totalCases, status, isLoading } = useCaseBank();
  const {
    machineState,
    selectedAnswer,
    startCase,
    selectAnswer,
    submitAnswer,
    nextCase,
    resetSession,
  } = useStore();

  const [config, setConfig] = useState({
    questionCount: 10,
    timeLimit: 30,
    categories: 'all',
    difficulty: 'all',
    examType: 'all',
    questionMode: 'all',
  });
  const [examState, setExamState] = useState('CONFIG');
  const [examQueue, setExamQueue] = useState([]);
  const [examIdx, setExamIdx] = useState(0);
  const [examAnswers, setExamAnswers] = useState([]);
  const [timeLeft, setTimeLeft] = useState(0);
  const [examNotice, setExamNotice] = useState('');
  const timerRef = useRef(null);
  const loadedCases = useMemo(() => caseBank.slice(0, totalCases), [caseBank, totalCases]);

  const getPoolForConfig = useCallback((cfg) => loadedCases.filter((caseData) => {
    if (caseData.q_type === 'CLINICAL_DISCUSSION') return false;
    if (caseData.options?.length < 2) return false;
    if (cfg.categories !== 'all' && caseData.category !== cfg.categories) return false;
    if (cfg.difficulty !== 'all' && caseData.meta.difficulty !== Number.parseInt(cfg.difficulty, 10)) return false;
    if (cfg.examType !== 'all' && caseData.meta.examType !== cfg.examType && caseData.meta.examType !== 'BOTH') return false;
    if (cfg.questionMode === 'rapid_recall' && caseData.meta?.questionMode !== 'rapid_recall') return false;
    return true;
  }), [loadedCases]);

  const availableCases = useMemo(() => getPoolForConfig(config), [config, getPoolForConfig]);
  const presetCards = useMemo(
    () => PRESETS.map((preset) => {
      const presetConfig = buildPresetConfig(preset);
      const matchingCount = status === 'ready' ? getPoolForConfig(presetConfig).length : 0;
      return {
        ...preset,
        presetConfig,
        matchingCount,
        disabled: status !== 'ready' || matchingCount === 0,
      };
    }),
    [getPoolForConfig, status],
  );

  const currentCase = examQueue[examIdx] || null;
  const isReviewing = machineState === 'REVIEWING';
  const correctOption = currentCase?.options?.find((option) => option.is_correct) ?? null;
  const isCorrectAnswer = isReviewing && selectedAnswer === correctOption?.id;
  const examProgress = examQueue.length > 0 ? ((examIdx + 1) / examQueue.length) * 100 : 0;

  useEffect(() => {
    if (examState !== 'RUNNING') return undefined;

    timerRef.current = window.setInterval(() => {
      setTimeLeft((current) => {
        if (current <= 1) {
          window.clearInterval(timerRef.current);
          setExamState('RESULTS');
          return 0;
        }
        return current - 1;
      });
    }, 1000);

    return () => window.clearInterval(timerRef.current);
  }, [examState]);

  useEffect(() => {
    if (examState === 'RUNNING' && currentCase) {
      startCase(currentCase);
    }
  }, [currentCase, examState, startCase]);

  useEffect(() => {
    if (examState === 'RESULTS') {
      resetSession();
    }
  }, [examState, resetSession]);

  const formatTime = (seconds) => `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;

  const updateConfig = (updater) => {
    setExamNotice('');
    setConfig((current) => ({ ...current, ...updater }));
  };

  const startExam = useCallback((overrideConfig) => {
    const cfg = overrideConfig || config;

    if (status !== 'ready') {
      setExamNotice('Wait for the full case library to finish loading before starting exam mode.');
      return;
    }

    const pool = getPoolForConfig(cfg);
    if (pool.length === 0) {
      setExamNotice('No cases match the current exam settings.');
      return;
    }

    const shuffled = [...pool].sort(() => Math.random() - 0.5);
    const selected = shuffled.slice(0, Math.min(cfg.questionCount, shuffled.length));

    setExamNotice(
      selected.length < cfg.questionCount
        ? `Only ${selected.length} cases match these settings, so this block is shorter than requested.`
        : '',
    );
    resetSession();
    setExamQueue(selected);
    setExamIdx(0);
    setExamAnswers([]);
    setTimeLeft(cfg.timeLimit * 60);
    setExamState('RUNNING');
  }, [config, getPoolForConfig, resetSession, status]);

  const handleSubmit = () => {
    if (selectedAnswer === null || !currentCase) return;

    const isCorrect = selectedAnswer === correctOption?.id;
    setExamAnswers((current) => [...current, {
      caseId: currentCase._id,
      title: currentCase.title,
      category: currentCase.category,
      answer: selectedAnswer,
      correct: isCorrect,
    }]);
    submitAnswer();
  };

  const handleNext = () => {
    nextCase();
    if (examIdx + 1 < examQueue.length) {
      setExamIdx((current) => current + 1);
      return;
    }

    window.clearInterval(timerRef.current);
    setExamState('RESULTS');
  };

  const resetExam = () => {
    window.clearInterval(timerRef.current);
    resetSession();
    setExamState('CONFIG');
    setExamQueue([]);
    setExamIdx(0);
    setExamAnswers([]);
    setTimeLeft(0);
    setExamNotice('');
  };

  if (examState === 'RESULTS') {
    const correct = examAnswers.filter((answer) => answer.correct).length;
    const total = examAnswers.length;
    const pct = total > 0 ? Math.round((correct / total) * 100) : 0;
    const byCategory = {};

    examAnswers.forEach((answer) => {
      if (!byCategory[answer.category]) {
        byCategory[answer.category] = { total: 0, correct: 0 };
      }
      byCategory[answer.category].total += 1;
      if (answer.correct) byCategory[answer.category].correct += 1;
    });

    return (
      <div style={{ maxWidth: 800, margin: '0 auto' }}>
        <div className="glass-card" style={{ padding: 'var(--sp-8)', textAlign: 'center', marginBottom: 'var(--sp-6)' }}>
          <Trophy size={48} style={{ color: pct >= 70 ? 'var(--accent-success)' : 'var(--accent-warning)', marginBottom: 'var(--sp-4)' }} />
          <h1 style={{ fontSize: 'var(--fs-3xl)', marginBottom: 'var(--sp-2)' }}>Exam Complete!</h1>
          <div style={{ fontSize: 'var(--fs-5xl)', fontWeight: 800, marginBottom: 'var(--sp-2)', color: pct >= 70 ? 'var(--accent-success)' : pct >= 50 ? 'var(--accent-warning)' : 'var(--accent-danger)' }}>
            {pct}%
          </div>
          <p style={{ color: 'var(--text-muted)', marginBottom: 'var(--sp-6)' }}>
            {correct} of {total} correct | {pct >= 70 ? 'Excellent result' : pct >= 50 ? 'Solid effort, keep sharpening weak areas' : 'Review weak areas before the next block'}
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)', textAlign: 'left', marginBottom: 'var(--sp-6)' }}>
            {Object.entries(byCategory).sort((a, b) => b[1].total - a[1].total).map(([categoryKey, categoryStats]) => {
              const category = CATEGORIES[categoryKey] || { label: categoryKey, color: '#94a3b8' };
              const categoryPct = Math.round((categoryStats.correct / categoryStats.total) * 100);
              return (
                <div key={categoryKey} style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)' }}>
                  <span style={{ flex: 2, minWidth: 0, fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{category.label}</span>
                  <div style={{ flex: 3, minWidth: 80, height: 8, background: 'rgba(255,255,255,0.05)', borderRadius: 4 }}>
                    <div style={{ width: `${categoryPct}%`, height: '100%', background: category.color, borderRadius: 4, transition: 'width 0.5s' }} />
                  </div>
                  <span style={{ minWidth: 60, flex: '1 1 60px', textAlign: 'right', fontSize: 'var(--fs-sm)', fontWeight: 600 }}>{categoryStats.correct}/{categoryStats.total}</span>
                </div>
              );
            })}
          </div>

          <div style={{ display: 'flex', gap: 'var(--sp-3)', justifyContent: 'center' }}>
            <button className="btn btn-ghost btn-lg" onClick={resetExam}>
              <RotateCcw size={16} /> New Exam
            </button>
            <button className="btn btn-primary btn-lg" onClick={() => navigate('/analytics')}>
              <Home size={16} /> View Analytics
            </button>
          </div>
        </div>

        <div className="glass-card" style={{ padding: 'var(--sp-5)' }}>
          <h3 style={{ marginBottom: 'var(--sp-4)' }}>Question Review</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' }}>
            {examAnswers.map((answer, index) => (
              <div
                key={`${answer.caseId}-${index}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--sp-3)',
                  padding: 'var(--sp-2) var(--sp-3)',
                  borderRadius: 'var(--radius-md)',
                  background: answer.correct ? 'rgba(16,185,129,0.06)' : 'rgba(239,68,68,0.06)',
                  borderLeft: `3px solid ${answer.correct ? 'var(--accent-success)' : 'var(--accent-danger)'}`,
                }}
              >
                {answer.correct ? <CheckCircle size={16} style={{ color: 'var(--accent-success)' }} /> : <XCircle size={16} style={{ color: 'var(--accent-danger)' }} />}
                <span style={{ fontSize: 'var(--fs-sm)', flex: 1 }}>{answer.title}</span>
                <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>{answer.answer}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (examState === 'RUNNING' && currentCase) {
    const category = CATEGORIES[currentCase.category] ?? { label: currentCase.category, color: 'var(--text-muted)' };
    const vignette = currentCase.vignette ?? {};
    const demographics = vignette.demographics ?? {};
    const options = currentCase.options ?? [];
    const isFlashcardSprint = config.questionMode === 'rapid_recall';

    return (
      <div className={isFlashcardSprint ? 'flashcard-mode' : ''} style={{ maxWidth: 900, margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--sp-4)', flexWrap: 'wrap', gap: 'var(--sp-2)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)' }}>
            <span style={{ fontSize: 'var(--fs-sm)', fontWeight: 600 }}>Q{examIdx + 1}/{examQueue.length}</span>
            <span className="badge" style={{ background: `${category.color}15`, color: category.color }}>{category.label}</span>
            {isFlashcardSprint && (
              <span className="rapid-recall-badge">
                <Zap size={12} /> Rapid Recall
              </span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-4)' }}>
            <TimerRing value={timeLeft} max={config.timeLimit * 60} />
            <button className="btn btn-ghost" onClick={resetExam} style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>
              End
            </button>
          </div>
        </div>

        <div className="progress-bar" style={{ marginBottom: 'var(--sp-6)' }}>
          <div className="progress-bar-fill" style={{ width: `${examProgress}%` }} />
        </div>

        <div className="glass-card" style={{ padding: 'var(--sp-6)', marginBottom: 'var(--sp-6)' }}>
          <h2 style={{ fontSize: 'var(--fs-xl)', marginBottom: 'var(--sp-3)' }}>{currentCase.title}</h2>
          {!isFlashcardSprint && (demographics.age || demographics.sex) && (
            <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--accent-primary)', marginBottom: 'var(--sp-3)', display: 'inline-block' }}>
              {demographics.age && `${demographics.age}y`}
              {demographics.age && demographics.sex && '/'}
              {demographics.sex === 'M' ? 'Male' : demographics.sex === 'F' ? 'Female' : demographics.sex}
            </span>
          )}
          {!isFlashcardSprint && (
            <p style={{ lineHeight: 1.75, color: 'var(--text-secondary)' }}>{vignette.narrative || 'Case details unavailable.'}</p>
          )}
        </div>

        <div className="glass-card" style={{ padding: 'var(--sp-6)', marginBottom: 'var(--sp-6)' }}>
          <h3 style={{ fontSize: 'var(--fs-lg)', marginBottom: 'var(--sp-5)' }}>{currentCase.prompt}</h3>
          <div role="radiogroup" aria-label="Answer options" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
            {options.map((option) => {
              let className = 'option-card';
              if (selectedAnswer === option.id && !isReviewing) className += ' selected';
              if (isReviewing && option.is_correct) className += ' correct';
              if (isReviewing && selectedAnswer === option.id && !option.is_correct) className += ' incorrect';

              return (
                <button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={selectedAnswer === option.id}
                  aria-disabled={isReviewing}
                  className={className}
                  onClick={() => !isReviewing && selectAnswer(option.id)}
                  style={{ width: '100%', textAlign: 'left' }}
                >
                  <div className="option-letter">{option.id}</div>
                  <div style={{ flex: 1, fontSize: 'var(--fs-sm)', lineHeight: 1.5 }}>{option.text}</div>
                  {isReviewing && option.is_correct && <CheckCircle size={18} style={{ color: 'var(--accent-success)' }} />}
                  {isReviewing && selectedAnswer === option.id && !option.is_correct && <XCircle size={18} style={{ color: 'var(--accent-danger)' }} />}
                </button>
              );
            })}
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--sp-3)', marginTop: 'var(--sp-5)' }}>
            {!isReviewing && (
              <button className="btn btn-primary btn-lg" onClick={handleSubmit} disabled={selectedAnswer === null}>
                Submit Answer
              </button>
            )}
            {isReviewing && (
              <button className="btn btn-primary btn-lg" onClick={handleNext}>
                <ArrowRight size={18} /> {examIdx + 1 < examQueue.length ? 'Next Question' : 'Finish Exam'}
              </button>
            )}
          </div>

          {isReviewing && (
            <div
              style={{
                marginTop: 'var(--sp-4)',
                padding: 'var(--sp-4)',
                borderRadius: 'var(--radius-lg)',
                background: isCorrectAnswer ? 'rgba(16,185,129,0.08)' : 'rgba(239,68,68,0.08)',
                border: `1px solid ${isCorrectAnswer ? 'rgba(16,185,129,0.2)' : 'rgba(239,68,68,0.2)'}`,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', marginBottom: 'var(--sp-2)' }}>
                {isCorrectAnswer ? <CheckCircle size={20} color="var(--accent-success)" /> : <XCircle size={20} color="var(--accent-danger)" />}
                <strong style={{ color: isCorrectAnswer ? 'var(--accent-success)' : 'var(--accent-danger)' }}>
                  {isCorrectAnswer ? 'Correct!' : `Incorrect - Answer: ${correctOption?.id}`}
                </strong>
              </div>
              {currentCase.rationale?.correct && (
                <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)', lineHeight: 1.7 }}>
                  {currentCase.rationale.correct}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 800, margin: '0 auto' }}>
      <h1 className="page-title" style={{ marginBottom: 'var(--sp-2)' }}>
        <Clock size={28} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 'var(--sp-2)' }} />
        Exam Mode
      </h1>
      <p className="page-subtitle" style={{ marginBottom: 'var(--sp-8)' }}>
        Simulate real exam conditions with timed question blocks.
      </p>

      {status !== 'ready' && (
        <div className="glass-card" style={{ padding: 'var(--sp-3) var(--sp-4)', marginBottom: 'var(--sp-6)' }}>
          <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>
            {isLoading
              ? 'Loading the full case library. Exam generation unlocks automatically when the full pool is ready.'
              : 'Compiled case library is unavailable, so exam generation is limited right now.'}
          </span>
        </div>
      )}

      {examNotice && (
        <div className="glass-card" style={{ padding: 'var(--sp-4)', marginBottom: 'var(--sp-6)', borderTop: '3px solid var(--accent-warning)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', color: 'var(--accent-warning)', fontWeight: 600 }}>
            <AlertTriangle size={18} />
            <span>{examNotice}</span>
          </div>
        </div>
      )}

      <h3 style={{ fontSize: 'var(--fs-md)', marginBottom: 'var(--sp-4)' }}>Quick Start</h3>
      <div className="grid grid-2 stagger" style={{ marginBottom: 'var(--sp-8)' }}>
        {presetCards.map((preset) => (
          <button
            key={preset.label}
            type="button"
            className={`glass-card glass-card-interactive ${preset.questionMode === 'rapid_recall' ? 'preset-flashcard' : ''}`}
            disabled={preset.disabled}
            onClick={() => {
              setExamNotice('');
              setConfig(preset.presetConfig);
              startExam(preset.presetConfig);
            }}
            style={{
              padding: 'var(--sp-5)',
              textAlign: 'left',
              border: 'var(--border-glass)',
              opacity: preset.disabled ? 0.55 : 1,
              cursor: preset.disabled ? 'not-allowed' : 'pointer',
            }}
          >
            <div style={{ fontSize: 'var(--fs-sm)', fontWeight: 700, marginBottom: 'var(--sp-2)', color: 'var(--accent-primary)' }}>{preset.icon}</div>
            <h4 style={{ fontSize: 'var(--fs-base)', marginBottom: 'var(--sp-1)' }}>{preset.label}</h4>
            <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>
              {preset.questions} questions | {preset.time} min
              {preset.questionMode === 'rapid_recall' ? ' | 30s/q' : ''}
            </p>
            <div style={{ marginTop: 'var(--sp-2)', display: 'flex', alignItems: 'center', gap: 'var(--sp-1)', color: 'var(--accent-primary)', fontSize: 'var(--fs-xs)' }}>
              <Play size={12} />
              {preset.disabled ? 'Unlocks when the pool is ready' : `Ready with ${preset.matchingCount} matching cases`}
            </div>
          </button>
        ))}
      </div>

      <div className="glass-card" style={{ padding: 'var(--sp-6)', marginBottom: 'var(--sp-6)' }}>
        <h3 style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', fontSize: 'var(--fs-md)', marginBottom: 'var(--sp-5)' }}>
          <Settings size={18} /> Custom Exam
        </h3>

        <div className="grid grid-2" style={{ gap: 'var(--sp-4)', marginBottom: 'var(--sp-4)' }}>
          <div>
            <label htmlFor="exam-question-count" style={{ display: 'block', fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', marginBottom: 'var(--sp-2)' }}>
              Questions
            </label>
            <input
              id="exam-question-count"
              type="number"
              className="input"
              value={config.questionCount}
              min={1}
              max={100}
              onChange={(event) => updateConfig({ questionCount: Number.parseInt(event.target.value, 10) || 10 })}
            />
          </div>
          <div>
            <label htmlFor="exam-time-limit" style={{ display: 'block', fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', marginBottom: 'var(--sp-2)' }}>
              Time Limit (minutes)
            </label>
            <input
              id="exam-time-limit"
              type="number"
              className="input"
              value={config.timeLimit}
              min={5}
              max={200}
              onChange={(event) => updateConfig({ timeLimit: Number.parseInt(event.target.value, 10) || 30 })}
            />
          </div>
          <div>
            <label htmlFor="exam-category-filter" style={{ display: 'block', fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', marginBottom: 'var(--sp-2)' }}>
              Category
            </label>
            <select id="exam-category-filter" className="input" value={config.categories} onChange={(event) => updateConfig({ categories: event.target.value })}>
              <option value="all">All Categories</option>
              {Object.entries(CATEGORIES).map(([key, category]) => (
                <option key={key} value={key}>{category.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="exam-type-filter" style={{ display: 'block', fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', marginBottom: 'var(--sp-2)' }}>
              Exam Type
            </label>
            <select id="exam-type-filter" className="input" value={config.examType} onChange={(event) => updateConfig({ examType: event.target.value })}>
              <option value="all">All</option>
              <option value="UKMPPD">🇮🇩 UKMPPD</option>
              <option value="USMLE">🇺🇸 USMLE</option>
              <option value="MIR-Spain">🇪🇸 MIR-Spain</option>
              <option value="IgakuQA">🇯🇵 IgakuQA</option>
              <option value="International">🌍 International</option>
              <option value="Academic">📚 Academic</option>
              <option value="Research">🔬 Research</option>
              <option value="Clinical">🏥 Clinical</option>
            </select>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'var(--sp-4)', gap: 'var(--sp-4)', flexWrap: 'wrap' }}>
          <div>
            <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>
              {availableCases.length} cases available for your criteria
            </span>
            {status === 'ready' && availableCases.length > 0 && availableCases.length < config.questionCount && (
              <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--accent-warning)', marginTop: 'var(--sp-1)' }}>
                Requested {config.questionCount} questions, but only {availableCases.length} match the current filters.
              </div>
            )}
          </div>
          <button
            className="btn btn-primary btn-lg"
            onClick={() => startExam()}
            disabled={availableCases.length === 0 || status !== 'ready'}
          >
            <Play size={18} /> Start Exam
          </button>
        </div>
      </div>
    </div>
  );
}
