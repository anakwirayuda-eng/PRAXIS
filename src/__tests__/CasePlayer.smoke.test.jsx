import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { CasePlayerSession } from '../pages/CasePlayer';

const mockCaseData = {
  _id: 'TEST-001',
  case_code: 'INT-MOCK-00001',
  title: 'Render Test Case',
  prompt: 'What is the most likely diagnosis?',
  q_type: 'MCQ',
  category: 'INTERNAL_MEDICINE',
  vignette: { narrative: 'A test patient presents with test symptoms.', vitalSigns: null },
  options: [
    { id: '1', text: 'Option A mock text', is_correct: true },
    { id: '2', text: 'Option B mock text', is_correct: false },
    { id: '3', text: 'Option C mock text', is_correct: false }
  ]
};

describe('CasePlayer Component Smoke Test', () => {
  it('renders without crashing and displays the case', () => {
    const mockNavigate = vi.fn();
    const mockStartCase = vi.fn();
    const mockSelectAnswer = vi.fn();
    const mockSubmitAnswer = vi.fn();
    const mockNextCase = vi.fn();
    const mockToggleBookmark = vi.fn();
    const mockFlagQuestion = vi.fn();

    render(
      <MemoryRouter>
        <CasePlayerSession
          caseData={mockCaseData}
          caseBank={[mockCaseData]}
          navigate={mockNavigate}
          machineState="READING"
          selectedAnswer={null}
          startCase={mockStartCase}
          selectAnswer={mockSelectAnswer}
          submitAnswer={mockSubmitAnswer}
          nextCase={mockNextCase}
          toggleBookmark={mockToggleBookmark}
          bookmarks={[]}
          flagQuestion={mockFlagQuestion}
        />
      </MemoryRouter>
    );

    expect(screen.getByText('What is the most likely diagnosis?')).toBeInTheDocument();
    expect(screen.getByText('Option A mock text')).toBeInTheDocument();
    expect(screen.getByText('Option B mock text')).toBeInTheDocument();
    expect(screen.getByText('Option C mock text')).toBeInTheDocument();
  });
});
