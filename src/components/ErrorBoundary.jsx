/**
 * MedCase Pro — Error Boundary Component
 * Graceful crash recovery with retry capability
 */
import { Component } from 'react';
import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle';
import RotateCcw from 'lucide-react/dist/esm/icons/rotate-ccw';
import Home from 'lucide-react/dist/esm/icons/home';
import { captureException } from '../lib/runtimeWatchdog';

const HOME_PATH = import.meta.env.BASE_URL || '/';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    this.setState({ errorInfo });
    captureException(error, {
      type: 'react-boundary',
      source: 'error-boundary',
      message: error?.message || 'React tree crashed.',
      metadata: {
        componentStack: errorInfo?.componentStack || '',
      },
    });
    console.error('[MedCase] Error caught:', error, errorInfo);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  handleGoHome = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    window.location.assign(HOME_PATH);
  };

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          minHeight: '80vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 'var(--sp-8)',
        }}>
          <div className="glass-card" style={{
            padding: 'var(--sp-8)', maxWidth: 500, textAlign: 'center',
          }}>
            <div style={{
              width: 64, height: 64, borderRadius: 'var(--radius-xl)',
              background: 'rgba(245,158,11,0.1)', display: 'flex',
              alignItems: 'center', justifyContent: 'center', margin: '0 auto var(--sp-6)',
            }}>
              <AlertTriangle size={32} style={{ color: 'var(--accent-warning)' }} />
            </div>
            <h2 style={{ fontSize: 'var(--fs-xl)', marginBottom: 'var(--sp-2)' }}>Something went wrong</h2>
            <p style={{ color: 'var(--text-muted)', marginBottom: 'var(--sp-6)', fontSize: 'var(--fs-sm)' }}>
              An error occurred while rendering this page. Your progress is safe — it's saved locally.
            </p>
            {this.state.error && (
              <pre style={{
                textAlign: 'left', padding: 'var(--sp-3)', borderRadius: 'var(--radius-md)',
                background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.12)',
                fontSize: 'var(--fs-xs)', color: 'var(--accent-danger)', overflow: 'auto',
                maxHeight: 100, marginBottom: 'var(--sp-6)', fontFamily: 'var(--font-mono)',
              }}>
                {this.state.error.toString()}
              </pre>
            )}
            <div style={{ display: 'flex', gap: 'var(--sp-3)', justifyContent: 'center' }}>
              <button className="btn btn-primary" onClick={this.handleRetry}>
                <RotateCcw size={16} /> Retry
              </button>
              <button className="btn btn-ghost" onClick={this.handleGoHome}>
                <Home size={16} /> Go Home
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
