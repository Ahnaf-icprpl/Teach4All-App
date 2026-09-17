import van from 'vanjs-core';
import {
  loadWorkspace, saveWorkspace, emptyWorkspace, MAX_CHATS,
  loadThemeFromLocalDb, saveTheme,
} from './storage.js';
import {
  sendMessage as sendApiMessage, generateTitle, generateOfflineTitle,
  deleteConversationApi, renameConversationApi, getEffectiveUserId,
} from './router.js';
import {
  chats, activeId, historyLoading, historyLoadingMore, hasMoreChats,
  messagesLoading, search, searchResults, searchLoading,
  onSearchInput, loadMessagesForChat, loadChatHistory, loadMoreChats,
  abortActiveTaskSubscription, checkAndAttachActiveTask,
} from './chatStore.js';
import { createReply } from './replies.js';
import { isDevEnv } from './env.js';
import { t, rotatePrompts } from './uiTexts.js';

export {
  getEffectiveUserId,
  chats, activeId, historyLoading, historyLoadingMore, hasMoreChats,
  messagesLoading, search, searchResults, searchLoading,
  onSearchInput, loadMessagesForChat, loadChatHistory, loadMoreChats,
  abortActiveTaskSubscription, checkAndAttachActiveTask,
};

let storage;
try {
  storage = window.localStorage;
  storage?.removeItem('teach4all.workspace.v1');
  storage?.removeItem('teach4all.openrouter-key.v1');
} catch { /* Storage unavailable */ }

const initialTheme = loadWorkspace(storage).data.theme;
export const draft = van.state('');
export const theme = van.state(initialTheme);
export const webSearchEnabled = van.state(true);
export const searchingWeb = van.state(false);
export const buildingQuiz = van.state(false);
export const loading = van.state(false);
export const sidebarOpen = van.state(false);
export const sidebarCollapsed = van.state(false);
export const storageError = van.state('');
export const notice = van.state('');
export const online = van.state(typeof navigator !== 'undefined' ? navigator.onLine : true);
export const offlineReady = van.state(false);
export const updateReady = van.state(false);
export const modal = van.state(null);
let toastTimer;
let activeChatAbortController = null;
let activeGeneratingChatId = null;

export function abortActiveGeneration() {
  abortActiveTaskSubscription();
  if (activeChatAbortController) {
    try {
      activeChatAbortController.abort();
    } catch {}
    activeChatAbortController = null;
  }
  const targetChatId = activeGeneratingChatId || activeId.val;
  if (targetChatId) {
    activeGeneratingChatId = null;
    chats.val = chats.val.map(c => {
      if (c.id === targetChatId) {
        return {
          ...c,
          messages: c.messages.filter(m => m.role !== 'assistant' || (m.text && m.text.trim().length > 0)),
        };
      }
      return c;
    });
  }
  loading.val = false;
  searchingWeb.val = false;
  buildingQuiz.val = false;
}

export const currentChat = () => chats.val.find(chat => chat.id === activeId.val);
export const hasMessages = () => Boolean(activeId.val || currentChat()?.messages?.length);
export const workspace = () => ({
  version: 1, chats: chats.val, activeId: activeId.val, draft: draft.val, theme: theme.val,
  webSearchEnabled: webSearchEnabled.val,
});

export function persist() {
  saveWorkspace(storage, workspace());
}

export function toggleWebSearch() {
  webSearchEnabled.val = true;
}

export function setDraft(value) {
  draft.val = value;
}

export function toast(message) {
  clearTimeout(toastTimer);
  notice.val = message;
  toastTimer = setTimeout(() => { notice.val = ''; }, 4500);
}

export function focusComposer() {
  requestAnimationFrame(() => {
    const el = document.getElementById('message-input');
    if (el) {
      el.focus();
      if (typeof el.selectionStart === 'number') {
        el.selectionStart = el.selectionEnd = el.value.length;
      }
    }
  });
}

export function newChat() {
  if (activeGeneratingChatId) {
    abortActiveGeneration();
  }
  activeId.val = null;
  draft.val = '';
  search.val = '';
  sidebarOpen.val = false;
  rotatePrompts();
  persist();
  focusComposer();
}

export function startTopicChat(type, topicOrPrompt) {
  if (activeGeneratingChatId) {
    abortActiveGeneration();
  }
  if (chats.val.length >= MAX_CHATS) {
    toast(t('state_max_chats_notice'));
    return;
  }
  const isQuiz = type === 'quiz';
  const prefix = isQuiz ? t('sidebar_quiz_draft') : t('sidebar_material_draft');
  const custom = (topicOrPrompt || '').trim();
  let promptText = '';

  if (custom && custom.startsWith(prefix)) {
    promptText = custom;
  } else if (custom) {
    promptText = `${prefix}${custom}`;
  } else {
    promptText = `${prefix}${t('dialogs_cat_basic_science')}`;
  }

  modal.val = null;
  newChat();
  draft.val = promptText;
  sendMessage();
}

export function openQuickChat(type) {
  sidebarOpen.val = false;
  modal.val = { type };
}

export async function selectChat(id) {
  if (activeGeneratingChatId && activeGeneratingChatId !== id) {
    abortActiveGeneration();
  }
  activeId.val = id;
  draft.val = '';
  sidebarOpen.val = false;
  persist();
  focusComposer();

  let chat = chats.val.find(c => c.id === id);
  if (!chat && searchResults.val) {
    const foundInSearch = searchResults.val.find(c => c.id === id);
    if (foundInSearch) {
      chats.val = [foundInSearch, ...chats.val];
      chat = foundInSearch;
    }
  }

  if (chat && !chat.messagesLoaded) {
    await loadMessagesForChat(id);
  }

  checkAndAttachActiveTask(id, {
    setLoading: v => { loading.val = v; },
    setBuildingQuiz: v => { buildingQuiz.val = v; },
    setSearchingWeb: v => { searchingWeb.val = v; },
    isSending: activeGeneratingChatId === id,
  }).catch(() => {});
}

export function scrollMessagesToBottom(retry = false) {
  if (typeof document === 'undefined') return;
  const doScroll = () => {
    const pane = document.getElementById('messages');
    if (pane) pane.scrollTop = pane.scrollHeight;
    if (typeof window !== 'undefined' && (window.scrollY !== 0 || document.documentElement.scrollTop !== 0 || document.body.scrollTop !== 0)) {
      window.scrollTo(0, 0);
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
    }
  };
  requestAnimationFrame(doScroll);
  if (retry) {
    setTimeout(doScroll, 40);
    setTimeout(doScroll, 120);
    setTimeout(doScroll, 250);
  }
}

export function sendMessage(customText) {
  const text = (typeof customText === 'string' ? customText : draft.val).trim();
  if (!text || loading.val) return;
  const existing = currentChat();
  if (!existing && chats.val.length >= MAX_CHATS) {
    toast(t('state_max_chats_notice'));
    return;
  }

  if (activeGeneratingChatId) {
    abortActiveGeneration();
  }

  const isNewConversation = !existing || existing.messages.length === 0;
  const initialTitle = isNewConversation ? generateOfflineTitle(text) : (existing.title || generateOfflineTitle(text));
  const chat = existing || {
    id: crypto.randomUUID(), title: initialTitle, messages: [], messagesLoaded: true, updatedAt: Date.now(),
  };
  const userMessage = { id: crypto.randomUUID(), role: 'user', text };
  const assistantMessage = { id: crypto.randomUUID(), role: 'assistant', text: '' };
  
  chats.val = [{ 
    ...chat, 
    messages: [...chat.messages, userMessage, assistantMessage], 
    messagesLoaded: true,
    updatedAt: Date.now() 
  }, ...chats.val.filter(c => c.id !== chat.id)];
  activeId.val = chat.id;
  draft.val = '';
  loading.val = true;
  persist();
  scrollMessagesToBottom(true);

  const messageHistory = chat.messages.concat(userMessage);

  if (isNewConversation) {
    generateTitle(messageHistory, { conversationId: chat.id })
      .then(generatedTitle => {
        if (generatedTitle && generatedTitle !== chat.title) {
          chats.val = chats.val.map(c => c.id === chat.id ? { ...c, title: generatedTitle } : c);
          persist();
        }
      })
      .catch(() => {});
  }
  
  if ((typeof navigator !== 'undefined' && !navigator.onLine) || !online.val) {
    const replyText = createReply(text);
    chats.val = chats.val.map(c => {
      if (c.id === chat.id) {
        return {
          ...c,
          messages: c.messages.map(m => 
            m.id === assistantMessage.id ? { ...m, text: replyText } : m
          ),
          updatedAt: Date.now(),
        };
      }
      return c;
    });
    loading.val = false;
    persist();
    focusComposer();
    scrollMessagesToBottom();
    return;
  }

  const isQuizIntent = /\b(kuis|quiz|soal|latihan|evaluasi|test me)\b/i.test(userMessage.text || '');
  buildingQuiz.val = Boolean(isQuizIntent);
  searchingWeb.val = Boolean(online.val);

  const abortController = new AbortController();
  activeChatAbortController = abortController;
  activeGeneratingChatId = chat.id;

  sendApiMessage(messageHistory, (chunkText) => {
    if (activeGeneratingChatId !== chat.id) return;
    if (buildingQuiz.val) buildingQuiz.val = false;
    if (searchingWeb.val) searchingWeb.val = false;
    const updatedChats = chats.val.map(c => {
      if (c.id === chat.id) {
        return {
          ...c,
          messages: c.messages.map(m => 
            m.id === assistantMessage.id ? { ...m, text: chunkText } : m
          ),
          updatedAt: Date.now(),
        };
      }
      return c;
    });
    chats.val = updatedChats;
    if (activeId.val === chat.id) scrollMessagesToBottom();
  }, {
    conversationId: chat.id,
    conversationTitle: chat.title,
    userMessageId: userMessage.id,
    assistantMessageId: assistantMessage.id,
    userId: getEffectiveUserId(),
    webSearch: Boolean(online.val),
    signal: abortController.signal,
    onStatus: (status) => {
      if (activeGeneratingChatId !== chat.id) return;
      if (status === 'building_quiz') {
        buildingQuiz.val = true;
        searchingWeb.val = false;
      }
    },
  }).then(() => {
    if (activeGeneratingChatId === chat.id) {
      activeChatAbortController = null;
      activeGeneratingChatId = null;
      buildingQuiz.val = false;
      searchingWeb.val = false;
      loading.val = false;
      persist();
      focusComposer();
    }
  }).catch((error) => {
    if (activeGeneratingChatId === chat.id) {
      activeChatAbortController = null;
      activeGeneratingChatId = null;
      buildingQuiz.val = false;
      searchingWeb.val = false;
      loading.val = false;
    }

    if (error.message === 'Request was cancelled.') {
      return;
    }

    const errorMessage = error.message || t('state_send_failed');

    const isBlocked = errorMessage.toLowerCase().includes('rate limit') ||
      errorMessage.toLowerCase().includes('tamu') ||
      errorMessage.toLowerCase().includes('guest') ||
      errorMessage.toLowerCase().includes('masuk') ||
      errorMessage.toLowerCase().includes('login');

    if (isBlocked) {
      const updatedChats = chats.val.map(c => {
        if (c.id === chat.id) {
          return {
            ...c,
            messages: c.messages.map(m => 
              m.id === assistantMessage.id ? { ...m, text: `Error: ${errorMessage}` } : m
            ),
          };
        }
        return c;
      });
      chats.val = updatedChats;
      persist();
      if (typeof document !== 'undefined') {
        const inputEl = document.getElementById('message-input');
        if (inputEl) inputEl.blur();
      }
      scrollMessagesToBottom(true);
      return;
    }

    const replyText = createReply(text);
    const updatedChats = chats.val.map(c => {
      if (c.id === chat.id) {
        return {
          ...c,
          messages: c.messages.map(m => 
            m.id === assistantMessage.id ? { ...m, text: replyText } : m
          ),
          updatedAt: Date.now(),
        };
      }
      return c;
    });
    chats.val = updatedChats;
    persist();
    focusComposer();
    if (activeId.val === chat.id) scrollMessagesToBottom();
  });
}

export function renameChat(id, title) {
  const trimmed = title.trim().slice(0, 100);
  if (!trimmed) return;
  chats.val = chats.val.map(chat => chat.id === id ? { ...chat, title: trimmed } : chat);
  persist();
  modal.val = null;
  renameConversationApi(id, trimmed).catch(() => {});
}

export function deleteChat(id) {
  if (activeGeneratingChatId === id) {
    abortActiveGeneration();
  }
  chats.val = chats.val.filter(chat => chat.id !== id);
  if (activeId.val === id) activeId.val = null;
  modal.val = null;
  toast(t('state_chat_deleted'));
  deleteConversationApi(id).catch(() => {});
}

export function clearWorkspace() {
  abortActiveGeneration();
  chats.val = [];
  activeId.val = null;
  draft.val = '';
  modal.val = null;
  toast(t('state_workspace_cleared'));
}

export function exportWorkspace() {
  const file = new Blob([JSON.stringify(workspace(), null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = `teach4all-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast(t('state_export_success'));
}

export function setTheme(value) {
  theme.val = value;
  saveTheme(storage, value);
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => { online.val = true; });
  window.addEventListener('offline', () => { online.val = false; });
  window.addEventListener('beforeunload', () => {
    if (activeChatAbortController) {
      try {
        activeChatAbortController.abort();
      } catch {}
    }
  });
  window.addEventListener('pagehide', () => {
    if (activeChatAbortController) {
      try {
        activeChatAbortController.abort();
      } catch {}
    }
  });
  loadThemeFromLocalDb().then(dbTheme => {
    if (dbTheme && dbTheme !== theme.val) {
      theme.val = dbTheme;
      saveTheme(storage, dbTheme);
    }
  }).catch(() => {});
  loadChatHistory().then(() => {
    if (activeId.val) {
      checkAndAttachActiveTask(activeId.val, {
        setLoading: v => { loading.val = v; },
        setBuildingQuiz: v => { buildingQuiz.val = v; },
        setSearchingWeb: v => { searchingWeb.val = v; },
        isSending: activeGeneratingChatId === activeId.val,
      }).catch(() => {});
    }
  }).catch(() => {});
}
