const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

export function createEmbedder({
  provider = 'ollama',
  model = 'bge-m3',
  baseUrl = 'http://localhost:11434',
  apiKey = '',
  fetchImpl = fetch,
  timeoutMs = 3000,
  retryDelayMs = 300,
  cacheSize = 256
} = {}) {
  let dim = null;
  const cache = new Map(); // 简易 LRU：Map 迭代序即插入序

  function cacheGet(key) {
    if (!cache.has(key)) return null;
    const value = cache.get(key);
    cache.delete(key);
    cache.set(key, value);
    return value;
  }

  function cacheSet(key, value) {
    cache.set(key, value);
    if (cache.size > cacheSize) cache.delete(cache.keys().next().value);
  }

  async function callOnce(texts) {
    const base = baseUrl.replace(/\/$/, '');
    const isOllama = provider === 'ollama';
    const url = isOllama ? `${base}/api/embed` : `${base.replace(/\/v1$/, '')}/v1/embeddings`;
    const headers = { 'Content-Type': 'application/json' };
    if (!isOllama && apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const body = { model, input: texts };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, { method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal });
      if (!res.ok) {
        const err = new Error(`embedding http ${res.status}`);
        err.status = res.status;
        throw err;
      }
      const data = await res.json();
      const vectors = isOllama
        ? data.embeddings
        : data.data.sort((a, b) => a.index - b.index).map(d => d.embedding);
      if (!Array.isArray(vectors) || vectors.length !== texts.length) {
        throw new Error('embedding response shape mismatch');
      }
      return vectors;
    } finally {
      clearTimeout(timer);
    }
  }

  async function callWithRetry(texts) {
    let lastError;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await callOnce(texts);
      } catch (error) {
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
    async embed(texts) {
      if (!Array.isArray(texts) || texts.length === 0) return [];
      if (texts.length === 1) {
        const hit = cacheGet(texts[0]);
        if (hit) return [hit];
      }
      const vectors = await callWithRetry(texts);
      if (dim === null && vectors[0]) dim = vectors[0].length;
      if (vectors.some(v => v.length !== dim)) throw new Error('embedding dim inconsistent');
      if (texts.length === 1) cacheSet(texts[0], vectors[0]);
      return vectors;
    }
  };
}
