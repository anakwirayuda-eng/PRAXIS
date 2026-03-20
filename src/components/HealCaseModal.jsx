/**
 * PRAXIS — "Heal this Case" Modal
 * Crowdsource QA: students propose corrections to bad data.
 * Submits to POST /api/feedback/propose (shadowban-gated).
 */
import { useState } from 'react';
import { motion as Motion, AnimatePresence } from 'framer-motion';
import X from 'lucide-react/dist/esm/icons/x';
import Send from 'lucide-react/dist/esm/icons/send';
import Check from 'lucide-react/dist/esm/icons/check';
import Stethoscope from 'lucide-react/dist/esm/icons/stethoscope';

const API_BASE = import.meta.env.DEV ? '' : (import.meta.env.VITE_API_URL || '');

const FIELD_OPTIONS = [
  { value: 'answer_key',          label: '❌ Kunci Jawaban Salah',      hint: 'Opsi yang ditandai benar ternyata salah' },
  { value: 'rationale.correct',   label: '📖 Penjelasan Tidak Sesuai',  hint: 'Penjelasan membahas topik berbeda' },
  { value: 'rationale.pearl',     label: '💡 Clinical Pearl Salah',     hint: 'Pearl tidak relevan dengan soal' },
  { value: 'prompt',              label: '❓ Soal Ambigu/Salah',        hint: 'Pertanyaan tidak jelas atau error' },
  { value: 'options',             label: '🔤 Opsi Bermasalah',          hint: 'Duplikat, typo, atau opsi tidak masuk akal' },
];

function getUserHash() {
  try {
    let h = localStorage.getItem('praxis_user_hash');
    if (!h) {
      h = 'u_' + Math.random().toString(36).slice(2, 10);
      localStorage.setItem('praxis_user_hash', h);
    }
    return h;
  } catch { return 'anonymous'; }
}

export function HealCaseModal({ isOpen, onClose, caseData }) {
  const [field, setField] = useState('');
  const [correction, setCorrection] = useState('');
  const [reference, setReference] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async () => {
    if (!field || !correction.trim() || reference.trim().length < 5) {
      setError('Isi semua field. Referensi minimal 5 karakter.');
      return;
    }

    setSubmitting(true); setError('');
    try {
      const oldValue = field === 'answer_key'
        ? caseData.options?.map((o, i) => `${String.fromCharCode(65 + i)}: ${o.text} ${o.is_correct ? '✅' : ''}`).join('\n')
        : field === 'rationale.correct'
        ? caseData.rationale?.correct
        : field === 'rationale.pearl'
        ? caseData.rationale?.pearl
        : field === 'prompt'
        ? caseData.prompt
        : JSON.stringify(caseData.options?.map(o => o.text));

      const res = await fetch(`${API_BASE}/api/feedback/propose`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          case_id: caseData.case_code || caseData._id,
          user_hash: getUserHash(),
          field,
          old_value: oldValue,
          new_value: correction.trim(),
          reference: reference.trim(),
        }),
      });

      if (res.ok) {
        setSubmitted(true);
        setTimeout(onClose, 2000);
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || 'Gagal mengirim. Coba lagi.');
      }
    } catch {
      setError('Tidak bisa terhubung ke server.');
    } finally {
      setSubmitting(false);
    }
  };

  const reset = () => { setField(''); setCorrection(''); setReference(''); setSubmitted(false); setError(''); };

  return (
    <AnimatePresence>
      {isOpen && (
        <Motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          style={{
            position: 'fixed', inset: 0, zIndex: 9000,
            background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(6px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 'var(--sp-4)',
          }}
          onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
          <Motion.div
            initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.9, y: 20 }}
            style={{
              width: '100%', maxWidth: 520, maxHeight: '85vh', overflowY: 'auto',
              padding: 'var(--sp-6)', borderRadius: 'var(--radius-xl)',
              background: 'var(--surface-elevated)', border: '1px solid rgba(168,85,247,0.2)',
              boxShadow: '0 25px 60px rgba(0,0,0,0.5)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--sp-4)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
                <Stethoscope size={20} style={{ color: '#a855f7' }} />
                <h3 style={{ margin: 0, fontSize: 'var(--fs-md)' }}>Heal this Case</h3>
              </div>
              <button onClick={() => { reset(); onClose(); }} style={{
                background: 'none', border: 'none', color: 'var(--text-muted)',
                cursor: 'pointer', padding: 4, display: 'flex',
              }}><X size={18} /></button>
            </div>

            {/* Case ref */}
            <div style={{
              fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', marginBottom: 'var(--sp-4)',
              padding: 'var(--sp-2) var(--sp-3)', background: 'rgba(148,163,184,0.05)',
              borderRadius: 'var(--radius-sm)', border: '1px solid rgba(148,163,184,0.1)',
            }}>
              📋 {caseData?.case_code || `Case #${caseData?._id}`} — <em>{(caseData?.prompt || '').substring(0, 60)}...</em>
            </div>

            {submitted ? (
              <Motion.div initial={{ scale: 0.8 }} animate={{ scale: 1 }}
                style={{ textAlign: 'center', padding: 'var(--sp-8)' }}>
                <Check size={48} style={{ color: '#10b981', marginBottom: 'var(--sp-3)' }} />
                <div style={{ fontSize: 'var(--fs-md)', fontWeight: 700, color: '#10b981' }}>Terima Kasih! 🩺</div>
                <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', marginTop: 'var(--sp-2)' }}>
                  Usulan Anda akan ditinjau oleh tim medis PRAXIS.
                </div>
              </Motion.div>
            ) : (
              <>
                {/* Field Selector */}
                <label style={{ display: 'block', fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', fontWeight: 600, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Apa yang salah?
                </label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)', marginBottom: 'var(--sp-4)' }}>
                  {FIELD_OPTIONS.map(f => (
                    <button key={f.value} type="button" onClick={() => setField(f.value)} style={{
                      display: 'flex', flexDirection: 'column', gap: 2,
                      padding: 'var(--sp-2) var(--sp-3)', borderRadius: 'var(--radius-md)', cursor: 'pointer',
                      border: field === f.value ? '1px solid rgba(168,85,247,0.4)' : '1px solid rgba(148,163,184,0.1)',
                      background: field === f.value ? 'rgba(168,85,247,0.1)' : 'transparent',
                      textAlign: 'left', transition: 'all 0.15s',
                    }}>
                      <span style={{ fontSize: 'var(--fs-sm)', fontWeight: 500, color: field === f.value ? '#c084fc' : 'var(--text-primary)' }}>{f.label}</span>
                      <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{f.hint}</span>
                    </button>
                  ))}
                </div>

                {/* Correction */}
                <label style={{ display: 'block', fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', fontWeight: 600, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Koreksi Anda
                </label>
                <textarea
                  value={correction}
                  onChange={e => setCorrection(e.target.value)}
                  placeholder={field === 'answer_key'
                    ? 'Contoh: Jawaban yang benar adalah B (Genioglossus), bukan A'
                    : 'Tuliskan koreksi atau penjelasan yang benar...'}
                  rows={3} maxLength={2000}
                  style={{
                    width: '100%', resize: 'vertical', padding: 'var(--sp-3)',
                    borderRadius: 'var(--radius-md)', border: '1px solid rgba(148,163,184,0.15)',
                    background: 'rgba(15,23,42,0.4)', color: 'var(--text-primary)',
                    fontSize: 'var(--fs-sm)', fontFamily: 'inherit', outline: 'none',
                    boxSizing: 'border-box', marginBottom: 'var(--sp-4)',
                  }}
                />

                {/* Reference */}
                <label style={{ display: 'block', fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', fontWeight: 600, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Referensi <span style={{ color: '#f87171' }}>*</span>
                </label>
                <input
                  value={reference}
                  onChange={e => setReference(e.target.value)}
                  placeholder="Harrison's, Robbins Pathology, Guyton, dll."
                  maxLength={300}
                  style={{
                    width: '100%', padding: 'var(--sp-3)',
                    borderRadius: 'var(--radius-md)', border: '1px solid rgba(148,163,184,0.15)',
                    background: 'rgba(15,23,42,0.4)', color: 'var(--text-primary)',
                    fontSize: 'var(--fs-sm)', fontFamily: 'inherit', outline: 'none',
                    boxSizing: 'border-box', marginBottom: 'var(--sp-4)',
                  }}
                />

                {error && <div style={{ color: '#f87171', fontSize: 'var(--fs-xs)', marginBottom: 'var(--sp-3)' }}>{error}</div>}

                {/* Submit */}
                <button
                  onClick={handleSubmit}
                  disabled={submitting || !field || !correction.trim() || reference.trim().length < 5}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    gap: 8, padding: 'var(--sp-3)',
                    borderRadius: 'var(--radius-md)', border: 'none',
                    background: (!field || !correction.trim() || reference.trim().length < 5)
                      ? 'rgba(148,163,184,0.1)' : 'linear-gradient(135deg, #a855f7, #6366f1)',
                    color: '#fff', fontSize: 'var(--fs-sm)', fontWeight: 600,
                    cursor: submitting ? 'wait' : 'pointer',
                    opacity: (!field || !correction.trim() || reference.trim().length < 5) ? 0.4 : 1,
                    transition: 'all 0.2s',
                  }}
                >
                  <Send size={14} />
                  {submitting ? 'Mengirim...' : 'Kirim Usulan Perbaikan'}
                </button>

                <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: 'var(--sp-3)', textAlign: 'center' }}>
                  Usulan akan ditinjau oleh <strong>Tim Medis PRAXIS</strong> sebelum diterapkan.
                  <br />Harap sertakan referensi (buku/jurnal) agar proses review lebih cepat.
                </p>
              </>
            )}
          </Motion.div>
        </Motion.div>
      )}
    </AnimatePresence>
  );
}
