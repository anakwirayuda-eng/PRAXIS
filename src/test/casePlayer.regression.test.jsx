import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

function buildCase(overrides = {}) {
  return {
    _id: 12,
    title: 'Regression Case',
    category: 'internal-medicine',
    q_type: 'MCQ',
    confidence: 4,
    prompt: 'What is the diagnosis?',
    options: [
      { id: 'A', text: 'Correct option', is_correct: true, sct_panel_votes: 0 },
      { id: 'B', text: 'Wrong option', is_correct: false, sct_panel_votes: 0 },
    ],
    vignette: {
      demographics: { age: 50, sex: 'M' },
      narrative: 'Test vignette',
      vitalSigns: null,
      labFindings: '',
    },
    rationale: {
      correct: 'Because it matches the pattern.',
      distractors: {},
      pearl: '',
    },
    meta: {
      source: 'manual',
      provenance: [],
      difficulty: 2,
    },
    ...overrides,
  };
}

describe('case player FSRS regression coverage', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('skips auto FSRS grading when submitAnswer is called with skipFsrsUpdate', async () => {
    const updateReview = vi.fn();
    vi.doMock('../data/fsrs.js', () => ({
      updateReview,
    }));

    const { useStore } = await import('../data/store.js');
    const caseData = buildCase();

    useStore.getState().startCase(caseData);
    useStore.getState().selectAnswer('A');
    useStore.getState().submitAnswer({ skipFsrsUpdate: true });

    expect(useStore.getState().machineState).toBe('REVIEWING');
    expect(updateReview).not.toHaveBeenCalled();
  });

  it('still auto grades by default for flows like exam mode', async () => {
    const updateReview = vi.fn();
    vi.doMock('../data/fsrs.js', () => ({
      updateReview,
    }));

    const { useStore } = await import('../data/store.js');
    const caseData = buildCase({ _id: 13 });

    useStore.getState().startCase(caseData);
    useStore.getState().selectAnswer('A');
    useStore.getState().submitAnswer();

    expect(updateReview).toHaveBeenCalledWith(13, 3);
  });

  it('submits from case player with skipFsrsUpdate enabled', async () => {
    const { CasePlayerSession } = await import('../pages/CasePlayer.jsx');
    const submitAnswer = vi.fn();
    const startCase = vi.fn();
    const nextCase = vi.fn();

    render(
      <CasePlayerSession
        caseData={buildCase()}
        caseBank={[buildCase()]}
        navigate={vi.fn()}
        machineState="ANSWERING"
        selectedAnswer="A"
        startCase={startCase}
        selectAnswer={vi.fn()}
        submitAnswer={submitAnswer}
        nextCase={nextCase}
        toggleBookmark={vi.fn()}
        bookmarks={[]}
        flagQuestion={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Submit Answer/i }));

    expect(startCase).toHaveBeenCalled();
    expect(submitAnswer).toHaveBeenCalledWith({ skipFsrsUpdate: true });
  });
});
