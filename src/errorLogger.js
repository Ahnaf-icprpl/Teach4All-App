const seenErrors = new Set();
const MAX_SEEN = 50;

export function reportClientError(errorData = {}) {
  try {
    const key = `${errorData.type || ''}:${errorData.message || ''}:${errorData.source || ''}:${errorData.lineno || ''}`;
    if (seenErrors.has(key)) return;
    seenErrors.add(key);
    if (seenErrors.size > MAX_SEEN) {
      const first = seenErrors.values().next().value;
      seenErrors.delete(first);
    }

    const payload = JSON.stringify({
      ...errorData,
      path: window.location.pathname,
      href: window.location.href,
      referrer: document.referrer || '',
      userAgent: navigator.userAgent || '',
      timestamp: Date.now(),
    });

    if (navigator.sendBeacon) {
      navigator.sendBeacon('/api/log-error', new Blob([payload], { type: 'application/json' }));
    } else {
      fetch('/api/log-error', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        keepalive: true,
      }).catch(() => {});
    }
  } catch {}
}

export function initClientErrorMonitoring() {
  if (typeof window === 'undefined') return;

  window.addEventListener('error', event => {
    const err = event.error || {};
    reportClientError({
      type: 'uncaught_exception',
      message: event.message || err.message || 'Script error',
      source: event.filename,
      lineno: event.lineno,
      colno: event.colno,
      stack: err.stack,
    });
  });

  window.addEventListener('unhandledrejection', event => {
    const reason = event.reason || {};
    reportClientError({
      type: 'unhandled_rejection',
      message: typeof reason === 'string' ? reason : (reason.message || 'Unhandled promise rejection'),
      stack: reason.stack,
    });
  });
}
