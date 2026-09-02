import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'

export default [
  { ignores: ['dist', '.claude'] },
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
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      /* These were imported and never applied, so no-undef and no-dupe-keys
         were off: a call to a function that did not exist passed lint, built
         cleanly, and only failed when somebody clicked the button. */
      ...js.configs.recommended.rules,
      /* Off on purpose. There are 194 across the codebase, none of them a
         crash, and clearing them belongs in its own pass rather than mixed
         into whatever is being fixed today. */
      'no-unused-vars': 'off',
      ...reactHooks.configs.recommended.rules,
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
