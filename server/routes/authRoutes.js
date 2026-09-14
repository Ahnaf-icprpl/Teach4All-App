import { Router } from 'express';
import {
  handleWhoamiRequest,
  handleLoginRequest,
  handleLogoutRequest,
  handleAuthConfigRequest,
} from '../authApi.js';

export function authRouter(serverEnv) {
  const router = Router();

  // Primary user authentication & inspection routes
  router.get('/whoami', (req, res) => handleWhoamiRequest(req, res, serverEnv));
  router.get('/auth/whoami', (req, res) => handleWhoamiRequest(req, res, serverEnv));

  // Authentication mutations & config
  router.post('/auth/login', (req, res) => handleLoginRequest(req, res, serverEnv));
  router.post('/auth/signup', (req, res) => handleLoginRequest(req, res, serverEnv));
  router.post('/auth/sync', (req, res) => handleLoginRequest(req, res, serverEnv));
  router.post('/auth/logout', (req, res) => handleLogoutRequest(req, res, serverEnv));
  router.get('/auth/logout', (req, res) => handleLogoutRequest(req, res, serverEnv));
  router.get('/auth/config', (req, res) => handleAuthConfigRequest(req, res, serverEnv));

  return router;
}
