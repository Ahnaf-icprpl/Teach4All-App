import { Router } from 'express';
import { handleUiTextsRequest, handleChatPromptsRequest } from '../uiTextsApi.js';

export function uiRouter(serverEnv) {
  const router = Router();
  router.get('/ui-texts', (req, res) => handleUiTextsRequest(req, res, serverEnv));
  router.get('/chat-prompts', (req, res) => handleChatPromptsRequest(req, res, serverEnv));
  return router;
}
