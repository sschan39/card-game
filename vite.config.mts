import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// Vite config for the React client.
// The client lives in src/client/ but imports shared types from src/types/
// and src/engine/ as source. Vite bundles them directly.
export default defineConfig({
  plugins: [react()],
  root: path.resolve(import.meta.dirname, 'src/client'),
  resolve: {
    alias: {
      '@shared': path.resolve(import.meta.dirname, 'src/types'),
      '@engine': path.resolve(import.meta.dirname, 'src/engine'),
    },
  },
  build: {
    outDir: path.resolve(import.meta.dirname, 'dist/client'),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      // Proxy Socket.IO + API to the game server during dev
      '/socket.io': {
        target: 'http://localhost:3000',
        ws: true,
      },
    },
  },
});
