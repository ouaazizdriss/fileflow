// ESLint flat config — correctness plus security rules for the React frontend.
// Run with `pnpm lint`; CI fails on any error (see .github/workflows/ci.yml).
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import eslintReact from '@eslint-react/eslint-plugin'
import security from 'eslint-plugin-security'
import noUnsanitized from 'eslint-plugin-no-unsanitized'
import globals from 'globals'

export default tseslint.config(
  { ignores: ['dist', 'coverage', 'node_modules'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    extends: [eslintReact.configs['recommended-typescript']],
    languageOptions: {
      globals: globals.browser,
    },
    plugins: {
      security,
      'no-unsanitized': noUnsanitized,
    },
    rules: {
      ...security.configs.recommended.rules,
      ...noUnsanitized.configs.recommended.rules,

      // XSS sinks. Rendering HTML is allowed only where it is sanitized first
      // (DOMPurify, see src/sanitize.ts); each such site carries an explicit
      // eslint-disable comment stating how its input was sanitized.
      '@eslint-react/dom-no-dangerously-set-innerhtml': 'error',
      '@eslint-react/dom-no-script-url': 'error',
      '@eslint-react/dom-no-unsafe-target-blank': 'error',
      '@eslint-react/dom-no-missing-iframe-sandbox': 'error',
      '@eslint-react/dom-no-unsafe-iframe-sandbox': 'error',
      // ReDoS: user files are rendered client-side (markdown preview).
      'security/detect-unsafe-regex': 'error',
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',

      // Flags every obj[key] access; in typed code this is overwhelmingly
      // false positives. Prototype-pollution risk is covered by TypeScript.
      'security/detect-object-injection': 'off',

      // React render/perf hygiene: reported, but not a CI gate yet (existing
      // code has many hits; fix incrementally, then promote to 'error').
      '@eslint-react/no-array-index-key': 'warn',
      '@eslint-react/set-state-in-effect': 'warn',
      '@eslint-react/static-components': 'warn',
      '@eslint-react/exhaustive-deps': 'warn',

      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    // Tests and node scripts: relax browser-security rules, add node globals.
    files: ['src/**/*.test.{ts,tsx}', 'src/test/**', 'scripts/**', '*.config.{js,ts}'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      'security/detect-non-literal-fs-filename': 'off',
      // Fixtures build DOM from literal HTML on purpose.
      'no-unsanitized/property': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
)
