export const THEME_STORAGE_KEY = 'teach4all.theme.v1';
export const QUIZZES_STORAGE_KEY = 'teach4all.quizzes.v1';
export const MATERIALS_STORAGE_KEY = 'teach4all.materials.v1';
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
