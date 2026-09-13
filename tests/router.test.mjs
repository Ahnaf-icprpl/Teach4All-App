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
} from '../server/db.js';
import {
  generateTitle, TITLE_API_URL,
  fetchConversations, fetchMessages, deleteConversationApi,
  renameConversationApi, CONVERSATIONS_API_URL, MESSAGES_API_URL,
  TEST_USER_ID,
} from '../src/router.js';

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




