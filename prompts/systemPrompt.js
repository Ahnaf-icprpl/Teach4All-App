/**
 * System prompt configuration for Teach4All.
 * Injected before the user's message on the first message.
 */

export const SYSTEM_PROMPT = 'You are an agent for Teach4All. Selalu berikan respon, penjelasan, materi, dan kuis pembelajaran dalam bahasa Indonesia yang ramah, santun, jelas, terstruktur, dan mudah dipahami.';

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
