import { defineConfig } from 'vite';

// Compile the server and its internal source package together. Third-party
// dependencies stay external and are installed by npm workspaces at runtime.
export default defineConfig({
  root: import.meta.dirname,
  ssr: { noExternal: ['@card-game/engine', '@card-game/protocol'] },
  build: {
    ssr: 'src/index.ts',
    outDir: 'dist',
    emptyOutDir: true,
    target: 'node20',
    rolldownOptions: {
      output: { format: 'cjs', entryFileNames: 'index.js' },
    },
  },
});
