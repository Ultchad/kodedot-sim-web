import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { CSP_DEV, CSP_PROD } from './csp.mjs';

// Cross-origin isolation is required by the WebAssembly runtime (pthreads => SharedArrayBuffer).
// Same headers as vercel.json, which also carries the CSP.
const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { headers: { ...isolation, 'Content-Security-Policy': CSP_DEV } },
  preview: { headers: { ...isolation, 'Content-Security-Policy': CSP_PROD } },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
