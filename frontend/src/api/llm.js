import { apiRequest } from './httpClient.js';

export async function invokeLLM(payload) {
  const data = await apiRequest('/api/llm/invoke', { method: 'POST', body: payload });
  return data?.result;
}
