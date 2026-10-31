module.exports = {
  'frontend/**/*.{js,jsx}': [
    "sh -c 'cd frontend && ./node_modules/.bin/eslint --fix -- \"\$@\"' dummy",
    "sh -c 'cd frontend && ./node_modules/.bin/prettier --write -- \"\$@\"' dummy",
  ],
  'backend/**/*.js': [
    "sh -c 'cd backend && ./node_modules/.bin/eslint --fix -- \"\$@\"' dummy",
    "sh -c 'cd backend && ./node_modules/.bin/prettier --write -- \"\$@\"' dummy",
  ],
};
