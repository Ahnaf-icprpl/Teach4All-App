import { offlineReady, updateReady, toast } from './state.js';

let registration;

export async function registerOffline() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  try {
    registration = await navigator.serviceWorker.register('./sw.js', { scope: './' });
    if (registration.waiting) updateReady.val = true;
    registration.addEventListener('updatefound', () => {
      const worker = registration.installing;
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) updateReady.val = true;
      });
    });
    await navigator.serviceWorker.ready;
    offlineReady.val = true;
  } catch {
    toast('Offline setup couldn’t finish. Your chats still save locally; reconnect and reload to try again.');
  }
}

export function applyUpdate() {
  if (!registration?.waiting) return;
  navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true });
  registration.waiting.postMessage({ type: 'SKIP_WAITING' });
}
