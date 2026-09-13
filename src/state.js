import van from 'vanjs-core';
import { loadWorkspace, saveWorkspace, emptyWorkspace, MAX_CHATS } from './storage.js';
import { sendMessage as sendApiMessage } from './router.js';
import { createReply } from './replies.js';

let storage;
try {
  storage = window.localStorage;
  storage?.removeItem('teach4all.openrouter-key.v1');
} catch { /* The UI reports unavailable storage. */ }
const loaded = loadWorkspace(storage);
let storagePaused = Boolean(loaded.error);
export const chats = van.state(loaded.data.chats);
export const activeId = van.state(loaded.data.activeId);
export const draft = van.state(loaded.data.draft);
export const theme = van.state(loaded.data.theme);
export const loading = van.state(false);
export const sidebarOpen = van.state(false);
export const sidebarCollapsed = van.state(false);
export const search = van.state('');
export const storageError = van.state(loaded.error);
export const notice = van.state('');
export const online = van.state(typeof navigator !== 'undefined' ? navigator.onLine : true);
export const offlineReady = van.state(false);
export const updateReady = van.state(false);
export const modal = van.state(null);
let saveTimer;
let toastTimer;

export const currentChat = () => chats.val.find(chat => chat.id === activeId.val);
export const hasMessages = () => Boolean(currentChat()?.messages.length);
export const workspace = () => ({
  version: 1, chats: chats.val, activeId: activeId.val, draft: draft.val, theme: theme.val,
});

export function persist() {
  clearTimeout(saveTimer);
  if (!storagePaused) storageError.val = saveWorkspace(storage, workspace());
}

export function setDraft(value) {
  draft.val = value;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persist, 250);
}

export function toast(message) {
  clearTimeout(toastTimer);
  notice.val = message;
  toastTimer = setTimeout(() => { notice.val = ''; }, 4500);
}

export function focusComposer() {
  requestAnimationFrame(() => document.getElementById('message-input')?.focus());
}

export function newChat() {
  activeId.val = null;
  draft.val = '';
  search.val = '';
  sidebarOpen.val = false;
  persist();
  focusComposer();
}

export function selectChat(id) {
  activeId.val = id;
  draft.val = '';
  sidebarOpen.val = false;
  persist();
  focusComposer();
}

export function sendMessage() {
  const text = draft.val.trim();
  if (!text || loading.val) return;
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    toast('You appear to be offline. Reconnect to send messages.');
    return;
  }
  const existing = currentChat();
  if (!existing && chats.val.length >= MAX_CHATS) {
    toast('Your workspace has 100 chats. Export or delete an older chat to make room.');
    return;
  }
  const chat = existing || {
    id: crypto.randomUUID(), title: text.slice(0, 60), messages: [], updatedAt: Date.now(),
  };
  const userMessage = { id: crypto.randomUUID(), role: 'user', text };
  const assistantMessage = { id: crypto.randomUUID(), role: 'assistant', text: '' };
  
  chats.val = [{ 
    ...chat, 
    messages: [...chat.messages, userMessage, assistantMessage], 
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
  }).then(() => {
    loading.val = false;
    persist();
    focusComposer();
  }).catch((error) => {
    loading.val = false;
    const errorMessage = error.message || 'Failed to send message. Try again.';

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
  if (!title.trim()) return;
  chats.val = chats.val.map(chat => chat.id === id ? { ...chat, title: title.trim().slice(0, 100) } : chat);
  persist();
  modal.val = null;
}

export function deleteChat(id) {
  chats.val = chats.val.filter(chat => chat.id !== id);
  if (activeId.val === id) activeId.val = null;
  persist();
  modal.val = null;
  toast('Conversation deleted from this device.');
}

export function clearWorkspace() {
  try {
    storage.removeItem('teach4all.workspace.v1');
    storagePaused = false;
    storageError.val = '';
    chats.val = emptyWorkspace().chats;
    activeId.val = null;
    draft.val = '';
    persist();
    modal.val = null;
    toast('Saved conversations and draft cleared.');
  } catch {
    toast('Your browser is blocking storage access. Clear site data in browser settings.');
  }
}

export function exportWorkspace() {
  const file = new Blob([JSON.stringify(workspace(), null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = `teach4all-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('Workspace export downloaded.');
}

export function setTheme(value) {
  theme.val = value;
  persist();
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => { online.val = true; });
  window.addEventListener('offline', () => { online.val = false; });
  window.addEventListener('pagehide', persist);
  document.addEventListener('visibilitychange', () => { if (document.hidden) persist(); });
}
