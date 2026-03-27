/**
 * MedCase Pro - Data Quality Dashboard
 * Shows dataset statistics, validation scores, source breakdown,
 * category distribution, and flagged questions.
 */
import { useEffect, useMemo, useState } from 'react';
import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle';
import BarChart3 from 'lucide-react/dist/esm/icons/bar-chart-3';
import CheckCircle from 'lucide-react/dist/esm/icons/check-circle';
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down';
import ChevronUp from 'lucide-react/dist/esm/icons/chevron-up';
import Database from 'lucide-react/dist/esm/icons/database';
import Flag from 'lucide-react/dist/esm/icons/flag';
import Shield from 'lucide-react/dist/esm/icons/shield';
import Trash2 from 'lucide-react/dist/esm/icons/trash-2';
import RefreshCcw from 'lucide-react/dist/esm/icons/refresh-ccw';
import { CATEGORIES, getDatasetStats, useCaseBank } from '../data/caseLoader';

const CONFIDENCE_COLORS = {
  high: '#10b981',
  medium: '#f59e0b',
  low: '#ef4444',
};

const QUARANTINE_CODE_COLORS = {
  A1_FEW_OPTIONS: '#f97316',
  A2_NO_CORRECT: '#ef4444',
  A3_EMPTY_QUESTION: '#8b5cf6',
  A8_PHANTOM_IMAGE: '#06b6d4',
  A4_DUPLICATE_OPTIONS: '#ec4899',
  A5_CONFLICT: '#f59e0b',
};

export default function DataQuality() {
  // Fix #1: Multi-panel Set — admin can open multiple panels simultaneously
  const [openSections, setOpenSections] = useState(new Set(['cats', 'sources']));
  const { cases: caseBank, totalCases, status, isLoading } = useCaseBank();
  const isReady = status === 'ready';
  // Fix #2: Removed `.slice()` RAM clone — caseBank is already the live array
  // Fix #3: Defer heavy O(N) stats until hydration finishes (prevents CPU freeze during loading)
  const stats = useMemo(() => {
    if (!isReady && caseBank.length > 5000) return { byCategory: {}, byConfidence: { high: 0, medium: 0, low: 0 } };
    return getDatasetStats(caseBank);
  }, [caseBank, isReady]);

  // ── Quarantine Manifest ──
  const [quarantine, setQuarantine] = useState({ items: [], loading: true, error: null });

  // Fix #4: Offline-safe fetch with retry — cache:default + version busting
  const fetchQuarantine = () => {
    setQuarantine(prev => ({ ...prev, loading: true, error: null }));
    const appVer = import.meta.env.VITE_APP_VERSION || Date.now();
    const url = `${import.meta.env.BASE_URL}data/quarantine_manifest.json?v=${appVer}`;
    fetch(url, { cache: 'default' })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => setQuarantine({ items: Array.isArray(data) ? data : [], loading: false, error: null }))
      .catch((err) => setQuarantine({ items: [], loading: false, error: err.message }));
  };

  useEffect(() => { fetchQuarantine(); }, []);

  const quarantineStats = useMemo(() => {
    const byCode = {};
    for (const item of (quarantine.items || [])) {
      if (!item) continue;
      const code = item.code || 'UNKNOWN';
      byCode[code] = (byCode[code] || 0) + 1;
    }
    const sorted = Object.entries(byCode).sort((a, b) => b[1] - a[1]);
    const maxCount = sorted[0]?.[1] || 1;
    return { byCode: sorted, maxCount, total: quarantine.items.length };
  }, [quarantine.items]);

  const validationStats = useMemo(() => {
    // Fix #3: Skip heavy computation during hydration
    if (!isReady && caseBank.length > 5000) {
      return { avgScore: '0.0', withExplanation: 0, explPct: '0.0', flagged: [], bySource: {} };
    }
    let totalScore = 0;
    let scored = 0;
    let withExplanation = 0;
    const flagged = [];
    const bySource = {};

    for (const caseData of caseBank) {
      const source = caseData.meta?.source || 'unknown';
      if (!bySource[source]) {
        bySource[source] = { total: 0, avgConfidence: 0, confSum: 0, withExpl: 0 };
      }

      bySource[source].total += 1;
      bySource[source].confSum += caseData.confidence || 0;

      if (caseData.rationale?.correct && caseData.rationale.correct.length > 10) {
        withExplanation += 1;
        bySource[source].withExpl += 1;
      }

      if (caseData.validation?.overallScore) {
        totalScore += caseData.validation.overallScore;
        scored += 1;
      }

      if (caseData.confidence < 2.5 || (caseData.validation?.flags?.length > 0)) {
        if (flagged.length < 50) flagged.push(caseData);
      }
    }

    for (const sourceStats of Object.values(bySource)) {
      sourceStats.avgConfidence = sourceStats.total > 0
        ? (sourceStats.confSum / sourceStats.total).toFixed(1)
        : '0.0';
    }

    return {
      avgScore: scored > 0 ? (totalScore / scored).toFixed(1) : '0.0',
      withExplanation,
      explPct: totalCases > 0 ? ((withExplanation / totalCases) * 100).toFixed(1) : '0.0',
      flagged,
      bySource,
    };
  }, [caseBank, totalCases, isReady]);

  // Fix #1: Multi-panel toggle
  const toggle = (section) => {
    setOpenSections(prev => {
      const next = new Set(prev);
      next.has(section) ? next.delete(section) : next.add(section);
      return next;
    });
  };
  const catEntries = Object.entries(stats.byCategory || {}).sort((a, b) => b[1] - a[1]);
  const srcEntries = Object.entries(validationStats.bySource).sort((a, b) => b[1].total - a[1].total);
  const maxCat = catEntries[0]?.[1] || 1;

  return (
    <div style={{ padding: '2rem', maxWidth: 1200, margin: '0 auto' }}>
      <h1 style={{ fontSize: '1.8rem', fontWeight: 700, marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <Shield size={28} /> Data Quality Dashboard
      </h1>
      <p style={{ color: 'var(--text-secondary, #94a3b8)', marginBottom: '2rem' }}>
        {totalCases.toLocaleString()} total cases | Avg confidence: {validationStats.avgScore}/5.0 | {validationStats.explPct}% with explanations
      </p>

      {status !== 'ready' && (
        <div className="glass-card" style={{ padding: 'var(--sp-3) var(--sp-4)', marginBottom: 'var(--sp-6)' }}>
          <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>
            {isLoading
              ? 'Loading the full case library in the background. Quality metrics will expand automatically.'
              : 'Compiled case library is unavailable. Quality metrics are limited to starter cases.'}
          </span>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
        <StatCard icon={<Database size={20} />} label="Total Cases" value={totalCases.toLocaleString()} color="#3b82f6" />
        <StatCard
          icon={<CheckCircle size={20} />}
          label="High Confidence"
          value={stats.byConfidence.high.toLocaleString()}
          sub={totalCases > 0 ? `${((stats.byConfidence.high / totalCases) * 100).toFixed(0)}%` : '0%'}
          color={CONFIDENCE_COLORS.high}
        />
        <StatCard
          icon={<AlertTriangle size={20} />}
          label="Low Confidence"
          value={stats.byConfidence.low.toLocaleString()}
          sub={totalCases > 0 ? `${((stats.byConfidence.low / totalCases) * 100).toFixed(0)}%` : '0%'}
          color={CONFIDENCE_COLORS.low}
        />
        <StatCard icon={<Flag size={20} />} label="Flagged" value={validationStats.flagged.length} sub="needs review" color="#f59e0b" />
        <StatCard
          icon={<Trash2 size={20} />}
          label="Quarantined"
          value={quarantine.loading ? '...' : quarantineStats.total.toLocaleString()}
          sub={quarantine.loading ? 'loading' : 'removed from playable pool'}
          color="#ef4444"
        />
      </div>

      <CollapsibleSection
        title="Category Distribution"
        icon={<BarChart3 size={18} />}
        isOpen={openSections.has('cats')}
        onToggle={() => toggle('cats')}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {catEntries.map(([categoryKey, count]) => {
            const pct = totalCases > 0 ? ((count / totalCases) * 100).toFixed(1) : '0.0';
            const category = CATEGORIES[categoryKey];
            return (
              <div key={categoryKey} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <span style={{ width: 160, fontSize: '0.85rem', color: 'var(--text-secondary, #94a3b8)' }}>
                  {category?.label || categoryKey}
                </span>
                <div style={{ flex: 1, background: 'rgba(255,255,255,0.05)', borderRadius: 4, height: 24, overflow: 'hidden' }}>
                  <div
                    style={{
                      width: `${(count / maxCat) * 100}%`,
                      height: '100%',
                      background: `linear-gradient(90deg, ${category?.color || '#3b82f6'}80, ${category?.color || '#3b82f6'}40)`,
                      borderRadius: 4,
                      transition: 'width 0.5s ease',
                    }}
                  />
                </div>
                <span style={{ width: 80, textAlign: 'right', fontSize: '0.85rem', fontWeight: 600 }}>{count.toLocaleString()}</span>
                <span style={{ width: 50, textAlign: 'right', fontSize: '0.8rem', color: 'var(--text-secondary, #94a3b8)' }}>{pct}%</span>
              </div>
            );
          })}
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        title="Source Quality"
        icon={<Database size={18} />}
        isOpen={openSections.has('sources')}
        onToggle={() => toggle('sources')}
      >
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                <th style={thStyle}>Source</th>
                <th style={thStyle}>Count</th>
                <th style={thStyle}>Avg Confidence</th>
                <th style={thStyle}>With Explanation</th>
                <th style={thStyle}>Quality</th>
              </tr>
            </thead>
            <tbody>
              {srcEntries.map(([source, sourceStats]) => (
                <tr key={source} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                  <td style={tdStyle}>{source}</td>
                  <td style={tdStyle}>{sourceStats.total.toLocaleString()}</td>
                  <td style={tdStyle}>
                    <ConfidenceBadge score={Number.parseFloat(sourceStats.avgConfidence)} />
                  </td>
                  <td style={tdStyle}>
                    {sourceStats.withExpl.toLocaleString()} ({sourceStats.total > 0 ? ((sourceStats.withExpl / sourceStats.total) * 100).toFixed(0) : 0}%)
                  </td>
                  <td style={tdStyle}>
                    <QualityBar value={Number.parseFloat(sourceStats.avgConfidence)} max={5} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        title={`Flagged Questions (${validationStats.flagged.length})`}
        icon={<AlertTriangle size={18} />}
        isOpen={openSections.has('flagged')}
        onToggle={() => toggle('flagged')}
      >
        {validationStats.flagged.length === 0 ? (
          <p style={{ color: '#10b981' }}>No flagged questions</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: 400, overflowY: 'auto' }}>
            {validationStats.flagged.slice(0, 20).map((caseData) => (
              <div key={caseData._id} style={{ padding: '0.75rem', background: 'rgba(245,158,11,0.1)', borderRadius: 8, borderLeft: '3px solid #f59e0b' }}>
                <div style={{ fontSize: '0.8rem', color: '#f59e0b', marginBottom: '0.25rem' }}>
                  #{caseData._id} | {caseData.meta?.source} | Confidence: {caseData.confidence}
                  {caseData.validation?.flags?.map((flag) => (
                    <span key={flag} style={{ marginLeft: 8, background: 'rgba(239,68,68,0.2)', padding: '2px 6px', borderRadius: 4, fontSize: '0.7rem' }}>
                      {flag}
                    </span>
                  ))}
                </div>
                <div style={{ fontSize: '0.85rem' }}>{(caseData.title || '').substring(0, 120)}</div>
              </div>
            ))}
          </div>
        )}
      </CollapsibleSection>

      {/* ── Quarantine Manifest Section ── */}
      <CollapsibleSection
        title={`Quarantined Cases (${quarantine.loading ? '...' : quarantineStats.total.toLocaleString()})`}
        icon={<Trash2 size={18} />}
        isOpen={openSections.has('quarantine')}
        onToggle={() => toggle('quarantine')}
      >
        {quarantine.loading ? (
          <p style={{ color: 'var(--text-muted)' }}>Loading quarantine manifest...</p>
        ) : quarantine.error ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <p style={{ color: '#ef4444' }}>Failed to load: {quarantine.error}</p>
            <button onClick={fetchQuarantine} style={{ background: 'rgba(239,68,68,0.15)', color: '#ef4444', border: 'none', padding: '4px 12px', borderRadius: 4, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem' }}>
              <RefreshCcw size={14} /> Retry
            </button>
          </div>
        ) : quarantineStats.total === 0 ? (
          <p style={{ color: '#10b981' }}>No quarantined cases — all cases passed validation!</p>
        ) : (
          <>
            {/* Breakdown by reason code */}
            <h4 style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '0.75rem', color: 'var(--text-secondary, #94a3b8)' }}>
              Breakdown by Reason Code
            </h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', marginBottom: '1.5rem' }}>
              {quarantineStats.byCode.map(([code, count]) => {
                const pct = ((count / quarantineStats.total) * 100).toFixed(1);
                const barColor = QUARANTINE_CODE_COLORS[code] || '#94a3b8';
                return (
                  <div key={code} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <span style={{
                      width: 200, fontSize: '0.8rem', fontFamily: 'var(--font-mono, monospace)',
                      color: barColor, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {code}
                    </span>
                    <div style={{ flex: 1, background: 'rgba(255,255,255,0.05)', borderRadius: 4, height: 20, overflow: 'hidden' }}>
                      <div style={{
                        width: `${(count / quarantineStats.maxCount) * 100}%`,
                        height: '100%',
                        background: `linear-gradient(90deg, ${barColor}80, ${barColor}40)`,
                        borderRadius: 4,
                        transition: 'width 0.5s ease',
                      }} />
                    </div>
                    <span style={{ width: 60, textAlign: 'right', fontSize: '0.8rem', fontWeight: 600 }}>{count.toLocaleString()}</span>
                    <span style={{ width: 50, textAlign: 'right', fontSize: '0.75rem', color: 'var(--text-secondary, #94a3b8)' }}>{pct}%</span>
                  </div>
                );
              })}
            </div>

            {/* Sample table */}
            <h4 style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '0.75rem', color: 'var(--text-secondary, #94a3b8)' }}>
              Sample Quarantined Cases (20 of {quarantineStats.total.toLocaleString()})
            </h4>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                    <th style={thStyle}>Case ID</th>
                    <th style={thStyle}>Code</th>
                    <th style={thStyle}>Reason</th>
                    <th style={thStyle}>Source</th>
                  </tr>
                </thead>
                <tbody>
                  {(quarantine.items || []).filter(Boolean).slice(0, 20).map((item, idx) => (
                    <tr key={`${item.id}-${idx}`} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                      <td style={tdStyle}>#{item.id}</td>
                      <td style={{ ...tdStyle, fontFamily: 'var(--font-mono, monospace)', color: QUARANTINE_CODE_COLORS[item.code] || '#94a3b8', fontWeight: 600, fontSize: '0.75rem' }}>
                        {item.code}
                      </td>
                      <td style={{ ...tdStyle, maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {item.reason}
                      </td>
                      <td style={tdStyle}>{item.source || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </CollapsibleSection>
    </div>
  );
}

function StatCard({ icon, label, value, sub, color }) {
  return (
    <div style={{ padding: '1.25rem', background: 'rgba(255,255,255,0.03)', borderRadius: 12, border: '1px solid rgba(255,255,255,0.06)', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color }}>
        {icon}
        <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary, #94a3b8)' }}>{label}</span>
      </div>
      <div style={{ fontSize: '1.8rem', fontWeight: 700 }}>{value}</div>
      {sub && <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary, #94a3b8)' }}>{sub}</div>}
    </div>
  );
}

// Fix #1: Removed broken defaultOpen (false ?? true = false in JS), now fully controlled by Set
function CollapsibleSection({ title, icon, isOpen, onToggle, children }) {
  const open = isOpen;
  return (
    <div style={{ marginBottom: '1rem', background: 'rgba(255,255,255,0.02)', borderRadius: 12, border: '1px solid rgba(255,255,255,0.06)', overflow: 'hidden' }}>
      <button type="button" onClick={onToggle} style={{ width: '100%', padding: '1rem 1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', fontSize: '1rem', fontWeight: 600 }}>
        {icon} {title}
        <span style={{ marginLeft: 'auto' }}>{open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</span>
      </button>
      {open && <div style={{ padding: '0 1.25rem 1.25rem' }}>{children}</div>}
    </div>
  );
}

function ConfidenceBadge({ score }) {
  const safeScore = Number.isFinite(score) ? score : 0;
  const color = safeScore >= 4 ? '#10b981' : safeScore >= 3 ? '#f59e0b' : '#ef4444';
  return <span style={{ color, fontWeight: 600 }}>{safeScore.toFixed(1)}</span>;
}

function QualityBar({ value, max }) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  const color = pct >= 80 ? '#10b981' : pct >= 60 ? '#f59e0b' : '#ef4444';
  return (
    <div style={{ width: 80, height: 6, background: 'rgba(255,255,255,0.1)', borderRadius: 3 }}>
      <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 3, transition: 'width 0.5s' }} />
    </div>
  );
}

const thStyle = { textAlign: 'left', padding: '0.5rem 0.75rem', color: 'var(--text-secondary, #94a3b8)', fontWeight: 600 };
const tdStyle = { padding: '0.5rem 0.75rem' };
