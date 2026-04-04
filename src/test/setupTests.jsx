import React from 'react';
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

const MOTION_PROPS = new Set([
  'animate',
  'exit',
  'initial',
  'layout',
  'layoutId',
  'transition',
  'variants',
  'whileHover',
  'whileTap',
]);

function stripMotionProps(props) {
  return Object.fromEntries(
    Object.entries(props).filter(([key]) => !MOTION_PROPS.has(key)),
  );
}

vi.mock('framer-motion', () => {
  const motion = new Proxy({}, {
    get: (_, tag) => React.forwardRef(({ children, ...props }, ref) => (
      React.createElement(tag, { ref, ...stripMotionProps(props) }, children)
    )),
  });

  return {
    motion,
    AnimatePresence: ({ children }) => <>{children}</>,
  };
});

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = ResizeObserverMock;
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

