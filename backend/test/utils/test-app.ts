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

// Empties every table except the migrations bookkeeping.
export async function resetDatabase(dataSource: DataSource): Promise<void> {
  const tables: { tablename: string }[] = await dataSource.query(
    `SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename <> 'migrations'`,
  );
  if (tables.length === 0) return;
  const list = tables.map(({ tablename }) => `"${tablename}"`).join(', ');
  // Async event listeners of the previous test (e.g. the automatic invoice)
  // may still be in a transaction; TRUNCATE can deadlock with them, in
  // which case Postgres aborts one side: just try again.
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
