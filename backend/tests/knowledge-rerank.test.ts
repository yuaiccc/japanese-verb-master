import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createReranker } from '../knowledge/rerank';

const candidates = [
  { id: 1, title: 'A', content: 'aaa' },
  { id: 2, title: 'B', content: 'bbb' },
  { id: 3, title: 'C', content: 'ccc' }
];

test('无 chatFn 时降级且 applied=false', async () => {
  const r = createReranker({});
  assert.equal(r.enabled, false);
  const { items, applied } = await r.rerank('q', candidates, { topK: 2 });
  assert.deepEqual(items.map((c: any) => c.id), [1, 2]);
  assert.equal(applied, false);
});

test('LLM 排序生效且 applied=true', async () => {
  const r = createReranker({ chatFn: async () => '{"order":[2,0,1]}' });
  const { items, applied } = await r.rerank('q', candidates, { topK: 3 });
  assert.deepEqual(items.map((c: any) => c.id), [3, 1, 2]);
  assert.equal(applied, true);
});

test('LLM 抛错时降级为融合顺序且 applied=false', async () => {
  const r = createReranker({ chatFn: async () => { throw new Error('down'); } });
  const { items, applied } = await r.rerank('q', candidates, { topK: 3 });
  assert.deepEqual(items.map((c: any) => c.id), [1, 2, 3]);
  assert.equal(applied, false);
});

test('解析失败时降级且 applied=false', async () => {
  const r = createReranker({ chatFn: async () => 'not json' });
  const { applied } = await r.rerank('q', candidates, { topK: 3 });
  assert.equal(applied, false);
});

test('LLM 漏排的候选被补回', async () => {
  const r = createReranker({ chatFn: async () => '{"order":[1]}' });
  const { items, applied } = await r.rerank('q', candidates, { topK: 3 });
  assert.deepEqual(items.map((c: any) => c.id), [2, 1, 3]); // [1] 排第一，漏排的 0、2 按原序补回
  assert.equal(applied, true);
});

test('越界/重复序号被过滤', async () => {
  const r = createReranker({ chatFn: async () => '{"order":[2,2,9,0]}' });
  const { items } = await r.rerank('q', candidates, { topK: 3 });
  assert.deepEqual(items.map((c: any) => c.id), [3, 1, 2]);
});

test('单候选不调 LLM', async () => {
  let called = false;
  const r = createReranker({ chatFn: async () => { called = true; return '{"order":[0]}'; } });
  const { applied } = await r.rerank('q', [candidates[0]], { topK: 3 });
  assert.equal(called, false);
  assert.equal(applied, false);
});
