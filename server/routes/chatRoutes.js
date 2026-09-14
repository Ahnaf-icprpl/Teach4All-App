import { Router } from 'express';
import { handleChatRequest } from '../chatApi.js';
import { handleTitleRequest } from '../titleApi.js';

export function chatRouter(serverEnv) {
  const router = Router();
  router.post('/chat', (req, res) => handleChatRequest(req, res, serverEnv));
  router.post('/title', (req, res) => handleTitleRequest(req, res, serverEnv));
  return router;
}
