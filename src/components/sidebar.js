import van from 'vanjs-core';
import { icon } from '../icons.js';
import {
  chats, activeId, newChat, selectChat, modal, sidebarOpen,
  sidebarCollapsed, search, searchResults, searchLoading,
  onSearchInput, openQuickChat, historyLoading,
  historyLoadingMore, hasMoreChats, loadMoreChats, exportWorkspace,
} from '../state.js';
import { currentUser, login, signup, logout, openUserProfile } from '../auth.js';
import { t } from '../uiTexts.js';

const { aside, div, nav, button, span, input, h2, p, img } = van.tags;

export const profileMenuOpen = van.state(false);

function closeProfileMenu(restoreFocus = false) {
  profileMenuOpen.val = false;
  if (restoreFocus && typeof document !== 'undefined') {
    const btn = document.querySelector('.profile-button');
    if (btn) btn.focus();
  }
}

if (typeof document !== 'undefined') {
  document.addEventListener('click', (event) => {
    if (!profileMenuOpen.val) return;
    const sidebarBottom = document.querySelector('.sidebar-bottom');
    if (sidebarBottom && !sidebarBottom.contains(event.target)) {
      closeProfileMenu(false);
    }
  });

  document.addEventListener('keydown', (event) => {
    if (profileMenuOpen.val && event.key === 'Escape') {
      closeProfileMenu(true);
    }
  });
}

function profileDropupMenu() {
  return div({
    class: () => `profile-dropup-menu ${profileMenuOpen.val ? 'is-open' : ''}`,
    id: 'profile-dropup-menu',
    role: 'menu',
    'aria-hidden': () => String(!profileMenuOpen.val),
  },
    () => {
      const user = currentUser.val;
      if (!user) {
        return div({ class: 'profile-menu-content' },
          button({
            type: 'button',
            class: 'profile-menu-item',
            role: 'menuitem',
            onclick: (e) => {
              e.stopPropagation();
              closeProfileMenu(false);
              login();
            },
          },
            icon('login'),
            span(() => t('auth_login_button')),
          ),
          button({
            type: 'button',
            class: 'profile-menu-item',
            role: 'menuitem',
            onclick: (e) => {
              e.stopPropagation();
              closeProfileMenu(false);
              signup();
            },
          },
            icon('user'),
            span(() => t('auth_signup_with_clerk')),
          ),
          div({ class: 'profile-menu-divider' }),
          button({
            type: 'button',
            class: 'profile-menu-item',
            role: 'menuitem',
            onclick: (e) => {
              e.stopPropagation();
              closeProfileMenu(false);
              exportWorkspace();
            },
          },
            icon('download'),
            span(() => t('auth_export_workspace')),
          ),
        );
      }

      const displayName = user.name || user.email || t('sidebar_profile_name');
      return div({ class: 'profile-menu-content' },
        div({ class: 'profile-menu-header' },
          span({ class: 'profile-menu-name' }, displayName),
          user.email ? span({ class: 'profile-menu-email' }, user.email) : null,
        ),
        div({ class: 'profile-menu-divider' }),
        button({
          type: 'button',
          class: 'profile-menu-item',
          role: 'menuitem',
          onclick: (e) => {
            e.stopPropagation();
            closeProfileMenu(false);
            openUserProfile();
          },
        },
          icon('settings'),
          span(() => t('auth_manage_account')),
        ),
        button({
          type: 'button',
          class: 'profile-menu-item',
          role: 'menuitem',
          onclick: (e) => {
            e.stopPropagation();
            closeProfileMenu(false);
            exportWorkspace();
          },
        },
          icon('download'),
          span(() => t('auth_export_workspace')),
        ),
        div({ class: 'profile-menu-divider' }),
        button({
          type: 'button',
          class: 'profile-menu-item danger-item',
          role: 'menuitem',
          onclick: async (e) => {
            e.stopPropagation();
            closeProfileMenu(false);
            await logout();
          },
        },
          icon('logout'),
          span(() => t('auth_logout_button')),
        ),
      );
    },
  );
}

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

  const loadMoreSection = () => {
    if (search.val.trim() || (!hasMoreChats.val && !historyLoadingMore.val) || !chats.val.length) {
      return null;
    }
    if (historyLoadingMore.val) {
      return div({ class: 'chat-list-load-more', 'aria-live': 'polite' },
        div({ class: 'history-loading-more' },
          span({ class: 'typing-indicator', 'aria-label': () => t('sidebar_loading_more'), title: () => t('sidebar_loading_more') },
            span({ class: 'typing-dot' }),
            span({ class: 'typing-dot' }),
            span({ class: 'typing-dot' }),
          ),
          span({ class: 'loading-more-text' }, () => t('sidebar_loading_more')),
        ),
      );
    }
    return div({ class: 'chat-list-load-more' },
      button({
        class: 'load-more-button',
        onclick: () => loadMoreChats(),
        'aria-label': () => t('sidebar_load_more'),
      }, () => t('sidebar_load_more')),
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
    return div({ class: 'chat-list' },
      list.map(chat =>
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
      ),
      loadMoreSection,
    );
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
          onclick: () => openQuickChat('quiz'),
        }, icon('spark'), span(() => t('sidebar_quiz_button'))),
        button({
          class: 'quick-action-button',
          'aria-label': () => t('sidebar_material_aria'),
          onclick: () => openQuickChat('material'),
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
    nav({
      class: 'history',
      'aria-label': () => t('sidebar_history_aria'),
      onscroll: (event) => {
        const el = event.currentTarget;
        if (!search.val.trim() && hasMoreChats.val && !historyLoadingMore.val && !historyLoading.val) {
          if (el.scrollHeight - el.scrollTop - el.clientHeight < 80) {
            loadMoreChats();
          }
        }
      },
    },
      div({ class: 'section-heading' }, h2(() => t('sidebar_history_heading')), () => span({ class: 'chat-count' }, chats.val.length || '')),
      conversationList,
    ),
    div({
      class: 'sidebar-bottom',
      onclick: (e) => {
        if (e.target.closest('.profile-dropup-menu')) return;
        e.stopPropagation();
        profileMenuOpen.val = !profileMenuOpen.val;
      },
    },
      profileDropupMenu(),
      button({
        type: 'button',
        class: () => `profile-button ${currentUser.val ? 'is-authenticated' : 'is-guest'} ${profileMenuOpen.val ? 'is-menu-open' : ''}`,
        onclick: (e) => {
          e.stopPropagation();
          profileMenuOpen.val = !profileMenuOpen.val;
        },
        'aria-haspopup': 'menu',
        'aria-expanded': () => String(profileMenuOpen.val),
        'aria-controls': 'profile-dropup-menu',
        'aria-label': () => {
          const user = currentUser.val;
          return user ? (user.name || user.email || t('sidebar_profile_name')) : t('sidebar_profile_name');
        },
      },
        () => {
          const user = currentUser.val;
          if (!user) return span({ class: 'avatar' }, icon('user'));
          const displayName = user.name || user.email || t('sidebar_profile_name');
          return user.avatarUrl
            ? img({ src: user.avatarUrl, alt: displayName, class: 'avatar avatar-img', 'aria-hidden': 'true', referrerpolicy: 'no-referrer' })
            : span({ class: 'avatar' }, (displayName[0] || 'U').toUpperCase());
        },
        span({ class: 'profile-copy' },
          span({ class: 'profile-name' }, () => {
            const user = currentUser.val;
            return user ? (user.name || user.email || t('sidebar_profile_name')) : t('sidebar_profile_name');
          }),
          span({ class: 'profile-detail' }, () => {
            const user = currentUser.val;
            return user ? (user.email || t('sidebar_profile_detail')) : t('sidebar_profile_detail');
          }),
        ),
        span({ class: () => `profile-chevron ${profileMenuOpen.val ? 'is-open' : ''}` }, icon('chevron')),
      ),
    ),
  );
}
