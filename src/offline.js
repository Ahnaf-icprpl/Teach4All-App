import { offlineReady, updateReady, toast } from './state.js';
import { isDevEnv } from './env.js';
import { t } from './uiTexts.js';

let registration;

export async function registerOffline() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  try {
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!refreshing) {
        refreshing = true;
        location.reload();
      }
    });

    registration = await navigator.serviceWorker.register('./sw.js', { scope: './' });
    if (registration.waiting && isDevEnv()) updateReady.val = true;
    registration.addEventListener('updatefound', () => {
      const worker = registration.installing;
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller && isDevEnv()) {
          updateReady.val = true;
        }
      });
    });
    await navigator.serviceWorker.ready;
    offlineReady.val = true;
  } catch {
    toast(t('offline_setup_failed'));
  }
}

export function applyUpdate() {
  updateReady.val = false;
  if (!registration?.waiting) {
    location.reload();
    return;
  }
  navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true });
  registration.waiting.postMessage({ type: 'SKIP_WAITING' });
}
