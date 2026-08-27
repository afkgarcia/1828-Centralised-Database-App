import { defineConfig } from 'drizzle-kit';

/** drizzle-kit config: `npx drizzle-kit generate` diffs schema.ts into ./drizzle. */
export default defineConfig({
  dialect: 'sqlite',
  schema: './desktop/main/db/schema.ts',
  out: './drizzle',
});
