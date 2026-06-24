// 端到端答案质量评测：在「在域内 golden 子集 + 离题对抗集」上，对比三种生成配置，
// 量化 引用覆盖率 / 忠实度 / 幻觉率 / 拒答率 的"优化前后"。
//   baseline       —— 仅约束"依据上下文"，不拒答、不强制引用
//   +abstain       —— 加两道防幻觉闸门（距离预过滤 + LLM gatekeeper）
//   +abstain+cite  —— 再叠加强制逐句引用
// 样本量可调：KB_EVAL_SAMPLE=12（在域内抽样数，离题集全量）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import db from '../db';
import { ensureKnowledgeSchema } from '../knowledge/schema';
import { createEmbedder } from '../knowledge/embeddings';
import { createLocalRetriever } from '../knowledge/retriever';
import { getKnowledgeEmbeddingSettings } from '../knowledge/settings';
import { createKnowledgeChat } from '../knowledge/llm';
import { createAnswerer } from '../knowledge/answer';
import { createFaithfulnessJudge, summarizeFaithfulness } from '../knowledge/faithfulness';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (f: string) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'knowledge-source', f), 'utf8'));

ensureKnowledgeSchema(db);
const embedder = createEmbedder(getKnowledgeEmbeddingSettings(db));
const chatFn = createKnowledgeChat();
const retriever = createLocalRetriever({ db, embedder, mode: 'hybrid' });
const judge = createFaithfulnessJudge({ chatFn });

// 在域内均匀抽样，覆盖各分类
const sampleSize = Number(process.env.KB_EVAL_SAMPLE || 12);
const golden = read('golden-set.json').cases;
const step = Math.max(1, Math.floor(golden.length / sampleSize));
const inScope = golden.filter((_: any, i: number) => i % step === 0).slice(0, sampleSize).map((c: any) => ({ query: c.query, adversarial: false }));
const adversarial = read('adversarial-set.json').cases.map((c: any) => ({ query: c.query, adversarial: true }));
const questions = [...inScope, ...adversarial];

const configs: Record<string, any> = {
  baseline: { abstain: false, forceCitation: false },
  '+abstain': { abstain: true, forceCitation: false },
  '+abstain+cite': { abstain: true, forceCitation: true }
};

const report: any = {};
for (const [name, cfg] of Object.entries(configs)) {
  const answerer = createAnswerer({ chatFn, retriever, topK: 5, distanceThreshold: 1.0, ...cfg });
  const inRows: any[] = [];
  const advRows: any[] = [];
  for (const q of questions) {
    const a = await answerer.answer(q.query);
    const j = await judge.judge({ query: q.query, answer: a.answer, contextChunks: a.contextChunks, abstained: a.abstained });
    (q.adversarial ? advRows : inRows).push({ ...j, abstained: a.abstained });
  }
  const inSum = summarizeFaithfulness(inRows);
  const advAbstain = advRows.filter((r: any) => r.abstained).length;
  const advSum = summarizeFaithfulness(advRows);
  report[name] = {
    '域内·引用覆盖率': inSum.citationCoverage,
    '域内·忠实度': inSum.faithfulness,
    '域内·幻觉率': inSum.hallucinationRate,
    '离题·拒答率': +(advAbstain / Math.max(advRows.length, 1)).toFixed(3),
    '离题·幻觉率': advSum.hallucinationRate
  };
  console.error(`[done] ${name}  域内${inRows.length}题 / 离题${advRows.length}题`);
}

console.log(`\n样本：在域内 ${inScope.length} 题 + 离题对抗 ${adversarial.length} 题\n`);
console.table(report);
