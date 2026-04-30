import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['test/**/*.test.ts'],
    setupFiles: ['test/setup.ts'],
    isolate: false,
    testTimeout: 10000,
    clearMocks: true,
    restoreMocks: true,
    mockReset: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'html'],
      reportsDirectory: './coverage/unit',
      include: [
        'src/app.ts',
        'src/config/upload.ts',
        'src/controllers/upload.controller.ts',
        'src/routes/upload.route.ts',
      ],
      exclude: [
        'src/**/*.test.ts',
        '**/*.d.ts',
        'src/e2e/**',
        'src/scripts/**',
        'src/index.ts',
      ],
      thresholds: {
        statements: 90,
        branches: 90,
        functions: 90,
        lines: 90,
      },
    },
  },
});
