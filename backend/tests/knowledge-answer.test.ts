import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAnswerer, ABSTAIN_MARK } from '../knowledge/answer';

const chunks = [
  { title: 'て形', content: 'て形规则…' },
  { title: 'た形', content: 'た形规则…' }
];
const fakeRetriever = (topVectorDistance: number) => ({
  async queryRelevantDocuments() { return { results: chunks, topVectorDistance }; }
});

test('abstain 距离预过滤：距离超阈值直接拒答，不调用 LLM', async () => {
  let called = false;
  const a = createAnswerer({
    chatFn: async () => { called = true; return 'x'; },
    retriever: fakeRetriever(1.2), abstain: true, distanceThreshold: 1.0
  });
  const out = await a.answer('离题问题');
  assert.equal(out.abstained, true);
  assert.equal(out.reason, 'low-confidence');
  assert.equal(called, false);
});

test('abstain gatekeeper：LLM 回 ABSTAIN 则拒答', async () => {
  const a = createAnswerer({
    chatFn: async () => ABSTAIN_MARK,
    retriever: fakeRetriever(0.5), abstain: true
  });
  const out = await a.answer('边界问题');
  assert.equal(out.abstained, true);
  assert.equal(out.reason, 'gatekeeper');
});

test('正常回答：提取引用编号且不拒答', async () => {
  const a = createAnswerer({
    chatFn: async () => 'て形这样变。[1] 过去式那样变。[2]',
    retriever: fakeRetriever(0.4), abstain: true
  });
  const out = await a.answer('て形怎么变');
  assert.equal(out.abstained, false);
  assert.deepEqual(out.citedIndices, [1, 2]);
});

test('越界引用编号被过滤', async () => {
  const a = createAnswerer({
    chatFn: async () => '内容。[1][9]',
    retriever: fakeRetriever(0.4)
  });
  const out = await a.answer('q');
  assert.deepEqual(out.citedIndices, [1]); // [9] 超出 chunks 数量被丢弃
});

test('abstain 关闭时距离再大也照常回答', async () => {
  const a = createAnswerer({
    chatFn: async () => '照常回答。[1]',
    retriever: fakeRetriever(1.5), abstain: false
  });
  const out = await a.answer('q');
  assert.equal(out.abstained, false);
});
