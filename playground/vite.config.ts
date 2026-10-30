import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Throwaway: read the OWNER credentials from the backend .env for the quick-login button.
function backendEnv(): Record<string, string> {
  try {
    const text = readFileSync(new URL('../backend/.env', import.meta.url), 'utf8');
    return Object.fromEntries(
      text
        .split(/\r?\n/)
        .filter((line) => /^[A-Z_]+=/.test(line))
        .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1).trim()]),
    );
  } catch {
    return {};
  }
}

// The environment (Docker) wins over backend/.env (local run).
const env: Record<string, string | undefined> = { ...backendEnv(), ...process.env };

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, strictPort: true },
  define: {
    __OWNER_EMAIL__: JSON.stringify(env.SEED_OWNER_EMAIL ?? ''),
    __OWNER_PASSWORD__: JSON.stringify(env.SEED_OWNER_PASSWORD ?? ''),
  },
});
