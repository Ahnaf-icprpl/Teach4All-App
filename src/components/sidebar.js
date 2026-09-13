import van from 'vanjs-core';
import { icon } from '../icons.js';
import {
  chats, activeId, newChat, selectChat, modal, sidebarOpen,
  sidebarCollapsed, search, setDraft, focusComposer,
} from '../state.js';

const { aside, div, nav, button, span, input, kbd, h2, p } = van.tags;

function emptyHistory() {
  return div({ class: 'empty-history' },
    icon('spark'),
    p('Awal yang baru'),
    p('Percakapan Anda akan tersimpan di sini.'),
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
          'aria-label': `Opsi untuk ${chat.title}`,
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
    'aria-label': 'Bilah percakapan',
  },
    div({ class: 'sidebar-brand' },
      button({ class: 'brand', onclick: newChat, 'aria-label': 'Beranda Teach4All' },
        icon('mountain'), span('Teach'), span({ class: 'brand-number' }, '4'), span('All')),
      button({
        class: 'icon-button close-sidebar',
        'aria-label': 'Tutup bilah samping',
        onclick: () => {
          sidebarOpen.val = false;
          sidebarCollapsed.val = true;
        },
      }, icon('panelClose')),
    ),
    div({ class: 'sidebar-actions' },
      button({ class: 'new-chat-button', onclick: newChat },
        icon('plus'), span('Obrolan baru'), kbd({ 'aria-label': 'Ctrl atau Command + Shift + O' }, '⇧ ⌘ O')),
      div({ class: 'sidebar-quick-links' },
        button({
          class: 'quick-action-button',
          'aria-label': 'Buat kuis latihan',
          onclick: () => {
            newChat();
            setDraft('Buatkan kuis singkat 5 soal pilihan ganda tentang topik berikut: ');
            focusComposer();
          },
        }, icon('spark'), span('Kuis')),
        button({
          class: 'quick-action-button',
          'aria-label': 'Pelajari materi baru',
          onclick: () => {
            newChat();
            setDraft('Jelaskan ringkasan materi pembelajaran terstruktur mengenai topik berikut: ');
            focusComposer();
          },
        }, icon('book'), span('Materi')),
      ),
      div({ class: 'search-field' }, icon('search'),
        input({
          id: 'chat-search', type: 'search', placeholder: 'Cari percakapan',
          'aria-label': 'Cari percakapan', value: () => search.val,
          oninput: event => { search.val = event.target.value; },
        }), kbd('⌘ K'),
      ),
    ),
    nav({ class: 'history', 'aria-label': 'Riwayat percakapan tersimpan' },
      div({ class: 'section-heading' }, h2('Percakapan Anda'), () => span({ class: 'chat-count' }, chats.val.length || '')),
      conversationList,
    ),
    div({ class: 'sidebar-bottom' },
      div({ class: 'profile-button' },
        span({ class: 'avatar' }, 'A'),
        span({ class: 'profile-copy' }, span({ class: 'profile-name' }, 'Ruang Kerja Anda'), span({ class: 'profile-detail' }, 'Pribadi · Tersimpan di server')),
      ),
    ),
  );
}
