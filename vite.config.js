import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  envPrefix: ['VITE_', 'OPENROUTER_'],
  build: {
    target: 'es2022',
    cssCodeSplit: false,
    sourcemap: false,
    assetsInlineLimit: 0,
  },
});
