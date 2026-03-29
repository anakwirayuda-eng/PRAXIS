/**
 * PRAXIS — Admin Panel
 * Review feedback, edit cases, view audit log
 */
import { useState, useEffect, useCallback } from 'react';
import { motion as Motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import Shield from 'lucide-react/dist/esm/icons/shield';
import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle';
import Check from 'lucide-react/dist/esm/icons/check';
import X from 'lucide-react/dist/esm/icons/x';
import Eye from 'lucide-react/dist/esm/icons/eye';
import LogOut from 'lucide-react/dist/esm/icons/log-out';
import GitPullRequest from 'lucide-react/dist/esm/icons/git-pull-request';

// Fix #1: API bridge — empty for dev (Vite proxy), VITE_API_URL for production (Fly.io)
const API_BASE = import.meta.env.DEV ? '' : (import.meta.env.VITE_API_URL || '');

const TAG_COLORS = {
  wrong_answer: '#ef4444', unclear: '#f59e0b', incomplete: '#f97316',
  bad_options: '#a855f7', bad_rationale: '#6366f1', duplicate: '#64748b',
  excellent: '#10b981', flagged: '#f43f5e',
};

function useAdminAuth() {
  const [key, setKey] = useState(() => localStorage.getItem('PRAXIS_ADMIN_KEY') || '');
  const [authed, setAuthed] = useState(false);

  const login = useCallback(async (inputKey) => {
    try {
      const res = await fetch(`${API_BASE}/api/admin/overview`, {
        headers: { 'X-Admin-Key': inputKey },
      });
      if (res.ok) {
        localStorage.setItem('PRAXIS_ADMIN_KEY', inputKey);
        setKey(inputKey);
        setAuthed(true);
        return true;
      }
    } catch { /* network error */ }
    return false;
  }, []);

  // Fix #4: Logout function
  const logout = useCallback(() => {
    localStorage.removeItem('PRAXIS_ADMIN_KEY');
    setKey('');
    setAuthed(false);
  }, []);

  useEffect(() => {
    if (key) login(key);
  }, []); // eslint-disable-line

  return { key, authed, login, logout };
}

function LoginGate({ onLogin }) {
  const [input, setInput] = useState('');
  const [error, setError] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const ok = await onLogin(input);
    if (!ok) setError(true);
  };

  return (
    <div style={{ maxWidth: 400, margin: '15vh auto', padding: 'var(--sp-6)' }}>
      <div className="glass-card" style={{ padding: 'var(--sp-8)', textAlign: 'center' }}>
        <Shield size={48} style={{ color: 'var(--accent-primary)', marginBottom: 'var(--sp-4)' }} />
        <h2 style={{ marginBottom: 'var(--sp-2)' }}>Admin Panel</h2>
        <p style={{ color: 'var(--text-muted)', marginBottom: 'var(--sp-6)', fontSize: 'var(--fs-sm)' }}>
          Enter your admin key to access the dashboard.
        </p>
        <form onSubmit={handleSubmit}>
          <input
            id="admin-key-input"
            type="password"
            value={input}
            onChange={e => { setInput(e.target.value); setError(false); }}
            placeholder="Admin Key"
            style={{
              width: '100%', padding: 'var(--sp-3)', borderRadius: 'var(--radius-md)',
              border: error ? '1px solid #ef4444' : '1px solid rgba(148,163,184,0.2)',
              background: 'rgba(15,23,42,0.4)', color: 'var(--text-primary)',
              fontSize: 'var(--fs-sm)', marginBottom: 'var(--sp-3)', boxSizing: 'border-box',
            }}
          />
          {error && <p style={{ color: '#ef4444', fontSize: 'var(--fs-xs)', marginBottom: 'var(--sp-3)' }}>Invalid key</p>}
          <button type="submit" className="btn btn-primary" style={{ width: '100%' }}>
            Login
          </button>
        </form>
      </div>
    </div>
  );
}

function OverviewCards({ overview }) {
  if (!overview) return null;
  const cards = [
    { label: 'Total Cases', value: overview.total_cases?.toLocaleString(), color: 'var(--accent-primary)' },
    { label: 'Decayed (FDA)', value: overview.quality_flags?.decayed, color: '#fb7185' },
    { label: 'Quarantined', value: overview.quality_flags?.quarantined, color: '#f59e0b' },
    { label: 'Do Not Shuffle', value: overview.quality_flags?.do_not_shuffle, color: '#a78bfa' },
  ];

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 'var(--sp-4)', marginBottom: 'var(--sp-6)' }}>
      {cards.map(c => (
        <div key={c.label} className="glass-card" style={{ padding: 'var(--sp-4)', textAlign: 'center' }}>
          <div style={{ fontSize: 'var(--fs-2xl)', fontWeight: 800, color: c.color }}>{c.value}</div>
          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', marginTop: 4 }}>{c.label}</div>
        </div>
      ))}
    </div>
  );
}

function FeedbackTable({ data, adminKey, onStatusChange }) {
  if (!data || data.length === 0) {
    return (
      <div className="glass-card" style={{ padding: 'var(--sp-8)', textAlign: 'center', color: 'var(--text-muted)' }}>
        <AlertTriangle size={32} style={{ marginBottom: 'var(--sp-2)', opacity: 0.5 }} />
        <p>No feedback reports yet. Users will appear here when they flag questions.</p>
      </div>
    );
  }

  return (
    <div className="glass-card" style={{ overflow: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--fs-sm)' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid rgba(148,163,184,0.1)' }}>
            {['#', 'Case', 'Tags', 'Comment', 'Status', 'Date', 'Actions'].map(h => (
              <th key={h} style={{ padding: 'var(--sp-3)', textAlign: 'left', color: 'var(--text-muted)', fontSize: 'var(--fs-xs)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map(row => (
            <tr key={row.id} style={{ borderBottom: '1px solid rgba(148,163,184,0.05)' }}>
              <td style={{ padding: 'var(--sp-2) var(--sp-3)', color: 'var(--text-muted)' }}>{row.id}</td>
              <td style={{ padding: 'var(--sp-2) var(--sp-3)' }}>
                <Link to={`/case/${row.case_id}`} style={{ color: 'var(--accent-primary)', textDecoration: 'none' }}>
                  {row.case_code || `#${row.case_id}`}
                </Link>
              </td>
              <td style={{ padding: 'var(--sp-2) var(--sp-3)' }}>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {(Array.isArray(row.tags) ? row.tags : []).map(t => (
                    <span key={t} style={{
                      fontSize: 10, padding: '2px 8px', borderRadius: 'var(--radius-full)',
                      background: (TAG_COLORS[t] || '#64748b') + '20',
                      color: TAG_COLORS[t] || '#94a3b8',
                      fontWeight: 600,
                    }}>{t}</span>
                  ))}
                </div>
              </td>
              <td style={{ padding: 'var(--sp-2) var(--sp-3)', color: 'var(--text-secondary)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {row.comment || '—'}
              </td>
              <td style={{ padding: 'var(--sp-2) var(--sp-3)' }}>
                <span style={{
                  fontSize: 10, padding: '2px 8px', borderRadius: 'var(--radius-full)',
                  background: row.status === 'open' ? 'rgba(245,158,11,0.15)' : row.status === 'resolved' ? 'rgba(16,185,129,0.15)' : 'rgba(100,116,139,0.15)',
                  color: row.status === 'open' ? '#fbbf24' : row.status === 'resolved' ? '#34d399' : '#94a3b8',
                  fontWeight: 600, textTransform: 'uppercase',
                }}>{row.status}</span>
              </td>
              <td style={{ padding: 'var(--sp-2) var(--sp-3)', color: 'var(--text-muted)', fontSize: 'var(--fs-xs)' }}>
                {new Date(row.created_at).toLocaleDateString()}
              </td>
              <td style={{ padding: 'var(--sp-2) var(--sp-3)' }}>
                <div style={{ display: 'flex', gap: 4 }}>
                  {row.status === 'open' && (
                    <>
                      <button
                        onClick={() => onStatusChange(row.id, 'resolved')}
                        title="Resolve"
                        style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.2)', borderRadius: 'var(--radius-sm)', color: '#34d399', cursor: 'pointer', padding: '4px 6px', display: 'flex' }}
                      ><Check size={12} /></button>
                      <button
                        onClick={() => onStatusChange(row.id, 'dismissed')}
                        title="Dismiss"
                        style={{ background: 'rgba(100,116,139,0.1)', border: '1px solid rgba(100,116,139,0.2)', borderRadius: 'var(--radius-sm)', color: '#94a3b8', cursor: 'pointer', padding: '4px 6px', display: 'flex' }}
                      ><X size={12} /></button>
                    </>
                  )}
                  <Link
                    to={`/case/${row.case_id}`}
                    title="View case"
                    style={{ background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.2)', borderRadius: 'var(--radius-sm)', color: '#818cf8', padding: '4px 6px', display: 'flex', textDecoration: 'none' }}
                  ><Eye size={12} /></Link>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function AdminPanel() {
  const { key, authed, login, logout } = useAdminAuth();
  const [overview, setOverview] = useState(null);
  const [feedback, setFeedback] = useState([]);
  const [proposals, setProposals] = useState([]);
  const [feedbackCounts, setFeedbackCounts] = useState(null);
  const [tab, setTab] = useState('feedback');
  const [actionError, setActionError] = useState('');

  const fetchData = useCallback(async () => {
    if (!key) return;
    const headers = { 'X-Admin-Key': key };

    try {
      const results = await Promise.allSettled([
        fetch(`${API_BASE}/api/admin/overview`, { headers }),
        fetch(`${API_BASE}/api/feedback`, { headers }),
        fetch(`${API_BASE}/api/feedback/stats`, { headers }),
        fetch(`${API_BASE}/api/feedback/proposals`, { headers }),
      ]);

      // Fix #4: Auto-kick on 401
      if (results.some(r => r.status === 'fulfilled' && r.value.status === 401)) {
        logout(); return;
      }

      const isFailed = results.some(r => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value.ok));
      if (isFailed) {
        setActionError('Failed to synchronize all admin dashboard data. Please try again.');
      } else {
        setActionError('');
      }

      if (results[0].status === 'fulfilled' && results[0].value.ok) setOverview(await results[0].value.json());
      if (results[1].status === 'fulfilled' && results[1].value.ok) setFeedback((await results[1].value.json()).data || []);
      if (results[2].status === 'fulfilled' && results[2].value.ok) setFeedbackCounts((await results[2].value.json()).counts);
      if (results[3].status === 'fulfilled' && results[3].value.ok) setProposals((await results[3].value.json()).data || []);
    } catch { /* offline fallback */ }
  }, [key, logout]);

  useEffect(() => {
    if (authed) fetchData();
  }, [authed, fetchData]);

  const handleStatusChange = async (id, status) => {
    setActionError('');
    try {
      const res = await fetch(`${API_BASE}/api/feedback/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Key': key },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) { setActionError(`Gagal update status (${res.status})`); return; }
      fetchData();
    } catch { setActionError('Tidak bisa terhubung ke server.'); }
  };

  const handleProposalAction = async (id, status) => {
    setActionError('');
    try {
      const res = await fetch(`${API_BASE}/api/admin/proposals/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Key': key },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) { setActionError(`Gagal update proposal (${res.status})`); return; }
      fetchData();
    } catch { setActionError('Tidak bisa terhubung ke server.'); }
  };

  if (!authed) return <LoginGate onLogin={login} />;

  const tabs = [
    { id: 'feedback', label: '📋 Laporan Kasus', count: feedbackCounts?.open },
    { id: 'proposals', label: '⚕️ Usulan Perbaikan', count: proposals.length, icon: GitPullRequest },
    { id: 'overview', label: '📊 Metrik Server' },
  ];

  return (
    <div style={{ padding: 'var(--sp-6)', maxWidth: 1200, margin: '0 auto' }}>
      <Motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
        {/* Header + Logout */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--sp-6)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)' }}>
            <Shield size={28} style={{ color: 'var(--accent-primary)' }} />
            <div>
              <h1 style={{ margin: 0, fontSize: 'var(--fs-xl)' }}>Admin Command Center</h1>
              <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 'var(--fs-xs)' }}>PRAXIS Quality Control</p>
            </div>
          </div>
          <button onClick={logout} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(239,68,68,0.1)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.2)', padding: '6px 16px', borderRadius: 'var(--radius-md)', cursor: 'pointer', fontSize: 'var(--fs-sm)', fontWeight: 600 }}>
            <LogOut size={16} /> Lock Terminal
          </button>
        </div>

        {actionError && (
          <div style={{ marginBottom: 'var(--sp-4)', padding: 'var(--sp-3) var(--sp-4)', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 'var(--radius-md)', color: '#f87171', fontSize: 'var(--fs-sm)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span>⚠ {actionError}</span>
            <button onClick={() => setActionError('')} style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer', padding: '0 4px', fontSize: 16 }}>×</button>
          </div>
        )}

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 'var(--sp-2)', marginBottom: 'var(--sp-6)', overflowX: 'auto' }}>
          {tabs.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{ padding: 'var(--sp-2) var(--sp-4)', borderRadius: 'var(--radius-md)', border: tab === t.id ? '1px solid rgba(99,102,241,0.3)' : '1px solid rgba(148,163,184,0.1)', background: tab === t.id ? 'rgba(99,102,241,0.1)' : 'transparent', color: tab === t.id ? 'var(--accent-primary)' : 'var(--text-muted)', cursor: 'pointer', fontSize: 'var(--fs-sm)', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', whiteSpace: 'nowrap' }}>
              {t.icon && <t.icon size={16} />}
              {t.label}
              {t.count > 0 && <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 'var(--radius-full)', background: 'rgba(239,68,68,0.2)', color: '#f87171', fontWeight: 700 }}>{t.count}</span>}
            </button>
          ))}
        </div>

        {/* Content */}
        {tab === 'overview' && <OverviewCards overview={overview} />}
        {tab === 'feedback' && (
          <>
            {feedbackCounts && (
              <div style={{ display: 'flex', gap: 'var(--sp-4)', marginBottom: 'var(--sp-4)', fontSize: 'var(--fs-sm)' }}>
                <span style={{ color: 'var(--text-muted)' }}>Total: <strong style={{ color: 'var(--text-primary)' }}>{feedbackCounts.total}</strong></span>
                <span style={{ color: '#fbbf24' }}>Open: <strong>{feedbackCounts.open}</strong></span>
                <span style={{ color: '#34d399' }}>Resolved: <strong>{feedbackCounts.resolved}</strong></span>
                <span style={{ color: '#94a3b8' }}>Dismissed: <strong>{feedbackCounts.dismissed}</strong></span>
              </div>
            )}
            <FeedbackTable data={feedback} adminKey={key} onStatusChange={handleStatusChange} />
          </>
        )}
        {tab === 'proposals' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>
            {proposals.length === 0 ? (
              <div className="glass-card" style={{ padding: 'var(--sp-8)', textAlign: 'center', color: 'var(--text-muted)' }}>
                <Check size={32} style={{ marginBottom: 'var(--sp-2)', opacity: 0.5, color: '#10b981', margin: '0 auto' }} />
                <h3 style={{ color: 'var(--text-primary)' }}>Inboks Bersih</h3>
                <p>Semua usulan perbaikan klinis dari mahasiswa telah dieksekusi.</p>
              </div>
            ) : proposals.map(prop => (
              <div key={prop.id} className="glass-card" style={{ padding: 'var(--sp-4)', borderLeft: '4px solid #a855f7' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--sp-3)' }}>
                  <span style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, color: '#c084fc' }}>
                    Ubah [{prop.field}] | <Link to={`/case/${prop.case_id}`} style={{ color: '#fff' }}>Kasus #{prop.case_id}</Link>
                  </span>
                  <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>Mhs: {(prop.user_hash || '').substring(0, 8)}</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--sp-4)', marginBottom: 'var(--sp-4)' }}>
                  <div style={{ background: 'rgba(239,68,68,0.05)', padding: 'var(--sp-3)', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(239,68,68,0.1)' }}>
                    <div style={{ fontSize: 'var(--fs-xs)', color: '#f87171', marginBottom: 4 }}>SEBELUM</div>
                    <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)' }}>{typeof prop.old_value === 'string' ? prop.old_value : JSON.stringify(prop.old_value)}</div>
                  </div>
                  <div style={{ background: 'rgba(16,185,129,0.05)', padding: 'var(--sp-3)', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(16,185,129,0.1)' }}>
                    <div style={{ fontSize: 'var(--fs-xs)', color: '#34d399', marginBottom: 4 }}>SESUDAH (USULAN)</div>
                    <div style={{ fontSize: 'var(--fs-sm)', color: '#fff' }}>{typeof prop.new_value === 'string' ? prop.new_value : JSON.stringify(prop.new_value)}</div>
                  </div>
                </div>
                {prop.reference && <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', marginBottom: 'var(--sp-3)', fontStyle: 'italic' }}><strong>Referensi:</strong> {prop.reference}</div>}
                <div style={{ display: 'flex', gap: 'var(--sp-3)', justifyContent: 'flex-end' }}>
                  <button onClick={() => handleProposalAction(prop.id, 'rejected')} className="btn" style={{ background: 'rgba(239,68,68,0.1)', color: '#f87171', padding: '6px 16px', border: '1px solid rgba(239,68,68,0.2)' }}>Tolak</button>
                  <button onClick={() => handleProposalAction(prop.id, 'approved')} className="btn" style={{ background: '#10b981', color: '#fff', padding: '6px 16px', border: 'none' }}>Terima</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Motion.div>
    </div>
  );
}
