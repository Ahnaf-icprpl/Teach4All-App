import van from 'vanjs-core';

export const uiTexts = van.state({});
export const isLoaded = van.state(false);

/**
 * Access a UI string by key directly from the database texts.
 * Strict rule: DO NOT USE ANY KIND OF FALLBACK!
 */
export function t(key) {
  return uiTexts.val[key] ?? '';
}

/**
 * Fetch all UI texts from the database.
 * If there is nothing on the database or fetch fails, return false so the app does not load.
 */
export async function initUiTexts() {
  try {
    const res = await fetch('./api/ui-texts');
    if (!res.ok) return false;
    const data = await res.json();
    if (!data || !data.texts || typeof data.texts !== 'object') {
      return false;
    }
    const count = Object.keys(data.texts).length;
    if (count === 0) {
      // If there is nothing on db, just do not load
      return false;
    }
    uiTexts.val = data.texts;
    isLoaded.val = true;
    return true;
  } catch {
    return false;
  }
}
