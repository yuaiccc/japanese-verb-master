# 本地语法知识库（RAG）设计（2026-06-10）

## 定位

为 Japanese Word Master 增加一个本地日语语法/教材知识库，供 LangGraph Agent 检索。项目定位为面试作品集，因此采用完整的 RAG 工程链路（数据管道 → 混合检索 → 融合重排 → Agent 集成 → 量化评测），不做最小可用版。

## 目标

- Agent 回答语法/用法类问题时优先命中本地知识，减少对外部搜索和 LLM 自身知识的依赖。
- 回答携带知识库引用，前端可见来源。
- 检索质量可量化（recall@k、MRR），混合检索与单路检索可对比。
- 完全本地运行（Ollama embedding），无本地模型时可切换 OpenAI 兼容接口，embedding 不可用时降级为纯 BM25。

## 非目标

- 不做多用户隔离（沿用现状单用户）。
- 不做前端知识库管理界面（条目维护走源文件 + 构建脚本；预留 CRUD API 便于演示）。
- 不引入独立向量数据库进程。

## 借鉴 DeerFlow 的设计模式

本项目 thread/run/subagent 运行时本就参考了 DeerFlow，知识库部分继续吸收它经典版（v1 deep-research）的四个模式：

1. **Retriever provider 抽象**（对应 DeerFlow `src/rag` 的 `Retriever` 接口）：`retriever.js` 对外暴露统一接口 `listResources()` / `queryRelevantDocuments(query, { resources, topK })`。默认实现 `LocalRetriever`（sqlite-vec + FTS5 + RRF）；接口层预留 `ragflow` 等外部 RAG provider 的接入位（`app_settings.rag_provider`，默认 `local`）。面试叙事：检索后端可插拔，本地实现零部署成本。
2. **Resources 作用域**：知识条目按源文档组织为 resource（URI 形如 `kb://grammar/verb-conjugation`，由源文件名生成）。检索与 Agent 工具支持 `resources` 参数限定范围，另支持 level/category 过滤。
3. **Background investigation**：参考 DeerFlow 在 Planner 之前的 background_investigation 节点——每轮 run 在 Planner 执行前先做一次轻量本地检索（top-3，仅标题+摘要），注入 Planner 上下文，使其在制定计划时就知道本地有哪些资料、是否还需要外部搜索。
4. **本地检索工具优先**：`knowledge_search` 注册为 Researcher 工具列表的第一位，提示词明确「本地知识库优先于 external_search」（DeerFlow 将 retriever_tool 排在 web search 之前的同款做法）。

## 架构

```
backend/knowledge/
  embeddings.js   # embedding 适配层：ollama / openai-compatible，维度自适应、缓存、重试
  ingest.js       # 分块、content-hash 增量索引、三表同步写入
  retriever.js    # Retriever 接口 + LocalRetriever：向量 KNN + BM25 双路召回 → RRF 融合 →（可选）LLM rerank
  eval.js         # 黄金问题集评测，输出 recall@k / MRR
backend/knowledge-source/
  *.md            # 语法点源文件（约 80 条，N5-N2：活用、助词、句型、敬语）
  golden-set.json # 约 20 题评测集（问题 → 应命中条目 id）
```

### 存储（dictionary.db 内，三表）

- `knowledge_chunks`：id、doc_id、title、content、level（N5-N1）、category（活用/助词/句型/敬语）、tags、source、content_hash、embedding_model、updated_at。
- `knowledge_vec`：sqlite-vec `vec0` 虚拟表，存 chunk embedding，KNN 查询。
- `knowledge_fts`：FTS5 虚拟表，kuromoji 分词后的内容，BM25 排序。

### 检索流程

1. query 经 embedding 适配层向量化；kuromoji 分词构造 FTS5 查询。
2. 两路各取 top-20：`knowledge_vec` KNN 与 `knowledge_fts` BM25。
3. RRF（k=60）融合排序，取 top-N（默认 5）。
4. 可选 LLM rerank（app_settings 开关，默认关）：当前 provider 对 top-10 重排。
5. embedding 服务不可用 → 自动降级纯 BM25，并在结果中标记 `degraded: true`。

### Ingestion（npm run kb:build）

1. 解析 `knowledge-source/*.md`（frontmatter 携带 level/category/tags），按语法点分块，长块带 overlap 切分。
2. 对每块计算 content hash；与库内对比，仅对新增/变更块调用 embedding（批量、重试、限流）。
3. 三表事务内同步写入；删除源文件中已不存在的块。

### Embedding 适配层

- provider：`ollama`（默认，模型 `bge-m3`）或 `openai-compatible`（baseUrl + apiKey + model，如 SiliconFlow）。
- 配置存 `app_settings`（embedding_provider / embedding_model / embedding_base_url / embedding_api_key）。
- 维度从首次调用结果自适应并校验一致；进程内 LRU 缓存 query 向量。

### Agent 集成

- Researcher 注册新工具 `knowledge_search(query, topK?, resources?, level?, category?)`，排在工具列表第一位，返回命中条目（title、content 摘录、level、category、score、id、resource URI）。
- Researcher 提示词调整：语法/用法类问题先调 `knowledge_search`，未命中再 `external_search`。
- **Background investigation**：Planner 节点执行前先跑一次轻量本地检索（top-3 标题+摘要）注入 Planner 上下文；无命中则注入「本地知识库无相关条目」提示。
- run 的 `done` 事件携带 `knowledgeSources`（命中条目元数据），前端在回答区渲染「知识库引用」卡片（磨砂玻璃风格、宋体，与现有样式一致）。

### API

- `GET /api/knowledge/search?q=&topK=`：直接检索（调试/演示用）。
- `POST /api/knowledge/reindex`：触发增量重建。
- `GET /api/knowledge/stats`：条目数、索引状态、embedding 配置摘要。
- `POST/PUT/DELETE /api/knowledge/chunks`：条目 CRUD（演示用，写入后自动重嵌）。

### 评测（npm run kb:eval）

- golden-set.json：约 20 题，每题标注应命中的 chunk id。
- 输出三种模式的 recall@1/3/5 与 MRR：纯向量、纯 BM25、混合 RRF。
- 结果打印为表格，README 收录一份基准数字。

## 依赖

新增 `sqlite-vec`（npm，加载进 better-sqlite3）。其余复用现有依赖（better-sqlite3、kuromoji、ollama）。

## 错误处理

- kb:build 时 embedding 批量失败：重试 3 次后跳过该块并汇总报告，不中断整体构建。
- 运行时 embedding 超时（3s）：降级 BM25。
- sqlite-vec 扩展加载失败：启动日志警告，knowledge_search 以 BM25-only 模式工作。

## 验证标准

- `npm run kb:build` 后 stats 显示 ≥80 条目、向量与 FTS 行数一致。
- `kb:eval` 三种模式出数，混合 RRF 的 recall@5 不低于任一单路。
- curl `/api/knowledge/search?q=て形怎么变` 命中て形相关条目。
- 完整 Agent 查询「は和が的区别」时工具轨迹出现 knowledge_search，回答区显示引用卡片。
- 关闭 Ollama 后检索仍可用（degraded 标记），Agent 流程不报错。

## 面试叙事要点（开发时保持可讲性）

- 混合检索为什么比单路好：向量召回语义近邻、BM25 抓关键词精确命中，RRF 无需调权重。
- Retriever provider 抽象与 background investigation 借鉴 DeerFlow v1 的 RAG 集成模式，可对照讲两个项目的取舍（外部 RAG 服务 vs 进程内本地检索）。
- 增量索引：content hash 避免全量重嵌，构建成本 O(变更)。
- 降级设计：embedding 依赖不可用时系统仍可服务。
- 评测驱动：golden set + recall/MRR，检索改动有量化依据。
