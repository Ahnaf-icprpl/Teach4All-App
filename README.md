<div align="center">

<img src="public/logo.png" alt="Teach4All Logo" width="88" height="88" />

# Teach4All

**Online-first educational platform combining AI tutoring, interactive quizzes, and structured study modules.**

[![CI Checks](https://img.shields.io/github/actions/workflow/status/Ahnaf-icprpl/Teach4All-App/checks.yml?branch=main&style=for-the-badge&logo=github&label=CI%20Checks)](https://github.com/Ahnaf-icprpl/Teach4All-App/actions/workflows/checks.yml)
[![Node.js](https://img.shields.io/badge/Node.js-22.12+-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![VanJS](https://img.shields.io/badge/VanJS-1.6.1-F38B00?style=for-the-badge&logo=javascript&logoColor=white)](https://vanjs.org/)
[![Express](https://img.shields.io/badge/Express-5.2-000000?style=for-the-badge&logo=express&logoColor=white)](https://expressjs.com/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-14+-4169E1?style=for-the-badge&logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Clerk](https://img.shields.io/badge/Clerk-Auth-6C47FF?style=for-the-badge&logo=clerk&logoColor=white)](https://clerk.com/)
[![OpenTelemetry](https://img.shields.io/badge/OpenTelemetry-OTLP-7F52FF?style=for-the-badge&logo=opentelemetry&logoColor=white)](https://opentelemetry.io/)
[![Code Limit](https://img.shields.io/badge/Code%20Limit-%3C500%20lines-informational?style=for-the-badge)](#architecture-and-rules)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue?style=for-the-badge)](LICENSE)

</div>

Teach4All is an online educational application that combines AI tutoring, interactive quizzes, and structured study modules. The client runs on VanJS without virtual DOM or component frameworks. The backend uses Node.js, Express, PostgreSQL, and Clerk authentication.

## Features

- Streaming AI tutor powered by OpenRouter models with optional web search.
- Interactive multiple-choice quizzes with instant evaluation, explanations, score calculations, and clue assistance.
- Multi-section study materials with progress tracking.
- Full UI localization stored in PostgreSQL (`ui_texts` table) and hydrated on load.
- UI state persistence across page reloads (active chat, draft message, sidebar state, open quiz/material modal, question index, section index).
- Server-side rendering (SSR) for initial HTML paint and state hydration.
- Sliding-window rate limiting per IP address and per user account in PostgreSQL.
- Clerk authentication with native Node.js crypto JWKS token verification and automatic guest session isolation.
- OpenTelemetry instrumentation for traces, metrics, and logs with optional Grafana Cloud export.

## Tech Stack

| Layer | Technology | Version | Purpose |
|---|---|---|---|
| Frontend | VanJS | 1.6.1 | Reactive DOM rendering without a virtual DOM |
| Styling | Custom CSS | - | CSS custom properties, responsive layout, light and dark themes |
| Backend | Node.js / Express | 22 / 5.2 | HTTP routing, SSR rendering, and REST endpoints |
| Database | PostgreSQL (`pg`) | 14+ / 8.23 | Relational storage for users, chats, quizzes, materials, UI texts, and rate limits |
| Auth | Clerk | - | OAuth and session verification via native crypto JWKS |
| AI | OpenRouter | - | Server-Sent Events (SSE) streaming chat completions |
| Observability | OpenTelemetry | 1.9+ / 0.222 | Distributed traces, Prometheus metrics, and Loki log exports |
| Bundler | Vite | 8.3 | Client asset bundling and development middleware |
| Testing | Playwright & Node Test Runner | 1.63 / Node 22 | Browser end-to-end tests and API integration tests |

## Architecture and Rules

Teach4All follows explicit engineering constraints defined in `AGENTS.md`:

- **Code line limits**: Every application code file (`.js`, `.mjs`, `.cjs`, `.css`) in `src/`, `server/`, `prompts/`, and `scripts/` must stay below 500 lines. The `npm run check` script verifies this rule.
- **First principles UI**: Build elements with native HTML tags via `van.tags`. No React, Vue, Svelte, or UI component libraries.
- **Custom styling**: Write plain CSS. Do not use Tailwind, Bootstrap, or utility frameworks. CSS nesting is limited to two levels.
- **Runtime dependencies**: Production dependencies are strictly limited to `vanjs-core`, `express`, `pg`, and `@opentelemetry` SDK packages. No external CDN scripts, stylesheets, or remote fonts run in production.
- **Online-first**: All completions, quizzes, materials, and search queries resolve directly through backend APIs without service worker interception.

## Repository Structure

```
.
├── migrations/          # Numbered SQL migration files (001 - 045)
├── prompts/             # System and title generation prompts
├── public/              # Static assets (logo, icons, manifest)
├── scripts/             # Build and maintenance scripts
│   ├── check.mjs        # Enforces 500-line code limit
│   └── migrate.mjs      # Runs database migrations in sequence
├── server/              # Express backend
│   ├── routes/          # API sub-routers (auth, chat, history, study, ui)
│   ├── app.js           # Express app setup and middleware
│   ├── clerkVerifier.js # Native Node.js crypto JWKS token verification
│   ├── db.js            # PostgreSQL pool and repository queries
│   ├── dev.js           # Development server with Vite middleware
│   ├── index.js         # Production server entry point
│   ├── rateLimiter.js   # Sliding-window rate limiter
│   └── ssr.js           # Server-side HTML template renderer
├── src/                 # VanJS client application
│   ├── components/      # UI components (chat, sidebar, dialogs, quiz, material)
│   ├── styles/          # Modular CSS files
│   ├── auth.js          # Client auth state machine
│   ├── chatStore.js     # Chat state, search, and message loaders
│   ├── main.js          # App mount point and skip-link setup
│   ├── state.js         # Reactive state and UI persistence
│   ├── storage.js       # LocalStorage and IndexedDB helpers
│   ├── studyModules.js  # Quiz and material progress management
│   └── uiTexts.js       # Dynamic UI text store
├── tests/               # Playwright E2E and Node test runner suites
├── AGENTS.md            # Project rules and engineering constraints
├── Dockerfile           # Multi-stage production container build
├── docker-compose.yml   # Container orchestration configuration
└── package.json         # Dependencies and scripts
```

## Getting Started

### Prerequisites

- Node.js 22.12.0 or higher
- PostgreSQL 14 or higher
- OpenRouter API key
- Clerk account (publishable key and secret key)

### Installation

1. Clone the repository:

   ```bash
   git clone https://github.com/Ahnaf-icprpl/Teach4All-App.git
   cd Teach4All-App
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Configure environment variables:

   ```bash
   cp .env.example .env
   ```

   Fill in your PostgreSQL connection string, Clerk keys, and OpenRouter API key in `.env`.

4. Run database migrations:

   ```bash
   npm run migrate
   ```

5. Start the development server:

   ```bash
   npm run dev
   ```

   Open `http://localhost:3000` in your browser.

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `ENV` | Yes | `development` | Application mode (`production`, `staging`, `development`) |
| `PORT` | No | `3000` | HTTP port for the Express server |
| `DATABASE_URL` | Yes | - | PostgreSQL connection URL |
| `OPENROUTER_API_KEY` | Yes | - | API key for OpenRouter completion requests |
| `OPENROUTER_MODEL` | No | `google/gemini-2.5-flash-lite` | LLM model identifier |
| `CLERK_PUBLISHABLE_KEY` | Yes | - | Clerk publishable key (`pk_test_...` or `pk_live_...`) |
| `CLERK_SECRET_KEY` | Yes | - | Clerk secret key (`sk_test_...` or `sk_live_...`) |
| `CLERK_FRONTEND_API` | No | Derived | Clerk frontend API URL |
| `CLERK_ACCOUNTS_URL` | No | - | Clerk accounts portal URL |
| `GRAFANA_OTEL_API_KEY` | No | - | Grafana Cloud OTLP token for traces, metrics, and logs |
| `OTEL_SERVICE_NAME` | No | `teach4all` | OpenTelemetry service identification name |
| `LOG_LEVEL` | No | `info` | Logging verbosity (`debug`, `info`, `warn`, `error`) |

## Available Scripts

| Command | Description |
|---|---|
| `npm run dev` | Starts dev server with Vite middleware, file watching, and OpenTelemetry |
| `npm run build` | Validates file size limits and compiles client assets with Vite |
| `npm start` | Launches the production Express server on port 3000 |
| `npm run check` | Checks that all application code files stay under 500 lines |
| `npm run migrate` | Executes pending SQL migrations in `migrations/` |
| `npm run preview` | Serves the production build locally with Vite |
| `npm test` | Runs Node.js native unit and integration tests |
| `npm run test:api` | Runs API endpoint and rate limiter tests |
| `npm run test:e2e` | Runs Playwright browser end-to-end tests |

## Production Deployment

### Native Node.js

```bash
# 1. Run check and compile client assets
npm run build

# 2. Apply pending database migrations
npm run migrate

# 3. Start the production server
NODE_ENV=production npm start
```

### Docker

```bash
# Build the container image
docker build -t teach4all .

# Run the container
docker run -d \
  --name teach4all \
  -p 3000:3000 \
  --env-file .env \
  --restart unless-stopped \
  teach4all
```

### Docker Compose

```bash
docker compose up -d
```

## License

This project is licensed under the [MIT License](LICENSE).
