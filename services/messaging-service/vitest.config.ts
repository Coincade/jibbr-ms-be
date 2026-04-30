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
        // Shared primitives and infra-critical modules
        'src/config/database.ts',
        'src/config/streams.ts',
        'src/helpers/domainUtils.ts',
        'src/helpers/generateCode.ts',
        'src/services/rate-limiter.ts',
        // Route wiring contracts
        'src/routes/**/*.ts',
      ],
      exclude: [
        'src/**/*.test.ts',
        '**/*.d.ts',
        'src/scripts/**',
        // entrypoint/bootstrap glue
        'src/index.ts',
        'src/app.ts',
        'src/e2e/**',
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
