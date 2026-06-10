import path from 'node:path';
import { fileURLToPath } from 'node:url';
import db from '../db.js';
import { ensureKnowledgeSchema } from '../knowledge/schema.js';
import { createEmbedder } from '../knowledge/embeddings.js';
import { ingestKnowledge } from '../knowledge/ingest.js';
import { getKnowledgeEmbeddingSettings } from '../knowledge/settings.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sourceDir = path.join(__dirname, '..', 'knowledge-source');
const noEmbed = process.argv.includes('--no-embed');

ensureKnowledgeSchema(db);
const settings = getKnowledgeEmbeddingSettings(db);
let embedder = null;
if (!noEmbed) {
  embedder = createEmbedder(settings);
  try {
    await embedder.embed(['ping']);
  } catch (error) {
    console.warn(`[kb:build] embedding 服务不可用（${error.message}），以 --no-embed 模式继续（仅 BM25）`);
    embedder = null;
  }
}
const report = await ingestKnowledge({ db, embedder, sourceDir });
console.log('[kb:build]', JSON.stringify(report, null, 2));
if (report.failed.length > 0) process.exitCode = 1;
