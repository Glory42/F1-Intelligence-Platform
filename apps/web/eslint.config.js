import tseslint from 'typescript-eslint';
import astro from 'eslint-plugin-astro';
import reactHooks from 'eslint-plugin-react-hooks';

// max-lines counts real code: blank lines and comments don't count toward the limit.
const maxLines = (max) => ['error', { max, skipBlankLines: true, skipComments: true }];

export default [
  { ignores: ['dist/**', '.astro/**', 'node_modules/**', 'src/env.d.ts', '.wrangler/**'] },

  // .astro parsing (parser + plugin, no opinionated style rules)
  ...astro.configs['flat/base'],

  // TS / TSX parsing
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  },

  // React hooks correctness (the codebase already has disable directives for these)
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },

  // File-size budget: a page composes sections and fetches data, so it runs longer
  // than a leaf component; pure logic modules should stay tight.

  // default for any source file
  {
    files: ['src/**/*.{ts,tsx,astro}'],
    rules: { 'max-lines': maxLines(200) },
  },

  // pages + layouts: frontmatter (fetch + shape) + a composition of sections
  {
    files: ['src/pages/**/*.astro', 'src/layouts/**/*.astro'],
    rules: { 'max-lines': maxLines(300) },
  },

  // components: display markup, plus room for one co-located <script>/<style>
  {
    files: ['src/**/components/**/*.{astro,tsx}'],
    rules: { 'max-lines': maxLines(250) },
  },

  // pure logic, hooks, lib helpers: keep these single-purpose (default 200 budget)

  // no budget for type decls, tests, or config
  {
    files: ['src/types/**/*.ts', 'tests/**/*.{ts,tsx}', '**/*.config.{js,ts,mjs,cjs}'],
    rules: { 'max-lines': 'off' },
  },
];
