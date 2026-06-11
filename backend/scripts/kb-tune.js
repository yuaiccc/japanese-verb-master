// 命中率调参实验：
//   A) RRF 融合参数 k 的扫描（秒级，无 LLM）——看融合权重对 MRR/NDCG 的影响；
//   B) 查询改写 开/关 对命中率的影响（KB_TUNE_REWRITE=1 开启，需 LLM，对每个 query 调用一次改写）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import db from '../db.js';
import { ensureKnowledgeSchema } from '../knowledge/schema.js';
import { createEmbedder } from '../knowledge/embeddings.js';
import { createLocalRetriever } from '../knowledge/retriever.js';
import { getKnowledgeEmbeddingSettings } from '../knowledge/settings.js';
import { createKnowledgeChat } from '../knowledge/llm.js';
import { createQueryRewriter } from '../knowledge/rewrite.js';
import { scoreCase, summarize } from '../knowledge/eval.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
ensureKnowledgeSchema(db);
const embedder = createEmbedder(getKnowledgeEmbeddingSettings(db));
const { cases } = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'knowledge-source', 'golden-set.json'), 'utf8'));

async function evalQueries(retriever, queryOf) {
  const rows = [];
  for (const item of cases) {
    const q = await queryOf(item);
    const { results } = await retriever.queryRelevantDocuments(q, { topK: 10 });
    rows.push(scoreCase(results, item.expected));
  }
  return summarize(rows);
}

// A) RRF k 扫描
const kSweep = {};
for (const k of [10, 20, 40, 60, 100, 200]) {
  const retriever = createLocalRetriever({ db, embedder, mode: 'hybrid', rrfK: k });
  kSweep[`k=${k}`] = await evalQueries(retriever, (item) => item.query);
}
console.log('\n=== A) RRF 融合参数 k 扫描（hybrid, 50 题）===');
console.table(kSweep);

// B) 查询改写 开/关（可选）
if (process.env.KB_TUNE_REWRITE === '1') {
  const retriever = createLocalRetriever({ db, embedder, mode: 'hybrid', rrfK: 60 });
  const rewriter = createQueryRewriter({ chatFn: createKnowledgeChat() });
  const rewriteCache = new Map();
  const compare = {
    '改写关闭': await evalQueries(retriever, (item) => item.query),
    '改写开启': await evalQueries(retriever, async (item) => {
      if (!rewriteCache.has(item.query)) rewriteCache.set(item.query, (await rewriter.rewrite(item.query)).query);
      return rewriteCache.get(item.query);
    })
  };
  console.log('\n=== B) 查询改写 开/关（hybrid k=60, 50 题）===');
  console.table(compare);
} else {
  console.log('\n（B 查询改写对比已跳过；设 KB_TUNE_REWRITE=1 开启，需 LLM）');
}
