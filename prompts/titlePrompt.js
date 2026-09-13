/**
 * System prompt configuration for conversation title generation in Teach4All.
 */

export const TITLE_SYSTEM_PROMPT = `You are a conversation title generator for Teach4All.
Your task is to generate a short, clean, descriptive, and engaging title (2 to 5 words) that summarizes the conversation.

Rules:
1. Return ONLY the title itself.
2. Do NOT use quotation marks, bullet points, markdown, or prefix labels like "Judul:" or "Title:".
3. Use the language of the conversation (default to Indonesian).
4. Maximum 50 characters.
5. Focus on the core topic or concept being asked or discussed.`;

export function getTitleSystemPrompt() {
  return TITLE_SYSTEM_PROMPT;
}

/**
 * Clean and format raw LLM title output.
 * @param {string} rawTitle
 * @param {string} fallback
 * @returns {string}
 */
export function cleanTitle(rawTitle, fallback = 'Percakapan baru') {
  if (!rawTitle || typeof rawTitle !== 'string') return fallback;
  let cleaned = rawTitle
    .trim()
    .replace(/^["'`«»“”]+|["'`«»“”]+$/g, '')
    .replace(/^(judul|title|topik|topic)\s*:\s*/i, '')
    .replace(/^#+\s*/, '')
    .replace(/\.+$/, '')
    .trim();
  if (!cleaned) return fallback;
  if (cleaned.length > 60) {
    cleaned = cleaned.slice(0, 60).trim();
  }
  return cleaned;
}

/**
 * Deterministic local fallback title generator for offline mode or fallback.
 * @param {string} text
 * @param {string} fallback
 * @returns {string}
 */
export function generateOfflineTitle(text, fallback = 'Percakapan baru') {
  if (!text || typeof text !== 'string') return fallback;
  let cleaned = text.trim();
  cleaned = cleaned
    .replace(/^(buatkan kuis singkat 5 soal pilihan ganda tentang topik berikut:\s*|jelaskan ringkasan materi pembelajaran terstruktur mengenai topik berikut:\s*|tolong jelaskan proses|tolong jelaskan|jelaskan proses|jelaskan|bisa bantu saya|bantu saya|bisakah anda|tolong|mohon|coba)\s*/i, '')
    .trim();
  if (!cleaned) cleaned = text.trim();
  cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  const firstSentence = cleaned.split(/[.?!\n]/)[0].trim();
  return cleanTitle(firstSentence.slice(0, 50), fallback);
}

/**
 * Format conversation messages into prompt payload for title generation.
 * @param {Array<{role: string, content?: string, text?: string}>} messages
 * @returns {Array<{role: string, content: string}>}
 */
export function formatTitleMessages(messages = []) {
  if (!Array.isArray(messages)) return [{ role: 'system', content: TITLE_SYSTEM_PROMPT }];

  const history = messages
    .filter(m => m && (m.role === 'user' || m.role === 'assistant'))
    .slice(-4)
    .map(m => ({
      role: m.role,
      content: (m.content || m.text || '').trim(),
    }))
    .filter(m => m.content);

  return [
    { role: 'system', content: TITLE_SYSTEM_PROMPT },
    ...history,
    {
      role: 'user',
      content: 'Generate a short, descriptive 2-5 word title for this conversation now.',
    },
  ];
}

export default TITLE_SYSTEM_PROMPT;
