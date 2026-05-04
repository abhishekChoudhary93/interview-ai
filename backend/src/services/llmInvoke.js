import { config, resolveOpenRouterModel } from '../config.js';
import { mockInvokeLLM, mockStreamLLM } from './mockLlm.js';
import { invokeOpenRouterLLM, streamOpenRouterLLM } from './openRouterLlm.js';

/**
 * Format an upstream OpenRouter failure for the dev console. We want the model
 * slug + the actual HTTP status visible at a glance — silently falling back to
 * the mock while the candidate sees "[Mock interviewer]" is the worst kind of
 * dev-mode footgun (it's exactly what happens when an account can't access the
 * configured conversational model).
 */
function logUpstreamFallback(tier, model, error) {
  const msg = error instanceof Error ? error.message : String(error);
  const banner = '═'.repeat(72);
  console.warn(
    `\n${banner}\n[llm] OpenRouter call FAILED for tier="${tier}" model="${model}".\n` +
      `      Falling back to the mock LLM (APP_ENV=${config.appEnv}).\n` +
      `      Upstream error: ${msg}\n` +
      `      Fix: load credits / enable model access on https://openrouter.ai, or override\n` +
      `           OPENROUTER_${tier.toUpperCase()}_MODEL to a model your account can call.\n${banner}\n`
  );
}

/**
 * Recommended tier for each call purpose:
 *   conversational — streaming interviewer voice
 *   eval           — per-turn rubric capture (JSON)
 *   debrief        — final report (JSON)
 *   opening        — session-start framing (text)
 *   extraction     — cross-session history signals (JSON)
 */
function pickModel(input) {
  if (input.model) return input.model;
  if (input.modelTier && input.modelTier !== 'default') {
    return resolveOpenRouterModel(input.modelTier);
  }
  return config.openRouterModel;
}

/**
 * Non-streaming LLM call. Accepts either `messages` (preferred) or `prompt`
 * (back-compat). Returns parsed JSON when a schema is supplied, else plain text.
 *
 * @param {object} input
 * @param {Array<{role:'system'|'user'|'assistant', content:string}>} [input.messages]
 * @param {string} [input.prompt]
 * @param {object} [input.response_json_schema]
 * @param {string} [input.model] explicit OpenRouter model slug
 * @param {'conversational'|'eval'|'debrief'|'opening'|'extraction'|'default'} [input.modelTier]
 * @param {number} [input.temperature]
 * @param {number} [input.top_p]
 * @param {number} [input.max_tokens]
 */
export async function invokeLLM(input) {
  const resolvedModel = pickModel(input);

  if (config.openRouterApiKey) {
    try {
      return await invokeOpenRouterLLM({
        messages: input.messages,
        prompt: input.prompt,
        response_json_schema: input.response_json_schema,
        model: resolvedModel,
        temperature: input.temperature,
        top_p: input.top_p,
        max_tokens: input.max_tokens,
      });
    } catch (error) {
      // Local/dev fallback so a flaky upstream doesn't block authoring.
      if (config.isLocalLike) {
        logUpstreamFallback(input.modelTier || 'default', resolvedModel, error);
        return mockInvokeLLM(input);
      }
      throw error;
    }
  }
  return mockInvokeLLM(input);
}

/**
 * Streaming LLM call. Yields token-delta strings as they arrive from upstream.
 * Falls back to a chunked mock stream when the API key is missing or the
 * provider is failing in local-like environments.
 *
 * @param {object} input
 * @param {Array<{role:'system'|'user'|'assistant', content:string}>} input.messages
 * @param {string} [input.model]
 * @param {'conversational'|'eval'|'debrief'|'opening'|'extraction'|'default'} [input.modelTier]
 * @param {number} [input.temperature]
 * @param {number} [input.top_p]
 * @param {number} [input.max_tokens]
 * @param {AbortSignal} [input.signal]
 * @returns {AsyncIterable<string>}
 */
export async function* streamLLM(input) {
  const resolvedModel = pickModel(input);

  if (config.openRouterApiKey) {
    try {
      yield* streamOpenRouterLLM({
        messages: input.messages,
        model: resolvedModel,
        temperature: input.temperature,
        top_p: input.top_p,
        max_tokens: input.max_tokens,
        signal: input.signal,
      });
      return;
    } catch (error) {
      if (config.isLocalLike) {
        logUpstreamFallback(input.modelTier || 'default', resolvedModel, error);
        yield* mockStreamLLM(input);
        return;
      }
      throw error;
    }
  }
  yield* mockStreamLLM(input);
}
