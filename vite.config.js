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
    proxy: {
      '/api': 'http://127.0.0.1:8001',
    },
  },
});
