import tseslint from 'typescript-eslint';

// max-lines counts real code: blank lines and comments don't count toward the limit.
const maxLines = (max) => ['error', { max, skipBlankLines: true, skipComments: true }];

export default [
  { ignores: ['node_modules/**', 'drizzle/**', 'dist/**', '.wrangler/**'] },

  {
    files: ['**/*.ts'],
    languageOptions: { parser: tseslint.parser },
  },

  // File-size budget, tiered by role: controllers/modules are pure glue; services
  // legitimately carry query + mapping weight; shared helpers shouldn't sprawl.

  // catch-all for any source file (config/, main.ts, db/migrate.ts)
  {
    files: ['src/**/*.ts'],
    rules: { 'max-lines': maxLines(150) },
  },

  // services + their extracted *.helpers.ts carry the query + mapping weight
  {
    files: ['src/modules/**/*.service.ts', 'src/modules/**/*.helpers.ts'],
    rules: { 'max-lines': maxLines(200) },
  },

  // shared transformation helpers: mappers, standings, aggregation
  {
    files: ['src/common/**/*.ts'],
    rules: { 'max-lines': maxLines(150) },
  },

  // controllers: parse Hono ctx → call service → return { data, error }
  {
    files: ['src/modules/**/*.controller.ts'],
    rules: { 'max-lines': maxLines(80) },
  },

  // modules: route wiring only
  {
    files: ['src/modules/**/*.module.ts'],
    rules: { 'max-lines': maxLines(50) },
  },

  // no budget: mechanically-sized schema / seed data, and tests
  {
    files: ['src/db/schema/**/*.ts', 'src/db/seed.ts', 'tests/**/*.ts'],
    rules: { 'max-lines': 'off' },
  },
];
