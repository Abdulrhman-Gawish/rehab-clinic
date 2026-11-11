import type { DataSource } from 'typeorm';

/**
 * Runs `fn` while every INSERT into `table` fails inside the database (a
 * temporary trigger), to test what happens when a transaction rolls back
 * after a side effect such as a stored file. e2e files run one at a time,
 * so no other suite sees the trigger.
 */
export async function withFailingInserts<T>(
  dataSource: DataSource,
  table: string,
  fn: () => Promise<T>,
): Promise<T> {
  if (!/^\w+$/.test(table)) throw new Error(`Invalid table: ${table}`);
  await dataSource.query(
    `CREATE FUNCTION test_fail_insert() RETURNS trigger LANGUAGE plpgsql
       AS $$ BEGIN RAISE EXCEPTION 'simulated database failure'; END $$`,
  );
  await dataSource.query(
    `CREATE TRIGGER test_fail_insert BEFORE INSERT ON "${table}"
       FOR EACH ROW EXECUTE FUNCTION test_fail_insert()`,
  );
  try {
    return await fn();
  } finally {
    await dataSource.query(`DROP TRIGGER test_fail_insert ON "${table}"`);
    await dataSource.query('DROP FUNCTION test_fail_insert()');
  }
}
