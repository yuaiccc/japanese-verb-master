import express from 'express';
import cors from 'cors';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import { AsyncLocalStorage } from 'node:async_hooks';
import kuromoji from 'kuromoji';
import * as wanakana from 'wanakana';
import { conjugate } from './conjugationEngine';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import https from 'https';
import {
  searchWords,
  findWord,
  bulkInsert,
  AGENT_MEMORY_TYPES,
  findSimilarWords,
  getMemorySettings,
  saveMemorySettings,
  saveLlmSettings,
} from './db';
import db from './db';
import { ensureKnowledgeSchema } from './knowledge/schema';
import { createEmbedder } from './knowledge/embeddings';
import { createRetriever } from './knowledge/retriever';
import { createReranker } from './knowledge/rerank';
import { createQueryRewriter } from './knowledge/rewrite';
import { createMetrics } from './knowledge/metrics';
import { createReindexQueue } from './knowledge/queue';
import { ingestKnowledge } from './knowledge/ingest';
import { registerKnowledgeRoutes } from './knowledge/routes';
import { getKnowledgeEmbeddingSettings, saveKnowledgeEmbeddingSettings } from './knowledge/settings';
import { setTokenizer as setKnowledgeTokenizer } from './knowledge/tokenize';
import { createPaymentProvider, SKUS } from './payments/provider';
import {
  hashPassword,
  verifyPassword,
  signToken,
  authOptional,
  identityRequired,
  DEFAULT_USER_ID
} from './auth';
import {
  buildDailyQuota,
  buildStoreReviewQueue,
  createUserStore
} from './userStore';
import { getTurnstileConfig, verifyTurnstileToken } from './turnstile';
import { getSceneById, getSceneCatalog, getSceneIdsForVerb, getVerbsForScene } from './sceneData';
import {
  extractJapaneseTerms,
  detectLearningIntent,
  getAgentQueue,
  learningSubagentRegistry,
  pickScopedTools,
  selectSpecialistSubagents
} from './learningSubagents';
import { formatPlannerNote } from './subagentContexts';
import { buildSpecialistNodeExecutor } from './subagentNodeHelpers';
import { SubagentExecutor } from './subagentExecutor';
import {
  getBackgroundTaskResult,
  listBackgroundTasks,
  configureSubagentTaskStore,
  requestCancelBackgroundTask,
  requestCancelTasksForRun
} from './subagentTaskRuntime';
import {
  buildFeishuAgentContext,
  createFeishuClient,
  createFeishuLongConnection,
  createRecentEventDedupe,
  FEISHU_CONNECTION_MODES,
  parseFeishuTextMessage
} from './integrations/feishu';
import { addLangSmithEvent, traceLangSmithRun } from './tracing/langsmith';
import { writeSse, prepareSse, parseToolCallArgs, emitAgentQueue, emitTextAsTokens } from './agent/sse';
import {
  ollama, providerDefaults, contextWindowByModel, llmRequestStore,
  getModelContextWindow, buildAgentRunTitle, getTokenEncoder, estimateChatTokens,
  buildUsageReport, getRuntimeLlmSettings, getLlmProvider, getDefaultLlmModel,
  buildChatCompletionsUrl, callOpenAiCompatibleChat, callOpenAiCompatibleChatImpl,
  callLlmText, callLlmTextImpl, pipeLlmStreamToSse, streamLlmText, streamLlmTextImpl
} from './llm/provider';
import { setTokenizer, getTokenizer } from './tokenizer';
import * as agentHelpers from './agent/helpers';
import { configureAgentTools, searchJisho, lookupWordJisho, agentTools, executeAgentTool, externalJapaneseSearch, summarizeToolResult } from './agent/tools';
import { createLearningAgentGraph, configureAgentGraph } from './agent/graph';
import { registerAgentRoutes } from './routes/agent';
import { registerMemoryRoutes } from './routes/memory';
import { registerDictionaryRoutes } from './routes/dictionary';
import { registerSystemRoutes } from './routes/system';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 读取动词库（conjugationEngine 辅助数据，保留）
const commonVerbs = JSON.parse(fs.readFileSync(path.join(__dirname, 'common-verbs.json'), 'utf8'));
const sceneCatalog = getSceneCatalog(commonVerbs);
// formLabelMap 已抽离至 agent/helpers.js
const defaultHotPlaceholderExamples = [
  '问日语：食べる 和 召し上がる 有什么区别',
  '问日语：为什么 〜ている 有时表示状态',
  '问日语：给我 3 个便利店场景例句',
  '问日语：把 猫 翻成日语并推荐相近词'
];
const hotPlaceholderCache: {
  updatedAt: number;
  ttlMs: number;
  source: string;
  examples: string[];
} = {
  updatedAt: 0,
  ttlMs: 30 * 60 * 1000,
  source: 'fallback',
  examples: [...defaultHotPlaceholderExamples]
};

function getDateKey(value: string | number | Date): string {
  const date = new Date(value);
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

function decodeXmlEntities(text: string = ''): string {
  return String(text || '')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'");
}

function stripFeedSource(title: string = ''): string {
  return String(title || '')
    .replace(/\s*[-｜|]\s*[^-｜|]+$/u, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function compactHotTopic(title: string = ''): string {
  const stripped = stripFeedSource(title)
    .replace(/（[^）]*）/g, '')
    .replace(/\([^)]*\)/g, '')
    .replace(/[「」『』【】]/g, '')
    .trim();
  if (!stripped) return '';

  const firstClause = stripped.split(/[、。！？!?:：]/)[0]?.trim() || stripped;
  const candidate = firstClause.length >= 6 ? firstClause : stripped;
  return candidate.length > 24 ? `${candidate.slice(0, 24)}…` : candidate;
}

function buildHotPlaceholderExamplesFromTitles(titles: string[] = []): string[] {
  const prompts: string[] = [];
  const patterns = [
    (topic: string) => `问日语：用简单日语解释「${topic}」`,
    (topic: string) => `问日语：围绕「${topic}」给我 3 个场景例句`,
    (topic: string) => `问日语：把「${topic}」改写成更自然的日语表达`,
    (topic: string) => `问日语：看到「${topic}」时，日语里常怎么说`
  ];

  titles.slice(0, 6).forEach((title, index) => {
    const topic = compactHotTopic(title);
    if (!topic) return;
    prompts.push(patterns[index % patterns.length](topic));
  });

  return [...new Set(prompts)].slice(0, 6);
}

async function fetchHotPlaceholderExamples(force: boolean = false): Promise<typeof hotPlaceholderCache> {
  if (!force && Date.now() - hotPlaceholderCache.updatedAt < hotPlaceholderCache.ttlMs && hotPlaceholderCache.examples.length > 0) {
    return hotPlaceholderCache;
  }

  try {
    const response = await fetch('https://news.google.com/rss?hl=ja&gl=JP&ceid=JP:ja', {
      headers: {
        'User-Agent': 'JapaneseWordMaster/1.0 (+https://localhost)'
      }
    });
    if (!response.ok) {
      throw new Error(`Hot placeholders upstream failed: ${response.status}`);
    }
    const xml = await response.text();
    const matches = [...xml.matchAll(/<item>[\s\S]*?<title>([\s\S]*?)<\/title>/g)];
    const titles = matches
      .map(match => decodeXmlEntities(match[1]))
      .map(stripFeedSource)
      .filter(Boolean)
      .filter(title => !/Google ニュース|トップニュース/.test(title));
    const examples = buildHotPlaceholderExamplesFromTitles(titles);

    if (examples.length > 0) {
      hotPlaceholderCache.updatedAt = Date.now();
      hotPlaceholderCache.source = 'google-news-jp';
      hotPlaceholderCache.examples = examples;
      return hotPlaceholderCache;
    }
  } catch (error) {
    console.error('Failed to refresh hot placeholders:', (error as Error).message);
  }

  if (!hotPlaceholderCache.updatedAt) {
    hotPlaceholderCache.updatedAt = Date.now();
  }
  hotPlaceholderCache.source = hotPlaceholderCache.source || 'fallback';
  hotPlaceholderCache.examples = hotPlaceholderCache.examples?.length > 0
    ? hotPlaceholderCache.examples
    : [...defaultHotPlaceholderExamples];
  return hotPlaceholderCache;
}

// buildPracticeProfile 已抽离至 agent/helpers.js

function buildUserProfile({ memoryCards = [], practiceProfile }: any): any {
  const cardsByType = memoryCards.reduce((acc: Record<string, number>, card: any) => {
    const key = card.wordType || 'other';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const focusWordType = (Object.entries(cardsByType) as [string, number][])
    .sort((a, b) => b[1] - a[1])[0]?.[0] || 'verb';
  const dueCards = memoryCards.filter((card: any) => new Date(card.dueAt).getTime() <= Date.now());
  const strongestScene = practiceProfile.sceneStats?.slice().sort((a: any, b: any) => b.accuracy - a.accuracy)[0] || null;
  const weakestForm = practiceProfile.weakestForms?.[0] || null;

  return {
    summary: [
      `当前已沉淀 ${memoryCards.length} 张记忆卡`,
      weakestForm ? `最近最需要巩固的是 ${weakestForm.label}` : '正在建立你的薄弱项画像',
      strongestScene ? `相对更熟悉的场景是 ${strongestScene.name}` : '场景偏好还在形成中'
    ].join('，'),
    learningStyle: dueCards.length > 12 ? 'review-heavy' : memoryCards.length < 10 ? 'exploring' : 'balanced',
    focusWordType,
    reviewLoad: {
      total: memoryCards.length,
      due: dueCards.length,
      mastered: memoryCards.filter((card: any) => card.intervalDays >= 7).length
    },
    weakestForm,
    strongestScene,
    recentAccuracy: practiceProfile.accuracy,
    recommendations: [
      dueCards.length > 0 ? `先清掉 ${dueCards.length} 张到期卡` : null,
      weakestForm ? `优先专项练 ${weakestForm.label}` : null,
      focusWordType === 'verb' ? '继续围绕动词群扩展记忆' : '增加跨词性词汇输入'
    ].filter(Boolean).slice(0, 3)
  };
}

function shuffleArray<T>(items: T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function extractLookupForAgent(payload: any = {}): any {
  const word = payload.dictionaryForm || payload.word || payload.verb || payload.kanji || '';
  const reading = payload.reading || payload.kana || '';
  const wordType = payload.wordType || (payload.dictionaryForm ? 'verb' : 'other');
  const meaning = payload.meaning || payload.meanings?.map((item: any) => item.definitions).filter(Boolean).join('; ') || '';
  return {
    word,
    reading,
    wordType,
    verbType: payload.verbType || '',
    meaning
  };
}

function getVerbSceneSuggestions(word: string): any[] {
  const sceneIds = getSceneIdsForVerb(word);
  return sceneIds
    .map(id => getSceneById(id))
    .filter(Boolean)
    .map((scene: any) => ({
      id: scene.id,
      name: scene.name,
      reason: `「${word}」常出现在${scene.name}场景，可直接进入专项练习。`
    }));
}

// buildVerbSimilarWords 已抽离至 agent/helpers.js

function buildLearningAgentPayload({ lookup, profile, memoryCards, similarWords }: any): any {
  const dueCards = memoryCards.filter((card: any) => new Date(card.dueAt).getTime() <= Date.now());
  const weakForm = profile.weakestForms?.[0];
  const scenes = lookup.wordType === 'verb' ? getVerbSceneSuggestions(lookup.word) : [];
  const recommendedActions: any[] = [];

  if (lookup.word) {
    recommendedActions.push({
      type: 'memory',
      title: `把「${lookup.word}」加入记忆卡`,
      detail: '保存释义、读音和例句，后续按间隔复习。'
    });
  }
  if (similarWords.length > 0) {
    recommendedActions.push({
      type: 'similar',
      title: '扩展同组词',
      detail: `优先看 ${similarWords.slice(0, 3).map((item: any) => item.kanji).join('、')}，形成词群记忆。`
    });
  }
  if (weakForm) {
    recommendedActions.push({
      type: 'practice',
      title: `巩固${weakForm.label}`,
      detail: `最近该形式正确率 ${weakForm.accuracy}%，适合做 10 题专项练习。`
    });
  }
  if (dueCards.length > 0) {
    recommendedActions.unshift({
      type: 'review',
      title: `先复习 ${dueCards.length} 张到期卡`,
      detail: '复习优先级高于继续加新词，避免越学越散。'
    });
  }

  const coachNote = lookup.word
    ? `今天围绕「${lookup.word}」建立一个小词群：先确认读音和含义，再扩展相似词，最后用记忆卡安排复习。`
    : '先查一个目标词，agent 会把它转成可复习、可练习、可扩展的学习任务。';

  return {
    coachNote,
    lookup,
    similarWords,
    sceneSuggestions: scenes,
    recommendedActions,
    memory: {
      total: memoryCards.length,
      due: dueCards.length,
      mastered: memoryCards.filter((card: any) => card.intervalDays >= 7).length
    },
    profile
  };
}

// searchDuckDuckGo / searchMediaWiki / externalJapaneseSearch 已抽离至 agent/tools.js

// agentTools / executeAgentTool / executeAgentToolImpl / summarizeToolResult 已抽离至 agent/tools.js

// SSE 辅助函数已抽离至 agent/sse.js

// Agent 辅助函数（memoryCandidatesFromToolResult ~ generateStructuredAgentExamples）已抽离至 agent/helpers.js

// emitTextAsTokens 已抽离至 agent/sse.js

// LearningAgentState / createLearningAgentGraph 已抽离至 agent/graph.js

// streamLlmText / streamLlmTextImpl 逻辑已抽离至 llm/provider.js

// searchJisho / lookupWordJisho 已抽离至 agent/tools.js

// 初始化 Ollama
const app = express();
const userStore = await createUserStore();
configureSubagentTaskStore(userStore);
const PORT = Number(process.env.PORT) || 3456;
// 容器环境（Render/Docker/Fly 等）必须监听 0.0.0.0 才能从外部访问；
// 本地默认绑回环更安全。Render 自动注入 RENDER=true 让我们识别。
const HOST = process.env.HOST || (process.env.RENDER ? '0.0.0.0' : '127.0.0.1');
const feishuClient = createFeishuClient();
const shouldProcessFeishuEvent = createRecentEventDedupe();
let feishuLongConnection: any = null;

// 中间件
// 跨域：默认放开（演示/开发），生产可设 CORS_ORIGIN 为具体域名收紧。
// Authorization 必须放行；X-LLM-* 是用户自带 key 的运行时覆盖（每请求生效，不入库）。
app.use(cors({
  origin: process.env.CORS_ORIGIN || (process.env.NODE_ENV === 'production' ? false : '*'),
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-LLM-API-Key', 'X-LLM-Provider', 'X-LLM-Base-Url', 'X-LLM-Model']
}));
app.use(express.json());
app.set('trust proxy', 1);

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: '注册请求过于频繁，请稍后再试' }
});
const guestLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: '访客身份创建过于频繁，请稍后再试' }
});
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: '登录尝试过于频繁，请稍后再试' }
});
const agentLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  keyGenerator: (req: any) => req.isAuthed || req.isGuest
    ? `user:${req.userId}`
    : `ip:${ipKeyGenerator(req.ip)}`,
  message: { error: 'Agent 请求过于频繁，请稍后再试' }
});

// 请求级 LLM 配置覆盖：前端把用户的 key/配置放在 header 里，每请求独立、不入库；
// getRuntimeLlmSettings 取此 store 作最高优先级，避免共享一把 key 被打爆额度。
// llmRequestStore 已抽离至 llm/provider.js（通过顶部 import 引入）
app.use((req: any, _res: any, next: any) => {
  const apiKey = String(req.headers['x-llm-api-key'] || '').trim();
  if (!apiKey) return next();
  const override = {
    apiKey,
    provider: String(req.headers['x-llm-provider'] || '').trim() || undefined,
    baseUrl: String(req.headers['x-llm-base-url'] || '').trim() || undefined,
    model: String(req.headers['x-llm-model'] || '').trim() || undefined
  };
  llmRequestStore.run(override, () => next());
});

// 用户认证：userStore 初始化 users 表 + 默认用户；authOptional 给每个请求挂 req.userId
// （未登录或历史数据 fallback 到默认用户 1，保证向后兼容、不破坏现有功能）
app.use(authOptional);
const userRequestStore = new AsyncLocalStorage();
app.use((req: any, _res: any, next: any) => {
  userRequestStore.run({ userId: req.userId }, () => next());
});

app.use([
  '/api/entitlements',
  '/api/payments',
  '/api/practice-profile',
  '/api/user-profile',
  '/api/practice-records',
  '/api/dojo-agent-turn',
  '/api/dojo-quiz',
  '/api/memory-cards',
  '/api/memory-review-queue',
  '/api/agent-memory',
  '/api/agent-runs',
  '/api/agent-thread-summary',
  '/api/subagent-tasks',
  '/api/agent/run',
  '/api/agent/stream',
  '/api/agent/follow-ups',
  '/api/llm-settings',
  '/api/memory-settings',
  '/api/knowledge/embedding-settings'
], identityRequired);

// 认证路由（/api/auth/*）已抽离至 routes/system.js

// 初始化本地语法知识库（RAG）
ensureKnowledgeSchema(db);
const knowledgeSettings = getKnowledgeEmbeddingSettings(db);
const knowledgeEmbedder = createEmbedder(knowledgeSettings);
// 精排器复用线上 LLM provider（callLlmText 为函数声明，已 hoist）；失败自动降级为融合顺序。
const knowledgeReranker = createReranker({ chatFn: callLlmText });
const knowledgeRewriter = createQueryRewriter({ chatFn: callLlmText });
const knowledgeMetrics = createMetrics();
const knowledgeRetriever = createRetriever({ db, embedder: knowledgeEmbedder, ragProvider: knowledgeSettings.ragProvider, reranker: knowledgeReranker, metrics: knowledgeMetrics });
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
app.get('/api/knowledge/metrics', (_req: any, res: any) => {
  res.json(knowledgeMetrics.snapshot());
});

// 注入运行时实例到 Agent 工具和图模块
configureAgentTools({ knowledgeRetriever, knowledgeRewriter, userRequestStore, userStore });
configureAgentGraph({ knowledgeRetriever });

// === 支付（A2A demo：应用发起订单，资金确认权在用户）===
const paymentProvider = await createPaymentProvider({ store: userStore });

// 支付路由（/api/payments/*, /api/entitlements）已抽离至 routes/system.js
// 知识库 embedding 设置路由（/api/knowledge/embedding-settings）已抽离至 routes/memory.js

let tokenizer: any = null;

// 初始化 Kuromoji 分词器
const dicPath = path.join(__dirname, 'node_modules/kuromoji/dict');
kuromoji.builder({ dicPath }).build((err: any, _tokenizer: any) => {
  if (err) {
    console.error('Failed to build Kuromoji tokenizer:', err);
  } else {
    tokenizer = _tokenizer;
    setTokenizer(_tokenizer);
    setKnowledgeTokenizer(_tokenizer);
    console.log('Kuromoji tokenizer ready');
  }
});

// detectVerbType 已抽离至 agent/helpers.js

// LLM Provider 逻辑已抽离至 llm/provider.js

// 用 Ollama 将英文释义翻译为中文
async function translateMeaningsToChinese(meanings: any[]): Promise<any[]> {
  try {
    const englishDefs = meanings.map((m, i) => `${i + 1}. [${m.pos}] ${m.definitions}`).join('\n');
    const content = await callLlmText({
      messages: [{
        role: 'user',
        content: `将以下日语单词的英文释义翻译为简洁的中文。每条保持编号，只输出中文翻译，不要输出原文、词性或任何解释。格式："1. 中文释义"\n\n${englishDefs}`
      }],
      maxTokens: 700
    });
    const lines = content.trim().split('\n').filter(l => l.trim());
    return meanings.map((m, i) => ({
      ...m,
      definitions_en: m.definitions,
      definitions: lines[i]?.replace(/^\d+\.\s*/, '').replace(/^\[.*?\]\s*/, '').trim() || m.definitions
    }));
  } catch (e) {
    console.error('Translation failed, using English:', (e as Error).message);
    return meanings;
  }
}

// 用 kuromoji 为日语文本生成 furigana（ruby HTML）
function generateFuriganaHtml(text: string): string {
  if (!tokenizer || !text) return text;

  const tokens = tokenizer.tokenize(text);
  let html = '';

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const surface = token.surface_form;
    const reading = token.reading; // カタカナ

    // 判断 surface 中是否含有汉字
    const hasKanjiChar = /[\u4E00-\u9FFF\u3400-\u4DBF\uF900-\uFAFF]/.test(surface);

    if (reading && hasKanjiChar) {
      const readingHira = wanakana.toHiragana(reading);
      // 对混合词（如「食べる」）做精确拆分
      html += rubyForMixedToken(surface, readingHira);

      // 跳过紧跟在汉字后面的重复读音假名（AI 常把读音写在汉字后面，如「夜よる」）
      let readingToMatch = readingHira;
      // 对混合词，提取汉字部分的读音（如「食べる」→ 只匹配「たべる」中去掉送假名的「た」）
      // 简化处理：用完整读音匹配
      let j = i + 1;
      let accumulated = '';
      while (j < tokens.length && readingToMatch.length > 0) {
        const nextSurface = tokens[j].surface_form;
        const nextHasKanji = /[\u4E00-\u9FFF\u3400-\u4DBF\uF900-\uFAFF]/.test(nextSurface);
        if (nextHasKanji) break; // 遇到下一个汉字就停止
        const nextHira = wanakana.toHiragana(nextSurface);
        accumulated += nextHira;
        if (readingToMatch === accumulated) {
          // 后续假名完全匹配当前汉字读音，跳过这些 token
          i = j;
          break;
        } else if (readingToMatch.startsWith(accumulated)) {
          // 部分匹配，继续累积
          j++;
        } else if (accumulated.startsWith(readingToMatch)) {
          // 当前 token 包含读音前缀 + 额外内容（如「鳴」读音「な」后跟 token「なき」）
          // 跳过重复的读音前缀，保留后面的真实内容
          const redundantLen = readingToMatch.length - (accumulated.length - nextHira.length);
          if (redundantLen > 0 && redundantLen <= nextSurface.length) {
            html += escapeHtml(nextSurface.slice(redundantLen));
            i = j;
          }
          break;
        } else {
          break; // 不匹配，停止
        }
      }
    } else {
      html += escapeHtml(surface);
    }
  }

  return html;
}

// 对单个 token 做汉字/假名拆分，生成 ruby 标签
function rubyForMixedToken(surface: string, reading: string): string {
  const isKanjiChar = (ch: string) => /[\u4E00-\u9FFF\u3400-\u4DBF\uF900-\uFAFF]/.test(ch);
  const segments: { type: string; text: string }[] = [];
  let i = 0;

  // 将 surface 拆分成 [汉字段, 假名段, 汉字段, ...] 的序列
  while (i < surface.length) {
    if (isKanjiChar(surface[i])) {
      let end = i;
      while (end < surface.length && isKanjiChar(surface[end])) end++;
      segments.push({ type: 'kanji', text: surface.substring(i, end) });
      i = end;
    } else {
      let end = i;
      while (end < surface.length && !isKanjiChar(surface[end])) end++;
      segments.push({ type: 'kana', text: surface.substring(i, end) });
      i = end;
    }
  }

  // 如果整个 token 都是汉字，直接整体加 ruby
  if (segments.length === 1 && segments[0].type === 'kanji') {
    return `<ruby>${escapeHtml(surface)}<rt>${escapeHtml(reading)}</rt></ruby>`;
  }

  // 用假名段作为锚点，从 reading 中定位每段汉字的读音
  // 构建正则：将假名段作为固定匹配，汉字段用 (.+?) 捕获
  let regexStr = '^';
  for (const seg of segments) {
    if (seg.type === 'kana') {
      // 将假名转为平假名用于匹配
      regexStr += escapeRegex(wanakana.toHiragana(seg.text));
    } else {
      regexStr += '(.+?)';
    }
  }
  regexStr += '$';

  try {
    const regex = new RegExp(regexStr);
    const match = reading.match(regex);

    if (match) {
      let html = '';
      let captureIdx = 1;
      for (const seg of segments) {
        if (seg.type === 'kanji') {
          html += `<ruby>${escapeHtml(seg.text)}<rt>${escapeHtml(match[captureIdx])}</rt></ruby>`;
          captureIdx++;
        } else {
          html += escapeHtml(seg.text);
        }
      }
      return html;
    }
  } catch {
    // regex 构建失败时 fallback
  }

  // fallback: 整体加 ruby
  return `<ruby>${escapeHtml(surface)}<rt>${escapeHtml(reading)}</rt></ruby>`;
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeDojoAnswer(text: string = ''): string {
  return wanakana.toHiragana(String(text || ''))
    .replace(/\s+/g, '')
    .replace(/[・ー]/g, '');
}

// 标准答案由读音假名生成，但用户可能用汉字作答（如「歌え」对「うたえ」）。
// 根据 verb（汉字形）与 reading（假名形）的公共词尾推导出答案的汉字写法变体。
function buildDojoAnswerVariants(question: any = {}): Set<string> {
  const variants = new Set<string>();
  const answer = String(question.answer || '');
  if (!answer) return variants;
  variants.add(normalizeDojoAnswer(answer));

  const verb = String(question.verb || '');
  const reading = String(question.reading || question.kana || '');
  if (verb && reading && verb !== reading) {
    let tail = 0;
    while (
      tail < verb.length &&
      tail < reading.length &&
      verb[verb.length - 1 - tail] === reading[reading.length - 1 - tail]
    ) {
      tail += 1;
    }
    const kanjiStem = verb.slice(0, verb.length - tail);
    const readingStem = reading.slice(0, reading.length - tail);
    if (kanjiStem && readingStem && answer.startsWith(readingStem)) {
      variants.add(normalizeDojoAnswer(kanjiStem + answer.slice(readingStem.length)));
    }
  }
  return variants;
}

function buildDojoHint(question: any = {}): string {
  const answer = String(question.answer || '');
  const difficultyLevel = question.difficultyLevel || 'N3';
  if (!answer) return '先想想这个变形对应的是哪一种结尾变化。';
  if (difficultyLevel === 'N5' || difficultyLevel === 'N4') {
    return `提示：先看原形词尾，再想 ${question.formLabel || '这个变形'} 的基础变化，答案开头是「${answer[0]}」。`;
  }
  if (difficultyLevel === 'N2' || difficultyLevel === 'N1') {
    return `提示：先判断词尾所属活用组，再排除容易混淆的相近形式，答案开头是「${answer[0]}」。`;
  }
  return `提示：答案一共 ${answer.length} 个假名，开头是「${answer[0]}」。`;
}

function buildDojoExplanation(question: any = {}, isCorrect: boolean = false): string {
  const verb = question.verb || '这个动词';
  const label = question.formLabel || question.formKey || '目标变形';
  const answer = question.answer || '';
  const difficultyLevel = question.difficultyLevel || 'N3';
  if (isCorrect) {
    return difficultyLevel === 'N5' || difficultyLevel === 'N4'
      ? `很好，${verb} 的 ${label} 就是「${answer}」。继续保持先看词尾再变形的思路。`
      : `很好，${verb} 的 ${label} 就是「${answer}」。继续保持这种先判断词尾再变形的思路。`;
  }
  return difficultyLevel === 'N2' || difficultyLevel === 'N1'
    ? `${verb} 这一题考的是 ${label}，正确写法是「${answer}」。先判断活用组，再和相邻变形区分，会更稳。`
    : `${verb} 这一题考的是 ${label}，正确写法是「${answer}」。先确认原形尾音，再套对应变形规则会更稳。`;
}

async function generateDojoAgentCopy({ mode = 'check', question = {}, userAnswer = '', isCorrect = false }: any = {}): Promise<string> {
  const fallback = mode === 'hint'
    ? buildDojoHint(question)
    : buildDojoExplanation(question, isCorrect);

  if (getLlmProvider() === 'ollama') {
    return fallback;
  }

  try {
    const prompt = mode === 'hint'
      ? `你是日语动词练习里的 Dojo Coach。当前学习者目标难度是 ${question.difficultyLevel || 'N3'}。只输出一句中文提示，不要直接说出完整答案，要帮助学习者自己想出来，限制 35 字内，提示语难度要匹配该等级。`
      : `你是日语动词练习里的 Dojo Coach。当前学习者目标难度是 ${question.difficultyLevel || 'N3'}。只输出一句中文讲解，说明这题为什么对或错，限制 50 字内，讲解深度要匹配该等级。`;
    const text = await callLlmText({
      messages: [
        { role: 'system', content: prompt },
        {
          role: 'user',
          content: JSON.stringify({
            question,
            userAnswer,
            isCorrect
          })
        }
      ],
      model: getDefaultLlmModel(),
      temperature: 0.2,
      maxTokens: 120
    });
    return text.trim() || fallback;
  } catch {
    return fallback;
  }
}

// 系统路由（/health, /api/llm-status, /api/hot-placeholders, /api/llm-settings）已抽离至 routes/system.js

function verifyFeishuToken(payload: any = {}): boolean {
  const expected = String(process.env.FEISHU_VERIFICATION_TOKEN || '').trim();
  if (!expected) return true;
  return String(payload.token || payload.header?.token || '').trim() === expected;
}

function truncatePlatformReply(text: string = '', limit: number = 3500): string {
  const normalized = String(text || '').trim() || '我暂时没有生成有效回答。';
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, limit - 20)}\n\n（内容较长，已截断）`;
}

async function processFeishuMessage(parsed: any, { dedupe = true }: any = {}): Promise<void> {
  if (dedupe && !shouldProcessFeishuEvent(parsed.eventId || parsed.messageId)) {
    return;
  }
  const context = buildFeishuAgentContext(parsed);
  const result = await runToolCallingAgent({
    message: parsed.text,
    context
  });
  await feishuClient.replyText(parsed.messageId, truncatePlatformReply(result.answer));
}

async function startFeishuLongConnection(): Promise<void> {
  const mode = String(process.env.FEISHU_CONNECTION_MODE || FEISHU_CONNECTION_MODES.DISABLED).trim().toLowerCase();
  if (mode !== FEISHU_CONNECTION_MODES.WEBSOCKET) return;

  try {
    feishuLongConnection = await createFeishuLongConnection({
      onMessage: processFeishuMessage
    });
    await feishuLongConnection.start();
    console.log('[feishu] long connection started.');
  } catch (error) {
    console.error('[feishu] long connection disabled:', (error as Error).message || error);
  }
}

// 飞书 webhook 路由已抽离至 routes/system.js
// Agent 子任务/运行管理路由（/api/subagent-tasks, /api/agent-runs）已抽离至 routes/agent.js

// 词典路由（/api/furigana, /api/ai-models, /api/scenes, /api/practice-profile,
// /api/user-profile, /api/practice-records）已抽离至 routes/dictionary.js

// 记忆卡片路由（/api/memory-cards, /api/memory-review-queue, /api/memory-settings,
// /api/dojo-agent-turn, /api/knowledge/embedding-settings）及辅助函数
// recordAgentPracticeToMemory 已抽离至 routes/memory.js
// Agent 路由（/api/agent-memory, /api/similar-words, /api/agent/learning-plan）已抽离至 routes/agent.js

async function runToolCallingAgent({ message, context = {} }: any): Promise<any> {
  if (!message || !message.trim()) {
    throw new Error('Missing agent message.');
  }

  const systemPrompt = `你是 Japanese Word Master 的日语学习 Agent。
你必须像 DeerFlow 风格的垂类 agent 一样工作：先判断是否需要工具，然后调用工具获取事实。
可用工具包括外部搜索、词典查询、相似词推荐、记忆状态、加入记忆卡。
回答要求：
1. 用中文回答，必要时保留日语原文。
2. 解释你用了哪些工具和结论依据。
3. 如果涉及日语语法/词义/例句，优先用工具结果，不要凭空编造。
4. 给出下一步可执行学习动作。`;

  const userContent = JSON.stringify({
    userMessage: message,
    currentLookup: context.lookup || null,
    memoryStats: context.memoryStats || null,
    userProfile: context.userProfile || null,
    channel: context.channel || 'web',
    sessionId: context.sessionId || null,
    platformUserId: context.platformUserId || null,
    exampleDifficulty: context.exampleDifficulty || getMemorySettings().exampleDifficulty || 'auto'
  });

  if (getLlmProvider() === 'ollama') {
    const searchResult = await externalJapaneseSearch(message);
    const answer = await callLlmText({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `${userContent}\n\n工具结果：${JSON.stringify(searchResult)}` }
      ],
      maxTokens: 1000
    });
    return {
      answer,
      toolCalls: [{ name: 'external_search', arguments: { query: message }, result: summarizeToolResult(searchResult) }]
    };
  }

  const messages: any[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userContent }
  ];
  const toolCalls: any[] = [];

  for (let i = 0; i < 4; i++) {
    const response = await callOpenAiCompatibleChat({
      messages,
      model: getDefaultLlmModel(),
      stream: false,
      temperature: 0.25,
      maxTokens: 1200,
      tools: agentTools,
      toolChoice: 'auto'
    });
    const data = await response.json();
    const assistantMessage = data.choices?.[0]?.message;
    if (!assistantMessage) break;

    if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
      return { answer: assistantMessage.content || '', toolCalls };
    }

    messages.push(assistantMessage);

    for (const call of assistantMessage.tool_calls) {
      const name = call.function?.name;
      let args: any = {};
      try {
        args = JSON.parse(call.function?.arguments || '{}');
      } catch {
        args = {};
      }
      const result = await executeAgentTool(name, args);
      toolCalls.push({
        name,
        arguments: args,
        result: summarizeToolResult(result)
      });
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify(result)
      });
    }
  }

  const finalAnswer = await callLlmText({
    messages: [
      ...messages,
      { role: 'user', content: '请基于以上工具结果给出最终学习建议。' }
    ],
    model: getDefaultLlmModel(),
    temperature: 0.25,
    maxTokens: 1200
  });
  return { answer: finalAnswer, toolCalls };
}

// Agent 路由（/api/agent/run, /api/agent/stream, /api/agent/follow-ups）已抽离至 routes/agent.js

// 词典路由（/api/ai-explain, /api/suggest, /api/conjugate, /api/verb-types,
// /api/dojo-quiz）已抽离至 routes/dictionary.js

// === 路由注册（从 server.js 抽离至 routes/ 目录）===
registerAgentRoutes(app, {
  userStore,
  agentLimiter,
  prepareSse,
  writeSse,
  getRuntimeLlmSettings,
  detectLearningIntent,
  getAgentQueue,
  buildAgentRunTitle,
  createLearningAgentGraph,
  emitAgentQueue,
  traceLangSmithRun,
  addLangSmithEvent,
  requestCancelTasksForRun,
  getDefaultLlmModel,
  getLlmProvider,
  getMemorySettings,
  findSimilarWords,
  callLlmText,
  runToolCallingAgent,
  agentHelpers,
  listBackgroundTasks,
  getBackgroundTaskResult,
  requestCancelBackgroundTask,
  extractLookupForAgent,
  buildLearningAgentPayload
});

registerMemoryRoutes(app, {
  userStore,
  getMemorySettings,
  saveMemorySettings,
  buildStoreReviewQueue,
  buildDailyQuota,
  agentHelpers,
  generateDojoAgentCopy,
  normalizeDojoAnswer,
  buildDojoAnswerVariants,
  getKnowledgeEmbeddingSettings,
  saveKnowledgeEmbeddingSettings,
  knowledgeReindexQueue,
  db
});

registerDictionaryRoutes(app, {
  agentHelpers,
  conjugate,
  findWord,
  searchWords,
  bulkInsert,
  searchJisho,
  lookupWordJisho,
  translateMeaningsToChinese,
  generateFuriganaHtml,
  pipeLlmStreamToSse,
  getRuntimeLlmSettings,
  getDefaultLlmModel,
  getTokenizer,
  commonVerbs,
  sceneCatalog,
  userStore,
  buildUserProfile,
  shuffleArray,
  getVerbsForScene,
  getSceneById,
  getSceneIdsForVerb,
  ollama,
  getLlmProvider
});

registerSystemRoutes(app, {
  registerLimiter,
  guestLimiter,
  loginLimiter,
  getTurnstileConfig,
  verifyTurnstileToken,
  userStore,
  hashPassword,
  verifyPassword,
  signToken,
  SKUS,
  paymentProvider,
  getTokenizer,
  getRuntimeLlmSettings,
  saveLlmSettings,
  fetchHotPlaceholderExamples,
  defaultHotPlaceholderExamples,
  verifyFeishuToken,
  shouldProcessFeishuEvent,
  processFeishuMessage,
  feishuClient
});

// === 静态托管前端 ===
// 单平台部署：Express 同时提供 API + 前端静态文件，避免跨域、省一个 Vercel。
// build 阶段把 frontend dist 复制到 backend/public（必须在 rootDir 内，Render 才会
// 把它打包进运行容器）；找不到目录就只跑 API（开发模式）。
const frontendDist = path.join(__dirname, 'public');
if (fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist));
  // SPA fallback：非 /api/* 的未匹配路由都回 index.html，让前端路由接管
  app.get(/^\/(?!api\/).*/, (_req: any, res: any) => {
    res.sendFile(path.join(frontendDist, 'index.html'));
  });
  console.log(`Serving frontend from ${frontendDist}`);
}

// 启动服务器
app.listen(PORT, HOST, () => {
  console.log(`Japanese Verb Master API running on http://${HOST}:${PORT}`);
  startFeishuLongConnection();
});
