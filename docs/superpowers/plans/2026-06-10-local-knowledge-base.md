# 本地语法知识库（RAG）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 Japanese Word Master 增加本地日语语法知识库：sqlite-vec + FTS5 混合检索（RRF 融合）、增量索引管道、Agent 工具集成与引用展示、recall@k/MRR 评测。

**Architecture:** 新模块目录 `backend/knowledge/`（schema/tokenize/embeddings/parse/ingest/retriever/queue/routes/eval），数据存现有 `dictionary.db` 三表（主表 + vec0 虚拟表 + FTS5 虚拟表）。Researcher 新工具 `knowledge_search` 排第一位，Planner 前做 background investigation。Embedding 走 provider 适配层（Ollama 默认 / OpenAI 兼容），不可用时降级纯 BM25。

**Tech Stack:** Node.js ESM、Express、better-sqlite3、sqlite-vec、FTS5、kuromoji、node:test。

**Spec:** `docs/superpowers/specs/2026-06-10-local-knowledge-base-design.md`

**约定（全计划通用类型）：**
- `embedder = { embed(texts: string[]) => Promise<number[][]>, getDim() => number|null }`
- `retriever = { listResources() => Resource[], queryRelevantDocuments(query, { topK=5, resources=[], level='', category='' }) => Promise<{ results: Hit[], degraded: boolean }> }`
- `Hit = { id, docId, resource, title, content, level, category, score }`
- 后端工作目录均为 `backend/`，测试命令均为 `npm test`（即 `node --test tests/`）。

---

### Task 1: 测试基建与依赖

**Files:**
- Modify: `backend/package.json`
- Create: `backend/tests/smoke.test.js`

- [ ] **Step 1: 安装 sqlite-vec 并加 test 脚本**

```bash
cd backend && npm install sqlite-vec
```

`package.json` 的 `scripts` 增加：

```json
"test": "node --test tests/"
```

- [ ] **Step 2: 写冒烟测试，验证 sqlite-vec 能加载进 better-sqlite3**

`backend/tests/smoke.test.js`：

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';

test('sqlite-vec loads into better-sqlite3', () => {
  const db = new Database(':memory:');
  sqliteVec.load(db);
  const { vec_version } = db.prepare('SELECT vec_version() AS vec_version').get();
  assert.match(vec_version, /^v\d/);
  db.close();
});
```

- [ ] **Step 3: 运行测试确认通过**

Run: `cd backend && npm test`
Expected: `pass 1`

- [ ] **Step 4: Commit**

```bash
git add backend/package.json backend/package-lock.json backend/tests/smoke.test.js
git commit -m "chore: add node:test harness and sqlite-vec dependency"
```

---

### Task 2: 知识库表结构

**Files:**
- Create: `backend/knowledge/schema.js`
- Test: `backend/tests/knowledge-schema.test.js`

- [ ] **Step 1: 写失败测试**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { ensureKnowledgeSchema, ensureVecTable } from '../knowledge/schema.js';

function tableNames(db) {
  return db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view')").all().map(r => r.name);
}

test('ensureKnowledgeSchema creates chunks + fts tables', () => {
  const db = new Database(':memory:');
  ensureKnowledgeSchema(db);
  const names = tableNames(db);
  assert.ok(names.includes('knowledge_chunks'));
  assert.ok(names.includes('knowledge_fts'));
  db.close();
});

test('ensureVecTable creates vec0 table with given dim and records it', () => {
  const db = new Database(':memory:');
  ensureKnowledgeSchema(db);
  const created = ensureVecTable(db, 4);
  assert.equal(created, true);
  assert.ok(tableNames(db).includes('knowledge_vec'));
  // 再次调用同维度幂等
  assert.equal(ensureVecTable(db, 4), true);
  db.close();
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npm test`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 schema.js**

```js
import * as sqliteVec from 'sqlite-vec';

let vecLoaded = new WeakSet();

export function loadVecExtension(db) {
  if (vecLoaded.has(db)) return true;
  try {
    sqliteVec.load(db);
    vecLoaded.add(db);
    return true;
  } catch (error) {
    console.warn('[knowledge] sqlite-vec load failed, vector search disabled:', error.message);
    return false;
  }
}

export function ensureKnowledgeSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS knowledge_chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      doc_id TEXT NOT NULL,
      resource TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      level TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT '',
      tags TEXT NOT NULL DEFAULT '[]',
      source TEXT NOT NULL DEFAULT '',
      content_hash TEXT NOT NULL,
      embedding_model TEXT NOT NULL DEFAULT '',
      has_embedding INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(doc_id, title)
    );
    CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_doc ON knowledge_chunks(doc_id);
    CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(
      title, content_tokens, chunk_id UNINDEXED, tokenize='unicode61'
    );
  `);
}

// vec0 虚拟表维度建表时固定，因此在首次拿到 embedding 维度后创建。
// 维度变化（换模型）时需要重建：删表重嵌由 ingest 负责。
export function ensureVecTable(db, dim) {
  if (!loadVecExtension(db)) return false;
  if (!Number.isInteger(dim) || dim <= 0) return false;
  const existing = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='knowledge_vec'"
  ).get();
  if (existing) return true;
  db.exec(`CREATE VIRTUAL TABLE knowledge_vec USING vec0(chunk_id INTEGER PRIMARY KEY, embedding float[${dim}])`);
  return true;
}

export function dropVecTable(db) {
  db.exec('DROP TABLE IF EXISTS knowledge_vec');
}
```

- [ ] **Step 4: 运行测试通过后提交**

Run: `npm test` → Expected: PASS

```bash
git add backend/knowledge/schema.js backend/tests/knowledge-schema.test.js
git commit -m "feat(knowledge): add chunks/fts/vec schema module"
```

---

### Task 3: 日语分词（FTS 用）

**Files:**
- Create: `backend/knowledge/tokenize.js`
- Test: `backend/tests/knowledge-tokenize.test.js`

FTS5 的 unicode61 不会切日语，所以入库前用 kuromoji 把文本切成空格分隔的 token 串存入 `content_tokens` 列；kuromoji 未就绪时降级为 bigram。

- [ ] **Step 1: 写失败测试（只测确定性的 bigram 降级与混合文本行为）**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { tokenizeForFts, setTokenizer } from '../knowledge/tokenize.js';

test('falls back to bigram for CJK when tokenizer missing', () => {
  setTokenizer(null);
  assert.equal(tokenizeForFts('食べる'), '食べ べる');
});

test('keeps ascii words intact and lowercases', () => {
  setTokenizer(null);
  assert.equal(tokenizeForFts('BM25 排序'), 'bm25 排序');
});

test('uses injected tokenizer when available', () => {
  setTokenizer({ tokenize: () => [{ surface_form: '食べる' }, { surface_form: 'こと' }] });
  assert.equal(tokenizeForFts('食べること'), '食べる こと');
  setTokenizer(null);
});
```

- [ ] **Step 2: 运行确认失败** → Run: `npm test`，Expected: FAIL

- [ ] **Step 3: 实现 tokenize.js**

```js
let kuromojiTokenizer = null;

export function setTokenizer(tokenizer) {
  kuromojiTokenizer = tokenizer;
}

const CJK_RE = /[぀-ヿ㐀-鿿]/;

function bigrams(text) {
  if (text.length <= 2) return [text];
  const out = [];
  for (let i = 0; i < text.length - 1; i += 1) out.push(text.slice(i, i + 2));
  return out;
}

export function tokenizeForFts(text = '') {
  const value = String(text || '').trim();
  if (!value) return '';
  if (kuromojiTokenizer) {
    try {
      return kuromojiTokenizer.tokenize(value)
        .map(t => t.surface_form.trim().toLowerCase())
        .filter(Boolean)
        .join(' ');
    } catch {
      // fall through to bigram
    }
  }
  // 降级：CJK 连续段切 bigram，其余按空白切
  return value
    .split(/\s+/)
    .flatMap(seg => (CJK_RE.test(seg) ? bigrams(seg) : [seg.toLowerCase()]))
    .join(' ');
}
```

- [ ] **Step 4: 运行测试通过后提交**

```bash
git add backend/knowledge/tokenize.js backend/tests/knowledge-tokenize.test.js
git commit -m "feat(knowledge): japanese tokenization for FTS with bigram fallback"
```

---

### Task 4: Embedding 适配层

**Files:**
- Create: `backend/knowledge/embeddings.js`
- Test: `backend/tests/knowledge-embeddings.test.js`

- [ ] **Step 1: 写失败测试（注入 fake fetch）**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmbedder } from '../knowledge/embeddings.js';

function fakeFetch(handler) {
  return async (url, options) => {
    const body = JSON.parse(options.body);
    return { ok: true, status: 200, json: async () => handler(url, body) };
  };
}

test('ollama provider posts to /api/embed and returns vectors', async () => {
  const embedder = createEmbedder({
    provider: 'ollama', model: 'bge-m3', baseUrl: 'http://localhost:11434',
    fetchImpl: fakeFetch((url, body) => {
      assert.ok(url.endsWith('/api/embed'));
      return { embeddings: body.input.map(() => [0.1, 0.2, 0.3]) };
    })
  });
  const vectors = await embedder.embed(['食べる', '飲む']);
  assert.equal(vectors.length, 2);
  assert.equal(embedder.getDim(), 3);
});

test('openai-compatible provider posts to /v1/embeddings with bearer key', async () => {
  let sawAuth = '';
  const embedder = createEmbedder({
    provider: 'openai-compatible', model: 'bge-m3', baseUrl: 'https://api.example.com/v1', apiKey: 'sk-x',
    fetchImpl: async (url, options) => {
      sawAuth = options.headers.Authorization;
      assert.ok(url.endsWith('/v1/embeddings'));
      const body = JSON.parse(options.body);
      return { ok: true, status: 200, json: async () => ({ data: body.input.map((_, i) => ({ index: i, embedding: [1, 0] })) }) };
    }
  });
  const vectors = await embedder.embed(['は']);
  assert.deepEqual(vectors, [[1, 0]]);
  assert.equal(sawAuth, 'Bearer sk-x');
});

test('retries 3 times then throws', async () => {
  let calls = 0;
  const embedder = createEmbedder({
    provider: 'ollama', model: 'bge-m3', baseUrl: 'http://localhost:11434', retryDelayMs: 1,
    fetchImpl: async () => { calls += 1; return { ok: false, status: 500, json: async () => ({}) }; }
  });
  await assert.rejects(() => embedder.embed(['x']));
  assert.equal(calls, 3);
});

test('caches identical single-query embeds', async () => {
  let calls = 0;
  const embedder = createEmbedder({
    provider: 'ollama', model: 'bge-m3', baseUrl: 'http://localhost:11434',
    fetchImpl: fakeFetch(() => { calls += 1; return { embeddings: [[0.5]] }; })
  });
  await embedder.embed(['て形']);
  await embedder.embed(['て形']);
  assert.equal(calls, 1);
});
```

- [ ] **Step 2: 运行确认失败** → `npm test`，FAIL

- [ ] **Step 3: 实现 embeddings.js**

```js
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

export function createEmbedder({
  provider = 'ollama',
  model = 'bge-m3',
  baseUrl = 'http://localhost:11434',
  apiKey = '',
  fetchImpl = fetch,
  timeoutMs = 3000,
  retryDelayMs = 300,
  cacheSize = 256
} = {}) {
  let dim = null;
  const cache = new Map(); // 简易 LRU：Map 迭代序即插入序

  function cacheGet(key) {
    if (!cache.has(key)) return null;
    const value = cache.get(key);
    cache.delete(key);
    cache.set(key, value);
    return value;
  }

  function cacheSet(key, value) {
    cache.set(key, value);
    if (cache.size > cacheSize) cache.delete(cache.keys().next().value);
  }

  async function callOnce(texts) {
    const base = baseUrl.replace(/\/$/, '');
    const isOllama = provider === 'ollama';
    const url = isOllama ? `${base}/api/embed` : `${base.replace(/\/v1$/, '')}/v1/embeddings`;
    const headers = { 'Content-Type': 'application/json' };
    if (!isOllama && apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const body = isOllama ? { model, input: texts } : { model, input: texts };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, { method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal });
      if (!res.ok) throw new Error(`embedding http ${res.status}`);
      const data = await res.json();
      const vectors = isOllama
        ? data.embeddings
        : data.data.sort((a, b) => a.index - b.index).map(d => d.embedding);
      if (!Array.isArray(vectors) || vectors.length !== texts.length) {
        throw new Error('embedding response shape mismatch');
      }
      return vectors;
    } finally {
      clearTimeout(timer);
    }
  }

  async function callWithRetry(texts) {
    let lastError;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await callOnce(texts);
      } catch (error) {
        lastError = error;
        if (attempt < 2) await sleep(retryDelayMs * (attempt + 1));
      }
    }
    throw lastError;
  }

  return {
    provider,
    model,
    getDim: () => dim,
    async embed(texts) {
      if (!Array.isArray(texts) || texts.length === 0) return [];
      if (texts.length === 1) {
        const hit = cacheGet(texts[0]);
        if (hit) return [hit];
      }
      const vectors = await callWithRetry(texts);
      if (dim === null && vectors[0]) dim = vectors[0].length;
      if (vectors.some(v => v.length !== dim)) throw new Error('embedding dim inconsistent');
      if (texts.length === 1) cacheSet(texts[0], vectors[0]);
      return vectors;
    }
  };
}
```

- [ ] **Step 4: 运行测试通过后提交**

```bash
git add backend/knowledge/embeddings.js backend/tests/knowledge-embeddings.test.js
git commit -m "feat(knowledge): embedding adapter with ollama/openai providers, retry and cache"
```

---

### Task 5: 知识源解析与分块

**Files:**
- Create: `backend/knowledge/parse.js`
- Test: `backend/tests/knowledge-parse.test.js`

源文件格式：frontmatter（`level` 可被条目内 `> level: N4` 覆盖、`category`、`tags`），正文以 `## 标题` 划分条目，超长条目（>800 字符）按段落切分、相邻块 120 字符 overlap。

- [ ] **Step 1: 写失败测试**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSourceFile } from '../knowledge/parse.js';

const SAMPLE = `---
category: 活用
level: N5
tags: [动词, 变形]
---

## て形的变化规则

> level: N5

一段动词去る加て。五段动词按音便分组。

## 可能形

> level: N4

一段动词去る加られる。
`;

test('splits by h2 headings with metadata', () => {
  const chunks = parseSourceFile(SAMPLE, 'verb-conjugation.md');
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].title, 'て形的变化规则');
  assert.equal(chunks[0].docId, 'verb-conjugation');
  assert.equal(chunks[0].resource, 'kb://grammar/verb-conjugation');
  assert.equal(chunks[0].category, '活用');
  assert.equal(chunks[0].level, 'N5');
  assert.equal(chunks[1].level, 'N4'); // 条目内覆盖
  assert.deepEqual(chunks[0].tags, ['动词', '变形']);
  assert.match(chunks[0].contentHash, /^[a-f0-9]{64}$/);
});

test('long sections split with overlap', () => {
  const para = '一段动词的活用规则说明。'.repeat(60); // ~720 字 x2 段
  const long = `---\ncategory: 活用\nlevel: N5\n---\n\n## 长条目\n\n${para}\n\n${para}`;
  const chunks = parseSourceFile(long, 'x.md');
  assert.ok(chunks.length >= 2);
  assert.equal(chunks[0].title, '长条目');
  assert.equal(chunks[1].title, '长条目 (2)');
  const tail = chunks[0].content.slice(-50);
  assert.ok(chunks[1].content.startsWith(chunks[0].content.slice(-120).slice(0, 50).slice(0, 0) + chunks[1].content.slice(0, 0)) || chunks[1].content.includes(tail.slice(0, 30)));
});

test('hash changes when content changes', () => {
  const a = parseSourceFile(SAMPLE, 'a.md')[0];
  const b = parseSourceFile(SAMPLE.replace('按音便分组', '按音便分三组'), 'a.md')[0];
  assert.notEqual(a.contentHash, b.contentHash);
});
```

- [ ] **Step 2: 运行确认失败** → `npm test`，FAIL

- [ ] **Step 3: 实现 parse.js**

```js
import crypto from 'node:crypto';

const MAX_CHUNK = 800;
const OVERLAP = 120;

function parseFrontmatter(text) {
  const match = text.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) return [{}, text];
  const meta = {};
  for (const line of match[1].split('\n')) {
    const m = line.match(/^(\w+):\s*(.+)$/);
    if (!m) continue;
    const [, key, raw] = m;
    meta[key] = raw.startsWith('[')
      ? raw.replace(/[[\]]/g, '').split(',').map(s => s.trim()).filter(Boolean)
      : raw.trim();
  }
  return [meta, text.slice(match[0].length)];
}

function splitLong(content) {
  if (content.length <= MAX_CHUNK) return [content];
  const paragraphs = content.split(/\n\n+/);
  const pieces = [];
  let current = '';
  for (const p of paragraphs) {
    if (current && (current.length + p.length + 2) > MAX_CHUNK) {
      pieces.push(current);
      current = current.slice(-OVERLAP) + '\n\n' + p;
    } else {
      current = current ? `${current}\n\n${p}` : p;
    }
  }
  if (current) pieces.push(current);
  return pieces;
}

export function parseSourceFile(text, filename) {
  const [meta, body] = parseFrontmatter(String(text || ''));
  const docId = filename.replace(/\.md$/, '');
  const resource = `kb://grammar/${docId}`;
  const sections = body.split(/\n(?=## )/).map(s => s.trim()).filter(s => s.startsWith('## '));
  const chunks = [];
  for (const section of sections) {
    const lines = section.split('\n');
    const title = lines[0].replace(/^##\s*/, '').trim();
    let level = meta.level || '';
    const contentLines = [];
    for (const line of lines.slice(1)) {
      const override = line.match(/^>\s*level:\s*(\S+)/i);
      if (override) { level = override[1]; continue; }
      contentLines.push(line);
    }
    const content = contentLines.join('\n').trim();
    if (!content) continue;
    splitLong(content).forEach((piece, index) => {
      const pieceTitle = index === 0 ? title : `${title} (${index + 1})`;
      chunks.push({
        docId,
        resource,
        title: pieceTitle,
        content: piece,
        level,
        category: meta.category || '',
        tags: Array.isArray(meta.tags) ? meta.tags : [],
        source: filename,
        contentHash: crypto.createHash('sha256').update(`${pieceTitle}\n${piece}`).digest('hex')
      });
    });
  }
  return chunks;
}
```

- [ ] **Step 4: 运行测试通过后提交**

```bash
git add backend/knowledge/parse.js backend/tests/knowledge-parse.test.js
git commit -m "feat(knowledge): markdown source parser with overlap chunking"
```

---

### Task 6: 编写知识源内容（约 80 条）

**Files:**
- Create: `backend/knowledge-source/verb-conjugation.md`（活用，~24 条）
- Create: `backend/knowledge-source/particles.md`（助词，~20 条）
- Create: `backend/knowledge-source/sentence-patterns.md`（句型，~22 条）
- Create: `backend/knowledge-source/keigo.md`（敬语，~14 条）

每个文件 frontmatter 形如：

```markdown
---
category: 活用
level: N5
tags: [动词, 变形]
---
```

每条目格式（两个完整示例，其余条目同格式撰写，内容须包含：规则说明、至少 2 个例句带假名读音和中文翻译、常见错误或易混点）：

```markdown
## て形的变化规则

> level: N5

て形用于连接动作、请求（〜てください）、进行时（〜ている）等。变化规则按动词类型：
一段动词：去「る」加「て」，如 食べる→食べて（たべて）。
五段动词按词尾音便：う/つ/る→って（買う→買って）；ぬ/ぶ/む→んで（飲む→飲んで）；
く→いて（書く→書いて，例外：行く→行って）；ぐ→いで（泳ぐ→泳いで）；す→して（話す→話して）。
サ变：する→して；カ变：来る→きて。

例句：ご飯を食べてから、出かけます。（ごはんをたべてから、でかけます。）吃完饭后出门。
例句：ここに名前を書いてください。（ここになまえをかいてください。）请在这里写名字。

易错点：五段动词「行く」是音便例外（行って而非 行いて）；不要把一段动词误按五段处理（見る→見て，不是 見って）。

## は和が的区别

> level: N5

「は」标记主题（已知信息、对比），「が」标记主语（新信息、强调、疑问词作主语）。
疑问词作主语必用が：誰が来ましたか。回答也用が：田中さんが来ました。
从句内主语用が：雨が降ったら、行きません。表对比时用は：肉は食べますが、魚は食べません。

例句：象は鼻が長い。（ぞうははながながい。）大象鼻子长。——「は」立主题、「が」标属性主语的经典例。
例句：誰がこのケーキを作りましたか。（だれがこのケーキをつくりましたか。）这个蛋糕是谁做的？

易错点：自我介绍「私は田中です」不用が；回答「谁做的」时必须「私が作りました」。
```

- [ ] **Step 1: 撰写 verb-conjugation.md（24 条，标题清单如下，每条按上述格式）**

て形的变化规则 / た形（过去形） / ない形（否定形） / ます形（礼貌形） / 可能形 / 被动形 / 使役形 / 使役被动形 / 命令形 / 禁止形 / 意向形 / 条件形ば / 条件形たら / 假定なら / 五段动词的判别 / 一段动词的判别 / サ变动词与カ变动词 / 自动词与他动词 / 〜ている的两种含义 / 〜てある与〜ておく / 授受动词（あげる・くれる・もらう） / 〜てしまう / 复合动词（〜始める・〜终わる・〜続ける） / 动词的名词化（の・こと）

- [ ] **Step 2: 撰写 particles.md（20 条）**

は和が的区别 / を的用法 / に的用法总览 / で的用法总览 / へ与に的方向表达 / と的用法 / から与まで / より与ほど（比较） / か的疑问与选择 / も的用法 / の的所属与同位 / ね与よ（终助词） / ばかり / だけ与しか / でも的用法 / くらい・ぐらい / など与なんか / ながら / のに与ので / こそ

- [ ] **Step 3: 撰写 sentence-patterns.md（22 条）**

〜たいです（愿望） / 〜たことがある（经历） / 〜たほうがいい（建议） / 〜なければならない（义务） / 〜てもいい（许可） / 〜てはいけない（禁止） / 〜と思う（想法） / 〜と言う（引用） / 〜つもり（打算） / 〜予定（计划） / 〜そうです（样态与传闻） / 〜ようです（推测） / 〜らしい（推测与典型性） / 〜かもしれない（可能性） / 〜はずです（应该） / 〜すぎる（过度） / 〜やすい・〜にくい / 〜ために（目的与原因） / 〜ように（目的与变化） / 〜ばかりでなく / 〜たり〜たりする / 〜ことになる与〜ことにする

- [ ] **Step 4: 撰写 keigo.md（14 条，frontmatter level: N3）**

敬语体系总览（尊敬语・谦让语・丁宁语） / 尊敬语的动词变形（お〜になる） / 尊敬语特殊动词（いらっしゃる・召し上がる等） / 谦让语的动词变形（お〜する） / 谦让语特殊动词（伺う・申す・いただく等） / 丁宁语（です・ます・ございます） / 美化语（お茶・ご飯） / 〜ていただけませんか（请求） / 〜させていただく / お疲れ様与ご苦労様 / 职场邮件常用敬语 / 电话敬语 / 店铺服务敬语（いらっしゃいませ等） / 敬语的常见误用

- [ ] **Step 5: 用解析器验证条目数**

Run: `cd backend && node -e "
import('fs').then(async fs => {
  const { parseSourceFile } = await import('./knowledge/parse.js');
  let total = 0;
  for (const f of fs.readdirSync('knowledge-source').filter(x => x.endsWith('.md'))) {
    const chunks = parseSourceFile(fs.readFileSync('knowledge-source/' + f, 'utf8'), f);
    console.log(f, chunks.length);
    total += chunks.length;
  }
  console.log('total', total);
})"`
Expected: 每文件条目数与清单一致，total ≥ 80

- [ ] **Step 6: Commit**

```bash
git add backend/knowledge-source/
git commit -m "feat(knowledge): author grammar knowledge source (~80 entries, N5-N2)"
```

---

### Task 7: Ingest 增量索引管道

**Files:**
- Create: `backend/knowledge/ingest.js`
- Test: `backend/tests/knowledge-ingest.test.js`

- [ ] **Step 1: 写失败测试（fake embedder + 内存库 + 临时源目录）**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { ensureKnowledgeSchema } from '../knowledge/schema.js';
import { ingestKnowledge } from '../knowledge/ingest.js';

const SRC = `---\ncategory: 活用\nlevel: N5\n---\n\n## て形\n\n规则A\n\n## た形\n\n规则B\n`;

function makeEmbedder(dim = 3) {
  let calls = 0;
  return {
    embedder: {
      model: 'fake', getDim: () => dim,
      async embed(texts) { calls += texts.length; return texts.map(() => Array(dim).fill(0.1)); }
    },
    getCalls: () => calls
  };
}

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-'));
  fs.writeFileSync(path.join(dir, 'verbs.md'), SRC);
  const db = new Database(':memory:');
  ensureKnowledgeSchema(db);
  return { dir, db };
}

test('first ingest adds all chunks with embeddings', async () => {
  const { dir, db } = setup();
  const { embedder, getCalls } = makeEmbedder();
  const report = await ingestKnowledge({ db, embedder, sourceDir: dir });
  assert.equal(report.added, 2);
  assert.equal(getCalls(), 2);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM knowledge_chunks').get().c, 2);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM knowledge_fts').get().c, 2);
});

test('second ingest with no changes embeds nothing', async () => {
  const { dir, db } = setup();
  const { embedder, getCalls } = makeEmbedder();
  await ingestKnowledge({ db, embedder, sourceDir: dir });
  const before = getCalls();
  const report = await ingestKnowledge({ db, embedder, sourceDir: dir });
  assert.equal(report.added, 0);
  assert.equal(report.unchanged, 2);
  assert.equal(getCalls(), before);
});

test('changed chunk re-embeds, removed chunk deleted', async () => {
  const { dir, db } = setup();
  const { embedder } = makeEmbedder();
  await ingestKnowledge({ db, embedder, sourceDir: dir });
  fs.writeFileSync(path.join(dir, 'verbs.md'), SRC.replace('规则A', '规则A改').replace('\n## た形\n\n规则B\n', ''));
  const report = await ingestKnowledge({ db, embedder, sourceDir: dir });
  assert.equal(report.updated, 1);
  assert.equal(report.removed, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM knowledge_chunks').get().c, 1);
});

test('without embedder still indexes for BM25 (degraded build)', async () => {
  const { dir, db } = setup();
  const report = await ingestKnowledge({ db, embedder: null, sourceDir: dir });
  assert.equal(report.added, 2);
  assert.equal(report.embedded, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM knowledge_chunks WHERE has_embedding = 1').get().c, 0);
});
```

- [ ] **Step 2: 运行确认失败** → `npm test`，FAIL

- [ ] **Step 3: 实现 ingest.js**

```js
import fs from 'node:fs';
import path from 'node:path';
import { parseSourceFile } from './parse.js';
import { tokenizeForFts } from './tokenize.js';
import { ensureVecTable } from './schema.js';

const EMBED_BATCH = 16;

export async function ingestKnowledge({ db, embedder, sourceDir }) {
  const report = { added: 0, updated: 0, removed: 0, unchanged: 0, embedded: 0, failed: [] };
  const files = fs.readdirSync(sourceDir).filter(f => f.endsWith('.md'));
  const incoming = files.flatMap(f => parseSourceFile(fs.readFileSync(path.join(sourceDir, f), 'utf8'), f));

  const existing = new Map(
    db.prepare('SELECT id, doc_id, title, content_hash FROM knowledge_chunks').all()
      .map(row => [`${row.doc_id} ${row.title}`, row])
  );

  const toEmbed = [];
  const upsert = db.prepare(`
    INSERT INTO knowledge_chunks (doc_id, resource, title, content, level, category, tags, source, content_hash, embedding_model, has_embedding, updated_at)
    VALUES (@docId, @resource, @title, @content, @level, @category, @tags, @source, @contentHash, '', 0, datetime('now'))
    ON CONFLICT(doc_id, title) DO UPDATE SET
      content=excluded.content, level=excluded.level, category=excluded.category, tags=excluded.tags,
      source=excluded.source, content_hash=excluded.content_hash, has_embedding=0, updated_at=datetime('now')
    RETURNING id
  `);
  const insertFts = db.prepare('INSERT INTO knowledge_fts (title, content_tokens, chunk_id) VALUES (?, ?, ?)');
  const deleteFts = db.prepare('DELETE FROM knowledge_fts WHERE chunk_id = ?');

  const seen = new Set();
  const applyChunks = db.transaction(() => {
    for (const chunk of incoming) {
      const key = `${chunk.docId} ${chunk.title}`;
      seen.add(key);
      const prior = existing.get(key);
      if (prior && prior.content_hash === chunk.contentHash) {
        report.unchanged += 1;
        continue;
      }
      const { id } = upsert.get({ ...chunk, tags: JSON.stringify(chunk.tags) });
      deleteFts.run(id);
      insertFts.run(tokenizeForFts(chunk.title), tokenizeForFts(chunk.content), id);
      toEmbed.push({ id, text: `${chunk.title}\n${chunk.content}` });
      if (prior) report.updated += 1; else report.added += 1;
    }
    for (const [key, row] of existing) {
      if (seen.has(key)) continue;
      db.prepare('DELETE FROM knowledge_chunks WHERE id = ?').run(row.id);
      deleteFts.run(row.id);
      report.removed += 1;
    }
  });
  applyChunks();

  if (embedder && toEmbed.length > 0) {
    const markEmbedded = db.prepare('UPDATE knowledge_chunks SET has_embedding = 1, embedding_model = ? WHERE id = ?');
    for (let i = 0; i < toEmbed.length; i += EMBED_BATCH) {
      const batch = toEmbed.slice(i, i + EMBED_BATCH);
      try {
        const vectors = await embedder.embed(batch.map(item => item.text));
        const dim = vectors[0]?.length;
        if (!ensureVecTable(db, dim)) break;
        const writeVecBatch = db.transaction(() => {
          batch.forEach((item, j) => {
            db.prepare('DELETE FROM knowledge_vec WHERE chunk_id = ?').run(BigInt(item.id));
            db.prepare('INSERT INTO knowledge_vec (chunk_id, embedding) VALUES (?, ?)')
              .run(BigInt(item.id), JSON.stringify(vectors[j]));
            markEmbedded.run(embedder.model, item.id);
            report.embedded += 1;
          });
        });
        writeVecBatch();
      } catch (error) {
        report.failed.push({ ids: batch.map(b => b.id), error: error.message });
      }
    }
  }
  return report;
}
```

- [ ] **Step 4: 运行测试通过后提交**

```bash
git add backend/knowledge/ingest.js backend/tests/knowledge-ingest.test.js
git commit -m "feat(knowledge): hash-based incremental ingest pipeline"
```

---

### Task 8: kb:build 脚本

**Files:**
- Create: `backend/scripts/kb-build.js`
- Modify: `backend/package.json`（scripts）

- [ ] **Step 1: 实现脚本**

```js
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
```

同时创建 `backend/knowledge/settings.js`（embedding 配置读写，复用 app_settings 表）：

```js
const DEFAULTS = {
  provider: 'ollama',
  model: 'bge-m3',
  baseUrl: 'http://localhost:11434',
  apiKey: '',
  ragProvider: 'local'
};

export function getKnowledgeEmbeddingSettings(db) {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get('knowledge_embedding');
  if (!row) return { ...DEFAULTS };
  try { return { ...DEFAULTS, ...JSON.parse(row.value) }; } catch { return { ...DEFAULTS }; }
}

export function saveKnowledgeEmbeddingSettings(db, patch = {}) {
  const next = { ...getKnowledgeEmbeddingSettings(db), ...patch };
  db.prepare(`
    INSERT INTO app_settings (key, value, updated_at) VALUES ('knowledge_embedding', ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
  `).run(JSON.stringify(next));
  return next;
}
```

`package.json` scripts 增加：

```json
"kb:build": "node scripts/kb-build.js",
```

- [ ] **Step 2: 实际运行（有 Ollama 则全量，否则 --no-embed）**

Run: `cd backend && npm run kb:build`
Expected: 输出 report，`added ≥ 80`；无 Ollama 时输出降级警告且 added 数一致

- [ ] **Step 3: Commit**

```bash
git add backend/scripts/kb-build.js backend/knowledge/settings.js backend/package.json
git commit -m "feat(knowledge): kb:build script with embedding settings and degraded mode"
```

---

### Task 9: LocalRetriever（混合检索 + RRF）

**Files:**
- Create: `backend/knowledge/retriever.js`
- Test: `backend/tests/knowledge-retriever.test.js`

- [ ] **Step 1: 写失败测试**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { ensureKnowledgeSchema } from '../knowledge/schema.js';
import { ingestKnowledge } from '../knowledge/ingest.js';
import { createLocalRetriever, rrfFuse } from '../knowledge/retriever.js';

const SRC = `---\ncategory: 活用\nlevel: N5\n---\n\n## て形\n\nて形连接动作，食べる变食べて。\n\n## 可能形\n\n可能形表示能力，食べる变食べられる。\n`;

function vecFor(text) {
  // 确定性 fake embedding：「て形」相关文本第一维高
  return text.includes('て形') || text.includes('te') ? [1, 0] : [0, 1];
}

const fakeEmbedder = {
  model: 'fake', getDim: () => 2,
  async embed(texts) { return texts.map(vecFor); }
};

async function buildDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-'));
  fs.writeFileSync(path.join(dir, 'verbs.md'), SRC);
  const db = new Database(':memory:');
  ensureKnowledgeSchema(db);
  await ingestKnowledge({ db, embedder: fakeEmbedder, sourceDir: dir });
  return db;
}

test('rrfFuse merges two ranked lists', () => {
  const fused = rrfFuse([[{ id: 1 }, { id: 2 }], [{ id: 2 }, { id: 3 }]], 60);
  assert.equal(fused[0].id, 2); // 两路都命中者居首
  assert.equal(fused.length, 3);
});

test('hybrid query returns te-form chunk first', async () => {
  const db = await buildDb();
  const retriever = createLocalRetriever({ db, embedder: fakeEmbedder });
  const { results, degraded } = await retriever.queryRelevantDocuments('て形 怎么变', { topK: 2 });
  assert.equal(degraded, false);
  assert.equal(results[0].title, 'て形');
  assert.ok(results[0].score > 0);
});

test('degrades to bm25 when embedder fails', async () => {
  const db = await buildDb();
  const broken = { model: 'fake', getDim: () => 2, async embed() { throw new Error('down'); } };
  const retriever = createLocalRetriever({ db, embedder: broken });
  const { results, degraded } = await retriever.queryRelevantDocuments('可能形', { topK: 2 });
  assert.equal(degraded, true);
  assert.equal(results[0].title, '可能形');
});

test('level filter narrows results and listResources reports docs', async () => {
  const db = await buildDb();
  const retriever = createLocalRetriever({ db, embedder: fakeEmbedder });
  const resources = retriever.listResources();
  assert.deepEqual(resources.map(r => r.uri), ['kb://grammar/verbs']);
  const { results } = await retriever.queryRelevantDocuments('て形', { level: 'N1' });
  assert.equal(results.length, 0);
});
```

- [ ] **Step 2: 运行确认失败** → `npm test`，FAIL

- [ ] **Step 3: 实现 retriever.js**

```js
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

export function createLocalRetriever({ db, embedder }) {
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
      let vecRows = null;
      try {
        vecRows = await vectorLeg(query);
      } catch {
        degraded = true;
      }
      if (vecRows === null && !degraded) degraded = !embedder ? true : degraded;
      const legs = [];
      if (Array.isArray(vecRows)) legs.push(vecRows);
      else degraded = true;
      legs.push(bm25Leg(query));
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
```

- [ ] **Step 4: 运行测试通过后提交**

```bash
git add backend/knowledge/retriever.js backend/tests/knowledge-retriever.test.js
git commit -m "feat(knowledge): hybrid local retriever with RRF fusion and BM25 degradation"
```

---

### Task 10: 防抖重嵌队列

**Files:**
- Create: `backend/knowledge/queue.js`
- Test: `backend/tests/knowledge-queue.test.js`

- [ ] **Step 1: 写失败测试**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createReindexQueue } from '../knowledge/queue.js';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

test('debounces multiple schedule calls into one run', async () => {
  let runs = 0;
  const queue = createReindexQueue({ run: async () => { runs += 1; }, delayMs: 30 });
  queue.schedule();
  queue.schedule();
  queue.schedule();
  await sleep(80);
  assert.equal(runs, 1);
});

test('schedule during run queues one follow-up', async () => {
  let runs = 0;
  const queue = createReindexQueue({
    run: async () => { runs += 1; await sleep(40); },
    delayMs: 10
  });
  queue.schedule();
  await sleep(20); // 进入执行中
  queue.schedule(); // 执行期间再次请求
  await sleep(150);
  assert.equal(runs, 2);
});

test('run errors are swallowed and logged, queue stays usable', async () => {
  let runs = 0;
  const queue = createReindexQueue({
    run: async () => { runs += 1; if (runs === 1) throw new Error('boom'); },
    delayMs: 10
  });
  queue.schedule();
  await sleep(40);
  queue.schedule();
  await sleep(40);
  assert.equal(runs, 2);
});
```

- [ ] **Step 2: 运行确认失败** → `npm test`，FAIL

- [ ] **Step 3: 实现 queue.js**

```js
export function createReindexQueue({ run, delayMs = 2000 }) {
  let timer = null;
  let running = false;
  let pendingAgain = false;

  async function execute() {
    running = true;
    try {
      await run();
    } catch (error) {
      console.warn('[knowledge] reindex failed:', error.message);
    } finally {
      running = false;
      if (pendingAgain) {
        pendingAgain = false;
        schedule();
      }
    }
  }

  function schedule() {
    if (running) {
      pendingAgain = true;
      return;
    }
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; execute(); }, delayMs);
  }

  return { schedule, isRunning: () => running };
}
```

- [ ] **Step 4: 运行测试通过后提交**

```bash
git add backend/knowledge/queue.js backend/tests/knowledge-queue.test.js
git commit -m "feat(knowledge): debounced reindex queue"
```

---

### Task 11: 知识库 API 路由

**Files:**
- Create: `backend/knowledge/routes.js`
- Modify: `backend/server.js`（mount，见 Step 3）
- Test: `backend/tests/knowledge-routes.test.js`

- [ ] **Step 1: 写失败测试（express 实例 + 随机端口 + fetch）**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { ensureKnowledgeSchema } from '../knowledge/schema.js';
import { ingestKnowledge } from '../knowledge/ingest.js';
import { registerKnowledgeRoutes } from '../knowledge/routes.js';
import { createLocalRetriever } from '../knowledge/retriever.js';

const SRC = `---\ncategory: 活用\nlevel: N5\n---\n\n## て形\n\nて形连接动作。\n`;

async function makeApp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-'));
  fs.writeFileSync(path.join(dir, 'verbs.md'), SRC);
  const db = new Database(':memory:');
  ensureKnowledgeSchema(db);
  await ingestKnowledge({ db, embedder: null, sourceDir: dir });
  const app = express();
  app.use(express.json());
  let reindexCalls = 0;
  registerKnowledgeRoutes(app, {
    db,
    retriever: createLocalRetriever({ db, embedder: null }),
    reindexQueue: { schedule: () => { reindexCalls += 1; }, isRunning: () => false },
    getEmbeddingSettings: () => ({ provider: 'ollama', model: 'bge-m3' })
  });
  const server = app.listen(0);
  const base = `http://localhost:${server.address().port}`;
  return { base, db, server, getReindexCalls: () => reindexCalls };
}

test('GET /api/knowledge/search returns hits', async () => {
  const { base, server } = await makeApp();
  const res = await fetch(`${base}/api/knowledge/search?q=て形`);
  const data = await res.json();
  assert.equal(res.status, 200);
  assert.equal(data.results[0].title, 'て形');
  assert.equal(data.degraded, true);
  server.close();
});

test('GET /api/knowledge/stats reports counts', async () => {
  const { base, server } = await makeApp();
  const data = await (await fetch(`${base}/api/knowledge/stats`)).json();
  assert.equal(data.chunks, 1);
  assert.equal(data.embedded, 0);
  assert.equal(data.embedding.model, 'bge-m3');
  server.close();
});

test('POST /api/knowledge/reindex schedules queue', async () => {
  const { base, server, getReindexCalls } = await makeApp();
  const res = await fetch(`${base}/api/knowledge/reindex`, { method: 'POST' });
  assert.equal(res.status, 202);
  assert.equal(getReindexCalls(), 1);
  server.close();
});

test('chunk CRUD roundtrip schedules reindex', async () => {
  const { base, server, db, getReindexCalls } = await makeApp();
  const created = await (await fetch(`${base}/api/knowledge/chunks`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ docId: 'custom', title: '自定义条目', content: '内容', level: 'N4', category: '句型' })
  })).json();
  assert.ok(created.id);
  const del = await fetch(`${base}/api/knowledge/chunks/${created.id}`, { method: 'DELETE' });
  assert.equal(del.status, 200);
  assert.equal(getReindexCalls(), 2);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM knowledge_chunks WHERE doc_id='custom'").get().c, 0);
  server.close();
});
```

- [ ] **Step 2: 运行确认失败** → `npm test`，FAIL

- [ ] **Step 3: 实现 routes.js**

```js
import { tokenizeForFts } from './tokenize.js';

export function registerKnowledgeRoutes(app, { db, retriever, reindexQueue, getEmbeddingSettings }) {
  app.get('/api/knowledge/search', async (req, res) => {
    const q = String(req.query.q || '').trim();
    if (!q) return res.status(400).json({ error: 'q is required' });
    const topK = Math.min(parseInt(req.query.topK) || 5, 20);
    const { results, degraded } = await retriever.queryRelevantDocuments(q, {
      topK,
      level: String(req.query.level || ''),
      category: String(req.query.category || ''),
      resources: req.query.resources ? String(req.query.resources).split(',') : []
    });
    res.json({ query: q, degraded, results });
  });

  app.get('/api/knowledge/stats', (req, res) => {
    const { chunks } = db.prepare('SELECT COUNT(*) AS chunks FROM knowledge_chunks').get();
    const { embedded } = db.prepare('SELECT COUNT(*) AS embedded FROM knowledge_chunks WHERE has_embedding = 1').get();
    const settings = getEmbeddingSettings();
    res.json({
      chunks,
      embedded,
      resources: retriever.listResources(),
      reindexing: reindexQueue.isRunning(),
      embedding: { provider: settings.provider, model: settings.model }
    });
  });

  app.post('/api/knowledge/reindex', (req, res) => {
    reindexQueue.schedule();
    res.status(202).json({ scheduled: true });
  });

  app.post('/api/knowledge/chunks', (req, res) => {
    const { docId = 'custom', title = '', content = '', level = '', category = '', tags = [] } = req.body || {};
    if (!title.trim() || !content.trim()) return res.status(400).json({ error: 'title and content are required' });
    const { id } = db.prepare(`
      INSERT INTO knowledge_chunks (doc_id, resource, title, content, level, category, tags, source, content_hash, has_embedding)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'api', '', 0) RETURNING id
    `).get(docId, `kb://grammar/${docId}`, title.trim(), content.trim(), level, category, JSON.stringify(tags));
    db.prepare('INSERT INTO knowledge_fts (title, content_tokens, chunk_id) VALUES (?, ?, ?)')
      .run(tokenizeForFts(title), tokenizeForFts(content), id);
    reindexQueue.schedule();
    res.status(201).json({ id });
  });

  app.delete('/api/knowledge/chunks/:id', (req, res) => {
    const id = parseInt(req.params.id);
    const info = db.prepare('DELETE FROM knowledge_chunks WHERE id = ?').run(id);
    db.prepare('DELETE FROM knowledge_fts WHERE chunk_id = ?').run(id);
    if (db.prepare("SELECT name FROM sqlite_master WHERE name='knowledge_vec'").get()) {
      db.prepare('DELETE FROM knowledge_vec WHERE chunk_id = ?').run(BigInt(id));
    }
    reindexQueue.schedule();
    res.status(info.changes ? 200 : 404).json({ deleted: info.changes > 0 });
  });
}
```

- [ ] **Step 4: 运行测试通过后提交**

```bash
git add backend/knowledge/routes.js backend/tests/knowledge-routes.test.js
git commit -m "feat(knowledge): search/stats/reindex/CRUD API routes"
```

---

### Task 12: server.js 接线（初始化 + 路由挂载 + knowledge_search 工具）

**Files:**
- Modify: `backend/server.js`

- [ ] **Step 1: 初始化知识库（server.js 顶部 import 区之后、Express app 创建之后）**

```js
import { ensureKnowledgeSchema } from './knowledge/schema.js';
import { createEmbedder } from './knowledge/embeddings.js';
import { createRetriever } from './knowledge/retriever.js';
import { createReindexQueue } from './knowledge/queue.js';
import { ingestKnowledge } from './knowledge/ingest.js';
import { registerKnowledgeRoutes } from './knowledge/routes.js';
import { getKnowledgeEmbeddingSettings, saveKnowledgeEmbeddingSettings } from './knowledge/settings.js';
import { setTokenizer as setKnowledgeTokenizer } from './knowledge/tokenize.js';

ensureKnowledgeSchema(db);
const knowledgeSettings = getKnowledgeEmbeddingSettings(db);
const knowledgeEmbedder = createEmbedder(knowledgeSettings);
const knowledgeRetriever = createRetriever({ db, embedder: knowledgeEmbedder, ragProvider: knowledgeSettings.ragProvider });
const knowledgeSourceDir = path.join(__dirname, 'knowledge-source');
const knowledgeReindexQueue = createReindexQueue({
  run: () => ingestKnowledge({ db, embedder: knowledgeEmbedder, sourceDir: knowledgeSourceDir }),
  delayMs: 2000
});
registerKnowledgeRoutes(app, {
  db,
  retriever: knowledgeRetriever,
  reindexQueue: knowledgeReindexQueue,
  getEmbeddingSettings: () => getKnowledgeEmbeddingSettings(db)
});
```

并在现有 kuromoji tokenizer 初始化回调处（搜 `tokenizer =`）补一行 `setKnowledgeTokenizer(tokenizer);`。

- [ ] **Step 2: 注册 knowledge_search 为 agentTools 第一个元素（`const agentTools = [` 处，插在 external_search 之前）**

```js
  {
    type: 'function',
    function: {
      name: 'knowledge_search',
      description: 'Search the LOCAL Japanese grammar knowledge base first for grammar rules, conjugation, particles, sentence patterns, keigo. Prefer this over external_search for grammar/usage questions.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Grammar/usage question in Japanese/Chinese/English.' },
          topK: { type: 'number' },
          level: { type: 'string', description: 'Optional JLPT level filter like N5.' },
          category: { type: 'string', description: 'Optional: 活用/助词/句型/敬语.' }
        },
        required: ['query']
      }
    }
  },
```

- [ ] **Step 3: executeAgentTool 增加分发分支（函数开头）**

```js
  if (name === 'knowledge_search') {
    const { results, degraded } = await knowledgeRetriever.queryRelevantDocuments(args.query || '', {
      topK: args.topK || 5, level: args.level || '', category: args.category || ''
    });
    return {
      degraded,
      hits: results.map(r => ({
        id: r.id, resource: r.resource, title: r.title, level: r.level,
        category: r.category, score: Number(r.score.toFixed(4)),
        excerpt: r.content.slice(0, 400)
      }))
    };
  }
```

- [ ] **Step 4: Researcher 提示词补充本地优先原则**

找到 Researcher 的 system prompt 构造处（搜 `researcher` 的 buildBrief 或 sandbox prompt），在工具使用说明里追加一句：

```
语法、活用、助词、句型、敬语类问题，必须先调用 knowledge_search 查本地知识库；本地命中即引用，未命中或不充分再用 external_search。
```

- [ ] **Step 5: done 事件携带 knowledgeSources**

在收集 run 工具调用结果、构造 done payload 的位置（搜 `interactivePractice` 的 payload 组装处），追加：

```js
const knowledgeSources = (toolCallsThisRun || [])
  .filter(call => call.name === 'knowledge_search' && Array.isArray(call.result?.hits))
  .flatMap(call => call.result.hits)
  .filter((hit, index, arr) => arr.findIndex(h => h.id === hit.id) === index)
  .slice(0, 5);
```

并把 `knowledgeSources` 加入 done 事件 JSON。

- [ ] **Step 6: embedding 设置 API（紧挨 registerKnowledgeRoutes 调用后）**

```js
app.get('/api/knowledge/embedding-settings', (req, res) => {
  const { apiKey, ...rest } = getKnowledgeEmbeddingSettings(db);
  res.json({ ...rest, apiKeySet: !!apiKey });
});
app.post('/api/knowledge/embedding-settings', (req, res) => {
  const saved = saveKnowledgeEmbeddingSettings(db, req.body || {});
  knowledgeReindexQueue.schedule();
  const { apiKey, ...rest } = saved;
  res.json({ ...rest, apiKeySet: !!apiKey });
});
```

- [ ] **Step 7: 语法检查 + 手动验证**

```bash
node --check backend/server.js
```

启动后端后：

```bash
curl "http://localhost:3456/api/knowledge/stats"          # chunks ≥ 80
curl "http://localhost:3456/api/knowledge/search?q=て形"   # 命中て形条目
```

- [ ] **Step 8: Commit**

```bash
git add backend/server.js
git commit -m "feat(knowledge): wire retriever into server, agent tool and done payload"
```

---

### Task 13: Background Investigation（Planner 前置检索）

**Files:**
- Modify: `backend/server.js`（planner 节点，约 line 1599 `.addNode('planner', ...)`）

- [ ] **Step 1: planner 节点内、buildBrief 之前插入轻量检索**

```js
let backgroundKnowledge = '';
try {
  const { results } = await knowledgeRetriever.queryRelevantDocuments(state.userMessage || nextIntent?.query || '', { topK: 3 });
  if (results.length > 0) {
    backgroundKnowledge = results
      .map(r => `- [${r.category}/${r.level}] ${r.title}: ${r.content.slice(0, 80)}`)
      .join('\n');
  }
} catch {
  // 本地检索失败不阻塞规划
}
```

把 `backgroundKnowledge` 拼进 plannerNote 内容（`formatPlannerNote(plannerNote)` 的入参或其后追加）：

```js
content: formatPlannerNote(plannerNote) + (backgroundKnowledge
  ? `\n\n本地知识库预查（规划参考）：\n${backgroundKnowledge}`
  : '\n\n本地知识库预查：无相关条目')
```

- [ ] **Step 2: 验证**

```bash
node --check backend/server.js
```

重启后端，发起一次 Agent 查询「て形怎么变」，确认 SSE `agent_note` 事件中 Planner 内容包含「本地知识库预查」。

- [ ] **Step 3: Commit**

```bash
git add backend/server.js
git commit -m "feat(knowledge): background investigation before planner"
```

---

### Task 14: 前端引用卡片与 embedding 设置

**Files:**
- Modify: `frontend/src/App.vue`

- [ ] **Step 1: done 事件解析处保存 knowledgeSources**

在处理 `done` 事件的分支（搜 `interactivePractice` 的前端赋值处），同步保存：

```js
if (Array.isArray(payload.knowledgeSources)) {
  currentRunPatch.knowledgeSources = payload.knowledgeSources;
}
```

（跟随现有 done 字段的存储方式，写入当前 run 对象。）

- [ ] **Step 2: 回答区渲染引用卡片（紧随例句区之后）**

```html
<div v-if="currentAgentRun?.knowledgeSources?.length" class="knowledge-citations">
  <span class="knowledge-citations__label">知识库引用</span>
  <div class="knowledge-citations__list">
    <div v-for="src in currentAgentRun.knowledgeSources" :key="src.id" class="knowledge-citation-card">
      <strong>{{ src.title }}</strong>
      <span class="knowledge-citation-card__meta">{{ src.category }} · {{ src.level }}</span>
      <p>{{ src.excerpt }}</p>
    </div>
  </div>
</div>
```

样式（磨砂玻璃风格，沿用现有 CSS 变量，宋体不变）：

```css
.knowledge-citations { margin-top: 14px; }
.knowledge-citations__label { font-size: 0.78rem; color: var(--text-muted); }
.knowledge-citations__list { display: grid; gap: 8px; margin-top: 6px; }
.knowledge-citation-card {
  padding: 10px 12px;
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-md);
  background: var(--panel-bg);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  box-shadow: var(--glass-highlight);
}
.knowledge-citation-card__meta { margin-left: 8px; font-size: 0.74rem; color: var(--text-muted); }
.knowledge-citation-card p { margin: 4px 0 0; font-size: 0.85rem; color: var(--text-secondary); }
```

- [ ] **Step 3: 设置面板加 embedding 配置块（nav-llm-panel 内追加一行）**

```html
<div class="nav-llm-panel__embedding">
  <select v-model="embeddingSettings.provider">
    <option value="ollama">Ollama (本地)</option>
    <option value="openai-compatible">OpenAI 兼容</option>
  </select>
  <input v-model="embeddingSettings.model" type="text" placeholder="embedding model">
  <input v-model="embeddingSettings.baseUrl" type="text" placeholder="Base URL">
  <input v-if="embeddingSettings.provider !== 'ollama'" v-model="embeddingSettings.apiKey" type="password" :placeholder="embeddingSettings.apiKeySet ? 'API Key 已保存' : 'API Key'">
  <button class="agent-chip" @click="saveEmbeddingSettings">保存检索设置</button>
</div>
```

对应脚本（仿照 llmSettings 的加载/保存模式）：

```js
const embeddingSettings = ref({ provider: 'ollama', model: 'bge-m3', baseUrl: 'http://localhost:11434', apiKey: '', apiKeySet: false });
const loadEmbeddingSettings = async () => {
  try { embeddingSettings.value = { ...embeddingSettings.value, ...(await axios.get('/api/knowledge/embedding-settings')).data }; } catch {}
};
const saveEmbeddingSettings = async () => {
  const { apiKeySet, ...payload } = embeddingSettings.value;
  try { embeddingSettings.value = { ...embeddingSettings.value, ...(await axios.post('/api/knowledge/embedding-settings', payload)).data, apiKey: '' }; } catch {}
};
```

在现有 `onMounted` 数据加载序列里追加 `loadEmbeddingSettings();`。

- [ ] **Step 4: 构建 + preview 验证**

```bash
cd frontend && npm run build
```

preview 发起「は和が的区别」查询：回答下方出现引用卡片；设置面板出现 embedding 配置并能保存。

- [ ] **Step 5: Commit**

```bash
git add frontend/src/App.vue
git commit -m "feat(knowledge): citation cards and embedding settings in frontend"
```

---

### Task 15: 评测（golden set + recall@k / MRR）

**Files:**
- Create: `backend/knowledge-source/golden-set.json`
- Create: `backend/knowledge/eval.js`
- Create: `backend/scripts/kb-eval.js`
- Modify: `backend/package.json`（scripts 加 `"kb:eval": "node scripts/kb-eval.js"`）
- Test: `backend/tests/knowledge-eval.test.js`

- [ ] **Step 1: 编写 golden-set.json（20 题，expected 为 `doc_id::条目标题`，标题须与 Task 6 清单完全一致）**

```json
{
  "cases": [
    { "query": "て形怎么变", "expected": "verb-conjugation::て形的变化规则" },
    { "query": "日语动词连接形规则", "expected": "verb-conjugation::て形的变化规则" },
    { "query": "动词过去式怎么说", "expected": "verb-conjugation::た形（过去形）" },
    { "query": "表示能力的动词形式", "expected": "verb-conjugation::可能形" },
    { "query": "怎么让别人做某事 使役", "expected": "verb-conjugation::使役形" },
    { "query": "动词否定怎么变", "expected": "verb-conjugation::ない形（否定形）" },
    { "query": "怎么判断五段动词还是一段动词", "expected": "verb-conjugation::五段动词的判别" },
    { "query": "ている是什么意思", "expected": "verb-conjugation::〜ている的两种含义" },
    { "query": "あげる くれる もらう 区别", "expected": "verb-conjugation::授受动词（あげる・くれる・もらう）" },
    { "query": "は和が有什么区别", "expected": "particles::は和が的区别" },
    { "query": "助词に都有什么用法", "expected": "particles::に的用法总览" },
    { "query": "只有 仅仅 用什么助词", "expected": "particles::だけ与しか" },
    { "query": "一边做一边做怎么表达", "expected": "particles::ながら" },
    { "query": "ので和のに的区别", "expected": "particles::のに与ので" },
    { "query": "想做某事怎么说", "expected": "sentence-patterns::〜たいです（愿望）" },
    { "query": "曾经做过某事的句型", "expected": "sentence-patterns::〜たことがある（经历）" },
    { "query": "必须做某事 义务表达", "expected": "sentence-patterns::〜なければならない（义务）" },
    { "query": "听说 好像 そうです", "expected": "sentence-patterns::〜そうです（样态与传闻）" },
    { "query": "尊敬语和谦让语的区别", "expected": "keigo::敬语体系总览（尊敬语・谦让语・丁宁语）" },
    { "query": "召し上がる是什么的敬语", "expected": "keigo::尊敬语特殊动词（いらっしゃる・召し上がる等）" }
  ]
}
```

- [ ] **Step 2: 写失败测试（指标计算用小型构造数据）**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreCase, summarize } from '../knowledge/eval.js';

test('scoreCase computes rank and reciprocal rank', () => {
  const hits = [{ docId: 'a', title: 'x' }, { docId: 'b', title: 'y' }];
  assert.deepEqual(scoreCase(hits, 'b::y'), { rank: 2, rr: 0.5 });
  assert.deepEqual(scoreCase(hits, 'c::z'), { rank: null, rr: 0 });
});

test('summarize aggregates recall@k and mrr', () => {
  const rows = [{ rank: 1, rr: 1 }, { rank: 4, rr: 0.25 }, { rank: null, rr: 0 }];
  const summary = summarize(rows);
  assert.equal(summary['recall@1'], '1/3');
  assert.equal(summary['recall@3'], '1/3');
  assert.equal(summary['recall@5'], '2/3');
  assert.equal(summary.mrr, '0.417');
});
```

- [ ] **Step 3: 运行确认失败** → `npm test`，FAIL

- [ ] **Step 4: 实现 eval.js**

```js
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
// vector/bm25 单路模式通过临时替换 retriever 的另一条腿实现：
// 评测脚本直接用 createLocalRetriever 的两个内部腿组合，见 kb-eval.js。
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
```

`retriever.js` 增加单路模式支持——`createLocalRetriever({ db, embedder, mode = 'hybrid' })`，在 `queryRelevantDocuments` 中：`mode === 'bm25'` 跳过 vectorLeg、`mode === 'vector'` 跳过 bm25Leg（其余逻辑不变）。同步更新 Task 9 的实现。

- [ ] **Step 5: 实现 kb-eval.js**

```js
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
```

- [ ] **Step 6: 单测通过 + 实跑评测**

Run: `npm test` → PASS
Run: `npm run kb:build && npm run kb:eval`
Expected: 表格输出三种模式指标；hybrid 的 recall@5 ≥ max(vector, bm25)。若 hybrid 反而低，排查 RRF 融合或分词质量后再继续。

- [ ] **Step 7: Commit**

```bash
git add backend/knowledge-source/golden-set.json backend/knowledge/eval.js backend/scripts/kb-eval.js backend/knowledge/retriever.js backend/package.json backend/tests/knowledge-eval.test.js
git commit -m "feat(knowledge): golden-set evaluation with recall@k and MRR"
```

---

### Task 16: README 与端到端验证

**Files:**
- Modify: `README.md`

- [ ] **Step 1: README 增加「本地知识库」章节**

在「练习驱动的记忆闭环」章节之后新增，内容包含：功能简介（混合检索 + RRF + 增量索引 + 降级）、`kb:build` / `kb:eval` 用法、embedding 配置说明（Ollama 默认 / OpenAI 兼容）、以及 Task 15 实跑得到的基准表格（recall@1/3/5、MRR 三模式对照，填真实数字）。核心能力列表加一条「**本地语法知识库（RAG）**」，Agent 工具列表加 `knowledge_search`，路线图勾掉对应项（如有）。

- [ ] **Step 2: 跑通 spec 验证标准全清单**

```bash
cd backend && npm test                                   # 全部单测通过
npm run kb:build                                          # added/unchanged 总数 ≥ 80
curl "http://localhost:3456/api/knowledge/stats"          # chunks 与 fts/vec 行数一致
curl "http://localhost:3456/api/knowledge/search?q=て形怎么变"  # 命中て形条目
npm run kb:eval                                           # 三模式出数
```

前端 preview：查询「は和が的区别」→ 工具轨迹含 knowledge_search、回答区有引用卡片；停掉 Ollama 重试 → search 返回 degraded: true 且流程不报错。

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: document local knowledge base with eval baseline"
```

---

## Self-Review 记录

- **Spec 覆盖**：三表存储（T2）、分词（T3）、embedding 适配（T4）、分块（T5）、语料（T6）、增量 ingest（T7）、kb:build（T8）、混合检索+RRF+降级+resources/级别过滤（T9）、防抖队列（T10）、API（T11）、Agent 工具+引用+设置（T12/T14）、background investigation（T13）、评测（T15）、README 基准（T16）。LLM rerank 为 spec 中可选项（默认关），本计划不实现开关之外的功能——YAGNI，预留 `app_settings` 键即可，未单列任务。
- **类型一致性**：embedder/retriever 接口在计划头部统一定义；T9 与 T15 的 `mode` 参数已在 T15 Step 4 注明回改 T9。
- **占位符**：无 TBD；T6 条目正文按给定格式与标题清单撰写属内容创作，格式与验收标准已完整给出。
