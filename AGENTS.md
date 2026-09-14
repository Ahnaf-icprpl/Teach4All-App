# Agent Rules for Teach4All

These rules apply to all code files (`.js`, `.mjs`, `.css`) in the `src/` directory.

## File Size Limits

- Every code file must stay below **500 lines**.
- The `npm run check` script enforces this.
- If a file approaches 400+ lines, proactively refactor:
  - Extract utilities to a separate module.
  - Split a large component into smaller pieces.
  - Move styles into a dedicated CSS file if needed.
- Non-code files (package.json, README.md, configs) have no line limit.

## Build From First Principles

- Use **VanJS only** for UI. No React, Vue, Svelte, or other frameworks.
- Write **custom CSS only**. No Tailwind, Bootstrap, or utility frameworks.
- No UI component libraries. Build elements from `<div>`, `<button>`, `<input>`, etc.
- No icon libraries. Use inline SVG icons in `src/icons.js`.

## No External Dependencies at Runtime

- No CDN scripts, stylesheets, or fonts in production.
- All assets must be bundled or served from `dist/` after `npm run build`.
- The only allowed runtime dependencies are:
  - `vanjs-core` (frontend)
  - `pg` (PostgreSQL driver)
  - `express` (server-side HTTP framework)
- Development tools (Vite, Playwright) are devDependencies only.

## Offline-First Design

- The app must work offline after one successful load over HTTPS/localhost.
- Service worker caches the shell and assets.
- All user data persists via localStorage.
- No network calls for chat replies. The demo uses local text templates.

## Keep It Light

- No analytics, trackers, or telemetry.
- No remote fonts. Use system fonts.
- No heavy images. The hero landscape is inline SVG (under 2KB).
- Prefer CSS transitions over JavaScript animations.

## Accessibility

- Every interactive element must be keyboard-navigable.
- All images and icons need `aria-hidden="true"` or descriptive `aria-label`.
- Use semantic elements (`<main>`, `<nav>`, `<article>`, `<dialog>`) where appropriate.
- The skip link must remain the first focusable element.

## Testing

- Run `npm test` before completing changes to enforce line limits and checks.
- E2E tests use Playwright (`npm run test:e2e`).
- Add tests for critical flows: send message, create chat, export workspace.

## Style Conventions

- Use `const` for all bindings; avoid `let` unless reassignment is required.
- Prefer function declarations over arrow functions for top-level exports.
- Use `van.tags` destructuring at the top of component files.
- Use CSS custom properties in `:root` for colors and spacing.
- Limit CSS nesting depth to 2 levels max.

## What Not to Do

- Do not add new runtime dependencies without updating AGENTS.md and the user.
- Do not introduce build steps complexity beyond Vite's defaults.
- Do not use `localStorage` keys without versioning (see `src/storage.js`).
- Do not bypass the `npm run check` script; fix violations instead.
