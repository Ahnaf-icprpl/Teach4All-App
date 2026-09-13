export const THEME_STORAGE_KEY = 'teach4all.theme.v1';
export const MAX_CHATS = 100;
export const MAX_INPUT = 6000;

export function emptyWorkspace() {
  return { version: 1, chats: [], activeId: null, draft: '', theme: 'system' };
}

export function loadTheme(storage) {
  try {
    const saved = storage?.getItem(THEME_STORAGE_KEY);
    return ['light', 'dark', 'system'].includes(saved) ? saved : 'system';
  } catch {
    return 'system';
  }
}

export function saveTheme(storage, theme) {
  try {
    storage?.setItem(THEME_STORAGE_KEY, theme);
  } catch {}
}

/**
 * Client-side conversation storage is removed. Conversations persist to database only.
 */
export function loadWorkspace(storage) {
  try {
    storage?.removeItem('teach4all.workspace.v1');
  } catch {}
  return { data: { ...emptyWorkspace(), theme: loadTheme(storage) }, error: '' };
}

export function saveWorkspace(storage, workspace) {
  if (workspace?.theme) {
    saveTheme(storage, workspace.theme);
  }
  return '';
}
