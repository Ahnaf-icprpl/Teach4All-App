/**
 * Unified Database Access Layer.
 * Re-exports submodules for connection pooling, conversation/message storage,
 * and quiz/material persistence.
 */

export {
  getSslConfig,
  getPool,
  closePools,
  query,
  runSql,
  escapeSqlString,
  toUuid,
  toUserId,
  ensureUserExists,
  syncUserToDb,
  getUserFromDb,
  inMemoryConversations,
  inMemoryMessages,
  queryJson,
} from './dbCore.js';

export {
  saveConversation,
  saveMessage,
  getConversations,
  getMessages,
  deleteConversation,
  deleteMessage,
  updateConversationTitle,
  ConversationStreamWriter,
} from './dbConversations.js';

export {
  getQuizzes,
  getQuizById,
  setQuizSolvedStatus,
  createQuiz,
  getMaterials,
  getMaterialById,
  setMaterialSolvedStatus,
  createMaterial,
} from './dbQuizzesMaterials.js';
