import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/adminSession', () => ({
  hasVerifiedAdminSession: () => false,
}));

vi.mock('../lib/runtimeWatchdog', () => ({
  useRuntimeWatchdog: () => ({ count: 0 }),
}));

describe('layout accessibility regressions', () => {
  beforeEach(() => {
    vi.resetModules();
    window.matchMedia = vi.fn().mockImplementation(() => ({
      matches: false,
      media: '(max-width: 768px)',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
  });

  it('renders the sidebar brand as a home link and keeps a single main landmark', async () => {
    const { MemoryRouter } = await import('react-router-dom');
    const { default: Layout } = await import('../components/Layout.jsx');

    render(
      <MemoryRouter>
        <Layout>
          <main id="main-content">Body</main>
        </Layout>
      </MemoryRouter>,
    );

    expect(screen.getByRole('link', { name: /PRAXIS/i })).toHaveAttribute('href', '/');
    expect(document.querySelectorAll('main')).toHaveLength(1);
  }, 15000);

  it('opens settings as a dialog popover and focuses the first action', async () => {
    const { MemoryRouter } = await import('react-router-dom');
    const { default: Layout } = await import('../components/Layout.jsx');

    render(
      <MemoryRouter>
        <Layout>
          <main id="main-content">Body</main>
        </Layout>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: /Settings/i }));

    expect(screen.getByRole('dialog', { name: /Page settings/i })).toBeInTheDocument();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Show HUD Timer|Hide HUD Timer/i })).toHaveFocus();
  }, 15000);
});
