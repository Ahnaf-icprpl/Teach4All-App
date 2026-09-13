import van from 'vanjs-core';
import { icon } from '../icons.js';
import {
  chats, activeId, newChat, selectChat, modal, sidebarOpen,
  sidebarCollapsed, search, searchResults, searchLoading,
  onSearchInput, setDraft, focusComposer, historyLoading,
} from '../state.js';
import { t } from '../uiTexts.js';

const { aside, div, nav, button, span, input, h2, p } = van.tags;

function emptyHistory() {
  return div({ class: 'empty-history' },
    icon('spark'),
    p(() => t('sidebar_empty_title')),
    p(() => t('sidebar_empty_desc')),
  );
}

export function Sidebar() {
  const filtered = () => {
    const term = search.val.trim();
    if (!term) return chats.val;
    if (searchResults.val !== null) return searchResults.val;
    const qLower = term.toLowerCase();
    return chats.val.filter(chat =>
      chat.title.toLowerCase().includes(qLower) ||
      (chat.messages && chat.messages.some(message => message.text?.toLowerCase().includes(qLower))),
    );
  };

  const conversationList = () => {
    if ((historyLoading.val && !chats.val.length) || (searchLoading.val && searchResults.val === null)) {
      return div({ class: 'empty-history' },
        span({ class: 'typing-indicator', 'aria-label': () => t('sidebar_history_loading_aria'), title: () => t('sidebar_history_loading_aria') },
          span({ class: 'typing-dot' }),
          span({ class: 'typing-dot' }),
          span({ class: 'typing-dot' }),
        ),
        p(() => t('sidebar_history_loading_text')),
      );
    }
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
          'aria-label': () => `${t('sidebar_chat_options_aria_prefix')}${chat.title}`,
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
    'aria-label': () => t('sidebar_aria_label'),
  },
    div({ class: 'sidebar-brand' },
      button({ class: 'brand', onclick: newChat, 'aria-label': () => t('sidebar_brand_aria') },
        icon('mountain'), span(() => t('sidebar_brand_prefix')), span({ class: 'brand-number' }, () => t('sidebar_brand_number')), span(() => t('sidebar_brand_suffix'))),
      button({
        class: 'icon-button close-sidebar',
        'aria-label': () => t('sidebar_close_button_aria'),
        onclick: () => {
          sidebarOpen.val = false;
          sidebarCollapsed.val = true;
        },
      }, icon('panelClose')),
    ),
    div({ class: 'sidebar-actions' },
      button({ class: 'new-chat-button', onclick: newChat },
        icon('plus'), span(() => t('sidebar_new_chat_button'))),
      div({ class: 'sidebar-quick-links' },
        button({
          class: 'quick-action-button',
          'aria-label': () => t('sidebar_quiz_aria'),
          onclick: () => {
            newChat();
            setDraft(t('sidebar_quiz_draft'));
            focusComposer();
          },
        }, icon('spark'), span(() => t('sidebar_quiz_button'))),
        button({
          class: 'quick-action-button',
          'aria-label': () => t('sidebar_material_aria'),
          onclick: () => {
            newChat();
            setDraft(t('sidebar_material_draft'));
            focusComposer();
          },
        }, icon('book'), span(() => t('sidebar_material_button'))),
      ),
      div({ class: 'search-field' }, icon('search'),
        input({
          id: 'chat-search', type: 'search', placeholder: () => t('sidebar_search_placeholder'),
          'aria-label': () => t('sidebar_search_aria'), value: () => search.val,
          oninput: event => onSearchInput(event.target.value),
        }),
      ),
    ),
    nav({ class: 'history', 'aria-label': () => t('sidebar_history_aria') },
      div({ class: 'section-heading' }, h2(() => t('sidebar_history_heading')), () => span({ class: 'chat-count' }, chats.val.length || '')),
      conversationList,
    ),
    div({ class: 'sidebar-bottom' },
      div({ class: 'profile-button' },
        span({ class: 'avatar' }, () => t('sidebar_profile_avatar')),
        span({ class: 'profile-copy' }, span({ class: 'profile-name' }, () => t('sidebar_profile_name')), span({ class: 'profile-detail' }, () => t('sidebar_profile_detail'))),
      ),
    ),
  );
}
