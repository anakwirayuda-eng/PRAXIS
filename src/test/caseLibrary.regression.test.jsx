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

function textContentMatcher(expectedText, tagName) {
  return (_, element) => (
    (element?.textContent?.includes(expectedText) ?? false)
    && (!tagName || element?.tagName?.toLowerCase() === tagName)
  );
}

describe('case library split regression coverage', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('hydrates compiled cases once and updates the runtime snapshot', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [buildCompiledCase({ title: 'Hydrated Runtime Case' })],
    });
    vi.stubGlobal('fetch', fetchMock);

    const { caseBank: starterCases } = await import('../data/caseBank.js');
    const loader = await import('../data/caseLoader.js');

    expect(loader.getCaseBankSnapshot()).toMatchObject({
      status: 'idle',
      totalCases: starterCases.length,
      compiledCount: 0,
    });

    const [firstLoad, secondLoad] = await Promise.all([
      loader.ensureCaseBankLoaded(),
      loader.ensureCaseBankLoaded(),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/data/manifest.json');
    expect(String(fetchMock.mock.calls[1][0])).toContain('/data/compiled_cases.json');
    expect(String(fetchMock.mock.calls[2][0])).toContain('/data/quarantine_manifest.json');
    expect(loader.getCaseBankSnapshot()).toMatchObject({
      status: 'ready',
      totalCases: starterCases.length + 1,
      compiledCount: 1,
    });
    expect(loader.getCaseById(starterCases.length)).toMatchObject({
      title: 'Hydrated Runtime Case',
      category: 'internal-medicine',
      q_type: 'MCQ',
    });
    expect(loader.getCaseById(starterCases.length).options[0].id).toBe('A');
    expect(firstLoad).toHaveLength(starterCases.length + 1);
    expect(secondLoad).toHaveLength(starterCases.length + 1);

    await loader.ensureCaseBankLoaded();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('keeps the dashboard subscribed while the compiled library streams in', async () => {
    const deferred = createDeferred();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => deferred.promise,
    });
    vi.stubGlobal('fetch', fetchMock);

    const { caseBank: starterCases } = await import('../data/caseBank.js');
    const { MemoryRouter } = await import('react-router-dom');
    const { default: Dashboard } = await import('../pages/Dashboard.jsx');

    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>,
    );

    expect(await screen.findByText(/Loading the full case library in the background/i)).toBeInTheDocument();

    deferred.resolve([buildCompiledCase({ title: 'Dashboard Runtime Case' })]);

    const totalCasesLabel = (starterCases.length + 1).toLocaleString();
    expect(await screen.findByText(textContentMatcher(`${totalCasesLabel} kasus tersedia`, 'p'))).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByText(/Loading the full case library in the background/i)).not.toBeInTheDocument();
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('keeps the data quality dashboard subscribed while the compiled library streams in', async () => {
    const deferred = createDeferred();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => deferred.promise,
    });
    vi.stubGlobal('fetch', fetchMock);

    const { caseBank: starterCases } = await import('../data/caseBank.js');
    const { default: DataQuality } = await import('../pages/DataQuality.jsx');

    render(<DataQuality />);

    expect(await screen.findByText(/Loading the full case library in the background/i)).toBeInTheDocument();
    expect(screen.getByText(textContentMatcher(`${starterCases.length.toLocaleString()} total cases`, 'p'))).toBeInTheDocument();

    deferred.resolve([buildCompiledCase({ title: 'Quality Runtime Case' })]);

    await waitFor(() => {
      expect(screen.getByText(textContentMatcher(`${(starterCases.length + 1).toLocaleString()} total cases`, 'p'))).toBeInTheDocument();
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('opens a deep link to a compiled case after the library resolves', async () => {
    const deferred = createDeferred();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => deferred.promise,
    });
    vi.stubGlobal('fetch', fetchMock);

    const { caseBank: starterCases } = await import('../data/caseBank.js');
    const { MemoryRouter, Route, Routes } = await import('react-router-dom');
    const { default: CasePlayer } = await import('../pages/CasePlayer.jsx');

    render(
      <MemoryRouter initialEntries={[`/case/${starterCases.length}`]}>
        <Routes>
          <Route path="/case/:id" element={<CasePlayer />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText(/Loading Case Library/i)).toBeInTheDocument();

    deferred.resolve([buildCompiledCase({ title: 'Deep Linked Runtime Case' })]);

    expect(await screen.findByText('Deep Linked Runtime Case')).toBeInTheDocument();
    expect(screen.queryByText('Case Not Found')).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('falls back to the starter library when the compiled fetch fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
    });
    vi.stubGlobal('fetch', fetchMock);

    const { caseBank: starterCases } = await import('../data/caseBank.js');
    const loader = await import('../data/caseLoader.js');
    const cases = await loader.ensureCaseBankLoaded();

    expect(cases).toHaveLength(starterCases.length);
    expect(loader.getCaseBankSnapshot()).toMatchObject({
      status: 'error',
      totalCases: starterCases.length,
      compiledCount: 0,
    });
    expect(consoleError).toHaveBeenCalled();
  });
});
