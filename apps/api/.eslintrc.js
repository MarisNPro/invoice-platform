module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: './tsconfig.json',
    tsconfigRootDir: __dirname,
    ecmaVersion: 2022,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
  ],
  rules: {
    '@typescript-eslint/no-unused-vars':    ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    '@typescript-eslint/no-explicit-any':   'off',
    '@typescript-eslint/require-await':     'off',
    '@typescript-eslint/no-var-requires':   'off',
    '@typescript-eslint/no-require-imports':'off',
    'no-constant-condition':                'off',
  },
  ignorePatterns: ['dist/', 'node_modules/'],
};
