import React from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('runtime watchdog regression coverage', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useRealTimers();
  });

  it('keeps only the latest 50 runtime events in local storage', async () => {
    const watchdog = await import('../lib/runtimeWatchdog.js');

    for (let index = 0; index < 55; index += 1) {
      watchdog.recordRuntimeEvent({
        type: 'unit-event',
        source: 'runtime-watchdog-test',
        message: `event-${index}`,
        skipForwarding: true,
      });
    }

    const snapshot = watchdog.getRuntimeWatchdogSnapshot();

    expect(snapshot.count).toBe(50);
    expect(snapshot.entries[0]).toMatchObject({ message: 'event-54' });
    expect(snapshot.entries.at(-1)).toMatchObject({ message: 'event-5' });
  });

  it('records React boundary crashes in the watchdog inbox', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const watchdog = await import('../lib/runtimeWatchdog.js');
    const { default: ErrorBoundary } = await import('../components/ErrorBoundary.jsx');

    function CrashOnRender() {
      throw new Error('Render crash');
    }

    render(
      <ErrorBoundary>
        <CrashOnRender />
      </ErrorBoundary>,
    );

    expect(await screen.findByText(/Something went wrong/i)).toBeInTheDocument();
    expect(watchdog.getRuntimeWatchdogSnapshot().entries[0]).toMatchObject({
      type: 'react-boundary',
      source: 'error-boundary',
      message: 'Render crash',
    });

    consoleError.mockRestore();
  });

  it('renders the watchdog inbox without entering a render loop', async () => {
    const { default: WatchdogInbox } = await import('../pages/WatchdogInbox.jsx');

    render(<WatchdogInbox />);

    expect(screen.getByRole('heading', { name: /Watchdog Inbox/i })).toBeInTheDocument();
  });

  it('captures global window errors and unhandled promise rejections', async () => {
    const watchdog = await import('../lib/runtimeWatchdog.js');
    watchdog.installGlobalRuntimeWatchdog();

    window.dispatchEvent(new ErrorEvent('error', {
      message: 'Window exploded',
      error: new Error('Window exploded'),
    }));

    const rejectionEvent = new Event('unhandledrejection');
    Object.defineProperty(rejectionEvent, 'reason', {
      configurable: true,
      value: new Error('Promise exploded'),
    });
    window.dispatchEvent(rejectionEvent);

    const entries = watchdog.getRuntimeWatchdogSnapshot().entries;

    expect(entries.some((entry) =>
      entry.type === 'window-error' && entry.message === 'Window exploded'
    )).toBe(true);
    expect(entries.some((entry) =>
      entry.type === 'unhandled-rejection' && entry.message === 'Promise exploded'
    )).toBe(true);
  });

  it('retries transient fetch failures and records the first failure', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('Temporary outage'))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const watchdog = await import('../lib/runtimeWatchdog.js');
    const request = watchdog.fetchJsonWithWatchdog('/runtime.json', {}, {
      source: 'runtime-watchdog-test',
      operation: 'runtime fetch',
      timeoutMs: 500,
      retries: 1,
      retryDelayMs: 50,
    });

    await vi.runAllTimersAsync();

    await expect(request).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(watchdog.getRuntimeWatchdogSnapshot().entries.some((entry) =>
      entry.type === 'fetch-error' && entry.source === 'runtime-watchdog-test'
    )).toBe(true);

    vi.useRealTimers();
  });
});
