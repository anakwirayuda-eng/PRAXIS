import { configDefaults, defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config.js';

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: './src/test/setupTests.jsx',
      clearMocks: true,
      exclude: [...configDefaults.exclude, 'e2e/**'],
      pool: 'threads',
      maxWorkers: 1,
      fileParallelism: false,
      testTimeout: 20000,
      hookTimeout: 30000,
      teardownTimeout: 30000,
    },
  }),
);
