import { useEffect, useSyncExternalStore } from 'react';

const WATCHDOG_STORAGE_KEY = 'mc_runtime_watchdog';
const WATCHDOG_MAX_ENTRIES = 50;
const EXTERNAL_ENDPOINT = (import.meta.env.VITE_WATCHDOG_ENDPOINT || '').trim();
const EXTERNAL_TOKEN = (import.meta.env.VITE_WATCHDOG_TOKEN || '').trim();
const WATCHDOG_FLAG = '__medcaseWatchdogLogged';

const subscribers = new Set();
const recentFingerprints = new Map();
let globalWatchdogInstalled = false;
let storageBridgeInstalled = false;
let watchdogSnapshot = {
  entries: [],
  count: 0,
  maxEntries: WATCHDOG_MAX_ENTRIES,
  externalMonitoring: {
    enabled: Boolean(EXTERNAL_ENDPOINT),
    endpoint: EXTERNAL_ENDPOINT,
  },
};

function getStorage() {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

function getScheduler() {
  return typeof window !== 'undefined' ? window : globalThis;
}

function truncate(value, maxLength = 600) {
  const text = String(value ?? '');
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function sanitizeMetadata(value, depth = 0) {
  if (value === null || value === undefined) return value ?? null;
  if (typeof value === 'string') return truncate(value, 500);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Error) {
    return {
      name: value.name,
      message: truncate(value.message, 500),
      stack: truncate(value.stack || '', 1200),
    };
  }
  if (depth >= 2) return truncate(JSON.stringify(value), 500);
  if (Array.isArray(value)) {
    return value.slice(0, 8).map((item) => sanitizeMetadata(item, depth + 1));
  }
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 12)
        .map(([key, item]) => [key, sanitizeMetadata(item, depth + 1)]),
    );
  }

  return truncate(value, 500);
}

function sanitizeError(error) {
  if (error instanceof Error) {
    return {
      name: error.name || 'Error',
      message: truncate(error.message || 'Unknown error', 500),
      stack: truncate(error.stack || '', 2000),
    };
  }

  return {
    name: 'Error',
    message: truncate(error || 'Unknown error', 500),
    stack: '',
  };
}

function readEntries() {
  const storage = getStorage();
  if (!storage) return [];

  try {
    const raw = storage.getItem(WATCHDOG_STORAGE_KEY);
    if (!raw) return [];

    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeEntries(entries) {
  const storage = getStorage();
  if (!storage) return;

  try {
    storage.setItem(WATCHDOG_STORAGE_KEY, JSON.stringify(entries));
  } catch (error) {
    console.warn('[Watchdog] Failed to persist runtime events.', error);
  }
}

function buildWatchdogSnapshot(entries = readEntries()) {
  const config = getExternalMonitoringConfig();
  return {
    entries,
    count: entries.length,
    maxEntries: WATCHDOG_MAX_ENTRIES,
    externalMonitoring: config,
  };
}

function updateWatchdogSnapshot(entries = readEntries()) {
  watchdogSnapshot = buildWatchdogSnapshot(entries);
  return watchdogSnapshot;
}

updateWatchdogSnapshot();

function notifySubscribers() {
  subscribers.forEach((listener) => listener());
}

function ensureStorageBridge() {
  if (storageBridgeInstalled || typeof window === 'undefined') return;

  window.addEventListener('storage', (event) => {
    if (event.key === WATCHDOG_STORAGE_KEY) {
      updateWatchdogSnapshot();
      notifySubscribers();
    }
  });

  storageBridgeInstalled = true;
}

function buildFingerprint(entry) {
  return `${entry.type}|${entry.source}|${entry.message}|${entry.route}`;
}

function isRecentDuplicate(entry) {
  const fingerprint = buildFingerprint(entry);
  const now = Date.now();

  for (const [key, timestamp] of recentFingerprints.entries()) {
    if (now - timestamp > 1500) {
      recentFingerprints.delete(key);
    }
  }

  if (recentFingerprints.has(fingerprint)) {
    return true;
  }

  recentFingerprints.set(fingerprint, now);
  return false;
}

function getRouteSnapshot() {
  if (typeof window === 'undefined') return '/';
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

function markCaptured(error) {
  if (error && typeof error === 'object') {
    try {
      error[WATCHDOG_FLAG] = true;
    } catch {
      // Ignore non-extensible values.
    }
  }
}

function hasBeenCaptured(error) {
  return Boolean(error && typeof error === 'object' && error[WATCHDOG_FLAG]);
}

function getExternalMonitoringConfig() {
  return {
    enabled: Boolean(EXTERNAL_ENDPOINT),
    endpoint: EXTERNAL_ENDPOINT,
  };
}

async function forwardRuntimeEvent(entry) {
  const config = getExternalMonitoringConfig();
  if (!config.enabled || typeof window === 'undefined') return;

  try {
    const payload = JSON.stringify({
      app: 'medcase-pro',
      ...entry,
    });

    if (!EXTERNAL_TOKEN && typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      const blob = new Blob([payload], { type: 'application/json' });
      navigator.sendBeacon(config.endpoint, blob);
      return;
    }

    await fetch(config.endpoint, {
      method: 'POST',
      keepalive: true,
      headers: {
        'Content-Type': 'application/json',
        ...(EXTERNAL_TOKEN ? { Authorization: `Bearer ${EXTERNAL_TOKEN}` } : {}),
      },
      body: payload,
    });
  } catch {
    // Never let monitoring transport break the app.
  }
}

export function recordRuntimeEvent({
  type = 'runtime-error',
  source = 'app',
  level = 'error',
  message,
  error = null,
  metadata = null,
  skipForwarding = false,
}) {
  const sanitizedError = sanitizeError(error);
  const entry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type,
    source,
    level,
    route: getRouteSnapshot(),
    timestamp: new Date().toISOString(),
    message: truncate(message || sanitizedError.message || 'Unknown runtime issue', 500),
    name: sanitizedError.name,
    stack: sanitizedError.stack,
    details: sanitizeMetadata(metadata),
  };

  if (isRecentDuplicate(entry)) {
    return entry;
  }

  const entries = [entry, ...readEntries()].slice(0, WATCHDOG_MAX_ENTRIES);
  writeEntries(entries);
  updateWatchdogSnapshot(entries);
  notifySubscribers();

  if (!skipForwarding) {
    void forwardRuntimeEvent(entry);
  }

  return entry;
}

export function captureException(error, context = {}) {
  if (hasBeenCaptured(error)) {
    return null;
  }

  markCaptured(error);

  return recordRuntimeEvent({
    type: context.type || 'captured-exception',
    source: context.source || 'app',
    level: context.level || 'error',
    message: context.message || sanitizeError(error).message,
    error,
    metadata: context.metadata || null,
  });
}

export function captureMessage(message, context = {}) {
  return recordRuntimeEvent({
    type: context.type || 'runtime-message',
    source: context.source || 'app',
    level: context.level || 'warning',
    message,
    metadata: context.metadata || null,
  });
}

export function clearRuntimeEvents() {
  writeEntries([]);
  updateWatchdogSnapshot([]);
  notifySubscribers();
}

export function getRuntimeWatchdogSnapshot() {
  return watchdogSnapshot;
}

export function subscribeToRuntimeWatchdog(listener) {
  ensureStorageBridge();
  subscribers.add(listener);
  return () => subscribers.delete(listener);
}

export function useRuntimeWatchdog() {
  const snapshot = useSyncExternalStore(
    subscribeToRuntimeWatchdog,
    getRuntimeWatchdogSnapshot,
    getRuntimeWatchdogSnapshot,
  );

  useEffect(() => {
    ensureStorageBridge();
  }, []);

  return snapshot;
}

function mergeSignals(...signals) {
  const controller = new AbortController();

  const abort = () => {
    if (!controller.signal.aborted) {
      controller.abort();
    }
  };

  const cleanups = signals
    .filter(Boolean)
    .map((signal) => {
      if (signal.aborted) {
        abort();
        return () => {};
      }

      const onAbort = () => abort();
      signal.addEventListener('abort', onAbort);
      return () => signal.removeEventListener('abort', onAbort);
    });

  return {
    signal: controller.signal,
    cleanup: () => cleanups.forEach((fn) => fn()),
  };
}

function wait(ms) {
  const scheduler = getScheduler();
  return new Promise((resolve) => {
    scheduler.setTimeout(resolve, ms);
  });
}

export async function fetchWithWatchdog(input, init = {}, options = {}) {
  const {
    timeoutMs = 12000,
    retries = 1,
    retryDelayMs = 750,
    source = 'fetch',
    operation = 'request',
  } = options;

  let attempt = 0;

  while (attempt <= retries) {
    const scheduler = getScheduler();
    const timeoutController = new AbortController();
    const { signal, cleanup } = mergeSignals(init.signal, timeoutController.signal);
    const timerId = scheduler.setTimeout(() => timeoutController.abort(), timeoutMs);

    try {
      const response = await fetch(input, { ...init, signal });
      return response;
    } catch (error) {
      const timedOut = timeoutController.signal.aborted && !(init.signal?.aborted);
      const isFinalAttempt = attempt >= retries;

      recordRuntimeEvent({
        type: timedOut ? 'fetch-timeout' : 'fetch-error',
        source,
        level: timedOut ? 'warning' : 'error',
        message: timedOut
          ? `${operation} timed out after ${timeoutMs}ms`
          : `${operation} failed on attempt ${attempt + 1}`,
        error,
        metadata: {
          attempt: attempt + 1,
          retries,
          timeoutMs,
          input: String(input),
        },
      });

      if (isFinalAttempt) {
        throw error;
      }

      await wait(retryDelayMs * (attempt + 1));
    } finally {
      scheduler.clearTimeout(timerId);
      cleanup();
    }

    attempt += 1;
  }

  throw new Error(`${operation} failed unexpectedly.`);
}

export async function fetchJsonWithWatchdog(input, init = {}, options = {}) {
  const response = await fetchWithWatchdog(input, init, options);

  if (!response.ok) {
    const error = new Error(`HTTP ${response.status}`);
    recordRuntimeEvent({
      type: 'fetch-response-error',
      source: options.source || 'fetch',
      level: 'error',
      message: `${options.operation || 'request'} returned ${response.status}`,
      error,
      metadata: {
        input: String(input),
        status: response.status,
      },
    });
    throw error;
  }

  return response.json();
}

export function installGlobalRuntimeWatchdog() {
  if (globalWatchdogInstalled || typeof window === 'undefined') return;

  const handleWindowError = (event) => {
    const error = event.error instanceof Error ? event.error : new Error(event.message || 'Unhandled window error');

    if (hasBeenCaptured(error)) {
      return;
    }

    captureException(error, {
      type: 'window-error',
      source: 'window',
      message: event.message || error.message,
      metadata: {
        filename: event.filename || null,
        lineno: event.lineno || null,
        colno: event.colno || null,
      },
    });
  };

  const handleUnhandledRejection = (event) => {
    const reason = event.reason instanceof Error ? event.reason : new Error(String(event.reason || 'Unhandled promise rejection'));
    captureException(reason, {
      type: 'unhandled-rejection',
      source: 'promise',
      message: reason.message,
      metadata: {
        reason: sanitizeMetadata(event.reason),
      },
    });
  };

  window.addEventListener('error', handleWindowError);
  window.addEventListener('unhandledrejection', handleUnhandledRejection);

  globalWatchdogInstalled = true;
}
