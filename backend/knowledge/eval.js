export function scoreCase(hits, expected) {
  const index = hits.findIndex(h => `${h.docId}::${h.title}` === expected);
  if (index === -1) return { rank: null, rr: 0 };
  return { rank: index + 1, rr: 1 / (index + 1) };
}

export function summarize(rows) {
  const total = rows.length;
  const atK = (k) => `${rows.filter(r => r.rank !== null && r.rank <= k).length}/${total}`;
  const mrr = rows.reduce((sum, r) => sum + r.rr, 0) / Math.max(total, 1);
  return { 'recall@1': atK(1), 'recall@3': atK(3), 'recall@5': atK(5), mrr: mrr.toFixed(3) };
}

// mode: 'hybrid' | 'vector' | 'bm25'。
// 单路模式由 createLocalRetriever 的 mode 参数控制（见 retriever.js）。
export async function runEval({ retrieverFactory, cases, topK = 5 }) {
  const modes = ['hybrid', 'vector', 'bm25'];
  const output = {};
  for (const mode of modes) {
    const retriever = retrieverFactory(mode);
    const rows = [];
    for (const item of cases) {
      const { results } = await retriever.queryRelevantDocuments(item.query, { topK });
      rows.push(scoreCase(results, item.expected));
    }
    output[mode] = summarize(rows);
  }
  return output;
}
