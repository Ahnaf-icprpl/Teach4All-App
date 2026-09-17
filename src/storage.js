export const THEME_STORAGE_KEY = 'teach4all.theme.v1';
export const QUIZZES_STORAGE_KEY = 'teach4all.quizzes.v2';
export const MATERIALS_STORAGE_KEY = 'teach4all.materials.v2';
export const CHATS_STORAGE_KEY = 'teach4all.chats.v2';
export const CHAT_MESSAGES_STORAGE_PREFIX = 'teach4all.chat_messages.v2:';
export const QUIZ_DETAIL_STORAGE_PREFIX = 'teach4all.quiz_detail.v2:';
export const MATERIAL_DETAIL_STORAGE_PREFIX = 'teach4all.material_detail.v2:';

export function getQuizzesStorageKey(userId) {
  return userId ? `${QUIZZES_STORAGE_KEY}:${userId}` : QUIZZES_STORAGE_KEY;
}

export function getMaterialsStorageKey(userId) {
  return userId ? `${MATERIALS_STORAGE_KEY}:${userId}` : MATERIALS_STORAGE_KEY;
}

export function getChatsStorageKey(userId) {
  return userId ? `${CHATS_STORAGE_KEY}:${userId}` : CHATS_STORAGE_KEY;
}

export function getChatMessagesStorageKey(chatId, userId) {
  return userId ? `${CHAT_MESSAGES_STORAGE_PREFIX}${userId}:${chatId}` : `${CHAT_MESSAGES_STORAGE_PREFIX}${chatId}`;
}

export function getQuizDetailStorageKey(quizId, userId) {
  return userId ? `${QUIZ_DETAIL_STORAGE_PREFIX}${userId}:${quizId}` : `${QUIZ_DETAIL_STORAGE_PREFIX}${quizId}`;
}

export function getMaterialDetailStorageKey(materialId, userId) {
  return userId ? `${MATERIAL_DETAIL_STORAGE_PREFIX}${userId}:${materialId}` : `${MATERIAL_DETAIL_STORAGE_PREFIX}${materialId}`;
}

export function saveCachedRecentChats(chatsList, userId) {
  if (typeof localStorage === 'undefined' || !Array.isArray(chatsList)) return;
  try {
    const top10 = chatsList.slice(0, 10).map(c => ({
      id: c.id,
      title: c.title,
      messages: Array.isArray(c.messages) ? c.messages : [],
      messagesLoaded: Boolean(c.messagesLoaded),
      updatedAt: c.updatedAt || Date.now(),
    }));
    localStorage.setItem(getChatsStorageKey(userId), JSON.stringify(top10));
    for (const c of top10) {
      if (Array.isArray(c.messages) && c.messages.length > 0) {
        localStorage.setItem(getChatMessagesStorageKey(c.id, userId), JSON.stringify(c.messages));
      }
    }
  } catch {}
}

export function loadCachedRecentChats(userId) {
  if (typeof localStorage === 'undefined') return [];
  try {
    const key = getChatsStorageKey(userId);
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(0, 10).map(c => {
      let messages = Array.isArray(c.messages) ? c.messages : [];
      let messagesLoaded = Boolean(c.messagesLoaded);
      if (messages.length === 0) {
        try {
          const msgRaw = localStorage.getItem(getChatMessagesStorageKey(c.id, userId));
          if (msgRaw) {
            const parsedMsgs = JSON.parse(msgRaw);
            if (Array.isArray(parsedMsgs) && parsedMsgs.length > 0) {
              messages = parsedMsgs;
              messagesLoaded = true;
            }
          }
        } catch {}
      }
      return { ...c, messages, messagesLoaded };
    });
  } catch {
    return [];
  }
}

export function saveCachedChatMessages(chatId, messages, userId) {
  if (typeof localStorage === 'undefined' || !chatId || !Array.isArray(messages)) return;
  try {
    localStorage.setItem(getChatMessagesStorageKey(chatId, userId), JSON.stringify(messages));
  } catch {}
}

export function loadCachedChatMessages(chatId, userId) {
  if (typeof localStorage === 'undefined' || !chatId) return null;
  try {
    const raw = localStorage.getItem(getChatMessagesStorageKey(chatId, userId));
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {}
  return null;
}

export function saveCachedQuizDetail(quizId, quizData, userId) {
  if (typeof localStorage === 'undefined' || !quizId || !quizData) return;
  try {
    localStorage.setItem(getQuizDetailStorageKey(quizId, userId), JSON.stringify(quizData));
  } catch {}
}

export function loadCachedQuizDetail(quizId, userId) {
  if (typeof localStorage === 'undefined' || !quizId) return null;
  try {
    const raw = localStorage.getItem(getQuizDetailStorageKey(quizId, userId));
    if (raw) return JSON.parse(raw);
  } catch {}
  return null;
}

export function saveCachedMaterialDetail(materialId, materialData, userId) {
  if (typeof localStorage === 'undefined' || !materialId || !materialData) return;
  try {
    localStorage.setItem(getMaterialDetailStorageKey(materialId, userId), JSON.stringify(materialData));
  } catch {}
}

export function loadCachedMaterialDetail(materialId, userId) {
  if (typeof localStorage === 'undefined' || !materialId) return null;
  try {
    const raw = localStorage.getItem(getMaterialDetailStorageKey(materialId, userId));
    if (raw) return JSON.parse(raw);
  } catch {}
  return null;
}
export const LOCAL_DB_NAME = 'teach4all_localdb';
export const LOCAL_DB_STORE = 'settings';
export const MAX_CHATS = 100;
export const MAX_INPUT = 6000;

export function emptyWorkspace() {
  return { version: 1, chats: [], activeId: null, draft: '', theme: 'system', webSearchEnabled: true };
}

/**
 * Access the client-side IndexedDB database ('teach4all_localdb').
 */
export function getLocalDb() {
  if (typeof window === 'undefined' || !window.indexedDB) {
    return Promise.resolve(null);
  }
  return new Promise(resolve => {
    try {
      const req = window.indexedDB.open(LOCAL_DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(LOCAL_DB_STORE)) {
          db.createObjectStore(LOCAL_DB_STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/**
 * Persist theme preference to IndexedDB local database.
 */
export async function saveThemeToLocalDb(theme) {
  try {
    const db = await getLocalDb();
    if (!db) return;
    const tx = db.transaction(LOCAL_DB_STORE, 'readwrite');
    const store = tx.objectStore(LOCAL_DB_STORE);
    store.put(theme, 'theme');
  } catch {}
}

/**
 * Read theme preference from IndexedDB local database.
 */
export async function loadThemeFromLocalDb() {
  try {
    const db = await getLocalDb();
    if (!db) return null;
    return new Promise(resolve => {
      try {
        const tx = db.transaction(LOCAL_DB_STORE, 'readonly');
        const store = tx.objectStore(LOCAL_DB_STORE);
        const req = store.get('theme');
        req.onsuccess = () => {
          const val = req.result;
          resolve(['light', 'dark', 'system'].includes(val) ? val : null);
        };
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  } catch {
    return null;
  }
}

/**
 * Read theme preference synchronously from localStorage with fallback migration.
 */
export function loadTheme(storage) {
  try {
    const saved = storage?.getItem(THEME_STORAGE_KEY);
    if (saved && ['light', 'dark', 'system'].includes(saved)) return saved;

    // Migrate from legacy workspace storage if present
    const legacyRaw = storage?.getItem('teach4all.workspace.v1');
    if (legacyRaw) {
      try {
        const legacy = JSON.parse(legacyRaw);
        if (legacy?.theme && ['light', 'dark', 'system'].includes(legacy.theme)) {
          storage?.setItem(THEME_STORAGE_KEY, legacy.theme);
          return legacy.theme;
        }
      } catch {}
    }
    return 'system';
  } catch {
    return 'system';
  }
}

/**
 * Save theme preference to both localStorage and IndexedDB local database.
 */
export function saveTheme(storage, theme) {
  try {
    storage?.setItem(THEME_STORAGE_KEY, theme);
  } catch {}
  saveThemeToLocalDb(theme);
}

/**
 * Client-side conversation storage is removed. Conversations persist to database only.
 */
export function loadWorkspace(storage) {
  const theme = loadTheme(storage);
  try {
    storage?.removeItem('teach4all.workspace.v1');
  } catch {}
  return { data: { ...emptyWorkspace(), theme }, error: '' };
}

export function saveWorkspace(storage, workspace) {
  if (workspace?.theme) {
    saveTheme(storage, workspace.theme);
  }
  return '';
}
