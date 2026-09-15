import { Router } from 'express';
import { handleChatRequest } from '../chatApi.js';
import { handleTitleRequest } from '../titleApi.js';
import { handleChatStatusRequest, handleChatStreamRequest } from '../chatTasks.js';

export function chatRouter(serverEnv) {
  const router = Router();
  router.post('/chat', (req, res) => handleChatRequest(req, res, serverEnv));
  router.get('/chat/status', (req, res) => handleChatStatusRequest(req, res, serverEnv));
  router.get('/chat/stream', (req, res) => handleChatStreamRequest(req, res, serverEnv));
  router.post('/title', (req, res) => handleTitleRequest(req, res, serverEnv));
  return router;
}
