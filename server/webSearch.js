/**
 * Web search tool builder for OpenRouter integration.
 * Uses the cheapest server tool engine ('parallel' at $0.001/request) by default,
 * allowing the model to autonomously execute search only when necessary.
 */

export const DEFAULT_SEARCH_ENGINE = 'parallel';

/**
 * Builds the openrouter:web_search tool descriptor with cost-optimized bounds.
 * @param {object} serverEnv
 * @returns {object} OpenRouter server tool definition
 */
export function buildWebSearchTool(serverEnv = {}) {
  const engine = (
    serverEnv.OPENROUTER_SEARCH_ENGINE ||
    process.env.OPENROUTER_SEARCH_ENGINE ||
    DEFAULT_SEARCH_ENGINE
  ).trim();

  return {
    type: 'openrouter:web_search',
    parameters: {
      engine,
      max_results: 3,
      max_uses: 1,
    },
  };
}

/**
 * Determines whether web search should be provided to the model.
 * Defaults to true (auto mode) unless explicitly turned off by the client.
 * @param {any} webSearchParam
 * @returns {boolean}
 */
export function isWebSearchRequested(webSearchParam) {
  if (webSearchParam === false || webSearchParam === 'false' || webSearchParam === 0) {
    return false;
  }
  return true;
}
