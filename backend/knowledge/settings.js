const DEFAULTS = {
  provider: 'ollama',
  model: 'bge-m3',
  baseUrl: 'http://localhost:11434',
  apiKey: '',
  ragProvider: 'local'
};

export function getKnowledgeEmbeddingSettings(db) {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get('knowledge_embedding');
  if (!row) return { ...DEFAULTS };
  try { return { ...DEFAULTS, ...JSON.parse(row.value) }; } catch { return { ...DEFAULTS }; }
}

export function saveKnowledgeEmbeddingSettings(db, patch = {}) {
  const next = { ...getKnowledgeEmbeddingSettings(db), ...patch };
  db.prepare(`
    INSERT INTO app_settings (key, value, updated_at) VALUES ('knowledge_embedding', ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
  `).run(JSON.stringify(next));
  return next;
}
