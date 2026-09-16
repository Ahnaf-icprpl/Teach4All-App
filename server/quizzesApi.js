import { getQuizzes, getQuizById, createQuiz, setQuizSolvedStatus, getQuestionClue, saveQuestionClue } from './db.js';
import { enforceRateLimit } from './rateLimiter.js';

function readJsonBody(req) {
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'object') return Promise.resolve(req.body);
    try {
      return Promise.resolve(JSON.parse(req.body || '{}'));
    } catch {
      return Promise.reject(new Error('Invalid JSON'));
    }
  }
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if (data.length > 1e6) reject(new Error('Payload Too Large'));
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(data || '{}'));
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

export async function handleQuizzesRequest(req, res, env = {}) {
  if (!(await enforceRateLimit(req, res, '/api/quizzes', env))) {
    return;
  }

  const url = new URL(req.url, 'http://localhost');
  const dbUrl = env.DATABASE_URL || process.env.DATABASE_URL;
  const userId = req.userId || req.headers?.['x-user-id'] || req.headers?.['x-guest-id'] || url.searchParams.get('userId');

  if (!userId) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'User ID is required.' } }));
    return;
  }

  if (req.method === 'GET') {
    const id = url.searchParams.get('id');
    const category = url.searchParams.get('category') || undefined;
    const search = url.searchParams.get('search') || url.searchParams.get('q') || undefined;
    const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '50', 10), 1), 100);
    const offset = Math.max(parseInt(url.searchParams.get('offset') || '0', 10), 0);

    try {
      if (id) {
        const quiz = await getQuizById(id, { userId, databaseUrl: dbUrl });
        if (!quiz) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'Quiz not found.' } }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
        res.end(JSON.stringify({ quiz }));
        return;
      }

      const quizzes = await getQuizzes({ userId, search, category, limit, offset, databaseUrl: dbUrl });
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
      res.end(JSON.stringify({ quizzes }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Failed to retrieve quizzes.' } }));
    }
    return;
  }

  if (req.method === 'POST') {
    let payload;
    try {
      payload = await readJsonBody(req);
    } catch (err) {
      res.writeHead(err.message === 'Payload Too Large' ? 413 : 400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: err.message || 'Invalid request' } }));
      return;
    }

    try {
      if (payload.action === 'clue') {
        const clue = await generateQuizClue(payload, env, req);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ clue }));
        return;
      }

      if (!payload.title || typeof payload.title !== 'string') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Title is required.' } }));
        return;
      }
      const quiz = await createQuiz({ ...payload, userId }, payload.questions || [], { databaseUrl: dbUrl });
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ quiz }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Failed to create quiz.' } }));
    }
    return;
  }

  if (req.method === 'PATCH') {
    let payload;
    try {
      payload = await readJsonBody(req);
    } catch (err) {
      res.writeHead(err.message === 'Payload Too Large' ? 413 : 400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: err.message || 'Invalid request' } }));
      return;
    }

    try {
      const id = payload.id || url.searchParams.get('id');
      if (!id) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'ID is required.' } }));
        return;
      }
      const isSolved = payload.isSolved !== undefined ? payload.isSolved : payload.is_solved !== undefined ? payload.is_solved : true;
      const updated = await setQuizSolvedStatus(id, isSolved, { userId, databaseUrl: dbUrl });
      if (!updated) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Quiz not found.' } }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ quiz: updated }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Failed to update quiz.' } }));
    }
    return;
  }

  res.writeHead(405, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: { message: 'Method not allowed' } }));
}

export function sanitizeClueText(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    .replace(/^(?:petunjuk|clue|hint)[:\s-]*/i, '')
    .replace(/(?:jawaban(?:nya)?\s+(?:yang\s+)?(?:benar|tepat)\s+(?:adalah|yaitu)?[:\s]*)/gi, '')
    .trim();
}

export function buildFallbackClue(questionText = '', options = [], explanation = '') {
  if (explanation && typeof explanation === 'string') {
    const cleanedExp = explanation
      .replace(/(?:jawaban(?:nya)?\s+(?:yang\s+)?(?:benar|tepat)\s+(?:adalah|yaitu)?\s*[^.,;]+[.,;]?\s*)/gi, '')
      .replace(/pilihan\s+[a-d1-4]\s+(?:benar|tepat)\s+karena\s+/gi, '')
      .trim();
    const firstSentence = cleanedExp.split(/[.!?]\s+/)[0];
    if (firstSentence && firstSentence.length > 15) {
      return `Pikirkan konsep ini: ${firstSentence.trim()}. Analisis pilihan mana yang paling sesuai dengan prinsip tersebut.`;
    }
  }

  return 'Cermati kata kunci utama pertanyaan. Analisis karakteristik khas setiap pilihan dan eliminasi opsi yang tidak berkaitan dengan konsep yang ditanyakan.';
}

export async function generateQuizClue(payload, env = {}, req = null) {
  const dbUrl = env.DATABASE_URL || process.env.DATABASE_URL;
  const questionId = payload.questionId || payload.question_id || payload.id;

  // 1. ALWAYS check database first before generating!
  if (questionId) {
    try {
      const existing = await getQuestionClue(questionId, { databaseUrl: dbUrl });
      if (existing && existing.clue && existing.clue.trim()) {
        return existing.clue.trim();
      }
      if (existing) {
        if (!payload.questionText && existing.question_text) {
          payload.questionText = existing.question_text;
        }
        if ((!payload.options || !payload.options.length) && existing.options) {
          payload.options = existing.options;
        }
        if (!payload.explanation && existing.explanation) {
          payload.explanation = existing.explanation;
        }
      }
    } catch {}
  }

  const { questionText = '', options = [], explanation = '' } = payload;
  const apiKey = (env.OPENROUTER_API_KEY !== undefined ? env.OPENROUTER_API_KEY : (process.env.OPENROUTER_API_KEY || '')).trim();
  const model = (env.OPENROUTER_MODEL !== undefined ? env.OPENROUTER_MODEL : (process.env.OPENROUTER_MODEL || 'google/gemini-2.5-flash-lite')).trim();

  const fallbackClue = buildFallbackClue(questionText, options, explanation);
  let finalClue = fallbackClue;

  if (apiKey && !apiKey.toLowerCase().includes('placeholder')) {
    try {
      const optsFormatted = options.map((opt, i) => `${i + 1}. ${typeof opt === 'object' ? (opt.text || opt.label || '') : opt}`).join('\n');
      const messages = [
        {
          role: 'system',
          content: 'Anda adalah asisten tutor belajar yang cerdas, ramah, dan mendidik. Tugas Anda adalah memberikan petunjuk (clue) konseptual yang membimbing siswa untuk memikirkan jawaban yang tepat sendiri.\n\nATURAN MUTLAK:\n1. JANGAN PERNAH membocorkan, menyebutkan secara langsung, atau menyiratkan jawaban yang benar maupun nomor/huruf opsinya.\n2. Berikan 1 hingga 2 kalimat petunjuk singkat berupa analogi, prinsip dasar, atau konsep kunci yang memandu siswa menganalisis dan mengeliminasi pilihan yang salah.\n3. Jangan gunakan salam pembuka yang bertele-tele; langsung berikan petunjuk edukatif.\n4. Gunakan Bahasa Indonesia.',
        },
        {
          role: 'user',
          content: `Pertanyaan: ${questionText}\n\nPilihan:\n${optsFormatted}\n\nBerikan 1 petunjuk cerdas tanpa membocorkan jawabannya.`,
        },
      ];

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 9000);

      const clientIp = req ? (req.headers?.['x-forwarded-for'] || req.socket?.remoteAddress || '') : '';
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://teach4all.local',
          'X-Title': 'Teach4All',
          ...(clientIp ? { 'X-Forwarded-For': clientIp } : {}),
        },
        body: JSON.stringify({
          model,
          messages,
          max_tokens: 150,
          temperature: 0.7,
        }),
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (res.ok) {
        const data = await res.json();
        const text = data.choices?.[0]?.message?.content?.trim();
        if (text) {
          const clean = sanitizeClueText(text);
          if (clean) finalClue = clean;
        }
      }
    } catch {}
  }

  // 2. Store generated clue for the specific questionId in DB so it can never be regenerated!
  if (questionId && finalClue) {
    try {
      await saveQuestionClue(questionId, finalClue, { databaseUrl: dbUrl });
    } catch {}
  }

  return finalClue;
}

