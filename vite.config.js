import { defineConfig, loadEnv } from 'vite';
import { createChatMiddleware } from './server/chatApi.js';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  return {
    base: './',
    envPrefix: ['VITE_'],
    plugins: [
      {
        name: 'openrouter-api-server',
        configureServer(server) {
          server.middlewares.use(createChatMiddleware(env));
        },
        configurePreviewServer(server) {
          server.middlewares.use(createChatMiddleware(env));
        },
      },
    ],
    build: {
      target: 'es2022',
      cssCodeSplit: false,
      sourcemap: false,
      assetsInlineLimit: 0,
    },
  };
});
