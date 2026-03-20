/**
 * QuestionFeedback — Chess-puzzle-style feedback panel
 * Appears during REVIEWING state, lets users tag question quality issues.
 * Persisted to localStorage as `mc_feedback`.
 */
import { useState, useEffect, useRef } from 'react';
import { motion as Motion, AnimatePresence } from 'framer-motion';
import MessageSquare from 'lucide-react/dist/esm/icons/message-square';
import X from 'lucide-react/dist/esm/icons/x';
import Send from 'lucide-react/dist/esm/icons/send';
import Check from 'lucide-react/dist/esm/icons/check';

const FEEDBACK_TAGS = [
  { id: 'wrong_answer',  emoji: '❌', label: 'Kunci Salah',       color: '#ef4444' },
  { id: 'unclear',       emoji: '😵', label: 'Soal Membingungkan', color: '#f59e0b' },
  { id: 'incomplete',    emoji: '📝', label: 'Tidak Lengkap',      color: '#f97316' },
  { id: 'bad_options',   emoji: '🤷', label: 'Opsi Buruk',         color: '#a855f7' },
  { id: 'bad_rationale', emoji: '📖', label: 'Penjelasan Kurang',  color: '#6366f1' },
  { id: 'duplicate',     emoji: '♊', label: 'Duplikat',            color: '#64748b' },
  { id: 'excellent',     emoji: '🌟', label: 'Soal Bagus!',        color: '#10b981' },
];

const STORAGE_KEY = 'mc_feedback';
const srOnlyStyle = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0, 0, 0, 0)',
  whiteSpace: 'nowrap',
  border: 0,
};

function loadFeedback() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  } catch { return {}; }
}

function saveFeedback(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

async function syncToServer(caseId, tags, comment) {
  try {
    await fetch('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ case_id: caseId, tags, comment }),
    });
    return true;
  } catch {
    return false;
  }
}

export function QuestionFeedback({ caseId }) {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedTags, setSelectedTags] = useState([]);
  const [comment, setComment] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [existingFeedback, setExistingFeedback] = useState(null);
  const closeTimerRef = useRef(null);

  useEffect(() => {
    window.clearTimeout(closeTimerRef.current);
    const all = loadFeedback();
    if (all[caseId]) {
      setExistingFeedback(all[caseId]);
      setSelectedTags(all[caseId].tags || []);
      setComment(all[caseId].comment || '');
    } else {
      setExistingFeedback(null);
      setSelectedTags([]);
      setComment('');
    }
    setSubmitted(false);
    setIsOpen(false);
    return () => window.clearTimeout(closeTimerRef.current);
  }, [caseId]);

  const toggleTag = (tagId) => {
    setSelectedTags(prev =>
      prev.includes(tagId) ? prev.filter(t => t !== tagId) : [...prev, tagId]
    );
  };

  const handleSubmit = async () => {
    if (selectedTags.length === 0 && !comment.trim()) return;
    const all = loadFeedback();
    all[caseId] = {
      tags: selectedTags,
      comment: comment.trim(),
      timestamp: Date.now(),
    };
    saveFeedback(all);
    setExistingFeedback(all[caseId]);
    setSubmitted(true);

    // Sync to backend (fire-and-forget with fallback)
    await syncToServer(caseId, selectedTags, comment.trim());

    window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = window.setTimeout(() => setIsOpen(false), 1200);
  };

  const handleClear = () => {
    const all = loadFeedback();
    delete all[caseId];
    saveFeedback(all);
    setExistingFeedback(null);
    setSelectedTags([]);
    setComment('');
    setSubmitted(false);
  };

  const feedbackCount = Object.keys(loadFeedback()).length;

  return (
    <div style={{ marginTop: 'var(--sp-3)' }}>
      {/* Trigger Button */}
      <button
        type="button"
        onClick={() => setIsOpen(o => !o)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--sp-2)',
          padding: 'var(--sp-2) var(--sp-3)',
          background: existingFeedback 
            ? 'rgba(99,102,241,0.12)' 
            : 'rgba(148,163,184,0.06)',
          border: existingFeedback
            ? '1px solid rgba(99,102,241,0.25)'
            : '1px solid rgba(148,163,184,0.12)',
          borderRadius: 'var(--radius-md)',
          cursor: 'pointer',
          fontSize: 'var(--fs-xs)',
          color: existingFeedback ? 'var(--accent-primary)' : 'var(--text-muted)',
          fontWeight: 500,
          transition: 'all 0.2s ease',
          width: '100%',
          justifyContent: 'center',
        }}
        className="feedback-trigger"
      >
        <MessageSquare size={13} />
        {existingFeedback 
          ? `Feedback Tersimpan (${existingFeedback.tags.length} tag)` 
          : 'Beri Feedback Soal'}
        {feedbackCount > 0 && !existingFeedback && (
          <span style={{
            fontSize: '10px',
            padding: '1px 6px',
            borderRadius: 'var(--radius-full)',
            background: 'rgba(99,102,241,0.15)',
            color: 'var(--accent-primary)',
            fontWeight: 700,
          }}>
            {feedbackCount} total
          </span>
        )}
      </button>

      {/* Feedback Panel */}
      <AnimatePresence>
        {isOpen && (
          <Motion.div
            initial={{ opacity: 0, height: 0, marginTop: 0 }}
            animate={{ opacity: 1, height: 'auto', marginTop: 12 }}
            exit={{ opacity: 0, height: 0, marginTop: 0 }}
            style={{ overflow: 'hidden' }}
          >
            <div style={{
              padding: 'var(--sp-4)',
              borderRadius: 'var(--radius-lg)',
              background: 'rgba(15,23,42,0.5)',
              border: '1px solid rgba(99,102,241,0.15)',
              backdropFilter: 'blur(12px)',
            }} role="dialog" aria-label="Question quality feedback">
              {/* Header */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 'var(--sp-3)',
              }}>
                <span style={{
                  fontSize: 'var(--fs-xs)',
                  fontWeight: 700,
                  color: 'var(--text-muted)',
                  letterSpacing: '0.05em',
                  textTransform: 'uppercase',
                }}>
                  📋 Feedback Kualitas Soal
                </span>
                <button
                  type="button"
                  aria-label="Close feedback panel"
                  onClick={() => setIsOpen(false)}
                  style={{
                    background: 'none', border: 'none',
                    color: 'var(--text-muted)', cursor: 'pointer',
                    padding: 2, display: 'flex',
                  }}
                >
                  <X size={14} />
                </button>
              </div>

              {/* Submitted State */}
              {submitted ? (
                <Motion.div
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  style={{
                    textAlign: 'center',
                    padding: 'var(--sp-4)',
                    color: 'var(--accent-success)',
                  }}
                >
                  <Check size={32} style={{ marginBottom: 8 }} />
                  <div style={{ fontSize: 'var(--fs-sm)', fontWeight: 600 }}>
                    Feedback Tersimpan! 🎉
                  </div>
                  <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', marginTop: 4 }}>
                    Terima kasih atas kontribusinya
                  </div>
                </Motion.div>
              ) : (
                <>
                  {/* Quick Tags */}
                  <div style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 'var(--sp-2)',
                    marginBottom: 'var(--sp-3)',
                  }}>
                    {FEEDBACK_TAGS.map(tag => {
                      const active = selectedTags.includes(tag.id);
                      return (
                        <button
                          key={tag.id}
                          type="button"
                          aria-pressed={active}
                          onClick={() => toggleTag(tag.id)}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                            padding: '6px 12px',
                            borderRadius: 'var(--radius-full)',
                            border: `1px solid ${active ? tag.color + '60' : 'rgba(148,163,184,0.15)'}`,
                            background: active ? tag.color + '18' : 'rgba(148,163,184,0.04)',
                            color: active ? tag.color : 'var(--text-secondary)',
                            fontSize: '12px',
                            fontWeight: active ? 600 : 400,
                            cursor: 'pointer',
                            transition: 'all 0.15s ease',
                            transform: active ? 'scale(1.03)' : 'scale(1)',
                          }}
                        >
                          <span style={{ fontSize: '14px' }}>{tag.emoji}</span>
                          {tag.label}
                        </button>
                      );
                    })}
                  </div>

                  {/* Comment Box */}
                  <div style={{ position: 'relative', marginBottom: 'var(--sp-3)' }}>
                    <label htmlFor={`feedback-comment-${caseId}`} style={srOnlyStyle}>
                      Additional feedback notes
                    </label>
                    <textarea
                      id={`feedback-comment-${caseId}`}
                      aria-label="Additional feedback notes"
                      value={comment}
                      onChange={e => setComment(e.target.value)}
                      placeholder="Catatan tambahan (opsional)..."
                      rows={2}
                      maxLength={500}
                      style={{
                        width: '100%',
                        resize: 'vertical',
                        padding: 'var(--sp-2) var(--sp-3)',
                        borderRadius: 'var(--radius-md)',
                        border: '1px solid rgba(148,163,184,0.15)',
                        background: 'rgba(15,23,42,0.4)',
                        color: 'var(--text-primary)',
                        fontSize: 'var(--fs-sm)',
                        fontFamily: 'inherit',
                        outline: 'none',
                        transition: 'border-color 0.2s',
                        boxSizing: 'border-box',
                      }}
                      onFocus={e => e.target.style.borderColor = 'rgba(99,102,241,0.4)'}
                      onBlur={e => e.target.style.borderColor = 'rgba(148,163,184,0.15)'}
                    />
                    {comment.length > 0 && (
                      <span style={{
                        position: 'absolute', bottom: 6, right: 8,
                        fontSize: '10px', color: 'var(--text-muted)',
                      }}>
                        {comment.length}/500
                      </span>
                    )}
                  </div>

                  {/* Actions */}
                  <div style={{ display: 'flex', gap: 'var(--sp-2)', justifyContent: 'flex-end' }}>
                    {existingFeedback && (
                      <button
                        type="button"
                        onClick={handleClear}
                        style={{
                          padding: '6px 14px',
                          borderRadius: 'var(--radius-md)',
                          border: '1px solid rgba(239,68,68,0.2)',
                          background: 'rgba(239,68,68,0.08)',
                          color: '#f87171',
                          fontSize: 'var(--fs-xs)',
                          cursor: 'pointer',
                          fontWeight: 500,
                        }}
                      >
                        Hapus Feedback
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={handleSubmit}
                      disabled={selectedTags.length === 0 && !comment.trim()}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        padding: '6px 16px',
                        borderRadius: 'var(--radius-md)',
                        border: 'none',
                        background: selectedTags.length > 0 || comment.trim()
                          ? 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))'
                          : 'rgba(148,163,184,0.1)',
                        color: selectedTags.length > 0 || comment.trim() ? '#fff' : 'var(--text-muted)',
                        fontSize: 'var(--fs-xs)',
                        fontWeight: 600,
                        cursor: selectedTags.length > 0 || comment.trim() ? 'pointer' : 'default',
                        opacity: selectedTags.length > 0 || comment.trim() ? 1 : 0.5,
                        transition: 'all 0.2s',
                      }}
                    >
                      <Send size={12} />
                      Simpan
                    </button>
                  </div>
                </>
              )}
            </div>
          </Motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
