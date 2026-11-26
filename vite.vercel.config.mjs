import dockerConfig from './vite.config.mjs';

export default {
  ...dockerConfig,
  base: '/',
  build: { ...dockerConfig.build, outDir: '../dist' },
};
