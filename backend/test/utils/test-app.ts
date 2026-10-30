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
  await dataSource.query(deleteAll);
}
