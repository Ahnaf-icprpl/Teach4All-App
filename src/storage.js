export const STORAGE_KEY = 'teach4all.workspace.v1';
export const MAX_CHATS = 100;
export const MAX_INPUT = 6000;

export function emptyWorkspace() {
  return { version: 1, chats: [], activeId: null, draft: '', theme: 'system' };
}

export function validateWorkspace(data) {
  if (!data || data.version !== 1 || !Array.isArray(data.chats)) {
    throw new Error('This workspace format is not supported.');
  }
  if (data.chats.length > MAX_CHATS) throw new Error('Too many conversations.');
  const ids = new Set();
  const chats = data.chats.map(chat => {
    if (typeof chat.id !== 'string' || ids.has(chat.id) || typeof chat.title !== 'string'
      || !Array.isArray(chat.messages) || !Number.isFinite(chat.updatedAt)) {
      throw new Error('A saved conversation is invalid.');
    }
    ids.add(chat.id);
    const messages = chat.messages.map(message => {
      if (!['user', 'assistant'].includes(message.role) || typeof message.text !== 'string'
        || message.text.length > 12000 || typeof message.id !== 'string') {
        throw new Error('A saved message is invalid.');
      }
      return { id: message.id, role: message.role, text: message.text };
    });
    return { id: chat.id, title: chat.title.slice(0, 100), updatedAt: chat.updatedAt, messages };
  });
  return {
    version: 1, chats,
    activeId: ids.has(data.activeId) ? data.activeId : null,
    draft: typeof data.draft === 'string' ? data.draft.slice(0, MAX_INPUT) : '',
    theme: ['light', 'dark', 'system'].includes(data.theme) ? data.theme : 'system',
  };
}

export function loadWorkspace(storage) {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    return { data: raw ? validateWorkspace(JSON.parse(raw)) : emptyWorkspace(), error: '' };
  } catch {
    return { data: emptyWorkspace(), error: 'Saved chats could not be read. Storage is paused to protect your existing data. Export or clear saved data in Settings to start fresh.' };
  }
}

export function saveWorkspace(storage, workspace) {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(workspace));
    return '';
  } catch {
    return 'Your browser could not save these changes. Keep this tab open and export your chats from Settings.';
  }
}
