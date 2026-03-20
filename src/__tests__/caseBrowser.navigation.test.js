import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
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
}) {
  return {
    _id,
    title,
    category,
    q_type,
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
  });

  it('random selection respects the default clean-case filters', async () => {
    mockSnapshot = {
      ...mockSnapshot,
      cases: [
        buildCase({ _id: 101, title: 'Visible clean case' }),
        buildCase({ _id: 102, title: 'Needs review case', needsReview: true }),
        buildCase({ _id: 103, title: 'Truncated case', truncated: true }),
        buildCase({ _id: 104, title: 'Quarantined case', quarantined: true }),
      ],
      totalCases: 4,
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

    expect(mockNavigate).toHaveBeenCalledWith('/case/101?n=1', {
      state: { caseNumber: 1 },
    });
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
    expect(mockNavigate.mock.calls[0][1]).toEqual({
      state: { caseNumber: 2 },
    });
  });

  it.todo('CasePlayerSession handleNextCase skips quarantined, needs_review, and truncated cases.');
});
