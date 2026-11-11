// Usage: npm run storage:orphans [-- --delete] [-- --min-age-minutes=60]
// Lists stored files that no row points to (left by a crash between writing
// an upload and committing it). Dry run unless --delete is passed.
import type { ConfigService } from '@nestjs/config';
import { FileStorage } from '../common/storage/file-storage.service.js';
import { findOrphans } from '../common/storage/orphan-sweep.js';
import type { EnvironmentVariables } from '../config/env.validation.js';
import dataSource from './data-source.js';

const args = process.argv.slice(2);
const remove = args.includes('--delete');
const minAge = Number(
  args.find((a) => a.startsWith('--min-age-minutes='))?.split('=')[1] ?? 60,
);
if (!Number.isInteger(minAge) || minAge < 10) {
  throw new Error('--min-age-minutes must be an integer of at least 10');
}

const storage = new FileStorage({
  get: () => process.env.STORAGE_LOCAL_PATH ?? './storage',
} as unknown as ConfigService<EnvironmentVariables, true>);

await dataSource.initialize();
try {
  const orphans = await findOrphans(storage, dataSource, new Date(), minAge);
  for (const file of orphans) {
    console.log(
      `${remove ? 'deleting' : 'orphan'} ${file.key} (${file.modifiedAt.toISOString()})`,
    );
    if (remove) await storage.delete(file.key);
  }
  console.log(
    `${orphans.length} orphaned file(s)${remove ? ' deleted' : '; run with --delete to remove them'}`,
  );
} finally {
  await dataSource.destroy();
}
