import { defineConfig, loadEnv } from 'vite';
import { resolve } from 'node:path';
import { createApp } from './server/app.js';

export const VALID_ENVS = ['production', 'development'];

export function resolveAppEnv(env = {}, mode = 'development') {
  const raw = env.ENV || env.env;
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

  for (const [k, v] of Object.entries(env)) {
    if (process.env[k] === undefined) {
      process.env[k] = v;
    }
  }

  return {
    base: './',
    envPrefix: ['VITE_', 'ENV', 'NEXT_PUBLIC_', 'CLERK_'],
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
          if (server.config.server.middlewareMode) return;
          const app = createApp({ ...env, ENV: appEnv, env: appEnv });
          server.middlewares.use(app);
        },
        configurePreviewServer(server) {
          const app = createApp({ ...env, ENV: appEnv, env: appEnv });
          server.middlewares.use(app);
        },
        async transformIndexHtml(html, ctx) {
          const path = ctx?.path || '';
          const filename = ctx?.filename || '';
          const dbUrl = process.env.DATABASE_URL || env.DATABASE_URL;
          const isProdBuild = mode === 'production' || appEnv === 'production';

          if (path.includes('404') || filename.includes('404') || html.includes('404')) {
            if (isProdBuild && dbUrl) {
              try {
                const { getGoogleTagIdFromDb } = await import('./server/uiTextsApi.js');
                const tagId = await getGoogleTagIdFromDb(dbUrl);
                if (tagId) {
                  const { injectGoogleTag } = await import('./server/ssr.js');
                  return injectGoogleTag(html, tagId);
                }
              } catch {}
            }
            return html;
          }

          if (!isProdBuild && !ctx?.req) {
            return html;
          }

          try {
            if (dbUrl) {
              const { getUiDataFromDb } = await import('./server/uiTextsApi.js');
              const { renderSsrHtml } = await import('./server/ssr.js');
              const { texts, prompts } = await getUiDataFromDb(dbUrl);
              if (texts && Object.keys(texts).length && prompts && prompts.length) {
                let user = null;
                if (ctx?.req) {
                  try {
                    const { authenticateClerkRequest } = await import('./server/clerkVerifier.js');
                    const auth = await authenticateClerkRequest(ctx.req, { ...env, ...process.env });
                    if (auth?.authenticated && auth.user) {
                      user = auth.user;
                    }
                  } catch {}
                }
                return renderSsrHtml({
                  htmlTemplate: html,
                  texts,
                  prompts,
                  serverEnv: { ...env, ...process.env, ENV: isProdBuild ? 'production' : appEnv },
                  user,
                });
              }
            }
          } catch {}
          return html;
        },
        async generateBundle(options, bundle) {
          const dbUrl = process.env.DATABASE_URL || env.DATABASE_URL;
          const isProdBuild = mode === 'production' || appEnv === 'production';
          let tagId = null;
          if (isProdBuild && dbUrl) {
            try {
              const { getGoogleTagIdFromDb } = await import('./server/uiTextsApi.js');
              tagId = await getGoogleTagIdFromDb(dbUrl);
            } catch {}
          }
          for (const [fileName, chunk] of Object.entries(bundle)) {
            if (fileName === '404.html' && chunk.type === 'asset' && typeof chunk.source === 'string') {
              let src = chunk.source.replace(/<link rel="stylesheet"[^>]*>/g, '');
              if (tagId) {
                const { injectGoogleTag } = await import('./server/ssr.js');
                src = injectGoogleTag(src, tagId);
              }
              chunk.source = src;
            }
          }
        },
      },
    ],
    build: {
      target: 'es2022',
      cssCodeSplit: false,
      sourcemap: false,
      assetsInlineLimit: 0,
      rollupOptions: {
        input: {
          main: resolve(process.cwd(), 'index.html'),
          404: resolve(process.cwd(), '404.html'),
        },
      },
    },
  };
});
