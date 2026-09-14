# syntax=docker/dockerfile:1

# ------------------------------------------------------------------------------
# Stage 1: Build Frontend Assets
# ------------------------------------------------------------------------------
FROM node:22-alpine AS builder

WORKDIR /app

# Copy dependency manifests
COPY package.json package-lock.json ./

# Install all dependencies including devDependencies for the build step
RUN npm ci

# Copy build configs, scripts, templates, source code, and server/prompts (imported by vite.config.js)
COPY vite.config.js index.html 404.html ./
COPY scripts ./scripts
COPY public ./public
COPY src ./src
COPY server ./server
COPY prompts ./prompts

# Build production assets (verifies line constraints, compiles via Vite, builds service worker)
RUN npm run build

# ------------------------------------------------------------------------------
# Stage 2: Production Dependencies
# ------------------------------------------------------------------------------
FROM node:22-alpine AS deps

WORKDIR /app

COPY package.json package-lock.json ./

# Install only runtime production dependencies and purge npm cache
RUN npm ci --omit=dev && npm cache clean --force

# ------------------------------------------------------------------------------
# Stage 3: Production Runtime Environment
# ------------------------------------------------------------------------------
FROM node:22-alpine AS runner

WORKDIR /app

# Set default production environment variables
ENV NODE_ENV=production
ENV PORT=3000

# Set ownership of application root for non-root user
RUN chown node:node /app

# Copy production node_modules from deps stage
COPY --from=deps --chown=node:node /app/node_modules ./node_modules

# Copy package manifest
COPY --chown=node:node package.json ./

# Copy compiled frontend assets from builder stage
COPY --from=builder --chown=node:node /app/dist ./dist

# Copy runtime server code and system prompts
COPY --chown=node:node server ./server
COPY --chown=node:node prompts ./prompts

# Copy migration files and runner for container-based DB operations
COPY --chown=node:node migrations ./migrations
COPY --chown=node:node scripts/migrate.mjs ./scripts/migrate.mjs

# Copy root HTML templates as fallback for SSR
COPY --chown=node:node index.html 404.html ./

# Run container as non-root user
USER node

# Expose server port
EXPOSE 3000

# Native Node.js health check against the HTTP server
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000)).then((res) => process.exit(res.status ? 0 : 1)).catch(() => process.exit(1))"

# Start standalone Express server
CMD ["node", "server/index.js"]
