import nextConfig from 'eslint-config-next';
import eslintConfigPrettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

const eslintConfig = [
  // Global ignores (must be first)
  {
    ignores: [
      'dist-tests/',
      'node_modules/',
      'public/',
      'wasm/',
      '.next/',
      'out/',
    ],
  },

  // Next.js recommended config (includes TypeScript ESLint, React, etc.)
  ...nextConfig,

  // TypeScript-specific rule overrides
  {
    files: ['**/*.ts', '**/*.tsx'],
    plugins: {
      '@typescript-eslint': tseslint.plugin,
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },

  // General rules for all files
  {
    rules: {
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'prefer-const': 'error',
      eqeqeq: ['error', 'always'],
    },
  },

  // Prettier config (must be last to override formatting rules)
  eslintConfigPrettier,
];

export default eslintConfig;
