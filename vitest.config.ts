import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.test.{ts,tsx}'],
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
