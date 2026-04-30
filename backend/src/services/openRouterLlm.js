import { config } from '../config.js';

function stripJsonFence(text) {
  let s = String(text).trim();
  if (s.startsWith('```')) {
    s = s.replace(/^```(?:json)?\s*/i, '');
    s = s.replace(/\s*```$/i, '');
  }
  return s.trim();
}

/**
 * OpenAI-compatible chat completions via OpenRouter.
 * @see https://openrouter.ai/docs
 */
export async function invokeOpenRouterLLM({ prompt, response_json_schema: schema }) {
  const apiKey = config.openRouterApiKey;
  if (!apiKey) {
    throw new Error('OpenRouter is not configured (missing OPENROUTER_API_KEY)');
  }

  let userContent = prompt || '';
  if (schema?.properties) {
    userContent += `\n\nReply with a single JSON object only (no markdown fences). Keys must match: ${Object.keys(schema.properties).join(', ')}.`;
  }

  const body = {
    model: config.openRouterModel,
    messages: [{ role: 'user', content: userContent }],
    temperature: 0.6,
  };

  if (schema?.properties) {
    body.response_format = { type: 'json_object' };
  }

  const res = await fetch(`${config.openRouterBaseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'HTTP-Referer': config.openRouterHttpReferer,
      'X-Title': config.openRouterAppTitle,
    },
    body: JSON.stringify(body),
  });

  const raw = await res.text();
  if (!res.ok) {
    throw new Error(`OpenRouter HTTP ${res.status}: ${raw.slice(0, 500)}`);
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error('OpenRouter returned non-JSON body');
  }

  const content = data.choices?.[0]?.message?.content;
  if (content == null || content === '') {
    throw new Error('OpenRouter returned empty content');
  }

  if (schema?.properties) {
    let parsed;
    try {
      parsed = JSON.parse(stripJsonFence(content));
    } catch (e) {
      throw new Error(
        `OpenRouter JSON parse failed: ${e.message}; preview: ${stripJsonFence(content).slice(0, 240)}`
      );
    }
    return parsed;
  }

  return stripJsonFence(content);
}
