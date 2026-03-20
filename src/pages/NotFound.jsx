import { useNavigate } from 'react-router-dom';
import Compass from 'lucide-react/dist/esm/icons/compass';
import Home from 'lucide-react/dist/esm/icons/home';
import Search from 'lucide-react/dist/esm/icons/search';

export default function NotFound() {
  const navigate = useNavigate();

  return (
    <div className="glass-card" style={{ padding: 'var(--sp-12)', maxWidth: 720, margin: '10vh auto 0', textAlign: 'center' }}>
      <div style={{
        width: 72,
        height: 72,
        borderRadius: 'var(--radius-xl)',
        background: 'rgba(99,102,241,0.12)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        margin: '0 auto var(--sp-5)',
      }}>
        <Compass size={34} style={{ color: 'var(--accent-primary)' }} />
      </div>
      <h1 style={{ fontSize: 'var(--fs-3xl)', marginBottom: 'var(--sp-3)' }}>Page Not Found</h1>
      <p style={{ color: 'var(--text-muted)', marginBottom: 'var(--sp-6)' }}>
        The page you opened does not exist or the route is no longer valid.
      </p>
      <div style={{ display: 'flex', gap: 'var(--sp-3)', justifyContent: 'center', flexWrap: 'wrap' }}>
        <button className="btn btn-primary" type="button" onClick={() => navigate('/')}>
          <Home size={16} /> Go Home
        </button>
        <button className="btn btn-ghost" type="button" onClick={() => navigate('/cases')}>
          <Search size={16} /> Browse Cases
        </button>
      </div>
    </div>
  );
}
