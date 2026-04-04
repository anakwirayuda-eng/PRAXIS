import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockNavigate = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

function createDeferred() {
  let resolve;
  let reject;

  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

function buildCompiledCase(overrides = {}) {
  return {
    title: 'Runtime Compiled Case',
    category: 'surgery',
    prompt: 'What is the next best step?',
    options: [
      { id: 'A', text: 'Observe', is_correct: false },
      { id: 'B', text: 'Operate', is_correct: true },
    ],
    vignette: {
      demographics: { age: 42, sex: 'M' },
      narrative: 'A patient presents with acute abdominal pain and guarding.',
    },
    rationale: {
      correct: 'Surgical intervention is required in this scenario.',
      distractors: {
        A: 'Observation delays definitive management.',
      },
      pearl: 'Guarding plus instability should push management toward urgent source control.',
    },
    meta: {
      examType: 'UKMPPD',
      difficulty: 2,
      tags: ['abdomen'],
      provenance: ['test-fixture'],
    },
    ...overrides,
  };
}

describe('review and exam regression coverage', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doUnmock('../data/fsrs.js');
    vi.doUnmock('../data/caseLoader');
    mockNavigate.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('review page waits for the matching runtime case before exposing due cards', async () => {
    const deferred = createDeferred();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => deferred.promise,
    });
    vi.stubGlobal('fetch', fetchMock);

    const { caseBank: starterCases } = await import('../data/caseBank.js');
    const runtimeCaseId = starterCases.length;
    const nowSeconds = Date.now() / 1000;

    vi.doMock('../data/fsrs.js', () => ({
      getDueCards: (_threshold, _limit, validIds) => (
        validIds?.has(runtimeCaseId)
          ? [{ caseId: runtimeCaseId, retrievability: 0.45, stability: 1 }]
          : []
      ),
      getBrainStats: () => ({
        totalReviewed: 1,
        averageRetention: 62,
        totalLapses: 0,
        memoryStrength: 'Moderate',
      }),
      getCaseState: () => ({ lastReview: nowSeconds - 3600, lapses: 0 }),
      recalcRetrievability: vi.fn(),
    }));

    const { MemoryRouter } = await import('react-router-dom');
    const { default: ReviewPage } = await import('../pages/ReviewPage.jsx');

    render(
      <MemoryRouter>
        <ReviewPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText(/Loading the full case library in the background/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Start Review \(0 cards\)/i })).toBeDisabled();
    expect(screen.queryByText('Runtime Due Case')).not.toBeInTheDocument();

    deferred.resolve([buildCompiledCase({ title: 'Runtime Due Case' })]);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Start Review \(1 cards\)/i })).toBeEnabled();
    });
    expect(screen.getByText('Runtime Due Case')).toBeInTheDocument();
  }, 15000);

  it('refreshes due cards when the review clock advances', async () => {
    const initialTime = new Date('2026-04-01T00:00:00Z');
    const dueTime = new Date('2026-04-01T00:01:00Z');
    let mockNow = initialTime.getTime();
    vi.spyOn(Date, 'now').mockImplementation(() => mockNow);
    const intervalCallbacks = [];
    vi.spyOn(window, 'setInterval').mockImplementation((callback) => {
      intervalCallbacks.push(callback);
      return intervalCallbacks.length;
    });
    vi.spyOn(window, 'clearInterval').mockImplementation(() => {});
    const { caseBank: starterCases } = await import('../data/caseBank.js');
    const starterCase = starterCases[0];
    const starterCaseId = 0;

    vi.doMock('../data/fsrs.js', () => ({
      getDueCards: (_threshold, _limit, validIds) => (
        Date.now() >= dueTime.getTime() && validIds?.has(starterCaseId)
          ? [{ caseId: starterCaseId, retrievability: 0.45, stability: 1 }]
          : []
      ),
      getBrainStats: () => ({
        totalReviewed: 1,
        averageRetention: 62,
        totalLapses: 0,
        memoryStrength: 'Moderate',
      }),
      getCaseState: () => ({ lastReview: Date.now() / 1000 - 3600, lapses: 0 }),
      recalcRetrievability: vi.fn(),
    }));

    const { MemoryRouter } = await import('react-router-dom');
    const { default: ReviewPage } = await import('../pages/ReviewPage.jsx');

    render(
      <MemoryRouter>
        <ReviewPage />
      </MemoryRouter>,
    );

    expect(screen.getByRole('button', { name: /Start Review \(0 cards\)/i })).toBeDisabled();
    expect(intervalCallbacks.length).toBeGreaterThan(0);

    await act(async () => {
      mockNow = dueTime.getTime();
      intervalCallbacks.at(-1)();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Start Review \(1 cards\)/i })).toBeEnabled();
    });
    expect(screen.getByText(starterCase.title)).toBeInTheDocument();
  }, 15000);

  it('aligns review refresh scheduling to the next minute boundary', async () => {
    const initialTime = new Date('2026-04-01T00:00:30.250Z');
    let mockNow = initialTime.getTime();
    vi.spyOn(Date, 'now').mockImplementation(() => mockNow);
    const timeoutCalls = [];
    const intervalCalls = [];
    vi.spyOn(window, 'setTimeout').mockImplementation((callback, delay) => {
      timeoutCalls.push({ callback, delay });
      return timeoutCalls.length;
    });
    vi.spyOn(window, 'clearTimeout').mockImplementation(() => {});
    vi.spyOn(window, 'setInterval').mockImplementation((callback, delay) => {
      intervalCalls.push({ callback, delay });
      return intervalCalls.length;
    });
    vi.spyOn(window, 'clearInterval').mockImplementation(() => {});
    const { caseBank: starterCases } = await import('../data/caseBank.js');
    const starterCase = starterCases[0];

    vi.doMock('../data/fsrs.js', () => ({
      getDueCards: (_threshold, _limit, validIds) => (
        Date.now() >= new Date('2026-04-01T00:01:00.000Z').getTime() && validIds?.has(0)
          ? [{ caseId: 0, retrievability: 0.45, stability: 1 }]
          : []
      ),
      getBrainStats: () => ({
        totalReviewed: 1,
        averageRetention: 62,
        totalLapses: 0,
        memoryStrength: 'Moderate',
      }),
      getCaseState: () => ({ lastReview: Date.now() / 1000 - 3600, lapses: 0 }),
    }));

    const { MemoryRouter } = await import('react-router-dom');
    const { default: ReviewPage } = await import('../pages/ReviewPage.jsx');

    render(
      <MemoryRouter>
        <ReviewPage />
      </MemoryRouter>,
    );

    expect(timeoutCalls).toHaveLength(1);
    expect(timeoutCalls[0].delay).toBe(29750);
    expect(screen.getByRole('button', { name: /Start Review \(0 cards\)/i })).toBeDisabled();

    await act(async () => {
      mockNow = new Date('2026-04-01T00:01:00.000Z').getTime();
      timeoutCalls[0].callback();
      await Promise.resolve();
    });

    expect(intervalCalls).toHaveLength(1);
    expect(intervalCalls[0].delay).toBe(60000);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Start Review \(1 cards\)/i })).toBeEnabled();
    });
    expect(screen.getByText(starterCase.title)).toBeInTheDocument();
  }, 15000);

  it('starts review sessions with a due-card playlist and a return path to /review', async () => {
    const nowSeconds = Date.now() / 1000;

    vi.doMock('../data/fsrs.js', () => ({
      getDueCards: () => ([
        { caseId: 0, retrievability: 0.42, stability: 1 },
        { caseId: 1, retrievability: 0.51, stability: 1 },
      ]),
      getBrainStats: () => ({
        totalReviewed: 2,
        averageRetention: 58,
        totalLapses: 0,
        memoryStrength: 'Moderate',
      }),
      getCaseState: () => ({ lastReview: nowSeconds - 3600, lapses: 0 }),
      recalcRetrievability: vi.fn(),
    }));

    const { MemoryRouter } = await import('react-router-dom');
    const { caseBank: starterCases } = await import('../data/caseBank.js');
    const { getCaseRouteId } = await import('../data/caseIdentity.js');
    const { default: ReviewPage } = await import('../pages/ReviewPage.jsx');
    const firstRouteId = getCaseRouteId(starterCases[0]);
    const secondRouteId = getCaseRouteId(starterCases[1]);

    render(
      <MemoryRouter>
        <ReviewPage />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: /Start Review \(2 cards\)/i }));

    expect(mockNavigate).toHaveBeenCalledWith(`/case/${firstRouteId}`, {
      state: {
        playlist: [firstRouteId, secondRouteId],
        returnTo: '/review',
        reviewSession: true,
      },
    });
  }, 15000);

  it('keeps exam quick-start presets disabled until the full pool is ready', async () => {
    const deferred = createDeferred();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => deferred.promise,
    });
    vi.stubGlobal('fetch', fetchMock);

    const { MemoryRouter } = await import('react-router-dom');
    const { default: ExamMode } = await import('../pages/ExamMode.jsx');

    render(
      <MemoryRouter>
        <ExamMode />
      </MemoryRouter>,
    );

    const ukmppdPreset = await screen.findByRole('button', { name: /UKMPPD Quick Drill/i });
    expect(ukmppdPreset).toBeDisabled();

    deferred.resolve([buildCompiledCase({ title: 'Exam Runtime Case' })]);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /UKMPPD Quick Drill/i })).toBeEnabled();
    });
  }, 15000);

  it('clamps custom exam inputs to valid bounds', async () => {
    vi.doMock('../data/caseLoader', () => ({
      CATEGORIES: {
        surgery: { label: 'Surgery', color: '#ef4444' },
      },
      useCaseBank: () => ({
        cases: [buildCompiledCase({ _id: 44, title: 'Clamp Check Case' })],
        totalCases: 1,
        status: 'ready',
        isLoading: false,
      }),
    }));

    const { MemoryRouter } = await import('react-router-dom');
    const { default: ExamMode } = await import('../pages/ExamMode.jsx');

    render(
      <MemoryRouter>
        <ExamMode />
      </MemoryRouter>,
    );

    const questionInput = screen.getByLabelText(/Questions/i);
    const timeInput = screen.getByLabelText(/Time Limit \(minutes\)/i);

    fireEvent.change(questionInput, { target: { value: '-1' } });
    expect(questionInput).toHaveValue(1);

    fireEvent.change(questionInput, { target: { value: '999' } });
    expect(questionInput).toHaveValue(100);

    fireEvent.change(timeInput, { target: { value: '-5' } });
    expect(timeInput).toHaveValue(5);

    fireEvent.change(timeInput, { target: { value: '999' } });
    expect(timeInput).toHaveValue(200);
  }, 15000);

  it('counts the timed-out question in the final score', async () => {
    const intervalCallbacks = [];
    vi.spyOn(window, 'setInterval').mockImplementation((callback) => {
      intervalCallbacks.push(callback);
      return intervalCallbacks.length;
    });
    vi.spyOn(window, 'clearInterval').mockImplementation(() => {});
    const timedOutCase = buildCompiledCase({
      title: 'Timed Out Case',
      meta: {
        examType: 'MIR-Spain',
        difficulty: 2,
        tags: ['abdomen'],
        provenance: ['test-fixture'],
      },
    });
    const fetchMock = vi.fn(async (input) => {
      const url = String(input);
      if (url.includes('manifest.json')) {
        return { ok: false, status: 404, json: async () => ({}) };
      }
      if (url.includes('compiled_cases.json')) {
        return { ok: true, status: 200, json: async () => [timedOutCase] };
      }
      if (url.includes('quarantine_manifest.json')) {
        return { ok: false, status: 404, json: async () => [] };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });
    vi.stubGlobal('fetch', fetchMock);

    const { useStore } = await import('../data/store.js');
    useStore.getState().resetSession();

    const { MemoryRouter } = await import('react-router-dom');
    const { default: ExamMode } = await import('../pages/ExamMode.jsx');

    render(
      <MemoryRouter>
        <ExamMode />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText(/Questions/i), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText(/Category/i), { target: { value: 'Unclassified' } });
    fireEvent.change(screen.getByLabelText(/Time Limit \(minutes\)/i), { target: { value: '5' } });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Start Exam/i })).toBeEnabled();
    });
    fireEvent.click(screen.getByRole('button', { name: /Start Exam/i }));

    expect(screen.getByRole('button', { name: /Submit Answer/i })).toBeInTheDocument();
    expect(intervalCallbacks.length).toBeGreaterThan(0);

    await act(async () => {
      for (let i = 0; i < 300; i += 1) {
        intervalCallbacks.at(-1)();
      }
      await Promise.resolve();
    });

    expect(await screen.findByText(/Exam Complete!/i)).toBeInTheDocument();
    expect(screen.getByText(/0 of 1 correct/i)).toBeInTheDocument();
    expect(screen.getByText('Timed Out Case')).toBeInTheDocument();
  }, 30000);
});
