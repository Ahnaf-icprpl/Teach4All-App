import { Router } from 'express';
import { handleQuizzesRequest } from '../quizzesApi.js';
import { handleMaterialsRequest } from '../materialsApi.js';

export function studyRouter(serverEnv) {
  const router = Router();
  router.all('/quizzes', (req, res) => handleQuizzesRequest(req, res, serverEnv));
  router.all('/materials', (req, res) => handleMaterialsRequest(req, res, serverEnv));
  return router;
}
