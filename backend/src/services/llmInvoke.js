import { config } from '../config.js';
import { mockInvokeLLM } from './mockLlm.js';
import { invokeOpenRouterLLM } from './openRouterLlm.js';

export async function invokeLLM(input) {
  if (config.openRouterApiKey) {
    return invokeOpenRouterLLM(input);
  }
  return mockInvokeLLM(input);
}
