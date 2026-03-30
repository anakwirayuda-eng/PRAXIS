/**
 * MedCase Pro — Pass Predictor Page (Monte Carlo Oracle)
 * Simulates 10,000 virtual exams using FSRS retrievability
 */
import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { motion as Motion, AnimatePresence } from 'framer-motion';
import { useCaseBank } from '../data/caseLoader';
import { brainMatrix, recalcRetrievability, getBrainStats } from '../data/fsrs';
import { useStore } from '../data/store';
import { captureException, captureMessage } from '../lib/runtimeWatchdog';
import Dices from 'lucide-react/dist/esm/icons/dices';
import Loader from 'lucide-react/dist/esm/icons/loader';
import Target from 'lucide-react/dist/esm/icons/target';
import TrendingUp from 'lucide-react/dist/esm/icons/trending-up';
import Brain from 'lucide-react/dist/esm/icons/brain';
import BarChart3 from 'lucide-react/dist/esm/icons/bar-chart-3';
import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle';
import Settings from 'lucide-react/dist/esm/icons/settings';

const WORKER_STALL_TIMEOUT_MS = 15000;
const WORKER_MAX_RESTARTS = 1;

function isPlayablePredictorCase(caseData, examType) {
  if (caseData?.q_type !== 'MCQ') return false;
  if (caseData?.meta?.quarantined || caseData?.meta?.truncated || caseData?.meta?.needs_review) return false;
  if (caseData?.meta?.status?.startsWith?.('QUARANTINED')) return false;
  return examType === 'all'
    || caseData?.meta?.examType === examType
    || caseData?.meta?.examType === 'BOTH';
}

function DistributionChart({ distribution, passMarkScore, totalQuestions, isCompact = false }) {
  if (!distribution) return null;

  const bucketCount = isCompact ? Math.min(40, totalQuestions) : totalQuestions;
  const bucketSize = Math.ceil(totalQuestions / bucketCount);
  const buckets = Array.from({ length: bucketCount }, (_, bucketIndex) => {
    const start = bucketIndex * bucketSize;
    const end = Math.min(totalQuestions, start + bucketSize);
    const count = distribution.slice(start, end).reduce((sum, value) => sum + value, 0);
    return { start, end, count };
  });
  const maxCount = Math.max(...buckets.map((bucket) => bucket.count), 0);
  const barWidth = `${100 / buckets.length}%`;

  return (
    <div style={{ position: 'relative', height: isCompact ? 96 : 120, display: 'flex', alignItems: 'flex-end', gap: 0, overflow: 'visible', borderRadius: 'var(--radius-md)', padding: 'var(--sp-2)' }}>
      {buckets.map((bucket) => {
        const height = maxCount > 0 ? (bucket.count / maxCount) * 100 : 0;
        const isPassing = bucket.end > passMarkScore;
        const label = bucket.end - bucket.start <= 1
          ? `Score ${bucket.start}: ${bucket.count} simulations`
          : `Scores ${bucket.start}-${bucket.end - 1}: ${bucket.count} simulations`;

        return (
          <div
            key={`${bucket.start}-${bucket.end}`}
            style={{
              width: barWidth,
              minWidth: 1,
              height: `${height}%`,
              background: isPassing
                ? 'linear-gradient(180deg, var(--accent-success), rgba(16,185,129,0.3))'
                : 'linear-gradient(180deg, var(--accent-danger), rgba(239,68,68,0.3))',
              borderRadius: '2px 2px 0 0',
              transition: 'height 0.5s ease',
              opacity: bucket.count === 0 ? 0 : 1,
            }}
            title={label}
          />
        );
      })}

      <div style={{
        position: 'absolute',
        left: `${(passMarkScore / totalQuestions) * 100}%`,
        top: 0,
        bottom: 0,
        borderLeft: '2px dashed var(--accent-warning)',
        zIndex: 2,
      }}>
        <span style={{
          position: 'absolute',
          top: isCompact ? -14 : -2,
          left: 4,
          transform: 'translateX(-50%)',
          fontSize: isCompact ? 8 : 9,
          color: 'var(--accent-warning)',
          fontWeight: 700,
          whiteSpace: 'nowrap',
        }}>
          Pass: {passMarkScore}
        </span>
      </div>
    </div>
  );
}

export default function PassPredictor() {
  const { totalAnswered } = useStore();
  const { cases: caseBank, status, isLoading } = useCaseBank();
  const [isCompactMobile, setIsCompactMobile] = useState(() => typeof window !== 'undefined' ? window.innerWidth <= 480 : false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState(null);
  const [simulationError, setSimulationError] = useState('');
  const workerRef = useRef(null);
  const workerTimeoutRef = useRef(null);

  const [config, setConfig] = useState({
    examType: 'UKMPPD',
    totalQuestions: 150,
    passMark: 0.66,
    iterations: 10000,
  });

  // Memory stats scoped to the active exam pool (not global)
  const brainStats = useMemo(() => {
    const poolIds = new Set(
      caseBank
        .filter((caseData) => isPlayablePredictorCase(caseData, config.examType))
        .map(c => c._id)
    );
    return getBrainStats(poolIds);
  }, [caseBank, config.examType]);

  useEffect(() => {
    const handleResize = () => setIsCompactMobile(window.innerWidth <= 480);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);


  const presets = {
    UKMPPD: { totalQuestions: 150, passMark: 0.66, label: 'UKMPPD CBT', icon: 'ID' },
    USMLE: { totalQuestions: 280, passMark: 0.60, label: 'USMLE Step 2 CK', icon: 'US' },
  };

  const clearWorkerTimeout = useCallback(() => {
    if (workerTimeoutRef.current) {
      window.clearTimeout(workerTimeoutRef.current);
      workerTimeoutRef.current = null;
    }
  }, []);

  const cleanupWorker = useCallback(() => {
    clearWorkerTimeout();
    if (workerRef.current) {
      workerRef.current.onmessage = null;
      workerRef.current.onerror = null;
      workerRef.current.terminate();
      workerRef.current = null;
    }
  }, [clearWorkerTimeout]);

  useEffect(() => () => {
    cleanupWorker();
  }, [cleanupWorker]);

  const runSimulation = useCallback(() => {
    if (status !== 'ready') {
      setSimulationError('Wait for the full case library to finish loading before running the predictor.');
      captureMessage('Pass predictor was blocked because the case library is not ready yet.', {
        type: 'worker-blocked',
        source: 'pass-predictor',
        metadata: {
          status,
        },
      });
      return;
    }

    setRunning(true);
    setProgress(0);
    setResult(null);
    setSimulationError('');
    recalcRetrievability();

    cleanupWorker();

    const casePoolRaw = caseBank.filter((caseData) => isPlayablePredictorCase(caseData, config.examType));
    const casePool = casePoolRaw.map((caseData) => caseData._id);
    const guessRateByCase = Object.fromEntries(
      casePoolRaw.map((caseData) => [
        String(caseData._id),
        caseData.options?.length ? 1 / caseData.options.length : 0.20,
      ]),
    );

    if (casePool.length === 0) {
      setRunning(false);
      setSimulationError('No cases match the selected exam type.');
      captureMessage('Pass predictor could not find any cases for the selected exam type.', {
        type: 'worker-blocked',
        source: 'pass-predictor',
        metadata: {
          examType: config.examType,
        },
      });
      return;
    }

    if (typeof Worker === 'undefined') {
      setRunning(false);
      setSimulationError('This browser does not support Web Workers.');
      captureMessage('Pass predictor is unavailable because this browser does not support Web Workers.', {
        type: 'worker-unsupported',
        source: 'pass-predictor',
      });
      return;
    }

    const simulationMetadata = {
      examType: config.examType,
      requestedQuestions: config.totalQuestions,
      iterations: config.iterations,
      casePoolSize: casePool.length,
    };

    if (casePool.length < config.totalQuestions) {
      captureMessage('Pass predictor reduced question count to the available case pool.', {
        type: 'worker-pool-clamped',
        source: 'pass-predictor',
        metadata: simulationMetadata,
      });
    }

    const launchWorker = (attempt = 0) => {
      const attemptNumber = attempt + 1;
      let worker;

      const armWorkerTimeout = () => {
        clearWorkerTimeout();
        workerTimeoutRef.current = window.setTimeout(() => {
          captureMessage(`Pass predictor worker stalled after ${WORKER_STALL_TIMEOUT_MS}ms.`, {
            type: 'worker-timeout',
            source: 'pass-predictor',
            metadata: {
              ...simulationMetadata,
              attempt: attemptNumber,
            },
          });

          cleanupWorker();

          if (attempt < WORKER_MAX_RESTARTS) {
            captureMessage('Restarting stalled pass predictor worker automatically.', {
              type: 'worker-restart',
              source: 'pass-predictor',
              metadata: {
                ...simulationMetadata,
                attempt: attemptNumber,
                reason: 'timeout',
              },
            });
            launchWorker(attempt + 1);
            return;
          }

          setRunning(false);
          setSimulationError('Simulation stalled twice and was stopped. Check Watchdog Inbox for details.');
        }, WORKER_STALL_TIMEOUT_MS);
      };

      try {
        worker = new Worker(`${import.meta.env.BASE_URL}workers/oracle.worker.js`);
        workerRef.current = worker;
      } catch (error) {
        captureException(error, {
          type: 'worker-startup-failed',
          source: 'pass-predictor',
          message: 'Pass Predictor could not start its simulation worker.',
          metadata: {
            ...simulationMetadata,
            attempt: attemptNumber,
          },
        });
        console.error('[Oracle] Worker startup failed:', error);
        setRunning(false);
        setSimulationError('Pass Predictor could not start its simulation worker.');
        return;
      }

      worker.onmessage = (event) => {
        if (workerRef.current !== worker) {
          return;
        }

        if (event.data.type === 'progress') {
          setProgress(event.data.progress);
          armWorkerTimeout();
          return;
        }

        if (event.data.type === 'result') {
          captureMessage('Pass predictor simulation completed.', {
            type: 'worker-result',
            source: 'pass-predictor',
            level: 'info',
            metadata: {
              ...simulationMetadata,
              attempt: attemptNumber,
              totalQuestions: event.data.totalQuestions,
              passProbability: event.data.passProbability,
            },
          });
          setResult(event.data);
          setRunning(false);
          setProgress(100);
          cleanupWorker();
        }
      };

      worker.onerror = (event) => {
        if (workerRef.current !== worker) {
          return;
        }

        const error = event.error instanceof Error
          ? event.error
          : new Error(event.message || 'Simulation worker failed.');

        captureException(error, {
          type: 'worker-error',
          source: 'pass-predictor',
          message: error.message,
          metadata: {
            ...simulationMetadata,
            attempt: attemptNumber,
            autoRestart: attempt < WORKER_MAX_RESTARTS,
          },
        });
        console.error('[Oracle] Worker error:', event);
        cleanupWorker();

        if (attempt < WORKER_MAX_RESTARTS) {
          captureMessage('Restarting pass predictor worker after a runtime error.', {
            type: 'worker-restart',
            source: 'pass-predictor',
            metadata: {
              ...simulationMetadata,
              attempt: attemptNumber,
              reason: 'runtime-error',
            },
          });
          launchWorker(attempt + 1);
          return;
        }

        setRunning(false);
        setSimulationError('Simulation failed twice and was stopped. Check Watchdog Inbox for details.');
      };

      try {
        worker.postMessage({
          brainBuffer: brainMatrix.buffer.slice(0),
          examConfig: {
            totalQuestions: config.totalQuestions,
            passMark: config.passMark,
            iterations: config.iterations,
            casePool,
            guessRateByCase,
            guessRate: 0.20, // fallback for older worker cache
          },
        });
        captureMessage(
          attempt === 0
            ? 'Pass predictor worker started.'
            : 'Pass predictor worker restarted.',
          {
            type: attempt === 0 ? 'worker-start' : 'worker-restart',
            source: 'pass-predictor',
            level: 'info',
            metadata: {
              ...simulationMetadata,
              attempt: attemptNumber,
            },
          },
        );
        armWorkerTimeout();
      } catch (error) {
        captureException(error, {
          type: 'worker-postmessage-failed',
          source: 'pass-predictor',
          message: 'Pass Predictor could not send data to its worker.',
          metadata: {
            ...simulationMetadata,
            attempt: attemptNumber,
          },
        });
        cleanupWorker();

        if (attempt < WORKER_MAX_RESTARTS) {
          launchWorker(attempt + 1);
          return;
        }

        setRunning(false);
        setSimulationError('Pass Predictor could not send data to its worker.');
      }
    };

    launchWorker();
  }, [caseBank, cleanupWorker, clearWorkerTimeout, config, status]);

  const getPassColor = (prob) => {
    if (prob >= 80) return 'var(--accent-success)';
    if (prob >= 60) return 'var(--accent-warning)';
    return 'var(--accent-danger)';
  };

  const getPassVerdict = (prob) => {
    if (prob >= 90) return { text: 'Excellent - High confidence pass', icon: 'TOP' };
    if (prob >= 80) return { text: 'Good - Likely to pass', icon: 'PASS' };
    if (prob >= 60) return { text: 'Borderline - More study recommended', icon: 'WARN' };
    if (prob >= 40) return { text: 'At Risk - Significant gaps detected', icon: 'RISK' };
    return { text: 'Not Ready - Intensive review needed', icon: 'STOP' };
  };

  return (
    <div style={{ maxWidth: 800, margin: '0 auto' }}>
      <h1 className="page-title" style={{ marginBottom: 'var(--sp-2)' }}>
        <Dices size={28} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 'var(--sp-2)' }} />
        Pass Predictor
      </h1>
      <p className="page-subtitle" style={{ marginBottom: 'var(--sp-8)' }}>
        Monte Carlo simulation - 10,000 virtual exams based on your FSRS memory data.
      </p>
      {status !== 'ready' && (
        <div className="glass-card" style={{ padding: 'var(--sp-3) var(--sp-4)', marginBottom: 'var(--sp-6)' }}>
          <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>
            {isLoading
              ? 'Loading the full case library. Predictor stays locked until the full pool is ready.'
              : 'Compiled case library is unavailable, so predictor cannot build a reliable full exam pool.'}
          </span>
        </div>
      )}

      <div className="glass-card" style={{ padding: 'var(--sp-5)', marginBottom: 'var(--sp-6)' }}>
        <h3 style={{ fontSize: 'var(--fs-md)', marginBottom: 'var(--sp-3)', display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
          <Brain size={18} /> Your Memory State
        </h3>
        <div className="grid grid-4" style={{ gap: 'var(--sp-3)' }}>
          <div>
            <div className="stat-label">Cases Reviewed</div>
            <div style={{ fontSize: 'var(--fs-xl)', fontWeight: 800 }}>{brainStats.totalReviewed}</div>
          </div>
          <div>
            <div className="stat-label">Avg Retention</div>
            <div style={{ fontSize: 'var(--fs-xl)', fontWeight: 800, color: brainStats.averageRetention >= 70 ? 'var(--accent-success)' : 'var(--accent-warning)' }}>
              {brainStats.averageRetention}%
            </div>
          </div>
          <div>
            <div className="stat-label">Lapses</div>
            <div style={{ fontSize: 'var(--fs-xl)', fontWeight: 800, color: 'var(--accent-danger)' }}>{brainStats.totalLapses}</div>
          </div>
          <div>
            <div className="stat-label">Memory Strength</div>
            <div style={{ fontSize: 'var(--fs-xl)', fontWeight: 800 }}>{brainStats.memoryStrength}</div>
          </div>
        </div>
      </div>

      <div className="glass-card" style={{ padding: 'var(--sp-5)', marginBottom: 'var(--sp-6)' }}>
        <h3 style={{ fontSize: 'var(--fs-md)', marginBottom: 'var(--sp-4)', display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
          <Settings size={18} /> Exam Configuration
        </h3>
        <div style={{ display: 'flex', gap: 'var(--sp-3)', marginBottom: 'var(--sp-4)', flexWrap: 'wrap' }}>
          {Object.entries(presets).map(([key, preset]) => (
            <button
              key={key}
              className={`btn ${config.examType === key ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setConfig({ ...config, examType: key, totalQuestions: preset.totalQuestions, passMark: preset.passMark })}
              style={{ flex: 1 }}
            >
              {preset.icon} {preset.label}
            </button>
          ))}
        </div>

        <div className="grid grid-3" style={{ gap: 'var(--sp-3)' }}>
          <div>
            <label htmlFor="predictor-total-questions" style={{ display: 'block', fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', marginBottom: 'var(--sp-1)' }}>Questions</label>
            <input
              id="predictor-total-questions"
              className="input"
              type="number"
              value={config.totalQuestions}
              min={10}
              max={400}
              onChange={(event) => setConfig({ ...config, totalQuestions: Number.parseInt(event.target.value, 10) || 150 })}
            />
          </div>
          <div>
            <label htmlFor="predictor-pass-rate" style={{ display: 'block', fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', marginBottom: 'var(--sp-1)' }}>Pass Rate (%)</label>
            <input
              id="predictor-pass-rate"
              className="input"
              type="number"
              value={Math.round(config.passMark * 100)}
              min={30}
              max={90}
              onChange={(event) => setConfig({ ...config, passMark: (Number.parseInt(event.target.value, 10) || 66) / 100 })}
            />
          </div>
          <div>
            <label htmlFor="predictor-iterations" style={{ display: 'block', fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', marginBottom: 'var(--sp-1)' }}>Simulations</label>
            <input
              id="predictor-iterations"
              className="input"
              type="number"
              value={config.iterations}
              min={1000}
              max={50000}
              step={1000}
              onChange={(event) => setConfig({ ...config, iterations: Number.parseInt(event.target.value, 10) || 10000 })}
            />
          </div>
        </div>

        <div style={{ marginTop: 'var(--sp-4)', display: 'flex', justifyContent: 'flex-end' }}>
          <button className="btn btn-primary btn-lg" onClick={runSimulation} disabled={running || status !== 'ready'}>
            {running
              ? <><Loader size={18} style={{ animation: 'spin 1s linear infinite' }} /> Simulating...</>
              : <><Dices size={18} /> Run {config.iterations.toLocaleString()} Simulations</>}
          </button>
        </div>
      </div>

      {running && (
        <div className="glass-card" style={{ padding: 'var(--sp-5)', marginBottom: 'var(--sp-6)', textAlign: 'center' }}>
          <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', marginBottom: 'var(--sp-3)' }}>
            Simulating {config.iterations.toLocaleString()} alternate realities...
          </div>
          <div className="progress-bar" style={{ marginBottom: 'var(--sp-2)' }}>
            <div className="progress-bar-fill" style={{ width: `${progress}%`, transition: 'width 0.3s' }} />
          </div>
          <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>{progress}%</span>
        </div>
      )}

      {simulationError && (
        <div className="glass-card" style={{ padding: 'var(--sp-5)', marginBottom: 'var(--sp-6)', borderTop: '3px solid var(--accent-danger)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', color: 'var(--accent-danger)', fontWeight: 600 }}>
            <AlertTriangle size={18} />
            <span>{simulationError}</span>
          </div>
        </div>
      )}

      <AnimatePresence>
        {result && (
          <Motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
            <div className="glass-card" style={{ padding: 'var(--sp-8)', marginBottom: 'var(--sp-6)', textAlign: 'center', borderTop: `3px solid ${getPassColor(result.passProbability)}` }}>
              <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', marginBottom: 'var(--sp-2)' }}>
                From {result.iterations.toLocaleString()} alternate realities based on your memory today...
              </div>
              <div style={{ fontSize: isCompactMobile ? 56 : 72, fontWeight: 900, fontFamily: 'var(--font-heading)', color: getPassColor(result.passProbability), lineHeight: 1, marginBottom: 'var(--sp-2)' }}>
                {result.passProbability}%
              </div>
              <div style={{ fontSize: 'var(--fs-lg)', fontWeight: 600, marginBottom: 'var(--sp-3)' }}>Pass Probability</div>
              <div style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 'var(--sp-2)',
                padding: 'var(--sp-2) var(--sp-4)',
                borderRadius: 'var(--radius-full)',
                background: `${getPassColor(result.passProbability)}10`,
                color: getPassColor(result.passProbability),
                fontSize: 'var(--fs-sm)',
                fontWeight: 600,
              }}>
                {getPassVerdict(result.passProbability).icon} {getPassVerdict(result.passProbability).text}
              </div>
            </div>

            <div className="glass-card" style={{ padding: 'var(--sp-5)', marginBottom: 'var(--sp-6)' }}>
              <h3 style={{ fontSize: 'var(--fs-md)', marginBottom: 'var(--sp-3)', display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
                <BarChart3 size={18} /> Score Distribution
              </h3>
              <DistributionChart distribution={result.distribution} passMarkScore={result.passMarkScore} totalQuestions={result.totalQuestions} isCompact={isCompactMobile} />
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--sp-2)', flexWrap: 'wrap', marginTop: 'var(--sp-3)', fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>
                <span style={{ color: 'var(--accent-danger)' }}>FAIL</span>
                <span style={{ color: 'var(--accent-warning)' }}>PASS MARK ({result.passMarkScore}/{result.totalQuestions})</span>
                <span style={{ color: 'var(--accent-success)' }}>PASS</span>
              </div>
            </div>

            <div className="grid grid-2" style={{ marginBottom: 'var(--sp-6)' }}>
              <div className="glass-card" style={{ padding: 'var(--sp-5)' }}>
                <h3 style={{ fontSize: 'var(--fs-md)', marginBottom: 'var(--sp-4)', display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
                  <Target size={18} /> Expected Score
                </h3>
                <div style={{ fontSize: 'var(--fs-3xl)', fontWeight: 800, fontFamily: 'var(--font-heading)', marginBottom: 'var(--sp-1)' }}>
                  {result.expectedScore} <span style={{ fontSize: 'var(--fs-base)', color: 'var(--text-muted)', fontWeight: 400 }}>/ {result.totalQuestions}</span>
                </div>
                <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>({result.expectedPct}% accuracy)</div>
              </div>

              <div className="glass-card" style={{ padding: 'var(--sp-5)' }}>
                <h3 style={{ fontSize: 'var(--fs-md)', marginBottom: 'var(--sp-4)', display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
                  <TrendingUp size={18} /> Score Percentiles
                </h3>
                {[
                  { label: 'Best case (P95)', val: result.percentiles.p95 },
                  { label: 'Upper (P75)', val: result.percentiles.p75 },
                  { label: 'Median (P50)', val: result.percentiles.p50 },
                  { label: 'Lower (P25)', val: result.percentiles.p25 },
                  { label: 'Worst case (P5)', val: result.percentiles.p5 },
                ].map((percentile) => (
                  <div key={percentile.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 'var(--fs-sm)', borderBottom: 'var(--border-subtle)' }}>
                    <span style={{ color: 'var(--text-muted)' }}>{percentile.label}</span>
                    <span style={{ fontWeight: 600, color: percentile.val >= result.passMarkScore ? 'var(--accent-success)' : 'var(--accent-danger)' }}>
                      {percentile.val}/{result.totalQuestions}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </Motion.div>
        )}
      </AnimatePresence>

      {totalAnswered === 0 && !result && (
        <div className="glass-card" style={{ padding: 'var(--sp-8)', textAlign: 'center' }}>
          <AlertTriangle size={36} style={{ color: 'var(--accent-warning)', marginBottom: 'var(--sp-3)' }} />
          <h3 style={{ marginBottom: 'var(--sp-2)' }}>Not enough data</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-sm)' }}>
            Start answering cases and grading your memory to get meaningful predictions.
            The Oracle uses your FSRS retrievability data to simulate exam outcomes.
          </p>
        </div>
      )}
    </div>
  );
}
