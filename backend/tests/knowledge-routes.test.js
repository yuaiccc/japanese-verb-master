import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { ensureKnowledgeSchema } from '../knowledge/schema.js';
import { ingestKnowledge } from '../knowledge/ingest.js';
import { registerKnowledgeRoutes } from '../knowledge/routes.js';
import { createLocalRetriever } from '../knowledge/retriever.js';

const SRC = `---\ncategory: 活用\nlevel: N5\n---\n\n## て形\n\nて形连接动作。\n`;

async function makeApp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-'));
  fs.writeFileSync(path.join(dir, 'verbs.md'), SRC);
  const db = new Database(':memory:');
  ensureKnowledgeSchema(db);
  await ingestKnowledge({ db, embedder: null, sourceDir: dir });
  const app = express();
  app.use(express.json());
  let reindexCalls = 0;
  registerKnowledgeRoutes(app, {
    db,
    retriever: createLocalRetriever({ db, embedder: null }),
    reindexQueue: { schedule: () => { reindexCalls += 1; }, isRunning: () => false },
    getEmbeddingSettings: () => ({ provider: 'ollama', model: 'bge-m3' })
  });
  const server = app.listen(0);
  const base = `http://localhost:${server.address().port}`;
  return { base, db, server, getReindexCalls: () => reindexCalls };
}

test('GET /api/knowledge/search returns hits', async () => {
  const { base, server } = await makeApp();
  const res = await fetch(`${base}/api/knowledge/search?q=て形`);
  const data = await res.json();
  assert.equal(res.status, 200);
  assert.equal(data.results[0].title, 'て形');
  assert.equal(data.degraded, true);
  server.close();
});

test('GET /api/knowledge/stats reports counts', async () => {
  const { base, server } = await makeApp();
  const data = await (await fetch(`${base}/api/knowledge/stats`)).json();
  assert.equal(data.chunks, 1);
  assert.equal(data.embedded, 0);
  assert.equal(data.embedding.model, 'bge-m3');
  server.close();
});

test('POST /api/knowledge/reindex schedules queue', async () => {
  const { base, server, getReindexCalls } = await makeApp();
  const res = await fetch(`${base}/api/knowledge/reindex`, { method: 'POST' });
  assert.equal(res.status, 202);
  assert.equal(getReindexCalls(), 1);
  server.close();
});

test('chunk CRUD roundtrip schedules reindex', async () => {
  const { base, server, db, getReindexCalls } = await makeApp();
  const created = await (await fetch(`${base}/api/knowledge/chunks`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ docId: 'custom', title: '自定义条目', content: '内容', level: 'N4', category: '句型' })
  })).json();
  assert.ok(created.id);
  const del = await fetch(`${base}/api/knowledge/chunks/${created.id}`, { method: 'DELETE' });
  assert.equal(del.status, 200);
  assert.equal(getReindexCalls(), 2);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM knowledge_chunks WHERE doc_id='custom'").get().c, 0);
  server.close();
});
