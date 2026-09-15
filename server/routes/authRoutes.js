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
  router.get('/whoami', (req, res) => handleWhoamiRequest(req, res, serverEnv, '/api/whoami'));
  router.get('/auth/whoami', (req, res) => handleWhoamiRequest(req, res, serverEnv, '/api/auth/whoami'));

  // Authentication mutations & config
  router.post('/auth/login', (req, res) => handleLoginRequest(req, res, serverEnv, '/api/auth/login'));
  router.post('/auth/signup', (req, res) => handleLoginRequest(req, res, serverEnv, '/api/auth/signup'));
  router.post('/auth/sync', (req, res) => handleLoginRequest(req, res, serverEnv, '/api/auth/sync'));
  router.post('/auth/logout', (req, res) => handleLogoutRequest(req, res, serverEnv, '/api/auth/logout'));
  router.get('/auth/logout', (req, res) => handleLogoutRequest(req, res, serverEnv, '/api/auth/logout'));
  router.get('/auth/config', (req, res) => handleAuthConfigRequest(req, res, serverEnv));

  return router;
}
