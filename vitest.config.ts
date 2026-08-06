import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    include: ['tests/**/*.test.ts', 'tests/**/*.spec.ts'],
    exclude: ['node_modules', 'dist', 'coverage', 'tests/e2e/**'],
    setupFiles: ['tests/setup-gpu.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts'],
      reporter: ['text', 'lcov', 'html'],
    },
    environment: 'happy-dom',
    testTimeout: 60_000,
    poolOptions: {
      forks: {
        execArgv: ['--max-old-space-size=6144'],
      },
    },
    server: {
      deps: {
        fallbackCJS: true,
      },
    },
  },
  resolve: {
    alias: {
      'electron': path.resolve(__dirname, 'tests/helpers/electron-mock.ts'),
    },
  },
});
