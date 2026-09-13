# Teach4All — A Space for Curiosity

A lightweight, offline-first learning companion built with VanJS and custom CSS.

**A little connection. A world of possibility.**

## What it does

Teach4All is a simple chat interface designed to work even in the most unreliable internet conditions—mountain trails, rural classrooms, buses, or wherever curiosity finds you.

- **Offline-ready**: After one successful load, the app caches itself. Your saved chats stay local.
- **Light on data**: No remote fonts, no trackers, no heavy images. The entire app is under 50KB gzipped.
- **Built from scratch**: VanJS for UI, hand-written CSS, zero UI libraries.
- **Local-first**: All conversations save to your browser. No accounts, no servers, no sync.

This is an **offline demo** with built-in learning prompts rather than a live AI model. It's designed to show what a resilient, low-bandwidth interface can feel like.

## Quick start

```bash
# Install dependencies (Node.js 22.12+ recommended)
npm install

# Start development server
npm run dev

# Open http://localhost:5173 in your browser
```

The app runs entirely in your browser. No backend required.

## Scripts

| Command           | Description                                    |
| ----------------- | ---------------------------------------------- |
| `npm run dev`     | Start Vite dev server with hot module reload   |
| `npm run build`   | Build for production (includes service worker) |
| `npm run preview` | Preview production build locally              |
| `npm run check`   | Verify all code files are under 500 lines     |
| `npm test`        | Run integration tests                          |
| `npm run test:e2e` | Run Playwright end-to-end tests              |

## Architecture

```
src/
├── main.js          # App initialization and layout
├── icons.js         # Inline SVG icons
├── storage.js       # LocalStorage schema and validation
├── replies.js       # Local demo response templates
├── state.js         # Global reactive state with VanJS
├── offline.js       # Service worker registration
├── sw.js            # Service worker source (built into dist/)
├── components/
│   ├── sidebar.js   # Sidebar: history, search, settings
│   ├── chat.js      # Main chat interface
│   └── dialogs.js   # Modal dialogs (settings, about, etc.)
└── styles/
    ├── base.css     # Reset, variables, global styles
    ├── sidebar.css  # Sidebar layout and theme
    ├── chat.css     # Chat stage and composer
    └── dialogs.css  # Modal styles
```

**File size rule**: Every `.js` and `.css` file in `src/` stays under 500 lines. This keeps the codebase navigable and maintainable.

## Offline behavior

1. Load the app once over HTTPS or `localhost`.
2. The service worker caches the shell and assets.
3. Subsequent visits work offline. Chats save to localStorage.
4. If the connection drops, you can still read, write, and export.

**Limitations**: The demo responses are local templates. There's no pending-send queue because there's no backend. Your data stays in one browser tab unless you export it.

## Customizing

- **Colors and spacing**: Edit CSS custom properties in `src/styles/base.css`.
- **Demo responses**: Modify `src/replies.js` to change the learning prompts.
- **Storage schema**: Versioned in `src/storage.js` (currently `teach4all.workspace.v1`).

## Why this stack?

- **VanJS**: A 1KB reactive framework with no build step required. Perfect for a lightweight, progressive web app.
- **Custom CSS**: Full control over layout and theme without fighting a framework.
- **Vite**: Fast dev server and minimal config for a small project.
- **Playwright**: Reliable E2E testing for critical flows.

## License

MIT
