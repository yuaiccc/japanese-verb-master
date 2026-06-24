import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { ensureKnowledgeSchema, ensureVecTable } from '../knowledge/schema';

function tableNames(db: any): string[] {
  return db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view')").all().map((r: any) => r.name);
}

test('ensureKnowledgeSchema creates chunks + fts tables', () => {
  const db = new Database(':memory:');
  ensureKnowledgeSchema(db);
  const names = tableNames(db);
  assert.ok(names.includes('knowledge_chunks'));
  assert.ok(names.includes('knowledge_fts'));
  db.close();
});

test('ensureVecTable creates vec0 table with given dim and records it', () => {
  const db = new Database(':memory:');
  ensureKnowledgeSchema(db);
  const created = ensureVecTable(db, 4);
  assert.equal(created, true);
  assert.ok(tableNames(db).includes('knowledge_vec'));
  // 再次调用同维度幂等
  assert.equal(ensureVecTable(db, 4), true);
  db.close();
});
