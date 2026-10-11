/// <reference types="node" />
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { sql } from 'drizzle-orm';
import { createDb } from '../config/database';
import { configureLocalNeonProxy } from '../config/localNeonProxy';

function isIgnorableMigrationError(err: unknown): boolean {
  if (!err) return false;
  const anyErr = err as Record<string, unknown>;
  const code = (anyErr.code ?? (anyErr.sourceError as Record<string, unknown>)?.code ?? (anyErr.cause as Record<string, unknown>)?.code) as string | undefined;
  const message = String(anyErr.message ?? (anyErr.sourceError as Record<string, unknown>)?.message ?? anyErr.cause ?? '');

  const ignorableCodes = new Set(['42710', '42P07', '42701', '42P06', '42P16', '23505']);
  if (code && ignorableCodes.has(code)) return true;

  if (
    message.includes('already exists') ||
    message.includes('duplicate key value') ||
    message.includes('multiple primary keys')
  ) {
    return true;
  }

  return false;
}

function splitSqlStatements(sqlContent: string): string[] {
  // First split by drizzle statement-breakpoint
  const chunks = sqlContent
    .split('--> statement-breakpoint')
    .map((c) => c.trim())
    .filter((c) => c.length > 0);

  const statements: string[] = [];

  for (const chunk of chunks) {
    // If chunk contains a PL/pgSQL block (DO $$ ... $$), execute it as a single statement
    if (chunk.includes('DO $$') || chunk.includes('DO $') || chunk.startsWith('CREATE OR REPLACE FUNCTION')) {
      statements.push(chunk);
      continue;
    }

    // Split on semicolons that are outside single quotes
    const parts = chunk
      .split(/;\s*(?=(?:[^']*'[^']*')*[^']*$)/)
      .map((p) => p.trim())
      .filter((p) => p.length > 0);

    for (const part of parts) {
      if (part.length > 0) {
        statements.push(part);
      }
    }
  }

  return statements;
}

async function migrate() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error('DATABASE_URL is not set.');
    process.exit(1);
  }

  configureLocalNeonProxy();
  const db = createDb(dbUrl);
  const migrationsFolder = path.resolve(import.meta.dir, '../../drizzle/migrations');
  const journalPath = path.join(migrationsFolder, 'meta/_journal.json');

  if (!fs.existsSync(journalPath)) {
    throw new Error(`Can't find meta/_journal.json file at ${journalPath}`);
  }

  const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8'));

  // Ensure drizzle migration schema & table exist
  await db.execute(sql`CREATE SCHEMA IF NOT EXISTS "drizzle";`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    );
  `);

  const result = await db.execute<{ created_at: string | number }>(
    sql`SELECT "created_at" FROM "drizzle"."__drizzle_migrations"`
  );
  const rows = (result.rows ?? result) as Array<{ created_at: string | number }>;
  const appliedTimestamps = new Set(rows.map((r) => Number(r.created_at)));

  console.log(`Found ${journal.entries.length} migration(s) in journal. Checking applied migrations...`);

  for (const entry of journal.entries) {
    const when = Number(entry.when);
    if (appliedTimestamps.has(when)) {
      continue;
    }

    const migrationFile = path.join(migrationsFolder, `${entry.tag}.sql`);
    if (!fs.existsSync(migrationFile)) {
      throw new Error(`Migration file not found: ${migrationFile}`);
    }

    const sqlContent = fs.readFileSync(migrationFile, 'utf8');
    const statements = splitSqlStatements(sqlContent);

    console.log(`Applying migration: ${entry.tag} (${statements.length} statement(s))...`);
    for (const stmt of statements) {
      try {
        await db.execute(sql.raw(stmt));
      } catch (err) {
        if (isIgnorableMigrationError(err)) {
          // Schema object already exists in this database environment: safe to proceed
          continue;
        }
        throw err;
      }
    }

    const hash = crypto.createHash('sha256').update(sqlContent).digest('hex');
    await db.execute(
      sql`INSERT INTO "drizzle"."__drizzle_migrations" ("hash", "created_at") VALUES (${hash}, ${when})`
    );
    console.log(`Applied migration: ${entry.tag}`);
  }

  console.log('Migrations up to date.');
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
