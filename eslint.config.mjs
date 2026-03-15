import nextConfig from 'eslint-config-next';
import eslintConfigPrettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

const deterministicEngineFiles = [
  'src/engine/ai/**/*.ts',
  'src/engine/combat/**/*.ts',
  'src/engine/pathfinding/**/*.ts',
  'src/engine/systems/**/*.ts',
  'src/engine/components/Transform.ts',
  'src/engine/components/Velocity.ts',
];

const eslintConfig = [
  // Global ignores (must be first)
  {
    ignores: [
      'dist-tests/',
      'node_modules/',
      'public/',
      'wasm/',
      '.next/',
      '.next.old/',
      '.next.codex-backup-*',
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

  {
    files: deterministicEngineFiles,
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@/utils/math',
              importNames: ['angle', 'distance', 'distanceSquared', 'normalize'],
              message: 'Use DeterministicMath utilities in simulation code.',
            },
          ],
        },
      ],
      'no-restricted-properties': [
        'error',
        {
          object: 'Math',
          property: 'random',
          message: 'Use SeededRandom in simulation code.',
        },
        {
          object: 'Math',
          property: 'sqrt',
          message: 'Use DeterministicMath utilities in simulation code.',
        },
      ],
    },
  },

  // Prettier config (must be last to override formatting rules)
  eslintConfigPrettier,
];

export default eslintConfig;
