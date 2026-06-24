// 知识库冒烟测试（CI 友好：无 Ollama/LLM 依赖）。
// 验证完整降级路径：kb:build 降级入库（FTS-only）→ BM25 检索命中目标条目。
import db from '../db';
import { ensureKnowledgeSchema } from '../knowledge/schema';
import { createLocalRetriever } from '../knowledge/retriever';

ensureKnowledgeSchema(db);

const { chunks } = db.prepare('SELECT COUNT(*) AS chunks FROM knowledge_chunks').get() as { chunks: number };
if (chunks < 100) {
  console.error(`[kb:smoke] FAIL: 索引仅 ${chunks} 块（预期 ≥100），kb:build 可能未执行`);
  process.exit(1);
}

const retriever = createLocalRetriever({ db, embedder: null, mode: 'bm25' });
const checks = [
  { query: 'て形 变化 规则', expect: 'て形的变化规则' },
  { query: '敬语 尊敬语 谦让语', expect: '敬语体系总览（尊敬语・谦让语・丁宁语）' },
  { query: 'ながら', expect: 'ながら' }
];

let failed = 0;
for (const { query, expect } of checks) {
  const { results } = await retriever.queryRelevantDocuments(query, { topK: 5 });
  const hit = results.some((r: any) => r.title === expect);
  console.log(`[kb:smoke] ${hit ? 'PASS' : 'FAIL'}: "${query}" → ${results.map((r: any) => r.title).join(' | ') || '(无结果)'}`);
  if (!hit) failed++;
}

if (failed > 0) {
  console.error(`[kb:smoke] ${failed}/${checks.length} 条冒烟检索未命中`);
  process.exit(1);
}
console.log(`[kb:smoke] 全部通过（${chunks} chunks，BM25 降级路径正常）`);
