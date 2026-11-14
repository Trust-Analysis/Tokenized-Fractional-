module.exports = {
  env: {
    node: true,
    es2021: true,
  },
  extends: [
    'airbnb-base',
    'prettier',
  ],
  parserOptions: {
    ecmaVersion: 2021,
    sourceType: 'module',
  },
  plugins: ['prettier'],
  rules: {
    'prettier/prettier': 'error',
    'import/extensions': ['error', 'ignorePackages'],
    'no-underscore-dangle': 'off',
    'consistent-return': 'warn',
    'radix': 'warn',
    'import/prefer-default-export': 'off',
    'no-await-in-loop': 'warn',
    'no-restricted-syntax': 'warn',
    'no-unused-vars': 'warn',
  },
  overrides: [
    {
      files: ['**/*.test.js'],
      env: {
        jest: true,
      },
    },
  ],
};
