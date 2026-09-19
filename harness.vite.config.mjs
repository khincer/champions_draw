/* One-off harness build config. Temporary scaffolding: deleted after the run.
   Builds `frontend/harness/harness.html` into the OS temp dir so the repo's
   real `static/ui/` output is never touched. */
import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

const OUT = 'C:/Users/Usuario/AppData/Local/Temp/opencode/p2-harness';

export default defineConfig({
  root: 'frontend',
  plugins: [preact()],
  base: '/',
  build: {
    outDir: OUT,
    emptyOutDir: true,
    rollupOptions: { input: 'frontend/harness/harness.html' },
  },
  preview: { port: 4174, host: '127.0.0.1' },
});
