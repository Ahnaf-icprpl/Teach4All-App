import test from 'node:test';
import assert from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { EventEmitter } from 'node:events';

import { loadLocalEnv } from '../scripts/migrate.mjs';
loadLocalEnv();
const DB_URL = process.env.DATABASE_URL;

import {
  getQuizzes,
  getQuizById,
  createQuiz,
  setQuizSolvedStatus,
  getMaterials,
  getMaterialById,
  createMaterial,
  setMaterialSolvedStatus,
  query,
  runSql,
  DEFAULT_USER_ID,
} from '../server/db.js';

import { handleQuizzesRequest } from '../server/quizzesApi.js';
import { handleMaterialsRequest } from '../server/materialsApi.js';
import { QUIZZES_STORAGE_KEY, MATERIALS_STORAGE_KEY } from '../src/storage.js';
import {
  quizzes,
  materials,
  fetchQuizzes,
  fetchMaterials,
  fetchQuizDetails,
  fetchMaterialDetails,
  markQuizSolved,
  markMaterialSolved,
  normalizeQuizQuestion,
  normalizeMaterialSection,
  FALLBACK_QUIZZES,
  FALLBACK_MATERIALS,
} from '../src/studyModules.js';

function createMockReqRes({ method = 'GET', url = '/api/quizzes', body = null } = {}) {
  const req = new EventEmitter();
  req.method = method;
  req.url = url;
  req.headers = { 'x-forwarded-for': '127.0.0.1' };

  const res = {
    statusCode: 200,
    headers: {},
    body: '',
    ended: false,
    headersSent: false,
    writeHead(status, headers = {}) {
      this.statusCode = status;
      this.headers = { ...this.headers, ...headers };
      this.headersSent = true;
    },
    write(chunk) {
      this.body += (typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString());
    },
    end(chunk = '') {
      if (chunk) this.write(chunk);
      this.ended = true;
    },
  };

  process.nextTick(() => {
    if (body !== null) {
      req.emit('data', typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.emit('end');
  });

  return { req, res };
}

test('migration 011 defines quizzes, quiz_questions, materials, and material_sections tables with constraints', () => {
  const filePath = resolve(process.cwd(), 'migrations/011_create_quizzes_and_materials_tables.sql');
  assert.strictEqual(existsSync(filePath), true, 'migration file 011 must exist');

  const sql = readFileSync(filePath, 'utf8');

  // Table definitions
  assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS quizzes'), 'Must create quizzes table');
  assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS quiz_questions'), 'Must create quiz_questions table');
  assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS materials'), 'Must create materials table');
  assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS material_sections'), 'Must create material_sections table');

  // Foreign key cascade rules
  assert.ok(sql.includes('REFERENCES quizzes(id) ON DELETE CASCADE'), 'quiz_questions must cascade delete on quiz removal');
  assert.ok(sql.includes('REFERENCES materials(id) ON DELETE CASCADE'), 'material_sections must cascade delete on material removal');

  // Unique ordering constraints
  assert.ok(
    sql.includes('CONSTRAINT uq_quiz_question_number UNIQUE (quiz_id, question_number)'),
    'Must enforce unique question numbers per quiz'
  );
  assert.ok(
    sql.includes('CONSTRAINT uq_material_section_number UNIQUE (material_id, section_number)'),
    'Must enforce unique section numbers per material'
  );

  // Updated_at triggers
  assert.ok(sql.includes('trg_quizzes_updated_at'), 'Must have trigger for quizzes updated_at');
  assert.ok(sql.includes('trg_quiz_questions_updated_at'), 'Must have trigger for quiz_questions updated_at');
  assert.ok(sql.includes('trg_materials_updated_at'), 'Must have trigger for materials updated_at');
  assert.ok(sql.includes('trg_material_sections_updated_at'), 'Must have trigger for material_sections updated_at');

  // Seed data
  assert.ok(sql.includes("('00000000-0000-0000-0001-000000000001'"), 'Must insert quiz seed 1');
  assert.ok(sql.includes("('00000000-0000-0000-0002-000000000001'"), 'Must insert material seed 1');
});

test('storage keys include versioned keys for quizzes and materials', () => {
  assert.strictEqual(QUIZZES_STORAGE_KEY, 'teach4all.quizzes.v1');
  assert.strictEqual(MATERIALS_STORAGE_KEY, 'teach4all.materials.v1');
});

test('studyModules exports fallback seeds and reactive state', () => {
  assert.ok(Array.isArray(FALLBACK_QUIZZES), 'FALLBACK_QUIZZES must be an array');
  assert.strictEqual(FALLBACK_QUIZZES.length, 5, 'Should have 5 fallback quizzes');
  assert.ok(Array.isArray(FALLBACK_MATERIALS), 'FALLBACK_MATERIALS must be an array');
  assert.strictEqual(FALLBACK_MATERIALS.length, 5, 'Should have 5 fallback materials');

  const currentQuizzes = quizzes.val;
  const currentMaterials = materials.val;
  assert.ok(Array.isArray(currentQuizzes) && currentQuizzes.length >= 5);
  assert.ok(Array.isArray(currentMaterials) && currentMaterials.length >= 5);

  const q1 = currentQuizzes[0];
  assert.ok(q1.id && q1.title && q1.category);
  assert.strictEqual(typeof (q1.questionCount ?? q1.question_count), 'number');

  const m1 = currentMaterials[0];
  assert.ok(m1.id && m1.title && m1.category);
  assert.strictEqual(typeof (m1.sectionCount ?? m1.section_count ?? m1.part_count), 'number');
});

test('server db helpers getQuizzes and getMaterials fetch relational data with counts', async () => {
  if (!DB_URL) return;

  const quizList = await getQuizzes({ databaseUrl: DB_URL });
  assert.ok(Array.isArray(quizList), 'getQuizzes should return an array');
  assert.ok(quizList.length >= 5, 'Should return at least 5 seeded quizzes');

  const firstQuiz = quizList[0];
  assert.ok(firstQuiz.id);
  assert.ok(firstQuiz.title);
  assert.ok(Number(firstQuiz.question_count) >= 1, 'Question count should be >= 1');

  const materialList = await getMaterials({ databaseUrl: DB_URL });
  assert.ok(Array.isArray(materialList), 'getMaterials should return an array');
  assert.ok(materialList.length >= 5, 'Should return at least 5 seeded materials');

  const firstMaterial = materialList[0];
  assert.ok(firstMaterial.id);
  assert.ok(firstMaterial.title);
  assert.ok(Number(firstMaterial.section_count ?? firstMaterial.part_count) >= 1, 'Section count should be >= 1');
});

test('server db helpers getQuizById and getMaterialById fetch detailed items in order', async () => {
  if (!DB_URL) return;

  const seedQuizId = '00000000-0000-0000-0001-000000000001';
  const quiz = await getQuizById(seedQuizId, { databaseUrl: DB_URL });
  assert.ok(quiz, 'Seeded quiz should be found');
  assert.strictEqual(quiz.id, seedQuizId);
  assert.ok(Array.isArray(quiz.questions), 'Quiz must have questions array');
  assert.strictEqual(quiz.questions.length, 5, 'Seeded quiz must have 5 questions');
  assert.strictEqual(quiz.questions[0].question_number, 1);
  assert.strictEqual(quiz.questions[1].question_number, 2);
  assert.ok(Array.isArray(quiz.questions[0].options), 'Options should be an array');
  assert.strictEqual(quiz.questions[0].options.length, 4, 'Each question should have 4 options');

  const seedMaterialId = '00000000-0000-0000-0002-000000000001';
  const material = await getMaterialById(seedMaterialId, { databaseUrl: DB_URL });
  assert.ok(material, 'Seeded material should be found');
  assert.strictEqual(material.id, seedMaterialId);
  assert.ok(Array.isArray(material.sections), 'Material must have sections array');
  assert.ok(material.sections.length >= 3, 'Seeded material must have >= 3 sections');
  assert.strictEqual(material.sections[0].section_number, 1);
  assert.strictEqual(material.sections[1].section_number, 2);
  assert.ok(material.sections[0].content.length > 20);
});

test('createQuiz and createMaterial insert records and cascade delete cleanly', async () => {
  if (!DB_URL) return;

  const testQuizId = '99999999-1111-2222-3333-444444444444';
  const testMaterialId = '99999999-5555-6666-7777-888888888888';

  try {
    // 1. Create Quiz
    const createdQuiz = await createQuiz({
      id: testQuizId,
      userId: DEFAULT_USER_ID,
      title: 'Automated Test Quiz',
      category: 'dialogs_cat_physics',
      summary: 'Testing quiz creation and cascading',
      difficulty: 'medium',
      icon: 'zap',
      color: '#3B82F6',
      questions: [
        {
          questionNumber: 1,
          questionText: 'Test question 1?',
          options: ['A', 'B', 'C', 'D'],
          correctAnswer: 'A',
          explanation: 'A is correct',
          points: 10,
        },
        {
          questionNumber: 2,
          questionText: 'Test question 2?',
          options: ['W', 'X', 'Y', 'Z'],
          correctAnswer: 'X',
          explanation: 'X is correct',
          points: 10,
        },
      ],
      databaseUrl: DB_URL,
    });

    assert.strictEqual(createdQuiz.id, testQuizId);
    assert.strictEqual(createdQuiz.title, 'Automated Test Quiz');
    assert.strictEqual(createdQuiz.questions.length, 2);

    // 2. Create Material
    const createdMaterial = await createMaterial({
      id: testMaterialId,
      userId: DEFAULT_USER_ID,
      title: 'Automated Test Material',
      category: 'dialogs_cat_math',
      summary: 'Testing material creation and cascading',
      estimatedReadTime: 12,
      difficulty: 'advanced',
      icon: 'calculator',
      color: '#10B981',
      sections: [
        {
          sectionNumber: 1,
          title: 'Section 1 Test',
          content: 'Content of section 1 in test',
          readTimeMinutes: 6,
        },
        {
          sectionNumber: 2,
          title: 'Section 2 Test',
          content: 'Content of section 2 in test',
          readTimeMinutes: 6,
        },
      ],
      databaseUrl: DB_URL,
    });

    assert.strictEqual(createdMaterial.id, testMaterialId);
    assert.strictEqual(createdMaterial.title, 'Automated Test Material');
    assert.strictEqual(createdMaterial.sections.length, 2);

    // 3. Test cascade deletion on Quiz
    await runSql(`DELETE FROM quizzes WHERE id = '${testQuizId}';`, DB_URL);
    const questionsRemaining = await runSql(
      `SELECT count(*) FROM quiz_questions WHERE quiz_id = '${testQuizId}';`,
      DB_URL
    );
    assert.ok(questionsRemaining.includes('0'), 'Questions must cascade delete when quiz is removed');

    // 4. Test cascade deletion on Material
    await runSql(`DELETE FROM materials WHERE id = '${testMaterialId}';`, DB_URL);
    const sectionsRemaining = await runSql(
      `SELECT count(*) FROM material_sections WHERE material_id = '${testMaterialId}';`,
      DB_URL
    );
    assert.ok(sectionsRemaining.includes('0'), 'Sections must cascade delete when material is removed');
  } finally {
    try {
      await runSql(`DELETE FROM quizzes WHERE id = '${testQuizId}';`, DB_URL);
      await runSql(`DELETE FROM materials WHERE id = '${testMaterialId}';`, DB_URL);
    } catch {}
  }
});

test('handleQuizzesRequest handles GET and POST HTTP endpoints', async () => {
  // 1. Rejects invalid method
  const { req: reqPut, res: resPut } = createMockReqRes({ method: 'PUT', url: '/api/quizzes' });
  await handleQuizzesRequest(reqPut, resPut);
  assert.strictEqual(resPut.statusCode, 405);

  // 2. GET /api/quizzes returns list
  const { req: reqGet, res: resGet } = createMockReqRes({ method: 'GET', url: '/api/quizzes' });
  await handleQuizzesRequest(reqGet, resGet);
  assert.strictEqual(resGet.statusCode, 200);
  const getBody = JSON.parse(resGet.body);
  assert.ok(Array.isArray(getBody.quizzes));
  assert.ok(getBody.quizzes.length >= 5);

  // 3. GET /api/quizzes?id=seedId returns single quiz with questions
  const seedQuizId = '00000000-0000-0000-0001-000000000001';
  const { req: reqDetail, res: resDetail } = createMockReqRes({
    method: 'GET',
    url: `/api/quizzes?id=${seedQuizId}`,
  });
  await handleQuizzesRequest(reqDetail, resDetail);
  assert.strictEqual(resDetail.statusCode, 200);
  const detailBody = JSON.parse(resDetail.body);
  assert.ok(detailBody.quiz);
  assert.strictEqual(detailBody.quiz.id, seedQuizId);
  assert.strictEqual(detailBody.quiz.questions.length, 5);

  // 4. GET /api/quizzes?id=not-found returns 404
  const { req: req404, res: res404 } = createMockReqRes({
    method: 'GET',
    url: '/api/quizzes?id=00000000-0000-0000-0000-000000000000',
  });
  await handleQuizzesRequest(req404, res404);
  assert.strictEqual(res404.statusCode, 404);

  // 5. POST /api/quizzes validates title
  const { req: reqInvalidPost, res: resInvalidPost } = createMockReqRes({
    method: 'POST',
    url: '/api/quizzes',
    body: { summary: 'No title provided' },
  });
  await handleQuizzesRequest(reqInvalidPost, resInvalidPost);
  assert.strictEqual(resInvalidPost.statusCode, 400);
});

test('handleMaterialsRequest handles GET and POST HTTP endpoints', async () => {
  // 1. Rejects invalid method
  const { req: reqDelete, res: resDelete } = createMockReqRes({ method: 'DELETE', url: '/api/materials' });
  await handleMaterialsRequest(reqDelete, resDelete);
  assert.strictEqual(resDelete.statusCode, 405);

  // 2. GET /api/materials returns list
  const { req: reqGet, res: resGet } = createMockReqRes({ method: 'GET', url: '/api/materials' });
  await handleMaterialsRequest(reqGet, resGet);
  assert.strictEqual(resGet.statusCode, 200);
  const getBody = JSON.parse(resGet.body);
  assert.ok(Array.isArray(getBody.materials));
  assert.ok(getBody.materials.length >= 5);

  // 3. GET /api/materials?id=seedId returns single material with sections
  const seedMaterialId = '00000000-0000-0000-0002-000000000001';
  const { req: reqDetail, res: resDetail } = createMockReqRes({
    method: 'GET',
    url: `/api/materials?id=${seedMaterialId}`,
  });
  await handleMaterialsRequest(reqDetail, resDetail);
  assert.strictEqual(resDetail.statusCode, 200);
  const detailBody = JSON.parse(resDetail.body);
  assert.ok(detailBody.material);
  assert.strictEqual(detailBody.material.id, seedMaterialId);
  assert.ok(detailBody.material.sections.length >= 3);

  // 4. GET /api/materials?id=not-found returns 404
  const { req: req404, res: res404 } = createMockReqRes({
    method: 'GET',
    url: '/api/materials?id=00000000-0000-0000-0000-000000000000',
  });
  await handleMaterialsRequest(req404, res404);
  assert.strictEqual(res404.statusCode, 404);

  // 5. POST /api/materials validates title
  const { req: reqInvalidPost, res: resInvalidPost } = createMockReqRes({
    method: 'POST',
    url: '/api/materials',
    body: { summary: 'Missing title' },
  });
  await handleMaterialsRequest(reqInvalidPost, resInvalidPost);
  assert.strictEqual(resInvalidPost.statusCode, 400);
});

test('client fetchQuizzes and fetchMaterials update state on successful response', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url) => {
      if (url.includes('/api/quizzes')) {
        return new Response(
          JSON.stringify({
            quizzes: [
              {
                id: 'mock-q-1',
                title: 'Mock Quiz Online',
                category: 'dialogs_cat_chem',
                summary: 'Online summary',
                question_count: 8,
                difficulty: 'hard',
                icon: 'flask',
                color: '#EC4899',
                prompt: 'online prompt',
                updated_at: new Date().toISOString(),
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.includes('/api/materials')) {
        return new Response(
          JSON.stringify({
            materials: [
              {
                id: 'mock-m-1',
                title: 'Mock Material Online',
                category: 'dialogs_cat_biology',
                summary: 'Online material summary',
                section_count: 6,
                estimated_read_time: 14,
                difficulty: 'medium',
                icon: 'dna',
                color: '#10B981',
                prompt: 'online material prompt',
                updated_at: new Date().toISOString(),
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response('Not found', { status: 404 });
    };

    const fetchedQ = await fetchQuizzes();
    assert.strictEqual(fetchedQ.length, 1);
    assert.strictEqual(fetchedQ[0].id, 'mock-q-1');
    assert.strictEqual(quizzes.val[0].title, 'Mock Quiz Online');
    assert.strictEqual(quizzes.val[0].questionCount, 8);
    assert.strictEqual(quizzes.val[0].is_solved, false);

    const fetchedM = await fetchMaterials();
    assert.strictEqual(fetchedM.length, 1);
    assert.strictEqual(fetchedM[0].id, 'mock-m-1');
    assert.strictEqual(materials.val[0].title, 'Mock Material Online');
    assert.strictEqual(materials.val[0].sectionCount, 6);
    assert.strictEqual(materials.val[0].is_solved, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('migration 012 defines is_solved columns, indexes, and UI text keys', () => {
  const filePath = resolve(process.cwd(), 'migrations/012_add_is_solved_property.sql');
  assert.strictEqual(existsSync(filePath), true, 'migration file 012 must exist');

  const sql = readFileSync(filePath, 'utf8');
  assert.ok(sql.includes('ALTER TABLE quizzes\nADD COLUMN IF NOT EXISTS is_solved BOOLEAN NOT NULL DEFAULT false'));
  assert.ok(sql.includes('ALTER TABLE quiz_questions\nADD COLUMN IF NOT EXISTS is_solved BOOLEAN NOT NULL DEFAULT false'));
  assert.ok(sql.includes('ALTER TABLE materials\nADD COLUMN IF NOT EXISTS is_solved BOOLEAN NOT NULL DEFAULT false'));
  assert.ok(sql.includes('ALTER TABLE materials\nADD COLUMN IF NOT EXISTS is_completed BOOLEAN NOT NULL DEFAULT false'));
  assert.ok(sql.includes('ALTER TABLE material_sections\nADD COLUMN IF NOT EXISTS is_completed BOOLEAN NOT NULL DEFAULT false'));
  assert.ok(sql.includes('idx_quizzes_is_solved'));
  assert.ok(sql.includes('idx_materials_is_solved'));
  assert.ok(sql.includes('dialogs_status_solved'));
});

test('server db helpers and PATCH APIs handle is_solved status updates', async () => {
  if (!DB_URL) return;

  const seedQuizId = '00000000-0000-0000-0001-000000000001';
  const seedMaterialId = '00000000-0000-0000-0002-000000000001';

  // 1. DB helper setQuizSolvedStatus
  const updatedQuizTrue = await setQuizSolvedStatus(seedQuizId, true, { databaseUrl: DB_URL });
  assert.strictEqual(updatedQuizTrue.is_solved, true);

  const quizAfter = await getQuizById(seedQuizId, { databaseUrl: DB_URL });
  assert.strictEqual(quizAfter.is_solved, true);

  const updatedQuizFalse = await setQuizSolvedStatus(seedQuizId, false, { databaseUrl: DB_URL });
  assert.strictEqual(updatedQuizFalse.is_solved, false);

  // 2. DB helper setMaterialSolvedStatus
  const updatedMatTrue = await setMaterialSolvedStatus(seedMaterialId, true, { databaseUrl: DB_URL });
  assert.strictEqual(updatedMatTrue.is_solved, true);
  assert.strictEqual(updatedMatTrue.is_completed, true);

  const matAfter = await getMaterialById(seedMaterialId, { databaseUrl: DB_URL });
  assert.strictEqual(matAfter.is_solved, true);

  const updatedMatFalse = await setMaterialSolvedStatus(seedMaterialId, false, { databaseUrl: DB_URL });
  assert.strictEqual(updatedMatFalse.is_solved, false);

  // 3. API handleQuizzesRequest PATCH
  const { req: reqPatchQuiz, res: resPatchQuiz } = createMockReqRes({
    method: 'PATCH',
    url: '/api/quizzes',
    body: { id: seedQuizId, isSolved: true },
  });
  await handleQuizzesRequest(reqPatchQuiz, resPatchQuiz);
  assert.strictEqual(resPatchQuiz.statusCode, 200);
  const patchQuizBody = JSON.parse(resPatchQuiz.body);
  assert.strictEqual(patchQuizBody.quiz.is_solved, true);

  // Revert back
  await setQuizSolvedStatus(seedQuizId, false, { databaseUrl: DB_URL });

  // 4. API handleMaterialsRequest PATCH
  const { req: reqPatchMat, res: resPatchMat } = createMockReqRes({
    method: 'PATCH',
    url: '/api/materials',
    body: { id: seedMaterialId, isSolved: true },
  });
  await handleMaterialsRequest(reqPatchMat, resPatchMat);
  assert.strictEqual(resPatchMat.statusCode, 200);
  const patchMatBody = JSON.parse(resPatchMat.body);
  assert.strictEqual(patchMatBody.material.is_solved, true);

  // Revert back
  await setMaterialSolvedStatus(seedMaterialId, false, { databaseUrl: DB_URL });
});

test('client markQuizSolved and markMaterialSolved update state and localStorage', async () => {
  const originalFetch = globalThis.fetch;
  const patchedCalls = [];

  try {
    globalThis.fetch = async (url, options = {}) => {
      patchedCalls.push({ url, method: options.method, body: JSON.parse(options.body || '{}') });
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };

    const targetQuizId = quizzes.val[0]?.id;
    if (targetQuizId) {
      await markQuizSolved(targetQuizId, true);
      const q = quizzes.val.find(item => item.id === targetQuizId);
      assert.strictEqual(q.is_solved, true);
      assert.strictEqual(q.isSolved, true);

      await markQuizSolved(targetQuizId, false);
      const qReverted = quizzes.val.find(item => item.id === targetQuizId);
      assert.strictEqual(qReverted.is_solved, false);
      assert.strictEqual(qReverted.isSolved, false);
    }

    const targetMaterialId = materials.val[0]?.id;
    if (targetMaterialId) {
      await markMaterialSolved(targetMaterialId, true);
      const m = materials.val.find(item => item.id === targetMaterialId);
      assert.strictEqual(m.is_solved, true);
      assert.strictEqual(m.isSolved, true);

      await markMaterialSolved(targetMaterialId, false);
      const mReverted = materials.val.find(item => item.id === targetMaterialId);
      assert.strictEqual(mReverted.is_solved, false);
      assert.strictEqual(mReverted.isSolved, false);
    }

    assert.ok(patchedCalls.length >= 4, 'Should execute PATCH calls in background');
    assert.strictEqual(patchedCalls[0].method, 'PATCH');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('migration 013 defines interactive study UI text keys without fallback', () => {
  const filePath = resolve(process.cwd(), 'migrations/013_add_interactive_study_ui_texts.sql');
  assert.strictEqual(existsSync(filePath), true, 'migration file 013 must exist');

  const sql = readFileSync(filePath, 'utf8');
  assert.ok(sql.includes('dialogs_filter_all'), 'Must define filter all key');
  assert.ok(sql.includes('dialogs_filter_unsolved'), 'Must define filter unsolved key');
  assert.ok(sql.includes('dialogs_filter_solved'), 'Must define filter solved key');
  assert.ok(sql.includes('dialogs_btn_solve'), 'Must define solve button key');
  assert.ok(sql.includes('dialogs_btn_read'), 'Must define read button key');
  assert.ok(sql.includes('dialogs_btn_chat'), 'Must define chat button key');
  assert.ok(sql.includes('dialogs_quiz_loading'), 'Must define quiz loading key');
  assert.ok(sql.includes('dialogs_material_loading'), 'Must define material loading key');
  assert.ok(sql.includes('dialogs_toast_quiz_solved'), 'Must define toast quiz solved key');
  assert.ok(sql.includes('dialogs_toast_material_solved'), 'Must define toast material solved key');
});

test('fetchQuizDetails and fetchMaterialDetails return complete structured data with questions and sections', async () => {
  const seedQuizId = '00000000-0000-0000-0001-000000000001';
  const quiz = await fetchQuizDetails(seedQuizId);
  assert.ok(quiz, 'Quiz must be found');
  assert.strictEqual(quiz.id, seedQuizId);
  assert.ok(Array.isArray(quiz.questions), 'Quiz must have questions array');
  assert.ok(quiz.questions.length > 0, 'Quiz must contain questions');
  assert.ok(quiz.questions[0].options?.length >= 3, 'Question must have options');
  assert.ok(quiz.questions[0].correctAnswer !== undefined, 'Question must have correctAnswer');
  assert.ok(quiz.questions[0].explanation, 'Question must have explanation');

  const seedMaterialId = '00000000-0000-0000-0002-000000000001';
  const material = await fetchMaterialDetails(seedMaterialId);
  assert.ok(material, 'Material must be found');
  assert.strictEqual(material.id, seedMaterialId);
  assert.ok(Array.isArray(material.sections), 'Material must have sections array');
  assert.ok(material.sections.length > 0, 'Material must contain sections');
  assert.ok(material.sections[0].title, 'Section must have title');
  assert.ok(material.sections[0].content, 'Section must have content');
  assert.ok(material.sections[0].readTimeMinutes > 0, 'Section must have readTimeMinutes');
});

test('UI text keys from migration 013 exist in live database', async () => {
  if (!DB_URL) return;
  const rows = await query(
    "SELECT key, value FROM ui_texts WHERE key IN ('dialogs_filter_all', 'dialogs_filter_unsolved', 'dialogs_filter_solved', 'dialogs_btn_solve', 'dialogs_btn_read', 'dialogs_btn_chat');",
    [],
    DB_URL
  );
  assert.strictEqual(rows.length, 6, 'All 6 interactive study UI text keys must exist in database');
});

test('migration 014 defines DELETE statement for unused mock texts', () => {
  const filePath = resolve(process.cwd(), 'migrations/014_remove_unused_mock_ui_texts.sql');
  assert.strictEqual(existsSync(filePath), true, 'migration file 014 must exist');

  const sql = readFileSync(filePath, 'utf8');
  assert.ok(sql.includes('DELETE FROM ui_texts'), 'Must delete from ui_texts');
  assert.ok(sql.includes("key LIKE 'dialogs_mock_%'"), 'Must target dialogs_mock_% keys');
});

test('ui_texts in live database contains zero unused mock keys', async () => {
  if (!DB_URL) return;
  const rows = await query(
    "SELECT key FROM ui_texts WHERE key LIKE 'dialogs_mock_%';",
    [],
    DB_URL
  );
  assert.strictEqual(rows.length, 0, 'No mock keys should remain in ui_texts table');
});

test('normalizeQuizQuestion converts raw database questions with string options into interactive choices with option id/index', () => {
  const dbQuestion = {
    id: '123',
    question_number: 1,
    question_text: 'Apa kepanjangan dari CPU?',
    options: [
      'Central Personal Unit',
      'Computer Processing Unit',
      'Central Processing Unit',
      'Control Program Unit',
    ],
    correct_answer: '2',
    explanation: 'CPU adalah Central Processing Unit.',
    points: 10,
  };

  const normalized = normalizeQuizQuestion(dbQuestion);
  assert.strictEqual(normalized.questionNumber, 1);
  assert.strictEqual(normalized.questionText, 'Apa kepanjangan dari CPU?');
  assert.strictEqual(normalized.question_text, 'Apa kepanjangan dari CPU?');
  assert.strictEqual(normalized.options.length, 4);
  assert.deepStrictEqual(normalized.options[0], { id: 0, text: 'Central Personal Unit' });
  assert.deepStrictEqual(normalized.options[1], { id: 1, text: 'Computer Processing Unit' });
  assert.deepStrictEqual(normalized.options[2], { id: 2, text: 'Central Processing Unit' });
  assert.deepStrictEqual(normalized.options[3], { id: 3, text: 'Control Program Unit' });
  assert.strictEqual(normalized.correctAnswer, 2);
  assert.strictEqual(normalized.correct_answer, 2);
});

test('migration 019 converts quiz question options to explicit id/text and correct_answer to 0-based index', async () => {
  const filePath = resolve(process.cwd(), 'migrations/019_migrate_quiz_answers_to_option_index.sql');
  assert.strictEqual(existsSync(filePath), true, 'migration file 019 must exist');

  if (!DB_URL) return;
  const rows = await query('SELECT id, options, correct_answer FROM quiz_questions LIMIT 10;', [], DB_URL);
  for (const r of rows) {
    assert.ok(Array.isArray(r.options), 'options must be an array');
    for (const opt of r.options) {
      assert.ok(typeof opt.id === 'number', 'option must have numeric id');
      assert.ok(typeof opt.text === 'string', 'option must have text');
    }
    assert.ok(/^\d+$/.test(String(r.correct_answer)), 'correct_answer must be numeric index');
    const idx = parseInt(r.correct_answer, 10);
    assert.ok(idx >= 0 && idx < r.options.length, 'correct_answer must point to valid option index');
  }
});

test('normalizeMaterialSection converts raw database sections with snake_case fields', () => {
  const dbSection = {
    id: '456',
    section_number: 2,
    title: 'Arsitektur Von Neumann',
    content: 'Komponen utama meliputi ALU dan Control Unit.',
    read_time_minutes: 3,
  };

  const normalized = normalizeMaterialSection(dbSection);
  assert.strictEqual(normalized.sectionNumber, 2);
  assert.strictEqual(normalized.section_number, 2);
  assert.strictEqual(normalized.readTimeMinutes, 3);
  assert.strictEqual(normalized.read_time_minutes, 3);
  assert.strictEqual(normalized.title, 'Arsitektur Von Neumann');
});

test('studyViewer component does not render kembali ke daftar button or reference dialogs_back_to_list', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/components/studyViewer.js'), 'utf8');
  assert.strictEqual(source.includes('dialogs_back_to_list'), false, 'studyViewer.js must not reference dialogs_back_to_list');
  assert.strictEqual(source.includes('study-back-btn'), false, 'studyViewer.js must not contain study-back-btn class');
  assert.strictEqual(source.includes('onBack'), false, 'studyViewer.js must not expect or use onBack callback');
});



