import './instrumentation.js';
import { resolve } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import { createServer as createViteServer } from 'vite';
import { createApp } from './app.js';
import { getUiDataFromDb, getUiTextsFromDb, getChatPromptsFromDb } from './uiTextsApi.js';
import { authenticateClerkRequest } from './clerkVerifier.js';
import { renderSsrHtml, load404HtmlTemplate } from './ssr.js';

try {
  if (typeof process.loadEnvFile === 'function') {
    process.loadEnvFile();
  }
} catch {}

const serverEnv = { ...process.env, ENV: 'development', env: 'development' };
const app = createApp(serverEnv);

// Create Vite server in middleware mode
const vite = await createViteServer({
  server: {
    middlewareMode: true,
  },
  appType: 'custom',
});

// Use Vite's connect instance as middleware (handles /src/*, /@vite/client, HMR websockets)
app.use(vite.middlewares);

// SSR HTML handler for entry page in dev mode
app.get(['/', '/index.html'], async (req, res, next) => {
  const url = req.originalUrl || req.url || '/';
  const dbUrl = serverEnv.DATABASE_URL;

  try {
    const indexPath = resolve(process.cwd(), 'index.html');
    if (!existsSync(indexPath)) {
      res.status(500).type('text/plain').send('index.html not found');
      return;
    }

    const rawTemplate = readFileSync(indexPath, 'utf8');
    const transformedHtml = await vite.transformIndexHtml(url, rawTemplate);

    let texts = null;
    let prompts = null;
    let user = null;

    if (dbUrl) {
      try {
        const uiData = await getUiDataFromDb(dbUrl);
        texts = uiData.texts;
        prompts = uiData.prompts;
      } catch (err) {
        console.warn('[Dev Server] Failed loading UI texts/prompts from DB:', err.message);
      }

      try {
        const auth = await authenticateClerkRequest(req, serverEnv);
        if (auth?.authenticated && auth.user) {
          user = auth.user;
        }
      } catch {}
    }

    if (texts && Object.keys(texts).length && prompts && prompts.length) {
      const rendered = renderSsrHtml({
        htmlTemplate: transformedHtml,
        texts,
        prompts,
        serverEnv,
        user,
      });
      res.status(200).type('text/html; charset=utf-8').send(rendered);
    } else {
      // Fallback to transformed client HTML if DB not ready
      res.status(200).type('text/html; charset=utf-8').send(transformedHtml);
    }
  } catch (err) {
    vite.ssrFixStacktrace(err);
    next(err);
  }
});

// 404 Fallback
app.use((req, res) => {
  res.status(404).type('text/html; charset=utf-8').send(load404HtmlTemplate({ serverEnv }));
});

const defaultPort = Number(process.env.PORT) || 3000;
const host = '0.0.0.0';

function listenWithPortFallback(expressApp, startPort, maxTries = 10) {
  return new Promise((resolvePromise, rejectPromise) => {
    let port = startPort;
    let tries = 0;

    function attempt() {
      const server = expressApp.listen(port, host);
      server.on('listening', () => {
        console.log(`\n  🚀 Teach4All Full-Stack Dev Server ready:`);
        console.log(`  ➜  Local:   http://localhost:${port}/`);
        console.log(`  ➜  Network: http://${host}:${port}/`);
        console.log(`  ➜  Metrics: http://localhost:${port}/metrics\n`);
        resolvePromise({ server, port });
      });
      server.on('error', (err) => {
        if (err.code === 'EADDRINUSE' && tries < maxTries) {
          tries++;
          console.warn(`[Dev Server] Port ${port} is in use, attempting ${port + 1}...`);
          port++;
          attempt();
        } else {
          rejectPromise(err);
        }
      });
    }

    attempt();
  });
}

await listenWithPortFallback(app, defaultPort);
