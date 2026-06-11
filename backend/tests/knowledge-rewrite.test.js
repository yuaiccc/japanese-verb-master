import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createQueryRewriter } from '../knowledge/rewrite.js';

test('无 chatFn 时透传原查询', async () => {
  const rw = createQueryRewriter({});
  assert.equal(rw.enabled, false);
  const out = await rw.rewrite('原始问题');
  assert.equal(out.query, '原始问题');
  assert.equal(out.changed, false);
});

test('改写结果与原查询拼接（多路，保召回）', async () => {
  const rw = createQueryRewriter({ chatFn: async () => '{"query":"て形 变化","terms":["て形","活用"]}' });
  const out = await rw.rewrite('动词怎么连接');
  assert.equal(out.changed, true);
  assert.match(out.query, /动词怎么连接/); // 原查询保留
  assert.match(out.query, /て形/);          // 改写词加入
});

test('LLM 抛错时降级为原查询', async () => {
  const rw = createQueryRewriter({ chatFn: async () => { throw new Error('down'); } });
  const out = await rw.rewrite('问题');
  assert.equal(out.query, '问题');
  assert.equal(out.changed, false);
});

test('解析失败时降级为原查询', async () => {
  const rw = createQueryRewriter({ chatFn: async () => 'not json' });
  const out = await rw.rewrite('问题');
  assert.equal(out.changed, false);
});
