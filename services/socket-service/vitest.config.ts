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
        // Keep unit coverage focused on stable, directly testable contracts.
        'src/app.ts',
        'src/controllers/presence.controller.ts',
        'src/routes/presence.route.ts',
      ],
      exclude: [
        'src/**/*.test.ts',
        '**/*.d.ts',
        'src/scripts/**',
        'src/e2e/**',
        // Bootstrap/runtime wiring covered by smoke/integration behavior.
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
