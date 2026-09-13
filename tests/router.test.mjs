import test from 'node:test';
import assert from 'node:assert';
import { EventEmitter } from 'node:events';

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
import { SYSTEM_PROMPT, injectSystemPrompt } from '../prompts/systemPrompt.js';
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
  renameConversationApi, CONVERSATIONS_API_URL, MESSAGES_API_URL,
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








