import test from 'node:test';
import assert from 'node:assert';
import { EventEmitter } from 'node:events';
import {
  getModel,
  isPlaceholderKey,
  sendMessage,
  CHAT_API_URL,
  DEFAULT_MODEL,
} from '../src/router.js';
import {
  handleChatRequest,
  createChatMiddleware,
  formatMessages,
  getSystemPrompt,
  DEFAULT_MODEL as SERVER_DEFAULT_MODEL,
  OPENROUTER_API_URL,
} from '../server/chatApi.js';
import { SYSTEM_PROMPT, injectSystemPrompt } from '../prompts/systemPrompt.js';
import { ConversationStreamWriter, DEFAULT_USER_ID, runSql } from '../server/db.js';

test('router uses google/gemini-2.5-flash-lite by default', () => {
  assert.strictEqual(DEFAULT_MODEL, 'google/gemini-2.5-flash-lite');
  assert.strictEqual(SERVER_DEFAULT_MODEL, 'google/gemini-2.5-flash-lite');
  assert.strictEqual(getModel(), DEFAULT_MODEL);
});

test('isPlaceholderKey identifies empty or placeholder keys', () => {
  assert.strictEqual(isPlaceholderKey(''), true);
  assert.strictEqual(isPlaceholderKey(null), true);
  assert.strictEqual(isPlaceholderKey(undefined), true);
  assert.strictEqual(isPlaceholderKey('sk-or-placeholder-key-replace-with-your-actual-key'), true);
  assert.strictEqual(isPlaceholderKey('my-placeholder-key'), true);
  assert.strictEqual(isPlaceholderKey('sk-or-v1-abcdef1234567890'), false);
});

test('client sendMessage sends messages to /api/chat without any API key in payload', async () => {
  const originalFetch = globalThis.fetch;
  let interceptedUrl = '';
  let interceptedOptions = null;

  globalThis.fetch = async (url, options) => {
    interceptedUrl = url;
    interceptedOptions = options;

    const sseData = [
      'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":" world!"}}]}\n\n',
      'data: [DONE]\n\n',
    ].join('');

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(sseData));
        controller.close();
      },
    });

    return new Response(stream, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    });
  };

  try {
    const receivedChunks = [];
    const result = await sendMessage(
      [{ role: 'user', text: 'Hi there' }],
      chunk => receivedChunks.push(chunk)
    );

    assert.strictEqual(interceptedUrl, CHAT_API_URL);
    assert.strictEqual(interceptedOptions.method, 'POST');
    assert.strictEqual(interceptedOptions.headers['Content-Type'], 'application/json');
    // Ensure no Authorization header is sent from client
    assert.strictEqual(interceptedOptions.headers['Authorization'], undefined);

    const body = JSON.parse(interceptedOptions.body);
    assert.ok(Array.isArray(body.messages));
    assert.strictEqual(body.messages[0].text, 'Hi there');
    // Ensure no apiKey property is sent from client
    assert.strictEqual(body.apiKey, undefined);

    assert.strictEqual(result, 'Hello world!');
    assert.deepStrictEqual(receivedChunks, ['Hello', 'Hello world!']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('client sendMessage handles server error response', async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () => {
    return new Response(
      JSON.stringify({ error: { message: 'OpenRouter API key is not configured on the server.' } }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  };

  try {
    await assert.rejects(
      async () => {
        await sendMessage([{ role: 'user', text: 'test' }], () => {});
      },
      /OpenRouter API key is not configured on the server/
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function createMockReqRes({ method = 'POST', url = '/api/chat', body = null } = {}) {
  const req = new EventEmitter();
  req.method = method;
  req.url = url;

  const res = {
    statusCode: 200,
    headers: {},
    body: '',
    ended: false,
    headersSent: false,
    writeHead(status, headers = {}) {
      this.statusCode = status;
      this.headers = { ...this.headers, ...headers };
      this.headersSent = true;
    },
    write(chunk) {
      this.body += (typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString());
    },
    end(chunk = '') {
      if (chunk) this.write(chunk);
      this.ended = true;
    },
  };

  process.nextTick(() => {
    if (body !== null) {
      req.emit('data', typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.emit('end');
  });

  return { req, res };
}

test('server handleChatRequest rejects non-POST requests with 405', async () => {
  const { req, res } = createMockReqRes({ method: 'GET' });
  await handleChatRequest(req, res, { OPENROUTER_API_KEY: 'sk-or-real' });

  assert.strictEqual(res.statusCode, 405);
  const data = JSON.parse(res.body);
  assert.strictEqual(data.error.message, 'Method Not Allowed');
});

test('server handleChatRequest rejects missing or placeholder API keys with 503 and never leaks key', async () => {
  const placeholderKey = 'sk-or-placeholder-key-replace-with-your-actual-key';
  const { req, res } = createMockReqRes({
    body: { messages: [{ role: 'user', text: 'test' }] },
  });

  await handleChatRequest(req, res, { OPENROUTER_API_KEY: placeholderKey });

  assert.strictEqual(res.statusCode, 503);
  assert.ok(!res.body.includes(placeholderKey), 'Must not leak placeholder key in response');
  const data = JSON.parse(res.body);
  assert.ok(data.error.message.includes('not configured on the server'));
});

test('server handleChatRequest sends Bearer key to OpenRouter on server and streams SSE', async () => {
  const originalFetch = globalThis.fetch;
  let interceptedUrl = '';
  let interceptedOptions = null;

  globalThis.fetch = async (url, options) => {
    interceptedUrl = url;
    interceptedOptions = options;

    const sseData = [
      'data: {"choices":[{"delta":{"content":"Server"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":" streaming"}}]}\\n\\n',
      'data: [DONE]\n\n',
    ].join('');

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(sseData));
        controller.close();
      },
    });

    return new Response(stream, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    });
  };

  try {
    const { req, res } = createMockReqRes({
      body: { messages: [{ role: 'user', text: 'Hello server' }] },
    });

    await handleChatRequest(req, res, {
      OPENROUTER_API_KEY: 'sk-or-server-secret-key-12345',
      OPENROUTER_MODEL: 'google/gemini-2.5-flash-lite',
    });

    assert.strictEqual(interceptedUrl, OPENROUTER_API_URL);
    assert.strictEqual(interceptedOptions.headers['Authorization'], 'Bearer sk-or-server-secret-key-12345');
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.headers['Content-Type'], 'text/event-stream');
    assert.ok(res.body.includes('Server'));
    assert.ok(res.body.includes('streaming'));
    assert.strictEqual(res.ended, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('server handleChatRequest masks upstream 401 error without exposing server key', async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () => {
    return new Response(
      JSON.stringify({ error: { message: 'Invalid API key provided' } }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  };

  try {
    const { req, res } = createMockReqRes({
      body: { messages: [{ role: 'user', text: 'Hello server' }] },
    });

    await handleChatRequest(req, res, {
      OPENROUTER_API_KEY: 'sk-or-invalid-secret-key',
    });

    assert.strictEqual(res.statusCode, 401);
    assert.ok(!res.body.includes('sk-or-invalid-secret-key'));
    const data = JSON.parse(res.body);
    assert.ok(data.error.message.includes('Server authentication error'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('prompts/systemPrompt defines Teach4All agent system prompt and injects before user message', () => {
  const prompt = getSystemPrompt();
  assert.ok(prompt.toLowerCase().includes('an agent for teach4all'));
  assert.strictEqual(prompt, SYSTEM_PROMPT);

  const input = [{ role: 'user', text: 'Hello' }];
  const formatted = formatMessages(input);
  assert.strictEqual(formatted.length, 2);
  assert.strictEqual(formatted[0].role, 'system');
  assert.strictEqual(formatted[0].content, prompt);
  assert.strictEqual(formatted[1].role, 'user');
  assert.strictEqual(formatted[1].content, 'Hello');

  // Verify injection before user message handles injected structure without duplicating
  const reinjected = injectSystemPrompt(formatted);
  assert.strictEqual(reinjected.length, 2);
  assert.strictEqual(reinjected[0].role, 'system');
  assert.strictEqual(reinjected[0].content, prompt);
});

test('ConversationStreamWriter streams conversations and messages to DB using UUID and hardcoded user_id', async () => {
  assert.strictEqual(DEFAULT_USER_ID, '00000000-0000-0000-0000-000000000001');

  const conversationId = '11111111-2222-3333-4444-555555555555';
  const userMessageId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  const assistantMessageId = 'ffffffff-0000-1111-2222-333333333333';

  const writer = new ConversationStreamWriter({
    conversationId,
    title: 'Test Streaming Conversation',
    userMessage: { id: userMessageId, role: 'user', text: 'Explain gravity simply' },
    assistantMessageId,
    databaseUrl: process.env.DATABASE_URL,
    throttleMs: 10,
  });

  assert.strictEqual(writer.conversationId, conversationId);
  assert.strictEqual(writer.userId, DEFAULT_USER_ID);
  assert.strictEqual(writer.assistantMessageId, assistantMessageId);

  if (!process.env.DATABASE_URL) return;

  try {
    // 1. Initialize (creates conversation and user message in DB)
    await writer.init();

    // 2. Stream chunks
    writer.writeChunk('Gravity pulls ');
    writer.writeChunk('objects down.');
    await writer.finish('Gravity pulls objects down toward Earth.');

    // 3. Query DB to verify persistence
    const stdout = await runSql(
      `SELECT role, content FROM messages WHERE conversation_id = '${conversationId}' ORDER BY created_at ASC;`,
      process.env.DATABASE_URL
    );

    assert.ok(stdout.includes('Explain gravity simply'), 'user message should be saved in DB');
    assert.ok(stdout.includes('Gravity pulls objects down toward Earth.'), 'assistant response should be streamed and saved in DB');
  } finally {
    // Cleanup test conversation
    try {
      await runSql(`DELETE FROM conversations WHERE id = '${conversationId}';`, process.env.DATABASE_URL);
    } catch {}
  }
});


