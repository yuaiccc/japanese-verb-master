import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmbedder } from '../knowledge/embeddings.js';

function fakeFetch(handler) {
  return async (url, options) => {
    const body = JSON.parse(options.body);
    return { ok: true, status: 200, json: async () => handler(url, body) };
  };
}

test('ollama provider posts to /api/embed and returns vectors', async () => {
  const embedder = createEmbedder({
    provider: 'ollama', model: 'bge-m3', baseUrl: 'http://localhost:11434',
    fetchImpl: fakeFetch((url, body) => {
      assert.ok(url.endsWith('/api/embed'));
      return { embeddings: body.input.map(() => [0.1, 0.2, 0.3]) };
    })
  });
  const vectors = await embedder.embed(['食べる', '飲む']);
  assert.equal(vectors.length, 2);
  assert.equal(embedder.getDim(), 3);
});

test('openai-compatible provider posts to /v1/embeddings with bearer key', async () => {
  let sawAuth = '';
  const embedder = createEmbedder({
    provider: 'openai-compatible', model: 'bge-m3', baseUrl: 'https://api.example.com/v1', apiKey: 'sk-x',
    fetchImpl: async (url, options) => {
      sawAuth = options.headers.Authorization;
      assert.ok(url.endsWith('/v1/embeddings'));
      const body = JSON.parse(options.body);
      return { ok: true, status: 200, json: async () => ({ data: body.input.map((_, i) => ({ index: i, embedding: [1, 0] })) }) };
    }
  });
  const vectors = await embedder.embed(['は']);
  assert.deepEqual(vectors, [[1, 0]]);
  assert.equal(sawAuth, 'Bearer sk-x');
});

test('retries 3 times then throws', async () => {
  let calls = 0;
  const embedder = createEmbedder({
    provider: 'ollama', model: 'bge-m3', baseUrl: 'http://localhost:11434', retryDelayMs: 1,
    fetchImpl: async () => { calls += 1; return { ok: false, status: 500, json: async () => ({}) }; }
  });
  await assert.rejects(() => embedder.embed(['x']));
  assert.equal(calls, 3);
});

test('caches identical single-query embeds', async () => {
  let calls = 0;
  const embedder = createEmbedder({
    provider: 'ollama', model: 'bge-m3', baseUrl: 'http://localhost:11434',
    fetchImpl: fakeFetch(() => { calls += 1; return { embeddings: [[0.5]] }; })
  });
  await embedder.embed(['て形']);
  await embedder.embed(['て形']);
  assert.equal(calls, 1);
});
