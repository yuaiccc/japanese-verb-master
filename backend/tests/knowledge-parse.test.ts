import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSourceFile } from '../knowledge/parse';

const SAMPLE = `---
category: 活用
level: N5
tags: [动词, 变形]
---

## て形的变化规则

> level: N5

一段动词去る加て。五段动词按音便分组。

## 可能形

> level: N4

一段动词去る加られる。
`;

test('splits by h2 headings with metadata', () => {
  const chunks = parseSourceFile(SAMPLE, 'verb-conjugation.md');
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].title, 'て形的变化规则');
  assert.equal(chunks[0].docId, 'verb-conjugation');
  assert.equal(chunks[0].resource, 'kb://grammar/verb-conjugation');
  assert.equal(chunks[0].category, '活用');
  assert.equal(chunks[0].level, 'N5');
  assert.equal(chunks[1].level, 'N4'); // 条目内覆盖
  assert.deepEqual(chunks[0].tags, ['动词', '变形']);
  assert.match(chunks[0].contentHash, /^[a-f0-9]{64}$/);
});

test('long sections split with overlap', () => {
  const para = '一段动词的活用规则说明。'.repeat(60); // ~720 字 x2 段
  const long = `---\ncategory: 活用\nlevel: N5\n---\n\n## 长条目\n\n${para}\n\n${para}`;
  const chunks = parseSourceFile(long, 'x.md');
  assert.ok(chunks.length >= 2);
  assert.equal(chunks[0].title, '长条目');
  assert.equal(chunks[1].title, '长条目 (2)');
  const tail = chunks[0].content.slice(-30);
  assert.ok(chunks[1].content.includes(tail));
});

test('hash changes when content changes', () => {
  const a = parseSourceFile(SAMPLE, 'a.md')[0];
  const b = parseSourceFile(SAMPLE.replace('按音便分组', '按音便分三组'), 'a.md')[0];
  assert.notEqual(a.contentHash, b.contentHash);
});
