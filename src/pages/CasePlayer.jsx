/**
 * MedCase Pro — Case Player Page
 * Core vignette display + MCQ/SCT rendering + DFA state
 */
import { useEffect, useState, useMemo, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion as Motion, AnimatePresence } from 'framer-motion';
import { CATEGORIES, useCaseBank } from '../data/caseLoader';
import { useStore } from '../data/store';
import { updateReview } from '../data/fsrs';
import { ShortcutHints } from '../components/KeyboardShortcuts';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { QuestionFeedback } from '../components/QuestionFeedback';
import SmartVignette from '../components/SmartVignette';
import {
  User,
  Heart,
  Thermometer,
  Activity,
  Clock,
  Bookmark,
  Flag,
  ChevronRight,
  CheckCircle,
  XCircle,
  Lightbulb,
  ArrowRight,
  BookOpen,
  Star,
  AlertTriangle,
  Home,
  Lock,
  Zap,
} from 'lucide-react';

function VitalsBadge({ label, value, icon: Icon, alert }) {
  return (
    <div style={{
      padding: 'var(--sp-2) var(--sp-3)',
      borderRadius: 'var(--radius-md)',
      background: alert ? 'rgba(239,68,68,0.08)' : 'rgba(148,163,184,0.06)',
      border: alert ? '1px solid rgba(239,68,68,0.2)' : 'var(--border-subtle)',
      display: 'flex',
      alignItems: 'center',
      gap: 'var(--sp-2)',
      fontSize: 'var(--fs-sm)',
    }}>
      {Icon && <Icon size={14} style={{ color: alert ? 'var(--accent-danger)' : 'var(--text-muted)' }} />}
      <span style={{ color: 'var(--text-muted)' }}>{label}:</span>
      <span style={{ fontWeight: 600, color: alert ? 'var(--accent-danger)' : 'var(--text-primary)' }}>{value}</span>
    </div>
  );
}

/** Mini-PACS Clinical Image Viewer — Hack 3
 * - Pinch-to-zoom via react-zoom-pan-pinch
 * - Bone Window 🌓 (invert mode for radiology)
 * - PACS-dark background for X-rays/CT
 * - Image type badges
 * - Sticky positioning (image stays visible while scrolling options)
 */
function CaseImageGallery({ images, imageType }) {
  const [lightboxIdx, setLightboxIdx] = useState(null);
  const [inverted, setInverted] = useState(false);

  useEffect(() => {
    if (lightboxIdx === null) return;
    const handler = (e) => { if (e.key === 'Escape') setLightboxIdx(null); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [lightboxIdx]);

  const isPacs = imageType?.ui_mode === 'pacs_dark';
  const isEcg = imageType?.type === 'ECG';
  const typeBadge = imageType ? `${imageType.emoji} ${imageType.type}` : '📸 Clinical';

  return (
    <>
      <div className="case-image-gallery" style={{
        marginBottom: 'var(--sp-4)',
        position: 'sticky',
        top: 'var(--sp-3)',
        zIndex: 5,
      }}>
        {/* Image type badge + controls */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--sp-2)' }}>
          <span style={{
            fontSize: 'var(--fs-xs)', fontWeight: 700, padding: '2px 10px',
            borderRadius: 'var(--radius-sm)',
            background: isPacs ? 'rgba(0,0,0,0.6)' : isEcg ? 'rgba(37,99,235,0.1)' : 'rgba(148,163,184,0.08)',
            color: isPacs ? '#4ade80' : isEcg ? '#3b82f6' : 'var(--text-muted)',
            letterSpacing: '0.5px',
          }}>
            {typeBadge}
          </span>
          {isPacs && (
            <button
              onClick={() => setInverted(i => !i)}
              title="Bone Window (Invert) — radiologist technique for fracture detection"
              style={{
                background: inverted ? 'rgba(250,204,21,0.2)' : 'rgba(148,163,184,0.08)',
                border: inverted ? '1px solid rgba(250,204,21,0.4)' : 'var(--border-subtle)',
                borderRadius: 'var(--radius-sm)', padding: '4px 10px',
                cursor: 'pointer', fontSize: 'var(--fs-xs)', fontWeight: 600,
                color: inverted ? '#facc15' : 'var(--text-muted)',
                transition: 'all 0.2s',
              }}
            >
              🌓 {inverted ? 'Bone Window ON' : 'Invert'}
            </button>
          )}
        </div>

        {/* Image grid */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: images.length === 1 ? '1fr' : 'repeat(auto-fill, minmax(200px, 1fr))',
          gap: 'var(--sp-3)',
        }}>
          {images.map((img, idx) => (
            <div
              key={img}
              role="button"
              tabIndex={0}
              onClick={() => setLightboxIdx(idx)}
              onKeyDown={(e) => { if (e.key === 'Enter') setLightboxIdx(idx); }}
              style={{
                borderRadius: 'var(--radius-md)',
                overflow: 'hidden',
                border: isPacs ? '1px solid rgba(74,222,128,0.15)' : 'var(--border-subtle)',
                cursor: 'zoom-in',
                background: isPacs ? '#0a0a0a' : isEcg ? '#fefefe' : 'rgba(15,23,42,0.4)',
                transition: 'transform var(--duration-fast) var(--ease-out), box-shadow var(--duration-fast)',
              }}
              className="case-image-thumb"
            >
              <img
                src={`${import.meta.env.BASE_URL}images/cases/${img}`}
                alt={`${typeBadge} ${idx + 1}`}
                loading="lazy"
                style={{
                  width: '100%', height: 'auto', display: 'block',
                  maxHeight: 320, objectFit: 'contain',
                  background: isPacs ? '#000' : isEcg ? '#fff' : 'rgba(0,0,0,0.2)',
                  filter: inverted ? 'invert(100%)' : 'none',
                  transition: 'filter 0.3s ease',
                }}
              />
            </div>
          ))}
        </div>
        <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', marginTop: 'var(--sp-1)', display: 'block' }}>
          Click to zoom • {isPacs ? '🌓 Use Bone Window for fracture lines' : 'Pinch to zoom on mobile'}
        </span>
      </div>

      {/* Lightbox with Zoom+Pan */}
      {lightboxIdx !== null && (
        <div
          className="case-image-lightbox"
          onClick={() => setLightboxIdx(null)}
          role="dialog"
          aria-label="Image lightbox"
        >
          <div onClick={(e) => e.stopPropagation()} style={{ position: 'relative', maxWidth: '92vw', maxHeight: '92vh' }}>
            <img
              src={`${import.meta.env.BASE_URL}images/cases/${images[lightboxIdx]}`}
              alt={`${typeBadge} ${lightboxIdx + 1} (full size)`}
              style={{
                maxWidth: '90vw', maxHeight: '88vh',
                borderRadius: 'var(--radius-lg)', objectFit: 'contain',
                boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
                filter: inverted ? 'invert(100%)' : 'none',
                background: isPacs ? '#000' : isEcg ? '#fff' : 'transparent',
                transition: 'filter 0.3s ease',
                touchAction: 'pinch-zoom',
              }}
            />
            {/* Controls row */}
            <div style={{
              position: 'absolute', bottom: -40, left: 0, right: 0,
              display: 'flex', justifyContent: 'center', gap: 'var(--sp-2)',
            }}>
              {isPacs && (
                <button onClick={() => setInverted(i => !i)} style={{
                  background: 'rgba(255,255,255,0.1)', border: 'none',
                  color: inverted ? '#facc15' : '#fff', padding: '6px 16px',
                  borderRadius: 'var(--radius-md)', cursor: 'pointer', fontSize: 'var(--fs-sm)',
                  backdropFilter: 'blur(8px)', fontWeight: 600,
                }}>
                  🌓 Bone Window
                </button>
              )}
              {images.length > 1 && lightboxIdx > 0 && (
                <button onClick={() => setLightboxIdx(i => i - 1)} style={{
                  background: 'rgba(255,255,255,0.1)', border: 'none', color: '#fff',
                  padding: '6px 16px', borderRadius: 'var(--radius-md)', cursor: 'pointer',
                  backdropFilter: 'blur(8px)',
                }}>← Prev</button>
              )}
              {images.length > 1 && lightboxIdx < images.length - 1 && (
                <button onClick={() => setLightboxIdx(i => i + 1)} style={{
                  background: 'rgba(255,255,255,0.1)', border: 'none', color: '#fff',
                  padding: '6px 16px', borderRadius: 'var(--radius-md)', cursor: 'pointer',
                  backdropFilter: 'blur(8px)',
                }}>Next →</button>
              )}
            </div>
          </div>
          <button
            onClick={() => setLightboxIdx(null)}
            style={{
              position: 'absolute', top: 24, right: 24,
              background: 'rgba(255,255,255,0.1)', border: 'none',
              color: 'white', fontSize: 24, width: 44, height: 44,
              borderRadius: 'var(--radius-full)', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              backdropFilter: 'blur(8px)',
            }}
            aria-label="Close lightbox"
          >
            ✕
          </button>
        </div>
      )}
    </>
  );
}

export function CasePlayerSession({
  caseData,
  caseBank,
  navigate,
  machineState,
  selectedAnswer,
  startCase,
  selectAnswer,
  submitAnswer,
  nextCase,
  toggleBookmark,
  bookmarks,
  flagQuestion,
}) {
  const [timer, setTimer] = useState(0);
  const [showExplanation, setShowExplanation] = useState(false);
  const [fsrsGraded, setFsrsGraded] = useState(false);
  const [eliminated, setEliminated] = useState(new Set());

  // ── Stamina Analytics: track time per question ──
  const questionStartTime = useRef(Date.now());

  // Hack 1: Right-click to strike-through (Cognitive Offloader)
  const toggleEliminate = (e, optId) => {
    e.preventDefault();
    if (isReviewing) return;
    setEliminated(prev => {
      const next = new Set(prev);
      next.has(optId) ? next.delete(optId) : next.add(optId);
      return next;
    });
  };

  const cat = CATEGORIES[caseData.category] ?? {
    label: caseData.category ?? 'Unknown',
    color: 'var(--text-muted)',
  };
  const vignette = caseData.vignette ?? {};
  const demographics = vignette.demographics ?? {};
  const vitals = vignette.vitalSigns;
  const options = caseData.options ?? [];
  const rationale = caseData.rationale ?? { correct: '', distractors: {}, pearl: '' };
  const distractors = Object.entries(rationale.distractors ?? {});
  const provenance = caseData.meta?.provenance ?? [];
  const difficulty = caseData.meta?.difficulty ?? 0;
  const isBookmarked = bookmarks.includes(caseData._id);
  const correctOption = options.find((option) => option.is_correct) ?? null;
  const isReviewing = machineState === 'REVIEWING';
  const isCorrect = isReviewing && selectedAnswer === correctOption?.id;
  const isSCT = caseData.q_type === 'SCT';
  const isRapidRecall = caseData.meta?.questionMode === 'rapid_recall';
  
  // 🔥 Shuffle options strictly for display, mapping visual letters (A-E) to original IDs
  const { displayOptions, letterToActualIdMap } = useMemo(() => {
    const rawOptions = caseData.options ?? [];
    if (isSCT || rawOptions.length === 0) {
      return { 
        displayOptions: rawOptions.map(o => ({ ...o, displayLetter: o.id })), 
        letterToActualIdMap: Object.fromEntries(rawOptions.map(o => [o.id, o.id])) 
      };
    }
    
    // Fisher-Yates shuffle
    const shuffled = [...rawOptions];
    // Seed using case ID for stabile shuffle across re-renders
    let seed = String(caseData._id || '1').split('').reduce((a,b)=>a+b.charCodeAt(0),0);
    for (let i = shuffled.length - 1; i > 0; i--) {
      // Pseudo-random but deterministic for the current session to avoid mid-answer jumping
      const j = Math.floor(Math.abs(Math.sin(seed++) * 10000) % (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    
    const letters = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
    const map = {};
    const finalOptions = shuffled.map((opt, idx) => {
      const letter = letters[idx % letters.length];
      map[letter] = opt.id;
      return { ...opt, displayLetter: letter };
    });
    
    return { displayOptions: finalOptions, letterToActualIdMap: map };
  }, [caseData._id, caseData.options, isSCT]);

  const availableOptionIds = new Set(displayOptions.map((option) => option.id));

  useEffect(() => {
    startCase(caseData);
    questionStartTime.current = Date.now(); // reset timer for new case
    return () => {
      nextCase();
    };
  }, [caseData, nextCase, startCase]);

  useEffect(() => {
    if (machineState === 'READING' || machineState === 'ANSWERING') {
      const interval = window.setInterval(() => setTimer((current) => current + 1), 1000);
      return () => window.clearInterval(interval);
    }

    return undefined;
  }, [machineState]);

  const formatTime = (seconds) => `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;

  const handleSubmit = () => {
    if (selectedAnswer !== null) {
      // ── Stamina Analytics: record time spent ──
      const timeMs = Date.now() - questionStartTime.current;
      const correctOpt = caseData.options?.find(o => o.is_correct);
      const isCorrectAnswer = correctOpt?.id === selectedAnswer;
      try {
        const log = JSON.parse(localStorage.getItem('medcase_stamina_log') || '[]');
        log.push({
          caseId: caseData._id,
          case_code: caseData.case_code || null,
          category: caseData.category || null,
          timeMs,
          correct: isCorrectAnswer,
          timestamp: Date.now(),
        });
        // Keep last 5000 entries
        if (log.length > 5000) log.splice(0, log.length - 5000);
        localStorage.setItem('medcase_stamina_log', JSON.stringify(log));
      } catch { /* quota exceeded — skip */ }

      submitAnswer({ skipFsrsUpdate: true });
      setShowExplanation(false);
      setFsrsGraded(false);
    }
  };

  const handleNextCase = () => {
    const currentIdx = caseBank.findIndex((entry) => entry._id === caseData._id);
    // Skip quarantined/needs_review cases (P1 fix)
    for (let i = currentIdx + 1; i < caseBank.length; i++) {
      const next = caseBank[i];
      if (!next.meta?.quarantined && !next.meta?.needs_review) {
        navigate(`/case/${next._id}`);
        return;
      }
    }
    navigate('/cases');
  };

  const handleFSRSGrade = (grade) => {
    updateReview(caseData._id, grade);
    setFsrsGraded(true);
  };

  useKeyboardShortcuts({
    onSelect: (answerId) => {
      // answerId (A-E) must be mapped back to original ID for state machine
      const mappedId = letterToActualIdMap[answerId];
      if (isReviewing || !mappedId || !availableOptionIds.has(mappedId)) return;
      selectAnswer(mappedId);
    },
    onSubmit: handleSubmit,
    onNext: handleNextCase,
    onBack: () => navigate('/cases'),
    onBookmark: () => toggleBookmark(caseData._id),
    onFlag: () => flagQuestion(caseData._id, 'review'),
    onToggleExplanation: () => setShowExplanation((current) => !current),
    isReviewing,
    isAnswering: machineState === 'ANSWERING',
    selectedAnswer,
  });

  const getSCTBarWidth = (votes) => {
    const maxVotes = options.length > 0
      ? Math.max(...options.map((option) => option.sct_panel_votes || 0))
      : 0;
    return maxVotes > 0 ? (votes / maxVotes) * 100 : 0;
  };

  return (
    <div className={isRapidRecall ? 'flashcard-mode' : ''} style={{ maxWidth: 1400, margin: '0 auto' }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 'var(--sp-6)',
        flexWrap: 'wrap',
        gap: 'var(--sp-3)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)' }}>
          <button
            className="btn btn-ghost btn-icon"
            data-testid="case-player-back"
            aria-label="Back to Case Browser"
            onClick={() => navigate('/cases')}
          >
            <Home size={16} />
          </button>
          <span className="badge" style={{ background: `${cat.color}15`, color: cat.color }}>
            {cat.label}
          </span>
          <span className={`badge ${isSCT ? 'badge-warning' : caseData.q_type === 'CLINICAL_DISCUSSION' ? 'badge-success' : 'badge-info'}`}>
            {caseData.q_type === 'CLINICAL_DISCUSSION' ? 'Clinical' : caseData.q_type}
          </span>
          {isRapidRecall && (
            <span className="rapid-recall-badge">
              <Zap size={12} /> Rapid Recall
            </span>
          )}
          {caseData.meta?.source && caseData.meta.source !== 'manual' && (
            <span className="badge" style={{ background: 'rgba(6,182,212,0.1)', color: '#22d3ee', fontSize: '10px' }}>
              {caseData.meta.source}
            </span>
          )}
          <span
            className="badge"
            title={`Case Code: ${caseData.case_code || 'N/A'} • Internal _id: ${caseData._id} • Position ${(caseBank.findIndex(c => c._id === caseData._id) + 1)} of ${caseBank.length}`}
            style={{
              background: 'rgba(148,163,184,0.08)',
              color: 'var(--text-muted)',
              fontSize: '10px',
              fontFamily: 'monospace',
              cursor: 'pointer',
              userSelect: 'all',
              letterSpacing: '0.5px',
            }}
            onClick={() => {
              navigator.clipboard?.writeText(caseData.case_code || String(caseData._id));
            }}
          >
            {caseData.case_code || `#${caseData._id}`}
          </span>
          <span style={{ color: 'var(--accent-warning)', letterSpacing: '2px', fontSize: '0.85rem' }}>
            {'★'.repeat(difficulty)}{'☆'.repeat(3 - difficulty)}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)' }}>
          {/* Confidence badge */}
          {caseData.confidence > 0 && (
            <span style={{
              fontSize: 'var(--fs-xs)', padding: '2px 8px', borderRadius: 'var(--radius-full)',
              background: caseData.confidence >= 4 ? 'rgba(16,185,129,0.1)' : caseData.confidence >= 3 ? 'rgba(245,158,11,0.1)' : 'rgba(239,68,68,0.1)',
              color: caseData.confidence >= 4 ? '#34d399' : caseData.confidence >= 3 ? '#fbbf24' : '#f87171',
              fontWeight: 600,
            }}>
              {caseData.confidence >= 4 ? '✓ Verified' : caseData.confidence >= 3 ? '~ Review' : '⚠ Low'}
            </span>
          )}
          <div className="timer">
            <Clock size={14} />
            <span>{formatTime(timer)}</span>
          </div>
          <button
            className="btn btn-ghost btn-icon"
            onClick={() => toggleBookmark(caseData._id)}
            style={{ color: isBookmarked ? 'var(--accent-warning)' : 'var(--text-muted)' }}
          >
            <Bookmark size={16} fill={isBookmarked ? 'var(--accent-warning)' : 'none'} />
          </button>
          <button
            className="btn btn-ghost btn-icon"
            onClick={() => flagQuestion(caseData._id, 'review')}
            style={{ color: 'var(--text-muted)' }}
          >
            <Flag size={16} />
          </button>
        </div>
      </div>

      {/* Split-Pane: Vignette left, Interaction right on desktop */}
      <div className="case-player-split">
        <div className="vignette-pane">
          {/* Quarantine warning */}
          {caseData.meta?.quarantined && (
            <div style={{
              padding: 'var(--sp-3) var(--sp-4)',
              marginBottom: 'var(--sp-4)',
              borderRadius: 'var(--radius-md)',
              background: 'rgba(239,68,68,0.08)',
              border: '1px solid rgba(239,68,68,0.2)',
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--sp-2)',
              fontSize: 'var(--fs-sm)',
              color: '#f87171',
            }}>
              <AlertTriangle size={16} />
              <span><strong>Quarantined</strong> — {caseData.meta.quarantine_reason || 'data quality issue'}</span>
            </div>
          )}

          {/* FDA Graveyard — Historical Clinical Context banner */}
          {caseData.meta?.is_decayed && (
            <div style={{
              padding: 'var(--sp-3) var(--sp-4)',
              marginBottom: 'var(--sp-4)',
              borderRadius: 'var(--radius-md)',
              background: 'rgba(244,63,94,0.06)',
              borderLeft: '4px solid rgba(244,63,94,0.5)',
              display: 'flex',
              alignItems: 'flex-start',
              gap: 'var(--sp-3)',
              fontSize: 'var(--fs-sm)',
            }}>
              <span style={{ color: '#fb7185', flexShrink: 0, marginTop: 2 }}>⚠️</span>
              <div>
                <h4 style={{ color: '#fb7185', fontWeight: 700, fontSize: 'var(--fs-xs)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
                  Historical Clinical Context
                </h4>
                <p style={{ color: 'var(--text-secondary)', lineHeight: 1.6, margin: 0 }}>
                  Skenario ini mereferensikan pedoman/farmakologi yang mungkin sudah usang (obat ditarik FDA/BPOM, guideline lama).
                  Dipertahankan untuk melatih <strong style={{ color: 'var(--text-primary)' }}>penalaran patofisiologi dasar</strong>.
                </p>
              </div>
            </div>
          )}

          {/* Vignette Card */}
          {!isRapidRecall && (
            <Motion.div className="glass-card animate-fade-in-up" style={{ padding: 'var(--sp-6)', marginBottom: 'var(--sp-6)' }}>
          {/* VIGNETTE SUPREMACY: Detect title-narrative collision, swap title to generic label */}
          {(() => {
            const cleanTitle = (caseData.title || '').replace('...', '').trim();
            const isCollision = caseData.title === vignette.narrative ||
              (cleanTitle.length > 10 && vignette.narrative && vignette.narrative.startsWith(cleanTitle));
            return (
              <>
                <h2 style={{ fontSize: 'var(--fs-xl)', marginBottom: 'var(--sp-4)' }}>
                  {isCollision
                    ? `${(caseData.category || 'CLINICAL').toUpperCase()} CASE #${caseData.case_code || String(caseData._id).slice(-4)}`
                    : caseData.title}
                </h2>
                {(demographics.age !== null || demographics.sex) && (
                  <div style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 'var(--sp-2)',
                    padding: 'var(--sp-2) var(--sp-3)',
                    borderRadius: 'var(--radius-full)',
                    background: 'rgba(99,102,241,0.08)',
                    marginBottom: 'var(--sp-4)',
                    fontSize: 'var(--fs-sm)',
                    color: 'var(--accent-primary)',
                  }}>
                    <User size={14} />
                    {demographics.age !== null && <span>{demographics.age} years old</span>}
                    {demographics.age !== null && demographics.sex && <span>•</span>}
                    {demographics.sex && <span>{demographics.sex === 'M' ? 'Male' : 'Female'}</span>}
                  </div>
                )}
                {vignette.narrative && (
                  <p style={{
                    fontSize: 'var(--fs-base)',
                    lineHeight: 1.75,
                    color: 'var(--text-secondary)',
                    marginBottom: 'var(--sp-4)',
                  }}>
                    <SmartVignette text={vignette.narrative} />
                  </p>
                )}
              </>
            );
          })()}

          {/* Clinical Images Gallery */}
          {Array.isArray(caseData.images) && caseData.images.length > 0 && (
            <CaseImageGallery images={caseData.images} imageType={caseData.imageType} />
          )}

          {vitals && (
            <div style={{ marginBottom: 'var(--sp-4)' }}>
              <span style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--text-muted)', marginBottom: 'var(--sp-2)', display: 'block' }}>
                VITAL SIGNS
              </span>
              <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
                {vitals.bp && (
                  <VitalsBadge label="BP" value={vitals.bp} icon={Activity} alert={Number.parseInt(vitals.bp, 10) < 90} />
                )}
                {vitals.hr !== null && vitals.hr !== undefined && (
                  <VitalsBadge label="HR" value={`${vitals.hr} bpm`} icon={Heart} alert={vitals.hr > 100 || vitals.hr < 60} />
                )}
                {vitals.rr !== null && vitals.rr !== undefined && (
                  <VitalsBadge label="RR" value={`${vitals.rr}/min`} alert={vitals.rr > 24} />
                )}
                {vitals.spo2 !== null && vitals.spo2 !== undefined && (
                  <VitalsBadge label="SpO2" value={`${vitals.spo2}%`} alert={vitals.spo2 < 94} />
                )}
                {vitals.temp !== null && vitals.temp !== undefined && (
                  <VitalsBadge label="Temp" value={`${vitals.temp}°C`} icon={Thermometer} alert={vitals.temp > 38} />
                )}
              </div>
            </div>
          )}

          {vignette.labFindings && (
            <div>
              <span style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--text-muted)', marginBottom: 'var(--sp-2)', display: 'block' }}>
                LABORATORY / INVESTIGATIONS
              </span>
              <div style={{
                padding: 'var(--sp-3) var(--sp-4)',
                borderRadius: 'var(--radius-md)',
                background: 'rgba(15,23,42,0.4)',
                border: 'var(--border-subtle)',
                fontSize: 'var(--fs-sm)',
                color: 'var(--text-secondary)',
                lineHeight: 1.7,
                fontFamily: 'var(--font-mono)',
              }}>
                {vignette.labFindings}
              </div>
            </div>
          )}
        </Motion.div>
      )}
        </div>{/* end vignette-pane */}

        <div className="interaction-pane">

      {/* Rapid Recall countdown bar */}
      {isRapidRecall && (
        <div className="flashcard-countdown">
          <div className="flashcard-countdown-fill" style={{ '--countdown-duration': '30s' }} />
        </div>
      )}

      <Motion.div className="glass-card animate-fade-in-up" style={{ animationDelay: '100ms', padding: 'var(--sp-6)', marginBottom: 'var(--sp-6)' }}>
        <h3 style={{ fontSize: 'var(--fs-lg)', marginBottom: 'var(--sp-5)', fontWeight: 600 }}>
          {/* For rapid recall: show narrative as prompt since vignette card is hidden */}
          {isRapidRecall && vignette.narrative
            ? vignette.narrative
            : (caseData.prompt === caseData.title || caseData.prompt === vignette.narrative
              ? 'Review this case and choose the best answer.'
              : caseData.prompt)}
        </h3>

        {!isSCT && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gridAutoRows: '1fr', gap: 'var(--sp-3)' }}>
            {displayOptions.map((opt) => {
              let optionClass = 'option-card';
              if (selectedAnswer === opt.id && !isReviewing) optionClass += ' selected';
              if (isReviewing && opt.is_correct) optionClass += ' correct';
              if (isReviewing && selectedAnswer === opt.id && !opt.is_correct) optionClass += ' incorrect';

              const isEliminated = eliminated.has(opt.id);

              return (
                <Motion.div
                  key={opt.id}
                  className={optionClass}
                  onClick={() => !isReviewing && !isEliminated && selectAnswer(opt.id)}
                  onContextMenu={(e) => toggleEliminate(e, opt.id)}
                  whileHover={!isReviewing && !isEliminated ? { scale: 1.005 } : {}}
                  whileTap={!isReviewing && !isEliminated ? { scale: 0.995 } : {}}
                  style={{
                    ...(isReviewing && opt.is_correct ? { animation: 'correctPulse 0.6s ease-out' } : {}),
                    ...(isEliminated && !isReviewing ? {
                      opacity: 0.35,
                      filter: 'grayscale(0.8)',
                      cursor: 'not-allowed',
                      position: 'relative',
                    } : {}),
                  }}
                  title={!isReviewing ? 'Right-click to eliminate' : ''}
                >
                  <div className="option-letter" style={isEliminated && !isReviewing ? { opacity: 0.5 } : {}}>{opt.displayLetter}</div>
                  <div style={{
                    flex: 1, fontSize: 'var(--fs-sm)', lineHeight: 1.5,
                    textDecoration: isEliminated && !isReviewing ? 'line-through' : 'none',
                    textDecorationColor: 'var(--accent-danger)',
                    textDecorationThickness: '2px',
                  }}>{opt.text}</div>
                  {isReviewing && opt.is_correct && <CheckCircle size={18} style={{ color: 'var(--accent-success)' }} />}
                  {isReviewing && selectedAnswer === opt.id && !opt.is_correct && <XCircle size={18} style={{ color: 'var(--accent-danger)' }} />}
                </Motion.div>
              );
            })}
          </div>
        )}

        {isSCT && (
          <div>
            <div className="sct-scale">
              {displayOptions.map((opt) => {
                let cls = 'sct-option';
                if (selectedAnswer === opt.id && !isReviewing) cls += ' selected';
                if (isReviewing && opt.is_correct) cls += ' selected';

                return (
                  <Motion.div
                    key={opt.id}
                    className={cls}
                    onClick={() => !isReviewing && selectAnswer(opt.id)}
                    whileHover={!isReviewing ? { scale: 1.05 } : {}}
                    whileTap={!isReviewing ? { scale: 0.95 } : {}}
                  >
                    <span className="sct-value">{opt.id}</span>
                    <span className="sct-label" style={{ maxWidth: 80 }}>{opt.text}</span>
                  </Motion.div>
                );
              })}
            </div>

            {isReviewing && (
              <Motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} style={{ marginTop: 'var(--sp-4)' }}>
                <span style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--text-muted)', marginBottom: 'var(--sp-3)', display: 'block' }}>
                  Expert Panel Distribution (n=15)
                </span>
                {displayOptions.map((opt) => (
                  <div key={opt.id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', marginBottom: 'var(--sp-2)' }}>
                    <span style={{ width: 30, fontSize: 'var(--fs-sm)', fontWeight: 600, textAlign: 'center' }}>{opt.id}</span>
                    <div style={{ flex: 1, height: 20, borderRadius: 'var(--radius-sm)', background: 'rgba(148,163,184,0.08)', overflow: 'hidden' }}>
                      <Motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${getSCTBarWidth(opt.sct_panel_votes)}%` }}
                        transition={{ delay: 0.3, duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
                        style={{
                          height: '100%',
                          borderRadius: 'var(--radius-sm)',
                          background: opt.is_correct
                            ? 'linear-gradient(90deg, var(--accent-success), #059669)'
                            : 'linear-gradient(90deg, var(--accent-primary), var(--accent-secondary))',
                        }}
                      />
                    </div>
                    <span style={{ width: 30, fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', textAlign: 'center' }}>
                      {opt.sct_panel_votes}
                    </span>
                  </div>
                ))}
              </Motion.div>
            )}
          </div>
        )}

        <div className="case-action-bar" style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--sp-3)', marginTop: 'var(--sp-6)' }}>
          {!isReviewing && (
            <button className="btn btn-primary btn-lg" onClick={handleSubmit} disabled={selectedAnswer === null} style={{ opacity: selectedAnswer === null ? 0.5 : 1 }}>
              <ChevronRight size={18} /> Submit Answer
            </button>
          )}

          {isReviewing && (
            <>
              <button className="btn btn-ghost btn-lg" onClick={() => setShowExplanation((current) => !current)}>
                <Lightbulb size={16} /> {showExplanation ? 'Hide' : 'Show'} Explanation
              </button>
              <button className="btn btn-primary btn-lg" onClick={handleNextCase}>
                <ArrowRight size={18} /> Next Case
              </button>
            </>
          )}
        </div>

        {isReviewing && !fsrsGraded && (
          <div style={{
            marginTop: 'var(--sp-4)',
            padding: 'var(--sp-3) var(--sp-4)',
            borderRadius: 'var(--radius-lg)',
            background: 'rgba(99,102,241,0.05)',
            border: '1px solid rgba(99,102,241,0.1)',
          }}>
            <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', fontWeight: 600, marginBottom: 'var(--sp-2)', display: 'block' }}>
              How well did you know this?
            </span>
            <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
              {[
                { grade: 1, label: 'Forgot', color: 'var(--accent-danger)', bg: 'rgba(239,68,68,0.1)' },
                { grade: 2, label: 'Hard', color: 'var(--accent-warning)', bg: 'rgba(245,158,11,0.1)' },
                { grade: 3, label: 'Good', color: 'var(--accent-success)', bg: 'rgba(16,185,129,0.1)' },
                { grade: 4, label: 'Easy', color: 'var(--accent-info)', bg: 'rgba(56,189,248,0.1)' },
              ].map((gradeConfig) => (
                <button
                  key={gradeConfig.grade}
                  className="btn"
                  onClick={() => handleFSRSGrade(gradeConfig.grade)}
                  style={{
                    flex: 1,
                    background: gradeConfig.bg,
                    color: gradeConfig.color,
                    border: `1px solid ${gradeConfig.color}25`,
                    fontSize: 'var(--fs-sm)',
                  }}
                >
                  {gradeConfig.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {isReviewing && fsrsGraded && (
          <div style={{ marginTop: 'var(--sp-3)', fontSize: 'var(--fs-xs)', color: 'var(--accent-success)', textAlign: 'center' }}>
            Memory updated via FSRS v5
          </div>
        )}

        <ShortcutHints isReviewing={isReviewing} isSCT={isSCT} />

        {/* Question Feedback — chess-puzzle style */}
        {isReviewing && (
          <QuestionFeedback caseId={caseData._id} />
        )}
      </Motion.div>

      <AnimatePresence>
        {isReviewing && (
          <Motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            className="glass-card"
            style={{
              padding: 'var(--sp-5)',
              marginBottom: 'var(--sp-6)',
              background: isCorrect ? 'rgba(16,185,129,0.08)' : 'rgba(239,68,68,0.08)',
              border: isCorrect ? '1px solid rgba(16,185,129,0.2)' : '1px solid rgba(239,68,68,0.2)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', marginBottom: 'var(--sp-2)' }}>
              {isCorrect
                ? <CheckCircle size={24} style={{ color: 'var(--accent-success)' }} />
                : <XCircle size={24} style={{ color: 'var(--accent-danger)' }} />}
              <h3 style={{ color: isCorrect ? 'var(--accent-success)' : 'var(--accent-danger)' }}>
                {isCorrect ? 'Correct!' : 'Incorrect'}
              </h3>
              <span style={{ marginLeft: 'auto', fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>
                Time: {formatTime(timer)}
              </span>
            </div>

            {!isCorrect && (
              <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)' }}>
                The correct answer is <strong style={{ color: 'var(--accent-success)' }}>{correctOption?.id ?? 'N/A'}: {correctOption?.text ?? 'Unavailable'}</strong>
              </p>
            )}
          </Motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isReviewing && showExplanation && (
          <ExplanationPanel
            rationale={rationale}
            correctOption={correctOption}
            distractors={distractors}
            provenance={provenance}
          />
        )}
      </AnimatePresence>
        </div>{/* end interaction-pane */}
      </div>{/* end case-player-split */}
    </div>
  );
}

// Placeholder detection — these aren't real explanations
const PLACEHOLDER_PATTERNS = [
  'see reference for detailed explanation',
  'explanation unavailable',
  'no explanation available',
  'refer to textbook',
];

function isPlaceholderExplanation(text) {
  if (!text || text.length < 15) return true;
  const lower = text.toLowerCase().trim();
  return PLACEHOLDER_PATTERNS.some((p) => lower.includes(p));
}

/**
 * 🔥 Hack 5: Render-level auto-bold for medical terms
 * Highlights drug classes, lab values, and clinical keywords WITHOUT modifying source data
 */
const MEDICAL_HIGHLIGHT_RE = /\b([A-Z][a-z]*(?:olol|pril|sartan|cillin|mycin|floxacin|azole|tidine|prazole|navir|statin|dipine|lukast|gliptin|glutide|mab|nib))\b|\b(Hb|WBC|RBC|Platelet|BUN|GFR|HbA1c|INR|PT|aPTT|ESR|CRP|TSH|T3|T4|ALT|AST|LDH|CK-MB|BNP|SpO2|PaO2|PaCO2|FEV1|FVC|BMI)\b|\b(Gold Standard|First.?line|Second.?line|Drug of choice|Pathognomonic|Contraindicated)\b/g;

const HIGHLIGHT_STYLE = {
  color: 'var(--accent-warning, #f59e0b)',
  fontWeight: 600,
  background: 'rgba(245,158,11,0.08)',
  padding: '0 3px',
  borderRadius: '3px',
};

function MedText({ text }) {
  if (!text) return null;
  const parts = [];
  let lastIndex = 0;

  // Reset regex
  MEDICAL_HIGHLIGHT_RE.lastIndex = 0;
  let match;
  while ((match = MEDICAL_HIGHLIGHT_RE.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    parts.push(
      <span key={match.index} style={HIGHLIGHT_STYLE}>{match[0]}</span>
    );
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts.length > 0 ? <>{parts}</> : <>{text}</>;
}

/**
 * ExplanationPanel — Progressive Disclosure + Clinical Pearl First
 * 
 * AAA Concepts adopted:
 *  1. Progressive Disclosure: long EBM text hidden behind "Unlock" button
 *  2. Clinical Pearl promoted ABOVE full explanation as key takeaway
 *  3. Placeholder detection: honest "no explanation" notice
 */
function ExplanationPanel({ rationale, correctOption, distractors, provenance }) {
  const [isDecrypted, setIsDecrypted] = useState(false);
  const hasRealExplanation = !isPlaceholderExplanation(rationale.correct);
  const isLongExplanation = hasRealExplanation && rationale.correct.length > 200;
  const hasPearl = rationale.pearl && rationale.pearl.length > 5;

  return (
    <Motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      className="glass-card"
      style={{ padding: 'var(--sp-6)', marginBottom: 'var(--sp-6)', overflow: 'hidden' }}
    >
      {/* 🌟 Clinical Pearl FIRST — the key takeaway */}
      {hasPearl && (
        <div style={{
          padding: 'var(--sp-4) var(--sp-5)',
          marginBottom: 'var(--sp-5)',
          background: 'rgba(245,158,11,0.08)',
          border: '1px solid rgba(245,158,11,0.2)',
          borderRadius: 'var(--radius-lg)',
          borderLeft: '4px solid var(--accent-warning)',
        }}>
          <h4 style={{
            display: 'flex', alignItems: 'center', gap: 'var(--sp-2)',
            marginBottom: 'var(--sp-2)', color: 'var(--accent-warning)',
            fontSize: 'var(--fs-xs)', fontWeight: 700,
            letterSpacing: '0.08em', textTransform: 'uppercase',
          }}>
            <Lightbulb size={14} /> Clinical Pearl
          </h4>
          <p style={{
            fontSize: 'var(--fs-base)', lineHeight: 1.7,
            color: 'var(--text-primary)', fontStyle: 'italic', fontWeight: 500,
          }}>
            &ldquo;{rationale.pearl}&rdquo;
          </p>
        </div>
      )}

      {/* Main explanation section */}
      {hasRealExplanation ? (
        <>
          {/* Short explanation → show directly */}
          {!isLongExplanation && (
            <div style={{ marginBottom: 'var(--sp-4)' }}>
              <h3 style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', marginBottom: 'var(--sp-3)', color: 'var(--accent-success)' }}>
                <CheckCircle size={18} /> {correctOption?.id ? `Why ${correctOption.id} is correct` : 'Explanation'}
              </h3>
              <p style={{ fontSize: 'var(--fs-sm)', lineHeight: 1.8, color: 'var(--text-secondary)' }}>
                <MedText text={rationale.correct} />
              </p>
            </div>
          )}

          {/* Long explanation → Progressive Disclosure */}
          {isLongExplanation && !isDecrypted && (
            <button
              type="button"
              onClick={() => setIsDecrypted(true)}
              style={{
                width: '100%', padding: 'var(--sp-4)',
                border: '1px dashed rgba(6,182,212,0.4)',
                borderRadius: 'var(--radius-lg)',
                background: 'rgba(6,182,212,0.05)',
                color: 'rgba(6,182,212,0.8)',
                cursor: 'pointer', fontSize: 'var(--fs-sm)',
                fontWeight: 600, letterSpacing: '0.05em',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 'var(--sp-2)',
                transition: 'all var(--duration-fast)',
                marginBottom: 'var(--sp-4)',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'rgba(6,182,212,0.8)'; e.currentTarget.style.background = 'rgba(6,182,212,0.1)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'rgba(6,182,212,0.4)'; e.currentTarget.style.background = 'rgba(6,182,212,0.05)'; }}
            >
              <Lock size={16} /> Unlock Full Clinical Rationale
            </button>
          )}

          {isLongExplanation && isDecrypted && (
            <Motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}>
              <div style={{ marginBottom: 'var(--sp-4)' }}>
                <h3 style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', marginBottom: 'var(--sp-3)', color: 'var(--accent-success)' }}>
                  <CheckCircle size={18} /> {correctOption?.id ? `Why ${correctOption.id} is correct` : 'Explanation'}
                </h3>
                <p style={{ fontSize: 'var(--fs-sm)', lineHeight: 1.8, color: 'var(--text-secondary)' }}>
                  <MedText text={rationale.correct} />
                </p>
              </div>
            </Motion.div>
          )}
        </>
      ) : (
        /* No real explanation — honest notice */
        <div style={{
          padding: 'var(--sp-4)', marginBottom: 'var(--sp-4)',
          background: 'rgba(148,163,184,0.06)',
          border: '1px solid rgba(148,163,184,0.1)',
          borderRadius: 'var(--radius-lg)',
          textAlign: 'center',
        }}>
          <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', margin: 0 }}>
            <BookOpen size={14} style={{ display: 'inline', verticalAlign: '-2px', marginRight: 6 }} />
            No detailed explanation available for this source.
            {correctOption && (
              <span> The correct answer is <strong style={{ color: 'var(--accent-success)' }}>{correctOption.id}: {correctOption.text}</strong>.</span>
            )}
          </p>
        </div>
      )}

      {/* Distractor explanations */}
      {(isDecrypted || !isLongExplanation) && distractors.map(([key, text]) => (
        <div key={key} style={{ marginBottom: 'var(--sp-4)' }}>
          <h4 style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', marginBottom: 'var(--sp-2)', fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>
            <XCircle size={14} style={{ color: 'var(--accent-danger)' }} />
            Why {key} is wrong
          </h4>
          <p style={{ fontSize: 'var(--fs-sm)', lineHeight: 1.7, color: 'var(--text-muted)', paddingLeft: 22 }}>
            <MedText text={text} />
          </p>
        </div>
      ))}

      {/* References */}
      {provenance.length > 0 && (
        <div style={{ marginTop: 'var(--sp-4)' }}>
          <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            References
          </span>
          <div style={{ marginTop: 'var(--sp-2)', display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
            {provenance.map((ref, i) => (
              <span key={i} style={{
                fontSize: 'var(--fs-xs)', padding: '4px 8px',
                borderRadius: 'var(--radius-sm)',
                background: 'rgba(148,163,184,0.06)',
                color: 'var(--text-muted)', border: 'var(--border-subtle)',
              }}>
                {ref}
              </span>
            ))}
          </div>
        </div>
      )}
    </Motion.div>
  );
}

export default function CasePlayer() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { cases: caseBank, isLoading, error } = useCaseBank();
  // String-safe ID comparison — handles numeric (_id), string IDs, AND case_code (e.g. MMC-IPD-MCQ-07537)
  const caseData = caseBank.find((entry) =>
    String(entry._id ?? entry.id) === String(id) || entry.case_code === id
  ) ?? null;
  const {
    machineState,
    selectedAnswer,
    startCase,
    selectAnswer,
    submitAnswer,
    nextCase,
    toggleBookmark,
    bookmarks,
    flagQuestion,
  } = useStore();

  if (!caseData && isLoading) {
    return (
      <div className="glass-card" style={{ padding: 'var(--sp-12)', textAlign: 'center' }}>
        <BookOpen size={48} style={{ color: 'var(--accent-primary)', marginBottom: 'var(--sp-4)' }} />
        <h2>Loading Case Library</h2>
        <p style={{ color: 'var(--text-muted)', marginTop: 'var(--sp-2)' }}>
          Fetching the full case library so case {id} can open safely.
        </p>
      </div>
    );
  }

  if (!caseData) {
    return (
      <div className="glass-card" style={{ padding: 'var(--sp-12)', textAlign: 'center' }}>
        <AlertTriangle size={48} style={{ color: 'var(--accent-warning)', marginBottom: 'var(--sp-4)' }} />
        <h2>{error ? 'Case Library Unavailable' : 'Case Not Found'}</h2>
        <p style={{ color: 'var(--text-muted)', marginTop: 'var(--sp-2)', marginBottom: 'var(--sp-6)' }}>
          {error
            ? 'The compiled case library could not be loaded, so this case is not available right now.'
            : `The clinical case with ID ${id} does not exist.`}
        </p>
        <button className="btn btn-primary" onClick={() => navigate('/cases')}>
          <BookOpen size={16} /> Browse Cases
        </button>
      </div>
    );
  }

  return (
    <CasePlayerSession
      key={caseData._id}
      caseData={caseData}
      caseBank={caseBank}
      navigate={navigate}
      machineState={machineState}
      selectedAnswer={selectedAnswer}
      startCase={startCase}
      selectAnswer={selectAnswer}
      submitAnswer={submitAnswer}
      nextCase={nextCase}
      toggleBookmark={toggleBookmark}
      bookmarks={bookmarks}
      flagQuestion={flagQuestion}
    />
  );
}
