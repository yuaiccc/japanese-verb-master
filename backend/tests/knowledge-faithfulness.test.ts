import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseClaims, createFaithfulnessJudge, summarizeFaithfulness } from '../knowledge/faithfulness';

test('parseClaims 解析 JSON claims', () => {
  const claims = parseClaims('{"claims":[{"text":"a","supported":true,"cited":false}]}');
  assert.equal(claims!.length, 1);
  assert.equal(claims![0].supported, true);
  assert.equal(claims![0].cited, false);
});

test('parseClaims 从夹带文字里提取 JSON', () => {
  const claims = parseClaims('审计结果：{"claims":[{"text":"x","supported":false,"cited":false}]} 完毕');
  assert.equal(claims!.length, 1);
  assert.equal(claims![0].supported, false);
});

test('parseClaims 解析失败返回 null', () => {
  assert.equal(parseClaims('not json'), null);
});

test('judge 对 abstained 答案记为零陈述', async () => {
  const judge = createFaithfulnessJudge({ chatFn: async () => '{"claims":[]}' });
  const r = await judge.judge({ query: 'q', answer: '拒答', abstained: true });
  assert.equal(r.total, 0);
  assert.equal(r.abstained, true);
});

test('judge 统计 supported / cited', async () => {
  const judge = createFaithfulnessJudge({
    chatFn: async () => '{"claims":[{"text":"a","supported":true,"cited":true},{"text":"b","supported":false,"cited":false}]}'
  });
  const r = await judge.judge({ query: 'q', answer: 'a b', contextChunks: [{ title: 't', content: 'c' }] });
  assert.equal(r.total, 2);
  assert.equal(r.supported, 1);
  assert.equal(r.cited, 1);
});

test('summarizeFaithfulness 聚合覆盖率/忠实度/幻觉率', () => {
  const s = summarizeFaithfulness([
    { total: 2, supported: 2, cited: 1, abstained: false },
    { total: 0, supported: 0, cited: 0, abstained: true }
  ]);
  assert.equal(s.answered, 1);
  assert.equal(s.abstained, 1);
  assert.equal(s.claims, 2);
  assert.equal(s.citationCoverage, 0.5); // 1/2
  assert.equal(s.faithfulness, 1);       // 2/2
  assert.equal(s.hallucinationRate, 0);  // (2-2)/2
});

test('summarizeFaithfulness 幻觉率：不支撑的陈述占比', () => {
  const s = summarizeFaithfulness([{ total: 4, supported: 1, cited: 0, abstained: false }]);
  assert.equal(s.hallucinationRate, 0.75); // (4-1)/4
});
