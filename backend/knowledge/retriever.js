import { tokenizeForFts } from './tokenize.js';
import { loadVecExtension } from './schema.js';

export function rrfFuse(rankedLists, k = 60) {
  const scores = new Map();
  for (const list of rankedLists) {
    list.forEach((item, rank) => {
      const entry = scores.get(item.id) || { ...item, score: 0 };
      entry.score += 1 / (k + rank + 1);
      scores.set(item.id, entry);
    });
  }
  return [...scores.values()].sort((a, b) => b.score - a.score);
}

const RECALL_PER_LEG = 20;

export function createLocalRetriever({ db, embedder, mode = 'hybrid' }) {
  loadVecExtension(db);

  const hasVecTable = () => !!db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='knowledge_vec'"
  ).get();

  function hydrate(rows, filters) {
    const out = [];
    for (const row of rows) {
      const chunk = db.prepare(
        'SELECT id, doc_id, resource, title, content, level, category FROM knowledge_chunks WHERE id = ?'
      ).get(row.id);
      if (!chunk) continue;
      if (filters.level && chunk.level !== filters.level) continue;
      if (filters.category && chunk.category !== filters.category) continue;
      if (filters.resources?.length && !filters.resources.includes(chunk.resource)) continue;
      out.push({ ...chunk, docId: chunk.doc_id, score: row.score ?? 0 });
    }
    return out;
  }

  function bm25Leg(query) {
    const ftsQuery = tokenizeForFts(query).split(' ').filter(Boolean).map(t => `"${t}"`).join(' OR ');
    if (!ftsQuery) return [];
    return db.prepare(`
      SELECT chunk_id AS id, bm25(knowledge_fts) AS rank
      FROM knowledge_fts WHERE knowledge_fts MATCH ? ORDER BY rank LIMIT ?
    `).all(ftsQuery, RECALL_PER_LEG);
  }

  async function vectorLeg(query) {
    if (!embedder || !hasVecTable()) return null;
    const [vector] = await embedder.embed([query]);
    return db.prepare(`
      SELECT chunk_id AS id, distance FROM knowledge_vec
      WHERE embedding MATCH ? ORDER BY distance LIMIT ?
    `).all(JSON.stringify(vector), RECALL_PER_LEG);
  }

  return {
    listResources() {
      return db.prepare(`
        SELECT resource AS uri, doc_id AS docId, COUNT(*) AS chunks, MAX(category) AS category
        FROM knowledge_chunks GROUP BY resource ORDER BY resource
      `).all();
    },
    async queryRelevantDocuments(query, { topK = 5, resources = [], level = '', category = '' } = {}) {
      const filters = { resources, level, category };
      let degraded = false;
      const legs = [];
      if (mode !== 'bm25') {
        let vecRows = null;
        try {
          vecRows = await vectorLeg(query);
        } catch {
          degraded = true;
        }
        if (Array.isArray(vecRows)) legs.push(vecRows);
        else degraded = true;
      }
      if (mode !== 'vector') {
        legs.push(bm25Leg(query));
      }
      const fused = rrfFuse(legs);
      return { results: hydrate(fused, filters).slice(0, topK), degraded };
    }
  };
}

export function createRetriever({ db, embedder, ragProvider = 'local' }) {
  // provider 抽象：目前仅 local；ragflow 等外部 provider 预留在此接入
  if (ragProvider !== 'local') {
    console.warn(`[knowledge] unknown rag provider "${ragProvider}", falling back to local`);
  }
  return createLocalRetriever({ db, embedder });
}
