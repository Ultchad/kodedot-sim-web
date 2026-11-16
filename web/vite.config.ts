import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Cross-origin isolation is required later by the WebAssembly runtime
// (pthreads => SharedArrayBuffer). Same headers as vercel.json.
const isolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { headers: isolationHeaders },
  preview: { headers: isolationHeaders },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
