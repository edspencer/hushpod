import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import prettier from 'eslint-config-prettier'
import globals from 'globals'

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'drizzle', 'data', 'coverage'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
    },
  },
  // Server / shared / build config run on Node.
  {
    files: ['src/server/**/*.ts', 'src/shared/**/*.ts', '*.config.{ts,js}'],
    languageOptions: { globals: globals.node },
  },
  // Client runs in the browser; enable React hooks + fast-refresh rules.
  {
    files: ['src/client/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs['recommended-latest'].rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      // Initializing/syncing local state from fetched data is idiomatic here;
      // keep it as guidance rather than a hard error.
      'react-hooks/set-state-in-effect': 'warn',
    },
  },
  prettier,
)
