import { createMaterial, DEFAULT_USER_ID } from './db.js';
import { diagnoseAndValidateMaterialArgs } from './materialValidator.js';
import { buildWebSearchPlugin } from './webSearch.js';
import { accumulateToolCalls } from './quizTool.js';

export const MATERIAL_TOOL_NAME = 'create_material';

/**
 * Builds the OpenAI-compatible tool descriptor for create_material.
 */
export function buildMaterialTool(serverEnv = {}) {
  return {
    type: 'function',
    function: {
      name: MATERIAL_TOOL_NAME,
      description: 'Buat modul atau materi pembelajaran terstruktur baru dengan beberapa bagian (multi-section) yang komprehensif, edukatif, dan mendalam melalui riset pencarian web terkini. Setiap bagian memiliki judul sub-bab, konten penjelasan mendalam multi-paragraf dengan format markdown yang kaya (sub-heading ###, teks tebal **, daftar poin -, blockquote >), dan estimasi waktu baca.',
      parameters: {
        type: 'object',
        properties: {
          title: {
            type: 'string',
            description: 'Judul materi pembelajaran yang jelas, spesifik, dan menarik (misal: "Panduan Lengkap Fotosintesis & Siklus Calvin")',
          },
          category: {
            type: 'string',
            description: 'Kategori atau mata pelajaran (misal: "Biologi", "Fisika", "Matematika", "Kimia", "Sejarah", "Teknologi", "Bahasa")',
          },
          summary: {
            type: 'string',
            description: 'Ringkasan singkat 1-2 kalimat tentang cakupan materi modul pembelajaran ini',
          },
          difficulty: {
            type: 'string',
            enum: ['beginner', 'intermediate', 'advanced'],
            description: 'Tingkat kesulitan materi (beginner, intermediate, advanced)',
          },
          estimated_read_time: {
            type: 'integer',
            description: 'Estimasi total waktu baca seluruh materi dalam menit (misal: 6 atau 10)',
          },
          icon: {
            type: 'string',
            enum: ['book', 'leaf', 'globe', 'bulb', 'atom', 'spark'],
            description: 'Ikon kartu materi yang sesuai',
          },
          color: {
            type: 'string',
            enum: ['green', 'blue', 'purple', 'amber'],
            description: 'Warna aksen kartu materi',
          },
          sections: {
            type: 'array',
            description: 'Daftar bagian/bab materi pembelajaran terstruktur (multi-section). Wajib membuat setidaknya 2 hingga 6 bagian agar materi komprehensif, runtut, dan lengkap.',
            items: {
              type: 'object',
              properties: {
                section_number: {
                  type: 'integer',
                  description: 'Nomor urutan bagian (1, 2, 3, dst)',
                },
                title: {
                  type: 'string',
                  description: 'Judul sub-bab atau bagian materi (misal: "1. Pengenalan dan Kloroplas")',
                },
                content: {
                  type: 'string',
                  description: 'Konten penjelasan mendalam, lengkap, dan edukatif untuk bagian ini. WAJIB menggunakan format markdown yang kaya dengan MULTI-PARAGRAPH (setidaknya 2-4 paragraf yang dipisahkan baris baru ganda), sub-heading (###), teks tebal (**istilah penting**), daftar poin (- atau 1.), dan blockquote (> catatan penting/ringkasan) agar materi lengkap dan mudah dipahami siswa.',
                },
                read_time_minutes: {
                  type: 'integer',
                  description: 'Estimasi waktu membaca bagian ini dalam menit (default: 2 atau 3)',
                },
              },
              required: ['section_number', 'title', 'content'],
            },
          },
        },
        required: ['title', 'category', 'summary', 'sections'],
      },
    },
  };
}

/**
 * Parses tool arguments and saves the material with all nested sections to PostgreSQL atomically.
 */
export async function parseAndExecuteMaterialTool(toolCall, { userId, conversationId, databaseUrl } = {}) {
  try {
    const rawArgs = toolCall?.function?.arguments || '{}';
    const validation = diagnoseAndValidateMaterialArgs(rawArgs);

    if (!validation.valid) {
      return {
        success: false,
        errorType: validation.errorType,
        diagnostic: validation.diagnostic,
        errors: validation.errors,
        error: validation.diagnostic,
      };
    }

    const { title, category, summary, difficulty, icon, color, estimatedReadTime, sections } = validation.data;

    const createdMaterial = await createMaterial(
      {
        userId: userId || DEFAULT_USER_ID,
        conversationId: conversationId || null,
        title,
        category,
        summary,
        difficulty,
        icon,
        color,
        estimatedReadTime,
        prompt: `Materi tentang ${title}`,
        isPublished: true,
        isSolved: false,
        isCompleted: false,
      },
      sections,
      { databaseUrl }
    );

    return {
      success: true,
      material: createdMaterial,
      sectionCount: sections.length,
      readTime: estimatedReadTime,
    };
  } catch (err) {
    return {
      success: false,
      errorType: 'DATABASE_ERROR',
      diagnostic: `Database error during material creation: ${err.message}. Ensure database is reachable.`,
      error: err.message || 'Gagal membuat materi pembelajaran.',
    };
  }
}

/**
 * Returns formatted interactive card marker for embedding in SSE stream and markdown.
 */
export function formatMaterialCardMarker(material) {
  if (!material || !material.id) return '';
  const count = material.sections?.length || material.section_count || material.part_count || 1;
  const readTime = material.estimated_read_time || material.estimatedReadTime || 5;
  const safeTitle = String(material.title || 'Materi Pembelajaran').replace(/"/g, '&quot;');
  const safeCategory = String(material.category || 'Materi').replace(/"/g, '&quot;');
  return `\n\n:::material-card{id="${material.id}" title="${safeTitle}" category="${safeCategory}" count="${count}" readTime="${readTime}" difficulty="${material.difficulty || 'beginner'}"}:::\n\n`;
}

/**
 * Handles execution of completed material tool calls, database persistence,
 * stream card injection, algorithmic error diagnostics, and model recall loop.
 */
export async function handleCompletedMaterialToolCalls({
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
  let currentCall = calls.find(c => c.function?.name === MATERIAL_TOOL_NAME);
  if (!currentCall) return;

  const databaseUrl = serverEnv.DATABASE_URL || process.env.DATABASE_URL;
  const conversationHistory = [...formattedMessages];

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const execResult = await parseAndExecuteMaterialTool(currentCall, {
      userId: userId || DEFAULT_USER_ID,
      conversationId,
      databaseUrl,
    });

    if (execResult.success && execResult.material) {
      const cardMarker = formatMaterialCardMarker(execResult.material);
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: cardMarker } }] })}\n\n`);
      }
      if (streamWriter) streamWriter.writeChunk(cardMarker);

      const count = execResult.material.sections?.length || execResult.sectionCount || 1;
      const readTime = execResult.material.estimated_read_time || execResult.readTime || 5;
      const isEn = formattedMessages.some(m => m && m.role === 'user' && /\b(the|and|material|lesson|guide|create|what|about)\b/i.test(m.content || ''));
      const messageText = isEn
        ? `Learning material **${execResult.material.title}** (${count} sections, ~${readTime} min read) is ready! Click **Open Material** above to start learning.`
        : `Materi pembelajaran **${execResult.material.title}** (${count} bagian, ~${readTime} mnt baca) berhasil dibuat dan siap dipelajari! Klik tombol **Buka Materi** di atas untuk mulai membaca modul ini.`;

      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: messageText } }] })}\n\n`);
      }
      if (streamWriter) streamWriter.writeChunk(messageText);
      return;
    }

    // Execution or validation failed; evaluate algorithmic recall
    if (attempt < maxRetries && apiKey && !controller?.signal?.aborted) {
      const callId = currentCall.id || `call_mat_${Date.now()}_${attempt}`;
      conversationHistory.push({
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: callId,
            type: 'function',
            function: {
              name: MATERIAL_TOOL_NAME,
              arguments: currentCall.function?.arguments || '{}',
            },
          },
        ],
      });

      conversationHistory.push({
        role: 'tool',
        tool_call_id: callId,
        name: MATERIAL_TOOL_NAME,
        content: JSON.stringify({
          status: 'error',
          error_type: execResult.errorType || 'VALIDATION_ERROR',
          diagnostic: execResult.diagnostic || execResult.error,
          detailed_errors: execResult.errors || [],
          instruction: 'You MUST call create_material again immediately with all errors fixed and with a multi-section structured format containing rich multi-paragraph markdown content (headings ###, bold terms **, bullet lists -, blockquotes >). Do NOT apologize or respond in conversational plain text.',
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
            tools: [buildMaterialTool(serverEnv)],
            tool_choice: { type: 'function', function: { name: MATERIAL_TOOL_NAME } },
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
        const nextCall = newCalls.find(c => c.function?.name === MATERIAL_TOOL_NAME);
        if (nextCall) {
          currentCall = nextCall;
          continue;
        } else {
          conversationHistory.push({
            role: 'assistant',
            content: recallText || 'Error attempting to construct material.',
          });
          conversationHistory.push({
            role: 'user',
            content: 'CRITICAL INSTRUCTION: Do NOT apologize or respond with plain conversational text. You MUST call the create_material function immediately with title, category, summary, difficulty, icon, color, and sections array (with section_number, title, and detailed multi-paragraph markdown content with headings ###, lists -, bold text **, and blockquotes >).',
          });
          currentCall = {
            id: `call_mat_${Date.now()}_retry`,
            type: 'function',
            function: {
              name: MATERIAL_TOOL_NAME,
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
        const errorMsg = `\n\nMaaf, terjadi kendala saat menyusun materi pembelajaran setelah ${attempt + 1} percobaan: ${execResult.error || 'kesalahan format'}. Silakan coba minta materi kembali.`;
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: errorMsg } }] })}\n\n`);
        if (streamWriter) streamWriter.writeChunk(errorMsg);
      }
      return;
    }
  }
}
