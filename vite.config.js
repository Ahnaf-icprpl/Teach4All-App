import { defineConfig, loadEnv } from 'vite';
import { createChatMiddleware } from './server/chatApi.js';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  if (env.REDIS_URL && !process.env.REDIS_URL) {
    process.env.REDIS_URL = env.REDIS_URL;
  }
  if (env.DATABASE_URL && !process.env.DATABASE_URL) {
    process.env.DATABASE_URL = env.DATABASE_URL;
  }
  if (env.OPENROUTER_API_KEY && !process.env.OPENROUTER_API_KEY) {
    process.env.OPENROUTER_API_KEY = env.OPENROUTER_API_KEY;
  }

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
