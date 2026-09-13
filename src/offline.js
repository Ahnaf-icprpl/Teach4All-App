import { offlineReady, updateReady, toast } from './state.js';
import { isDevEnv } from './env.js';

let registration;

export async function registerOffline() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  try {
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
    toast('Pemasangan mode luring belum selesai. Percakapan Anda tetap tersimpan secara lokal; sambungkan kembali dan muat ulang untuk mencoba lagi.');
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
