import typescriptEslint from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import prettierPlugin from 'eslint-plugin-prettier';
import prettierConfig from 'eslint-config-prettier';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  {
    ignores: [
      '**/dist/**',
      '**/coverage/**',
      '**/node_modules/**',
      'packages/extension/schemas/**',
      'packages/widget/src/ds/styles.generated.ts',
      '**/test-results/**',
      '**/playwright-report/**',
    ],
  },
  {
    files: [
      'packages/*/src/**/*.{ts,tsx}',
      'packages/widget/e2e/**/*.ts',
      'packages/widget/*.config.ts',
    ],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2024,
        sourceType: 'module',
        project: ['./packages/*/tsconfig.eslint.json'],
      },
    },
    plugins: {
      '@typescript-eslint': typescriptEslint,
      prettier: prettierPlugin,
    },
    rules: {
      ...prettierConfig.rules,
      'prettier/prettier': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/naming-convention': [
        'error',
        {
          selector: 'interface',
          format: ['PascalCase'],
          custom: { regex: '^[A-Z]', match: true },
        },
        {
          selector: 'typeAlias',
          format: ['PascalCase'],
        },
      ],
      'prefer-const': 'error',
      'prefer-arrow-callback': 'error',
      'arrow-body-style': ['error', 'as-needed'],
      'no-var': 'error',
    },
  },
  {
    files: ['packages/widget/src/**/*.tsx'],
    plugins: { 'jsx-a11y': jsxA11y, 'react-hooks': reactHooks },
    rules: { ...jsxA11y.flatConfigs.recommended.rules, ...reactHooks.configs.recommended.rules },
  },
];
