import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts'],
      exclude: [
        '**/*.test.ts',
        'packages/*/src/test-support/**',
        '**/index.ts',
        'packages/extension/src/runtime/main.ts',
        'packages/extension/src/tool/cli.ts',
        'packages/extension/src/schemas/write-schemas.ts',
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
