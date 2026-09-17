import van from 'vanjs-core';

export const uiTexts = van.state({});
export const allChatPrompts = van.state([]);
export const activePrompts = van.state([]);
export const isLoaded = van.state(false);
export const appEnvState = van.state(
  typeof window !== 'undefined' && window.__INITIAL_UI_DATA__?.env
    ? window.__INITIAL_UI_DATA__.env
    : null
);

/**
 * Access a UI string by key directly from the database texts.
 * Strict rule: DO NOT USE ANY KIND OF FALLBACK!
 */
export function t(key) {
  return uiTexts.val[key] ?? '';
}

/**
 * Rotate prompts randomly across items from the database table.
 */
export function rotatePrompts() {
  const all = allChatPrompts.val;
  if (!all.length) {
    activePrompts.val = [];
    return;
  }
  if (all.length <= 4) {
    activePrompts.val = all;
    return;
  }
  const shuffled = [...all];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  activePrompts.val = shuffled.slice(0, 4);
}

export async function initUiTexts() {
  if (typeof window !== 'undefined' && window.__INITIAL_UI_DATA__) {
    const { texts, prompts } = window.__INITIAL_UI_DATA__;
    if (texts && Object.keys(texts).length > 0 && Array.isArray(prompts) && prompts.length > 0) {
      uiTexts.val = texts;
      allChatPrompts.val = prompts;
      rotatePrompts();
      isLoaded.val = true;
      return true;
    }
  }

  try {
    const res = await fetch('./api/ui-texts');
    if (!res.ok) return false;
    const data = await res.json();
    if (!data || !data.texts || typeof data.texts !== 'object') {
      return false;
    }
    const count = Object.keys(data.texts).length;
    if (count === 0) {
      return false;
    }
    uiTexts.val = data.texts;
    if (data?.env) {
      appEnvState.val = data.env;
    }

    // Load prompts from response or fallback to dedicated endpoint
    let prompts = Array.isArray(data.prompts) ? data.prompts : [];
    if (!prompts.length) {
      const pRes = await fetch('./api/chat-prompts').catch(() => null);
      if (pRes && pRes.ok) {
        const pData = await pRes.json();
        if (Array.isArray(pData?.prompts)) {
          prompts = pData.prompts;
        }
      }
    }

    if (!prompts.length) {
      return false;
    }

    allChatPrompts.val = prompts;
    rotatePrompts();
    isLoaded.val = true;
    return true;
  } catch {
    return false;
  }
}
