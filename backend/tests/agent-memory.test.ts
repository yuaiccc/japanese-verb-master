import test from 'node:test';
import assert from 'node:assert/strict';
import { rankAgentMemories, resolveAgentMemoryConflicts, AGENT_MEMORY_TYPES } from '../db';

const NOW = Date.parse('2026-06-22T08:00:00Z');
const daysAgo = (d: number): string => new Date(NOW - d * 24 * 60 * 60 * 1000).toISOString();

test('rankAgentMemories: salience 相同时近期的排前', () => {
  const mems = [
    { id: 1, salience: 1, updatedAt: daysAgo(60) },
    { id: 2, salience: 1, updatedAt: daysAgo(1) }
  ];
  const r = rankAgentMemories(mems, { nowMs: NOW });
  assert.deepEqual(r.map((m: any) => m.id), [2, 1]);
});

test('rankAgentMemories: 高 salience 能压过较旧时间', () => {
  const mems = [
    { id: 1, salience: 5, updatedAt: daysAgo(30) }, // 5 * 0.5 = 2.5
    { id: 2, salience: 1, updatedAt: daysAgo(0) }   // 1 * 1 = 1
  ];
  const r = rankAgentMemories(mems, { nowMs: NOW });
  assert.equal(r[0].id, 1);
});

test('rankAgentMemories: 尊重 limit', () => {
  const mems = Array.from({ length: 10 }, (_, i) => ({ id: i, salience: 1, updatedAt: daysAgo(i) }));
  assert.equal(rankAgentMemories(mems, { nowMs: NOW, limit: 3 }).length, 3);
});

test('resolveAgentMemoryConflicts: 新键 → 新增，salience=1', () => {
  const { upserts } = resolveAgentMemoryConflicts([], [
    { type: 'goal', mkey: 'jlpt_target', value: '考 N2' }
  ]);
  assert.equal(upserts.length, 1);
  assert.equal(upserts[0].salience, 1);
  assert.equal(upserts[0].unchanged, false);
});

test('resolveAgentMemoryConflicts: 同键不同值 → 更新 value + 提 salience', () => {
  const existing = [{ type: 'goal', mkey: 'jlpt_target', value: '考 N3', salience: 1 }];
  const { upserts } = resolveAgentMemoryConflicts(existing, [
    { type: 'goal', mkey: 'jlpt_target', value: '考 N2' }
  ]);
  assert.equal(upserts[0].value, '考 N2');
  assert.equal(upserts[0].salience, 1.5);
  assert.equal(upserts[0].unchanged, false);
});

test('resolveAgentMemoryConflicts: 同键同值 → 仅提 salience，标记 unchanged', () => {
  const existing = [{ type: 'preference', mkey: 'example_style', value: '商务场景', salience: 2 }];
  const { upserts } = resolveAgentMemoryConflicts(existing, [
    { type: 'preference', mkey: 'example_style', value: '商务场景' }
  ]);
  assert.equal(upserts[0].unchanged, true);
  assert.equal(upserts[0].salience, 2.5);
});

test('resolveAgentMemoryConflicts: 非法 type / 空值 → skipped', () => {
  const { upserts, skipped } = resolveAgentMemoryConflicts([], [
    { type: 'nonsense', mkey: 'x', value: 'y' },
    { type: 'fact', mkey: '', value: 'y' },
    { type: 'fact', mkey: 'native_lang', value: '' },
    { type: 'fact', mkey: 'native_lang', value: '中文' }
  ]);
  assert.equal(upserts.length, 1);
  assert.equal(skipped.length, 3);
  assert.equal(upserts[0].value, '中文');
});

test('mkey 大小写归一化（去重稳健）', () => {
  const existing = [{ type: 'preference', mkey: 'tone', value: '简短', salience: 1 }];
  const { upserts } = resolveAgentMemoryConflicts(existing, [
    { type: 'preference', mkey: 'TONE', value: '更简短' }
  ]);
  assert.equal(upserts.length, 1);
  assert.equal(upserts[0].salience, 1.5); // 命中已有 'tone'
});

test('AGENT_MEMORY_TYPES 是四类', () => {
  assert.deepEqual([...AGENT_MEMORY_TYPES].sort(), ['fact', 'goal', 'preference', 'task']);
});
