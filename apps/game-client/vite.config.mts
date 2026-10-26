import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// Vite config for the React game client.
// The client imports only the protocol package.
// The production client is built independently; Express serves this dist folder.
export default defineConfig({
  plugins: [react()],
  root: path.resolve(import.meta.dirname),
  resolve: {
    alias: {
      '@card-game/protocol': path.resolve(import.meta.dirname, '../../packages/protocol/src/index.ts'),
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
