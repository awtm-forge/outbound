import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// Dev: the core runs on 8095 and this proxies the API to it, so the session cookie stays same-origin.
export default defineConfig({
  plugins: [react()],
  server: { port: 5199, proxy: { '/api': 'http://localhost:8095', '/auth': 'http://localhost:8095', '/health': 'http://localhost:8095' } },
  build: { outDir: 'dist', emptyOutDir: true, sourcemap: false },
});
