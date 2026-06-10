import fs from 'node:fs';
import path from 'node:path';
import { parseSourceFile } from './parse.js';
import { tokenizeForFts } from './tokenize.js';
import { ensureVecTable } from './schema.js';

const EMBED_BATCH = 16;

export async function ingestKnowledge({ db, embedder, sourceDir }) {
  const report = { added: 0, updated: 0, removed: 0, unchanged: 0, embedded: 0, failed: [] };
  const files = fs.readdirSync(sourceDir).filter(f => f.endsWith('.md'));
  const incoming = files.flatMap(f => parseSourceFile(fs.readFileSync(path.join(sourceDir, f), 'utf8'), f));

  const existing = new Map(
    db.prepare('SELECT id, doc_id, title, content_hash FROM knowledge_chunks').all()
      .map(row => [`${row.doc_id} ${row.title}`, row])
  );

  const toEmbed = [];
  const upsert = db.prepare(`
    INSERT INTO knowledge_chunks (doc_id, resource, title, content, level, category, tags, source, content_hash, embedding_model, has_embedding, updated_at)
    VALUES (@docId, @resource, @title, @content, @level, @category, @tags, @source, @contentHash, '', 0, datetime('now'))
    ON CONFLICT(doc_id, title) DO UPDATE SET
      content=excluded.content, level=excluded.level, category=excluded.category, tags=excluded.tags,
      source=excluded.source, content_hash=excluded.content_hash, has_embedding=0, updated_at=datetime('now')
    RETURNING id
  `);
  const insertFts = db.prepare('INSERT INTO knowledge_fts (title, content_tokens, chunk_id) VALUES (?, ?, ?)');
  const deleteFts = db.prepare('DELETE FROM knowledge_fts WHERE chunk_id = ?');
  const deleteChunk = db.prepare('DELETE FROM knowledge_chunks WHERE id = ?');

  const seen = new Set();
  const applyChunks = db.transaction(() => {
    for (const chunk of incoming) {
      const key = `${chunk.docId} ${chunk.title}`;
      seen.add(key);
      const prior = existing.get(key);
      if (prior && prior.content_hash === chunk.contentHash) {
        report.unchanged += 1;
        continue;
      }
      const { id } = upsert.get({ ...chunk, tags: JSON.stringify(chunk.tags) });
      deleteFts.run(id);
      insertFts.run(tokenizeForFts(chunk.title), tokenizeForFts(chunk.content), id);
      toEmbed.push({ id, text: `${chunk.title}\n${chunk.content}` });
      if (prior) report.updated += 1; else report.added += 1;
    }
    for (const [key, row] of existing) {
      if (seen.has(key)) continue;
      deleteChunk.run(row.id);
      deleteFts.run(row.id);
      report.removed += 1;
    }
  });
  applyChunks();

  if (embedder && toEmbed.length > 0) {
    const markEmbedded = db.prepare('UPDATE knowledge_chunks SET has_embedding = 1, embedding_model = ? WHERE id = ?');
    let deleteVec = null;
    let insertVec = null;
    for (let i = 0; i < toEmbed.length; i += EMBED_BATCH) {
      const batch = toEmbed.slice(i, i + EMBED_BATCH);
      try {
        const vectors = await embedder.embed(batch.map(item => item.text));
        const dim = vectors[0]?.length;
        if (!ensureVecTable(db, dim)) break;
        // vec0 表在首次拿到维度后才建，故语句延迟到此处准备
        if (!deleteVec) deleteVec = db.prepare('DELETE FROM knowledge_vec WHERE chunk_id = ?');
        if (!insertVec) insertVec = db.prepare('INSERT INTO knowledge_vec (chunk_id, embedding) VALUES (?, ?)');
        const writeVecBatch = db.transaction(() => {
          batch.forEach((item, j) => {
            deleteVec.run(BigInt(item.id));
            insertVec.run(BigInt(item.id), JSON.stringify(vectors[j]));
            markEmbedded.run(embedder.model, item.id);
            report.embedded += 1;
          });
        });
        writeVecBatch();
      } catch (error) {
        report.failed.push({ ids: batch.map(b => b.id), error: error.message });
      }
    }
  }
  return report;
}
