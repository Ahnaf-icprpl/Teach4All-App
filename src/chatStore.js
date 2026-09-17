import van from 'vanjs-core';
import {
  fetchConversations, fetchMessages,
  fetchChatStatus, subscribeToChatStream,
} from './router.js';
import { t } from './uiTexts.js';

import {
  saveCachedRecentChats, loadCachedRecentChats,
  saveCachedChatMessages, loadCachedChatMessages,
} from './storage.js';
import { getEffectiveUserId } from './auth.js';

export const CHATS_PAGE_SIZE = 20;

export const chats = van.state([]);
export const activeId = van.state(null);
export const historyLoading = van.state(false);
export const historyLoadingMore = van.state(false);
export const hasMoreChats = van.state(true);
export const messagesLoading = van.state(false);
export const search = van.state('');
export const searchResults = van.state(null);
export const searchLoading = van.state(false);

let searchDebounceTimer = null;

export function onSearchInput(query) {
  search.val = query;
  const term = typeof query === 'string' ? query.trim() : '';
  if (!term) {
    if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
    searchResults.val = null;
    searchLoading.val = false;
    return;
  }

  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    const qLower = term.toLowerCase();
    searchResults.val = chats.val.filter(chat =>
      chat.title.toLowerCase().includes(qLower) ||
      (chat.messages && chat.messages.some(message => message.text?.toLowerCase().includes(qLower))),
    );
    searchLoading.val = false;
    return;
  }

  searchLoading.val = true;
  if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(async () => {
    try {
      const data = await fetchConversations({ query: term, limit: 50 });
      if (Array.isArray(data?.conversations)) {
        searchResults.val = data.conversations.map(c => {
          const existing = chats.val.find(item => item.id === c.id);
          return {
            id: c.id,
            title: c.title || t('state_default_title'),
            messages: existing ? existing.messages : [],
            messagesLoaded: existing ? existing.messagesLoaded : false,
            updatedAt: c.updated_at ? new Date(c.updated_at).getTime() : Date.now(),
          };
        });
      } else {
        searchResults.val = [];
      }
    } catch (err) {
      const qLower = term.toLowerCase();
      searchResults.val = chats.val.filter(chat =>
        chat.title.toLowerCase().includes(qLower) ||
        (chat.messages && chat.messages.some(message => message.text?.toLowerCase().includes(qLower))),
      );
    } finally {
      searchLoading.val = false;
    }
  }, 250);
}

export async function prefetchMessagesForRecentChats(recentChats) {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return;
  const userId = getEffectiveUserId();
  const limit = Math.min(recentChats.length, 10);
  for (let i = 0; i < limit; i++) {
    const chat = recentChats[i];
    if (!chat || !chat.id) continue;
    const cachedMsgs = loadCachedChatMessages(chat.id, userId);
    if (cachedMsgs && cachedMsgs.length > 0 && chat.messagesLoaded) continue;
    try {
      const data = await fetchMessages(chat.id);
      if (Array.isArray(data?.messages)) {
        const loadedMessages = data.messages
          .filter(m => m && (m.role === 'user' || (m.content && m.content.trim().length > 0)))
          .map(m => ({
            id: m.id,
            role: m.role,
            text: m.content || '',
            createdAt: m.created_at ? new Date(m.created_at).getTime() : Date.now(),
          }));
        chats.val = chats.val.map(c =>
          c.id === chat.id ? { ...c, messages: loadedMessages, messagesLoaded: true } : c
        );
        saveCachedChatMessages(chat.id, loadedMessages, userId);
      }
    } catch {}
  }
  saveCachedRecentChats(chats.val, userId);
}

export async function loadMessagesForChat(id) {
  const userId = getEffectiveUserId();
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    const cached = loadCachedChatMessages(id, userId);
    if (cached && cached.length > 0) {
      chats.val = chats.val.map(c =>
        c.id === id ? { ...c, messages: cached, messagesLoaded: true } : c
      );
    }
    return;
  }
  if (messagesLoading.val) return;
  messagesLoading.val = true;
  try {
    const data = await fetchMessages(id);
    if (Array.isArray(data?.messages)) {
      const loadedMessages = data.messages
        .filter(m => m && (m.role === 'user' || (m.content && m.content.trim().length > 0)))
        .map(m => ({
          id: m.id,
          role: m.role,
          text: m.content || '',
          createdAt: m.created_at ? new Date(m.created_at).getTime() : Date.now(),
        }));
      chats.val = chats.val.map(c =>
        c.id === id ? { ...c, messages: loadedMessages, messagesLoaded: true } : c
      );
      saveCachedChatMessages(id, loadedMessages, userId);
      saveCachedRecentChats(chats.val, userId);
      requestAnimationFrame(() => {
        const pane = document.getElementById('messages');
        if (pane) pane.scrollTop = pane.scrollHeight;
      });
    }
  } catch (err) {
    const cached = loadCachedChatMessages(id, userId);
    if (cached && cached.length > 0) {
      chats.val = chats.val.map(c =>
        c.id === id ? { ...c, messages: cached, messagesLoaded: true } : c
      );
    }
  } finally {
    messagesLoading.val = false;
  }
}

export async function loadChatHistory() {
  const userId = getEffectiveUserId();
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    const cached = loadCachedRecentChats(userId);
    if (cached.length > 0) {
      chats.val = cached;
    }
    historyLoading.val = false;
    return;
  }
  historyLoading.val = true;
  try {
    const data = await fetchConversations({ limit: CHATS_PAGE_SIZE, offset: 0 });
    if (Array.isArray(data?.conversations)) {
      const dbChats = data.conversations.map(c => ({
        id: c.id,
        title: c.title || t('state_default_title'),
        messages: [],
        messagesLoaded: false,
        updatedAt: c.updated_at ? new Date(c.updated_at).getTime() : Date.now(),
      }));
      const active = chats.val.find(c => c.id === activeId.val);
      if (active && !dbChats.some(c => c.id === active.id)) {
        chats.val = [active, ...dbChats];
      } else {
        chats.val = dbChats;
      }
      hasMoreChats.val = typeof data.hasMore === 'boolean'
        ? data.hasMore
        : dbChats.length === CHATS_PAGE_SIZE;
      saveCachedRecentChats(chats.val, userId);
      prefetchMessagesForRecentChats(chats.val.slice(0, 10)).catch(() => {});
    }
  } catch (err) {
    const cached = loadCachedRecentChats(userId);
    if (cached.length > 0 && chats.val.length === 0) {
      chats.val = cached;
    }
  } finally {
    historyLoading.val = false;
  }
}

export async function loadMoreChats() {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return;
  if (historyLoadingMore.val || historyLoading.val || !hasMoreChats.val) return;
  historyLoadingMore.val = true;
  try {
    const currentCount = chats.val.length;
    const data = await fetchConversations({
      limit: CHATS_PAGE_SIZE,
      offset: currentCount,
    });
    if (Array.isArray(data?.conversations)) {
      const newBatch = data.conversations.map(c => ({
        id: c.id,
        title: c.title || t('state_default_title'),
        messages: [],
        messagesLoaded: false,
        updatedAt: c.updated_at ? new Date(c.updated_at).getTime() : Date.now(),
      }));
      const existingIds = new Set(chats.val.map(c => c.id));
      const uniqueNew = newBatch.filter(c => !existingIds.has(c.id));
      chats.val = [...chats.val, ...uniqueNew];
      hasMoreChats.val = typeof data.hasMore === 'boolean'
        ? data.hasMore
        : newBatch.length === CHATS_PAGE_SIZE;
      if (newBatch.length === 0) {
        hasMoreChats.val = false;
      }
    } else {
      hasMoreChats.val = false;
    }
  } catch (err) {
    // Silent failover
  } finally {
    historyLoadingMore.val = false;
  }
}

export function resetChatStore() {
  chats.val = [];
  activeId.val = null;
  searchResults.val = null;
  hasMoreChats.val = true;
}

let activeTaskAbortController = null;
let activeTaskChatId = null;

export function abortActiveTaskSubscription() {
  if (activeTaskAbortController) {
    try { activeTaskAbortController.abort(); } catch {}
    activeTaskAbortController = null;
  }
  activeTaskChatId = null;
}

export async function checkAndAttachActiveTask(chatId, {
  setLoading,
  setBuildingQuiz,
  setSearchingWeb,
  isSending = false,
} = {}) {
  if (!chatId || isSending) return;
  if (typeof navigator !== 'undefined' && !navigator.onLine) return;
  try {
    const status = await fetchChatStatus(chatId);
    if (!status || !status.active || activeId.val !== chatId) return;

    if (typeof setLoading === 'function') setLoading(true);
    if (typeof setBuildingQuiz === 'function') {
      setBuildingQuiz(status.status === 'building' || status.type === 'quiz' || status.type === 'material');
    }
    if (typeof setSearchingWeb === 'function') {
      setSearchingWeb(status.status === 'processing' && status.type === 'chat');
    }

    abortActiveTaskSubscription();
    const abortController = new AbortController();
    activeTaskAbortController = abortController;
    activeTaskChatId = chatId;

    // Ensure an assistant message placeholder exists to receive streamed text
    chats.val = chats.val.map(c => {
      if (c.id === chatId) {
        const msgs = [...(c.messages || [])];
        const last = msgs[msgs.length - 1];
        if (!last || last.role !== 'assistant') {
          msgs.push({
            id: status.assistantMessageId || `ast_${Date.now()}`,
            role: 'assistant',
            text: status.contentPreview || '',
          });
        }
        return { ...c, messages: msgs };
      }
      return c;
    });

    await subscribeToChatStream(chatId, (fullText) => {
      if (activeTaskChatId !== chatId) return;
      if (typeof setBuildingQuiz === 'function') setBuildingQuiz(false);
      if (typeof setSearchingWeb === 'function') setSearchingWeb(false);
      chats.val = chats.val.map(c => {
        if (c.id === chatId) {
          const msgs = (c.messages || []).map((m, idx) =>
            idx === c.messages.length - 1 && m.role === 'assistant' ? { ...m, text: fullText } : m
          );
          return { ...c, messages: msgs };
        }
        return c;
      });
      requestAnimationFrame(() => {
        const pane = document.getElementById('messages');
        if (pane && activeId.val === chatId) pane.scrollTop = pane.scrollHeight;
      });
    }, {
      signal: abortController.signal,
      onStatus: (st) => {
        if (activeTaskChatId !== chatId) return;
        if (st === 'building_quiz' && typeof setBuildingQuiz === 'function') {
          setBuildingQuiz(true);
          if (typeof setSearchingWeb === 'function') setSearchingWeb(false);
        }
      },
    });

    if (activeTaskChatId === chatId) {
      activeTaskAbortController = null;
      activeTaskChatId = null;
      if (typeof setLoading === 'function') setLoading(false);
      if (typeof setBuildingQuiz === 'function') setBuildingQuiz(false);
      if (typeof setSearchingWeb === 'function') setSearchingWeb(false);
      await loadMessagesForChat(chatId);
    }
  } catch (err) {
    if (activeTaskChatId === chatId) {
      activeTaskAbortController = null;
      activeTaskChatId = null;
      if (typeof setLoading === 'function') setLoading(false);
      if (typeof setBuildingQuiz === 'function') setBuildingQuiz(false);
      if (typeof setSearchingWeb === 'function') setSearchingWeb(false);
    }
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('teach4all:auth-changed', () => {
    resetChatStore();
    loadChatHistory().catch(() => {});
  });
  window.addEventListener('online', () => {
    loadChatHistory().catch(() => {});
  });
}

