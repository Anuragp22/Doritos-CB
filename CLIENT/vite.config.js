import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  // Inotify events do not propagate from Windows hosts into Linux Docker
  // bind-mounts, so the file watcher never fires. Polling is the only
  // reliable way for HMR to detect host edits in this setup.
  server: {
    watch: {
      usePolling: true,
      interval: 300,
    },
  },
});
