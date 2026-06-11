import { getLlmSettings } from '../db.js';
import ollamaClient from 'ollama';

// knowledge 模块自带的轻量 chat 注入器：让 kb-eval 等独立脚本无需 import server.js
// （后者一加载就会监听端口）即可调用与线上一致的 LLM provider。运行时仍优先注入 server.js
// 的 callLlmText，这里只是离线/脚本场景的等价实现。
const PROVIDER_DEFAULTS = {
  deepseek: { baseUrl: 'https://api.deepseek.com', model: 'deepseek-v4-flash' },
  openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  openrouter: { baseUrl: 'https://openrouter.ai/api/v1', model: 'anthropic/claude-3.5-sonnet' },
  siliconflow: { baseUrl: 'https://api.siliconflow.cn/v1', model: 'deepseek-ai/DeepSeek-V3' },
  ollama: { baseUrl: 'http://127.0.0.1:11434', model: 'qwen2.5' }
};

function buildChatUrl(baseUrl = '') {
  const trimmed = baseUrl.replace(/\/$/, '');
  if (trimmed.endsWith('/chat/completions')) return trimmed;
  return `${trimmed}/chat/completions`;
}

export function createKnowledgeChat({ fetchImpl = fetch } = {}) {
  return async function chat({ messages, model, temperature = 0, maxTokens = 800, responseFormat, timeoutMs = 45000 }) {
    const settings = getLlmSettings({ includeSecret: true });
    const provider = settings.provider || 'ollama';
    const defaults = PROVIDER_DEFAULTS[provider] || PROVIDER_DEFAULTS.ollama;
    const targetModel = model || settings.model || defaults.model;
    const baseUrl = settings.baseUrl || defaults.baseUrl;

    if (provider === 'ollama') {
      const response = await ollamaClient.chat({
        model: targetModel || 'qwen2.5',
        messages,
        stream: false,
        options: { temperature }
      });
      return response.message?.content || '';
    }

    if (!settings.apiKey) {
      throw new Error(`${provider} API key is not configured`);
    }
    const body = { model: targetModel, messages, stream: false, temperature, max_tokens: maxTokens };
    if (provider === 'deepseek') body.thinking = { type: 'disabled' };
    if (responseFormat) body.response_format = responseFormat;

    const response = await fetchImpl(buildChatUrl(baseUrl), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.apiKey}`
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`${provider} chat error ${response.status}: ${text.slice(0, 200)}`);
    }
    const data = await response.json();
    return data.choices?.[0]?.message?.content || '';
  };
}
