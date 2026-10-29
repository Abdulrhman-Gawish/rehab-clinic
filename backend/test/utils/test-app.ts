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

// Empties every table except the migrations bookkeeping.
export async function resetDatabase(dataSource: DataSource): Promise<void> {
  const tables: { tablename: string }[] = await dataSource.query(
    `SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename <> 'migrations'`,
  );
  if (tables.length === 0) return;
  const list = tables.map(({ tablename }) => `"${tablename}"`).join(', ');
  // Async event listeners of the previous test (e.g. the automatic invoice)
  // may still be in a transaction: let them finish first. TRUNCATE can
  // still deadlock with one starting late; Postgres then aborts one side
  // and we just try again.
  await waitForOtherTransactions(dataSource);
  for (let attempt = 1; ; attempt++) {
    try {
      await dataSource.query(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
      return;
    } catch (error) {
      const code = (error as { driverError?: { code?: string } }).driverError
        ?.code;
      if (code !== '40P01' || attempt >= 5) throw error;
    }
  }
}
