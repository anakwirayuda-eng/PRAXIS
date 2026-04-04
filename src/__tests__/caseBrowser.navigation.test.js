import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const mockNavigate = vi.fn();
const mockCategories = {
  'internal-medicine': { label: 'Internal Medicine', color: '#22c55e' },
  surgery: { label: 'Surgery', color: '#f97316' },
};

let mockSnapshot = {
  cases: [],
  totalCases: 0,
  status: 'ready',
  isLoading: false,
};

let mockStore = {
  completedCases: [],
  bookmarks: [],
};

vi.mock('../data/caseLoader.js', () => ({
  CATEGORIES: mockCategories,
  useCaseBank: () => mockSnapshot,
}));

vi.mock('../data/store.js', () => ({
  useStore: () => mockStore,
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

function buildCase({
  _id,
  title,
  category = 'internal-medicine',
  q_type = 'MCQ',
  examType = 'USMLE',
  difficulty = 2,
  narrative = 'Clinical vignette',
  tags = ['tag'],
  needsReview = false,
  truncated = false,
  quarantined = false,
  status = '',
}) {
  return {
    _id,
    title,
    category,
    q_type,
    _searchKey: `${title} ${narrative} ${tags.join(' ')}`.toLowerCase(),
    prompt: title,
    vignette: {
      demographics: { age: 30, sex: 'M' },
      narrative,
    },
    options: [
      { id: 'A', text: 'Option A', is_correct: true },
      { id: 'B', text: 'Option B', is_correct: false },
    ],
    meta: {
      examType,
      difficulty,
      tags,
      needs_review: needsReview,
      truncated,
      quarantined,
      status,
    },
  };
}

describe('CaseBrowser quality-aware navigation', () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    mockStore = {
      completedCases: [],
      bookmarks: [],
    };
    mockSnapshot = {
      cases: [],
      totalCases: 0,
      status: 'ready',
      isLoading: false,
    };

    vi.stubGlobal('IntersectionObserver', class {
      observe() {}
      disconnect() {}
      unobserve() {}
    });

    Object.defineProperty(window, 'scrollY', {
      configurable: true,
      value: 0,
      writable: true,
    });
  });

  it('random selection respects the default clean-case filters', async () => {
    mockSnapshot = {
      ...mockSnapshot,
      cases: [
        buildCase({ _id: 101, title: 'Visible clean case' }),
        buildCase({ _id: 102, title: 'Needs review case', needsReview: true }),
        buildCase({ _id: 103, title: 'Truncated case', truncated: true }),
        buildCase({ _id: 104, title: 'Quarantined case', quarantined: true }),
        buildCase({ _id: 105, title: 'Status quarantine case', status: 'QUARANTINED_AI_CONFLICT' }),
      ],
      totalCases: 5,
    };

    const { default: CaseBrowser } = await import('../pages/CaseBrowser.jsx');

    render(
      React.createElement(
        MemoryRouter,
        { initialEntries: ['/cases'] },
        React.createElement(CaseBrowser),
      ),
    );

    fireEvent.click(screen.getByRole('button', { name: /random case/i }));

    expect(mockNavigate).toHaveBeenCalledWith('/case/101?n=1', expect.objectContaining({
      state: expect.objectContaining({ caseNumber: 1, playlist: expect.arrayContaining(['101']) }),
    }));
  });

  it('hides status-quarantined cases from the browser even when the boolean quarantine flag is false', async () => {
    mockSnapshot = {
      ...mockSnapshot,
      cases: [
        buildCase({ _id: 120, title: 'Visible clean case' }),
        buildCase({ _id: 121, title: 'Status quarantine case', status: 'QUARANTINED_HASH_ANCHOR_MISMATCH' }),
      ],
      totalCases: 2,
    };

    const { default: CaseBrowser } = await import('../pages/CaseBrowser.jsx');

    render(
      React.createElement(
        MemoryRouter,
        { initialEntries: ['/cases'] },
        React.createElement(CaseBrowser),
      ),
    );

    expect(screen.getByText('Visible clean case')).toBeInTheDocument();
    expect(screen.queryByText('Status quarantine case')).not.toBeInTheDocument();
  });

  it('does not open an unrelated random case when the current filters yield no results', async () => {
    mockSnapshot = {
      ...mockSnapshot,
      cases: [
        buildCase({ _id: 110, title: 'Visible case', category: 'internal-medicine' }),
      ],
      totalCases: 1,
    };

    const { default: CaseBrowser } = await import('../pages/CaseBrowser.jsx');

    render(
      React.createElement(
        MemoryRouter,
        { initialEntries: ['/cases?category=surgery'] },
        React.createElement(CaseBrowser),
      ),
    );

    const randomButton = screen.getByRole('button', { name: /random case/i });
    expect(randomButton).toBeDisabled();

    fireEvent.click(randomButton);
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('passes the filtered-view sequence number in both state and URL params', async () => {
    mockSnapshot = {
      ...mockSnapshot,
      cases: [
        buildCase({ _id: 201, title: 'Alpha visible case', category: 'internal-medicine' }),
        buildCase({ _id: 202, title: 'Bravo visible case', category: 'surgery' }),
        buildCase({ _id: 203, title: 'Filtered review case', needsReview: true }),
      ],
      totalCases: 3,
    };

    const { default: CaseBrowser } = await import('../pages/CaseBrowser.jsx');

    render(
      React.createElement(
        MemoryRouter,
        { initialEntries: ['/cases'] },
        React.createElement(CaseBrowser),
      ),
    );

    const sequenceBadge = screen.getByLabelText('Case number 2');
    const card = sequenceBadge.closest('[data-testid="case-card"]');

    fireEvent.click(card);

    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(mockNavigate.mock.calls[0][0]).toMatch(/\?n=2$/);
    expect(mockNavigate.mock.calls[0][1]).toEqual(expect.objectContaining({
      state: expect.objectContaining({ caseNumber: 2, playlist: expect.any(Array) }),
    }));
  });

  it('preserves search params and scroll position when opening a case from the browser', async () => {
    mockSnapshot = {
      ...mockSnapshot,
      cases: [
        buildCase({ _id: 210, title: 'Renal visible case', tags: ['renal'] }),
      ],
      totalCases: 1,
    };

    const { default: CaseBrowser } = await import('../pages/CaseBrowser.jsx');

    Object.defineProperty(window, 'scrollY', {
      configurable: true,
      value: 420,
      writable: true,
    });

    render(
      React.createElement(
        MemoryRouter,
        { initialEntries: ['/cases?q=renal&category=internal-medicine'] },
        React.createElement(CaseBrowser),
      ),
    );

    expect(screen.getByLabelText(/search cases/i)).toHaveValue('renal');

    fireEvent.click(screen.getByTestId('case-card'));

    expect(mockNavigate).toHaveBeenCalledWith('/case/210?n=1', expect.objectContaining({
      state: expect.objectContaining({
        caseNumber: 1,
        browserSearch: '?q=renal&category=internal-medicine',
        browserScrollY: 420,
        browserPage: 1,
      }),
    }));
  });

  it('keeps loading-state cards in source order so clicks stay aligned with the previewed case', async () => {
    mockSnapshot = {
      ...mockSnapshot,
      status: 'loading',
      isLoading: true,
      cases: [
        buildCase({ _id: 301, title: 'First streamed case' }),
        buildCase({ _id: 302, title: 'Second streamed case' }),
        buildCase({ _id: 303, title: 'Third streamed case' }),
      ],
      totalCases: 3,
    };

    const { default: CaseBrowser } = await import('../pages/CaseBrowser.jsx');

    render(
      React.createElement(
        MemoryRouter,
        { initialEntries: ['/cases'] },
        React.createElement(CaseBrowser),
      ),
    );

    const cards = screen.getAllByTestId('case-card');
    expect(cards).toHaveLength(3);
    expect(cards[0]).toHaveTextContent('First streamed case');
    expect(cards[1]).toHaveTextContent('Second streamed case');
    expect(cards[2]).toHaveTextContent('Third streamed case');

    fireEvent.click(cards[1]);

    expect(mockNavigate).toHaveBeenCalledWith('/case/302?n=2', expect.objectContaining({
      state: expect.objectContaining({ caseNumber: 2, playlist: expect.any(Array) }),
    }));
    expect(screen.getByText(/case order is temporarily locked until loading finishes/i)).toBeInTheDocument();
  });

  it('builds a capped playlist that still contains the clicked case deep in long result sets', async () => {
    const { buildCasePlaylist } = await import('../pages/CaseBrowser.jsx');
    const cases = Array.from({ length: 2505 }, (_, index) => buildCase({
      _id: index + 1,
      title: `Case ${index + 1}`,
    }));

    const playlist = buildCasePlaylist(cases, 2400);

    expect(playlist).toHaveLength(2000);
    expect(playlist[0]).toBe('506');
    expect(playlist).toContain('2401');
    expect(playlist.at(-1)).toBe('2505');
  });

  it('restores the loaded browser page count from navigation state before reapplying scroll', async () => {
    mockSnapshot = {
      ...mockSnapshot,
      cases: Array.from({ length: 125 }, (_, index) => buildCase({
        _id: index + 1,
        title: `Case ${index + 1}`,
        narrative: `Narrative ${index + 1}`,
      })),
      totalCases: 125,
    };

    const { default: CaseBrowser } = await import('../pages/CaseBrowser.jsx');

    render(
      React.createElement(
        MemoryRouter,
        {
          initialEntries: [{
            pathname: '/cases',
            search: '',
            state: { restorePage: 3 },
          }],
        },
        React.createElement(CaseBrowser),
      ),
    );

    expect(screen.getAllByTestId('case-card')).toHaveLength(125);
  });

  it('clears only quick toggles while preserving search and dropdown filters', async () => {
    mockSnapshot = {
      ...mockSnapshot,
      cases: [
        buildCase({ _id: 401, title: 'Renal case', category: 'surgery', tags: ['renal'] }),
      ],
      totalCases: 1,
    };

    const { default: CaseBrowser } = await import('../pages/CaseBrowser.jsx');

    render(
      React.createElement(
        MemoryRouter,
        { initialEntries: ['/cases?q=renal&category=surgery&hideCompleted=1&images=1'] },
        React.createElement(CaseBrowser),
      ),
    );

    fireEvent.click(screen.getByRole('button', { name: /clear quick toggles/i }));

    await waitFor(() => {
      expect(screen.getByLabelText(/search cases/i)).toHaveValue('renal');
    });
    expect(screen.getByLabelText(/filter by category/i)).toHaveValue('surgery');
    expect(screen.getByRole('button', { name: /has image/i })).toHaveClass('btn-ghost');
    expect(screen.getByRole('button', { name: /hide completed/i })).toHaveClass('btn-ghost');
  });

  it('hides the reviewed-only toggle when no reviewed metadata exists', async () => {
    mockSnapshot = {
      ...mockSnapshot,
      cases: [
        buildCase({ _id: 402, title: 'Visible case' }),
      ],
      totalCases: 1,
    };

    const { default: CaseBrowser } = await import('../pages/CaseBrowser.jsx');

    render(
      React.createElement(
        MemoryRouter,
        { initialEntries: ['/cases'] },
        React.createElement(CaseBrowser),
      ),
    );

    expect(screen.queryByRole('button', { name: /show only reviewed/i })).not.toBeInTheDocument();
  });

  it('renders fallback metadata safely when category and exam labels are missing', async () => {
    mockSnapshot = {
      ...mockSnapshot,
      cases: [
        buildCase({ _id: 403, title: 'Fallback metadata case', category: null, examType: '', narrative: '' }),
      ],
      totalCases: 1,
    };

    const { default: CaseBrowser } = await import('../pages/CaseBrowser.jsx');

    const { container } = render(
      React.createElement(
        MemoryRouter,
        { initialEntries: ['/cases'] },
        React.createElement(CaseBrowser),
      ),
    );

    expect(screen.getByText('Fallback metadata case')).toBeInTheDocument();
    expect(screen.getByText('Unknown')).toBeInTheDocument();
    expect(screen.getByText(/Clinical vignette preview unavailable/i)).toBeInTheDocument();
    expect(container.querySelectorAll('[data-testid="case-card"] .badge')).toHaveLength(2);
  });

  it('focuses the search input when navigation requests browser search intent', async () => {
    mockSnapshot = {
      ...mockSnapshot,
      cases: [
        buildCase({ _id: 310, title: 'Focused search case' }),
      ],
      totalCases: 1,
    };

    const { default: CaseBrowser } = await import('../pages/CaseBrowser.jsx');

    render(
      React.createElement(
        MemoryRouter,
        {
          initialEntries: [{
            pathname: '/cases',
            search: '',
            state: { focusSearch: true },
          }],
        },
        React.createElement(CaseBrowser),
      ),
    );

    await waitFor(() => {
      expect(screen.getByLabelText(/search cases/i)).toHaveFocus();
    });
  });

  it.todo('CasePlayerSession handleNextCase skips quarantined, needs_review, and truncated cases.');
});
