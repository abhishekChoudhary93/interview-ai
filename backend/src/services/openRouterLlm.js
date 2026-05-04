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
 * Normalize input messages. Accepts either a `messages` array (preferred)
 * or a legacy `prompt` string (wrapped into a single user turn for back-compat).
 */
function normalizeMessages({ messages, prompt }) {
  if (Array.isArray(messages) && messages.length > 0) {
    return messages
      .filter((m) => m && typeof m.content === 'string' && m.role)
      .map((m) => ({ role: m.role, content: m.content }));
  }
  return [{ role: 'user', content: String(prompt || '') }];
}

/**
 * Append a JSON-only directive to the final user turn so providers without
 * native `response_format` still emit clean JSON.
 */
function appendJsonDirective(messages, schema) {
  if (!schema?.properties) return messages;
  const directive = `Reply with a single JSON object only (no markdown fences). Keys must match: ${Object.keys(
    schema.properties
  ).join(', ')}.`;
  const last = messages[messages.length - 1];
  if (last?.role === 'user') {
    const updated = { ...last, content: `${last.content}\n\n${directive}` };
    return [...messages.slice(0, -1), updated];
  }
  return [...messages, { role: 'user', content: directive }];
}

function buildHeaders(apiKey) {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
    'HTTP-Referer': config.openRouterHttpReferer,
    'X-Title': config.openRouterAppTitle,
  };
}

/**
 * Non-streaming chat completion via OpenRouter (OpenAI-compatible).
 * Returns parsed JSON when a schema is provided, otherwise plain text.
 */
export async function invokeOpenRouterLLM({
  messages,
  prompt,
  response_json_schema: schema,
  model,
  temperature = 0.6,
  top_p,
  max_tokens,
}) {
  const apiKey = config.openRouterApiKey;
  if (!apiKey) {
    throw new Error('OpenRouter is not configured (missing OPENROUTER_API_KEY)');
  }

  const baseMessages = normalizeMessages({ messages, prompt });
  const finalMessages = appendJsonDirective(baseMessages, schema);

  const body = {
    model: model || config.openRouterModel,
    messages: finalMessages,
    temperature,
  };
  if (typeof top_p === 'number') body.top_p = top_p;
  if (typeof max_tokens === 'number') body.max_tokens = max_tokens;
  if (schema?.properties) body.response_format = { type: 'json_object' };

  const res = await fetch(`${config.openRouterBaseUrl}/chat/completions`, {
    method: 'POST',
    headers: buildHeaders(apiKey),
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

/**
 * Streaming chat completion via OpenRouter SSE.
 * Yields token deltas as they arrive (already decoded UTF-8 strings).
 *
 * SSE protocol: each event is `data: <json>\n\n` where <json> is an OpenAI-style
 * chunk: `{ choices: [{ delta: { content: "..." } }] }`. Stream ends with
 * `data: [DONE]`.
 */
export async function* streamOpenRouterLLM({
  messages,
  prompt,
  model,
  temperature = 0.7,
  top_p,
  max_tokens,
  signal,
}) {
  const apiKey = config.openRouterApiKey;
  if (!apiKey) {
    throw new Error('OpenRouter is not configured (missing OPENROUTER_API_KEY)');
  }

  const finalMessages = normalizeMessages({ messages, prompt });

  const body = {
    model: model || config.openRouterModel,
    messages: finalMessages,
    temperature,
    stream: true,
  };
  if (typeof top_p === 'number') body.top_p = top_p;
  if (typeof max_tokens === 'number') body.max_tokens = max_tokens;

  const res = await fetch(`${config.openRouterBaseUrl}/chat/completions`, {
    method: 'POST',
    headers: { ...buildHeaders(apiKey), Accept: 'text/event-stream' },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`OpenRouter HTTP ${res.status}: ${errBody.slice(0, 500)}`);
  }
  if (!res.body) {
    throw new Error('OpenRouter streaming response had no body');
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // Process complete SSE events (separated by blank lines).
      let sepIdx;
      while ((sepIdx = buffer.indexOf('\n\n')) !== -1) {
        const rawEvent = buffer.slice(0, sepIdx);
        buffer = buffer.slice(sepIdx + 2);

        const dataLines = rawEvent
          .split('\n')
          .filter((l) => l.startsWith('data:'))
          .map((l) => l.slice(5).trim());
        if (dataLines.length === 0) continue;
        const payload = dataLines.join('\n');
        if (payload === '[DONE]') return;

        let parsed;
        try {
          parsed = JSON.parse(payload);
        } catch {
          continue; // OpenRouter occasionally injects keep-alive comments; ignore.
        }
        const delta = parsed.choices?.[0]?.delta?.content;
        if (typeof delta === 'string' && delta.length > 0) {
          yield delta;
        }
      }
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      /* ignore cleanup errors */
    }
  }
}
