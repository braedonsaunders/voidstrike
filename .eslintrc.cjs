module.exports = {
  root: true,
  env: {
    browser: true,
    node: true,
    es2022: true,
  },
  extends: ['eslint:recommended'],
  ignorePatterns: ['dist-tests/', 'node_modules/', 'public/', 'wasm/'],
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
  },
};
