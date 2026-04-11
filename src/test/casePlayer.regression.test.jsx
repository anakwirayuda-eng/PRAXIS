import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

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
      <MemoryRouter>
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
        />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: /Submit Answer/i }));

    expect(startCase).toHaveBeenCalled();
    expect(submitAnswer).toHaveBeenCalledWith({ skipFsrsUpdate: true });
  }, 15000);

  it('selects focused answer cards with Enter and Space', async () => {
    vi.doMock('../components/QuestionFeedback.jsx', () => ({
      QuestionFeedback: () => null,
    }));

    const { CasePlayerSession } = await import('../pages/CasePlayer.jsx');
    const caseData = buildCase({
      options: [
        { id: 'answer-correct', text: 'Correct option', is_correct: true, sct_panel_votes: 0 },
        { id: 'answer-wrong', text: 'Wrong option', is_correct: false, sct_panel_votes: 0 },
      ],
    });
    const selectAnswer = vi.fn();

    render(
      <MemoryRouter>
        <CasePlayerSession
          caseData={caseData}
          caseBank={[caseData]}
          navigate={vi.fn()}
          machineState="ANSWERING"
          selectedAnswer={null}
          startCase={vi.fn()}
          selectAnswer={selectAnswer}
          submitAnswer={vi.fn()}
          nextCase={vi.fn()}
          toggleBookmark={vi.fn()}
          bookmarks={[]}
          flagQuestion={vi.fn()}
        />
      </MemoryRouter>,
    );

    const option = screen.getByRole('radio', { name: /Correct option/i });
    expect(option).toHaveAttribute('role', 'radio');

    fireEvent.keyDown(option, { key: 'Enter' });
    expect(selectAnswer).toHaveBeenCalledWith('answer-correct');

    selectAnswer.mockClear();
    fireEvent.keyDown(option, { key: ' ' });
    expect(selectAnswer).toHaveBeenCalledWith('answer-correct');
  }, 15000);

  it('shows the displayed answer label in review feedback after shuffling', async () => {
    vi.doMock('../components/QuestionFeedback.jsx', () => ({
      QuestionFeedback: () => null,
    }));

    const { CasePlayerSession } = await import('../pages/CasePlayer.jsx');
    const caseData = buildCase({
      _id: 21,
      options: [
        { id: 'correct-id', text: 'Correct option', is_correct: true, sct_panel_votes: 0 },
        { id: 'wrong-id', text: 'Wrong option', is_correct: false, sct_panel_votes: 0 },
        { id: 'third-id', text: 'Third option', is_correct: false, sct_panel_votes: 0 },
      ],
    });

    render(
      <MemoryRouter>
        <CasePlayerSession
          caseData={caseData}
          caseBank={[caseData]}
          navigate={vi.fn()}
          machineState="REVIEWING"
          selectedAnswer="wrong-id"
          startCase={vi.fn()}
          selectAnswer={vi.fn()}
          submitAnswer={vi.fn()}
          nextCase={vi.fn()}
          toggleBookmark={vi.fn()}
          bookmarks={[]}
          flagQuestion={vi.fn()}
        />
      </MemoryRouter>,
    );

    const correctLetter = document.querySelector('.option-card.correct .option-letter')?.textContent;
    const feedback = screen.getByText(/The correct answer is/i).closest('p');

    expect(correctLetter).toBeTruthy();
    expect(feedback?.textContent).toContain(`The correct answer is ${correctLetter}: Correct option`);
    expect(feedback?.textContent).not.toContain('correct-id');
  }, 15000);

  it('hides blank distractor copy and never renders the correct option as a wrong heading', async () => {
    vi.doMock('../components/QuestionFeedback.jsx', () => ({
      QuestionFeedback: () => null,
    }));

    const { CasePlayerSession } = await import('../pages/CasePlayer.jsx');
    const caseData = buildCase({
      _id: 22,
      options: [
        { id: 'A', text: 'Alpha option', is_correct: false, sct_panel_votes: 0 },
        { id: 'B', text: 'Beta option', is_correct: false, sct_panel_votes: 0 },
        { id: 'C', text: 'Gamma option', is_correct: false, sct_panel_votes: 0 },
        { id: 'D', text: 'Delta option', is_correct: true, sct_panel_votes: 0 },
      ],
      rationale: {
        correct: 'Delta option is correct because it fits the vignette.',
        distractors: {
          A: 'Alpha option misses the defining clue.',
          B: '   ',
          D: 'This text should never render as a distractor because D is correct.',
        },
        pearl: '',
      },
    });

    render(
      <MemoryRouter>
        <CasePlayerSession
          caseData={caseData}
          caseBank={[caseData]}
          navigate={vi.fn()}
          machineState="REVIEWING"
          selectedAnswer="A"
          startCase={vi.fn()}
          selectAnswer={vi.fn()}
          submitAnswer={vi.fn()}
          nextCase={vi.fn()}
          toggleBookmark={vi.fn()}
          bookmarks={[]}
          flagQuestion={vi.fn()}
        />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: /Show Explanation/i }));

    const correctLetter = document.querySelector('.option-card.correct .option-letter')?.textContent;

    expect(screen.getByText(/Why [A-Z] is wrong/i)).toHaveTextContent('Why');
    expect(screen.queryByText(new RegExp(`Why ${correctLetter} is wrong`, 'i'))).not.toBeInTheDocument();
    expect(screen.queryByText(/This text should never render as a distractor/i)).not.toBeInTheDocument();
  }, 15000);

  it('resets per-case timer state when the session receives a new case', async () => {
    vi.useFakeTimers();
    vi.doMock('../components/QuestionFeedback.jsx', () => ({
      QuestionFeedback: () => null,
    }));

    const { CasePlayerSession } = await import('../pages/CasePlayer.jsx');
    const firstCase = buildCase({ _id: 30, title: 'First Timed Case' });
    const secondCase = buildCase({ _id: 31, title: 'Second Timed Case' });

    const { rerender } = render(
      <MemoryRouter>
        <CasePlayerSession
          caseData={firstCase}
          caseBank={[firstCase, secondCase]}
          navigate={vi.fn()}
          machineState="ANSWERING"
          selectedAnswer={null}
          startCase={vi.fn()}
          selectAnswer={vi.fn()}
          submitAnswer={vi.fn()}
          nextCase={vi.fn()}
          toggleBookmark={vi.fn()}
          bookmarks={[]}
          flagQuestion={vi.fn()}
        />
      </MemoryRouter>,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(screen.getByText('00:03')).toBeInTheDocument();

    await act(async () => {
      rerender(
        <MemoryRouter>
          <CasePlayerSession
            caseData={secondCase}
            caseBank={[firstCase, secondCase]}
            navigate={vi.fn()}
            machineState="ANSWERING"
            selectedAnswer={null}
            startCase={vi.fn()}
            selectAnswer={vi.fn()}
            submitAnswer={vi.fn()}
            nextCase={vi.fn()}
            toggleBookmark={vi.fn()}
            bookmarks={[]}
            flagQuestion={vi.fn()}
          />
        </MemoryRouter>,
      );
    });

    expect(screen.getByText('00:00')).toBeInTheDocument();
  }, 15000);

  it('opens the image lightbox with Space and restores focus when closed', async () => {
    const { CaseImageGallery } = await import('../pages/CasePlayer.jsx');

    render(
      <CaseImageGallery
        images={['first.png', 'second.png']}
        imageType={{ emoji: '🩻', type: 'X-ray', ui_mode: 'pacs_dark' }}
      />,
    );

    const thumb = screen.getByRole('button', { name: /Open 🩻 X-ray image 1/i });
    thumb.focus();

    fireEvent.keyDown(thumb, { key: ' ' });

    const dialog = screen.getByRole('dialog', { name: /Image lightbox/i });
    expect(dialog).toHaveAttribute('aria-modal', 'true');

    const closeButton = screen.getByRole('button', { name: /Close lightbox/i });
    await waitFor(() => {
      expect(closeButton).toHaveFocus();
    });

    fireEvent.keyDown(closeButton, { key: 'Tab' });
    expect(screen.getByRole('button', { name: /Bone Window/i })).toHaveFocus();

    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: /Image lightbox/i })).not.toBeInTheDocument();
    });
    expect(thumb).toHaveFocus();
  }, 15000);

  it('renders smart vignette lab matches as native buttons with tooltip state', async () => {
    const { default: SmartVignette } = await import('../components/SmartVignette.jsx');

    render(<SmartVignette text="Hb 10 g/dL" />);

    const trigger = screen.getByRole('button', { name: /Hb 10/i });
    expect(trigger.tagName).toBe('BUTTON');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).not.toHaveAttribute('aria-describedby');

    fireEvent.click(trigger);

    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(trigger).toHaveAttribute('aria-describedby');
    expect(screen.getByRole('tooltip')).toHaveTextContent(/Normal:/i);
  }, 15000);

  it('closes the heal-case modal with Escape and restores focus to the trigger', async () => {
    vi.doUnmock('../components/QuestionFeedback.jsx');
    const { QuestionFeedback } = await import('../components/QuestionFeedback.jsx');

    render(
      <QuestionFeedback
        caseId={7}
        caseData={{
          _id: 7,
          prompt: 'A patient presents with progressive dyspnea.',
          options: [
            { id: 'A', text: 'Observe', is_correct: true },
            { id: 'B', text: 'Operate', is_correct: false },
          ],
          rationale: { correct: 'Observation is appropriate here.' },
        }}
      />,
    );

    const healTrigger = screen.getByRole('button', { name: /Heal this Case/i });
    healTrigger.focus();

    fireEvent.click(healTrigger);

    const dialog = screen.getByRole('dialog', { name: /Heal this Case/i });
    expect(dialog).toHaveAttribute('aria-modal', 'true');

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Close heal case modal/i })).toHaveFocus();
    });

    fireEvent.keyDown(window, { key: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: /Heal this Case/i })).not.toBeInTheDocument();
    });
    expect(healTrigger).toHaveFocus();
  }, 15000);

  it('skips blocked playlist entries when moving to the next case', async () => {
    vi.doMock('../components/QuestionFeedback.jsx', () => ({
      QuestionFeedback: () => null,
    }));

    const { CasePlayerSession } = await import('../pages/CasePlayer.jsx');
    const navigate = vi.fn();
    const currentCase = buildCase({ _id: 50, case_code: 'CASE-001', title: 'Current Case' });
    const needsReviewCase = buildCase({
      _id: 51,
      case_code: 'CASE-002',
      title: 'Needs Review Case',
      meta: { ...buildCase().meta, source: 'manual', provenance: [], difficulty: 2, needs_review: true },
    });
    const truncatedCase = buildCase({
      _id: 52,
      case_code: 'CASE-003',
      title: 'Truncated Case',
      meta: { ...buildCase().meta, source: 'manual', provenance: [], difficulty: 2, truncated: true },
    });
    const quarantinedCase = buildCase({
      _id: 53,
      case_code: 'CASE-004',
      title: 'Quarantined Case',
      meta: { ...buildCase().meta, source: 'manual', provenance: [], difficulty: 2, status: 'QUARANTINED_DATA' },
    });
    const playableCase = buildCase({ _id: 54, case_code: 'CASE-005', title: 'Playable Next Case' });

    render(
      <MemoryRouter
        initialEntries={[{
          pathname: '/case/CASE-001',
          state: { playlist: ['CASE-001', 'CASE-002', 'CASE-003', 'CASE-004', 'CASE-005'] },
        }]}
      >
        <Routes>
          <Route
            path="/case/:id"
            element={(
              <CasePlayerSession
                caseData={currentCase}
                caseBank={[currentCase, needsReviewCase, truncatedCase, quarantinedCase, playableCase]}
                navigate={navigate}
                machineState="REVIEWING"
                selectedAnswer="A"
                startCase={vi.fn()}
                selectAnswer={vi.fn()}
                submitAnswer={vi.fn()}
                nextCase={vi.fn()}
                toggleBookmark={vi.fn()}
                bookmarks={[]}
                flagQuestion={vi.fn()}
              />
            )}
          />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: /Next Case/i }));

    expect(navigate).toHaveBeenCalledWith('/case/CASE-005', {
      state: { playlist: ['CASE-001', 'CASE-002', 'CASE-003', 'CASE-004', 'CASE-005'] },
    });
  }, 15000);

  it('swallows clipboard copy rejections for the case code badge', async () => {
    vi.doMock('../components/QuestionFeedback.jsx', () => ({
      QuestionFeedback: () => null,
    }));

    const clipboard = {
      writeText: vi.fn().mockRejectedValue(new Error('denied')),
    };
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: clipboard,
    });

    const { CasePlayerSession } = await import('../pages/CasePlayer.jsx');
    const caseData = buildCase({ _id: 60, case_code: 'COPY-001', title: 'Clipboard Case' });

    render(
      <MemoryRouter>
        <CasePlayerSession
          caseData={caseData}
          caseBank={[caseData]}
          navigate={vi.fn()}
          machineState="ANSWERING"
          selectedAnswer={null}
          startCase={vi.fn()}
          selectAnswer={vi.fn()}
          submitAnswer={vi.fn()}
          nextCase={vi.fn()}
          toggleBookmark={vi.fn()}
          bookmarks={[]}
          flagQuestion={vi.fn()}
        />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByText('COPY-001'));
    await act(async () => {
      await Promise.resolve();
    });

    expect(clipboard.writeText).toHaveBeenCalledWith('COPY-001');
  }, 15000);
});

