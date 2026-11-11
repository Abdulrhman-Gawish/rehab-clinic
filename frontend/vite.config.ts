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

// QUICK_LOGIN=false: no quick-login buttons, and no credentials in the bundle.
const quickLogin = env.QUICK_LOGIN !== 'false';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    // Any Cloudflare Quick Tunnel address (it changes every time cloudflared starts).
    allowedHosts: ['.trycloudflare.com'],
    // The browser calls the API on /api/v1 of the address it opened (localhost or the tunnel), and Vite forwards it
    // to the backend: one tunnel, no CORS, and the HttpOnly auth cookies are same-origin.
    proxy: { '/api': env.API_PROXY_TARGET ?? 'http://localhost:3000' },
  },
  define: {
    __QUICK_LOGIN__: JSON.stringify(quickLogin),
    __OWNER_EMAIL__: JSON.stringify(quickLogin ? (env.SEED_OWNER_EMAIL ?? '') : ''),
    __OWNER_PASSWORD__: JSON.stringify(quickLogin ? (env.SEED_OWNER_PASSWORD ?? '') : ''),
  },
});
