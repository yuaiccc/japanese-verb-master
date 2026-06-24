import * as sqliteVec from 'sqlite-vec';

let vecLoaded = new WeakSet();

export function loadVecExtension(db) {
  if (vecLoaded.has(db)) return true;
  try {
    sqliteVec.load(db);
    vecLoaded.add(db);
    return true;
  } catch (error) {
    console.warn('[knowledge] sqlite-vec load failed, vector search disabled:', error.message);
    return false;
  }
}

export function ensureKnowledgeSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS knowledge_chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      doc_id TEXT NOT NULL,
      resource TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      level TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT '',
      tags TEXT NOT NULL DEFAULT '[]',
      source TEXT NOT NULL DEFAULT '',
      content_hash TEXT NOT NULL,
      embedding_model TEXT NOT NULL DEFAULT '',
      has_embedding INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(doc_id, title)
    );
    CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_doc ON knowledge_chunks(doc_id);
    CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(
      title, content_tokens, chunk_id UNINDEXED, tokenize='unicode61'
    );
  `);
}

// vec0 虚拟表维度建表时固定，因此在首次拿到 embedding 维度后创建。
// 维度变化（换模型）时需要重建：删表重嵌由 ingest 负责。
export function ensureVecTable(db, dim) {
  if (!loadVecExtension(db)) return false;
  if (!Number.isInteger(dim) || dim <= 0) return false;
  const existing = db.prepare(
    "SELECT name, sql FROM sqlite_master WHERE type='table' AND name='knowledge_vec'"
  ).get();
  if (existing) {
    const match = String(existing.sql || '').match(/float\[(\d+)\]/);
    const existingDim = match ? parseInt(match[1], 10) : null;
    if (existingDim !== dim) {
      console.warn(`[knowledge] knowledge_vec dimension mismatch (existing=${existingDim}, expected=${dim}), rebuilding table`);
      dropVecTable(db);
    } else {
      return true;
    }
  }
  db.exec(`CREATE VIRTUAL TABLE knowledge_vec USING vec0(chunk_id INTEGER PRIMARY KEY, embedding float[${dim}])`);
  return true;
}

export function dropVecTable(db) {
  db.exec('DROP TABLE IF EXISTS knowledge_vec');
}
