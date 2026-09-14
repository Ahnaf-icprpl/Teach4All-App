# Teach4All — Lightweight, Offline-First AI Learning Platform

[![Node.js](https://img.shields.io/badge/node->=22.12.0-brightgreen.svg)](https://nodejs.org/)
[![VanJS](https://img.shields.io/badge/frontend-VanJS_1.6-F38B00.svg)](https://vanjs.org/)
[![Express](https://img.shields.io/badge/backend-Express_5-000000.svg)](https://expressjs.com/)
[![PostgreSQL](https://img.shields.io/badge/database-PostgreSQL-336791.svg)](https://www.postgresql.org/)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Teach4All is a lightweight, offline-first educational platform designed to empower learners even under the most challenging network conditions—from remote rural classrooms to mobile connections with intermittent coverage.

Built strictly from first principles with **VanJS**, hand-crafted CSS, an **Express** backend, **PostgreSQL** persistence, and **OpenRouter** AI streaming, the application delivers a resilient, responsive learning experience without heavy UI libraries, external runtime dependencies, or remote fonts.

---

## Key Features

- **Streaming AI Learning Companion**: Real-time streaming conversational assistant powered by OpenRouter (e.g. Gemini 2.5 Flash Lite) with automated chat naming, markdown formatting, and code copying.
- **Interactive Quizzes**: Auto-evaluating multiple-choice quizzes with instant feedback, detailed answer rationales, score tracking, and status persistence.
- **Structured Study Materials**: Multi-part structured summaries and reading modules with interactive navigation and completion tracking.
- **User Data Isolation**: Strict user-level segregation for chats, quizzes, and materials. Authenticated users access their personal cloud workspace; guests work in isolated local sessions with zero cross-session leakage.
- **Clerk Authentication**: Dynamic single sign-on supporting Google OAuth and email. Features zero-downtime JWKS public key verification, sub-domain support, clock skew tolerance, and robust PostgreSQL profile synchronization.
- **Server-Side Rendering (SSR)**: Instant initial paint with pre-rendered shell, localized Indonesian UI text, prompt suggestions, and server-hydrated user state.
- **Offline-First PWA**: Service Worker caching for instant offline boots, LocalStorage fallback persistence, and background sync resilience.
- **Dynamic Sliding-Window Rate Limiting**: PostgreSQL-backed IP and user sliding-window rate limiters across all API routes (`/api/chat`, `/api/auth/*`, `/api/conversations`, etc.) to protect against abuse.
- **Lightweight & Self-Hosted**: Zero runtime UI frameworks, no tracking scripts, system fonts only, optimized for persistent VPS deployment with Docker.

---

## Technology Stack

| Layer | Technology | Purpose |
|---|---|---|
| **Frontend UI** | [VanJS](https://vanjs.org/) (1.6) | 1.0 KB reactive UI framework with zero virtual DOM overhead |
| **Styling** | Hand-crafted CSS | Custom variables, fluid responsive layouts, dark/light themes |
| **Backend** | [Express](https://expressjs.com/) (5.2) | Standalone HTTP server, SSR engine, and RESTful API endpoints |
| **Database** | [PostgreSQL](https://www.postgresql.org/) (`pg` driver) | Relational storage for users, chats, quizzes, materials, and rate limits |
| **Authentication** | [Clerk](https://clerk.com/) | Custom domain OAuth & JWT auth with node:crypto JWKS verifier |
| **AI Streaming** | [OpenRouter](https://openrouter.ai/) | Server-Sent Events (SSE) streaming completion engine |
| **Build & Tooling** | [Vite](https://vitejs.dev/) | Client bundling and asset hashing |
| **Containerization**| [Docker](https://www.docker.com/) | Multi-stage production container build with health checks |

---

## Repository Architecture

```
Teach4All-App/
├── index.html                  # Root SSR entry template
├── 404.html                    # Root SSR 404 template
├── Dockerfile                  # Multi-stage production container build
├── docker-compose.yml          # Standalone Docker Compose deployment
├── package.json                # Project dependencies and npm scripts
├── vite.config.js              # Vite bundler and development SSR middleware
├── migrations/                 # PostgreSQL migration scripts (001 - 035+)
│   ├── 001_initial_rate_limits.sql
│   ├── 005_create_conversations_and_messages.sql
│   ├── 011_create_quizzes_and_materials_tables.sql
│   └── 035_alter_users_username_nullable.sql
├── prompts/                    # AI System prompts and guidelines
│   └── chat.txt                # Teach4All pedagogical system prompt
├── scripts/                    # Build, migration, and verification tools
│   ├── build-sw.mjs            # Service worker cache manifest generator
│   ├── check.mjs               # 500-line file size enforcement script
│   └── migrate.mjs             # Database schema migration runner
├── server/                     # Backend Express server and API layer
│   ├── index.js                # Server entry point (starts Express listener)
│   ├── app.js                  # App factory, middleware, and route mounting
│   ├── ssr.js                  # SSR HTML renderer and initial state hydrator
│   ├── clerkVerifier.js        # Native node:crypto JWKS JWT & session verifier
│   ├── authApi.js              # Auth endpoints (/api/whoami, /api/auth/*)
│   ├── chatApi.js              # OpenRouter SSE streaming handler
│   ├── db.js / dbCore.js       # PostgreSQL client pool and repository queries
│   ├── rateLimiter.js          # Sliding-window IP & user rate limiter
│   └── routes/                 # Domain routers (auth, chat, history, study, ui)
└── src/                        # Client-side VanJS application
    ├── main.js                 # Client bootstrap and reactive DOM mounting
    ├── auth.js                 # Client auth state machine and handshake parser
    ├── state.js                # Global reactive state (chats, theme, toast)
    ├── api.js                  # Fetch wrapper with guest/auth token headers
    ├── uiTexts.js              # Reactive UI localization lookup
    ├── icons.js                # Raw inline SVG icon components
    ├── components/             # VanJS interactive components
    │   ├── chat.js             # Chat history stage and message composer
    │   ├── sidebar.js          # Navigation, search, and user profile menu
    │   └── dialogs.js          # Quizzes, study materials, and export modals
    └── styles/                 # Pure CSS modular stylesheets
        ├── base.css            # Custom properties, reset, typography
        ├── chat.css            # Conversation layout, bubbles, composer
        ├── sidebar.css         # Sidebar drawer and profile styling
        └── dialogs.css         # Modal overlays and card layouts
```

---

## Environment Configuration

Create a `.env` file in the root directory:

```env
# Application Environment ('production' | 'development')
ENV=development

# Server Port (default: 3000)
PORT=3000

# OpenRouter AI Configuration
OPENROUTER_API_KEY=your_openrouter_api_key_here
OPENROUTER_MODEL=google/gemini-2.5-flash-lite

# PostgreSQL Database Connection
DATABASE_URL=postgresql://username:password@localhost:5432/teach4all

# Clerk Authentication Configuration
CLERK_PUBLISHABLE_KEY=pk_test_your_publishable_key
CLERK_SECRET_KEY=sk_test_your_secret_key
CLERK_FRONTEND_API=https://your-app.clerk.accounts.dev
CLERK_ACCOUNTS_URL=https://your-app.accounts.dev

# Prometheus Metrics Scrape Authentication (Optional)
PROMETHEUS_METRICS_TOKEN=your_secure_metrics_bearer_token
METRICS_USER=prometheus
METRICS_PASSWORD=your_secure_metrics_password
```

### Configuration Parameters

| Variable | Required | Description |
|---|---|---|
| `ENV` | Yes | Controls SSR caching and error detail (`production` or `development`) |
| `PORT` | No | Port for Express server (default: `3000`) |
| `OPENROUTER_API_KEY` | Yes | API key from [OpenRouter](https://openrouter.ai/keys) for streaming completions |
| `OPENROUTER_MODEL` | No | Model identifier (defaults to `google/gemini-2.5-flash-lite`) |
| `DATABASE_URL` | Yes | PostgreSQL connection string (supports SSL/connection poolers) |
| `CLERK_PUBLISHABLE_KEY` | Yes | Clerk publishable key (`pk_test_...` or `pk_live_...`) |
| `CLERK_SECRET_KEY` | Yes | Clerk secret key (`sk_test_...` or `sk_live_...`) |
| `CLERK_FRONTEND_API` | No | Custom domain or frontend API host (auto-derived if omitted) |
| `CLERK_ACCOUNTS_URL` | No | Clerk hosted accounts URL for `/sign-in` and `/user` profiles |
| `PROMETHEUS_METRICS_TOKEN` | No | Secret Bearer token for authenticating Prometheus `/metrics` scrapes |
| `METRICS_USER` | No | HTTP Basic Auth username for `/metrics` scraping |
| `METRICS_PASSWORD` | No | HTTP Basic Auth password for `/metrics` scraping |

---

## Quick Start (Local Development)

### 1. Prerequisites
- **Node.js**: `v22.12.0` or higher
- **PostgreSQL**: `v14` or higher (or cloud provider like Supabase/Neon)

### 2. Installation & Setup
```bash
# Clone the repository
git clone https://github.com/Ahnaf-icprpl/Teach4All-App.git
cd Teach4All-App

# Install dependencies
npm install

# Copy environment template and configure values
cp .env.example .env
```

### 3. Run Database Migrations
```bash
npm run migrate
```

### 4. Start Development Server
```bash
# Starts Vite dev server with integrated Express middleware on http://localhost:5173
npm run dev
```

---

## Production Deployment

### Option A: Standalone Node.js Process on VPS

```bash
# 1. Enforce file limits and compile production assets
npm run build

# 2. Run schema migrations
npm run migrate

# 3. Start production server
npm start
```
The server listens on `http://0.0.0.0:${PORT:-3000}`. Configure Nginx or Caddy as a reverse proxy with TLS.

### Option B: Docker Deployment

```bash
# Build multi-stage Docker image
docker build -t teach4all .

# Run standalone container with environment file
docker run -d \
  --name teach4all-app \
  -p 3000:3000 \
  --env-file .env \
  --restart unless-stopped \
  teach4all
```

### Option C: Docker Compose

```bash
docker compose up -d
```

---

## NPM Scripts

| Command | Action |
|---|---|
| `npm run dev` | Starts Vite development server on `http://0.0.0.0:5173` with HMR |
| `npm run build` | Runs check, compiles Vite assets, and builds Service Worker |
| `npm start` | Launches production Express server on `http://0.0.0.0:3000` |
| `npm run preview` | Previews the compiled `dist/` directory locally |
| `npm run check` | Validates that **all** application code files remain below 500 lines |
| `npm run migrate` | Executes pending PostgreSQL migrations in order |
| `npm test` | Runs Node.js native unit/integration tests |
| `npm run test:e2e` | Runs Playwright browser end-to-end tests |

---

## Architectural Principles

### 1. Build From First Principles
- **No UI Libraries**: All components are constructed using native DOM tags via VanJS (`div`, `button`, `svg`, `article`, etc.).
- **Hand-Crafted CSS**: Modular CSS with variables in `:root`. No utility frameworks (Tailwind, Bootstrap). Nesting depth is kept to 2 levels maximum.
- **Inline SVGs**: Zero third-party icon fonts or icon libraries. All icons reside as compact, accessible inline SVGs in `src/icons.js`.

### 2. 500-Line Code Constraint
Every application code file (`.js`, `.mjs`, `.cjs`, `.css`) across `src/`, `server/`, `prompts/`, and `scripts/` must strictly remain under **500 lines of code**. This is continuously enforced by `npm run check`. When files expand, logic is modularized into dedicated single-responsibility utilities.

### 3. Zero External Runtime CDNs
All assets are bundled locally into `dist/`. No external fonts (uses system font stack), stylesheets, or analytics trackers are fetched at runtime. The only production runtime dependencies are `vanjs-core`, `express`, and `pg`.

### 4. Resilient Auth & State Machine
- **Clerk Verifier**: Verifies tokens using standard RSA-SHA256 cryptography over JWKS without external heavyweight SDKs.
- **Clock Drift Tolerance**: Incorporates a 60-second skew tolerance to prevent edge expiration failures.
- **PostgreSQL Fallback**: User profiles are persistently cached and mirrored in the local database to survive Clerk API rate limits or network hiccups.

---

## License

This project is licensed under the [MIT License](LICENSE).
