import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: import.meta.dirname, base: '/admin/', plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true },
  server: { port: 5174, strictPort: true, proxy: { '/api': { target: 'http://localhost:3000' } } },
});
