import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMetrics } from '../knowledge/metrics';

test('空指标返回 queries:0', () => {
  assert.deepEqual(createMetrics().snapshot(), { queries: 0 });
});

test('聚合延迟与速率', () => {
  const m = createMetrics();
  m.record({ latencyMs: 10, vectorHits: 5, bm25Hits: 3, degraded: false, reranked: true });
  m.record({ latencyMs: 30, vectorHits: 7, bm25Hits: 1, degraded: true, reranked: false });
  const s = m.snapshot();
  assert.equal(s.queries, 2);
  assert.equal(s.latencyMs.avg, 20);
  assert.equal(s.degradedRate, 0.5);
  assert.equal(s.rerankedRate, 0.5);
  assert.equal(s.avgVectorHits, 6);
  assert.equal(s.avgBm25Hits, 2);
});

test('环形上限：超出 maxSamples 丢弃最旧', () => {
  const m = createMetrics({ maxSamples: 3 });
  for (let i = 0; i < 5; i++) m.record({ latencyMs: i, degraded: false, reranked: false });
  assert.equal(m.snapshot().queries, 3);
});

test('reset 清空', () => {
  const m = createMetrics();
  m.record({ latencyMs: 1, degraded: false, reranked: false });
  m.reset();
  assert.deepEqual(m.snapshot(), { queries: 0 });
});
