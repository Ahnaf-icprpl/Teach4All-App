import van from 'vanjs-core';
import { icon } from '../icons.js';
import {
  chats, activeId, newChat, selectChat, modal, sidebarOpen,
  sidebarCollapsed, search,
} from '../state.js';

const { aside, div, nav, button, span, input, kbd, h2, p } = van.tags;

function emptyHistory() {
  return div({ class: 'empty-history' },
    icon('spark'),
    p('A fresh start'),
    p('Your conversations will find a home here.'),
  );
}

export function Sidebar() {
  const filtered = () => {
    const term = search.val.trim().toLowerCase();
    if (!term) return chats.val;
    return chats.val.filter(chat =>
      chat.title.toLowerCase().includes(term) ||
      chat.messages.some(message => message.text.toLowerCase().includes(term)),
    );
  };

  const conversationList = () => {
    const list = filtered();
    if (!list.length) return emptyHistory();
    return div({ class: 'chat-list' }, list.map(chat =>
      div({ class: () => `chat-item ${chat.id === activeId.val ? 'is-active' : ''}` },
        button({
          class: 'chat-select',
          onclick: () => selectChat(chat.id),
          'aria-current': () => chat.id === activeId.val ? 'page' : null,
        },
        icon('chat'),
        span(chat.title),
        ),
        button({
          class: 'icon-button chat-options',
          'aria-label': `Options for ${chat.title}`,
          onclick: event => {
            event.stopPropagation();
            modal.val = { type: 'conversation', id: chat.id };
          },
        }, icon('more')),
      ),
    ));
  };

  return aside({
    id: 'sidebar',
    class: () => `sidebar ${sidebarOpen.val ? 'is-open' : ''} ${sidebarCollapsed.val ? 'is-collapsed' : ''}`,
    'aria-label': 'Conversation sidebar',
  },
    div({ class: 'sidebar-brand' },
      button({ class: 'brand', onclick: newChat, 'aria-label': 'Teach4All home' },
        icon('mountain'), span('Teach'), span({ class: 'brand-number' }, '4'), span('All')),
      button({
        class: 'icon-button close-sidebar',
        'aria-label': 'Close sidebar',
        onclick: () => {
          sidebarOpen.val = false;
          sidebarCollapsed.val = true;
        },
      }, icon('panelClose')),
    ),
    div({ class: 'sidebar-actions' },
      button({ class: 'new-chat-button', onclick: newChat },
        icon('plus'), span('New chat'), kbd({ 'aria-label': 'Ctrl or Command + Shift + O' }, '⇧ ⌘ O')),
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
      div({ class: 'profile-button' },
        span({ class: 'avatar' }, 'Y'),
        span({ class: 'profile-copy' }, span({ class: 'profile-name' }, 'Your workspace'), span({ class: 'profile-detail' }, 'Personal · Saved locally')),
      ),
    ),
  );
}
