import { createQuiz } from './db.js';
import { diagnoseAndValidateQuizArgs } from './quizValidator.js';
import { buildWebSearchPlugin } from './webSearch.js';

export const QUIZ_TOOL_NAME = 'create_quiz';

/**
 * Builds the OpenAI-compatible tool descriptor for create_quiz.
 */
export function buildQuizTool(serverEnv = {}) {
  return {
    type: 'function',
    function: {
      name: QUIZ_TOOL_NAME,
      description: 'Buat kuis pilihan ganda interaktif baru untuk pengguna dengan pertanyaan yang diverifikasi melalui riset pencarian web terkini, 4 pilihan jawaban, kunci jawaban yang tepat, dan penjelasan edukatif. Ikuti instruksi pengguna mengenai jumlah soal dan topik/materi spesifik yang diminta. Jika pengguna tidak menentukan jumlah soal, buatlah sekitar 20 pertanyaan secara default (default around 20 questions).',
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
                  description: 'Tepat 4 opsi jawaban unik tanpa awalan huruf ABCD',
                },
                correct_answer: {
                  type: 'integer',
                  description: 'Indeks 0-based opsi jawaban yang benar dari array options (0 untuk pilihan pertama, 1 untuk pilihan kedua, 2 untuk ketiga, 3 untuk keempat). Bukan huruf ABCD.',
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
    const rawArgs = toolCall?.function?.arguments || '{}';
    const validation = diagnoseAndValidateQuizArgs(rawArgs);

    if (!validation.valid) {
      return {
        success: false,
        errorType: validation.errorType,
        diagnostic: validation.diagnostic,
        errors: validation.errors,
        error: validation.diagnostic,
      };
    }

    const { title, category, summary, difficulty, icon, color, questions } = validation.data;

    const createdQuiz = await createQuiz(
      {
        userId: userId || null,
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

    return {
      success: true,
      quiz: createdQuiz,
      questionCount: questions.length,
    };
  } catch (err) {
    return {
      success: false,
      errorType: 'DATABASE_ERROR',
      diagnostic: `Database error during quiz creation: ${err.message}. Ensure database is reachable.`,
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
 * stream card injection, algorithmic error diagnostics, and model recall loop.
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
  maxRetries = 10,
}) {
  const calls = Object.values(toolCallsMap);
  let currentQuizCall = calls.find(c => c.function?.name === QUIZ_TOOL_NAME);
  if (!currentQuizCall) return;

  const databaseUrl = serverEnv.DATABASE_URL || process.env.DATABASE_URL;
  const conversationHistory = [...formattedMessages];

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const execResult = await parseAndExecuteQuizTool(currentQuizCall, {
      userId: userId || null,
      conversationId,
      databaseUrl,
    });

    if (execResult.success && execResult.quiz) {
      const cardMarker = formatQuizCardMarker(execResult.quiz);
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: cardMarker } }] })}\n\n`);
      }
      if (streamWriter) streamWriter.writeChunk(cardMarker);

      const count = execResult.quiz.questions?.length || execResult.questionCount || 20;
      const isEn = formattedMessages.some(m => m && m.role === 'user' && /\b(the|and|quiz|make|create|what|about)\b/i.test(m.content || ''));
      const messageText = isEn
        ? `Interactive quiz **${execResult.quiz.title}** (${count} questions) is ready! Click **Start Quiz** above to begin practicing.`
        : `Kuis interaktif **${execResult.quiz.title}** (${count} pertanyaan) berhasil dibuat dan siap dikerjakan! Klik tombol **Mulai Kuis** di atas untuk mulai berlatih.`;

      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: messageText } }] })}\n\n`);
      }
      if (streamWriter) streamWriter.writeChunk(messageText);
      return;
    }

    // Execution or validation failed; evaluate algorithmic recall
    if (attempt < maxRetries && apiKey && !controller?.signal?.aborted) {
      const callId = currentQuizCall.id || `call_quiz_${Date.now()}_${attempt}`;
      conversationHistory.push({
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: callId,
            type: 'function',
            function: {
              name: QUIZ_TOOL_NAME,
              arguments: currentQuizCall.function?.arguments || '{}',
            },
          },
        ],
      });

      conversationHistory.push({
        role: 'tool',
        tool_call_id: callId,
        name: QUIZ_TOOL_NAME,
        content: JSON.stringify({
          status: 'error',
          error_type: execResult.errorType || 'VALIDATION_ERROR',
          diagnostic: execResult.diagnostic || execResult.error,
          detailed_errors: execResult.errors || [],
          instruction: 'You MUST call create_quiz again immediately with all errors fixed. Do NOT apologize or respond in conversational plain text.',
        }),
      });

      try {
        const recallRes = await fetch(openRouterUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://teach4all.app',
            'X-Title': 'Teach4All',
            'X-Forwarded-For': clientIp,
            'X-Real-IP': clientIp,
            ...(conversationId ? { 'X-Session-Id': conversationId } : {}),
          },
          body: JSON.stringify({
            model,
            messages: conversationHistory,
            stream: true,
            user: userId || clientIp,
            tools: [buildQuizTool(serverEnv)],
            tool_choice: { type: 'function', function: { name: QUIZ_TOOL_NAME } },
            plugins: [buildWebSearchPlugin(serverEnv)],
            ...providerRouting,
          }),
          signal: controller?.signal,
        });

        if (!recallRes.ok || !recallRes.body) {
          break;
        }

        const recallReader = recallRes.body.getReader();
        const recallDecoder = new TextDecoder();
        let recallSseBuffer = '';
        const recallToolCalls = {};
        let recallText = '';

        while (true) {
          const { done, value } = await recallReader.read();
          if (done) break;

          recallSseBuffer += recallDecoder.decode(value, { stream: true });
          const lines = recallSseBuffer.split('\n');
          recallSseBuffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith('data: ')) continue;
            const data = trimmed.slice(6);
            if (data === '[DONE]') continue;
            try {
              const json = JSON.parse(data);
              const delta = json.choices?.[0]?.delta?.content || '';
              if (delta) {
                // Buffer text internally; NEVER stream intermediate excuses or apologies to the user!
                recallText += delta;
              }
              const tcDelta = json.choices?.[0]?.delta?.tool_calls;
              if (tcDelta) {
                accumulateToolCalls(recallToolCalls, tcDelta);
              }
            } catch {}
          }
        }

        const newCalls = Object.values(recallToolCalls);
        const nextQuizCall = newCalls.find(c => c.function?.name === QUIZ_TOOL_NAME);
        if (nextQuizCall) {
          currentQuizCall = nextQuizCall;
          continue;
        } else {
          // Model output plain text or apology instead of invoking create_quiz
          conversationHistory.push({
            role: 'assistant',
            content: recallText || 'Error attempting to construct quiz.',
          });
          conversationHistory.push({
            role: 'user',
            content: 'CRITICAL INSTRUCTION: Do NOT apologize or respond with plain conversational text. You MUST call the create_quiz function immediately with title, category, summary, difficulty, icon, color, and questions array.',
          });
          currentQuizCall = {
            id: `call_quiz_${Date.now()}_retry`,
            type: 'function',
            function: {
              name: QUIZ_TOOL_NAME,
              arguments: '{}',
            },
          };
          continue;
        }
      } catch (err) {
        break;
      }
    } else {
      if (!res.writableEnded) {
        const errorMsg = `\n\nMaaf, terjadi kendala saat menyusun kuis setelah ${attempt + 1} percobaan: ${execResult.error || 'kesalahan format'}. Silakan coba minta kuis kembali.`;
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: errorMsg } }] })}\n\n`);
        if (streamWriter) streamWriter.writeChunk(errorMsg);
      }
      return;
    }
  }
}
