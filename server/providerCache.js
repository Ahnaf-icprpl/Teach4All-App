/**
 * Provider caching and sticky routing manager for conversations.
 * Optimizes prompt cache hit rates, lowers latency, and minimizes LLM cost
 * across multi-turn chats via OpenRouter provider sticky routing and session pinning.
 */

export const inMemoryProviderCache = new Map();

// Periodic cleanup of expired entries in memory every 5 minutes
const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of inMemoryProviderCache.entries()) {
    if (entry.expiresAt <= now) {
      inMemoryProviderCache.delete(key);
    }
  }
}, 300000);

if (cleanupTimer.unref) {
  cleanupTimer.unref();
}

/**
 * Normalize provider string to standard lowercase format.
 * @param {string} provider
 * @returns {string}
 */
export function normalizeProvider(provider) {
  if (!provider || typeof provider !== 'string') return '';
  return provider.trim().toLowerCase();
}

/**
 * Get the cached provider for a conversation.
 * Checks in-memory cache first, then Redis if available.
 * @param {string} conversationId
 * @param {{ redisClient?: any }} options
 * @returns {Promise<string|null>}
 */
export async function getConversationProvider(conversationId, { redisClient } = {}) {
  if (!conversationId) return null;

  // 1. Check in-memory cache
  const local = inMemoryProviderCache.get(conversationId);
  if (local && local.expiresAt > Date.now()) {
    return local.provider;
  }

  // 2. Check Redis if available
  if (redisClient && typeof redisClient.get === 'function') {
    try {
      const redisKey = `teach4all:convo:provider:${conversationId}`;
      const val = await redisClient.get(redisKey);
      if (val && typeof val === 'string') {
        const normalized = normalizeProvider(val);
        if (normalized) {
          inMemoryProviderCache.set(conversationId, {
            provider: normalized,
            expiresAt: Date.now() + 86400000,
          });
          return normalized;
        }
      }
    } catch {
      // Redis get failed, continue gracefully
    }
  }

  return null;
}

/**
 * Cache the provider for a conversation.
 * Updates both in-memory store and Redis with TTL (default 24h).
 * @param {string} conversationId
 * @param {string} provider
 * @param {{ redisClient?: any, ttlSeconds?: number }} options
 * @returns {Promise<string|null>}
 */
export async function setConversationProvider(conversationId, provider, { redisClient, ttlSeconds = 86400 } = {}) {
  if (!conversationId) return null;
  const normalized = normalizeProvider(provider);
  if (!normalized) return null;

  inMemoryProviderCache.set(conversationId, {
    provider: normalized,
    expiresAt: Date.now() + (ttlSeconds * 1000),
  });

  if (redisClient && typeof redisClient.set === 'function') {
    try {
      const redisKey = `teach4all:convo:provider:${conversationId}`;
      await redisClient.set(redisKey, normalized, 'EX', ttlSeconds);
    } catch {
      // Redis set failed, continue gracefully
    }
  }

  return normalized;
}

/**
 * Clear cached provider for a conversation.
 * @param {string} conversationId
 * @param {{ redisClient?: any }} options
 * @returns {Promise<void>}
 */
export async function clearConversationProvider(conversationId, { redisClient } = {}) {
  if (!conversationId) return;
  inMemoryProviderCache.delete(conversationId);
  if (redisClient && typeof redisClient.del === 'function') {
    try {
      await redisClient.del(`teach4all:convo:provider:${conversationId}`);
    } catch {}
  }
}

/**
 * Build provider routing payload and sticky session keys for OpenRouter.
 * Sets session_id, prompt_cache_key, cache_control, and provider.order when cached.
 * @param {string} conversationId
 * @param {string|null} cachedProvider
 * @returns {Record<string, any>}
 */
export function buildProviderRoutingPayload(conversationId, cachedProvider = null) {
  const payload = {
    cache_control: { type: 'ephemeral' },
  };

  if (conversationId) {
    payload.session_id = conversationId;
    payload.prompt_cache_key = conversationId;
  }

  if (cachedProvider) {
    const normalized = normalizeProvider(cachedProvider);
    if (normalized) {
      payload.provider = {
        order: [normalized],
        allow_fallbacks: true,
      };
    }
  }

  return payload;
}

/**
 * Extract provider name from OpenRouter response headers or SSE chunk.
 * @param {Headers|any} headers
 * @param {any} chunkJson
 * @returns {string|null}
 */
export function extractProvider(headers, chunkJson = null) {
  if (headers && typeof headers.get === 'function') {
    const headerProvider = headers.get('x-openrouter-provider') || headers.get('x-provider');
    if (headerProvider) return normalizeProvider(headerProvider);
  }
  if (chunkJson && typeof chunkJson.provider === 'string') {
    return normalizeProvider(chunkJson.provider);
  }
  return null;
}
