import { Router } from 'express';
import { handleConversationsRequest, handleMessagesRequest } from '../historyApi.js';

export function historyRouter(serverEnv) {
  const router = Router();
  router.all('/conversations', (req, res) => handleConversationsRequest(req, res, serverEnv));
  router.all('/messages', (req, res) => handleMessagesRequest(req, res, serverEnv));
  return router;
}
