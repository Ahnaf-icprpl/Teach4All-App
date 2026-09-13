# Migration Guide: Moving Teach4All Backend to Express.js

This document provides a comprehensive, production-tested roadmap for migrating the Teach4All backend from its current lightweight native Node HTTP middleware architecture to a full **Express.js** application.

---

## Table of Contents
1. [Why & When to Migrate](#1-why--when-to-migrate)
2. [Architectural Comparison](#2-architectural-comparison)
3. [The Zero-Regression Parity Contract](#3-the-zero-regression-parity-contract)
4. [Step-by-Step Implementation Guide](#4-step-by-step-implementation-guide)
   - [Step 1: Install Dependencies & Update Agent Rules](#step-1-install-dependencies--update-agent-rules)
   - [Step 2: Create the Core Express Application (`server/app.js`)](#step-2-create-the-core-express-application-serverappjs)
   - [Step 3: Route Modularization (`server/routes/`)](#step-3-route-modularization-serverroutes)
   - [Step 4: Connect Express to Vite Dev Server (`vite.config.js`)](#step-4-connect-express-to-vite-dev-server-viteconfigjs)
   - [Step 5: Deployment Configurations (Self-Hosted vs. Vercel)](#step-5-deployment-configurations-self-hosted-vs-vercel)
   - [Step 6: Update Automated Tests](#step-6-update-automated-tests)
   - [Step 7: Enforce Verification Gates](#step-7-enforce-verification-gates)
5. [Common Pitfalls & Express-Specific Quirks](#5-common-pitfalls--express-specific-quirks)
6. [Rollback Plan](#6-rollback-plan)

---

## 1. Why & When to Migrate

### Current State
Teach4All currently runs on zero runtime backend frameworks:
- **Local Dev / Preview**: Vite's built-in Connect server executes [`server/chatMiddleware.js`](./server/chatMiddleware.js).
- **Production (Vercel)**: Dedicated serverless function handlers reside in [`api/*.js`](./api/).
- **Handlers**: Native `(req, res)` handlers consuming Node standard library streams.

### When Migrating Makes Sense
Migrate to Express if and when:
1. **Moving from Serverless to a Persistent Host**: Deploying as a Docker container or long-running process on Railway, Render, Fly.io, AWS EC2, or a VPS.
2. **Advanced Middleware Needs**: Introducing complex route-level authentication chains (e.g. Passport.js, OAuth2), file upload multipart parsers (`multer`), or centralized OpenAPI/Swagger schema validation.
3. **Rapid Route Expansion**: If the number of API endpoints grows beyond 20+, Express's parametric routing (`/api/quizzes/:id`) avoids manual path matching.

---

## 2. Architectural Comparison

```
CURRENT (Serverless & Vite Connect):
  [ Browser Client ]
          │
          ├──> Local Dev:  Vite Dev Server ──> connect middleware (server/chatMiddleware.js)
          │                                            │
          └──> Production: Vercel Gateway  ──> api/*.js (10 separate lambdas)
                                                       │
                                                       ▼
                                         [ server/*Api.js Handlers ]
                                         (Native req/res streams)

AFTER (Unified Express Application):
  [ Browser Client ]
          │
          ├──> Local Dev:  Vite Dev Server ──> server.middlewares.use(expressApp)
          │                                            │
          ├──> Production VPS / Docker:      node server/index.js (expressApp.listen)
          │                                            │
          └──> Production Vercel:            api/index.js (single catch-all serverless)
                                                       │
                                                       ▼
                                            [ server/app.js ]
                                            - express.json()
                                            - OTLP Metrics & Logging
                                            - Rate Limiter Middleware
                                                       │
                                      ┌────────────────┼────────────────┐
                                      ▼                ▼                ▼
                                 routes/chat.js   routes/study.js  routes/history.js
```

---

## 3. The Zero-Regression Parity Contract

Any migration must strictly preserve the following behaviors:

1. **Zero Frontend Changes**:
   - All code in `src/` must remain completely untouched.
   - Endpoint paths (`/api/chat`, `/api/quizzes`, etc.) and payload schemas must remain identical.
2. **Real-time SSE Streaming**:
   - `/api/chat` streaming chunks (`text/event-stream; charset=utf-8`, `data: {"choices":...}\n\n`) must pipe with immediate flushing (no buffering).
3. **Header Sanitization**:
   - Remove `X-Powered-By: Express` using `app.disable('x-powered-by')`.
   - Preserve rate limit headers: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`, `Retry-After`.
4. **OTLP Telemetry & Grafana Logging**:
   - Every request duration, status code, IP, and user-agent must continue dispatching to Grafana Cloud via [`server/metrics.js`](./server/metrics.js) and [`server/logger.js`](./server/logger.js).
5. **File Size Budget**:
   - Per [`AGENTS.md`](./AGENTS.md), every `.js` and `.mjs` code file in `src/` and `server/` must strictly remain **under 500 lines**.

---

## 4. Step-by-Step Implementation Guide

### Step 1: Install Dependencies & Update Agent Rules

1. Install `express`:
   ```bash
   npm install express
   ```
2. Update [`AGENTS.md`](./AGENTS.md) under **No External Dependencies at Runtime**:
   ```markdown
   - The only allowed runtime dependencies are:
     - `vanjs-core` (frontend)
     - `pg` (PostgreSQL driver)
     - `express` (server-side HTTP framework)
   ```

---

### Step 2: Create the Core Express Application (`server/app.js`)

Create [`server/app.js`](./server/app.js) to configure the application, middleware, metrics, and error boundaries:

```javascript
import express from 'express';
import { getClientIp } from './rateLimiter.js';
import { logger } from './logger.js';
import { metrics } from './metrics.js';
import { chatRouter } from './routes/chatRoutes.js';
import { historyRouter } from './routes/historyRoutes.js';
import { studyRouter } from './routes/studyRoutes.js';
import { uiRouter } from './routes/uiRoutes.js';

export function createApp(serverEnv = {}) {
  const app = express();

  // 1. Security & Header Defaults
  app.disable('x-powered-by');
  app.set('query parser', 'simple');

  // 2. Request Body Parsing
  app.use(express.json({ limit: '500kb' }));

  // 3. Telemetry & Dev Logging Middleware
  app.use((req, res, next) => {
    const isDev = (serverEnv.ENV || serverEnv.env || process.env.ENV || '').toLowerCase() === 'development' || logger.isDev();
    const clientIp = getClientIp(req);
    const start = Date.now();
    const fullUrl = req.originalUrl || req.url || '/';
    const cleanUrl = fullUrl.split('?')[0];

    if (isDev) {
      logger.info(`Incoming ${req.method} ${fullUrl}`, {
        dev_trace: true,
        method: req.method,
        url: fullUrl,
        client_ip: clientIp,
        user_agent: req.headers['user-agent'] || '',
      });
    }

    const endTracking = metrics.startRequest({ endpoint: cleanUrl, method: req.method, req });

    res.on('finish', () => {
      const durationMs = Date.now() - start;
      endTracking();
      metrics.recordHttpRequest({ endpoint: cleanUrl, method: req.method, status: res.statusCode, durationMs, req, res });
      metrics.flush().catch(() => {});

      if (isDev || res.statusCode >= 400) {
        const level = res.statusCode >= 400 ? 'error' : 'info';
        logger[level](`Completed ${req.method} ${fullUrl} -> ${res.statusCode} (${durationMs}ms)`, {
          dev_trace: true,
          method: req.method,
          url: fullUrl,
          status: res.statusCode,
          duration_ms: durationMs,
          client_ip: clientIp,
        });
        logger.flush().catch(() => {});
      }
    });

    next();
  });

  // 4. Mount Domain API Routers
  app.use('/api', chatRouter(serverEnv));
  app.use('/api', historyRouter(serverEnv));
  app.use('/api', studyRouter(serverEnv));
  app.use('/api', uiRouter(serverEnv));

  // 5. 404 Handler for Unmatched API Routes
  app.all('/api/*', (req, res) => {
    res.status(404).json({ error: { message: `Route ${req.originalUrl} not found` } });
  });

  // 6. Global Centralized Error Boundary
  app.use((err, req, res, next) => {
    logger.error('Unhandled server error', { error: err.message, stack: err.stack, path: req.originalUrl });
    if (!res.headersSent) {
      res.status(err.status || 500).json({ error: { message: err.message || 'Internal server error.' } });
    }
  });

  return app;
}
```

---

### Step 3: Route Modularization (`server/routes/`)

Create dedicated router files inside `server/routes/` to keep each file below 200 lines:

#### 1. Chat & Title Router (`server/routes/chatRoutes.js`)
```javascript
import { Router } from 'express';
import { handleChatRequest } from '../chatApi.js';
import { handleTitleRequest } from '../titleApi.js';

export function chatRouter(serverEnv) {
  const router = Router();
  router.post('/chat', (req, res) => handleChatRequest(req, res, serverEnv));
  router.post('/title', (req, res) => handleTitleRequest(req, res, serverEnv));
  return router;
}
```
*(Notice: Because `handleChatRequest` already receives `(req, res)`, streaming with `res.write()` and SSE works with zero changes).*

#### 2. History Router (`server/routes/historyRoutes.js`)
```javascript
import { Router } from 'express';
import { handleConversationsRequest, handleMessagesRequest } from '../historyApi.js';

export function historyRouter(serverEnv) {
  const router = Router();
  router.all('/conversations', (req, res) => handleConversationsRequest(req, res, serverEnv));
  router.all('/messages', (req, res) => handleMessagesRequest(req, res, serverEnv));
  return router;
}
```

#### 3. Study Router (`server/routes/studyRoutes.js`)
```javascript
import { Router } from 'express';
import { handleQuizzesRequest } from '../quizzesApi.js';
import { handleMaterialsRequest } from '../materialsApi.js';

export function studyRouter(serverEnv) {
  const router = Router();
  router.all('/quizzes', (req, res) => handleQuizzesRequest(req, res, serverEnv));
  router.all('/materials', (req, res) => handleMaterialsRequest(req, res, serverEnv));
  return router;
}
```

#### 4. UI Texts & Telemetry Router (`server/routes/uiRoutes.js`)
```javascript
import { Router } from 'express';
import { handleUiTextsRequest, handleChatPromptsRequest } from '../uiTextsApi.js';
import { handleErrorLogRequest } from '../errorApi.js';

export function uiRouter(serverEnv) {
  const router = Router();
  router.get('/ui-texts', (req, res) => handleUiTextsRequest(req, res, serverEnv));
  router.get('/chat-prompts', (req, res) => handleChatPromptsRequest(req, res, serverEnv));
  router.post('/log-error', (req, res) => handleErrorLogRequest(req, res, serverEnv));
  return router;
}
```

---

### Step 4: Connect Express to Vite Dev Server (`vite.config.js`)

Express apps are callable `(req, res, next)` functions under the hood. You can mount `createApp(env)` directly into Vite:

In [`vite.config.js`](./vite.config.js):
```javascript
import { createApp } from './server/app.js';

// Inside plugins -> openrouter-api-server:
configureServer(server) {
  const app = createApp({ ...env, ENV: appEnv, env: appEnv });
  server.middlewares.use(app);
},
configurePreviewServer(server) {
  const app = createApp({ ...env, ENV: appEnv, env: appEnv });
  server.middlewares.use(app);
}
```

---

### Step 5: Deployment Configurations (Self-Hosted vs. Vercel)

#### Deployment Mode A: Standalone Persistent Server (Docker / VPS / Railway)
Create [`server/index.js`](./server/index.js) as the production entry point:

```javascript
import express from 'express';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { createApp } from './app.js';
import { handleSsrRequest, load404HtmlTemplate } from './ssr.js';
import { logger } from './logger.js';

const app = createApp(process.env);
const port = process.env.PORT || 3000;
const distPath = resolve(process.cwd(), 'dist');

// Serve compiled static assets
if (existsSync(distPath)) {
  app.use(express.static(distPath, { index: false }));
}

// Serve SSR HTML for entry pages
app.get(['/', '/index.html'], (req, res) => handleSsrRequest(req, res));

// 404 Fallback
app.use((req, res) => {
  res.status(404).type('text/html; charset=utf-8').send(load404HtmlTemplate());
});

app.listen(port, '0.0.0.0', () => {
  logger.info(`Teach4All Express server listening on http://0.0.0.0:${port}`);
});
```

Add a `start` script in [`package.json`](./package.json):
```json
"scripts": {
  "start": "node server/index.js"
}
```

#### Deployment Mode B: Vercel Serverless Function
If continuing to host on Vercel, forward all requests to a single Express handler:

1. Create [`api/index.js`](./api/index.js):
   ```javascript
   import { createApp } from '../server/app.js';
   const app = createApp(process.env);
   export default app;
   ```
2. Update [`vercel.json`](./vercel.json):
   ```json
   {
     "rewrites": [
       { "source": "/api/(.*)", "destination": "/api/index.js" },
       { "source": "/", "destination": "/api/ssr" },
       { "source": "/index.html", "destination": "/api/ssr" },
       { "source": "/((?!assets/|icon\\.svg|manifest\\.webmanifest|sw\\.js).*)", "destination": "/api/ssr" }
     ]
   }
   ```

---

### Step 6: Update Automated Tests

In [`tests/router.test.mjs`](./tests/router.test.mjs) and [`tests/quizzes-materials.test.mjs`](./tests/quizzes-materials.test.mjs):
- Existing tests use mock `(req, res)` `EventEmitter` streams.
- You can either test the Express app directly by listening on an ephemeral port:
  ```javascript
  import { createApp } from '../server/app.js';
  import http from 'node:http';

  const app = createApp(process.env);
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;

  const res = await fetch(`http://localhost:${port}/api/quizzes`);
  assert.strictEqual(res.status, 200);
  server.close();
  ```
- Or pass the mock `req` and `res` objects directly to `app(req, res)`.

---

### Step 7: Enforce Verification Gates

Before merging the Express migration:

1. **File Line Limits**:
   ```bash
   npm run check
   ```
   Ensure `server/app.js` and all `server/routes/*.js` files are well below 500 lines.
2. **Run Full Test Suite**:
   ```bash
   npm test
   ```
   Verify that all 87+ tests pass.
3. **Production Build**:
   ```bash
   npm run build
   ```
   Ensure Vite compiles `dist/` and the service worker generates cleanly without asset path discrepancies.

---

## 5. Common Pitfalls & Express-Specific Quirks

1. **Buffering SSE Chat Streams**:
   - Some Express compression or middleware buffers chunks before writing.
   - Always verify that `/api/chat` calls `res.flushHeaders()` and that no compression middleware wraps `/api/chat`.
2. **`req.body` Consumption**:
   - `express.json()` reads the body stream into `req.body`.
   - If legacy handlers call custom `readBody(req)` functions, remove `readBody(req)` and use `req.body` directly, otherwise `req.on('data')` will hang because the stream was already consumed.
3. **Double Header Flushes**:
   - If a handler calls `res.writeHead()` and Express later calls `res.status()`, Node throws `ERR_HTTP_HEADERS_SENT`. Ensure handlers check `if (!res.headersSent)`.

---

## 6. Rollback Plan

If regressions occur in production:
1. Revert the git commit:
   ```bash
   git revert HEAD -m 1
   ```
2. Reinstall original dependencies:
   ```bash
   npm install
   ```
3. Re-verify the baseline:
   ```bash
   npm run check && npm test && npm run build
   ```
