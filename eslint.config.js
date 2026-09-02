import js from '@eslint/js'
import globals from 'globals'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'

export default [
  { ignores: ['dist'] },
  {
    files: ['**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    plugins: {
      react,
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      /* These were imported and never applied, so no-undef and no-dupe-keys
         were off: a call to a function that did not exist passed lint, built
         cleanly, and only failed when somebody clicked the button. */
      ...js.configs.recommended.rules,
      /* Without jsx-uses-vars a component that is only ever rendered as
         <Foo /> counts as unused, so it comes first. Unused args and vars
         that are deliberately kept are prefixed with an underscore. When
         this rule was turned on it had 36 hits across 17 files, all cleared
         in the same commit. */
      'react/jsx-uses-vars': 'error',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      ...reactHooks.configs.recommended.rules,
      'react-hooks/exhaustive-deps': 'error',
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
    },
  },
  /* Node, not a browser. Last, because flat config is last one wins and the
     block above would otherwise put the browser globals back. */
  {
    files: ['server/**/*.js', 'e2e/**/*.mjs', '**/*.test.js', 'eslint.config.js', 'vite.config.js'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
  },
]
