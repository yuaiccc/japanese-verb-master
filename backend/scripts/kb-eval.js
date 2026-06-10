import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import db from '../db.js';
import { ensureKnowledgeSchema } from '../knowledge/schema.js';
import { createEmbedder } from '../knowledge/embeddings.js';
import { createLocalRetriever } from '../knowledge/retriever.js';
import { getKnowledgeEmbeddingSettings } from '../knowledge/settings.js';
import { runEval } from '../knowledge/eval.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
ensureKnowledgeSchema(db);
const embedder = createEmbedder(getKnowledgeEmbeddingSettings(db));
const { cases } = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'knowledge-source', 'golden-set.json'), 'utf8'));
const results = await runEval({
  retrieverFactory: (mode) => createLocalRetriever({ db, embedder, mode }),
  cases
});
console.table(results);
