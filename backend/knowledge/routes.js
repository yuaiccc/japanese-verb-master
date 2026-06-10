import { tokenizeForFts } from './tokenize.js';

export function registerKnowledgeRoutes(app, { db, retriever, reindexQueue, getEmbeddingSettings }) {
  app.get('/api/knowledge/search', async (req, res) => {
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
  });

  app.get('/api/knowledge/stats', (req, res) => {
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

  app.post('/api/knowledge/reindex', (req, res) => {
    reindexQueue.schedule();
    res.status(202).json({ scheduled: true });
  });

  app.post('/api/knowledge/chunks', (req, res) => {
    const { docId = 'custom', title = '', content = '', level = '', category = '', tags = [] } = req.body || {};
    if (!title.trim() || !content.trim()) return res.status(400).json({ error: 'title and content are required' });
    const { id } = db.prepare(`
      INSERT INTO knowledge_chunks (doc_id, resource, title, content, level, category, tags, source, content_hash, has_embedding)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'api', '', 0) RETURNING id
    `).get(docId, `kb://grammar/${docId}`, title.trim(), content.trim(), level, category, JSON.stringify(tags));
    db.prepare('INSERT INTO knowledge_fts (title, content_tokens, chunk_id) VALUES (?, ?, ?)')
      .run(tokenizeForFts(title), tokenizeForFts(content), id);
    reindexQueue.schedule();
    res.status(201).json({ id });
  });

  app.delete('/api/knowledge/chunks/:id', (req, res) => {
    const id = parseInt(req.params.id);
    const info = db.prepare('DELETE FROM knowledge_chunks WHERE id = ?').run(id);
    db.prepare('DELETE FROM knowledge_fts WHERE chunk_id = ?').run(id);
    if (db.prepare("SELECT name FROM sqlite_master WHERE name='knowledge_vec'").get()) {
      db.prepare('DELETE FROM knowledge_vec WHERE chunk_id = ?').run(BigInt(id));
    }
    reindexQueue.schedule();
    res.status(info.changes ? 200 : 404).json({ deleted: info.changes > 0 });
  });
}
