import React from 'react';

const srOnlyStyle = {
  position: 'absolute',
  width: '1px',
  height: '1px',
  padding: 0,
  margin: '-1px',
  overflow: 'hidden',
  clip: 'rect(0, 0, 0, 0)',
  whiteSpace: 'nowrap',
  border: 0,
};

export function Skeleton({ width = '100%', height = '1rem', className = '', style = {}, variant = 'text' }) {
  const baseStyle = { width, height, ...style };
  
  const classes = `skeleton skeleton-${variant} ${className}`;
  
  return (
    <div className={classes} style={baseStyle}></div>
  );
}

export function CaseSkeleton() {
  return (
    <div className="case-player-split" role="status" aria-live="polite" aria-busy="true">
      <span style={srOnlyStyle}>Loading Case Library...</span>
      <div className="vignette-pane glass-card" style={{ padding: 'var(--sp-6)', marginBottom: 'var(--sp-6)' }}>
        <Skeleton width="40%" height="2rem" style={{ marginBottom: 'var(--sp-4)' }} />
        <Skeleton width="25%" height="1.5rem" style={{ marginBottom: 'var(--sp-4)', borderRadius: 'var(--radius-full)' }} />
        
        <Skeleton width="100%" height="1rem" style={{ marginBottom: 'var(--sp-2)' }} />
        <Skeleton width="100%" height="1rem" style={{ marginBottom: 'var(--sp-2)' }} />
        <Skeleton width="90%" height="1rem" style={{ marginBottom: 'var(--sp-2)' }} />
        <Skeleton width="95%" height="1rem" style={{ marginBottom: 'var(--sp-2)' }} />
        <Skeleton width="85%" height="1rem" style={{ marginBottom: 'var(--sp-2)' }} />
      </div>
      
      <div className="interaction-pane">
        <div className="glass-card" style={{ padding: 'var(--sp-6)', marginBottom: 'var(--sp-6)' }}>
          <Skeleton width="70%" height="1.5rem" style={{ marginBottom: 'var(--sp-5)' }} />
          
          <div style={{ display: 'grid', gap: 'var(--sp-3)' }}>
            <Skeleton width="100%" height="48px" style={{ borderRadius: 'var(--radius-lg)' }} />
            <Skeleton width="100%" height="48px" style={{ borderRadius: 'var(--radius-lg)' }} />
            <Skeleton width="100%" height="48px" style={{ borderRadius: 'var(--radius-lg)' }} />
            <Skeleton width="100%" height="48px" style={{ borderRadius: 'var(--radius-lg)' }} />
            <Skeleton width="100%" height="48px" style={{ borderRadius: 'var(--radius-lg)' }} />
          </div>
        </div>
      </div>
    </div>
  );
}
