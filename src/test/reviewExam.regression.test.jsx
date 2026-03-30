import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
      { text: 'Observe' },
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
  });

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
  });
});
