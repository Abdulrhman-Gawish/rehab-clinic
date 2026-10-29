// Usage: npm run seed  (reads SEED_* variables from the environment / .env)
import dataSource from '../data-source.js';
import { seedOwner } from './seed-owner.js';

await dataSource.initialize();
try {
  await seedOwner(dataSource);
} finally {
  await dataSource.destroy();
}
