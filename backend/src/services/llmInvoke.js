import { config, resolveOpenRouterModel } from '../config.js';
import { mockInvokeLLM } from './mockLlm.js';
import { invokeOpenRouterLLM } from './openRouterLlm.js';

/**
 * @param {object} input
 * @param {string} [input.prompt]
 * @param {object} [input.response_json_schema]
 * @param {string} [input.model] override OpenRouter model slug
 * @param {'decision'|'adaptation'|'extraction'|'default'} [input.modelTier] tier when model omitted (uses OPENROUTER_*_MODEL env)
 */
export async function invokeLLM(input) {
  const tier = input.modelTier || 'default';
  const resolvedModel =
    input.model || (tier !== 'default' ? resolveOpenRouterModel(tier) : config.openRouterModel);

  if (config.openRouterApiKey) {
    return invokeOpenRouterLLM({
      prompt: input.prompt,
      response_json_schema: input.response_json_schema,
      model: resolvedModel,
    });
  }
  return mockInvokeLLM(input);
}
