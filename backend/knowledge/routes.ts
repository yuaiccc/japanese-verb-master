import { tokenizeForFts } from './tokenize';

export function registerKnowledgeRoutes(app: any, { db, retriever, reindexQueue, getEmbeddingSettings }: any): void {
  app.get('/api/knowledge/search', async (req: any, res: any) => {
    try {
      const q = String(req.query.q || '').trim();
      if (!q) return res.status(400).json({ error: 'q is required' });
      const topK = Math.min(parseInt(req.query.topK) || 5, 20);
      const { results, degraded } = await retriever.queryRelevantDocuments(q, {
        topK,
        level: String(req.query.level || ''),
        category: String(req.query.category || ''),
        resources: req.query.resources ? String(req.query.resources).split(',') : []
      });
      res.json({ query: q, degraded, results });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/knowledge/stats', (req: any, res: any) => {
    const { chunks } = db.prepare('SELECT COUNT(*) AS chunks FROM knowledge_chunks').get();
    const { embedded } = db.prepare('SELECT COUNT(*) AS embedded FROM knowledge_chunks WHERE has_embedding = 1').get();
    const settings = getEmbeddingSettings();
    res.json({
      chunks,
      embedded,
      resources: retriever.listResources(),
      reindexing: reindexQueue.isRunning(),
      embedding: { provider: settings.provider, model: settings.model }
    });
  });

  app.post('/api/knowledge/reindex', (req: any, res: any) => {
    reindexQueue.schedule();
    res.status(202).json({ scheduled: true });
  });

  app.post('/api/knowledge/chunks', (req: any, res: any) => {
    try {
      const { docId = 'custom', title = '', content = '', level = '', category = '', tags = [] } = req.body || {};
      if (!title.trim() || !content.trim()) return res.status(400).json({ error: 'title and content are required' });
      const insertChunk = db.prepare(`
        INSERT INTO knowledge_chunks (doc_id, resource, title, content, level, category, tags, source, content_hash, has_embedding)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'api', '', 0) RETURNING id
      `);
      const insertFts = db.prepare('INSERT INTO knowledge_fts (title, content_tokens, chunk_id) VALUES (?, ?, ?)');
      const { id } = db.transaction(() => {
        const row = insertChunk.get(docId, `kb://grammar/${docId}`, title.trim(), content.trim(), level, category, JSON.stringify(tags));
        insertFts.run(tokenizeForFts(title), tokenizeForFts(content), row.id);
        return row;
      })();
      reindexQueue.schedule();
      res.status(201).json({ id });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/knowledge/chunks/:id', (req: any, res: any) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!Number.isInteger(id)) {
        return res.status(400).json({ error: 'Invalid chunk id' });
      }
      const deleteChunk = db.prepare('DELETE FROM knowledge_chunks WHERE id = ?');
      const deleteFts = db.prepare('DELETE FROM knowledge_fts WHERE chunk_id = ?');
      const hasVec = !!db.prepare("SELECT name FROM sqlite_master WHERE name='knowledge_vec'").get();
      const info = db.transaction(() => {
        const result = deleteChunk.run(id);
        deleteFts.run(id);
        if (hasVec) {
          db.prepare('DELETE FROM knowledge_vec WHERE chunk_id = ?').run(BigInt(id));
        }
        return result;
      })();
      reindexQueue.schedule();
      res.status(info.changes ? 200 : 404).json({ deleted: info.changes > 0 });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
}
