import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const CSS_FILES = [
  'src/styles/base.css',
  'src/styles/sidebar.css',
  'src/styles/chat.css',
  'src/styles/dialogs.css',
];

let cachedBundledCss = null;

export const SVG_ICONS = {
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

export function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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

export function getBundledCss(options = {}) {
  const forceReload = options.forceReload || false;
  if (cachedBundledCss && !forceReload) {
    return cachedBundledCss;
  }

  const parts = [];
  for (const rel of CSS_FILES) {
    const fullPath = resolve(process.cwd(), rel);
    if (existsSync(fullPath)) {
      try {
        parts.push(readFileSync(fullPath, 'utf8'));
      } catch {}
    }
  }

  const combined = parts.join('\n');
  if (combined) {
    cachedBundledCss = combined;
  }
  return combined;
}

export function injectBundledStyles(html, options = {}) {
  if (!html || typeof html !== 'string') return html;
  if (html.includes('id="teach4all-bundled-styles"')) {
    return html;
  }

  const isProd = options.isProd ?? (
    process.env.ENV === 'production' ||
    process.env.ENV === 'staging' ||
    process.env.NODE_ENV === 'production' ||
    process.env.NODE_ENV === 'staging'
  );
  const css = getBundledCss({ forceReload: !isProd });
  if (!css) return html;

  const styleTag = `<style id="teach4all-bundled-styles">\n${css}\n</style>`;
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/(<head[^>]*>)/i, `$1\n    ${styleTag}`);
  }
  return `${styleTag}\n${html}`;
}
