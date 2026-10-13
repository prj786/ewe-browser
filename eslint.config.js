import js from '@eslint/js'
import prettier from 'eslint-config-prettier'
import solid from 'eslint-plugin-solid/configs/typescript'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/out/**', '**/dist/**', '**/release/**'] },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-unnecessary-condition': 'off',
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      '@typescript-eslint/no-confusing-void-expression': 'off',
      '@typescript-eslint/no-non-null-assertion': 'error',
    },
  },
  {
    files: ['apps/browser/src/main/**', 'apps/browser/src/preload/**', 'apps/browser/tests/**'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['apps/browser/src/ui/**', 'apps/browser/src/pages/**'],
    ...solid,
    languageOptions: { ...solid.languageOptions, globals: globals.browser },
    rules: {
      ...solid.rules,
      'no-unassigned-vars': 'off',
      'solid/reactivity': [
        'warn',
        { customReactiveFunctions: ['run', 'item', 'onFsChanged', 'setActionHandler'] },
      ],
    },
  },
  {
    files: ['apps/browser/scripts/**'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  { files: ['**/*.js', '**/*.mjs'], ...tseslint.configs.disableTypeChecked },
  prettier,
)
