import { tokenizeForFts } from './tokenize';
import { loadVecExtension } from './schema';

export function rrfFuse(rankedLists: any[][], k: number = 60): any[] {
  const scores = new Map();
  for (const list of rankedLists) {
    list.forEach((item: any, rank: number) => {
      const entry = scores.get(item.id) || { ...item, score: 0 };
      entry.score += 1 / (k + rank + 1);
      scores.set(item.id, entry);
    });
  }
  return [...scores.values()].sort((a: any, b: any) => b.score - a.score);
}

const RECALL_PER_LEG = 20;

export function createLocalRetriever({ db, embedder, mode = 'hybrid', reranker = null, rrfK = 60, metrics = null }: any): any {
  loadVecExtension(db);

  const hasVecTable = () => !!db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='knowledge_vec'"
  ).get();

  function hydrate(rows: any[], filters: any): any[] {
    const out: any[] = [];
    for (const row of rows) {
      const chunk = db.prepare(
        'SELECT id, doc_id, resource, title, content, level, category FROM knowledge_chunks WHERE id = ?'
      ).get(row.id);
      if (!chunk) continue;
      if (filters.level && chunk.level !== filters.level) continue;
      if (filters.category && chunk.category !== filters.category) continue;
      if (filters.resources?.length && !filters.resources.includes(chunk.resource)) continue;
      out.push({ ...chunk, docId: chunk.doc_id, score: row.score ?? 0, distance: row.distance ?? null });
    }
    return out;
  }

  function bm25Leg(query: string): any[] {
    const ftsQuery = tokenizeForFts(query).split(' ').filter(Boolean).map((t: string) => `"${t.replace(/"/g, '""')}"`).join(' OR ');
    if (!ftsQuery) return [];
    // 标题列权重 2.0：条目标题即语法点名称，命中标题的相关性高于命中正文
    //（65 题扫描：w=2~5 MRR +0.002，w=8 开始回落，取保守值）
    return db.prepare(`
      SELECT chunk_id AS id, bm25(knowledge_fts, 2.0, 1.0) AS rank
      FROM knowledge_fts WHERE knowledge_fts MATCH ? ORDER BY rank LIMIT ?
    `).all(ftsQuery, RECALL_PER_LEG);
  }

  async function vectorLeg(query: string): Promise<any[] | null> {
    if (!embedder || !hasVecTable()) return null;
    const [vector] = await embedder.embed([query]);
    return db.prepare(`
      SELECT chunk_id AS id, distance FROM knowledge_vec
      WHERE embedding MATCH ? ORDER BY distance LIMIT ?
    `).all(JSON.stringify(vector), RECALL_PER_LEG);
  }

  return {
    listResources(): any[] {
      return db.prepare(`
        SELECT resource AS uri, doc_id AS docId, COUNT(*) AS chunks, MAX(category) AS category
        FROM knowledge_chunks GROUP BY resource ORDER BY resource
      `).all();
    },
    async queryRelevantDocuments(query: string, { topK = 5, resources = [], level = '', category = '', rerank = false }: any = {}): Promise<any> {
      const filters = { resources, level, category };
      const startedAt = Date.now();
      let degraded = false;
      let vectorHits = 0;
      let bm25Hits = 0;
      const legs: any[][] = [];

      // 并发召回：向量腿（embedding 为网络调用）先发起返回 pending promise，
      // BM25（同步 SQL）在其网络往返期间"免费"执行，缩短两腿串行的总延迟。
      const vecPromise = mode !== 'bm25' ? vectorLeg(query).catch(() => null) : null;
      if (mode !== 'vector') {
        const bm25Rows = bm25Leg(query);
        bm25Hits = bm25Rows.length;
        legs.push(bm25Rows);
      }
      if (vecPromise) {
        const vecRows = await vecPromise;
        if (Array.isArray(vecRows)) {
          vectorHits = vecRows.length;
          legs.push(vecRows);
        } else {
          degraded = true;
        }
      }

      const fused = rrfFuse(legs, rrfK);
      const hydrated = hydrate(fused, filters);
      const topVectorDistance = hydrated.length > 0
        ? hydrated.reduce((min: any, r: any) => (r.distance != null ? Math.min(min ?? Infinity, r.distance) : min), null)
        : null;

      // 第三段：LLM 精排（可选，默认关）。reranker 内部对任何失败都降级为融合顺序，
      // applied 如实反映精排是否真正生效。
      let reranked = false;
      let results;
      if (rerank && reranker?.enabled) {
        const { items, applied } = await reranker.rerank(query, hydrated, { topK });
        results = items;
        reranked = applied;
      } else {
        results = hydrated.slice(0, topK);
      }

      metrics?.record({ latencyMs: Date.now() - startedAt, mode, vectorHits, bm25Hits, degraded, reranked });
      return { results, degraded, reranked, topVectorDistance };
    }
  };
}

export function createRetriever({ db, embedder, ragProvider = 'local', reranker = null, metrics = null }: any): any {
  // provider 抽象：目前仅 local；ragflow 等外部 provider 预留在此接入
  if (ragProvider !== 'local') {
    console.warn(`[knowledge] unknown rag provider "${ragProvider}", falling back to local`);
  }
  return createLocalRetriever({ db, embedder, reranker, metrics });
}
