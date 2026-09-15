import test from 'node:test';
import assert from 'node:assert';
import {
  UI_CACHE_TTL_MS,
  clearUiCache,
  getUiDataFromDb,
  getUiTextsFromDb,
  getChatPromptsFromDb,
  getGoogleTagIdFromDb,
} from '../server/uiTextsApi.js';
import { handleSsrRequest } from '../server/ssr.js';

try {
  if (typeof process.loadEnvFile === 'function') {
    process.loadEnvFile();
  }
} catch {}

const dbUrl = process.env.DATABASE_URL;

test('UI_CACHE_TTL_MS is set to exactly 10 minutes (600000 ms)', () => {
  assert.strictEqual(UI_CACHE_TTL_MS, 10 * 60 * 1000);
});

test('getUiDataFromDb retrieves texts and prompts in a single query and caches them', async () => {
  if (!dbUrl) {
    return; // Skip if no DB connected
  }

  clearUiCache();

  // First fetch (cold cache)
  const data1 = await getUiDataFromDb(dbUrl);
  assert.ok(data1.texts && typeof data1.texts === 'object');
  assert.ok(Object.keys(data1.texts).length > 0, 'texts should not be empty');
  assert.ok(Array.isArray(data1.prompts) && data1.prompts.length > 0, 'prompts should not be empty');

  // Second fetch (hot cache) should return identical data from memory
  const data2 = await getUiDataFromDb(dbUrl);
  assert.strictEqual(data2.texts, data1.texts, 'texts object reference should be identical from cache');
  assert.strictEqual(data2.prompts, data1.prompts, 'prompts array reference should be identical from cache');

  // Individual helper functions should read directly from the hot cache
  const texts = await getUiTextsFromDb(dbUrl);
  const prompts = await getChatPromptsFromDb(dbUrl);
  assert.strictEqual(texts, data1.texts);
  assert.strictEqual(prompts, data1.prompts);

  // Google tag id should read from cached texts
  const tagId = await getGoogleTagIdFromDb(dbUrl);
  assert.strictEqual(tagId, data1.texts.google_tag_id || null);
});

test('clearUiCache forces re-fetch on next request', async () => {
  if (!dbUrl) return;

  clearUiCache();
  const data1 = await getUiDataFromDb(dbUrl);

  clearUiCache(dbUrl);
  const data2 = await getUiDataFromDb(dbUrl);

  // Contents are equal, but new object references after clearing cache
  assert.notStrictEqual(data1.texts, data2.texts);
  assert.deepStrictEqual(data1.texts, data2.texts);
});

test('getUiDataFromDb deduplicates concurrent in-flight requests', async () => {
  if (!dbUrl) return;

  clearUiCache();

  // Launch 5 concurrent calls simultaneously
  const [res1, res2, res3, res4, res5] = await Promise.all([
    getUiDataFromDb(dbUrl),
    getUiDataFromDb(dbUrl),
    getUiDataFromDb(dbUrl),
    getUiTextsFromDb(dbUrl),
    getChatPromptsFromDb(dbUrl),
  ]);

  assert.strictEqual(res1.texts, res2.texts);
  assert.strictEqual(res1.texts, res3.texts);
  assert.strictEqual(res1.texts, res4);
  assert.strictEqual(res1.prompts, res5);
});

test('handleSsrRequest utilizes cached UI data and renders HTML successfully', async () => {
  if (!dbUrl) return;

  let statusCode = 0;
  let headers = {};
  let body = '';

  const req = { url: '/' };
  const res = {
    writeHead(status, head = {}) {
      statusCode = status;
      headers = head;
    },
    end(data) {
      body = data;
    },
  };

  await handleSsrRequest(req, res, { DATABASE_URL: dbUrl });

  assert.strictEqual(statusCode, 200);
  assert.strictEqual(headers['Content-Type'], 'text/html; charset=utf-8');
  assert.ok(body.includes('<div id="app"'), 'rendered html should contain app shell');
  assert.ok(body.includes('__TEACH4ALL_DATA__'), 'rendered html should contain initial data script');
});
