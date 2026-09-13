import van from 'vanjs-core';
import {
  loadWorkspace, saveWorkspace, emptyWorkspace, MAX_CHATS,
  loadThemeFromLocalDb, saveTheme,
} from './storage.js';
import {
  sendMessage as sendApiMessage, generateTitle, generateOfflineTitle,
  fetchConversations, fetchMessages, deleteConversationApi,
  renameConversationApi, TEST_USER_ID,
} from './router.js';
import { createReply } from './replies.js';

export { TEST_USER_ID };

let storage;
try {
  storage = window.localStorage;
  storage?.removeItem('teach4all.workspace.v1');
  storage?.removeItem('teach4all.openrouter-key.v1');
} catch { /* Storage unavailable */ }

const initialTheme = loadWorkspace(storage).data.theme;
export const chats = van.state([]);
export const activeId = van.state(null);
export const draft = van.state('');
export const theme = van.state(initialTheme);
export const loading = van.state(false);
export const historyLoading = van.state(false);
export const messagesLoading = van.state(false);
export const sidebarOpen = van.state(false);
export const sidebarCollapsed = van.state(false);
export const search = van.state('');
export const storageError = van.state('');
export const notice = van.state('');
export const online = van.state(typeof navigator !== 'undefined' ? navigator.onLine : true);
export const offlineReady = van.state(false);
export const updateReady = van.state(false);
export const modal = van.state(null);
let toastTimer;

export const currentChat = () => chats.val.find(chat => chat.id === activeId.val);
export const hasMessages = () => Boolean(activeId.val || currentChat()?.messages?.length);
export const workspace = () => ({
  version: 1, chats: chats.val, activeId: activeId.val, draft: draft.val, theme: theme.val,
});

export function persist() {
  saveWorkspace(storage, workspace());
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
  activeId.val = null;
  draft.val = '';
  search.val = '';
  sidebarOpen.val = false;
  persist();
  focusComposer();
}

export async function loadMessagesForChat(id) {
  if (messagesLoading.val) return;
  messagesLoading.val = true;
  try {
    const data = await fetchMessages(id, { userId: TEST_USER_ID });
    if (Array.isArray(data?.messages)) {
      const loadedMessages = data.messages.map(m => ({
        id: m.id,
        role: m.role,
        text: m.content || '',
        createdAt: m.created_at ? new Date(m.created_at).getTime() : Date.now(),
      }));
      chats.val = chats.val.map(c =>
        c.id === id ? { ...c, messages: loadedMessages, messagesLoaded: true } : c
      );
      requestAnimationFrame(() => {
        const pane = document.getElementById('messages');
        if (pane) pane.scrollTop = pane.scrollHeight;
      });
    }
  } catch (err) {
    console.warn('Failed to lazy load messages:', err.message);
  } finally {
    messagesLoading.val = false;
  }
}

export async function selectChat(id) {
  activeId.val = id;
  draft.val = '';
  sidebarOpen.val = false;
  persist();
  focusComposer();

  const chat = chats.val.find(c => c.id === id);
  if (chat && !chat.messagesLoaded) {
    await loadMessagesForChat(id);
  }
}

export async function loadChatHistory() {
  historyLoading.val = true;
  try {
    const data = await fetchConversations({ userId: TEST_USER_ID });
    if (Array.isArray(data?.conversations)) {
      const dbChats = data.conversations.map(c => ({
        id: c.id,
        title: c.title || 'Percakapan baru',
        messages: [],
        messagesLoaded: false,
        updatedAt: c.updated_at ? new Date(c.updated_at).getTime() : Date.now(),
      }));
      const existing = currentChat();
      if (existing && !dbChats.some(c => c.id === existing.id)) {
        chats.val = [existing, ...dbChats];
      } else {
        chats.val = dbChats;
      }
    }
  } catch (err) {
    console.warn('Failed to load chat history:', err.message);
  } finally {
    historyLoading.val = false;
  }
}

export function sendMessage() {
  const text = draft.val.trim();
  if (!text || loading.val) return;
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    toast('Anda tampaknya sedang luring. Sambungkan kembali untuk mengirim pesan.');
    return;
  }
  const existing = currentChat();
  if (!existing && chats.val.length >= MAX_CHATS) {
    toast('Ruang kerja Anda memiliki 100 obrolan. Ekspor atau hapus percakapan lama untuk memberi ruang.');
    return;
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
  
  requestAnimationFrame(() => {
    const pane = document.getElementById('messages');
    if (pane) pane.scrollTop = pane.scrollHeight;
  });

  const messageHistory = chat.messages.concat(userMessage);

  if (isNewConversation) {
    generateTitle(messageHistory, { conversationId: chat.id, userId: TEST_USER_ID })
      .then(generatedTitle => {
        if (generatedTitle && generatedTitle !== chat.title) {
          chats.val = chats.val.map(c => c.id === chat.id ? { ...c, title: generatedTitle } : c);
          persist();
        }
      })
      .catch(() => {});
  }
  
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
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
    requestAnimationFrame(() => {
      const pane = document.getElementById('messages');
      if (pane) pane.scrollTop = pane.scrollHeight;
    });
    return;
  }

  sendApiMessage(messageHistory, (chunkText) => {
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
    requestAnimationFrame(() => {
      const pane = document.getElementById('messages');
      if (pane) pane.scrollTop = pane.scrollHeight;
    });
  }, {
    conversationId: chat.id,
    conversationTitle: chat.title,
    userMessageId: userMessage.id,
    assistantMessageId: assistantMessage.id,
    userId: TEST_USER_ID,
  }).then(() => {
    loading.val = false;
    persist();
    focusComposer();
  }).catch((error) => {
    loading.val = false;
    const errorMessage = error.message || 'Gagal mengirim pesan. Silakan coba lagi.';

    if (errorMessage.toLowerCase().includes('rate limit')) {
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
      toast(errorMessage);
      persist();
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
    requestAnimationFrame(() => {
      const pane = document.getElementById('messages');
      if (pane) pane.scrollTop = pane.scrollHeight;
    });
  });
}

export function renameChat(id, title) {
  const trimmed = title.trim().slice(0, 100);
  if (!trimmed) return;
  chats.val = chats.val.map(chat => chat.id === id ? { ...chat, title: trimmed } : chat);
  persist();
  modal.val = null;
  renameConversationApi(id, trimmed, { userId: TEST_USER_ID }).catch(() => {});
}

export function deleteChat(id) {
  chats.val = chats.val.filter(chat => chat.id !== id);
  if (activeId.val === id) activeId.val = null;
  modal.val = null;
  toast('Percakapan telah dihapus.');
  deleteConversationApi(id, { userId: TEST_USER_ID }).catch(() => {});
}

export function clearWorkspace() {
  chats.val = [];
  activeId.val = null;
  draft.val = '';
  modal.val = null;
  toast('Percakapan dan draf telah dibersihkan.');
}

export function exportWorkspace() {
  const file = new Blob([JSON.stringify(workspace(), null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = `teach4all-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('Ekspor ruang kerja berhasil diunduh.');
}

export function setTheme(value) {
  theme.val = value;
  saveTheme(storage, value);
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => { online.val = true; });
  window.addEventListener('offline', () => { online.val = false; });
  loadThemeFromLocalDb().then(dbTheme => {
    if (dbTheme && dbTheme !== theme.val) {
      theme.val = dbTheme;
      saveTheme(storage, dbTheme);
    }
  }).catch(() => {});
  loadChatHistory().catch(() => {});
}
