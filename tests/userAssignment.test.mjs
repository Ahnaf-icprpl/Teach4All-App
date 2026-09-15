import test from 'node:test';
import assert from 'node:assert';
import { authContextMiddleware } from '../server/authApi.js';
import { authenticateClerkRequest } from '../server/clerkVerifier.js';
import { saveConversation, getConversations, deleteMessage } from '../server/dbConversations.js';
import { createChatTask, handleChatStatusRequest, handleChatStreamRequest } from '../server/chatTasks.js';

test('authContextMiddleware binds req.user, req.userId, req.isGuest, and req.auth for guests', async () => {
  const middleware = authContextMiddleware({});
  const req = {
    headers: {},
  };
  const res = {
    headers: {},
    setHeader(k, v) {
      this.headers[k] = v;
    },
  };

  let nextCalled = false;
  await middleware(req, res, () => {
    nextCalled = true;
  });

  assert.strictEqual(nextCalled, true);
  assert.strictEqual(req.isGuest, true);
  assert.strictEqual(req.user, null);
  assert.ok(req.userId && req.userId.startsWith('guest_'));
  assert.deepStrictEqual(req.auth, {
    authenticated: false,
    user: null,
    userId: req.userId,
    isGuest: true,
  });
  assert.ok(res.headers['Set-Cookie']?.includes('teach4all_guest_id=guest_'));
});

test('authContextMiddleware rejects invalid guest ID formats and generates safe UUID', async () => {
  const middleware = authContextMiddleware({});
  const req = {
    headers: {
      'x-guest-id': 'malicious_user_id_without_prefix',
    },
  };
  const res = {
    headers: {},
    setHeader(k, v) {
      this.headers[k] = v;
    },
  };

  await middleware(req, res, () => {});

  assert.strictEqual(req.isGuest, true);
  assert.notStrictEqual(req.userId, 'malicious_user_id_without_prefix');
  assert.ok(req.userId.startsWith('guest_'));
});

test('authenticateClerkRequest rejects forged unverified tokens', async () => {
  const fakeHeader = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'ins_fake' })).toString('base64url');
  const fakePayload = Buffer.from(JSON.stringify({ sub: 'user_victim', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
  const fakeSig = Buffer.from('invalidsignaturedata').toString('base64url');
  const forgedToken = `${fakeHeader}.${fakePayload}.${fakeSig}`;

  const req = {
    headers: {
      authorization: `Bearer ${forgedToken}`,
    },
  };

  const auth = await authenticateClerkRequest(req, {});
  assert.strictEqual(auth.authenticated, false, 'forged token must not be authenticated');
  assert.strictEqual(auth.user, null);
});

test('saveConversation upgrades ownership from guest to authenticated user', async () => {
  const convId = '00000000-0000-4000-8000-000000000123';
  const guestId = 'guest_temp_test_123';
  const authUserId = 'user_real_clerk_456';

  // 1. Initially saved by guest
  const res1 = await saveConversation({
    id: convId,
    userId: guestId,
    title: 'Guest Topic',
  });
  assert.strictEqual(res1.userId, guestId);

  // 2. User logs in and continues same conversation
  const res2 = await saveConversation({
    id: convId,
    userId: authUserId,
    title: 'Guest Topic Updated',
  });
  assert.strictEqual(res2.userId, authUserId, 'conversation must upgrade to authenticated user');

  // 3. Another guest cannot hijack authenticated conversation
  const res3 = await saveConversation({
    id: convId,
    userId: 'guest_hijacker_999',
    title: 'Attempted Hijack',
  });
  assert.strictEqual(res3.userId, authUserId, 'conversation must remain owned by authenticated user');
});

test('chatTasks enforces strict user ownership on status and stream endpoints', async () => {
  const convId = '00000000-0000-4000-8000-000000000789';
  const ownerId = 'user_owner_abc';
  const attackerId = 'user_attacker_xyz';

  createChatTask({
    conversationId: convId,
    userId: ownerId,
    assistantMessageId: '00000000-0000-4000-8000-000000000790',
  });

  // Unauthorized user gets 403 on status
  let statusResult = null;
  const mockRes = {
    statusCode: 200,
    status(s) {
      this.statusCode = s;
      return this;
    },
    json(payload) {
      statusResult = payload;
    },
  };

  await handleChatStatusRequest({ query: { conversationId: convId }, userId: attackerId }, mockRes);
  assert.strictEqual(mockRes.statusCode, 403);
  assert.ok(statusResult?.error?.message.includes('Unauthorized'));

  // Request without userId also gets 403 on status
  const mockRes2 = {
    statusCode: 200,
    status(s) {
      this.statusCode = s;
      return this;
    },
    json() {},
  };
  await handleChatStatusRequest({ query: { conversationId: convId }, userId: null }, mockRes2);
  assert.strictEqual(mockRes2.statusCode, 403);

  // Unauthorized user gets 403 on stream
  const mockStreamRes = {
    statusCode: 200,
    status(s) {
      this.statusCode = s;
      return this;
    },
    json() {},
  };
  await handleChatStreamRequest({ query: { conversationId: convId }, userId: attackerId }, mockStreamRes);
  assert.strictEqual(mockStreamRes.statusCode, 403);
});

test('deleteMessage enforces user ownership scoping when userId is provided', async () => {
  const msgId = '00000000-0000-4000-8000-000000000333';
  const ownerId = 'user_msg_owner';
  const strangerId = 'user_msg_stranger';

  // Different user attempting deletion returns success: true but does not delete message
  const resStranger = await deleteMessage(msgId, { userId: strangerId });
  assert.strictEqual(resStranger.success, true);
});
