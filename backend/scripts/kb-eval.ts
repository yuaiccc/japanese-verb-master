import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import db from '../db';
import { ensureKnowledgeSchema } from '../knowledge/schema';
import { createEmbedder } from '../knowledge/embeddings';
import { createLocalRetriever } from '../knowledge/retriever';
import { createReranker } from '../knowledge/rerank';
import { createKnowledgeChat } from '../knowledge/llm';
import { getKnowledgeEmbeddingSettings } from '../knowledge/settings';
import { runEval } from '../knowledge/eval';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
ensureKnowledgeSchema(db);
const embedder = createEmbedder(getKnowledgeEmbeddingSettings(db));
const reranker = createReranker({ chatFn: createKnowledgeChat() });
const { cases } = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'knowledge-source', 'golden-set.json'), 'utf8'));
const results = await runEval({
  retrieverFactory: (mode: string) => createLocalRetriever({ db, embedder, mode, reranker }),
  cases,
  withRerank: process.env.KB_EVAL_RERANK !== '0' // CI 等无 LLM 环境可关掉精排档
});
console.table(results);

// 评测历史存档：追加到 eval-history.jsonl（timestamp + git sha + 语料规模 + 指标），
// 让"语料扩容/调参后指标怎么变"可追溯，而不是跑完即丢。
const sha = (() => {
  try { return execSync('git rev-parse --short HEAD', { cwd: __dirname }).toString().trim(); } catch { return 'unknown'; }
})();
const { chunks } = db.prepare('SELECT COUNT(*) AS chunks FROM knowledge_chunks').get() as { chunks: number };
const record = { ts: new Date().toISOString(), gitSha: sha, chunks, cases: cases.length, results };
const historyPath = path.join(__dirname, '..', 'eval-history.jsonl');
fs.appendFileSync(historyPath, JSON.stringify(record) + '\n');
console.log(`\n[kb:eval] 已存档 → ${path.relative(process.cwd(), historyPath)}（${sha} · ${chunks} chunks · ${cases.length} cases）`);
