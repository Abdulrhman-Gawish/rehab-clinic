import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test, type TestingModuleBuilder } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/app.setup.js';

export interface TestApp {
  app: NestExpressApplication;
  dataSource: DataSource;
}

// Boots the full application exactly like main.ts (same pipes, filter,
// prefix and guards) against the e2e database.
export async function createTestApp(
  customize?: (builder: TestingModuleBuilder) => TestingModuleBuilder,
): Promise<TestApp> {
  let builder = Test.createTestingModule({ imports: [AppModule] });
  if (customize) builder = customize(builder);
  const moduleRef = await builder.compile();

  const app = moduleRef.createNestApplication<NestExpressApplication>({
    bufferLogs: true,
  });
  configureApp(app);
  await app.init();

  return { app, dataSource: app.get(DataSource) };
}

// Waits (max ~5 s) until no other client of this database is running a
// query or holding an open transaction.
async function waitForOtherTransactions(dataSource: DataSource): Promise<void> {
  for (let i = 0; i < 100; i++) {
    const rows: { busy: string }[] = await dataSource.query(
      `SELECT count(*) AS busy FROM pg_stat_activity
        WHERE datname = current_database()
          AND pid <> pg_backend_pid()
          AND backend_type = 'client backend'
          AND state IN ('active', 'idle in transaction')`,
    );
    if (Number(rows[0].busy) === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

// Every table except the migrations bookkeeping, children before parents,
// so plain DELETEs satisfy the foreign keys (no superuser needed).
async function tablesInDeleteOrder(dataSource: DataSource): Promise<string[]> {
  const tables: { name: string }[] = await dataSource.query(
    `SELECT tablename AS name FROM pg_tables
      WHERE schemaname = 'public' AND tablename <> 'migrations'`,
  );
  const edges: { child: string; parent: string }[] = await dataSource.query(
    `SELECT conrelid::regclass::text AS child, confrelid::regclass::text AS parent
       FROM pg_constraint
      WHERE contype = 'f' AND connamespace = 'public'::regnamespace
        AND conrelid <> confrelid`,
  );
  const ordered: string[] = [];
  const remaining = new Set(tables.map((t) => t.name));
  while (remaining.size > 0) {
    // A table can go once no remaining table references it.
    const ready = [...remaining].filter(
      (table) =>
        !edges.some((e) => e.parent === table && remaining.has(e.child)),
    );
    if (ready.length === 0) throw new Error('Foreign key cycle between tables');
    for (const table of ready) {
      ordered.push(table);
      remaining.delete(table);
    }
  }
  return ordered;
}

let deleteAll: string | undefined;

// Empties every table except the migrations bookkeeping. DELETE is much
// faster than TRUNCATE for the handful of rows a test writes.
export async function resetDatabase(dataSource: DataSource): Promise<void> {
  deleteAll ??= (await tablesInDeleteOrder(dataSource))
    .map((table) => `DELETE FROM "${table}";`)
    .join(' ');
  // Async event listeners of the previous test (e.g. the automatic invoice)
  // may still be in a transaction: let them finish first. One starting late
  // can still deadlock with us, or insert a child row after its table was
  // emptied (FK violation on the parent); in both cases we simply retry.
  await waitForOtherTransactions(dataSource);
  for (let attempt = 1; ; attempt++) {
    try {
      await dataSource.query(deleteAll);
      return;
    } catch (error) {
      const code = (error as { driverError?: { code?: string } }).driverError
        ?.code;
      const retry = code === '40P01' || code === '23503';
      if (!retry || attempt >= 5) throw error;
    }
  }
}
