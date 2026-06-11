import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isLookupWorthy, learningSubagentRegistry, detectLearningIntent } from '../learningSubagents.js';

const planFor = (message) => learningSubagentRegistry.researcher.planTools({
  intent: detectLearningIntent(message),
  message
});

test('isLookupWorthy：真实日语词通过', () => {
  for (const t of ['食べる', '召し上がる', '勉強', '敬語', 'ながら', 'カタカナ']) {
    assert.equal(isLookupWorthy(t), true, t);
  }
});

test('isLookupWorthy：整句中文与单字假名被拒', () => {
  for (const t of ['动词的被动形怎么变', 'は', 'が', 'を', '是什么意思', '怎么表达', '']) {
    assert.equal(isLookupWorthy(t), false, t);
  }
});

test('纯中文语法问题不安排 lookup_word（曾把整句当词查）', () => {
  const tools = planFor('动词的被动形怎么变？').map(t => t.name);
  assert.equal(tools.includes('lookup_word'), false);
  assert.equal(tools[0], 'knowledge_search'); // 知识库仍是第一工具
});

test('「は和が」类助词问题不查词典（曾误查出同音词「歯」）', () => {
  const tools = planFor('は和が到底怎么区分').map(t => t.name);
  assert.equal(tools.includes('lookup_word'), false);
  assert.equal(tools.includes('recommend_similar'), false);
});

test('真实查词问题仍安排 lookup_word', () => {
  const plan = planFor('食べる 和 召し上がる 有什么区别？');
  const lookups = plan.filter(t => t.name === 'lookup_word').map(t => t.arguments.word);
  assert.ok(lookups.includes('食べる'));
  assert.ok(lookups.includes('召し上がる'));
});
