import van from 'vanjs-core';
import { icon } from './icons.js';
import { Sidebar } from './components/sidebar.js';
import { Chat } from './components/chat.js';
import { Dialogs } from './components/dialogs.js';
import {
  sidebarOpen, sidebarCollapsed, theme, setTheme, modal, notice,
  online, newChat, focusComposer, currentChat,
} from './state.js';
import { registerOffline } from './offline.js';
import { isDevEnv } from './env.js';
import { initClientErrorMonitoring } from './errorLogger.js';
import { initUiTexts, t } from './uiTexts.js';
import './styles/base.css';
import './styles/sidebar.css';
import './styles/chat.css';
import './styles/dialogs.css';

initClientErrorMonitoring();

const { div, main, header, button, span, a } = van.tags;
const systemDark = window.matchMedia('(prefers-color-scheme: dark)');
const darkMode = van.state(systemDark.matches);
systemDark.addEventListener('change', event => { darkMode.val = event.matches; });
const isDark = () => theme.val === 'dark' || (theme.val === 'system' && darkMode.val);

van.derive(() => {
  const dark = isDark();
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  const metaTheme = document.querySelector('meta[name="theme-color"]');
  if (metaTheme) metaTheme.content = dark ? '#1A232E' : '#F2EEE1';
});

function Topbar() {
  return header({ class: 'topbar' },
    div({ class: 'topbar-left' },
      button({
        class: 'icon-button open-sidebar hamburger-menu', 'aria-label': () => t('topbar_open_nav'), 'aria-controls': 'sidebar',
        'aria-expanded': () => String(sidebarOpen.val || !sidebarCollapsed.val),
        onclick: () => { sidebarOpen.val = !sidebarOpen.val; sidebarCollapsed.val = false; },
      }, icon('menu')),
      button({
        class: 'icon-button topbar-new-chat', 'aria-label': () => t('topbar_new_chat'), title: () => t('topbar_new_chat'),
        onclick: newChat,
      }, icon('compose')),
      () => {
        const title = currentChat()?.title;
        return (title && title !== t('topbar_new_chat')) ? span({ class: 'topbar-divider' }) : null;
      },
      () => {
        const title = currentChat()?.title;
        return (title && title !== t('topbar_new_chat')) ? div({ class: 'workspace-title' }, span(title)) : null;
      },
    ),
    div({ class: 'topbar-right' },
      () => !online.val
        ? span({ class: 'connection-badge offline-badge', role: 'status' }, icon('signalOff'), () => t('topbar_offline_badge'))
        : null,
      button({
        class: 'icon-button theme-toggle', 'aria-label': () => `${t('topbar_theme_prefix')}${isDark() ? t('topbar_theme_light') : t('topbar_theme_dark')}`,
        onclick: () => setTheme(isDark() ? 'light' : 'dark'),
      }, () => icon(isDark() ? 'sun' : 'moon')),
    ),
  );
}

function Toast() {
  return () => div({
    class: () => `toast ${notice.val ? 'is-visible' : ''}`,
    role: 'status', 'aria-live': 'polite',
  }, notice.val);
}

function App() {
  return div({
    class: () => [
      'app',
      sidebarOpen.val ? 'sidebar-is-open' : '',
      sidebarCollapsed.val ? 'sidebar-is-collapsed' : '',
    ].filter(Boolean).join(' '),
  },
    a({ href: '#message-input', class: 'skip-link' }, () => t('app_skip_link')),
    Sidebar(),
    div({
      class: 'sidebar-scrim', 'aria-hidden': 'true',
      onclick: () => { sidebarOpen.val = false; },
    }),
    main({ class: 'main', id: 'main' },
      Topbar(),
      Chat(),
    ),
    Toast(),
    Dialogs(),
  );
}

async function initApp() {
  if (typeof window !== 'undefined') {
    const path = window.location.pathname;
    const isAppPath = path === '/' || path.endsWith('/index.html') || path.endsWith('/');
    if (!isAppPath && !path.includes('404.html')) {
      window.location.replace('./404.html');
      return;
    }
  }

  const loaded = await initUiTexts();
  if (!loaded) return;

  const mount = () => {
    const existingApp = document.getElementById('app');
    if (existingApp) {
      existingApp.replaceWith(App());
    } else {
      van.add(document.body, App());
    }
    registerOffline();
    focusComposer();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount, { once: true });
  } else {
    mount();
  }

  if (typeof window !== 'undefined' && document.readyState !== 'complete') {
    window.addEventListener('load', focusComposer, { once: true });
  }
}

initApp();

