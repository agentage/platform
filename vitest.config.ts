import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // An in-process postgres boots in seconds when the whole suite runs at once (tests and hooks).
    testTimeout: 30_000,
    hookTimeout: 30_000,
    include: ['packages/*/src/**/*.test.{ts,tsx}'],
    setupFiles: ['packages/extension/src/test-support/cleanup.ts'],
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.{ts,tsx}'],
      exclude: [
        '**/*.test.{ts,tsx}',
        'packages/*/src/test-support/**',
        '**/index.ts',
        'packages/extension/src/runtime/main.ts',
        'packages/extension/src/tool/cli.ts',
        'packages/extension/src/schemas/write-schemas.ts',
        'packages/widget/src/bundle/cli.ts',
        'packages/widget/src/harness/main.ts',
        'packages/widget/src/ds/styles.generated.ts',
      ],
      thresholds: {
        branches: 70,
        functions: 70,
        lines: 70,
        statements: 70,
      },
    },
  },
});
