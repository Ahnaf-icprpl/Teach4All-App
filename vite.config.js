import { defineConfig, loadEnv } from 'vite';
import { createChatMiddleware } from './server/chatApi.js';

export const VALID_ENVS = ['production', 'development'];

export function resolveAppEnv(env = {}, mode = 'development') {
  const raw = env.ENV || env.env || process.env.ENV || process.env.env;
  if (raw !== undefined && raw !== null && String(raw).trim() !== '') {
    const normalized = String(raw).trim().toLowerCase();
    if (!VALID_ENVS.includes(normalized)) {
      throw new Error(`Invalid env "${raw}". Only "production" or "development" is valid.`);
    }
    return normalized;
  }
  return mode === 'production' ? 'production' : 'development';
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const appEnv = resolveAppEnv(env, mode);

  process.env.ENV = appEnv;
  process.env.env = appEnv;

  if (env.REDIS_URL && !process.env.REDIS_URL) {
    process.env.REDIS_URL = env.REDIS_URL;
  }
  if (env.DATABASE_URL && !process.env.DATABASE_URL) {
    process.env.DATABASE_URL = env.DATABASE_URL;
  }
  if (env.OPENROUTER_API_KEY && !process.env.OPENROUTER_API_KEY) {
    process.env.OPENROUTER_API_KEY = env.OPENROUTER_API_KEY;
  }
  if (env.GRAFANA_API_KEY && !process.env.GRAFANA_API_KEY) {
    process.env.GRAFANA_API_KEY = env.GRAFANA_API_KEY;
  }
  if (env.GRAFANA_INSTANCE_ID && !process.env.GRAFANA_INSTANCE_ID) {
    process.env.GRAFANA_INSTANCE_ID = env.GRAFANA_INSTANCE_ID;
  }
  if (env.GRAFANA_OTLP_URL && !process.env.GRAFANA_OTLP_URL) {
    process.env.GRAFANA_OTLP_URL = env.GRAFANA_OTLP_URL;
  }

  return {
    base: './',
    envPrefix: ['VITE_', 'ENV'],
    define: {
      'import.meta.env.ENV': JSON.stringify(appEnv),
      'import.meta.env.env': JSON.stringify(appEnv),
      'process.env.ENV': JSON.stringify(appEnv),
      'process.env.env': JSON.stringify(appEnv),
    },
    plugins: [
      {
        name: 'openrouter-api-server',
        configureServer(server) {
          server.middlewares.use(createChatMiddleware({ ...env, ENV: appEnv, env: appEnv }));
        },
        configurePreviewServer(server) {
          server.middlewares.use(createChatMiddleware({ ...env, ENV: appEnv, env: appEnv }));
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
