import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectLearningIntent,
  getAgentQueue,
  isLookupWorthy,
  learningSubagentRegistry,
  selectSpecialistSubagents
} from '../learningSubagents.js';

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

test('简单て形问题只查本地知识和目标词', () => {
  const plan = planFor('食べる 的て形怎么变？用一句话解释。');
  const names = plan.map(t => t.name);
  const lookups = plan.filter(t => t.name === 'lookup_word').map(t => t.arguments.word);

  assert.deepEqual(names, ['knowledge_search', 'lookup_word']);
  assert.deepEqual(lookups, ['食べる']);
  assert.equal(lookups.includes('的て'), false);
  assert.equal(names.includes('external_search'), false);
  assert.equal(names.includes('recommend_similar'), false);
  assert.equal(names.includes('memory_status'), false);
});

test('普通查词仍可推荐相似词', () => {
  const names = planFor('查一下 食べる').map(t => t.name);
  assert.equal(names.includes('lookup_word'), true);
  assert.equal(names.includes('recommend_similar'), true);
});

test('复习相关问题才让 Researcher 读取 memory_status', () => {
  const grammarNames = planFor('食べる 的て形怎么变？').map(t => t.name);
  const memoryNames = planFor('今天有哪些词需要复习？').map(t => t.name);

  assert.equal(grammarNames.includes('memory_status'), false);
  assert.equal(memoryNames.includes('memory_status'), true);
});

test('例句和练习请求会串联两个 specialist', () => {
  const intent = detectLearningIntent('用 食べる 给我 3 个便利店例句，然后出一道填空练习。');
  assert.deepEqual(selectSpecialistSubagents(intent), ['example_designer', 'practice_coach']);
  assert.deepEqual(
    getAgentQueue(intent).map(item => item.id),
    ['planner', 'researcher', 'example_designer', 'practice_coach', 'tutor', 'memory_manager']
  );
});
