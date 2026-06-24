const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

export function createEmbedder({
  provider = 'ollama',
  model = 'bge-m3',
  baseUrl = 'http://localhost:11434',
  apiKey = '',
  fetchImpl = fetch,
  timeoutMs = 3000,
  retryDelayMs = 300,
  cacheSize = 256
}: any = {}): any {
  let dim: number | null = null;
  const cache = new Map(); // 简易 LRU：Map 迭代序即插入序

  function cacheGet(key: string): any {
    if (!cache.has(key)) return null;
    const value = cache.get(key);
    cache.delete(key);
    cache.set(key, value);
    return value;
  }

  function cacheSet(key: string, value: any): void {
    cache.set(key, value);
    if (cache.size > cacheSize) cache.delete(cache.keys().next().value);
  }

  async function callOnce(texts: string[]): Promise<any[]> {
    const base = baseUrl.replace(/\/$/, '');
    const isOllama = provider === 'ollama';
    const url = isOllama ? `${base}/api/embed` : `${base.replace(/\/v1$/, '')}/v1/embeddings`;
    const headers: any = { 'Content-Type': 'application/json' };
    if (!isOllama && apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const body = { model, input: texts };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, { method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal });
      if (!res.ok) {
        const err: any = new Error(`embedding http ${res.status}`);
        err.status = res.status;
        throw err;
      }
      const data: any = await res.json();
      const vectors = isOllama
        ? data.embeddings
        : data.data.sort((a: any, b: any) => a.index - b.index).map((d: any) => d.embedding);
      if (!Array.isArray(vectors) || vectors.length !== texts.length) {
        throw new Error('embedding response shape mismatch');
      }
      return vectors;
    } finally {
      clearTimeout(timer);
    }
  }

  async function callWithRetry(texts: string[]): Promise<any[]> {
    let lastError: any;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await callOnce(texts);
      } catch (error: any) {
        lastError = error;
        if (error.status && error.status >= 400 && error.status < 500 && error.status !== 429) {
          throw error;
        }
        if (attempt < 2) await sleep(retryDelayMs * (attempt + 1));
      }
    }
    throw lastError;
  }

  return {
    provider,
    model,
    getDim: () => dim,
    async embed(texts: string[]): Promise<any[]> {
      if (!Array.isArray(texts) || texts.length === 0) return [];
      if (texts.length === 1) {
        const hit = cacheGet(texts[0]);
        if (hit) return [hit];
      }
      const vectors = await callWithRetry(texts);
      if (dim === null && vectors[0]) dim = vectors[0].length;
      if (vectors.some((v: any) => v.length !== dim)) throw new Error('embedding dim inconsistent');
      if (texts.length === 1) cacheSet(texts[0], vectors[0]);
      return vectors;
    }
  };
}
