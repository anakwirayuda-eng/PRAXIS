import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../components/HealCaseModal.jsx', () => ({
  HealCaseModal: () => null,
}));

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('question feedback regressions', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
  });

  it('prevents duplicate submissions while feedback is being sent', async () => {
    const deferred = createDeferred();
    const fetchMock = vi.fn().mockReturnValue(deferred.promise);
    vi.stubGlobal('fetch', fetchMock);

    const { QuestionFeedback } = await import('../components/QuestionFeedback.jsx');

    render(
      <QuestionFeedback
        caseId={77}
        caseData={{
          _id: 77,
          prompt: 'A patient presents with new chest pain.',
          options: [
            { id: 'A', text: 'Observe', is_correct: false },
            { id: 'B', text: 'Treat', is_correct: true },
          ],
        }}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /beri feedback soal/i }));
    fireEvent.click(screen.getByRole('button', { name: /kunci salah/i }));

    const submitButton = screen.getByRole('button', { name: /simpan/i });
    fireEvent.click(submitButton);
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByRole('button', { name: /menyimpan/i })).toBeDisabled();

    deferred.resolve({ ok: true });

    expect(await screen.findByText(/feedback terkirim/i)).toBeInTheDocument();
  });
});
