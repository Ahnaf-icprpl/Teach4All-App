import { createQuiz, DEFAULT_USER_ID } from './db.js';
import { logger } from './logger.js';

export const QUIZ_TOOL_NAME = 'create_quiz';

/**
 * Builds the OpenAI-compatible tool descriptor for create_quiz.
 */
export function buildQuizTool(serverEnv = {}) {
  return {
    type: 'function',
    function: {
      name: QUIZ_TOOL_NAME,
      description: 'Buat kuis pilihan ganda interaktif baru untuk pengguna dengan pertanyaan, 4 pilihan jawaban, kunci jawaban yang tepat, dan penjelasan edukatif. Ikuti instruksi pengguna mengenai jumlah soal dan topik/materi spesifik yang diminta. Jika pengguna tidak menentukan jumlah soal, buatlah sekitar 20 pertanyaan secara default (default around 20 questions).',
      parameters: {
        type: 'object',
        properties: {
          title: {
            type: 'string',
            description: 'Judul kuis yang deskriptif dan menarik (misal: "Kuis Fotosintesis & Reaksi Terang")',
          },
          category: {
            type: 'string',
            description: 'Kategori atau mata pelajaran (misal: "Biologi", "Matematika", "Fisika", "Astronomi", "Sejarah", "Bahasa")',
          },
          summary: {
            type: 'string',
            description: 'Ringkasan singkat 1-2 kalimat tentang cakupan materi yang diuji dalam kuis',
          },
          difficulty: {
            type: 'string',
            enum: ['easy', 'medium', 'hard'],
            description: 'Tingkat kesulitan kuis (easy, medium, hard)',
          },
          icon: {
            type: 'string',
            enum: ['leaf', 'globe', 'bulb', 'atom', 'book', 'spark'],
            description: 'Ikon kartu kuis yang sesuai',
          },
          color: {
            type: 'string',
            enum: ['green', 'blue', 'purple', 'amber'],
            description: 'Warna aksen kartu kuis',
          },
          questions: {
            type: 'array',
            description: 'Daftar pertanyaan pilihan ganda. Wajib mengikuti instruksi pengguna mengenai jumlah soal, atau buat sekitar 20 pertanyaan secara default jika tidak ditentukan pengguna.',
            items: {
              type: 'object',
              properties: {
                question_text: {
                  type: 'string',
                  description: 'Teks pertanyaan yang jelas dan edukatif',
                },
                options: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Tepat 4 opsi jawaban unik',
                },
                correct_answer: {
                  type: 'string',
                  description: 'Teks opsi jawaban yang benar (harus persis cocok dengan salah satu isi di options)',
                },
                explanation: {
                  type: 'string',
                  description: 'Penjelasan mendalam mengapa jawaban tersebut benar',
                },
                points: {
                  type: 'number',
                  description: 'Poin untuk pertanyaan ini (default: 10)',
                },
              },
              required: ['question_text', 'options', 'correct_answer', 'explanation'],
            },
          },
        },
        required: ['title', 'category', 'summary', 'questions'],
      },
    },
  };
}

/**
 * Merges streamed tool call delta chunks into a map of complete tool calls.
 */
export function accumulateToolCalls(toolCallsMap = {}, deltaToolCalls = []) {
  if (!Array.isArray(deltaToolCalls)) return toolCallsMap;
  for (const item of deltaToolCalls) {
    const idx = item.index ?? 0;
    if (!toolCallsMap[idx]) {
      toolCallsMap[idx] = {
        id: item.id || `call_${Date.now()}_${idx}`,
        type: item.type || 'function',
        function: {
          name: item.function?.name || '',
          arguments: '',
        },
      };
    }
    if (item.id) toolCallsMap[idx].id = item.id;
    if (item.function?.name) toolCallsMap[idx].function.name = item.function.name;
    if (item.function?.arguments) {
      toolCallsMap[idx].function.arguments += item.function.arguments;
    }
  }
  return toolCallsMap;
}

/**
 * Parses tool arguments and saves the quiz with all questions to PostgreSQL atomically.
 */
export async function parseAndExecuteQuizTool(toolCall, { userId, conversationId, databaseUrl } = {}) {
  try {
    const rawArgs = toolCall.function?.arguments || '{}';
    let args;
    try {
      args = JSON.parse(rawArgs);
    } catch {
      const cleaned = rawArgs.replace(/,\s*$/, '').trim();
      args = JSON.parse(cleaned);
    }

    const title = (args.title || 'Kuis Pembelajaran').trim();
    const category = (args.category || 'Umum').trim();
    const summary = (args.summary || `Kuis interaktif mengenai ${title}`).trim();
    const difficulty = ['easy', 'medium', 'hard'].includes(args.difficulty) ? args.difficulty : 'medium';
    const icon = ['leaf', 'globe', 'bulb', 'atom', 'book', 'spark'].includes(args.icon) ? args.icon : 'bulb';
    const color = ['green', 'blue', 'purple', 'amber'].includes(args.color) ? args.color : 'blue';

    const rawQuestions = Array.isArray(args.questions) ? args.questions : [];
    const questions = rawQuestions.map((q, idx) => {
      let opts = Array.isArray(q.options) ? q.options.map(o => String(o).trim()).filter(Boolean) : [];
      if (opts.length < 2) {
        opts = ['Opsi A', 'Opsi B', 'Opsi C', 'Opsi D'];
      }
      let correct = String(q.correct_answer || opts[0]).trim();
      if (!opts.includes(correct)) {
        const found = opts.find(o => o.toLowerCase() === correct.toLowerCase());
        correct = found || opts[0];
      }
      return {
        question_number: idx + 1,
        question_text: String(q.question_text || `Pertanyaan ${idx + 1}`).trim(),
        question_type: 'multiple_choice',
        options: opts,
        correct_answer: correct,
        explanation: String(q.explanation || 'Penjelasan tidak tersedia.').trim(),
        points: Number(q.points) || 10,
        is_solved: false,
      };
    });

    if (questions.length === 0) {
      throw new Error('Kuis harus memiliki minimal 1 pertanyaan.');
    }

    const createdQuiz = await createQuiz(
      {
        userId: userId || DEFAULT_USER_ID,
        conversationId: conversationId || null,
        title,
        category,
        summary,
        difficulty,
        icon,
        color,
        prompt: `Kuis tentang ${title}`,
        isPublished: true,
        isSolved: false,
      },
      questions,
      { databaseUrl }
    );

    logger.info('Quiz successfully created via tool call', {
      quiz_id: createdQuiz?.id,
      title: createdQuiz?.title,
      questions_count: questions.length,
      conversation_id: conversationId,
    });

    return {
      success: true,
      quiz: createdQuiz,
      questionCount: questions.length,
    };
  } catch (err) {
    logger.error('Failed to execute create_quiz tool', { error: err.message, stack: err.stack });
    return {
      success: false,
      error: err.message || 'Gagal membuat kuis.',
    };
  }
}

/**
 * Returns formatted interactive card marker for embedding in SSE stream and markdown.
 */
export function formatQuizCardMarker(quiz) {
  if (!quiz || !quiz.id) return '';
  const count = quiz.questions?.length || quiz.question_count || 20;
  const safeTitle = String(quiz.title || 'Kuis Interaktif').replace(/"/g, '&quot;');
  const safeCategory = String(quiz.category || 'Kuis').replace(/"/g, '&quot;');
  return `\n\n:::quiz-card{id="${quiz.id}" title="${safeTitle}" category="${safeCategory}" count="${count}" difficulty="${quiz.difficulty || 'medium'}"}:::\n\n`;
}

/**
 * Handles execution of completed tool calls, database persistence,
 * stream card injection, and follow-up completion round-trip.
 */
export async function handleCompletedToolCalls({
  toolCallsMap = {},
  serverEnv = {},
  userId,
  clientIp,
  conversationId,
  formattedMessages = [],
  streamWriter,
  res,
  controller,
  apiKey,
  model,
  providerRouting = {},
  openRouterUrl = 'https://openrouter.ai/api/v1/chat/completions',
}) {
  const calls = Object.values(toolCallsMap);
  const quizCall = calls.find(c => c.function?.name === QUIZ_TOOL_NAME);
  if (!quizCall) return;

  const databaseUrl = serverEnv.DATABASE_URL || process.env.DATABASE_URL;
  const execResult = await parseAndExecuteQuizTool(quizCall, {
    userId: userId || DEFAULT_USER_ID,
    conversationId,
    databaseUrl,
  });

  if (execResult.success && execResult.quiz) {
    const cardMarker = formatQuizCardMarker(execResult.quiz);
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: cardMarker } }] })}\n\n`);
    }
    if (streamWriter) streamWriter.writeChunk(cardMarker);

    // Make follow-up completion request to OpenRouter
    try {
      const secondUpstream = await fetch(openRouterUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://teach4all.local',
          'X-Title': 'Teach4All',
          'X-Forwarded-For': clientIp,
          'X-Real-IP': clientIp,
          ...(conversationId ? { 'X-Session-Id': conversationId } : {}),
        },
        body: JSON.stringify({
          model,
          messages: [
            ...formattedMessages,
            {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: quizCall.id,
                  type: 'function',
                  function: {
                    name: QUIZ_TOOL_NAME,
                    arguments: quizCall.function.arguments,
                  },
                },
              ],
            },
            {
              role: 'tool',
              tool_call_id: quizCall.id,
              content: JSON.stringify({
                status: 'success',
                quiz_id: execResult.quiz.id,
                title: execResult.quiz.title,
                question_count: execResult.questionCount,
              }),
            },
          ],
          stream: true,
          user: userId || clientIp,
          ...providerRouting,
        }),
        signal: controller?.signal,
      });

      if (secondUpstream.ok && secondUpstream.body && !res.writableEnded) {
        const secondReader = secondUpstream.body.getReader();
        const decoder = new TextDecoder();
        let secondBuffer = '';
        while (true) {
          const { done, value } = await secondReader.read();
          if (done) break;
          res.write(value);
          secondBuffer += decoder.decode(value, { stream: true });
          const sLines = secondBuffer.split('\n');
          secondBuffer = sLines.pop() || '';
          for (const sLine of sLines) {
            const sTrimmed = sLine.trim();
            if (!sTrimmed || !sTrimmed.startsWith('data: ')) continue;
            const sData = sTrimmed.slice(6);
            if (sData === '[DONE]') continue;
            try {
              const sJson = JSON.parse(sData);
              const sDelta = sJson.choices?.[0]?.delta?.content || '';
              if (sDelta && streamWriter) {
                streamWriter.writeChunk(sDelta);
              }
            } catch {}
          }
        }
      } else if (!res.writableEnded) {
        const fallbackMsg = '\n\nKuis interaktif telah dibuat dan siap dikerjakan! Klik tombol "Mulai Kuis" di atas untuk mulai berlatih.';
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: fallbackMsg } }] })}\n\n`);
        if (streamWriter) streamWriter.writeChunk(fallbackMsg);
      }
    } catch {
      if (!res.writableEnded) {
        const fallbackMsg = '\n\nKuis interaktif telah dibuat dan siap dikerjakan! Klik tombol "Mulai Kuis" di atas untuk mulai berlatih.';
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: fallbackMsg } }] })}\n\n`);
        if (streamWriter) streamWriter.writeChunk(fallbackMsg);
      }
    }
  } else if (!res.writableEnded) {
    const errorMsg = `\n\nMaaf, terjadi kendala saat membuat kuis: ${execResult.error || 'kesalahan internal'}.`;
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: errorMsg } }] })}\n\n`);
    if (streamWriter) streamWriter.writeChunk(errorMsg);
  }
}
