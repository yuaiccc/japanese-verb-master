import { Ollama } from 'ollama';
import { encodingForModel, getEncoding } from 'js-tiktoken';
import { AsyncLocalStorage } from 'node:async_hooks';
import { getLlmSettings, saveLlmSettings } from '../db';
import { traceLangSmithRun } from '../tracing/langsmith';

// 初始化 LLM Provider：默认本地 Ollama；Web 设置可切换 OpenAI-compatible provider。
const ollama = new Ollama({ host: 'http://127.0.0.1:11434' });
const providerDefaults: Record<string, any> = {
  deepseek: { baseUrl: 'https://api.deepseek.com', model: 'deepseek-v4-flash' },
  openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  openrouter: { baseUrl: 'https://openrouter.ai/api/v1', model: 'anthropic/claude-3.5-sonnet' },
  siliconflow: { baseUrl: 'https://api.siliconflow.cn/v1', model: 'deepseek-ai/DeepSeek-V3' },
  custom: { baseUrl: '', model: '' },
  ollama: { baseUrl: 'http://127.0.0.1:11434', model: 'qwen2.5' }
};

const contextWindowByModel: Record<string, number> = {
  'deepseek-v4-flash': 1_000_000,
  'gpt-4o-mini': 128_000,
  'anthropic/claude-3.5-sonnet': 200_000,
  'deepseek-ai/DeepSeek-V3': 128_000,
  'qwen2.5': 32_768
};

// 请求级 LLM 配置覆盖：前端把用户的 key/配置放在 header 里，每请求独立、不入库；
// getRuntimeLlmSettings 取此 store 作最高优先级，避免共享一把 key 被打爆额度。
const llmRequestStore = new AsyncLocalStorage();

function getModelContextWindow(model: string = ''): number {
  return contextWindowByModel[model] || 128_000;
}

function buildAgentRunTitle(text: string = ''): string {
  const normalized = String(text || '')
    .replace(/\s+/g, ' ')
    .replace(/[？?！!。]+$/g, '')
    .trim();
  if (!normalized) return '新问题';
  const firstClause = normalized.split(/[，。！？；,.!?:：]/)[0]?.trim() || normalized;
  return firstClause.length > 18 ? `${firstClause.slice(0, 18)}…` : firstClause;
}

function getTokenEncoder(model: string = ''): any {
  try {
    return encodingForModel((model || 'gpt-4o-mini') as any);
  } catch (error) {
    return getEncoding('cl100k_base');
  }
}

function estimateChatTokens(messages: any[] = [], model: string = ''): number {
  const encoder = getTokenEncoder(model);
  try {
    let total = 0;
    for (const message of messages) {
      const role = String(message?.role || '');
      const content = Array.isArray(message?.content)
        ? JSON.stringify(message.content)
        : String(message?.content || '');
      total += 8;
      total += encoder.encode(role).length;
      total += encoder.encode(content).length;
    }
    return total + 12;
  } finally {
    encoder.free?.();
  }
}

function buildUsageReport({
  model,
  promptTokens = 0,
  completionTokens = 0,
  totalTokens = 0,
  estimated = false
}: any): any {
  const contextWindow = getModelContextWindow(model);
  const ratio = contextWindow > 0 ? totalTokens / contextWindow : 0;
  const remainingTokens = Math.max(0, contextWindow - totalTokens);
  let level = 'ok';
  let warning = '';

  if (ratio >= 0.9) {
    level = 'danger';
    warning = '上下文已接近上限，较早对话可能被压缩或忽略。';
  } else if (ratio >= 0.75) {
    level = 'warn';
    warning = '上下文已经较长，继续追问时建议及时收束或让我先总结。';
  }

  return {
    model,
    contextWindow,
    promptTokens,
    completionTokens,
    totalTokens,
    remainingTokens,
    usageRatio: Number(ratio.toFixed(4)),
    estimated,
    level,
    warning
  };
}

function getRuntimeLlmSettings({ includeSecret = false }: any = {}): any {
  // 优先用本次请求的 header override（A 方案：每用户带自己的 key，不入库）。
  const override: any = llmRequestStore.getStore();
  const saved = getLlmSettings({ includeSecret: true });
  const envProvider = process.env.LLM_PROVIDER;
  const provider = override?.provider || envProvider || saved.provider || (process.env.DEEPSEEK_API_KEY ? 'deepseek' : 'ollama');
  const defaults = providerDefaults[provider] || providerDefaults.custom;
  const apiKey = override?.apiKey || process.env.DEEPSEEK_API_KEY || saved.apiKey || '';
  const settings: any = {
    provider,
    baseUrl: override?.baseUrl || process.env.DEEPSEEK_BASE_URL || saved.baseUrl || defaults.baseUrl,
    model: override?.model || process.env.DEEPSEEK_MODEL || saved.model || defaults.model,
    apiKey,
    apiKeySet: !!apiKey
  };
  if (!includeSecret) {
    delete settings.apiKey;
  }
  return settings;
}

function getLlmProvider(): string {
  return getRuntimeLlmSettings().provider;
}

function getDefaultLlmModel(): string {
  const settings = getRuntimeLlmSettings();
  return settings.provider === 'ollama'
    ? (settings.model || process.env.OLLAMA_MODEL || 'qwen2.5')
    : settings.model;
}

function buildChatCompletionsUrl(baseUrl: string = ''): string {
  const trimmed = baseUrl.replace(/\/$/, '');
  if (trimmed.endsWith('/chat/completions')) return trimmed;
  if (trimmed.endsWith('/v1')) return `${trimmed}/chat/completions`;
  if (trimmed.endsWith('/v1/')) return `${trimmed.replace(/\/$/, '')}/chat/completions`;
  return `${trimmed}/chat/completions`;
}

async function callOpenAiCompatibleChat(options: any): Promise<any> {
  const {
    messages,
    model,
    stream = false,
    temperature = 0.4,
    maxTokens = 1200,
    responseFormat,
    tools,
    toolChoice
  } = options;

  return traceLangSmithRun({
    name: stream ? 'llm.request.stream' : 'llm.request',
    runType: 'llm',
    inputs: {
      messages,
      model: model || getDefaultLlmModel(),
      stream,
      temperature,
      maxTokens,
      responseFormat: responseFormat || null,
      tools: Array.isArray(tools) ? tools.map((tool: any) => tool.function?.name || tool.name).filter(Boolean) : undefined,
      toolChoice: toolChoice || null
    },
    metadata: {
      provider: getLlmProvider(),
      model: model || getDefaultLlmModel(),
      stream,
      temperature,
      max_tokens: maxTokens
    },
    tags: ['llm', getLlmProvider(), stream ? 'stream' : 'request']
  }, () => callOpenAiCompatibleChatImpl({
    ...options,
    stream,
    temperature,
    maxTokens
  }), {
    processOutputs: (response: any) => ({
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      stream
    })
  });
}

async function callOpenAiCompatibleChatImpl({
  messages,
  model,
  stream = false,
  temperature = 0.4,
  maxTokens = 1200,
  responseFormat,
  tools,
  toolChoice,
  timeoutMs = 45000
}: any): Promise<any> {
  const settings = getRuntimeLlmSettings({ includeSecret: true });
  if (!settings.apiKey) {
    throw new Error(`${settings.provider} API key is not configured`);
  }

  const body: any = {
    model: model || settings.model,
    messages,
    stream,
    temperature,
    max_tokens: maxTokens
  };
  if (stream) {
    body.stream_options = { include_usage: true };
  }
  // `thinking` 是 DeepSeek 专有字段，OpenAI / OpenRouter 等会因未知参数报 400，需按 provider 区分。
  if (settings.provider === 'deepseek') {
    body.thinking = { type: 'disabled' };
  }
  if (responseFormat) {
    body.response_format = responseFormat;
  }
  if (tools) {
    body.tools = tools;
  }
  if (toolChoice) {
    body.tool_choice = toolChoice;
  }

  const makeRequest = async (requestBody: any) => {
    const response = await fetch(buildChatCompletionsUrl(settings.baseUrl), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.apiKey}`
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(timeoutMs)
    });
    return response;
  };

  let response = await makeRequest(body);
  if (!response.ok && stream && body.stream_options) {
    const errorText = await response.text().catch(() => '');
    const unsupportedUsage = response.status === 400 && /stream_options|include_usage|unsupported/i.test(errorText);
    if (unsupportedUsage) {
      delete body.stream_options;
      response = await makeRequest(body);
    } else {
      throw new Error(`${settings.provider} API error ${response.status}: ${errorText.slice(0, 240)}`);
    }
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`${settings.provider} API error ${response.status}: ${errorText.slice(0, 240)}`);
  }

  return response;
}

async function callLlmText({ messages, model, temperature = 0.4, maxTokens = 1200, responseFormat }: any): Promise<string> {
  return traceLangSmithRun({
    name: 'llm.chat',
    runType: 'llm',
    inputs: {
      messages,
      model: model || getDefaultLlmModel(),
      temperature,
      maxTokens,
      responseFormat: responseFormat || null
    },
    metadata: {
      provider: getLlmProvider(),
      model: model || getDefaultLlmModel(),
      temperature,
      max_tokens: maxTokens,
      stream: false
    },
    tags: ['llm', 'chat', getLlmProvider()]
  }, () => callLlmTextImpl({ messages, model, temperature, maxTokens, responseFormat }), {
    processOutputs: (text: any) => ({
      content: String(text || '').slice(0, 4000),
      contentLength: String(text || '').length
    })
  });
}

async function callLlmTextImpl({ messages, model, temperature = 0.4, maxTokens = 1200, responseFormat }: any): Promise<string> {
  if (getLlmProvider() !== 'ollama') {
    const response = await callOpenAiCompatibleChat({ messages, model, stream: false, temperature, maxTokens, responseFormat });
    const data: any = await response.json();
    return data.choices?.[0]?.message?.content || '';
  }

  const response = await ollama.chat({
    model: model || process.env.OLLAMA_MODEL || 'qwen2.5',
    messages,
    stream: false
  });
  return response.message?.content || '';
}

async function pipeLlmStreamToSse({ res, messages, model, temperature = 0.4, maxTokens = 1800 }: any): Promise<void> {
  if (getLlmProvider() !== 'ollama') {
    const response = await callOpenAiCompatibleChat({ messages, model, stream: true, temperature, maxTokens });
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split('\n\n');
      buffer = events.pop() || '';

      for (const event of events) {
        const line = event.split('\n').find((item: string) => item.startsWith('data: '));
        if (!line) continue;
        const dataStr = line.slice(6).trim();
        if (dataStr === '[DONE]') {
          res.write('data: [DONE]\n\n');
          return;
        }
        try {
          const data = JSON.parse(dataStr);
          const content = data.choices?.[0]?.delta?.content || '';
          if (content) {
            res.write(`data: ${JSON.stringify({ content })}\n\n`);
          }
        } catch (e) {
          // Ignore malformed partial stream frames.
        }
      }
    }
    res.write('data: [DONE]\n\n');
    return;
  }

  const response: any = await ollama.chat({
    model: model || process.env.OLLAMA_MODEL || 'qwen2.5',
    messages,
    stream: true
  });

  for await (const part of response) {
    res.write(`data: ${JSON.stringify({ content: part.message?.content || '' })}\n\n`);
  }
  res.write('data: [DONE]\n\n');
}

async function streamLlmText(options: any): Promise<void> {
  const {
    messages,
    model,
    temperature = 0.25,
    maxTokens = 1600,
    onToken,
    onUsage
  } = options;
  let content = '';
  let usage: any = null;

  return traceLangSmithRun({
    name: 'llm.stream',
    runType: 'llm',
    inputs: {
      messages,
      model: model || getDefaultLlmModel(),
      temperature,
      maxTokens,
      stream: true
    },
    metadata: {
      provider: getLlmProvider(),
      model: model || getDefaultLlmModel(),
      temperature,
      max_tokens: maxTokens,
      stream: true
    },
    tags: ['llm', 'stream', getLlmProvider()]
  }, () => streamLlmTextImpl({
    ...options,
    temperature,
    maxTokens,
    onToken: (chunk: string) => {
      content += chunk;
      onToken?.(chunk);
    },
    onUsage: (nextUsage: any) => {
      usage = nextUsage;
      onUsage?.(nextUsage);
    }
  }), {
    processOutputs: () => ({
      content: content.slice(0, 4000),
      contentLength: content.length,
      usage
    })
  });
}

async function streamLlmTextImpl({ messages, model, temperature = 0.25, maxTokens = 1600, onToken, onUsage, shouldCancel }: any): Promise<void> {
  if (getLlmProvider() !== 'ollama') {
    const response = await callOpenAiCompatibleChat({ messages, model, stream: true, temperature, maxTokens, timeoutMs: 25000 });
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    while (true) {
      if (shouldCancel?.()) {
        await reader.cancel().catch(() => {});
        throw new Error('Tutor cancelled');
      }
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split('\n\n');
      buffer = events.pop() || '';

      for (const event of events) {
        const line = event.split('\n').find((item: string) => item.startsWith('data: '));
        if (!line) continue;
        const dataStr = line.slice(6).trim();
        if (dataStr === '[DONE]') return;
        if (shouldCancel?.()) {
          await reader.cancel().catch(() => {});
          throw new Error('Tutor cancelled');
        }
        try {
          const data = JSON.parse(dataStr);
          if (data.usage && typeof onUsage === 'function') {
            onUsage(data.usage);
          }
          const content = data.choices?.[0]?.delta?.content || '';
          if (content) onToken(content);
        } catch (e) {
          // Ignore malformed partial stream frames.
        }
      }
    }
    return;
  }

  const response: any = await ollama.chat({
    model: model || process.env.OLLAMA_MODEL || 'qwen2.5',
    messages,
    stream: true
  });

  for await (const part of response) {
    if (shouldCancel?.()) {
      throw new Error('Tutor cancelled');
    }
    const content = part.message?.content || '';
    if (content) onToken(content);
  }
}

export {
  ollama,
  providerDefaults,
  contextWindowByModel,
  llmRequestStore,
  getModelContextWindow,
  buildAgentRunTitle,
  getTokenEncoder,
  estimateChatTokens,
  buildUsageReport,
  getRuntimeLlmSettings,
  getLlmProvider,
  getDefaultLlmModel,
  buildChatCompletionsUrl,
  callOpenAiCompatibleChat,
  callOpenAiCompatibleChatImpl,
  callLlmText,
  callLlmTextImpl,
  pipeLlmStreamToSse,
  streamLlmText,
  streamLlmTextImpl
};
