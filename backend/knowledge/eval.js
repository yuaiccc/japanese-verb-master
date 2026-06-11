// expected 支持字符串或数组：语料扩容后一道题可能存在多个同等合理的条目
// （如「つもり」既匹配句型条目也匹配辨析条目），取排名最靠前的可接受答案计分。
export function scoreCase(hits, expected) {
  const accepted = new Set(Array.isArray(expected) ? expected : [expected]);
  const index = hits.findIndex(h => accepted.has(`${h.docId}::${h.title}`));
  if (index === -1) return { rank: null, rr: 0 };
  return { rank: index + 1, rr: 1 / (index + 1) };
}

export function summarize(rows) {
  const total = rows.length;
  const atK = (k) => `${rows.filter(r => r.rank !== null && r.rank <= k).length}/${total}`;
  const mrr = rows.reduce((sum, r) => sum + r.rr, 0) / Math.max(total, 1);
  // golden set 每题单一相关条目 ⇒ IDCG@k = 1（相关项在 rank1 时 DCG=1）。
  // 故 NDCG@k 退化为 命中 k 内时 1/log2(rank+1)，否则 0。指标名与行业一致，便于对比。
  const ndcgAt = (k) => rows.reduce(
    (sum, r) => sum + (r.rank !== null && r.rank <= k ? 1 / Math.log2(r.rank + 1) : 0),
    0
  ) / Math.max(total, 1);
  return {
    'recall@1': atK(1),
    'recall@3': atK(3),
    'recall@5': atK(5),
    mrr: mrr.toFixed(3),
    'ndcg@10': ndcgAt(10).toFixed(3)
  };
}

// mode: 'hybrid' | 'vector' | 'bm25'，由 createLocalRetriever 的 mode 参数控制。
// withRerank=true 时额外跑一档 'hybrid+rerank'（需 retrieverFactory 构造的 retriever 带 reranker）。
export async function runEval({ retrieverFactory, cases, topK = 10, withRerank = false }) {
  const output = {};
  const run = async (mode, queryOpts = {}) => {
    const retriever = retrieverFactory(mode);
    const rows = [];
    for (const item of cases) {
      const { results } = await retriever.queryRelevantDocuments(item.query, { topK, ...queryOpts });
      rows.push(scoreCase(results, item.expected));
    }
    return summarize(rows);
  };

  output.bm25 = await run('bm25');
  output.vector = await run('vector');
  output.hybrid = await run('hybrid');
  if (withRerank) {
    output['hybrid+rerank'] = await run('hybrid', { rerank: true });
  }
  return output;
}
