import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

export default defineConfig({
  root: 'frontend',
  plugins: [preact()],
  base: '/static/ui/',
  build: {
    outDir: '../static/ui',
    emptyOutDir: true,
  },
  server: {
    // Docker Desktop on Windows does not forward inotify events across a bind
    // mount, so the watcher never sees host edits even though the files do
    // change inside the container. Poll instead of listen. The cost is
    // negligible for a tree this size -- drop this if you only ever run the
    // dev server on the host, where native events work.
    watch: { usePolling: true, interval: 300 },
    proxy: {
      '/api': 'http://127.0.0.1:8001',
    },
  },
});
