import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// Vite config for the React game client.
// The client lives in apps/game-client/ and imports engine sources from
// packages/engine/src/ via aliases. Vite bundles them directly.
// The production client is built independently; Express serves this dist folder.
export default defineConfig({
  plugins: [react()],
  root: path.resolve(import.meta.dirname),
  resolve: {
    alias: {
      '@shared': path.resolve(import.meta.dirname, '../../packages/engine/src/types'),
      '@engine': path.resolve(import.meta.dirname, '../../packages/engine/src/engine'),
      '@rules': path.resolve(import.meta.dirname, '../../packages/engine/src/shared'),
      '@library': path.resolve(import.meta.dirname, '../../packages/engine/src/library'),
      '@config': path.resolve(import.meta.dirname, '../../packages/engine/src/config'),
    },
  },
  build: {
    outDir: path.resolve(import.meta.dirname, 'dist'),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      // Proxy Socket.IO to the game server during dev
      '/socket.io': {
        target: 'http://localhost:3000',
        ws: true,
      },
    },
  },
});
