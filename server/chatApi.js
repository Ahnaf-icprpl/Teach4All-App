import {
  checkRateLimit,
  getClientIp,
  getClientLocation,
  getClientUserId,
  applyRateLimitHeaders,
  getEndpointConfig,
  enforceRateLimit,
} from './rateLimiter.js';
import { getSystemPrompt, injectSystemPrompt } from '../prompts/systemPrompt.js';
import { ConversationStreamWriter } from './db.js';
import {
  getConversationProvider,
  setConversationProvider,
  buildProviderRoutingPayload,
  extractProvider,
} from './providerCache.js';
import { buildWebSearchPlugin, buildWebSearchTool, isWebSearchRequested } from './webSearch.js';
import { buildQuizTool, accumulateToolCalls, handleCompletedToolCalls } from './quizTool.js';
import { buildMaterialTool, handleCompletedMaterialToolCalls, MATERIAL_TOOL_NAME } from './materialTool.js';
import { createChatMiddleware, dispatchApi } from './chatMiddleware.js';
import {
  createChatTask,
  getChatTask,
  updateChatTask,
  addTaskListener,
  removeTaskListener,
  appendTaskText,
  completeChatTask,
  failChatTask,
} from './chatTasks.js';

export const DEFAULT_MODEL = 'google/gemini-2.5-flash-lite';
export const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';

export { getSystemPrompt, createChatMiddleware, dispatchApi };

export function isPlaceholderKey(key) {
  if (!key || typeof key !== 'string') return true;
  const trimmed = key.trim();
  return !trimmed || trimmed.toLowerCase().includes('placeholder');
}

export function formatMessages(messages) {
  return injectSystemPrompt(messages);
}

export async function handleChatRequest(req, res, serverEnv = {}) {
  const clientIp = getClientIp(req);

  if (req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'Method Not Allowed' } }));
    return;
  }

  // Check rate limit completely in-memory against PostgreSQL endpoint policy
  if (!(await enforceRateLimit(req, res, '/api/chat', serverEnv))) {
    return;
  }

  const apiKey = (serverEnv.OPENROUTER_API_KEY !== undefined
    ? serverEnv.OPENROUTER_API_KEY
    : (process.env.OPENROUTER_API_KEY || '')).trim();
  const model = (serverEnv.OPENROUTER_MODEL !== undefined
    ? serverEnv.OPENROUTER_MODEL
    : (process.env.OPENROUTER_MODEL || DEFAULT_MODEL)).trim();

  if (!apiKey || isPlaceholderKey(apiKey)) {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: {
        message: 'OpenRouter API key is not configured on the server. Please set OPENROUTER_API_KEY in the server environment.',
      },
    }));
    return;
  }

  let parsed = req.body;
  if (parsed === undefined || parsed === null || (typeof parsed !== 'object' && typeof parsed !== 'string')) {
    let bodyStr = '';
    try {
      bodyStr = await new Promise((resolve, reject) => {
        let data = '';
        req.on('data', chunk => {
          data += chunk;
          if (data.length > 1e6) reject(new Error('Payload Too Large'));
        });
        req.on('end', () => resolve(data));
        req.on('error', reject);
      });
      parsed = JSON.parse(bodyStr || '{}');
    } catch (err) {
      const status = err.message === 'Payload Too Large' ? 413 : 400;
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: err.message || 'Invalid request' } }));
      return;
    }
  } else if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Invalid JSON body' } }));
      return;
    }
  }

  const {
    messages,
    conversationId,
    conversationTitle,
    userMessageId,
    assistantMessageId,
    webSearch,
  } = parsed;

  const effectiveUserId = req.userId || (typeof req.headers?.['x-guest-id'] === 'string' && /^guest_[a-zA-Z0-9_-]{8,64}$/.test(req.headers['x-guest-id'].trim()) ? req.headers['x-guest-id'].trim() : null);

  if (!effectiveUserId) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'Authentication required.' } }));
    return;
  }

  if (!Array.isArray(messages) || messages.length === 0) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'messages array is required' } }));
    return;
  }

  const databaseUrl = serverEnv.DATABASE_URL || process.env.DATABASE_URL;
  const lastUserMsg = messages.slice().reverse().find(m => m && m.role === 'user');
  const streamWriter = new ConversationStreamWriter({
    conversationId,
    userId: effectiveUserId,
    title: conversationTitle || (lastUserMsg ? (lastUserMsg.text || lastUserMsg.content || '').slice(0, 60) : 'New Conversation'),
    userMessage: lastUserMsg ? {
      id: userMessageId || lastUserMsg.id,
      role: 'user',
      text: lastUserMsg.text || lastUserMsg.content,
    } : null,
    assistantMessageId,
    databaseUrl,
  });

  // Non-blocking initialization of conversation and user message in DB
  streamWriter.init().catch(() => {});

  const startTime = Date.now();
  const promptText = lastUserMsg ? (lastUserMsg.text || lastUserMsg.content || '') : '';
  const cachedProvider = conversationId ? await getConversationProvider(conversationId) : null;
  const providerRouting = buildProviderRoutingPayload(conversationId, cachedProvider);

  const isQuizRequest = (promptText && /\b(kuis|quiz|soal|latihan|evaluasi|test me)\b/i.test(promptText)) ||
    (Array.isArray(messages) && messages.some(m => m && m.role === 'user' && /\b(kuis|quiz|soal|latihan|evaluasi|test me)\b/i.test(m.text || m.content || '')));
  const isMaterialRequest = (promptText && /\b(materi|modul|ringkasan|rangkuman|bacaan|pelajaran|material|study guide)\b/i.test(promptText)) ||
    (Array.isArray(messages) && messages.some(m => m && m.role === 'user' && /\b(materi|modul|ringkasan|rangkuman|bacaan|pelajaran|material|study guide)\b/i.test(m.text || m.content || '')));

  const enableSearch = isWebSearchRequested(webSearch, { isQuiz: isQuizRequest || isMaterialRequest });
  const webPlugin = enableSearch ? buildWebSearchPlugin(serverEnv) : null;
  const quizTool = buildQuizTool(serverEnv);
  const materialTool = buildMaterialTool(serverEnv);

  const formattedMessages = formatMessages(messages);
  const controller = new AbortController();
  const serverTimeoutId = setTimeout(() => controller.abort(), 15 * 60 * 1000);

  createChatTask({
    conversationId,
    userId: effectiveUserId,
    assistantMessageId,
    promptText,
    type: isQuizRequest ? 'quiz' : (isMaterialRequest ? 'material' : 'chat'),
  });

  // Client disconnect MUST NOT abort background execution
  req.on('close', () => {
    removeTaskListener(conversationId, res);
  });

  try {
    const upstream = await fetch(OPENROUTER_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://teach4all.local',
        'X-Title': 'Teach4All',
        'X-Forwarded-For': clientIp,
        'X-Real-IP': clientIp,
        ...(conversationId ? { 'X-Session-Id': conversationId } : {}),
      },
      body: JSON.stringify({
        model,
        messages: formattedMessages,
        stream: true,
        user: effectiveUserId || clientIp,
        tools: [quizTool, materialTool],
        ...(isQuizRequest && !isMaterialRequest ? { tool_choice: { type: 'function', function: { name: 'create_quiz' } } } : {}),
        ...(isMaterialRequest && !isQuizRequest ? { tool_choice: { type: 'function', function: { name: MATERIAL_TOOL_NAME } } } : {}),
        ...(webPlugin ? { plugins: [webPlugin] } : {}),
        ...providerRouting,
      }),
      signal: controller.signal,
    });

    if (!upstream.ok) {
      let errorMsg = '';
      try {
        const errJson = await upstream.json();
        errorMsg = errJson?.error?.message || '';
      } catch {
        try {
          const raw = await upstream.text();
          errorMsg = raw.slice(0, 150);
        } catch {}
      }

      const status = upstream.status;
      let userMsg = `Upstream error (${status})`;
      if (status === 401) {
        userMsg = 'Server authentication error with OpenRouter. Check server API key configuration.';
      } else if (status === 402) {
        userMsg = 'Insufficient OpenRouter credits on server account.';
      } else if (status === 429) {
        userMsg = 'OpenRouter rate limit reached. Please wait a moment and try again.';
      } else if (errorMsg) {
        userMsg = `OpenRouter error (${status}): ${errorMsg}`;
      }

      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: userMsg } }));
      return;
    }

    if (!upstream.body) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'No response body from OpenRouter.' } }));
      return;
    }

    let detectedProvider = extractProvider(upstream.headers) || cachedProvider;
    if (conversationId && detectedProvider) {
      setConversationProvider(conversationId, detectedProvider).catch(() => {});
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
      ...(detectedProvider ? { 'X-Provider': detectedProvider } : {}),
    });
    if (typeof res.flushHeaders === 'function') {
      res.flushHeaders();
    }
    addTaskListener(conversationId, res);

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let sseBuffer = '';
    let chunkCount = 0;
    let bytesStreamed = 0;
    let accumulatedText = '';
    const accumulatedToolCalls = {};
    const citations = [];

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunkCount++;
        if (value) bytesStreamed += value.length;

        // Stream text deltas to DB asynchronously
        sseBuffer += decoder.decode(value, { stream: true });
        const lines = sseBuffer.split('\n');
        sseBuffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;
          const data = trimmed.slice(6);
          if (data === '[DONE]') continue;
          try {
            const json = JSON.parse(data);
            if (conversationId && !detectedProvider && json.provider) {
              detectedProvider = extractProvider(null, json);
              if (detectedProvider) {
                setConversationProvider(conversationId, detectedProvider).catch(() => {});
              }
            }
            const delta = json.choices?.[0]?.delta?.content || '';
            if (delta) {
              accumulatedText += delta;
              if (!res.writableEnded && res.writable !== false) {
                res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: delta } }] })}\n\n`);
              }
              appendTaskText(conversationId, delta, res);
              streamWriter.writeChunk(delta);
            }
            const toolCallsDelta = json.choices?.[0]?.delta?.tool_calls;
            if (toolCallsDelta) {
              accumulateToolCalls(accumulatedToolCalls, toolCallsDelta);
            }
            const anns = json.choices?.[0]?.delta?.annotations || [];
            for (const ann of anns) {
              if (ann?.type === 'url_citation' && ann.url_citation?.url) {
                if (!citations.some(c => c.url === ann.url_citation.url)) {
                  citations.push(ann.url_citation);
                }
              }
            }
          } catch {}
        }
      }

      if (sseBuffer.trim().startsWith('data: ')) {
        const data = sseBuffer.trim().slice(6);
        if (data !== '[DONE]') {
          try {
            const json = JSON.parse(data);
            const delta = json.choices?.[0]?.delta?.content || '';
            if (delta) {
              accumulatedText += delta;
              if (!isQuizRequest && !isMaterialRequest) {
                if (!res.writableEnded && res.writable !== false) {
                  res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: delta } }] })}\n\n`);
                }
                appendTaskText(conversationId, delta, res);
                streamWriter.writeChunk(delta);
              }
            }
            const toolCallsDelta = json.choices?.[0]?.delta?.tool_calls;
            if (toolCallsDelta) {
              accumulateToolCalls(accumulatedToolCalls, toolCallsDelta);
            }
            const anns = json.choices?.[0]?.delta?.annotations || [];
            for (const ann of anns) {
              if (ann?.type === 'url_citation' && ann.url_citation?.url) {
                if (!citations.some(c => c.url === ann.url_citation.url)) {
                  citations.push(ann.url_citation);
                }
              }
            }
          } catch {}
        }
      }

      const hasMaterialToolCall = Object.values(accumulatedToolCalls).some(c => c.function?.name === MATERIAL_TOOL_NAME);
      const hasQuizToolCall = Object.values(accumulatedToolCalls).some(c => c.function?.name === 'create_quiz');

      if (hasMaterialToolCall || isMaterialRequest) {
        updateChatTask(conversationId, { status: 'building' });
        if (!res.writableEnded && res.writable !== false) {
          res.write('data: {"type":"quiz_status","status":"building"}\n\n');
        }
        const toolMap = hasMaterialToolCall ? accumulatedToolCalls : {
          0: { id: `call_mat_${Date.now()}`, type: 'function', function: { name: MATERIAL_TOOL_NAME, arguments: '{}' } },
        };
        const msgs = hasMaterialToolCall ? formattedMessages : [
          ...formattedMessages,
          { role: 'assistant', content: accumulatedText || 'Attempted to respond in text.' },
          { role: 'user', content: 'CRITICAL INSTRUCTION: You must NOT answer in plain conversational text or apologies. You MUST call the create_material function immediately with arguments: title, category, summary, difficulty, icon, color, and sections array (with section_number, title, content).' },
        ];
        await handleCompletedMaterialToolCalls({
          toolCallsMap: toolMap,
          serverEnv,
          userId: effectiveUserId,
          clientIp,
          conversationId,
          formattedMessages: msgs,
          streamWriter,
          res,
          broadcast: (chunk) => appendTaskText(conversationId, chunk, res),
          controller,
          apiKey,
          model,
          providerRouting,
        });
      } else if (hasQuizToolCall || isQuizRequest || Object.keys(accumulatedToolCalls).length > 0) {
        updateChatTask(conversationId, { status: 'building' });
        if (!res.writableEnded && res.writable !== false) {
          res.write('data: {"type":"quiz_status","status":"building"}\n\n');
        }
        const toolMap = (hasQuizToolCall || Object.keys(accumulatedToolCalls).length > 0) ? accumulatedToolCalls : {
          0: { id: `call_quiz_${Date.now()}`, type: 'function', function: { name: 'create_quiz', arguments: '{}' } },
        };
        const msgs = (hasQuizToolCall || Object.keys(accumulatedToolCalls).length > 0) ? formattedMessages : [
          ...formattedMessages,
          { role: 'assistant', content: accumulatedText || 'Attempted to respond in text.' },
          { role: 'user', content: 'CRITICAL INSTRUCTION: You must NOT answer in plain conversational text or apologies. You MUST call the create_quiz function immediately with arguments: title, category, summary, difficulty, icon, color, and questions.' },
        ];
        await handleCompletedToolCalls({
          toolCallsMap: toolMap,
          serverEnv,
          userId: effectiveUserId,
          clientIp,
          conversationId,
          formattedMessages: msgs,
          streamWriter,
          res,
          broadcast: (chunk) => appendTaskText(conversationId, chunk, res),
          controller,
          apiKey,
          model,
          providerRouting,
        });
      }

      if (citations.length > 0 && !accumulatedText.includes('http')) {
        const sourcesBlock = '\n\n**Sumber:**\n' + citations.map(c => `- [${c.title || c.url}](${c.url})`).join('\n');
        accumulatedText += sourcesBlock;
        if (!res.writableEnded && res.writable !== false) {
          res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: sourcesBlock } }] })}\n\n`);
        }
        appendTaskText(conversationId, sourcesBlock, res);
        streamWriter.writeChunk(sourcesBlock);
      }

      completeChatTask(conversationId, accumulatedText);
      if (!res.writableEnded && res.writable !== false) {
        res.write('data: [DONE]\n\n');
      }

      await streamWriter.finish();
    } finally {
      clearTimeout(serverTimeoutId);
      completeChatTask(conversationId, accumulatedText);
      if (!res.writableEnded && res.writable !== false) {
        try { res.end(); } catch {}
      }
    }
  } catch (err) {
    failChatTask(conversationId, err);
    if (controller.signal.aborted) {
      return;
    }
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Server proxy error communicating with OpenRouter.' } }));
    }
  }
}


