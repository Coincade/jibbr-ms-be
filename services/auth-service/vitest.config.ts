import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['test/**/*.test.ts'],
    setupFiles: ['test/setup.ts'],
    isolate:false,
    testTimeout:10000,
    clearMocks: true,
    restoreMocks: true,
    mockReset: true,
  },
});