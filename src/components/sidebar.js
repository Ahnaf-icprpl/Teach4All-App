import van from 'vanjs-core';
import { icon, landscape } from '../icons.js';
import {
  chats, activeId, search, sidebarOpen, sidebarCollapsed, modal,
  newChat, selectChat, offlineReady, online,
} from '../state.js';

const { aside, div, button, span, p, input, h2, nav, kbd } = van.tags;

function conversationList() {
  const query = search.val.trim().toLowerCase();
  const filtered = chats.val.filter(chat => chat.title.toLowerCase().includes(query)
    || chat.messages.some(message => message.text.toLowerCase().includes(query)));
  const selected = activeId.val;
  if (!filtered.length) {
    return div({ class: 'history-empty' }, icon(query ? 'search' : 'chat'),
      p({ class: 'empty-title' }, query ? 'No conversations found' : 'A fresh start'),
      p(query ? 'Try a different word or start a new chat.' : 'Your conversations will find a home here.'),
      query ? button({ class: 'text-button', onclick: () => { search.val = ''; } }, 'Clear search') : null,
    );
  }
  return div({ class: 'chat-list' }, filtered.map(chat =>
    div({ class: `chat-item ${selected === chat.id ? 'is-active' : ''}` },
      button({
        class: 'chat-select', onclick: () => selectChat(chat.id),
        'aria-current': selected === chat.id ? 'true' : 'false', title: chat.title,
      }, icon('chat'), span(chat.title)),
      button({
        class: 'icon-button chat-options', 'aria-label': `Options for ${chat.title}`,
        onclick: () => { modal.val = { type: 'conversation', id: chat.id }; },
      }, icon('more')),
    ),
  ));
}

export function Sidebar() {
  return aside({ class: 'sidebar', id: 'sidebar', 'aria-label': 'Conversation sidebar' },
    div({ class: 'sidebar-brand' },
      button({ class: 'brand', onclick: newChat, 'aria-label': 'Teach4All home' },
        span({ class: 'brand-mark' }, icon('mountain')), span('Teach', span({ class: 'brand-four' }, '4'), 'All'),
      ),
      button({
        class: 'icon-button panel-toggle', 'aria-label': 'Close sidebar',
        onclick: () => { sidebarOpen.val = false; sidebarCollapsed.val = true; },
      }, icon('panel')),
    ),
    div({ class: 'sidebar-actions' },
      button({ class: 'new-chat-button', onclick: newChat }, icon('plus'), span('New chat'),
        kbd({ title: 'Ctrl or Command + Shift + O' }, '⇧ ⌘ O')),
      div({ class: 'search-field' }, icon('search'),
        input({
          id: 'chat-search', type: 'search', placeholder: 'Search conversations',
          'aria-label': 'Search conversations', value: () => search.val,
          oninput: event => { search.val = event.target.value; },
        }), kbd('⌘ K'),
      ),
    ),
    nav({ class: 'history', 'aria-label': 'Saved conversations' },
      div({ class: 'section-heading' }, h2('Your conversations'), () => span({ class: 'chat-count' }, chats.val.length || '')),
      conversationList,
    ),
    div({ class: 'sidebar-bottom' },
      div({ class: 'offgrid-card' },
        span({ class: 'eyebrow' }, icon('leaf'), 'BUILT TO GO FURTHER'),
        h2('Good ideas go off-grid.'),
        p('Less data. More possibility.\nA space to learn, wherever you are.'),
        landscape(),
      ),
      div({ class: 'local-status' },
        () => span({ class: `status-dot ${!online.val ? 'is-offline' : ''}` }),
        () => span(!online.val ? 'You’re offline. Keep exploring.' : offlineReady.val ? 'Ready when the signal isn’t.' : 'Your chats stay on this device.'),
      ),
      button({ class: 'profile-button', onclick: () => { modal.val = { type: 'settings' }; } },
        span({ class: 'avatar' }, 'Y'),
        span({ class: 'profile-copy' }, span({ class: 'profile-name' }, 'Your workspace'), span({ class: 'profile-detail' }, 'Personal · Saved locally')),
        icon('settings'),
      ),
    ),
  );
}
