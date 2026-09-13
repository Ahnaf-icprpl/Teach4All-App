import test from 'node:test';
import assert from 'node:assert';
import {
  getModel,
  isPlaceholderKey,
  getApiKey,
  setApiKey,
  sendMessage,
  OPENROUTER_API_URL,
  DEFAULT_MODEL,
} from '../src/router.js';

test('router uses google/gemini-2.5-flash-lite by default', () => {
  assert.strictEqual(DEFAULT_MODEL, 'google/gemini-2.5-flash-lite');
  const model = getModel();
  assert.ok(model.includes('gemini-2.5-flash-lite'), `Model was ${model}`);
});

test('isPlaceholderKey identifies empty or placeholder keys', () => {
  assert.strictEqual(isPlaceholderKey(''), true);
  assert.strictEqual(isPlaceholderKey(null), true);
  assert.strictEqual(isPlaceholderKey(undefined), true);
  assert.strictEqual(isPlaceholderKey('sk-or-placeholder-key-replace-with-your-actual-key'), true);
  assert.strictEqual(isPlaceholderKey('my-placeholder-key'), true);
  assert.strictEqual(isPlaceholderKey('sk-or-v1-abcdef1234567890'), false);
});

test('storage getApiKey and setApiKey work properly', () => {
  const mockStorage = {
    _data: {},
    getItem(k) { return this._data[k] || null; },
    setItem(k, v) { this._data[k] = String(v); },
    removeItem(k) { delete this._data[k]; },
  };

  assert.strictEqual(setApiKey(mockStorage, 'sk-or-test-key-123'), '');
  assert.strictEqual(getApiKey(mockStorage), 'sk-or-test-key-123');

  assert.strictEqual(setApiKey(mockStorage, ''), '');
  assert.strictEqual(mockStorage.getItem('teach4all.openrouter-key.v1'), null);
});

test('sendMessage throws if no API key is provided', async () => {
  await assert.rejects(
    async () => {
      await sendMessage([{ role: 'user', text: 'Hello' }], '', () => {});
    },
    /OpenRouter API key is required/
  );
});

test('sendMessage sends proper payload to OpenRouter and streams chunks', async () => {
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
      [{ role: 'user', text: 'Hi' }],
      'sk-or-real-test-key',
      chunk => receivedChunks.push(chunk)
    );

    assert.strictEqual(interceptedUrl, OPENROUTER_API_URL);
    assert.strictEqual(interceptedOptions.method, 'POST');
    assert.strictEqual(interceptedOptions.headers['Authorization'], 'Bearer sk-or-real-test-key');
    assert.strictEqual(interceptedOptions.headers['Content-Type'], 'application/json');

    const body = JSON.parse(interceptedOptions.body);
    assert.strictEqual(body.model, 'google/gemini-2.5-flash-lite');
    assert.strictEqual(body.stream, true);
    assert.ok(body.messages.some(m => m.content === 'Hi'));

    assert.strictEqual(result, 'Hello world!');
    assert.deepStrictEqual(receivedChunks, ['Hello', 'Hello world!']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('sendMessage handles placeholder 401 error with informative message', async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () => {
    return new Response(
      JSON.stringify({ error: { message: 'User not found', code: 401 } }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  };

  try {
    await assert.rejects(
      async () => {
        await sendMessage(
          [{ role: 'user', text: 'test' }],
          'sk-or-placeholder-key-replace-with-your-actual-key',
          () => {}
        );
      },
      /Placeholder API key in use/
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('sendMessage handles 429 rate limit and 402 credits errors', async () => {
  const originalFetch = globalThis.fetch;

  try {
    globalThis.fetch = async () => new Response('', { status: 429 });
    await assert.rejects(
      async () => {
        await sendMessage([{ role: 'user', text: 'test' }], 'sk-valid-key', () => {});
      },
      /rate limit reached/
    );

    globalThis.fetch = async () => new Response('', { status: 402 });
    await assert.rejects(
      async () => {
        await sendMessage([{ role: 'user', text: 'test' }], 'sk-valid-key', () => {});
      },
      /Insufficient OpenRouter credits/
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
