import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockNavigate = vi.fn();

vi.mock('../lib/adminSession', () => ({
  hasVerifiedAdminSession: () => false,
}));

vi.mock('../lib/runtimeWatchdog', () => ({
  useRuntimeWatchdog: () => ({ count: 0 }),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

function setMobileViewport() {
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    value: 390,
    writable: true,
  });
  window.matchMedia = vi.fn().mockImplementation(() => ({
    matches: true,
    media: '(max-width: 768px)',
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}

describe('layout accessibility regressions', () => {
  beforeEach(() => {
    vi.resetModules();
    mockNavigate.mockReset();
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
    expect(screen.queryByRole('link', { name: /Debriefs/i })).not.toBeInTheDocument();
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

  it('supports the advertised Ctrl+K shortcut without requiring a mouse click', async () => {
    const { MemoryRouter } = await import('react-router-dom');
    const { default: Layout } = await import('../components/Layout.jsx');

    render(
      <MemoryRouter initialEntries={['/']}>
        <Layout>
          <main id="main-content">Body</main>
        </Layout>
      </MemoryRouter>,
    );

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });

    expect(mockNavigate).toHaveBeenCalledWith('/cases', { state: { focusSearch: true } });
  }, 15000);

  it('opens the mobile sidebar from the header menu without closing it immediately', async () => {
    setMobileViewport();

    const { MemoryRouter } = await import('react-router-dom');
    const { default: Layout } = await import('../components/Layout.jsx');

    const { container } = render(
      <MemoryRouter initialEntries={['/cases']}>
        <Layout>
          <main id="main-content">Body</main>
        </Layout>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: /Toggle navigation/i }));

    expect(container.querySelector('.sidebar')).toHaveClass('open');
    expect(screen.getByRole('button', { name: /Close nav/i })).toBeInTheDocument();
    expect(document.body.style.overflow).toBe('hidden');
  }, 15000);

  it('renders a mobile quick-nav rail and lets More toggle the sidebar', async () => {
    setMobileViewport();

    const { MemoryRouter } = await import('react-router-dom');
    const { default: Layout } = await import('../components/Layout.jsx');

    const { container } = render(
      <MemoryRouter initialEntries={['/review']}>
        <Layout>
          <main id="main-content">Body</main>
        </Layout>
      </MemoryRouter>,
    );

    const quickNav = screen.getByRole('navigation', { name: /Quick navigation/i });

    expect(quickNav).toBeInTheDocument();
    expect(within(quickNav).getByRole('link', { name: /Home/i })).toBeInTheDocument();
    expect(within(quickNav).getByRole('link', { name: /Cases/i })).toBeInTheDocument();
    expect(within(quickNav).getByRole('link', { name: /^Review$/i })).toHaveAttribute('aria-current', 'page');

    fireEvent.click(screen.getByRole('button', { name: /More/i }));

    expect(container.querySelector('.sidebar')).toHaveClass('open');
  }, 15000);

  it('shows mobile header context and hides empty bookmark counts on compact screens', async () => {
    setMobileViewport();

    const { MemoryRouter } = await import('react-router-dom');
    const { default: Layout } = await import('../components/Layout.jsx');

    render(
      <MemoryRouter initialEntries={['/predict']}>
        <Layout>
          <main id="main-content">Body</main>
        </Layout>
      </MemoryRouter>,
    );

    expect(screen.getByText('Predictor')).toBeInTheDocument();
    expect(within(screen.getByRole('button', { name: /View bookmarks/i })).queryByText('0')).not.toBeInTheDocument();
  }, 15000);

  it('hides the mobile quick-nav rail on case player routes', async () => {
    setMobileViewport();

    const { MemoryRouter } = await import('react-router-dom');
    const { default: Layout } = await import('../components/Layout.jsx');

    render(
      <MemoryRouter initialEntries={['/case/sample-case']}>
        <Layout>
          <main id="main-content">Body</main>
        </Layout>
      </MemoryRouter>,
    );

    expect(screen.queryByRole('navigation', { name: /Quick navigation/i })).not.toBeInTheDocument();
  }, 15000);
});
