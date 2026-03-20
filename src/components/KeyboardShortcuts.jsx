/**
 * Keyboard shortcut hints component
 */
export function ShortcutHints({ isReviewing, isSCT }) {
  const shortcuts = isReviewing
    ? [
        { key: 'E', label: 'Explanation' },
        { key: 'N', label: 'Next' },
        { key: 'Enter', label: 'Next' },
        { key: 'B', label: 'Bookmark' },
      ]
    : [
        { key: isSCT ? '1-5' : 'A-E', label: 'Select' },
        { key: 'Enter', label: 'Submit' },
        { key: 'B', label: 'Bookmark' },
        { key: 'Esc', label: 'Back' },
      ];

  return (
    <div style={{
      display: 'flex', gap: 'var(--sp-3)', justifyContent: 'center',
      padding: 'var(--sp-3)', opacity: 0.5, fontSize: 'var(--fs-xs)',
    }}>
      {shortcuts.map(s => (
        <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-1)' }}>
          <kbd style={{
            padding: '2px 6px', borderRadius: 4,
            background: 'rgba(148,163,184,0.1)', border: 'var(--border-subtle)',
            fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 600,
          }}>{s.key}</kbd>
          <span style={{ color: 'var(--text-muted)' }}>{s.label}</span>
        </div>
      ))}
    </div>
  );
}
