export default {
  '*.{js,jsx,ts,tsx,mjs,cjs,mts,cts}': [
    'oxlint --deny-warnings --fix',
    'prettier --write',
  ],
  '!(*.{js,jsx,ts,tsx,mjs,cjs,mts,cts})': 'prettier --ignore-unknown --write',
};
