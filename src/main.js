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
        class: 'icon-button open-sidebar', 'aria-label': 'Open sidebar', 'aria-controls': 'sidebar',
        'aria-expanded': () => String(sidebarOpen.val || !sidebarCollapsed.val),
        onclick: () => { sidebarOpen.val = true; sidebarCollapsed.val = false; },
      }, icon('panel')),
      button({
        class: 'icon-button', 'aria-label': 'New conversation', title: 'New conversation (⇧ ⌘ O)',
        onclick: newChat,
      }, icon('compose')),
      span({ class: 'topbar-divider' }),
      div({ class: 'workspace-title' },
        icon('spark'),
        () => span(currentChat()?.title || 'New conversation'),
      ),
    ),
    div({ class: 'topbar-right' },
      () => !online.val
        ? span({ class: 'connection-badge offline-badge', role: 'status' }, icon('signalOff'), 'Offline mode')
        : offlineReady.val
          ? span({ class: 'connection-badge', role: 'status' }, icon('checkCircle'), 'Ready offline')
          : span({ class: 'connection-badge', role: 'status' }, icon('globe'), 'Teach4All'),
      button({
        class: 'icon-button theme-toggle', 'aria-label': () => `Switch to ${isDark() ? 'light' : 'dark'} theme`,
        onclick: () => setTheme(isDark() ? 'light' : 'dark'),
      }, () => icon(isDark() ? 'sun' : 'moon')),
      button({
        class: 'icon-button', 'aria-label': 'Workspace options', title: 'Settings',
        onclick: () => { modal.val = { type: 'settings' }; },
      }, icon('settings')),
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
        span('A refreshed version of Teach4All is ready.'),
        button({ class: 'text-button', onclick: applyUpdate }, 'Refresh now'),
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
    a({ href: '#message-input', class: 'skip-link' }, 'Skip to message composer'),
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
