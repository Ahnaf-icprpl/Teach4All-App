import { toUuid, toUserId } from './dbCore.js';
import { enforceRateLimit } from './rateLimiter.js';

// In-memory registry of active background chat tasks
const tasks = new Map();
const TASK_TTL_MS = 10 * 60 * 1000; // Keep completed tasks in memory for 10 minutes

/**
 * Creates or retrieves a background task for a conversation.
 */
export function createChatTask({
  conversationId,
  userId,
  assistantMessageId,
  promptText = '',
  type = 'chat',
}) {
  const convId = toUuid(conversationId);
  const existing = tasks.get(convId);
  if (existing && (existing.status === 'processing' || existing.status === 'building')) {
    return existing;
  }

  const task = {
    id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    conversationId: convId,
    userId: toUserId(userId),
    assistantMessageId: toUuid(assistantMessageId),
    promptText,
    type, // 'quiz' | 'material' | 'chat'
    status: 'processing', // 'processing' | 'building' | 'completed' | 'failed'
    accumulatedText: '',
    cardMarker: '',
    finalMessage: '',
    error: null,
    startedAt: Date.now(),
    updatedAt: Date.now(),
    listeners: new Set(),
  };

  tasks.set(convId, task);
  return task;
}

/**
 * Gets a task by conversationId.
 */
export function getChatTask(conversationId) {
  const convId = toUuid(conversationId);
  return tasks.get(convId) || null;
}

/**
 * Updates a task's state.
 */
export function updateChatTask(conversationId, updates = {}) {
  const task = getChatTask(conversationId);
  if (!task) return null;

  Object.assign(task, updates, { updatedAt: Date.now() });

  if (updates.status === 'building') {
    broadcastToTask(conversationId, { type: 'quiz_status', status: 'building' });
  }

  return task;
}

/**
 * Adds an SSE listener (Express res) to a task.
 */
export function addTaskListener(conversationId, res) {
  const task = getChatTask(conversationId);
  if (!task) return false;

  task.listeners.add(res);

  // Send current catch-up state to the newly connected listener
  if (!res.writableEnded && res.writable) {
    if (task.status === 'building') {
      res.write('data: {"type":"quiz_status","status":"building"}\n\n');
    }
    if (task.accumulatedText) {
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: task.accumulatedText } }] })}\n\n`);
    }
  }

  return true;
}

/**
 * Removes an SSE listener from a task.
 */
export function removeTaskListener(conversationId, res) {
  const task = getChatTask(conversationId);
  if (!task) return;
  task.listeners.delete(res);
}

/**
 * Broadcasts an SSE payload to all active listeners for this conversation.
 */
export function broadcastToTask(conversationId, payload, excludeRes = null) {
  const task = getChatTask(conversationId);
  if (!task) return;

  const msg = typeof payload === 'string'
    ? (payload.startsWith('data: ') ? payload : `data: ${JSON.stringify({ choices: [{ delta: { content: payload } }] })}\n\n`)
    : `data: ${JSON.stringify(payload)}\n\n`;

  for (const res of task.listeners) {
    if (excludeRes && res === excludeRes) continue;
    if (!res.writableEnded && res.writable) {
      try {
        res.write(msg);
      } catch {
        task.listeners.delete(res);
      }
    } else {
      task.listeners.delete(res);
    }
  }
}

/**
 * Appends text delta to a task and broadcasts to all listeners.
 */
export function appendTaskText(conversationId, chunk, excludeRes = null) {
  const task = getChatTask(conversationId);
  if (!task || !chunk) return;

  task.accumulatedText += chunk;
  task.updatedAt = Date.now();

  broadcastToTask(conversationId, {
    choices: [{ delta: { content: chunk } }],
  }, excludeRes);
}

/**
 * Completes a task and cleanly ends all active listeners with [DONE].
 */
export function completeChatTask(conversationId, finalMessage = '') {
  const task = getChatTask(conversationId);
  if (!task || task.status === 'failed' || task.status === 'completed') return;

  task.status = 'completed';
  task.finalMessage = finalMessage || task.accumulatedText;
  task.updatedAt = Date.now();

  for (const res of task.listeners) {
    if (!res.writableEnded && res.writable) {
      try {
        res.write('data: [DONE]\n\n');
        res.end();
      } catch {}
    }
  }
  task.listeners.clear();

  setTimeout(() => {
    const current = tasks.get(task.conversationId);
    if (current && current.id === task.id) {
      tasks.delete(task.conversationId);
    }
  }, TASK_TTL_MS).unref?.();
}

/**
 * Fails a task with an error and notifies all listeners.
 */
export function failChatTask(conversationId, error) {
  const task = getChatTask(conversationId);
  if (!task) return;

  task.status = 'failed';
  task.error = error?.message || String(error);
  task.updatedAt = Date.now();

  for (const res of task.listeners) {
    if (!res.writableEnded && res.writable) {
      try {
        res.write(`data: ${JSON.stringify({ error: { message: task.error } })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
      } catch {}
    }
  }
  task.listeners.clear();

  setTimeout(() => {
    const current = tasks.get(task.conversationId);
    if (current && current.id === task.id) {
      tasks.delete(task.conversationId);
    }
  }, TASK_TTL_MS).unref?.();
}

/**
 * HTTP handler for GET /api/chat/status
 */
export async function handleChatStatusRequest(req, res, serverEnv = {}) {
  if (!(await enforceRateLimit(req, res, '/api/chat/status', serverEnv))) {
    return;
  }

  const parsedUrl = req.url ? new URL(req.url, 'http://localhost') : null;
  const conversationId = req.query?.conversationId || req.query?.id || parsedUrl?.searchParams.get('conversationId') || parsedUrl?.searchParams.get('id');
  if (!conversationId) {
    if (typeof res.status === 'function') {
      res.status(400).json({ error: { message: 'conversationId query parameter is required' } });
    } else {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'conversationId query parameter is required' } }));
    }
    return;
  }

  const task = getChatTask(conversationId);
  if (!task) {
    if (typeof res.status === 'function') {
      res.status(200).json({ active: false, status: 'none' });
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ active: false, status: 'none' }));
    }
    return;
  }

  // Verify ownership
  if (task.userId && (!req.userId || req.userId !== task.userId)) {
    if (typeof res.status === 'function') {
      res.status(403).json({ error: { message: 'Unauthorized task access' } });
    } else {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Unauthorized task access' } }));
    }
    return;
  }

  const isActive = task.status === 'processing' || task.status === 'building';
  const payload = {
    active: isActive,
    status: task.status,
    type: task.type,
    startedAt: task.startedAt,
    assistantMessageId: task.assistantMessageId,
    contentPreview: task.accumulatedText ? task.accumulatedText.slice(-300) : '',
  };
  if (typeof res.status === 'function') {
    res.status(200).json(payload);
  } else {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(payload));
  }
}

/**
 * HTTP handler for GET /api/chat/stream
 * Allows re-attaching or polling the live SSE stream of an active background task.
 */
export async function handleChatStreamRequest(req, res, serverEnv = {}) {
  if (!(await enforceRateLimit(req, res, '/api/chat/stream', serverEnv))) {
    return;
  }

  const parsedUrl = req.url ? new URL(req.url, 'http://localhost') : null;
  const conversationId = req.query?.conversationId || req.query?.id || parsedUrl?.searchParams.get('conversationId') || parsedUrl?.searchParams.get('id');
  if (!conversationId) {
    if (typeof res.status === 'function') {
      res.status(400).json({ error: { message: 'conversationId query parameter is required' } });
    } else {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'conversationId query parameter is required' } }));
    }
    return;
  }

  const task = getChatTask(conversationId);
  if (!task || (task.status !== 'processing' && task.status !== 'building')) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('data: [DONE]\n\n');
    res.end();
    return;
  }

  if (task.userId && (!req.userId || req.userId !== task.userId)) {
    res.status(403).json({ error: { message: 'Unauthorized task stream access' } });
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  if (typeof res.flushHeaders === 'function') {
    res.flushHeaders();
  }

  addTaskListener(conversationId, res);

  req.on('close', () => {
    removeTaskListener(conversationId, res);
  });
}
