import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// @ts-ignore - better-sqlite3 has no bundled type declarations
import Database from 'better-sqlite3';
import { ensureKnowledgeSchema } from '../knowledge/schema';
import { ingestKnowledge } from '../knowledge/ingest';

const SRC = `---\ncategory: 活用\nlevel: N5\n---\n\n## て形\n\n规则A\n\n## た形\n\n规则B\n`;

function makeEmbedder(dim = 3) {
  let calls = 0;
  return {
    embedder: {
      model: 'fake', getDim: () => dim,
      async embed(texts: any[]) { calls += texts.length; return texts.map(() => Array(dim).fill(0.1)); }
    },
    getCalls: () => calls
  };
}

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-'));
  fs.writeFileSync(path.join(dir, 'verbs.md'), SRC);
  const db = new Database(':memory:');
  ensureKnowledgeSchema(db);
  return { dir, db };
}

test('first ingest adds all chunks with embeddings', async () => {
  const { dir, db } = setup();
  const { embedder, getCalls } = makeEmbedder();
  const report = await ingestKnowledge({ db, embedder, sourceDir: dir });
  assert.equal(report.added, 2);
  assert.equal(getCalls(), 2);
  assert.equal((db.prepare('SELECT COUNT(*) AS c FROM knowledge_chunks').get() as any).c, 2);
  assert.equal((db.prepare('SELECT COUNT(*) AS c FROM knowledge_fts').get() as any).c, 2);
});

test('second ingest with no changes embeds nothing', async () => {
  const { dir, db } = setup();
  const { embedder, getCalls } = makeEmbedder();
  await ingestKnowledge({ db, embedder, sourceDir: dir });
  const before = getCalls();
  const report = await ingestKnowledge({ db, embedder, sourceDir: dir });
  assert.equal(report.added, 0);
  assert.equal(report.unchanged, 2);
  assert.equal(getCalls(), before);
});

test('changed chunk re-embeds, removed chunk deleted', async () => {
  const { dir, db } = setup();
  const { embedder } = makeEmbedder();
  await ingestKnowledge({ db, embedder, sourceDir: dir });
  fs.writeFileSync(path.join(dir, 'verbs.md'), SRC.replace('规则A', '规则A改').replace('\n## た形\n\n规则B\n', ''));
  const report = await ingestKnowledge({ db, embedder, sourceDir: dir });
  assert.equal(report.updated, 1);
  assert.equal(report.removed, 1);
  assert.equal((db.prepare('SELECT COUNT(*) AS c FROM knowledge_chunks').get() as any).c, 1);
});

test('without embedder still indexes for BM25 (degraded build)', async () => {
  const { dir, db } = setup();
  const report = await ingestKnowledge({ db, embedder: null, sourceDir: dir });
  assert.equal(report.added, 2);
  assert.equal(report.embedded, 0);
  assert.equal((db.prepare('SELECT COUNT(*) AS c FROM knowledge_chunks WHERE has_embedding = 1').get() as any).c, 0);
});

test('later run backfills embeddings for unchanged chunks indexed while degraded', async () => {
  const { dir, db } = setup();
  await ingestKnowledge({ db, embedder: null, sourceDir: dir });
  const { embedder, getCalls } = makeEmbedder();
  const report = await ingestKnowledge({ db, embedder, sourceDir: dir });
  assert.equal(report.added, 0);
  assert.equal(report.unchanged, 2);
  assert.equal(report.embedded, 2);
  assert.equal(getCalls(), 2);
  assert.equal((db.prepare('SELECT COUNT(*) AS c FROM knowledge_chunks WHERE has_embedding = 1').get() as any).c, 2);
});
