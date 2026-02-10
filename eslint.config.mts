// @ts-check

import eslint from '@eslint/js';
import tseslint, { type ConfigArray } from 'typescript-eslint';
import stylistic from '@stylistic/eslint-plugin';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      'scripts/',
      'dist/',
      '.bun/',
      'out/',
      'build/',
      'lib/src/',
      'lib/*.d.ts',
      'release-assets/',
      'vitest.config.ts',
    ],
  },
  {
    files: ['**/*.ts'],
    extends: [
      eslint.configs.recommended,
      ...tseslint.configs.recommended,
    ],
    plugins: {
      '@stylistic': stylistic,
    },
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.es2022,
      },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // --- Core rules ---
      'no-control-regex': 'off',
      'no-useless-assignment': 'off',
      curly: ['error', 'multi-line'],
      'dot-notation': 'error',
      eqeqeq: 'error',
      'no-console': ['warn', { allow: ['assert', 'warn', 'error'] }],
      'no-constant-binary-expression': 'error',
      'no-constructor-return': 'error',
      'no-template-curly-in-string': 'off',
      'no-fallthrough': 'off',
      'no-whitespace-before-property': 'error',
      'one-var-declaration-per-line': ['error', 'always'],
      'no-useless-escape': 'off',
      'no-extra-parens': 'off',
      'no-extra-semi': 'off',

      // --- @stylistic rules (replaces deprecated formatting rules) ---
      '@stylistic/array-bracket-spacing': 'error',
      '@stylistic/brace-style': 'error',
      '@stylistic/comma-dangle': ['error', 'always-multiline'],
      '@stylistic/comma-spacing': 'error',
      '@stylistic/computed-property-spacing': 'error',
      '@stylistic/eol-last': 'error',
      '@stylistic/func-call-spacing': 'error',
      '@stylistic/indent': ['error', 2, { SwitchCase: 1 }],
      '@stylistic/keyword-spacing': 'error',
      '@stylistic/linebreak-style': 'error',
      '@stylistic/no-extra-parens': 'error',
      '@stylistic/no-extra-semi': 'error',
      '@stylistic/no-multi-spaces': ['error', { ignoreEOLComments: true }],
      '@stylistic/no-multiple-empty-lines': ['error', { max: 1 }],
      '@stylistic/no-tabs': 'error',
      '@stylistic/no-trailing-spaces': 'error',
      '@stylistic/nonblock-statement-body-position': ['warn', 'beside', { overrides: { while: 'below' } }],
      '@stylistic/object-curly-spacing': ['error', 'always'],
      '@stylistic/padded-blocks': ['error', 'never'],
      '@stylistic/quote-props': ['error', 'as-needed'],
      '@stylistic/space-before-blocks': 'error',
      '@stylistic/space-before-function-paren': ['error', { anonymous: 'never', named: 'never' }],
      '@stylistic/space-in-parens': 'error',
      '@stylistic/space-infix-ops': 'error',
      '@stylistic/member-delimiter-style': ['warn', {
        singleline: {
          delimiter: 'semi',
          requireLast: true,
        },
      }],
      '@stylistic/quotes': ['error', 'single', { avoidEscape: true, allowTemplateLiterals: false }],
      '@stylistic/semi': ['warn', 'always'],

      // --- @typescript-eslint rules ---
      '@typescript-eslint/explicit-function-return-type': ['off', { allowExpressions: true }],
      '@typescript-eslint/explicit-module-boundary-types': ['off', { allowArgumentsExplicitlyTypedAsAny: false }],
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-namespace': 'off',
      '@typescript-eslint/no-require-imports': 'error',
      '@typescript-eslint/no-unnecessary-qualifier': 'error',
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrors: 'none',
      }],
      '@typescript-eslint/no-useless-constructor': 'error',
      '@typescript-eslint/ban-ts-comment': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/restrict-plus-operands': 'error',
      '@typescript-eslint/no-unsafe-declaration-merging': 'off',
    },
  },
  {
    files: ['tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      'no-console': 'off',
      'no-control-regex': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
) satisfies ConfigArray;
