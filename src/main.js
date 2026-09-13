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
  document.querySelector('meta[name="theme-color"]').content = dark ? '#1c211e' : '#f9faf7';
});

function Topbar() {
  return header({ class: 'topbar' },
    div({ class: 'topbar-left' },
      button({
        class: 'icon-button open-sidebar', 'aria-label': 'Open sidebar', 'aria-controls': 'sidebar',
        'aria-expanded': () => String(sidebarOpen.val || !sidebarCollapsed.val),
        onclick: () => { sidebarOpen.val = true; sidebarCollapsed.val = false; },
      }, icon('panel')),
      div({ class: 'workspace-title' },
        () => span(currentChat()?.title || 'Your learning companion')),
    ),
    div({ class: 'topbar-right' },
      div({
        class: () => `connection-badge ${!online.val ? 'offline-badge' : ''}`,
        role: 'status',
      }, () => icon(!online.val ? 'offline' : offlineReady.val ? 'check' : 'leaf'),
      () => span(!online.val ? 'Working offline' : offlineReady.val ? 'Offline ready' : 'Local-first')),
      span({ class: 'topbar-divider' }),
      button({
        class: 'icon-button theme-toggle', 'aria-label': () => `Switch to ${isDark() ? 'light' : 'dark'} theme`,
        onclick: () => setTheme(isDark() ? 'light' : 'dark'),
      }, () => icon(isDark() ? 'moon' : 'sun')),
    ),
  );
}

van.add(document.body,
  a({ class: 'skip-link', href: '#message-input' }, 'Skip to message'),
  div({ class: () => `app ${sidebarOpen.val ? 'sidebar-is-open' : ''} ${sidebarCollapsed.val ? 'sidebar-is-collapsed' : ''}` },
    button({ class: 'sidebar-scrim', 'aria-label': 'Close sidebar', tabindex: '-1', onclick: () => { sidebarOpen.val = false; } }),
    Sidebar(), main({ class: 'main', id: 'main' }, Topbar(), Chat()),
  ),
  Dialogs(),
  div({ class: () => `toast ${notice.val ? 'is-visible' : ''}`, role: 'status', 'aria-live': 'polite' }, () => notice.val),
  () => updateReady.val ? div({ class: 'update-notice', role: 'status' }, span('A fresh version is ready.'),
    button({ class: 'text-button', onclick: applyUpdate }, 'Update & reload')) : div(),
);

const mobile = window.matchMedia('(max-width: 760px)');
const syncSidebar = () => {
  const sidebar = document.getElementById('sidebar');
  sidebar.inert = mobile.matches ? !sidebarOpen.val : sidebarCollapsed.val;
};
mobile.addEventListener('change', syncSidebar);
van.derive(syncSidebar);

document.addEventListener('keydown', event => {
  if (modal.val) return;
  const editable = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    sidebarOpen.val = true;
    sidebarCollapsed.val = false;
    requestAnimationFrame(() => document.getElementById('chat-search').focus());
  } else if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'o') {
    event.preventDefault();
    newChat();
  } else if (event.key === '/' && !editable) {
    event.preventDefault();
    focusComposer();
  } else if (event.key === 'Escape' && sidebarOpen.val) {
    sidebarOpen.val = false;
    document.querySelector('.open-sidebar').focus();
  } else if (event.key === 'Tab' && mobile.matches && sidebarOpen.val) {
    const items = [...document.querySelectorAll('.sidebar button, .sidebar input')].filter(el => !el.disabled);
    const first = items[0];
    const last = items.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
});

registerOffline();
