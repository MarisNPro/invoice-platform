/** @type {import('eslint').Linter.Config} */
module.exports = {
  extends: ['next/core-web-vitals'],
  rules: {
    // Type-aware rules require parserOptions.project — not needed for the web app
    '@typescript-eslint/await-thenable': 'off',
    '@typescript-eslint/no-floating-promises': 'off',
    '@typescript-eslint/no-misused-promises': 'off',
    '@typescript-eslint/require-await': 'off',
  },
};
