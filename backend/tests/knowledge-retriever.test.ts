import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { ensureKnowledgeSchema } from '../knowledge/schema';
import { ingestKnowledge } from '../knowledge/ingest';
import { createLocalRetriever, rrfFuse } from '../knowledge/retriever';

const SRC = `---\ncategory: 活用\nlevel: N5\n---\n\n## て形\n\nて形连接动作，食べる变食べて。\n\n## 可能形\n\n可能形表示能力，食べる变食べられる。\n`;

function vecFor(text: string): number[] {
  // 确定性 fake embedding：「て形」相关文本第一维高
  return text.includes('て形') || text.includes('te') ? [1, 0] : [0, 1];
}

const fakeEmbedder = {
  model: 'fake', getDim: () => 2,
  async embed(texts: string[]) { return texts.map(vecFor); }
};

async function buildDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-'));
  fs.writeFileSync(path.join(dir, 'verbs.md'), SRC);
  const db = new Database(':memory:');
  ensureKnowledgeSchema(db);
  await ingestKnowledge({ db, embedder: fakeEmbedder, sourceDir: dir });
  return db;
}

test('rrfFuse merges two ranked lists', () => {
  const fused = rrfFuse([[{ id: 1 }, { id: 2 }], [{ id: 2 }, { id: 3 }]], 60);
  assert.equal(fused[0].id, 2); // 两路都命中者居首
  assert.equal(fused.length, 3);
});

test('hybrid query returns te-form chunk first', async () => {
  const db = await buildDb();
  const retriever = createLocalRetriever({ db, embedder: fakeEmbedder });
  const { results, degraded } = await retriever.queryRelevantDocuments('て形 怎么变', { topK: 2 });
  assert.equal(degraded, false);
  assert.equal(results[0].title, 'て形');
  assert.ok(results[0].score > 0);
});

test('degrades to bm25 when embedder fails', async () => {
  const db = await buildDb();
  const broken = { model: 'fake', getDim: () => 2, async embed() { throw new Error('down'); } };
  const retriever = createLocalRetriever({ db, embedder: broken });
  const { results, degraded } = await retriever.queryRelevantDocuments('可能形', { topK: 2 });
  assert.equal(degraded, true);
  assert.equal(results[0].title, '可能形');
});

test('level filter narrows results and listResources reports docs', async () => {
  const db = await buildDb();
  const retriever = createLocalRetriever({ db, embedder: fakeEmbedder });
  const resources = retriever.listResources();
  assert.deepEqual(resources.map((r: any) => r.uri), ['kb://grammar/verbs']);
  const { results } = await retriever.queryRelevantDocuments('て形', { level: 'N1' });
  assert.equal(results.length, 0);
});
