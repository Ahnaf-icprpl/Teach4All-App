import van from 'vanjs-core';
import { icon } from './icons.js';
import { Sidebar } from './components/sidebar.js';
import { Chat } from './components/chat.js';
import { Dialogs } from './components/dialogs.js';
import {
  sidebarOpen, sidebarCollapsed, theme, setTheme, modal, notice,
  online, offlineReady, updateReady, newChat, focusComposer, currentChat,
} from './state.js';
import { registerOffline, applyUpdate } from './offline.js';
import './styles/base.css';
import './styles/sidebar.css';
import './styles/chat.css';
import './styles/dialogs.css';

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
        class: 'icon-button open-sidebar hamburger-menu', 'aria-label': 'Buka menu navigasi', 'aria-controls': 'sidebar',
        'aria-expanded': () => String(sidebarOpen.val || !sidebarCollapsed.val),
        onclick: () => { sidebarOpen.val = true; sidebarCollapsed.val = false; },
      }, icon('menu')),
      button({
        class: 'icon-button', 'aria-label': 'Percakapan baru', title: 'Percakapan baru',
        onclick: newChat,
      }, icon('compose')),
      span({ class: 'topbar-divider' }),
      div({ class: 'workspace-title' },
        icon('spark'),
        () => span(currentChat()?.title || 'Percakapan baru'),
      ),
    ),
    div({ class: 'topbar-right' },
      () => !online.val
        ? span({ class: 'connection-badge offline-badge', role: 'status' }, icon('signalOff'), 'Mode luring')
        : offlineReady.val
          ? span({ class: 'connection-badge', role: 'status' }, icon('checkCircle'), 'Siap luring')
          : span({ class: 'connection-badge', role: 'status' }, icon('globe'), 'Teach4All'),
      button({
        class: 'icon-button theme-toggle', 'aria-label': () => `Beralih ke tema ${isDark() ? 'terang' : 'gelap'}`,
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

function UpdateBanner() {
  return () => updateReady.val
    ? div({ class: 'update-notice', role: 'status' },
        span('Versi terbaru Teach4All telah siap.'),
        button({ class: 'text-button', onclick: applyUpdate }, 'Muat ulang sekarang'),
      )
    : div();
}

function App() {
  return div({
    class: () => [
      'app',
      sidebarOpen.val ? 'sidebar-is-open' : '',
      sidebarCollapsed.val ? 'sidebar-is-collapsed' : '',
    ].filter(Boolean).join(' '),
  },
    a({ href: '#message-input', class: 'skip-link' }, 'Lompat ke kolom pesan'),
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
    UpdateBanner(),
    Dialogs(),
  );
}

van.add(document.body, App());
registerOffline();
focusComposer();
if (typeof window !== 'undefined' && document.readyState !== 'complete') {
  window.addEventListener('load', focusComposer, { once: true });
}

