/**
 * MedCase Pro — Analytics Page
 * Performance visualization: accuracy gauge, category breakdown, weak areas
 */
import { useStore } from '../data/store';
import { CATEGORIES } from '../data/caseLoader';
import BarChart3 from 'lucide-react/dist/esm/icons/bar-chart-3';
import Target from 'lucide-react/dist/esm/icons/target';
import TrendingUp from 'lucide-react/dist/esm/icons/trending-up';
import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle';
import Award from 'lucide-react/dist/esm/icons/award';
import Brain from 'lucide-react/dist/esm/icons/brain';

function AccuracyGauge({ value }) {
  const angle = (value / 100) * 180;
  const color = value >= 70 ? 'var(--accent-success)' : value >= 50 ? 'var(--accent-warning)' : 'var(--accent-danger)';
  return (
    <div style={{ position: 'relative', width: 200, height: 110, margin: '0 auto' }}>
      <svg width="200" height="110" viewBox="0 0 200 110">
        <path d="M 10 100 A 90 90 0 0 1 190 100" fill="none" stroke="rgba(148,163,184,0.1)" strokeWidth="12" strokeLinecap="round" />
        <path d="M 10 100 A 90 90 0 0 1 190 100" fill="none" stroke={color} strokeWidth="12" strokeLinecap="round"
          strokeDasharray={`${(angle / 180) * 283} 283`}
          style={{ transition: 'stroke-dasharray 1s cubic-bezier(0.16, 1, 0.3, 1)' }} />
      </svg>
      <div style={{ position: 'absolute', bottom: 0, left: '50%', transform: 'translateX(-50%)', textAlign: 'center' }}>
        <span style={{ fontSize: 'var(--fs-3xl)', fontWeight: 800, fontFamily: 'var(--font-heading)', color }}>{value}%</span>
        <br />
        <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>Overall Accuracy</span>
      </div>
    </div>
  );
}

function CategoryBar({ label, accuracy, total, color }) {
  return (
    <div style={{ marginBottom: 'var(--sp-4)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--sp-1)', fontSize: 'var(--fs-sm)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
          <div style={{ width: 8, height: 8, borderRadius: 'var(--radius-full)', background: color }} />
          <span>{label}</span>
        </div>
        <span style={{ color: accuracy >= 70 ? 'var(--accent-success)' : accuracy >= 50 ? 'var(--accent-warning)' : 'var(--accent-danger)', fontWeight: 600 }}>
          {total > 0 ? `${accuracy}%` : '—'}
        </span>
      </div>
      <div className="progress-bar">
        <div className="progress-bar-fill" style={{ width: `${accuracy}%`, background: color, transition: 'width 1s cubic-bezier(0.16,1,0.3,1)' }} />
      </div>
    </div>
  );
}

export default function Analytics() {
  const { totalAnswered, totalCorrect, categoryScores, streak, getAccuracy } = useStore();
  const accuracy = getAccuracy();

  const categoryData = Object.entries(CATEGORIES).map(([key, cat]) => {
    const scores = categoryScores[key];
    return {
      key,
      label: cat.label,
      color: cat.color,
      total: scores?.total || 0,
      correct: scores?.correct || 0,
      accuracy: scores && scores.total > 0 ? Math.round((scores.correct / scores.total) * 100) : 0,
    };
  }).sort((a, b) => b.total - a.total);

  const weakAreas = categoryData.filter(c => c.total >= 2 && c.accuracy < 70);
  const strongAreas = categoryData.filter(c => c.total >= 2 && c.accuracy >= 70);

  return (
    <div>
      <h1 className="page-title" style={{ marginBottom: 'var(--sp-2)' }}>
        <BarChart3 size={28} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 'var(--sp-2)' }} />
        Performance Analytics
      </h1>
      <p className="page-subtitle" style={{ marginBottom: 'var(--sp-8)' }}>
        Track your progress across all categories and identify areas for improvement.
      </p>

      {totalAnswered === 0 ? (
        <div className="glass-card" style={{ padding: 'var(--sp-12)', textAlign: 'center' }}>
          <Brain size={48} style={{ color: 'var(--text-muted)', marginBottom: 'var(--sp-4)' }} />
          <h3 style={{ marginBottom: 'var(--sp-2)' }}>No data yet</h3>
          <p style={{ color: 'var(--text-muted)' }}>Start answering cases to see your analytics here.</p>
        </div>
      ) : (
        <>
          {/* Overview */}
          <div className="grid grid-3" style={{ marginBottom: 'var(--sp-8)' }}>
            <div className="glass-card" style={{ padding: 'var(--sp-6)', gridColumn: 'span 1' }}>
              <AccuracyGauge value={accuracy} />
            </div>
            <div className="glass-card" style={{ padding: 'var(--sp-6)', gridColumn: 'span 2' }}>
              <h3 style={{ fontSize: 'var(--fs-md)', marginBottom: 'var(--sp-4)', display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
                <Target size={18} /> Performance Summary
              </h3>
              <div className="grid grid-2" style={{ gap: 'var(--sp-4)' }}>
                <div>
                  <div className="stat-label">Total Answered</div>
                  <div style={{ fontSize: 'var(--fs-2xl)', fontWeight: 800 }}>{totalAnswered}</div>
                </div>
                <div>
                  <div className="stat-label">Correct</div>
                  <div style={{ fontSize: 'var(--fs-2xl)', fontWeight: 800, color: 'var(--accent-success)' }}>{totalCorrect}</div>
                </div>
                <div>
                  <div className="stat-label">Incorrect</div>
                  <div style={{ fontSize: 'var(--fs-2xl)', fontWeight: 800, color: 'var(--accent-danger)' }}>{totalAnswered - totalCorrect}</div>
                </div>
                <div>
                  <div className="stat-label">Study Streak</div>
                  <div style={{ fontSize: 'var(--fs-2xl)', fontWeight: 800, color: 'var(--accent-warning)' }}>{streak} days</div>
                </div>
              </div>
            </div>
          </div>

          {/* Category Breakdown */}
          <div className="glass-card" style={{ padding: 'var(--sp-6)', marginBottom: 'var(--sp-8)' }}>
            <h3 style={{ fontSize: 'var(--fs-md)', marginBottom: 'var(--sp-5)', display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
              <TrendingUp size={18} /> Category Breakdown
            </h3>
            {categoryData.map(cat => (
              <CategoryBar key={cat.key} label={cat.label} accuracy={cat.accuracy} total={cat.total} color={cat.color} />
            ))}
          </div>

          {/* Weak & Strong Areas */}
          <div className="grid grid-2" style={{ marginBottom: 'var(--sp-8)' }}>
            <div className="glass-card" style={{ padding: 'var(--sp-6)', borderTop: '3px solid var(--accent-danger)' }}>
              <h3 style={{ fontSize: 'var(--fs-md)', marginBottom: 'var(--sp-4)', display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', color: 'var(--accent-danger)' }}>
                <AlertTriangle size={18} /> Weak Areas
              </h3>
              {weakAreas.length > 0 ? weakAreas.map(area => (
                <div key={area.key} style={{ display: 'flex', justifyContent: 'space-between', padding: 'var(--sp-2) 0', borderBottom: 'var(--border-subtle)', fontSize: 'var(--fs-sm)' }}>
                  <span>{area.label}</span>
                  <span style={{ color: 'var(--accent-danger)', fontWeight: 600 }}>{area.accuracy}%</span>
                </div>
              )) : <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>No weak areas identified yet. Keep practicing!</p>}
            </div>
            <div className="glass-card" style={{ padding: 'var(--sp-6)', borderTop: '3px solid var(--accent-success)' }}>
              <h3 style={{ fontSize: 'var(--fs-md)', marginBottom: 'var(--sp-4)', display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', color: 'var(--accent-success)' }}>
                <Award size={18} /> Strong Areas
              </h3>
              {strongAreas.length > 0 ? strongAreas.map(area => (
                <div key={area.key} style={{ display: 'flex', justifyContent: 'space-between', padding: 'var(--sp-2) 0', borderBottom: 'var(--border-subtle)', fontSize: 'var(--fs-sm)' }}>
                  <span>{area.label}</span>
                  <span style={{ color: 'var(--accent-success)', fontWeight: 600 }}>{area.accuracy}%</span>
                </div>
              )) : <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>Answer more cases to identify your strengths.</p>}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
