import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { getUiTextsFromDb, getChatPromptsFromDb, getGoogleTagIdFromDb } from './uiTextsApi.js';
import { getClerkConfig } from './clerkVerifier.js';

let cachedGoogleTagId = null;

export function isProductionEnv(env = {}) {
  const explicit = env?.ENV || env?.env || process.env.ENV || process.env.env;
  if (explicit) {
    return explicit.trim().toLowerCase() === 'production';
  }
  const fallback = env?.NODE_ENV || process.env.NODE_ENV || 'development';
  return fallback.trim().toLowerCase() === 'production';
}

export function buildGoogleTagHtml(tagId) {
  if (!tagId || typeof tagId !== 'string' || !tagId.trim()) return '';
  const cleanId = tagId.trim();
  return `<!-- Google tag (gtag.js) -->
<script async src="https://www.googletagmanager.com/gtag/js?id=${cleanId}"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());

  gtag('config', '${cleanId}');
</script>`;
}

export function injectGoogleTag(html, tagId) {
  if (!html || !tagId) return html;
  const tagHtml = buildGoogleTagHtml(tagId);
  if (!tagHtml || html.includes('https://www.googletagmanager.com/gtag/js')) {
    return html;
  }
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/(<head[^>]*>)/i, `$1\n  ${tagHtml}`);
  }
  return `${tagHtml}\n${html}`;
}

export function stripGoogleTag(html) {
  if (!html || typeof html !== 'string') return html;
  return html
    .replace(/<!-- Google tag \(gtag\.js\) -->\s*<script async src="https:\/\/www\.googletagmanager\.com\/gtag\/js\?id=[^"]+"><\/script>\s*<script>[\s\S]*?gtag\('config',\s*'[^']+'\);\s*<\/script>\s*/gi, '')
    .replace(/<!-- Google tag \(gtag\.js\) -->\s*/gi, '');
}

function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const SVG_ICONS = {
  mountain: '<path d="M3 17 10 5l11 16H3l4-7 5 7"/><path d="m8 9 3 3 3-2"/><path d="M19 3v5m-2.5-2.5h5"/>',
  bulb: '<path d="M9 18h6m-5 3h4"/><path d="M8.5 14.5a6 6 0 1 1 7 0L15 17H9Z"/><path d="M12 2V1M4 5 3 4m17 1 1-1"/>',
  plan: '<path d="M9 5H6a2 2 0 0 0-2 2v13h16V7a2 2 0 0 0-2-2h-3"/><path d="M9 3h6v4H9ZM8 12h8m-8 4h5"/>',
  spark: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z"/><path d="M20 2v4m-2-2h4"/>',
  book: '<path d="M12 5v16"/><path d="M12 6C9 3 5 3 2 4v15c4-1 7-1 10 2 3-3 6-3 10-2V4c-3-1-7-1-10 2"/>',
  globe: '<path d="M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0"/><path d="M3 12h18M12 3c5 5 5 13 0 18-5-5-5-13 0-18"/>',
  leaf: '<path d="M19 3C9 2 3 7 5 14c3 8 15 3 14-11Z"/><path d="M4 21 15 9"/>',
  search: '<path d="M21 21l-4.5-4.5"/><path d="M19 10.5a8.5 8.5 0 1 1-17 0 8.5 8.5 0 0 1 17 0"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><path d="M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z"/>',
  chevron: '<path d="m8 10 4 4 4-4"/>',
  login: '<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><path d="m10 17 5-5-5-5"/><path d="M15 12H3"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5"/><path d="M4 16v5h16v-5"/>',
};

export function renderSsrHtml({ htmlTemplate, texts, prompts = [], serverEnv = {}, googleTagId = null }) {
  if (!texts || !Object.keys(texts).length || !prompts || !prompts.length) {
    throw new Error('No UI text or prompts available in database to populate SSR.');
  }

  const isProd = isProductionEnv(serverEnv);
  const appEnv = serverEnv.ENV || serverEnv.env || process.env.ENV || process.env.env || (isProd ? 'production' : 'development');
  const clerkConfig = getClerkConfig(serverEnv);
  const authConfig = {
    publishableKey: clerkConfig.publishableKey,
    frontendApi: clerkConfig.frontendApi,
    accountsUrl: clerkConfig.accountsUrl,
    handshakeUrl: `${clerkConfig.frontendApi.replace(/\/$/, '')}/v1/client/handshake`,
    signInUrl: `${clerkConfig.accountsUrl.replace(/\/$/, '')}/sign-in`,
    signUpUrl: `${clerkConfig.accountsUrl.replace(/\/$/, '')}/sign-up`,
    userProfileUrl: `${clerkConfig.accountsUrl.replace(/\/$/, '')}/user`,
  };
  const initialDataScript = `<script id="__TEACH4ALL_DATA__">window.__INITIAL_UI_DATA__ = ${JSON.stringify({ texts, prompts, env: appEnv, auth: authConfig })};</script>`;
  const ssrPrompts = prompts.slice(0, 4);

  const promptCardsHtml = ssrPrompts.map(p => `
    <button type="button" class="suggestion-card">
      <span class="suggestion-icon ${escapeHtml(p.color || 'amber')}">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="icon">
          ${SVG_ICONS[p.icon] || SVG_ICONS.bulb}
        </svg>
      </span>
      <span class="suggestion-title">${escapeHtml(p.title)}</span>
      <span class="suggestion-detail">${escapeHtml(p.detail)}</span>
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="icon suggestion-arrow">
        <path d="M5 12h14m-6-6 6 6-6 6"/>
      </svg>
    </button>
  `).join('');

  const ssrBody = `
  <div id="app" class="app">
    <a href="#message-input" class="skip-link">${escapeHtml(texts.app_skip_link || '')}</a>
    <aside id="sidebar" class="sidebar" aria-label="${escapeHtml(texts.sidebar_aria_label || '')}">
      <div class="sidebar-brand">
        <button type="button" class="brand" aria-label="${escapeHtml(texts.sidebar_brand_aria || '')}">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="icon">
            ${SVG_ICONS.mountain}
          </svg>
          <span>${escapeHtml(texts.sidebar_brand_prefix || '')}</span><span class="brand-number">${escapeHtml(texts.sidebar_brand_number || '')}</span><span>${escapeHtml(texts.sidebar_brand_suffix || '')}</span>
        </button>
        <button type="button" class="icon-button close-sidebar" aria-label="${escapeHtml(texts.sidebar_close_button_aria || '')}">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="icon">
            <path d="M4 3h16a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1"/><path d="M9 3v18"/><path d="m16 9-3 3 3 3"/>
          </svg>
        </button>
      </div>
      <div class="sidebar-actions">
        <button type="button" class="new-chat-button">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="icon">
            ${SVG_ICONS.plus}
          </svg>
          <span>${escapeHtml(texts.sidebar_new_chat_button || '')}</span>
        </button>
        <div class="sidebar-quick-links">
          <button type="button" class="quick-action-button" aria-label="${escapeHtml(texts.sidebar_quiz_aria || '')}">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="icon">
              ${SVG_ICONS.spark}
            </svg>
            <span>${escapeHtml(texts.sidebar_quiz_button || '')}</span>
          </button>
          <button type="button" class="quick-action-button" aria-label="${escapeHtml(texts.sidebar_material_aria || '')}">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="icon">
              ${SVG_ICONS.book}
            </svg>
            <span>${escapeHtml(texts.sidebar_material_button || '')}</span>
          </button>
        </div>
        <div class="search-field">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="icon">
            <path d="M21 21l-4.5-4.5"/><path d="M19 10.5a8.5 8.5 0 1 1-17 0 8.5 8.5 0 0 1 17 0"/>
          </svg>
          <input id="chat-search" type="search" placeholder="${escapeHtml(texts.sidebar_search_placeholder || '')}" aria-label="${escapeHtml(texts.sidebar_search_aria || '')}" />
        </div>
      </div>
      <nav class="history" aria-label="${escapeHtml(texts.sidebar_history_aria || '')}">
        <div class="section-heading">
          <h2>${escapeHtml(texts.sidebar_history_heading || '')}</h2>
        </div>
        <div class="empty-history">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="icon">
            ${SVG_ICONS.spark}
          </svg>
          <p>${escapeHtml(texts.sidebar_empty_title || '')}</p>
          <p>${escapeHtml(texts.sidebar_empty_desc || '')}</p>
        </div>
      </nav>
      <div class="sidebar-bottom">
        <div class="profile-dropup-menu" id="profile-dropup-menu" role="menu" aria-hidden="true">
          <div class="profile-menu-content">
            <div class="profile-menu-header">
              <span class="profile-menu-name">${escapeHtml(texts.auth_guest_name || 'Akun Tamu')}</span>
              <span class="profile-menu-email">${escapeHtml(texts.auth_guest_detail || 'Klik untuk masuk')}</span>
            </div>
            <div class="profile-menu-divider"></div>
            <button type="button" class="profile-menu-item" role="menuitem">
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="icon">
                ${SVG_ICONS.login}
              </svg>
              <span>${escapeHtml(texts.auth_login_button || 'Masuk')}</span>
            </button>
            <button type="button" class="profile-menu-item" role="menuitem">
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="icon">
                ${SVG_ICONS.user}
              </svg>
              <span>${escapeHtml(texts.auth_signup_with_clerk || 'Daftar akun baru')}</span>
            </button>
            <div class="profile-menu-divider"></div>
            <button type="button" class="profile-menu-item" role="menuitem">
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="icon">
                ${SVG_ICONS.download}
              </svg>
              <span>${escapeHtml(texts.auth_export_workspace || 'expor histori chat')}</span>
            </button>
          </div>
        </div>
        <button type="button" class="profile-button is-guest" aria-haspopup="menu" aria-expanded="false" aria-controls="profile-dropup-menu" aria-label="${escapeHtml(texts.auth_guest_name || 'Akun Tamu')}">
          <span class="avatar">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="icon">
              ${SVG_ICONS.user}
            </svg>
          </span>
          <span class="profile-copy">
            <span class="profile-name">${escapeHtml(texts.auth_guest_name || 'Akun Tamu')}</span>
            <span class="profile-detail">${escapeHtml(texts.auth_guest_detail || 'Klik untuk masuk')}</span>
          </span>
          <span class="profile-chevron">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="icon">
              ${SVG_ICONS.chevron}
            </svg>
          </span>
        </button>
      </div>
    </aside>
    <div class="sidebar-scrim" aria-hidden="true"></div>
    <main class="main" id="main">
      <header class="topbar">
        <div class="topbar-left">
          <button type="button" class="icon-button open-sidebar hamburger-menu" aria-label="${escapeHtml(texts.topbar_open_nav || '')}" aria-controls="sidebar">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="icon">
              <path d="M4 6h16M4 12h16M4 18h16"/>
            </svg>
          </button>
          <button type="button" class="icon-button topbar-new-chat" aria-label="${escapeHtml(texts.topbar_new_chat || '')}" title="${escapeHtml(texts.topbar_new_chat || '')}">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="icon">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
          </button>
        </div>
        <div class="topbar-right">
          <button type="button" class="icon-button theme-toggle" aria-label="${escapeHtml(texts.topbar_theme_prefix || '')}">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="icon">
              <path d="M20.5 13A9 9 0 0 1 11 3.5 9 9 0 1 0 20.5 13Z"/>
            </svg>
          </button>
        </div>
      </header>
      <div class="workspace is-welcome">
        <div class="chat-stage">
          <section class="welcome" aria-labelledby="welcome-title">
            <div class="welcome-symbol">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="icon">
                <path d="M3 17 10 5l11 16H3l4-7 5 7"/><path d="m8 9 3 3 3-2"/><path d="M19 3v5m-2.5-2.5h5"/>
              </svg>
              <span class="symbol-dot"></span>
            </div>
            <h1 id="welcome-title">${escapeHtml(texts.chat_welcome_title_p1 || '')}<br/>${escapeHtml(texts.chat_welcome_title_p2 || '')}<span class="accent-word">${escapeHtml(texts.chat_welcome_title_p3 || '')}</span></h1>
            <p class="welcome-description">${escapeHtml(texts.chat_welcome_desc_p1 || '')}<br/>${escapeHtml(texts.chat_welcome_desc_p2 || '')}</p>
          </section>
          <div class="messages" id="messages" role="log" aria-label="${escapeHtml(texts.chat_messages_aria || '')}" tabindex="0">
            <div class="message-content"></div>
          </div>
          <div class="composer-wrap">
            <form class="composer">
              <textarea id="message-input" autofocus placeholder="${escapeHtml(texts.chat_composer_placeholder || '')}" rows="1" maxlength="6000" aria-label="${escapeHtml(texts.chat_composer_aria || '')}"></textarea>
              <div class="composer-toolbar">
                <div class="composer-tools">
                  <button type="button" class="icon-button add-button" aria-label="${escapeHtml(texts.chat_composer_tools_aria || '')}" title="${escapeHtml(texts.chat_composer_tools_aria || '')}">
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="icon">
                      <path d="M12 5v14M5 12h14"/>
                    </svg>
                  </button>
                </div>
                <div class="send-tools">
                  <button type="submit" class="send-button" aria-label="${escapeHtml(texts.chat_send_button_aria || '')}" title="${escapeHtml(texts.chat_send_button_aria || '')}" disabled>
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="icon">
                      <path d="M12 19V5m-6 6 6-6 6 6"/>
                    </svg>
                  </button>
                </div>
              </div>
            </form>
          </div>
          <section class="suggestions" aria-label="${escapeHtml(texts.chat_suggestions_aria || '')}">
            <div class="suggestions-label">
              <span>${escapeHtml(texts.chat_suggestions_heading || '')}</span>
              <span class="little-line"></span>
            </div>
            <div class="suggestion-grid">
              ${promptCardsHtml}
            </div>
          </section>
        </div>
        <div class="workspace-footer">
          <span>${escapeHtml(texts.chat_footer_text || '')}</span>
        </div>
      </div>
    </main>
  </div>
  `;

  let rendered = htmlTemplate;
  rendered = rendered.replace('</head>', `  ${initialDataScript}
  </head>`);
  rendered = rendered.replace('<body>', `<body>
${ssrBody}`);

  const activeTagId = isProd ? (texts.google_tag_id || googleTagId || cachedGoogleTagId) : null;
  if (activeTagId) {
    rendered = injectGoogleTag(rendered, activeTagId);
  } else if (!isProd) {
    rendered = stripGoogleTag(rendered);
  }

  return rendered;
}

export function loadHtmlTemplate(options = {}) {
  const serverEnv = typeof options === 'object' && options ? (options.serverEnv || {}) : {};
  const isProd = isProductionEnv(serverEnv);

  const distPath = resolve(process.cwd(), 'dist', 'index.html');
  const rootPath = resolve(process.cwd(), 'index.html');
  if (isProd && existsSync(distPath)) {
    return readFileSync(distPath, 'utf8');
  }
  if (existsSync(rootPath)) {
    return readFileSync(rootPath, 'utf8');
  }
  if (existsSync(distPath)) {
    return readFileSync(distPath, 'utf8');
  }
  return '';
}

export function load404HtmlTemplate(options = {}) {
  const googleTagId = typeof options === 'string' ? options : (options && typeof options === 'object' ? options.googleTagId : null);
  const serverEnv = typeof options === 'object' && options ? (options.serverEnv || {}) : {};
  const isProd = isProductionEnv(serverEnv);

  const distPath = resolve(process.cwd(), 'dist', '404.html');
  const rootPath = resolve(process.cwd(), '404.html');
  let html = '';
  if (isProd && existsSync(distPath)) {
    html = readFileSync(distPath, 'utf8');
  } else if (existsSync(rootPath)) {
    html = readFileSync(rootPath, 'utf8');
  } else if (existsSync(distPath)) {
    html = readFileSync(distPath, 'utf8');
  } else {
    html = '<!doctype html><html><head><title>404 Not Found</title></head><body><h1>404 Not Found</h1></body></html>';
  }

  const activeTagId = isProd ? (googleTagId || cachedGoogleTagId) : null;
  if (activeTagId) {
    html = injectGoogleTag(html, activeTagId);
  } else if (!isProd) {
    html = stripGoogleTag(html);
  }

  return html;
}

export async function handleSsrRequest(req, res, env = {}) {
  const rawUrl = req.url || '/';
  const pathname = rawUrl.split('?')[0];
  const dbUrl = env.DATABASE_URL || process.env.DATABASE_URL;

  const isRoot = pathname === '/' || pathname === '/index.html' || pathname === '';
  if (!isRoot) {
    let tagId = null;
    if (isProductionEnv(env)) {
      try {
        tagId = await getGoogleTagIdFromDb(dbUrl);
        if (tagId) cachedGoogleTagId = tagId;
      } catch {}
    }
    const template404 = load404HtmlTemplate({ googleTagId: tagId, serverEnv: env });
    res.writeHead(404, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    });
    res.end(template404);
    return;
  }

  try {
    const texts = await getUiTextsFromDb(dbUrl);
    const prompts = await getChatPromptsFromDb(dbUrl);
    if (texts?.google_tag_id) {
      cachedGoogleTagId = texts.google_tag_id;
    }

    if (!texts || !Object.keys(texts).length || !prompts || !prompts.length) {
      res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('UI texts or prompts are not available in the database. Application cannot load.');
      return;
    }

    const template = loadHtmlTemplate({ serverEnv: env });
    if (!template) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('HTML template not found.');
      return;
    }

    const rendered = renderSsrHtml({ htmlTemplate: template, texts, prompts, serverEnv: env });
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-cache',
    });
    res.end(rendered);
  } catch (err) {
    res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('UI texts could not be loaded from database.');
  }
}
