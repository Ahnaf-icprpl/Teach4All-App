import test from 'node:test';
import assert from 'node:assert';
import { EventEmitter } from 'node:events';
import { resolve } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';

process.env.NODE_ENV = 'test';
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
import { buildWebSearchPlugin, buildWebSearchTool, isWebSearchRequested, DEFAULT_SEARCH_ENGINE } from '../server/webSearch.js';
import { QUIZ_TOOL_NAME, buildQuizTool, accumulateToolCalls, formatQuizCardMarker, handleCompletedToolCalls } from '../server/quizTool.js';
import { SYSTEM_PROMPT, QUIZ_TOOL_SYSTEM_PROMPT, getQuizToolSystemPrompt, injectSystemPrompt } from '../prompts/systemPrompt.js';
import {
  TITLE_SYSTEM_PROMPT,
  getTitleSystemPrompt,
  formatTitleMessages,
  cleanTitle,
  generateOfflineTitle,
} from '../prompts/titlePrompt.js';
import { handleTitleRequest } from '../server/titleApi.js';
import { handleConversationsRequest, handleMessagesRequest } from '../server/historyApi.js';
import {
  ConversationStreamWriter, DEFAULT_USER_ID, runSql,
  getConversations, getMessages, deleteConversation,
  updateConversationTitle, saveConversation, saveMessage,
  query, getPool, getSslConfig,
} from '../server/db.js';
import {
  generateTitle, TITLE_API_URL,
  fetchConversations, fetchMessages, deleteConversationApi,
  renameConversationApi, searchConversationsApi, CONVERSATIONS_API_URL, MESSAGES_API_URL,
  TEST_USER_ID,
} from '../src/router.js';
import {
  getConversationProvider,
  setConversationProvider,
  clearConversationProvider,
  buildProviderRoutingPayload,
  extractProvider,
} from '../server/providerCache.js';
import {
  VALID_ENVS,
  isValidEnv,
  parseAppEnv,
  getAppEnv,
  isDevEnv,
  isProdEnv,
} from '../src/env.js';
import { resolveAppEnv } from '../vite.config.js';
import {
  GrafanaLogger,
  logger,
  toOtlpValue,
  toOtlpAttributes,
  truncateText,
  sanitizeAttributes,
  DEFAULT_MAX_LOG_TEXT_LENGTH,
  getActiveEnv,
  SEVERITY_LEVELS,
  DEFAULT_GRAFANA_INSTANCE_ID,
  DEFAULT_GRAFANA_API_KEY,
  DEFAULT_GRAFANA_OTLP_URL,
} from '../server/logger.js';

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

test('client sendMessage handles quiz_status building event and invokes onStatus', async () => {
  const originalFetch = globalThis.fetch;
  let statusReceived = '';

  globalThis.fetch = async () => {
    const sseData = [
      'data: {"type":"quiz_status","status":"building"}\n\n',
      'data: {"choices":[{"delta":{"content":"Kuis siap!"}}]}\n\n',
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
      [{ role: 'user', text: 'buat kuis' }],
      chunk => receivedChunks.push(chunk),
      {
        onStatus: status => {
          statusReceived = status;
        },
      }
    );

    assert.strictEqual(statusReceived, 'building_quiz');
    assert.strictEqual(result, 'Kuis siap!');
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
      'data: {"choices":[{"delta":{"content":" streaming"}}]}\n\n',
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

test('prompts/titlePrompt defines title system prompt, cleaners, and formatters', () => {
  assert.ok(TITLE_SYSTEM_PROMPT.includes('Teach4All'));
  assert.strictEqual(getTitleSystemPrompt(), TITLE_SYSTEM_PROMPT);

  // Formatting messages with system prompt
  const formatted = formatTitleMessages([{ role: 'user', text: 'Apa itu fotosintesis?' }]);
  assert.strictEqual(formatted[0].role, 'system');
  assert.strictEqual(formatted[0].content, TITLE_SYSTEM_PROMPT);
  assert.strictEqual(formatted[1].role, 'user');
  assert.strictEqual(formatted[1].content, 'Apa itu fotosintesis?');

  // Title sanitization
  assert.strictEqual(cleanTitle('"Fotosintesis Tumbuhan."'), 'Fotosintesis Tumbuhan');
  assert.strictEqual(cleanTitle('Judul: Belajar Sains'), 'Belajar Sains');
  assert.strictEqual(cleanTitle('Title: Creative Writing'), 'Creative Writing');

  // Offline / fallback title generation
  assert.strictEqual(
    generateOfflineTitle('Tolong jelaskan bagaimana proses fotosintesis terjadi pada daun'),
    'Bagaimana proses fotosintesis terjadi pada daun'
  );
  assert.strictEqual(
    generateOfflineTitle('Buatkan kuis singkat 5 soal pilihan ganda tentang topik berikut: Tata Surya'),
    'Tata Surya'
  );
});

test('server handleTitleRequest handles title generation and DB update', async () => {
  const originalFetch = globalThis.fetch;
  const conversationId = crypto.randomUUID();

  try {
    // 1. Rejects non-POST
    const { req: reqGet, res: resGet } = createMockReqRes({ method: 'GET' });
    await handleTitleRequest(reqGet, resGet, { OPENROUTER_API_KEY: 'sk-test' });
    assert.strictEqual(resGet.statusCode, 405);

    // 2. Generates title via OpenRouter mock
    globalThis.fetch = async (url, opts) => {
      assert.strictEqual(opts.method, 'POST');
      assert.ok(opts.headers.Authorization.includes('sk-test-valid-key'));
      const payload = JSON.parse(opts.body);
      assert.strictEqual(payload.messages[0].role, 'system');
      assert.ok(payload.temperature >= 0.7, 'Title generation must use a high temperature');
      assert.strictEqual(payload.temperature, 0.85);

      return new Response(JSON.stringify({
        choices: [{
          message: { content: '"Eksplorasi Fotosintesis"' },
        }],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const { req: reqPost, res: resPost } = createMockReqRes({
      method: 'POST',
      body: {
        conversationId,
        messages: [{ role: 'user', content: 'Jelaskan fotosintesis' }],
      },
    });

    await handleTitleRequest(reqPost, resPost, {
      OPENROUTER_API_KEY: 'sk-test-valid-key',
      DATABASE_URL: process.env.DATABASE_URL,
    });

    assert.strictEqual(resPost.statusCode, 200);
    const data = JSON.parse(resPost.body);
    assert.strictEqual(data.title, 'Eksplorasi Fotosintesis');

    // 3. Verify DB update if DATABASE_URL is set
    if (process.env.DATABASE_URL) {
      const stdout = await runSql(
        `SELECT title FROM conversations WHERE id = '${conversationId}';`,
        process.env.DATABASE_URL
      );
      assert.ok(stdout.includes('Eksplorasi Fotosintesis'), 'Title should be saved to database');
    }
  } finally {
    globalThis.fetch = originalFetch;
    if (process.env.DATABASE_URL) {
      try {
        await runSql(`DELETE FROM conversations WHERE id = '${conversationId}';`, process.env.DATABASE_URL);
      } catch {}
    }
  }
});

test('client generateTitle calls /api/title and gracefully handles fallback', async () => {
  const originalFetch = globalThis.fetch;

  // 1. Success path
  globalThis.fetch = async (url, opts) => {
    assert.strictEqual(url, TITLE_API_URL);
    assert.strictEqual(opts.method, 'POST');
    return new Response(JSON.stringify({ title: 'Rencana Belajar Fisika' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  try {
    const title = await generateTitle([{ role: 'user', text: 'Bantu saya belajar fisika' }]);
    assert.strictEqual(title, 'Rencana Belajar Fisika');
  } finally {
    globalThis.fetch = originalFetch;
  }

  // 2. Fallback path on server error
  globalThis.fetch = async () => {
    return new Response('Internal Server Error', { status: 500 });
  };

  try {
    const title = await generateTitle([{ role: 'user', text: 'Jelaskan cara kerja roket' }]);
    assert.strictEqual(title, 'Cara kerja roket');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('TEST_USER_ID is hardcoded and matches backend DEFAULT_USER_ID', () => {
  assert.strictEqual(TEST_USER_ID, '00000000-0000-0000-0000-000000000001');
  assert.strictEqual(TEST_USER_ID, DEFAULT_USER_ID);
});

test('server db operations persist, retrieve, rename, and delete conversations and messages', async () => {
  const convId = '11111111-1111-1111-1111-111111111111';
  const uId = TEST_USER_ID;

  await saveConversation({ id: convId, userId: uId, title: 'Pembelajaran Sains' });
  await saveMessage({
    id: '22222222-2222-2222-2222-222222222222',
    conversationId: convId,
    userId: uId,
    role: 'user',
    content: 'Apa itu gravitasi?',
  });
  await saveMessage({
    id: '33333333-3333-3333-3333-333333333333',
    conversationId: convId,
    userId: uId,
    role: 'assistant',
    content: 'Gravitasi adalah gaya tarik antar materi.',
  });

  const convList = await getConversations({ userId: uId });
  assert.ok(convList.some(c => c.id === convId && c.title === 'Pembelajaran Sains'));

  const msgList = await getMessages({ conversationId: convId, userId: uId });
  assert.strictEqual(msgList.length, 2);
  assert.strictEqual(msgList[0].content, 'Apa itu gravitasi?');
  assert.strictEqual(msgList[1].content, 'Gravitasi adalah gaya tarik antar materi.');

  await updateConversationTitle({ conversationId: convId, userId: uId, title: 'Fisika Dasar' });
  const updatedConvList = await getConversations({ userId: uId });
  assert.ok(updatedConvList.some(c => c.id === convId && c.title === 'Fisika Dasar'));

  await deleteConversation({ conversationId: convId, userId: uId });
  const afterDeleteList = await getConversations({ userId: uId });
  assert.ok(!afterDeleteList.some(c => c.id === convId));
});

test('pg driver connection pool, ssl configuration, and query helper operate correctly', async () => {
  // 1. SSL config tests
  assert.strictEqual(getSslConfig(null), false);
  assert.strictEqual(getSslConfig('postgres://localhost:5432/testdb'), false);
  assert.deepStrictEqual(getSslConfig('postgres://user:pass@ep-cool-neon.us-east-2.aws.neon.tech/neondb'), { rejectUnauthorized: false });
  assert.deepStrictEqual(getSslConfig('postgres://localhost:5432/testdb?sslmode=require'), { rejectUnauthorized: false });

  // 2. Graceful behavior when no DB url provided
  const emptyRows = await query('SELECT 1', [], null);
  assert.deepStrictEqual(emptyRows, []);
  const emptySql = await runSql('SELECT 1', null);
  assert.strictEqual(emptySql, '');

  // 3. Pool instantiation
  const pool = getPool('postgres://fake:fake@127.0.0.1:5432/fake');
  assert.ok(pool, 'should create pg Pool instance');
  assert.strictEqual(getPool('postgres://fake:fake@127.0.0.1:5432/fake'), pool, 'should reuse pool instance for identical URL');
});

test('server handleConversationsRequest and handleMessagesRequest handle HTTP lifecycle', async () => {
  const testConvId = '44444444-4444-4444-4444-444444444444';
  await saveConversation({ id: testConvId, userId: TEST_USER_ID, title: 'Biologi Sel' });
  await saveMessage({
    id: '55555555-5555-5555-5555-555555555555',
    conversationId: testConvId,
    userId: TEST_USER_ID,
    role: 'user',
    content: 'Apa itu mitokondria?',
  });

  // 1. GET /api/conversations
  const getReq = new EventEmitter();
  getReq.method = 'GET';
  getReq.url = `/api/conversations?userId=${TEST_USER_ID}`;
  getReq.headers = { 'x-forwarded-for': '127.0.0.1' };

  let convStatusCode = 0;
  let convData = '';
  const getRes = {
    writeHead: (code, headers) => { convStatusCode = code; },
    end: (str) => { convData = str; },
    setHeader: () => {},
  };

  await handleConversationsRequest(getReq, getRes, { RATE_LIMIT: 1000 });
  assert.strictEqual(convStatusCode, 200);
  const parsedConvs = JSON.parse(convData);
  assert.ok(Array.isArray(parsedConvs.conversations));
  assert.ok(parsedConvs.conversations.some(c => c.id === testConvId));

  // 2. GET /api/messages?conversationId=...
  const msgReq = new EventEmitter();
  msgReq.method = 'GET';
  msgReq.url = `/api/messages?conversationId=${testConvId}&userId=${TEST_USER_ID}`;
  msgReq.headers = { 'x-forwarded-for': '127.0.0.1' };

  let msgStatusCode = 0;
  let msgData = '';
  const msgRes = {
    writeHead: (code) => { msgStatusCode = code; },
    end: (str) => { msgData = str; },
    setHeader: () => {},
  };

  await handleMessagesRequest(msgReq, msgRes, { RATE_LIMIT: 1000 });
  assert.strictEqual(msgStatusCode, 200);
  const parsedMsgs = JSON.parse(msgData);
  assert.ok(Array.isArray(parsedMsgs.messages));
  assert.strictEqual(parsedMsgs.messages.length, 1);
  assert.strictEqual(parsedMsgs.messages[0].content, 'Apa itu mitokondria?');

  // Clean up
  await deleteConversation({ conversationId: testConvId, userId: TEST_USER_ID });
});

test('client fetchConversations and fetchMessages call endpoints with query parameters', async () => {
  const originalFetch = globalThis.fetch;
  let fetchedUrl = '';

  globalThis.fetch = async (url) => {
    fetchedUrl = url;
    if (url.includes('/api/conversations')) {
      return new Response(JSON.stringify({
        conversations: [{ id: 'conv-1', title: 'Belajar Kimia', updated_at: new Date().toISOString() }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.includes('/api/messages')) {
      return new Response(JSON.stringify({
        messages: [{ id: 'msg-1', role: 'user', content: 'Halo', created_at: new Date().toISOString() }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response('Not found', { status: 404 });
  };

  try {
    const convData = await fetchConversations({ userId: TEST_USER_ID });
    assert.ok(fetchedUrl.includes('userId=00000000-0000-0000-0000-000000000001'));
    assert.strictEqual(convData.conversations[0].title, 'Belajar Kimia');

    const msgData = await fetchMessages('conv-1', { userId: TEST_USER_ID });
    assert.ok(fetchedUrl.includes('conversationId=conv-1'));
    assert.strictEqual(msgData.messages[0].content, 'Halo');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('providerCache helper builds payload and extracts provider accurately', () => {
  // 1. Without cached provider
  const payload1 = buildProviderRoutingPayload('test-convo-123');
  assert.strictEqual(payload1.session_id, 'test-convo-123');
  assert.strictEqual(payload1.prompt_cache_key, 'test-convo-123');
  assert.deepStrictEqual(payload1.cache_control, { type: 'ephemeral' });
  assert.strictEqual(payload1.provider, undefined);

  // 2. With cached provider
  const payload2 = buildProviderRoutingPayload('test-convo-123', 'Together');
  assert.strictEqual(payload2.session_id, 'test-convo-123');
  assert.deepStrictEqual(payload2.provider, {
    order: ['together'],
    allow_fallbacks: true,
  });

  // 3. Extract provider from headers
  const mockHeaders = new Headers({ 'x-openrouter-provider': 'Google' });
  assert.strictEqual(extractProvider(mockHeaders), 'google');

  // 4. Extract provider from chunk JSON
  assert.strictEqual(extractProvider(null, { provider: 'DeepInfra' }), 'deepinfra');
});

test('server handleChatRequest caches provider and routes subsequent conversation turns to cached provider', async () => {
  const originalFetch = globalThis.fetch;
  const conversationId = crypto.randomUUID();
  const interceptedBodies = [];
  const interceptedHeaders = [];

  globalThis.fetch = async (url, options) => {
    interceptedBodies.push(JSON.parse(options.body));
    interceptedHeaders.push(options.headers);

    const sseData = [
      'data: {"provider":"deepinfra","choices":[{"delta":{"content":"Jawaban"}}]}\n\n',
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
      headers: {
        'Content-Type': 'text/event-stream',
        'x-openrouter-provider': 'deepinfra',
      },
    });
  };

  try {
    // Turn 1: First request for this conversation
    const { req: req1, res: res1 } = createMockReqRes({
      body: {
        conversationId,
        messages: [{ role: 'user', content: 'Pertanyaan 1' }],
      },
    });

    await handleChatRequest(req1, res1, {
      OPENROUTER_API_KEY: 'sk-or-valid-key',
    });

    assert.strictEqual(res1.statusCode, 200);
    assert.strictEqual(res1.headers['X-Provider'], 'deepinfra');
    assert.strictEqual(interceptedBodies.length, 1);
    assert.strictEqual(interceptedBodies[0].session_id, conversationId);
    assert.strictEqual(interceptedBodies[0].prompt_cache_key, conversationId);
    assert.deepStrictEqual(interceptedBodies[0].cache_control, { type: 'ephemeral' });
    assert.strictEqual(interceptedHeaders[0]['X-Session-Id'], conversationId);
    // On Turn 1, no provider order was pinned yet
    assert.strictEqual(interceptedBodies[0].provider, undefined);

    // Verify provider is now cached for this conversation
    const cached = await getConversationProvider(conversationId);
    assert.strictEqual(cached, 'deepinfra');

    // Turn 2: Second request for the same conversation
    const { req: req2, res: res2 } = createMockReqRes({
      body: {
        conversationId,
        messages: [
          { role: 'user', content: 'Pertanyaan 1' },
          { role: 'assistant', content: 'Jawaban' },
          { role: 'user', content: 'Pertanyaan 2' },
        ],
      },
    });

    await handleChatRequest(req2, res2, {
      OPENROUTER_API_KEY: 'sk-or-valid-key',
    });

    assert.strictEqual(res2.statusCode, 200);
    assert.strictEqual(interceptedBodies.length, 2);
    assert.strictEqual(interceptedBodies[1].session_id, conversationId);
    // On Turn 2, provider routing is stickied to the cached provider!
    assert.deepStrictEqual(interceptedBodies[1].provider, {
      order: ['deepinfra'],
      allow_fallbacks: true,
    });
  } finally {
    globalThis.fetch = originalFetch;
    await clearConversationProvider(conversationId);
  }
});

test('server handleTitleRequest uses cached provider and respects sticky routing', async () => {
  const originalFetch = globalThis.fetch;
  const conversationId = crypto.randomUUID();
  let interceptedPayload = null;
  let interceptedHeaders = null;

  // Pre-seed conversation provider
  await setConversationProvider(conversationId, 'groq');

  globalThis.fetch = async (url, options) => {
    interceptedPayload = JSON.parse(options.body);
    interceptedHeaders = options.headers;

    return new Response(JSON.stringify({
      choices: [{ message: { content: 'Judul Percakapan Baru' } }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  try {
    const { req, res } = createMockReqRes({
      body: {
        conversationId,
        messages: [{ role: 'user', content: 'Halo guru' }],
      },
    });

    await handleTitleRequest(req, res, {
      OPENROUTER_API_KEY: 'sk-or-valid-key',
    });

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(interceptedPayload.session_id, conversationId);
    assert.strictEqual(interceptedPayload.prompt_cache_key, conversationId);
    assert.deepStrictEqual(interceptedPayload.cache_control, { type: 'ephemeral' });
    assert.deepStrictEqual(interceptedPayload.provider, {
      order: ['groq'],
      allow_fallbacks: true,
    });
    assert.strictEqual(interceptedHeaders['X-Session-Id'], conversationId);
  } finally {
    globalThis.fetch = originalFetch;
    await clearConversationProvider(conversationId);
  }
});

test('ENV validation allows only production or development and rejects invalid values', () => {
  assert.strictEqual(isValidEnv('development'), true);
  assert.strictEqual(isValidEnv('production'), true);
  assert.strictEqual(isValidEnv('Development'), true);
  assert.strictEqual(isValidEnv('PRODUCTION'), true);
  assert.strictEqual(isValidEnv('staging'), false);
  assert.strictEqual(isValidEnv('test'), false);
  assert.strictEqual(isValidEnv(''), false);
  assert.strictEqual(isValidEnv(null), false);

  assert.strictEqual(parseAppEnv('production'), 'production');
  assert.strictEqual(parseAppEnv('development'), 'development');
  assert.strictEqual(parseAppEnv('Development'), 'development');
  assert.strictEqual(parseAppEnv(null, 'development'), 'development');
  assert.throws(() => parseAppEnv('invalid_env'), /Invalid env/);
});

test('resolveAppEnv parses env variable for production and development with strict validation', () => {
  assert.strictEqual(resolveAppEnv({ ENV: 'production' }), 'production');
  assert.strictEqual(resolveAppEnv({ env: 'development' }), 'development');
  assert.strictEqual(resolveAppEnv({ ENV: 'DEVELOPMENT' }), 'development');
  assert.strictEqual(resolveAppEnv({}, 'production'), 'production');
  assert.strictEqual(resolveAppEnv({}, 'development'), 'development');
  assert.throws(() => resolveAppEnv({ ENV: 'staging' }), /Invalid env/);
  assert.throws(() => resolveAppEnv({ env: 'invalid' }), /Invalid env/);
});

test('isDevEnv and isProdEnv reflect the active environment accurately', () => {
  const originalEnv = process.env.ENV;
  try {
    process.env.ENV = 'development';
    assert.strictEqual(isDevEnv(), true);
    assert.strictEqual(isProdEnv(), false);
    assert.strictEqual(getAppEnv(), 'development');

    process.env.ENV = 'production';
    assert.strictEqual(isDevEnv(), false);
    assert.strictEqual(isProdEnv(), true);
    assert.strictEqual(getAppEnv(), 'production');
  } finally {
    process.env.ENV = originalEnv;
  }
});

test('toOtlpValue and toOtlpAttributes convert data structures to OpenTelemetry specification', () => {
  assert.deepStrictEqual(toOtlpValue('hello'), { stringValue: 'hello' });
  assert.deepStrictEqual(toOtlpValue(true), { boolValue: true });
  assert.deepStrictEqual(toOtlpValue(42), { intValue: '42' });
  assert.deepStrictEqual(toOtlpValue(3.14), { doubleValue: 3.14 });
  assert.deepStrictEqual(toOtlpValue({ key: 'val' }), { stringValue: JSON.stringify({ key: 'val' }) });
  assert.deepStrictEqual(toOtlpValue(null), { stringValue: '' });
  assert.deepStrictEqual(toOtlpValue(undefined), { stringValue: '' });

  const attrs = toOtlpAttributes({
    service: 'teach4all',
    port: 5173,
    active: true,
  });

  assert.strictEqual(attrs.length, 3);
  assert.strictEqual(attrs[0].key, 'service');
  assert.deepStrictEqual(attrs[0].value, { stringValue: 'teach4all' });
  assert.strictEqual(attrs[1].key, 'port');
  assert.deepStrictEqual(attrs[1].value, { intValue: '5173' });
  assert.strictEqual(attrs[2].key, 'active');
  assert.deepStrictEqual(attrs[2].value, { boolValue: true });
});

test('GrafanaLogger configures tokens, formats OTLP payloads, and sends Basic Auth correctly', async () => {
  assert.strictEqual(DEFAULT_GRAFANA_INSTANCE_ID, '1828340');
  assert.ok(DEFAULT_GRAFANA_OTLP_URL.includes('grafana.net'));

  let capturedUrl = '';
  let capturedHeaders = {};
  let capturedBody = null;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    capturedUrl = url;
    capturedHeaders = options.headers;
    capturedBody = JSON.parse(options.body);
    return new Response('', { status: 204 });
  };

  try {
    const testLogger = new GrafanaLogger({
      instanceId: '1828340',
      apiKey: 'test-token',
      otlpUrl: 'https://test-gateway.grafana.net/otlp/v1/logs',
      serviceName: 'teach4all-test',
      enableConsole: false,
      forceSendInTest: true,
    });

    testLogger.info('Testing info log line', { client_ip: '127.0.0.1', status_code: 200 });
    testLogger.warn('Testing warning log line', { detail: 'high memory' });
    testLogger.error('Testing error log line', { err: 'failed db connect' });

    assert.strictEqual(testLogger.queue.length, 3);

    await testLogger.flush();

    assert.strictEqual(capturedUrl, 'https://test-gateway.grafana.net/otlp/v1/logs');
    assert.strictEqual(capturedHeaders['Content-Type'], 'application/json');

    const expectedAuth = Buffer.from('1828340:test-token').toString('base64');
    assert.strictEqual(capturedHeaders['Authorization'], `Basic ${expectedAuth}`);

    assert.ok(capturedBody.resourceLogs && capturedBody.resourceLogs.length > 0);
    const resourceAttrs = capturedBody.resourceLogs[0].resource.attributes;
    assert.ok(resourceAttrs.some(a => a.key === 'service.name' && a.value.stringValue === 'teach4all-test'));

    const logRecords = capturedBody.resourceLogs[0].scopeLogs[0].logRecords;
    assert.strictEqual(logRecords.length, 3);
    assert.strictEqual(logRecords[0].severityText, 'INFO');
    assert.strictEqual(logRecords[0].severityNumber, 9);
    assert.strictEqual(logRecords[0].body.stringValue, 'Testing info log line');

    assert.strictEqual(logRecords[1].severityText, 'WARN');
    assert.strictEqual(logRecords[1].severityNumber, 13);

    assert.strictEqual(logRecords[2].severityText, 'ERROR');
    assert.strictEqual(logRecords[2].severityNumber, 17);

    assert.strictEqual(testLogger.queue.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('truncateText, sanitizeAttributes, and GrafanaLogger ALWAYS truncate giant user prompts and external texts', async () => {
  assert.strictEqual(DEFAULT_MAX_LOG_TEXT_LENGTH, 500);

  // 1. Short text remains unchanged
  assert.strictEqual(truncateText('short user prompt'), 'short user prompt');

  // 2. Giant user prompt (e.g. 5,000 characters) is truncated cleanly
  const giantPrompt = 'Pelajari rumus fisika kuantum '.repeat(200); // 6,000 chars
  const truncatedPrompt = truncateText(giantPrompt, 100);
  assert.strictEqual(truncatedPrompt.length, 100 + '... [truncated]'.length);
  assert.ok(truncatedPrompt.endsWith('... [truncated]'));
  assert.strictEqual(truncatedPrompt.startsWith(giantPrompt.slice(0, 100)), true);

  // 3. Null / undefined / non-string handling
  assert.strictEqual(truncateText(null), '');
  assert.strictEqual(truncateText(undefined), '');
  assert.strictEqual(truncateText(12345), '12345');

  // 4. sanitizeAttributes truncates giant strings and nested objects while preserving numbers/booleans
  const rawAttributes = {
    client_ip: '127.0.0.1',
    status: 200,
    active: true,
    user_prompt: 'A'.repeat(2000),
    nested: {
      inner_prompt: 'B'.repeat(3000),
      count: 42,
    },
  };

  const sanitized = sanitizeAttributes(rawAttributes, 200);
  assert.strictEqual(sanitized.client_ip, '127.0.0.1');
  assert.strictEqual(sanitized.status, 200);
  assert.strictEqual(sanitized.active, true);
  assert.strictEqual(sanitized.user_prompt.length, 200 + '... [truncated]'.length);
  assert.ok(sanitized.user_prompt.endsWith('... [truncated]'));
  assert.strictEqual(sanitized.nested.inner_prompt.length, 200 + '... [truncated]'.length);
  assert.strictEqual(sanitized.nested.count, 42);

  // 5. toOtlpValue and toOtlpAttributes truncate string values and stringified JSON
  const otlpVal = toOtlpValue('C'.repeat(1500), 300);
  assert.strictEqual(otlpVal.stringValue.length, 300 + '... [truncated]'.length);

  const otlpObj = toOtlpValue({ giant: 'D'.repeat(1500) }, 300);
  assert.ok(otlpObj.stringValue.endsWith('... [truncated]'));

  // 6. GrafanaLogger record truncation on log call
  let deliveredBody = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    deliveredBody = JSON.parse(options.body);
    return new Response('', { status: 204 });
  };

  try {
    const customLogger = new GrafanaLogger({
      instanceId: '1828340',
      apiKey: 'test-token',
      otlpUrl: 'https://test-gateway.grafana.net/otlp/v1/logs',
      serviceName: 'teach4all-test',
      enableConsole: false,
      forceSendInTest: true,
      maxTextLength: 150,
    });

    // Send a giant message and giant prompt attribute
    const giantMsg = 'E'.repeat(4000);
    const giantUserAttr = 'F'.repeat(5000);

    customLogger.info(giantMsg, { prompt: giantUserAttr });
    await customLogger.flush();

    assert.ok(deliveredBody);
    const logRecord = deliveredBody.resourceLogs[0].scopeLogs[0].logRecords[0];

    // Message body is safely truncated
    assert.strictEqual(logRecord.body.stringValue.length, 150 + '... [truncated]'.length);
    assert.ok(logRecord.body.stringValue.endsWith('... [truncated]'));

    // Prompt attribute is safely truncated
    const promptAttr = logRecord.attributes.find(a => a.key === 'prompt');
    assert.ok(promptAttr);
    assert.strictEqual(promptAttr.value.stringValue.length, 150 + '... [truncated]'.length);
    assert.ok(promptAttr.value.stringValue.endsWith('... [truncated]'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('GrafanaLogger ALWAYS includes env (from .env or process.env) in log record attributes and OTLP resource attributes', async () => {
  const originalEnv = process.env.ENV;
  const originalFetch = globalThis.fetch;
  let deliveredBody = null;

  globalThis.fetch = async (url, options) => {
    deliveredBody = JSON.parse(options.body);
    return new Response('', { status: 204 });
  };

  try {
    // 1. Development environment
    process.env.ENV = 'development';
    assert.strictEqual(getActiveEnv(), 'development');

    const devLogger = new GrafanaLogger({
      instanceId: '1828340',
      apiKey: 'test-token',
      otlpUrl: 'https://test-gateway.grafana.net/otlp/v1/logs',
      enableConsole: false,
      forceSendInTest: true,
    });

    assert.strictEqual(devLogger.env, 'development');
    devLogger.info('Testing dev environment log', { request_id: 'req-dev-1' });
    assert.strictEqual(devLogger.queue[0].attributes.find(a => a.key === 'env').value.stringValue, 'development');

    await devLogger.flush();
    assert.ok(deliveredBody);
    const devResourceAttrs = deliveredBody.resourceLogs[0].resource.attributes;
    assert.ok(devResourceAttrs.some(a => a.key === 'deployment.environment' && a.value.stringValue === 'development'));
    assert.ok(devResourceAttrs.some(a => a.key === 'env' && a.value.stringValue === 'development'));

    const devRecordAttrs = deliveredBody.resourceLogs[0].scopeLogs[0].logRecords[0].attributes;
    assert.ok(devRecordAttrs.some(a => a.key === 'env' && a.value.stringValue === 'development'));

    // 2. Production environment
    process.env.ENV = 'production';
    assert.strictEqual(getActiveEnv(), 'production');

    const prodLogger = new GrafanaLogger({
      instanceId: '1828340',
      apiKey: 'test-token',
      otlpUrl: 'https://test-gateway.grafana.net/otlp/v1/logs',
      enableConsole: false,
      forceSendInTest: true,
    });

    assert.strictEqual(prodLogger.env, 'production');
    prodLogger.info('Testing prod environment log', { request_id: 'req-prod-1' });
    assert.strictEqual(prodLogger.queue[0].attributes.find(a => a.key === 'env').value.stringValue, 'production');

    await prodLogger.flush();
    assert.ok(deliveredBody);
    const prodResourceAttrs = deliveredBody.resourceLogs[0].resource.attributes;
    assert.ok(prodResourceAttrs.some(a => a.key === 'deployment.environment' && a.value.stringValue === 'production'));
    assert.ok(prodResourceAttrs.some(a => a.key === 'env' && a.value.stringValue === 'production'));

    const prodRecordAttrs = deliveredBody.resourceLogs[0].scopeLogs[0].logRecords[0].attributes;
    assert.ok(prodRecordAttrs.some(a => a.key === 'env' && a.value.stringValue === 'production'));

    // 3. Explicit env parameter overrides process.env
    const explicitLogger = new GrafanaLogger({
      instanceId: '1828340',
      apiKey: 'test-token',
      otlpUrl: 'https://test-gateway.grafana.net/otlp/v1/logs',
      enableConsole: false,
      env: 'development',
    });
    assert.strictEqual(explicitLogger.env, 'development');
  } finally {
    process.env.ENV = originalEnv;
    globalThis.fetch = originalFetch;
  }
});

test('handleUiTextsRequest rejects non-GET and returns 200 with texts dictionary', async () => {
  const { handleUiTextsRequest } = await import('../server/uiTextsApi.js');

  // Test 405 on POST
  let postStatusCode = 0;
  let postBody = '';
  const postReq = { method: 'POST', url: '/api/ui-texts' };
  const postRes = {
    writeHead(status) { postStatusCode = status; },
    end(body) { postBody = body; },
  };
  await handleUiTextsRequest(postReq, postRes);
  assert.strictEqual(postStatusCode, 405);
  assert.ok(JSON.parse(postBody).error);

  // Test GET
  let getStatusCode = 0;
  let getHeaders = {};
  let getBody = '';
  const getReq = { method: 'GET', url: '/api/ui-texts' };
  const getRes = {
    writeHead(status, headers) {
      getStatusCode = status;
      getHeaders = headers;
    },
    end(body) { getBody = body; },
  };
  await handleUiTextsRequest(getReq, getRes);
  assert.strictEqual(getStatusCode, 200);
  assert.strictEqual(getHeaders['Content-Type'], 'application/json');
  const data = JSON.parse(getBody);
  assert.ok(data.texts && typeof data.texts === 'object');
});

test('UI texts module strictly references DB without any fallback and does not load if DB is empty', async () => {
  const { initUiTexts, t, uiTexts } = await import('../src/uiTexts.js');
  const originalFetch = globalThis.fetch;

  try {
    // 1. If DB returns empty or nothing, initUiTexts returns false (does not load)
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({ texts: {} }),
    });
    const loadedEmpty = await initUiTexts();
    assert.strictEqual(loadedEmpty, false, 'app must not load if db has no texts');

    // 2. If DB fetch fails, initUiTexts returns false (does not load)
    globalThis.fetch = async () => ({
      ok: false,
      status: 500,
    });
    const loadedFail = await initUiTexts();
    assert.strictEqual(loadedFail, false, 'app must not load if db fetch fails');

    // 3. When DB returns valid texts and prompts, it loads and t(key) returns strictly from DB
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        texts: {
          topbar_new_chat: 'Percakapan baru dari DB',
          topbar_open_nav: 'Buka navigasi dari DB',
        },
        prompts: [
          { id: 1, title: 'Prompt 1', detail: 'Detail 1', prompt: 'P1', icon: 'bulb', color: 'amber' },
        ],
      }),
    });
    const loadedSuccess = await initUiTexts();
    assert.strictEqual(loadedSuccess, true);
    assert.strictEqual(t('topbar_new_chat'), 'Percakapan baru dari DB');
    assert.strictEqual(t('topbar_open_nav'), 'Buka navigasi dari DB');

    // 4. Missing key returns empty string, absolutely NO fallback text
    assert.strictEqual(t('non_existent_key'), '');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('handleChatPromptsRequest rejects non-GET and returns 200 with prompts list', async () => {
  const { handleChatPromptsRequest } = await import('../server/uiTextsApi.js');

  // Test 405 on POST
  let postStatusCode = 0;
  let postBody = '';
  const postReq = { method: 'POST', url: '/api/chat-prompts' };
  const postRes = {
    writeHead(status) { postStatusCode = status; },
    end(body) { postBody = body; },
  };
  await handleChatPromptsRequest(postReq, postRes);
  assert.strictEqual(postStatusCode, 405);
  assert.ok(JSON.parse(postBody).error);

  // Test GET
  let getStatusCode = 0;
  let getHeaders = {};
  let getBody = '';
  const getReq = { method: 'GET', url: '/api/chat-prompts' };
  const getRes = {
    writeHead(status, headers) {
      getStatusCode = status;
      getHeaders = headers;
    },
    end(body) { getBody = body; },
  };
  await handleChatPromptsRequest(getReq, getRes);
  assert.strictEqual(getStatusCode, 200);
  assert.strictEqual(getHeaders['Content-Type'], 'application/json');
  const data = JSON.parse(getBody);
  assert.ok(Array.isArray(data.prompts));
});

test('chat prompts rotate randomly across items from table without fallback', async () => {
  const { allChatPrompts, activePrompts, rotatePrompts, initUiTexts } = await import('../src/uiTexts.js');

  const mockPrompts = Array.from({ length: 10 }, (_, i) => ({
    id: i + 1,
    title: `Title ${i + 1}`,
    detail: `Detail ${i + 1}`,
    prompt: `Prompt text ${i + 1}`,
    icon: i % 2 === 0 ? 'bulb' : 'plan',
    color: i % 2 === 0 ? 'amber' : 'blue',
  }));

  allChatPrompts.val = mockPrompts;
  rotatePrompts();

  assert.strictEqual(activePrompts.val.length, 4);
  for (const p of activePrompts.val) {
    assert.ok(p.title);
    assert.ok(p.detail);
    assert.ok(p.prompt);
    assert.ok(p.icon);
    assert.ok(p.color);
  }

  // Rotating prompts retains 4 items from the pool
  rotatePrompts();
  assert.strictEqual(activePrompts.val.length, 4);
});

test('renderSsrHtml strictly populates database texts and prompts without fallback', async () => {
  const { renderSsrHtml } = await import('../server/ssr.js');

  // Throws if texts or prompts are missing
  assert.throws(() => {
    renderSsrHtml({ htmlTemplate: '<html><head></head><body></body></html>', texts: {}, prompts: [] });
  }, /No UI text or prompts available/);

  const mockTexts = {
    app_skip_link: 'Skip to content',
    sidebar_brand_prefix: 'Teach',
    sidebar_brand_number: '4',
    sidebar_brand_suffix: 'All',
    chat_welcome_title_p1: 'Hello World',
  };
  const mockPrompts = [
    { id: 1, title: 'Test Prompt 1', detail: 'Detail 1', prompt: 'Prompt 1', icon: 'bulb', color: 'amber' },
  ];

  const html = renderSsrHtml({
    htmlTemplate: '<!doctype html><html><head></head><body></body></html>',
    texts: mockTexts,
    prompts: mockPrompts,
  });

  assert.ok(html.includes('id="__TEACH4ALL_DATA__"'));
  assert.ok(html.includes('window.__INITIAL_UI_DATA__ ='));
  assert.ok(html.includes('Skip to content'));
  assert.ok(html.includes('Hello World'));
  assert.ok(html.includes('Test Prompt 1'));
});

test('initUiTexts hydrates instantly from window.__INITIAL_UI_DATA__', async () => {
  const { uiTexts, allChatPrompts, activePrompts, isLoaded, initUiTexts } = await import('../src/uiTexts.js');

  globalThis.window = {
    __INITIAL_UI_DATA__: {
      texts: { app_skip_link: 'Lompat ke pesan' },
      prompts: [
        { id: 1, title: 'Prompt SSR', detail: 'Detail SSR', prompt: 'Text SSR', icon: 'bulb', color: 'amber' },
      ],
    },
  };

  const success = await initUiTexts();
  assert.strictEqual(success, true);
  assert.strictEqual(uiTexts.val.app_skip_link, 'Lompat ke pesan');
  assert.strictEqual(allChatPrompts.val.length, 1);
  assert.strictEqual(activePrompts.val.length, 1);
  assert.strictEqual(isLoaded.val, true);

  delete globalThis.window;
});

test('getConversations and handleConversationsRequest search database by title and message content', async () => {
  const searchConvId = '77777777-7777-7777-7777-777777777777';
  await saveConversation({ id: searchConvId, userId: TEST_USER_ID, title: 'Fisika Kuantum' });
  await saveMessage({
    id: '88888888-8888-8888-8888-888888888888',
    conversationId: searchConvId,
    userId: TEST_USER_ID,
    role: 'user',
    content: 'Jelaskan prinsip ketidakpastian Heisenberg secara mendalam.',
  });

  // 1. Search by title match
  const titleResults = await getConversations({ userId: TEST_USER_ID, query: 'Kuantum' });
  assert.ok(titleResults.some(c => c.id === searchConvId));

  // 2. Search by message content match
  const contentResults = await getConversations({ userId: TEST_USER_ID, query: 'Heisenberg' });
  assert.ok(contentResults.some(c => c.id === searchConvId));

  // 3. Search with non-matching term returns empty
  const noMatchResults = await getConversations({ userId: TEST_USER_ID, query: 'NonExistentTermXYZ123' });
  assert.strictEqual(noMatchResults.some(c => c.id === searchConvId), false);

  // 4. HTTP API search via ?q=
  const searchReq = new EventEmitter();
  searchReq.method = 'GET';
  searchReq.url = `/api/conversations?userId=${TEST_USER_ID}&q=Heisenberg`;
  searchReq.headers = { 'x-forwarded-for': '127.0.0.1' };

  let statusCode = 0;
  let responseData = '';
  const searchRes = {
    writeHead: (code) => { statusCode = code; },
    end: (str) => { responseData = str; },
    setHeader: () => {},
  };

  await handleConversationsRequest(searchReq, searchRes, { RATE_LIMIT: 1000 });
  assert.strictEqual(statusCode, 200);
  const parsed = JSON.parse(responseData);
  assert.ok(parsed.conversations.some(c => c.id === searchConvId));

  // 5. Client searchConversationsApi helper attaches query param
  const originalFetch = globalThis.fetch;
  let interceptedUrl = '';
  globalThis.fetch = async (url) => {
    interceptedUrl = url;
    return new Response(JSON.stringify({ conversations: [{ id: searchConvId, title: 'Fisika Kuantum' }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  try {
    const apiRes = await searchConversationsApi('Heisenberg', { userId: TEST_USER_ID });
    assert.ok(interceptedUrl.includes('q=Heisenberg'));
    assert.strictEqual(apiRes.conversations[0].id, searchConvId);
  } finally {
    globalThis.fetch = originalFetch;
    await deleteConversation({ conversationId: searchConvId, userId: TEST_USER_ID });
  }
});

test('handleSsrRequest returns 404 status and 404.html template for unknown paths', async () => {
  const { handleSsrRequest, load404HtmlTemplate } = await import('../server/ssr.js');

  const template404 = load404HtmlTemplate();
  assert.ok(template404.includes('Halaman Tidak Ditemukan'));
  assert.ok(!template404.includes('id="app"'));

  let statusCode = 0;
  let headers = {};
  let body = '';
  const req = { url: '/unknown-route-123' };
  const res = {
    writeHead(code, h) {
      statusCode = code;
      headers = h;
    },
    end(b) {
      body = b;
    },
  };

  await handleSsrRequest(req, res);
  assert.strictEqual(statusCode, 404);
  assert.strictEqual(headers['Content-Type'], 'text/html; charset=utf-8');
  assert.ok(body.includes('Halaman Tidak Ditemukan'));
  assert.ok(!body.includes('id="app"'));
});

test('createChatMiddleware logs completed >= 400 requests with logger.error', async () => {
  const { createChatMiddleware } = await import('../server/chatApi.js');
  const logged = [];
  const origError = logger.error.bind(logger);
  const origInfo = logger.info.bind(logger);
  logger.error = (msg, attrs) => {
    logged.push({ level: 'error', msg, attrs });
    return origError(msg, attrs);
  };
  logger.info = (msg, attrs) => {
    logged.push({ level: 'info', msg, attrs });
    return origInfo(msg, attrs);
  };

  try {
    const middleware = createChatMiddleware({ ENV: 'development' });
    const req = { method: 'GET', url: '/igrungrihbh', headers: { accept: 'text/html' } };
    const finishListeners = [];
    const res = {
      statusCode: 200,
      writeHead(code) { this.statusCode = code; },
      end() {
        for (const fn of finishListeners) fn();
      },
      on(evt, fn) {
        if (evt === 'finish') finishListeners.push(fn);
      },
    };

    await middleware(req, res, () => {});
    assert.strictEqual(res.statusCode, 404);
    const completionLog = logged.find(l => l.msg && l.msg.includes('Completed GET /igrungrihbh -> 404'));
    assert(completionLog, 'Expected completion log for /igrungrihbh');
    assert.strictEqual(completionLog.level, 'error', 'Expected 404 completion log to be marked as error level');
  } finally {
    logger.error = origError;
    logger.info = origInfo;
  }
});

test('buildWebSearchPlugin returns cheapest parallel plugin by default and respects env overrides', () => {
  assert.strictEqual(DEFAULT_SEARCH_ENGINE, 'parallel');
  const defaultPlugin = buildWebSearchPlugin({});
  assert.strictEqual(defaultPlugin.id, 'web');
  assert.strictEqual(defaultPlugin.engine, 'parallel');
  assert.strictEqual(defaultPlugin.max_results, 3);

  const customPlugin = buildWebSearchPlugin({ OPENROUTER_SEARCH_ENGINE: 'perplexity' });
  assert.strictEqual(customPlugin.engine, 'perplexity');
});

test('isWebSearchRequested recognizes boolean and falsy triggers', () => {
  assert.strictEqual(isWebSearchRequested(undefined), true);
  assert.strictEqual(isWebSearchRequested(true), true);
  assert.strictEqual(isWebSearchRequested('auto'), true);
  assert.strictEqual(isWebSearchRequested(false), false);
  assert.strictEqual(isWebSearchRequested('false'), false);
  assert.strictEqual(isWebSearchRequested(0), false);
});

test('server handleChatRequest provides web search plugin with cheapest parallel engine and max_results limit', async () => {
  const originalFetch = globalThis.fetch;
  let interceptedPayload = null;

  globalThis.fetch = async (url, options) => {
    interceptedPayload = JSON.parse(options.body);
    const sseData = 'data: {"choices":[{"delta":{"content":"Search response"}}]}\n\ndata: [DONE]\n\n';
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(sseData));
        controller.close();
      },
    });
    return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  };

  try {
    const { req, res } = createMockReqRes({
      body: { messages: [{ role: 'user', text: 'Berita terbaru' }] },
    });

    await handleChatRequest(req, res, {
      OPENROUTER_API_KEY: 'sk-or-valid-test-key-1234',
    });

    assert.ok(interceptedPayload);
    assert.ok(Array.isArray(interceptedPayload.plugins));
    assert.strictEqual(interceptedPayload.plugins.length, 1);
    assert.strictEqual(interceptedPayload.plugins[0].id, 'web');
    assert.strictEqual(interceptedPayload.plugins[0].engine, 'parallel');
    assert.strictEqual(interceptedPayload.plugins[0].max_results, 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('server handleChatRequest omits plugins when webSearch is explicitly false', async () => {
  const originalFetch = globalThis.fetch;
  let interceptedPayload = null;

  globalThis.fetch = async (url, options) => {
    interceptedPayload = JSON.parse(options.body);
    const sseData = 'data: {"choices":[{"delta":{"content":"No search"}}]}\n\ndata: [DONE]\n\n';
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(sseData));
        controller.close();
      },
    });
    return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  };

  try {
    const { req, res } = createMockReqRes({
      body: { messages: [{ role: 'user', text: 'Tanpa pencarian' }], webSearch: false },
    });

    await handleChatRequest(req, res, {
      OPENROUTER_API_KEY: 'sk-or-valid-test-key-1234',
    });

    assert.ok(interceptedPayload);
    assert.strictEqual(interceptedPayload.plugins, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('buildQuizTool provides valid OpenAI-compatible schema with 20 questions default and topic instructions', () => {
  const tool = buildQuizTool();
  assert.strictEqual(tool.type, 'function');
  assert.strictEqual(tool.function.name, QUIZ_TOOL_NAME);
  assert.strictEqual(tool.function.name, 'create_quiz');

  // Verify parameters
  const params = tool.function.parameters;
  assert.strictEqual(params.type, 'object');
  assert.deepStrictEqual(params.required, ['title', 'category', 'summary', 'questions']);
  assert.ok(params.properties.title);
  assert.ok(params.properties.category);
  assert.ok(params.properties.questions);

  // Verify questions schema
  const qItem = params.properties.questions.items;
  assert.deepStrictEqual(qItem.required, ['question_text', 'options', 'correct_answer', 'explanation']);

  // Verify explicit instructions for ~20 questions default and following user topic
  const desc = tool.function.description.toLowerCase();
  assert.ok(desc.includes('20 pertanyaan') || desc.includes('20 questions'));
  assert.ok(desc.includes('instruksi') || desc.includes('topik'));
});

test('accumulateToolCalls merges streamed function arguments delta correctly', () => {
  let map = {};
  map = accumulateToolCalls(map, [
    { index: 0, id: 'call_1', function: { name: 'create_quiz', arguments: '{"title":' } },
  ]);
  map = accumulateToolCalls(map, [
    { index: 0, function: { arguments: '"Fotosintesis",' } },
  ]);
  map = accumulateToolCalls(map, [
    { index: 0, function: { arguments: '"questions":[]}' } },
  ]);

  assert.strictEqual(map[0].id, 'call_1');
  assert.strictEqual(map[0].function.name, 'create_quiz');
  assert.strictEqual(map[0].function.arguments, '{"title":"Fotosintesis","questions":[]}');
});

test('formatQuizCardMarker creates valid markdown marker with escaped attributes', () => {
  const marker = formatQuizCardMarker({
    id: '123e4567-e89b-12d3-a456-426614174000',
    title: 'Kuis "Biologi" Sel',
    category: 'Biologi',
    questions: new Array(20).fill({}),
    difficulty: 'medium',
  });

  assert.ok(marker.includes(':::quiz-card{'));
  assert.ok(marker.includes('id="123e4567-e89b-12d3-a456-426614174000"'));
  assert.ok(marker.includes('count="20"'));
  assert.ok(marker.includes('&quot;Biologi&quot;'));
});

test('server handleChatRequest provides create_quiz tool in OpenRouter payload', async () => {
  const originalFetch = globalThis.fetch;
  let interceptedPayload = null;

  globalThis.fetch = async (url, options) => {
    interceptedPayload = JSON.parse(options.body);
    const sseData = 'data: {"choices":[{"delta":{"content":"Halo"}}]}\n\ndata: [DONE]\n\n';
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(sseData));
        controller.close();
      },
    });
    return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  };

  try {
    const { req, res } = createMockReqRes({
      body: { messages: [{ role: 'user', text: 'Buatkan kuis' }] },
    });

    await handleChatRequest(req, res, {
      OPENROUTER_API_KEY: 'sk-or-valid-test-key-1234',
    });

    assert.ok(interceptedPayload);
    assert.ok(Array.isArray(interceptedPayload.tools));
    const hasQuizTool = interceptedPayload.tools.some(t => t.function?.name === 'create_quiz');
    assert.strictEqual(hasQuizTool, true, 'must include create_quiz tool in tools array');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('SYSTEM_PROMPT instructs the model on create_quiz, user topics, and 20 questions default', () => {
  const prompt = SYSTEM_PROMPT.toLowerCase();
  assert.ok(prompt.includes('create_quiz'), 'must mention create_quiz');
  assert.ok(prompt.includes('20 pertanyaan') || prompt.includes('20 questions'), 'must mention 20 questions default');
  assert.ok(prompt.includes('topik') || prompt.includes('jumlah'), 'must mention following topic and count instructions');
});

test('QUIZ_TOOL_SYSTEM_PROMPT defines specific guidelines for tool calling workflow, schema, and error recall', () => {
  const quizPrompt = getQuizToolSystemPrompt();
  assert.strictEqual(quizPrompt, QUIZ_TOOL_SYSTEM_PROMPT);
  assert.ok(quizPrompt.includes('create_quiz'), 'must specify create_quiz');
  assert.ok(quizPrompt.includes('TRIGGER CONDITIONS'), 'must specify trigger conditions');
  assert.ok(quizPrompt.includes('MANDATORY WEB SEARCH GROUNDING'), 'must specify mandatory web search grounding');
  assert.ok(quizPrompt.includes('TOPIC ADHERENCE & QUESTION COUNT'), 'must specify topic adherence and count');
  assert.ok(quizPrompt.includes('SCHEMA CONSTRAINTS'), 'must specify schema constraints');
  assert.ok(quizPrompt.includes('WORKFLOW & USER EXPERIENCE'), 'must specify workflow and UI card');
  assert.ok(quizPrompt.includes('ALGORITHMIC ERROR RECOVERY & RECALL'), 'must specify algorithmic error recovery');
  assert.ok(SYSTEM_PROMPT.includes(QUIZ_TOOL_SYSTEM_PROMPT), 'SYSTEM_PROMPT must incorporate QUIZ_TOOL_SYSTEM_PROMPT');
});

test('migration 020 defines sidebar lazy loading UI texts without fallback', async () => {
  const filePath = resolve(process.cwd(), 'migrations/020_add_sidebar_lazy_load_ui_texts.sql');
  assert.ok(existsSync(filePath), 'migration 020 file must exist');
  const sql = readFileSync(filePath, 'utf8');
  assert.ok(sql.includes('sidebar_load_more'), 'must define sidebar_load_more');
  assert.ok(sql.includes('sidebar_loading_more'), 'must define sidebar_loading_more');

  const dbUrl = process.env.DATABASE_URL;
  if (dbUrl) {
    const { query } = await import('../server/db.js');
    const rows = await query("SELECT key, value FROM ui_texts WHERE key IN ('sidebar_load_more', 'sidebar_loading_more');", [], dbUrl);
    assert.strictEqual(rows.length, 2, 'both UI text keys must exist in live database');
  }
});

test('getConversations strictly sorts by latest interacted with timestamp', async () => {
  const { saveConversation, saveMessage, getConversations, deleteConversation } = await import('../server/db.js');
  const dbUrl = process.env.DATABASE_URL;
  const convId1 = crypto.randomUUID();
  const convId2 = crypto.randomUUID();

  try {
    // 1. Create conversation 1
    await saveConversation({ id: convId1, userId: TEST_USER_ID, title: 'Interaction Test 1', databaseUrl: dbUrl });
    await saveMessage({ id: crypto.randomUUID(), conversationId: convId1, userId: TEST_USER_ID, content: 'First conv first msg', databaseUrl: dbUrl });

    // Slight delay to ensure distinct timestamp
    await new Promise(r => setTimeout(r, 200));

    // 2. Create conversation 2 with a newer message
    await saveConversation({ id: convId2, userId: TEST_USER_ID, title: 'Interaction Test 2', databaseUrl: dbUrl });
    await saveMessage({ id: crypto.randomUUID(), conversationId: convId2, userId: TEST_USER_ID, content: 'Second conv first msg', databaseUrl: dbUrl });

    // Conv 2 should be first
    let convs = await getConversations({ userId: TEST_USER_ID, limit: 10, databaseUrl: dbUrl });
    const idxConv1Before = convs.findIndex(c => c.id === convId1);
    const idxConv2Before = convs.findIndex(c => c.id === convId2);
    assert.ok(idxConv2Before < idxConv1Before, 'Conversation 2 should appear before Conversation 1');

    await new Promise(r => setTimeout(r, 200));

    // 3. Send a new message to conversation 1 -> now conv 1 has latest interaction
    await saveMessage({ id: crypto.randomUUID(), conversationId: convId1, userId: TEST_USER_ID, content: 'First conv latest reply', databaseUrl: dbUrl });

    convs = await getConversations({ userId: TEST_USER_ID, limit: 10, databaseUrl: dbUrl });
    const idxConv1After = convs.findIndex(c => c.id === convId1);
    const idxConv2After = convs.findIndex(c => c.id === convId2);
    assert.ok(idxConv1After < idxConv2After, 'Conversation 1 should now appear first after receiving the latest message');
  } finally {
    await deleteConversation({ conversationId: convId1, userId: TEST_USER_ID, databaseUrl: dbUrl });
    await deleteConversation({ conversationId: convId2, userId: TEST_USER_ID, databaseUrl: dbUrl });
  }
});

test('handleConversationsRequest returns pagination metadata with hasMore', async () => {
  const req = new EventEmitter();
  req.method = 'GET';
  req.url = `/api/conversations?userId=${TEST_USER_ID}&limit=2&offset=0`;
  req.headers = { 'x-forwarded-for': '127.0.0.1' };

  let statusCode = 0;
  let responseData = '';
  const res = {
    writeHead: (code) => { statusCode = code; },
    end: (str) => { responseData = str; },
    setHeader: () => {},
  };

  await handleConversationsRequest(req, res, { RATE_LIMIT: 1000 });
  assert.strictEqual(statusCode, 200);
  const parsed = JSON.parse(responseData);
  assert.ok(Array.isArray(parsed.conversations));
  assert.strictEqual(parsed.limit, 2);
  assert.strictEqual(parsed.offset, 0);
  assert.strictEqual(typeof parsed.hasMore, 'boolean');
});

test('chatStore loadMoreChats paginates and appends unique items to chats state', async () => {
  const { chats, hasMoreChats, historyLoadingMore, loadMoreChats } = await import('../src/chatStore.js');

  const originalFetch = globalThis.fetch;
  let requestedOffset = null;
  globalThis.fetch = async (url) => {
    const parsed = new URL(url, 'http://localhost');
    requestedOffset = parseInt(parsed.searchParams.get('offset') || '0', 10);
    return new Response(JSON.stringify({
      conversations: [
        { id: 'lazy-batch-1', title: 'Lazy Convo 1', updated_at: new Date().toISOString() },
        { id: 'lazy-batch-2', title: 'Lazy Convo 2', updated_at: new Date().toISOString() },
      ],
      hasMore: true,
      limit: 2,
      offset: requestedOffset,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  try {
    chats.val = [{ id: 'existing-1', title: 'Existing Convo', messages: [], messagesLoaded: true, updatedAt: Date.now() }];
    hasMoreChats.val = true;
    historyLoadingMore.val = false;

    await loadMoreChats();

    assert.strictEqual(requestedOffset, 1, 'offset must equal current chats count');
    assert.strictEqual(chats.val.length, 3, 'new batch items should be appended');
    assert.strictEqual(chats.val[1].id, 'lazy-batch-1');
    assert.strictEqual(chats.val[2].id, 'lazy-batch-2');
    assert.strictEqual(hasMoreChats.val, true);
    assert.strictEqual(historyLoadingMore.val, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('isWebSearchRequested forces true on quiz requests regardless of client webSearch toggle', () => {
  assert.strictEqual(isWebSearchRequested(false, { isQuiz: true }), true);
  assert.strictEqual(isWebSearchRequested('false', { isQuiz: true }), true);
  assert.strictEqual(isWebSearchRequested(0, { isQuiz: true }), true);
  assert.strictEqual(isWebSearchRequested(false, { isQuiz: false }), false);
});

test('server handleChatRequest attaches web search plugin on quiz requests even when client passed webSearch: false', async () => {
  const originalFetch = globalThis.fetch;
  let sentPayload = null;

  globalThis.fetch = async (url, options) => {
    sentPayload = JSON.parse(options.body);
    return {
      ok: true,
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
          controller.close();
        },
      }),
    };
  };

  try {
    const req = {
      method: 'POST',
      headers: { 'x-forwarded-for': '127.0.0.1' },
      body: {
        messages: [{ role: 'user', content: 'buatkan kuis tentang fotosintesis' }],
        webSearch: false,
      },
      on: () => {},
    };

    let responseData = '';
    const res = {
      writeHead: () => {},
      write: (chunk) => { responseData += chunk; },
      end: () => {},
    };

    await handleChatRequest(req, res, { OPENROUTER_API_KEY: 'test-key' });

    assert.ok(sentPayload, 'must have sent payload to OpenRouter');
    assert.ok(Array.isArray(sentPayload.plugins), 'must include plugins array');
    const webPlugin = sentPayload.plugins.find(p => p.id === 'web');
    assert.ok(webPlugin, 'must include web search plugin even when webSearch was false');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('deleteMessage removes message from database and memory', async () => {
  const { saveConversation, saveMessage, getMessages, deleteMessage } = await import('../server/db.js');
  const dbUrl = process.env.DATABASE_URL;
  const convId = crypto.randomUUID();
  const msgId = crypto.randomUUID();

  try {
    await saveConversation({ id: convId, userId: TEST_USER_ID, title: 'Delete Msg Test', databaseUrl: dbUrl });
    await saveMessage({ id: msgId, conversationId: convId, userId: TEST_USER_ID, role: 'assistant', content: 'Temp msg', databaseUrl: dbUrl });

    let msgs = await getMessages({ conversationId: convId, userId: TEST_USER_ID, databaseUrl: dbUrl });
    assert.strictEqual(msgs.some(m => m.id === msgId), true, 'message should exist before deletion');

    await deleteMessage(msgId, { databaseUrl: dbUrl });

    msgs = await getMessages({ conversationId: convId, userId: TEST_USER_ID, databaseUrl: dbUrl });
    assert.strictEqual(msgs.some(m => m.id === msgId), false, 'message should be deleted');
  } finally {
    const { deleteConversation } = await import('../server/db.js');
    await deleteConversation({ conversationId: convId, userId: TEST_USER_ID, databaseUrl: dbUrl });
  }
});

test('ConversationStreamWriter abort() cleans up empty placeholder message when no content was accumulated', async () => {
  const { ConversationStreamWriter, getMessages, deleteConversation } = await import('../server/db.js');
  const dbUrl = process.env.DATABASE_URL;
  const convId = crypto.randomUUID();
  const userMsgId = crypto.randomUUID();
  const assistantMsgId = crypto.randomUUID();

  try {
    const writer = new ConversationStreamWriter({
      conversationId: convId,
      userId: TEST_USER_ID,
      title: 'Abort Stream Test',
      userMessage: { id: userMsgId, role: 'user', text: 'Prompt without reply' },
      assistantMessageId: assistantMsgId,
      databaseUrl: dbUrl,
    });

    await writer.init();

    // Verify placeholder was created initially
    let msgs = await getMessages({ conversationId: convId, userId: TEST_USER_ID, databaseUrl: dbUrl });
    assert.strictEqual(msgs.length, 2, 'both user and placeholder assistant messages created');

    // Abort stream before any chunks accumulated (e.g. client reload mid web search / quiz generation)
    await writer.abort();

    // Verify empty placeholder was removed cleanly
    msgs = await getMessages({ conversationId: convId, userId: TEST_USER_ID, databaseUrl: dbUrl });
    assert.strictEqual(msgs.length, 1, 'empty placeholder should be deleted on abort');
    assert.strictEqual(msgs[0].id, userMsgId, 'only user message should remain');
  } finally {
    await deleteConversation({ conversationId: convId, userId: TEST_USER_ID, databaseUrl: dbUrl });
  }
});

test('sendMessage in router.js supports options.signal and throws Request was cancelled on abort', async () => {
  const originalFetch = globalThis.fetch;
  const abortCtrl = new AbortController();

  globalThis.fetch = async (url, options) => {
    return new Promise((resolve, reject) => {
      options.signal?.addEventListener('abort', () => {
        const err = new Error('The user aborted a request.');
        err.name = 'AbortError';
        reject(err);
      });
    });
  };

  try {
    const sendPromise = sendMessage(
      [{ role: 'user', content: 'hello' }],
      () => {},
      { signal: abortCtrl.signal }
    );

    // Trigger abort mid-flight
    abortCtrl.abort();

    await assert.rejects(sendPromise, (err) => {
      assert.strictEqual(err.message, 'Request was cancelled.');
      return true;
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('abortActiveGeneration cleanly cancels in-flight state and cleans up empty assistant messages in memory', async () => {
  const { abortActiveGeneration, loading, searchingWeb, buildingQuiz, chats, activeId } = await import('../src/state.js');

  const testConvId = 'test-mid-generation-conv';
  chats.val = [
    {
      id: testConvId,
      title: 'Mid Generation Chat',
      messages: [
        { id: 'u-1', role: 'user', text: 'buat kuis fotosintesis' },
        { id: 'a-1', role: 'assistant', text: '' },
      ],
      messagesLoaded: true,
      updatedAt: Date.now(),
    },
  ];
  activeId.val = testConvId;
  loading.val = true;
  buildingQuiz.val = true;
  searchingWeb.val = true;

  abortActiveGeneration();

  assert.strictEqual(loading.val, false, 'loading should be reset to false');
  assert.strictEqual(buildingQuiz.val, false, 'buildingQuiz should be reset to false');
  assert.strictEqual(searchingWeb.val, false, 'searchingWeb should be reset to false');

  const currentChat = chats.val.find(c => c.id === testConvId);
  assert.strictEqual(currentChat.messages.length, 1, 'empty assistant placeholder should be cleaned up');
  assert.strictEqual(currentChat.messages[0].id, 'u-1', 'user message preserved');
});

test('server handleChatRequest attaches tool_choice for create_quiz when isQuizRequest is true', async () => {
  const originalFetch = globalThis.fetch;
  let sentPayload = null;

  globalThis.fetch = async (url, options) => {
    sentPayload = JSON.parse(options.body);
    return {
      ok: true,
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
          controller.close();
        },
      }),
    };
  };

  try {
    const req = {
      method: 'POST',
      headers: { 'x-forwarded-for': '127.0.0.1' },
      body: {
        messages: [{ role: 'user', content: 'buat soal kuis biologi' }],
      },
      on: () => {},
    };

    const res = {
      writeHead: () => {},
      write: () => {},
      end: () => {},
    };

    await handleChatRequest(req, res, { OPENROUTER_API_KEY: 'test-key' });

    assert.ok(sentPayload, 'must send payload');
    assert.deepStrictEqual(
      sentPayload.tool_choice,
      { type: 'function', function: { name: 'create_quiz' } },
      'must force tool_choice for create_quiz on quiz request'
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('handleCompletedToolCalls never streams conversational apology text during recall and supports 10 retries', async () => {
  const originalFetch = globalThis.fetch;
  const streamedChunks = [];
  let recallCallCount = 0;
  let lastRequestBody = null;

  globalThis.fetch = async (url, options) => {
    recallCallCount++;
    lastRequestBody = JSON.parse(options.body);

    const streamContent = (recallCallCount === 1)
      ? 'data: {"choices":[{"delta":{"content":"I\'m sorry, but I encountered an error while trying to create the quiz."}}]}\n\ndata: [DONE]\n\n'
      : 'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_quiz_success","type":"function","function":{"name":"create_quiz","arguments":"{\\"title\\":\\"Kuis Biologi Sel\\",\\"category\\":\\"Biologi\\",\\"summary\\":\\"Kuis sel\\",\\"questions\\":[{\\"question_text\\":\\"Organel respirasi?\\",\\"options\\":[\\"Mitokondria\\",\\"Ribosom\\",\\"Nukleus\\",\\"Vakuola\\"],\\"correct_answer\\":0,\\"explanation\\":\\"Mitokondria menghasilkan ATP\\"}]}"}}]}}]}\n\ndata: [DONE]\n\n';

    return {
      ok: true,
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(streamContent));
          controller.close();
        },
      }),
    };
  };

  try {
    const res = {
      writableEnded: false,
      write: (data) => {
        streamedChunks.push(data);
      },
    };

    await handleCompletedToolCalls({
      toolCallsMap: {
        0: {
          id: 'call_initial',
          type: 'function',
          function: {
            name: 'create_quiz',
            arguments: '{invalid_json',
          },
        },
      },
      serverEnv: { DATABASE_URL: process.env.DATABASE_URL },
      userId: TEST_USER_ID,
      clientIp: '127.0.0.1',
      conversationId: crypto.randomUUID(),
      formattedMessages: [{ role: 'user', content: 'buatkan kuis biologi' }],
      res,
      apiKey: 'test-api-key',
      model: 'google/gemini-2.5-flash-lite',
      maxRetries: 10,
    });

    const allStreamed = streamedChunks.join('');
    assert.ok(!allStreamed.includes("I'm sorry, but I encountered an error"), 'must NOT stream apology text to user');
    assert.ok(allStreamed.includes(':::quiz-card{'), 'must stream quiz-card marker on successful creation');
    assert.ok(allStreamed.includes('Kuis Biologi Sel'), 'must include quiz title');
    assert.deepStrictEqual(lastRequestBody.tool_choice, { type: 'function', function: { name: 'create_quiz' } });
  } finally {
    globalThis.fetch = originalFetch;
  }
});











