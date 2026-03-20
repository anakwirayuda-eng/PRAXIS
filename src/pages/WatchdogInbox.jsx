import { useMemo } from 'react';
import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle';
import Bug from 'lucide-react/dist/esm/icons/bug';
import ExternalLink from 'lucide-react/dist/esm/icons/external-link';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw';
import ShieldCheck from 'lucide-react/dist/esm/icons/shield-check';
import Trash2 from 'lucide-react/dist/esm/icons/trash-2';
import { clearRuntimeEvents, useRuntimeWatchdog } from '../lib/runtimeWatchdog';

function formatTimestamp(value) {
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

function renderDetails(details) {
  if (!details) return null;
  return JSON.stringify(details, null, 2);
}

export default function WatchdogInbox() {
  const { entries, count, maxEntries, externalMonitoring } = useRuntimeWatchdog();

  const groupedCounts = useMemo(() => entries.reduce((accumulator, entry) => {
    accumulator[entry.type] = (accumulator[entry.type] || 0) + 1;
    return accumulator;
  }, {}), [entries]);

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--sp-4)', marginBottom: 'var(--sp-8)', flexWrap: 'wrap' }}>
        <div>
          <h1 className="page-title" style={{ marginBottom: 'var(--sp-2)' }}>
            <Bug size={28} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 'var(--sp-2)' }} />
            Watchdog Inbox
          </h1>
          <p className="page-subtitle">
            Local-first runtime issue inbox for crashes, stalled jobs, and rejected promises.
          </p>
        </div>

        <button className="btn btn-ghost" type="button" onClick={clearRuntimeEvents}>
          <Trash2 size={16} /> Clear Inbox
        </button>
      </div>

      <div className="grid grid-3" style={{ marginBottom: 'var(--sp-6)' }}>
        <div className="glass-card" style={{ padding: 'var(--sp-5)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', marginBottom: 'var(--sp-2)', color: 'var(--accent-danger)' }}>
            <AlertTriangle size={18} />
            <span style={{ fontWeight: 600 }}>Inbox Size</span>
          </div>
          <div style={{ fontSize: 'var(--fs-3xl)', fontWeight: 800 }}>{count}</div>
          <div style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-sm)' }}>
            Keeping the latest {maxEntries} runtime issues.
          </div>
        </div>

        <div className="glass-card" style={{ padding: 'var(--sp-5)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', marginBottom: 'var(--sp-2)', color: 'var(--accent-success)' }}>
            <ShieldCheck size={18} />
            <span style={{ fontWeight: 600 }}>Global Catchers</span>
          </div>
          <div style={{ fontSize: 'var(--fs-lg)', fontWeight: 700 }}>Active</div>
          <div style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-sm)' }}>
            Window errors and unhandled promise rejections are recorded automatically.
          </div>
        </div>

        <div className="glass-card" style={{ padding: 'var(--sp-5)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', marginBottom: 'var(--sp-2)', color: externalMonitoring.enabled ? 'var(--accent-info)' : 'var(--text-muted)' }}>
            <ExternalLink size={18} />
            <span style={{ fontWeight: 600 }}>External Monitoring</span>
          </div>
          <div style={{ fontSize: 'var(--fs-lg)', fontWeight: 700 }}>
            {externalMonitoring.enabled ? 'Configured' : 'Local only'}
          </div>
          <div style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-sm)' }}>
            {externalMonitoring.enabled
              ? externalMonitoring.endpoint
              : 'Set VITE_WATCHDOG_ENDPOINT to forward events outside this browser.'}
          </div>
        </div>
      </div>

      <div className="glass-card" style={{ padding: 'var(--sp-5)', marginBottom: 'var(--sp-6)' }}>
        <h2 style={{ fontSize: 'var(--fs-lg)', marginBottom: 'var(--sp-4)' }}>
          Recent Event Types
        </h2>
        {Object.keys(groupedCounts).length === 0 ? (
          <p style={{ color: 'var(--text-muted)' }}>No runtime events captured yet.</p>
        ) : (
          <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
            {Object.entries(groupedCounts).map(([type, total]) => (
              <span key={type} className="badge badge-warning">
                {type} ({total})
              </span>
            ))}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>
        {entries.length === 0 ? (
          <div className="glass-card" style={{ padding: 'var(--sp-8)', textAlign: 'center' }}>
            <ShieldCheck size={40} style={{ color: 'var(--accent-success)', marginBottom: 'var(--sp-3)' }} />
            <h3 style={{ marginBottom: 'var(--sp-2)' }}>No watchdog events</h3>
            <p style={{ color: 'var(--text-muted)' }}>
              The runtime inbox is clear right now.
            </p>
          </div>
        ) : (
          entries.map((entry) => (
            <div key={entry.id} className="glass-card" style={{ padding: 'var(--sp-5)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--sp-4)', flexWrap: 'wrap', marginBottom: 'var(--sp-3)' }}>
                <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap', alignItems: 'center' }}>
                  <span className={`badge ${entry.level === 'warning' ? 'badge-warning' : 'badge-danger'}`}>
                    {entry.level}
                  </span>
                  <span className="badge badge-info">{entry.type}</span>
                  <span className="badge">{entry.source}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', color: 'var(--text-muted)', fontSize: 'var(--fs-xs)' }}>
                  <RefreshCw size={12} />
                  <span>{formatTimestamp(entry.timestamp)}</span>
                </div>
              </div>

              <div style={{ fontSize: 'var(--fs-md)', fontWeight: 700, marginBottom: 'var(--sp-2)' }}>
                {entry.message}
              </div>

              <div style={{ display: 'flex', gap: 'var(--sp-3)', flexWrap: 'wrap', marginBottom: entry.stack || entry.details ? 'var(--sp-3)' : 0, color: 'var(--text-muted)', fontSize: 'var(--fs-sm)' }}>
                <span>Route: {entry.route}</span>
                {entry.name && <span>Error: {entry.name}</span>}
              </div>

              {entry.stack && (
                <pre style={{
                  marginBottom: entry.details ? 'var(--sp-3)' : 0,
                  padding: 'var(--sp-3)',
                  borderRadius: 'var(--radius-md)',
                  background: 'rgba(239,68,68,0.06)',
                  border: '1px solid rgba(239,68,68,0.12)',
                  color: 'var(--text-secondary)',
                  fontSize: 'var(--fs-xs)',
                  overflowX: 'auto',
                  fontFamily: 'var(--font-mono)',
                }}
                >
                  {entry.stack}
                </pre>
              )}

              {entry.details && (
                <pre style={{
                  padding: 'var(--sp-3)',
                  borderRadius: 'var(--radius-md)',
                  background: 'rgba(15,23,42,0.35)',
                  border: 'var(--border-subtle)',
                  color: 'var(--text-secondary)',
                  fontSize: 'var(--fs-xs)',
                  overflowX: 'auto',
                  fontFamily: 'var(--font-mono)',
                }}
                >
                  {renderDetails(entry.details)}
                </pre>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
