import test from 'node:test';
import assert from 'node:assert';
import { loadLocalEnv } from '../scripts/migrate.mjs';
loadLocalEnv();
import {
  repairAndParseJson,
  stripOptionPrefix,
  diagnoseAndValidateQuizArgs,
  formatAlgorithmicDiagnostic,
} from '../server/quizValidator.js';
import {
  handleCompletedToolCalls,
  QUIZ_TOOL_NAME,
} from '../server/quizTool.js';
import { runSql } from '../server/db.js';

test('repairAndParseJson parses valid JSON and objects directly', () => {
  const obj = { title: 'Test', questions: [] };
  assert.deepStrictEqual(repairAndParseJson(obj).data, obj);

  const jsonStr = JSON.stringify(obj);
  const res = repairAndParseJson(jsonStr);
  assert.strictEqual(res.success, true);
  assert.strictEqual(res.data.title, 'Test');
});

test('repairAndParseJson repairs markdown fences and trailing commas', () => {
  const fenced = '```json\n{"title": "Fenced Quiz", "count": 20,}\n```';
  const res = repairAndParseJson(fenced);
  assert.strictEqual(res.success, true);
  assert.strictEqual(res.data.title, 'Fenced Quiz');
  assert.strictEqual(res.data.count, 20);
});

test('repairAndParseJson repairs unclosed brackets and quotes for truncated output', () => {
  const truncated = '{"title": "Truncated Quiz", "questions": [{"question_text": "Apa itu sel?';
  const res = repairAndParseJson(truncated);
  assert.strictEqual(res.success, true);
  assert.strictEqual(res.data.title, 'Truncated Quiz');
  assert.ok(Array.isArray(res.data.questions));
});

test('repairAndParseJson provides algorithmic syntax error for unrepairable input', () => {
  const broken = '{"title": "Broken", questions: not_json}';
  const res = repairAndParseJson(broken);
  assert.strictEqual(res.success, false);
  assert.strictEqual(res.errorType, 'SYNTAX_ERROR');
  assert.ok(res.diagnostic.includes('JSON Syntax Error'));
});

test('stripOptionPrefix strips various choice indicators', () => {
  assert.strictEqual(stripOptionPrefix('A. Mitokondria'), 'Mitokondria');
  assert.strictEqual(stripOptionPrefix('b) Ribosom'), 'Ribosom');
  assert.strictEqual(stripOptionPrefix('3- Kloroplas'), 'Kloroplas');
  assert.strictEqual(stripOptionPrefix('(d) Nukleus'), 'Nukleus');
  assert.strictEqual(stripOptionPrefix('Sitoplasma'), 'Sitoplasma');
});

test('diagnoseAndValidateQuizArgs validates required fields and generates diagnostic', () => {
  // Missing title and empty questions
  const res = diagnoseAndValidateQuizArgs({
    category: 'Biologi',
    questions: [],
  });

  assert.strictEqual(res.valid, false);
  assert.strictEqual(res.errorType, 'VALIDATION_ERROR');
  assert.ok(res.errors.some(e => e.includes("'title'")));
  assert.ok(res.errors.some(e => e.includes("'questions' array is empty")));
  assert.ok(res.diagnostic.includes('Algorithmic Validation Failed'));
});

test('diagnoseAndValidateQuizArgs detects correct_answer mismatch and provides actionable error', () => {
  const res = diagnoseAndValidateQuizArgs({
    title: 'Kuis Biologi Sel',
    questions: [
      {
        question_text: 'Bagian sel yang memproduksi energi?',
        options: ['Ribosom', 'Nukleus', 'Mitokondria', 'Vakuola'],
        correct_answer: 'Klorofil', // Does not match any option
        explanation: 'Mitokondria adalah tempat respirasi seluler.',
      },
    ],
  });

  assert.strictEqual(res.valid, false);
  assert.strictEqual(res.errorType, 'VALIDATION_ERROR');
  assert.ok(res.errors.some(e => e.includes('does not match any options')));
  assert.ok(res.diagnostic.includes('Klorofil'));
});

test('diagnoseAndValidateQuizArgs normalizes option prefix matching for correct_answer', () => {
  const res = diagnoseAndValidateQuizArgs({
    title: 'Kuis Biologi Sel',
    questions: [
      {
        question_text: 'Bagian sel yang memproduksi energi?',
        options: ['Ribosom', 'Nukleus', 'Mitokondria', 'Vakuola'],
        correct_answer: 'C. Mitokondria', // Model prefixed with 'C. '
        explanation: 'Mitokondria adalah tempat respirasi seluler.',
      },
    ],
  });

  assert.strictEqual(res.valid, true);
  assert.strictEqual(res.data.questions[0].correct_answer, 'Mitokondria');
});

test('handleCompletedToolCalls sends diagnostic error and recalls model when validation fails', async () => {
  const originalFetch = globalThis.fetch;
  let recallAttempted = false;
  let interceptedMessages = [];

  // Mock fetch for OpenRouter recall
  globalThis.fetch = async (url, options) => {
    if (String(url).includes('openrouter.ai')) {
      const payload = JSON.parse(options.body);
      interceptedMessages = payload.messages;
      recallAttempted = true;

      // Simulate model returning corrected tool call in the recall turn
      const sseChunks = [
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_recalled_1","function":{"name":"create_quiz","arguments":"{\\"title\\":\\"Kuis Diperbaiki\\",\\"category\\":\\"Sains\\",\\"summary\\":\\"Ringkasan\\",\\"questions\\":[{\\"question_text\\":\\"Apa rumus air?\\",\\"options\\":[\\"H2O\\",\\"CO2\\",\\"O2\\",\\"NaCl\\"],\\"correct_answer\\":\\"H2O\\",\\"explanation\\":\\"Air adalah H2O.\\"}]}"}}]}}]}\n\n',
        'data: [DONE]\n\n',
      ].join('');

      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(sseChunks));
          controller.close();
        },
      });

      return new Response(stream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    }

    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };

  try {
    const writtenData = [];
    const mockRes = {
      writableEnded: false,
      write(data) {
        writtenData.push(data);
      },
    };

    // First call has validation error (mismatched correct_answer)
    const badToolCall = {
      id: 'call_initial_failed',
      function: {
        name: QUIZ_TOOL_NAME,
        arguments: JSON.stringify({
          title: 'Kuis Kimia',
          questions: [
            {
              question_text: 'Apa rumus air?',
              options: ['H2O', 'CO2', 'O2', 'NaCl'],
              correct_answer: 'C6H12O6', // Mismatch!
              explanation: 'Air adalah H2O.',
            },
          ],
        }),
      },
    };

    await handleCompletedToolCalls({
      toolCallsMap: { 0: badToolCall },
      apiKey: 'sk-or-test-key',
      model: 'google/gemini-2.5-flash-lite',
      formattedMessages: [{ role: 'user', content: 'Buat kuis kimia' }],
      res: mockRes,
      serverEnv: { DATABASE_URL: process.env.DATABASE_URL },
    });

    // Ensure recall was triggered
    assert.strictEqual(recallAttempted, true);

    // Verify conversation history sent to OpenRouter in recall:
    // 1. User message
    // 2. Assistant tool call
    // 3. Tool response with algorithmic diagnostic
    const toolMsg = interceptedMessages.find(m => m.role === 'tool');
    assert.ok(toolMsg, 'Must include tool message in recall payload');
    assert.strictEqual(toolMsg.tool_call_id, 'call_initial_failed');
    const parsedToolContent = JSON.parse(toolMsg.content);
    assert.strictEqual(parsedToolContent.status, 'error');
    assert.ok(parsedToolContent.diagnostic.includes('Algorithmic Validation Failed'));
    assert.ok(parsedToolContent.diagnostic.includes('C6H12O6'));

    // Verify final output rendered the quiz card from the corrected recall call
    const allWritten = writtenData.join('');
    assert.ok(allWritten.includes(':::quiz-card{'), 'Must render quiz card marker on successful recall');
    assert.ok(allWritten.includes('Kuis Diperbaiki'), 'Must contain title from corrected quiz');
  } finally {
    globalThis.fetch = originalFetch;
    if (process.env.DATABASE_URL) {
      await runSql("DELETE FROM quizzes WHERE title = 'Kuis Diperbaiki';", process.env.DATABASE_URL);
    }
  }
});
