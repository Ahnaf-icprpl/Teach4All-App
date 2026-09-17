/**
 * Web search plugin builder for OpenRouter integration.
 * Uses the cheapest search engine ('parallel' at $0.001/request) by default,
 * executing web search grounding and injecting verified real-time sources into prompt context.
 */

export const DEFAULT_SEARCH_ENGINE = 'parallel';

/**
 * Builds the OpenRouter web search plugin descriptor.
 * @param {object} serverEnv
 * @returns {object} OpenRouter web search plugin configuration
 */
export function buildWebSearchPlugin(serverEnv = {}) {
  const engine = (
    serverEnv.OPENROUTER_SEARCH_ENGINE ||
    process.env.OPENROUTER_SEARCH_ENGINE ||
    DEFAULT_SEARCH_ENGINE
  ).trim();

  const maxResults = Math.max(1, Math.min(10, Number(
    serverEnv.OPENROUTER_SEARCH_MAX_RESULTS ||
    process.env.OPENROUTER_SEARCH_MAX_RESULTS ||
    8
  ) || 8));

  return {
    id: 'web',
    engine,
    max_results: maxResults,
  };
}

/**
 * Builds the openrouter:web_search server tool descriptor (for models supporting server tools).
 * @param {object} serverEnv
 * @returns {object}
 */
export function buildWebSearchTool(serverEnv = {}) {
  const engine = (
    serverEnv.OPENROUTER_SEARCH_ENGINE ||
    process.env.OPENROUTER_SEARCH_ENGINE ||
    DEFAULT_SEARCH_ENGINE
  ).trim();

  const maxResults = Math.max(1, Math.min(10, Number(
    serverEnv.OPENROUTER_SEARCH_MAX_RESULTS ||
    process.env.OPENROUTER_SEARCH_MAX_RESULTS ||
    8
  ) || 8));

  return {
    type: 'openrouter:web_search',
    parameters: {
      engine,
      max_results: maxResults,
      max_uses: 1,
    },
  };
}

/**
 * Determines whether web search should be provided to the model.
 * Defaults to true unless explicitly turned off by the client.
 * For quiz creation requests, web search is mandatory and always enabled.
 * @param {any} webSearchParam
 * @param {object} [options]
 * @param {boolean} [options.isQuiz]
 * @returns {boolean}
 */
export function isWebSearchRequested(webSearchParam, { isQuiz = false } = {}) {
  if (isQuiz) {
    return true;
  }
  if (webSearchParam === false || webSearchParam === 'false' || webSearchParam === 0) {
    return false;
  }
  return true;
}
