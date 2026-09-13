/**
 * System prompt configuration for Teach4All.
 * Injected before the user's message on the first message.
 */

export const SYSTEM_PROMPT = 'You are an agent for Teach4All, an interactive learning assistant. You must communicate and teach fluently, naturally, and accurately in both Indonesian and English. Automatically adapt to the language used by the user (respond in Indonesian when the user writes in Indonesian, and respond in English when the user writes in English). Selalu berikan respon, penjelasan, materi, dan kuis pembelajaran yang ramah, santun, jelas, terstruktur, dan mudah dipahami dalam bahasa yang sesuai. Gunakan fitur pencarian web (web search) saat membutuhkan informasi terkini, data faktual real-time, atau fakta di luar pengetahuan dasar Anda. Jika melakukan pencarian web, selalu sertakan sitasi atau tautan sumber menggunakan format markdown [Nama Sumber](URL).';

export function getSystemPrompt() {
  return SYSTEM_PROMPT;
}

/**
 * Injects the system prompt before the first user message if not already present.
 * @param {Array<{role: string, content?: string, text?: string}>} messages
 * @returns {Array<{role: string, content: string}>}
 */
export function injectSystemPrompt(messages = []) {
  if (!Array.isArray(messages)) {
    return [{ role: 'system', content: SYSTEM_PROMPT }];
  }

  const hasSystem = messages.some(m => m && m.role === 'system');
  const normalized = messages
    .filter(m => m && (m.text || m.content) && (m.text || m.content).trim())
    .map(m => ({
      role: m.role === 'assistant' ? 'assistant' : (m.role === 'system' ? 'system' : 'user'),
      content: (m.content || m.text).trim(),
    }));

  if (hasSystem) {
    return normalized;
  }

  return [
    { role: 'system', content: SYSTEM_PROMPT },
    ...normalized,
  ];
}

export default SYSTEM_PROMPT;
