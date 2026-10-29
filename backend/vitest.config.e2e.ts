import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';
import { resolveTestDatabase } from './test/test-env.js';

// e2e tests run against a real, dedicated PostgreSQL database that is wiped
// and migrated by test/global-setup.ts.
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['test/**/*.e2e-spec.ts'],
    globalSetup: ['./test/global-setup.ts'],
    // All files share one database, so run them one at a time.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 180_000,
    env: {
      NODE_ENV: 'test',
      DB_DATABASE: resolveTestDatabase(),
      LOG_LEVEL: 'silent',
      THROTTLE_ENABLED: 'false',
      CORS_ORIGINS: '',
    },
  },
});
