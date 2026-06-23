import express from 'express';
import cors from 'cors';
import { AsyncLocalStorage } from 'node:async_hooks';
import kuromoji from 'kuromoji';
import * as wanakana from 'wanakana';
import { encodingForModel, getEncoding } from 'js-tiktoken';
import { conjugate } from './conjugationEngine.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Ollama } from 'ollama';
import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import https from 'https';
import {
  searchWords,
  findWord,
  bulkInsert,
  insertPracticeRecord,
  listRecentPracticeRecords,
  listMemoryCards,
  getMemoryCardByWord,
  upsertMemoryCard,
  deleteMemoryCard,
  reviewMemoryCard,
  getReviewQueue,
  getDailyQuota,
  retrieveAgentMemory,
  writeAgentMemory,
  listAgentMemory,
  deleteAgentMemory,
  AGENT_MEMORY_TYPES,
  findSimilarWords,
  getMemorySettings,
  saveMemorySettings,
  getLlmSettings,
  saveLlmSettings,
  createAgentRun,
  updateAgentRun,
  getAgentRun,
  listAgentRuns,
  listAgentRunsByThread
} from './db.js';
import db from './db.js';
import { ensureKnowledgeSchema } from './knowledge/schema.js';
import { createEmbedder } from './knowledge/embeddings.js';
import { createRetriever } from './knowledge/retriever.js';
import { createReranker } from './knowledge/rerank.js';
import { createQueryRewriter } from './knowledge/rewrite.js';
import { createMetrics } from './knowledge/metrics.js';
import { createReindexQueue } from './knowledge/queue.js';
import { ingestKnowledge } from './knowledge/ingest.js';
import { registerKnowledgeRoutes } from './knowledge/routes.js';
import { getKnowledgeEmbeddingSettings, saveKnowledgeEmbeddingSettings } from './knowledge/settings.js';
import { setTokenizer as setKnowledgeTokenizer } from './knowledge/tokenize.js';
import { createPaymentProvider, hasEntitlement, SKUS } from './payments/provider.js';
import {
  ensureAuthSchema,
  hashPassword,
  verifyPassword,
  signToken,
  authOptional,
  DEFAULT_USER_ID
} from './auth.js';
import { getSceneById, getSceneCatalog, getSceneIdsForVerb, getVerbsForScene } from './sceneData.js';
import {
  extractJapaneseTerms,
  detectLearningIntent,
  getAgentQueue,
  learningSubagentRegistry,
  pickScopedTools,
  selectSpecialistSubagent
} from './learningSubagents.js';
import { formatPlannerNote } from './subagentContexts.js';
import { buildSpecialistNodeExecutor } from './subagentNodeHelpers.js';
import { SubagentExecutor } from './subagentExecutor.js';
import {
  getBackgroundTaskResult,
  listBackgroundTasks,
  requestCancelBackgroundTask,
  requestCancelTasksForRun
} from './subagentTaskRuntime.js';
import {
  buildFeishuAgentContext,
  createFeishuClient,
  createFeishuLongConnection,
  createRecentEventDedupe,
  FEISHU_CONNECTION_MODES,
  parseFeishuTextMessage
} from './integrations/feishu.js';
import { addLangSmithEvent, traceLangSmithRun } from './tracing/langsmith.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 读取动词库（conjugationEngine 辅助数据，保留）
const commonVerbs = JSON.parse(fs.readFileSync(path.join(__dirname, 'common-verbs.json'), 'utf8'));
const sceneCatalog = getSceneCatalog(commonVerbs);
const formLabelMap = {
  negative: '否定式',
  polite: '礼貌式',
  teForm: 'て形',
  taForm: '过去式',
  potential: '可能形',
  passive: '被动形',
  causative: '使役形',
  imperative: '命令形',
  volitional: '意向形'
};
const defaultHotPlaceholderExamples = [
  '问日语：食べる 和 召し上がる 有什么区别',
  '问日语：为什么 〜ている 有时表示状态',
  '问日语：给我 3 个便利店场景例句',
  '问日语：把 猫 翻成日语并推荐相近词'
];
const hotPlaceholderCache = {
  updatedAt: 0,
  ttlMs: 30 * 60 * 1000,
  source: 'fallback',
  examples: [...defaultHotPlaceholderExamples]
};

function getDateKey(value) {
  const date = new Date(value);
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

function decodeXmlEntities(text = '') {
  return String(text || '')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'");
}

function stripFeedSource(title = '') {
  return String(title || '')
    .replace(/\s*[-｜|]\s*[^-｜|]+$/u, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function compactHotTopic(title = '') {
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

function buildHotPlaceholderExamplesFromTitles(titles = []) {
  const prompts = [];
  const patterns = [
    (topic) => `问日语：用简单日语解释「${topic}」`,
    (topic) => `问日语：围绕「${topic}」给我 3 个场景例句`,
    (topic) => `问日语：把「${topic}」改写成更自然的日语表达`,
    (topic) => `问日语：看到「${topic}」时，日语里常怎么说`
  ];

  titles.slice(0, 6).forEach((title, index) => {
    const topic = compactHotTopic(title);
    if (!topic) return;
    prompts.push(patterns[index % patterns.length](topic));
  });

  return [...new Set(prompts)].slice(0, 6);
}

async function fetchHotPlaceholderExamples(force = false) {
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
    console.error('Failed to refresh hot placeholders:', error.message);
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

function buildPracticeProfile(records) {
  const todayKey = getDateKey(new Date());
  const profile = {
    totalAttempts: records.length,
    accuracy: 0,
    todayAttempts: 0,
    avgDuration: 0,
    weakestForms: [],
    sceneStats: [],
    wrongBook: [],
    recommendation: '先完成一轮挑战，系统会开始生成你的长期学习画像。'
  };

  if (records.length === 0) {
    return profile;
  }

  const totalCorrect = records.filter(record => record.isCorrect).length;
  const totalDuration = records.reduce((sum, record) => sum + (record.durationMs || 0), 0);
  const formStats = new Map();
  const sceneStats = new Map();
  const wrongBookMap = new Map();

  profile.accuracy = Math.round((totalCorrect / records.length) * 100);
  profile.todayAttempts = records.filter(record => getDateKey(record.answeredAt) === todayKey).length;
  profile.avgDuration = Math.max(1, Math.round(totalDuration / records.length / 1000));

  for (const record of records) {
    if (!formStats.has(record.formKey)) {
      formStats.set(record.formKey, {
        key: record.formKey,
        label: formLabelMap[record.formKey] || record.formKey,
        attempts: 0,
        correct: 0
      });
    }
    if (!sceneStats.has(record.sceneId)) {
      sceneStats.set(record.sceneId, {
        id: record.sceneId,
        name: record.sceneName || '随机混合',
        attempts: 0,
        correct: 0
      });
    }

    formStats.get(record.formKey).attempts += 1;
    sceneStats.get(record.sceneId).attempts += 1;

    if (record.isCorrect) {
      formStats.get(record.formKey).correct += 1;
      sceneStats.get(record.sceneId).correct += 1;
    } else {
      const wrongKey = `${record.verb}::${record.formKey}`;
      if (!wrongBookMap.has(wrongKey)) {
        wrongBookMap.set(wrongKey, {
          verb: record.verb,
          formKey: record.formKey,
          formLabel: formLabelMap[record.formKey] || record.formKey,
          sceneId: record.sceneId,
          sceneName: record.sceneName || '随机混合',
          correctAnswer: record.correctAnswer,
          latestUserAnswer: record.userAnswer,
          wrongCount: 0,
          lastAnsweredAt: record.answeredAt
        });
      }
      const wrongItem = wrongBookMap.get(wrongKey);
      wrongItem.wrongCount += 1;
      if (new Date(record.answeredAt) >= new Date(wrongItem.lastAnsweredAt)) {
        wrongItem.latestUserAnswer = record.userAnswer;
        wrongItem.correctAnswer = record.correctAnswer;
        wrongItem.lastAnsweredAt = record.answeredAt;
      }
    }
  }

  profile.weakestForms = Array.from(formStats.values())
    .map(item => ({ ...item, accuracy: Math.round((item.correct / item.attempts) * 100) }))
    .sort((a, b) => a.accuracy - b.accuracy || b.attempts - a.attempts)
    .slice(0, 3);

  profile.sceneStats = Array.from(sceneStats.values())
    .map(item => ({ ...item, accuracy: Math.round((item.correct / item.attempts) * 100) }))
    .sort((a, b) => a.accuracy - b.accuracy || b.attempts - a.attempts)
    .slice(0, 5);

  profile.wrongBook = Array.from(wrongBookMap.values())
    .sort((a, b) => b.wrongCount - a.wrongCount || new Date(b.lastAnsweredAt) - new Date(a.lastAnsweredAt))
    .slice(0, 8);

  const weakestScene = profile.sceneStats[0];
  const weakestForm = profile.weakestForms[0];
  if (weakestScene && weakestForm) {
    profile.recommendation = `建议先练「${weakestScene.name}」场景，并重点巩固${weakestForm.label}。错题本里优先复习最近常错项。`;
  } else if (weakestForm) {
    profile.recommendation = `建议先专项训练${weakestForm.label}，并复习错题本里的高频错误。`;
  }

  return profile;
}

function buildUserProfile({ memoryCards = [], practiceProfile }) {
  const cardsByType = memoryCards.reduce((acc, card) => {
    const key = card.wordType || 'other';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const focusWordType = Object.entries(cardsByType)
    .sort((a, b) => b[1] - a[1])[0]?.[0] || 'verb';
  const dueCards = memoryCards.filter(card => new Date(card.dueAt).getTime() <= Date.now());
  const strongestScene = practiceProfile.sceneStats?.slice().sort((a, b) => b.accuracy - a.accuracy)[0] || null;
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
      mastered: memoryCards.filter(card => card.intervalDays >= 7).length
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

function shuffleArray(items) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function extractLookupForAgent(payload = {}) {
  const word = payload.dictionaryForm || payload.word || payload.verb || payload.kanji || '';
  const reading = payload.reading || payload.kana || '';
  const wordType = payload.wordType || (payload.dictionaryForm ? 'verb' : 'other');
  const meaning = payload.meaning || payload.meanings?.map(item => item.definitions).filter(Boolean).join('; ') || '';
  return {
    word,
    reading,
    wordType,
    verbType: payload.verbType || '',
    meaning
  };
}

function getVerbSceneSuggestions(word) {
  const sceneIds = getSceneIdsForVerb(word);
  return sceneIds
    .map(id => getSceneById(id))
    .filter(Boolean)
    .map(scene => ({
      id: scene.id,
      name: scene.name,
      reason: `「${word}」常出现在${scene.name}场景，可直接进入专项练习。`
    }));
}

function buildVerbSimilarWords(lookup, limit = 8) {
  const sceneIds = getSceneIdsForVerb(lookup.word);
  const sameScene = sceneIds.flatMap(id => getVerbsForScene(commonVerbs, id));
  const source = sameScene.length > 0 ? sameScene : commonVerbs;
  const sameType = [];
  const others = [];

  for (const item of source) {
    if (item.kanji === lookup.word || item.kana === lookup.reading) continue;
    const reasonParts = [];
    if (sceneIds.some(id => getSceneIdsForVerb(item.kanji).includes(id))) {
      reasonParts.push('同场景高频动词');
    }
    if (lookup.reading && item.kana?.[0] === lookup.reading[0]) {
      reasonParts.push('读音接近');
    }

    const entry = {
      kanji: item.kanji,
      kana: item.kana,
      romaji: item.romaji,
      meaning: item.meaning,
      wordType: 'verb',
      reason: reasonParts.slice(0, 2).join('、') || '适合作为动词扩展'
    };

    try {
      const type = tokenizer ? detectVerbType(item.kana) : '';
      if (type === lookup.verbType) {
        sameType.push({ ...entry, reason: `${entry.reason}、同类活用` });
      } else {
        others.push(entry);
      }
    } catch (e) {
      others.push(entry);
    }
  }

  const seen = new Set();
  return [...sameType, ...others].filter(item => {
    if (seen.has(item.kanji)) return false;
    seen.add(item.kanji);
    return true;
  }).slice(0, limit);
}

function buildLearningAgentPayload({ lookup, profile, memoryCards, similarWords }) {
  const dueCards = memoryCards.filter(card => new Date(card.dueAt).getTime() <= Date.now());
  const weakForm = profile.weakestForms?.[0];
  const scenes = lookup.wordType === 'verb' ? getVerbSceneSuggestions(lookup.word) : [];
  const recommendedActions = [];

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
      detail: `优先看 ${similarWords.slice(0, 3).map(item => item.kanji).join('、')}，形成词群记忆。`
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
      mastered: memoryCards.filter(card => card.intervalDays >= 7).length
    },
    profile
  };
}

async function searchDuckDuckGo(query) {
  try {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
    const response = await fetch(url, {
      headers: { 'User-Agent': 'JapaneseVerbMaster/1.0' },
      signal: AbortSignal.timeout(6000)
    });
    if (!response.ok) return [];
    const data = await response.json();
    const results = [];
    if (data.AbstractText) {
      results.push({
        title: data.Heading || query,
        url: data.AbstractURL || '',
        snippet: data.AbstractText,
        source: 'DuckDuckGo'
      });
    }
    for (const topic of data.RelatedTopics || []) {
      if (results.length >= 5) break;
      if (topic.Text) {
        results.push({
          title: topic.Text.split(' - ')[0].slice(0, 80),
          url: topic.FirstURL || '',
          snippet: topic.Text,
          source: 'DuckDuckGo'
        });
      }
    }
    return results;
  } catch (e) {
    return [];
  }
}

async function searchMediaWiki(query, project) {
  try {
    const endpoint = project === 'wiktionary'
      ? 'https://ja.wiktionary.org/w/api.php'
      : 'https://ja.wikipedia.org/w/api.php';
    const url = `${endpoint}?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&origin=*`;
    const response = await fetch(url, {
      headers: { 'User-Agent': 'JapaneseVerbMaster/1.0' },
      signal: AbortSignal.timeout(6000)
    });
    if (!response.ok) return [];
    const data = await response.json();
    return (data.query?.search || []).slice(0, 5).map(item => ({
      title: item.title,
      url: project === 'wiktionary'
        ? `https://ja.wiktionary.org/wiki/${encodeURIComponent(item.title)}`
        : `https://ja.wikipedia.org/wiki/${encodeURIComponent(item.title)}`,
      snippet: String(item.snippet || '').replace(/<[^>]+>/g, ''),
      source: project === 'wiktionary' ? 'Japanese Wiktionary' : 'Japanese Wikipedia'
    }));
  } catch (e) {
    return [];
  }
}

async function externalJapaneseSearch(query) {
  const [webResults, wikiResults, wiktionaryResults, jishoResults] = await Promise.all([
    searchDuckDuckGo(`${query} Japanese grammar meaning examples`),
    searchMediaWiki(query, 'wikipedia'),
    searchMediaWiki(query, 'wiktionary'),
    searchJisho(query, false).catch(() => [])
  ]);
  return {
    query,
    webResults: [...webResults, ...wiktionaryResults, ...wikiResults].slice(0, 8),
    dictionaryResults: jishoResults.slice(0, 6).map(item => ({
      word: item.kanji,
      reading: item.kana,
      romaji: item.romaji,
      meaning: item.meaning,
      wordType: item.wordType,
      source: 'Jisho'
    }))
  };
}

const agentTools = [
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
  {
    type: 'function',
    function: {
      name: 'external_search',
      description: 'Search external web and Jisho for Japanese word, grammar, usage, examples, or cultural notes.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query, can be Japanese/Chinese/English.' }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'lookup_word',
      description: 'Look up a word in the local dictionary and fallback to Jisho.',
      parameters: {
        type: 'object',
        properties: {
          word: { type: 'string' }
        },
        required: ['word']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'recommend_similar',
      description: 'Recommend similar or same-scene Japanese words for a given lookup.',
      parameters: {
        type: 'object',
        properties: {
          word: { type: 'string' },
          reading: { type: 'string' },
          wordType: { type: 'string' },
          verbType: { type: 'string' },
          meaning: { type: 'string' }
        },
        required: ['word']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'memory_status',
      description: 'Inspect memory cards, due reviews, scheduler settings, and practice profile.',
      parameters: {
        type: 'object',
        properties: {}
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'add_memory_card',
      description: 'Add or update a word in the spaced repetition memory deck.',
      parameters: {
        type: 'object',
        properties: {
          word: { type: 'string' },
          reading: { type: 'string' },
          meaning: { type: 'string' },
          wordType: { type: 'string' },
          verbType: { type: 'string' },
          sample: { type: 'string' }
        },
        required: ['word']
      }
    }
  }
];

async function executeAgentTool(name, args = {}) {
  return traceLangSmithRun({
    name: `tool.${name || 'unknown'}`,
    runType: 'tool',
    inputs: { name, args },
    metadata: { tool_name: name || 'unknown' },
    tags: ['tool', String(name || 'unknown')]
  }, () => executeAgentToolImpl(name, args), {
    processOutputs: (result) => ({ result: summarizeToolResult(result) })
  });
}

async function executeAgentToolImpl(name, args = {}) {
  if (name === 'knowledge_search') {
    const rawQuery = args.query || '';
    // 查询改写（默认开）：口语提问→检索友好查询 + 关键术语，与原查询拼接做多路召回；失败降级为原查询。
    const rewrite = args.rewrite === false
      ? { query: rawQuery, rewritten: rawQuery, changed: false }
      : await knowledgeRewriter.rewrite(rawQuery);
    const { results, degraded, reranked } = await knowledgeRetriever.queryRelevantDocuments(rewrite.query, {
      topK: args.topK || 5, level: args.level || '', category: args.category || '',
      rerank: args.rerank !== false // 默认走三段式精排，Researcher 可显式传 false 关闭
    });
    return {
      degraded,
      reranked,
      rewritten: rewrite.changed ? rewrite.rewritten : undefined,
      hits: results.map(r => ({
        id: r.id, resource: r.resource, title: r.title, level: r.level,
        category: r.category, score: Number(r.score.toFixed(4)),
        excerpt: r.content.slice(0, 600)
      }))
    };
  }
  if (name === 'external_search') {
    return externalJapaneseSearch(args.query || '');
  }
  if (name === 'lookup_word') {
    const localWord = findWord(args.word);
    if (localWord) return { source: 'local', ...localWord };
    const remote = await lookupWordJisho(args.word).catch(() => null);
    return { source: remote ? 'jisho' : 'none', result: remote };
  }
  if (name === 'recommend_similar') {
    const lookup = {
      word: args.word,
      reading: args.reading || '',
      wordType: args.wordType || 'verb',
      verbType: args.verbType || '',
      meaning: args.meaning || ''
    };
    return lookup.wordType === 'verb'
      ? buildVerbSimilarWords(lookup, 8)
      : findSimilarWords({
          word: lookup.word,
          kana: lookup.reading,
          wordType: lookup.wordType,
          meaning: lookup.meaning,
          limit: 8
        });
  }
  if (name === 'memory_status') {
    const cards = listMemoryCards(500);
    return {
      settings: getMemorySettings(),
      memory: {
        total: cards.length,
        due: cards.filter(card => new Date(card.dueAt).getTime() <= Date.now()).length,
        mastered: cards.filter(card => card.intervalDays >= 7).length
      },
      dueCards: cards.filter(card => new Date(card.dueAt).getTime() <= Date.now()).slice(0, 10),
      profile: buildPracticeProfile(listRecentPracticeRecords(2000))
    };
  }
  if (name === 'add_memory_card') {
    upsertMemoryCard({
      word: args.word,
      reading: args.reading || '',
      meaning: args.meaning || '',
      wordType: args.wordType || 'other',
      verbType: args.verbType || '',
      sample: args.sample || '',
      source: 'agent-tool'
    });
    return { ok: true, cards: listMemoryCards(500).slice(0, 5) };
  }
  return { error: `Unknown tool: ${name}` };
}

function summarizeToolResult(result) {
  // knowledge_search 命中含大体积 excerpt，整体 JSON 会超 900 字被截成无法解析的串；
  // 这里先压成「标题 + 短摘要 + 管线标记」的紧凑结构，保证摘要可被前端解析展示。
  if (result && Array.isArray(result.hits)) {
    const compact = {
      degraded: result.degraded,
      reranked: result.reranked,
      rewritten: result.rewritten,
      hitCount: result.hits.length,
      hits: result.hits.slice(0, 5).map(h => ({
        title: h.title,
        level: h.level,
        category: h.category,
        score: h.score,
        excerpt: typeof h.excerpt === 'string' ? h.excerpt.slice(0, 50) : undefined
      }))
    };
    const text = JSON.stringify(compact);
    return text.length > 900 ? `${text.slice(0, 900)}...` : text;
  }
  const text = JSON.stringify(result);
  return text.length > 900 ? `${text.slice(0, 900)}...` : text;
}

function writeSse(res, event, payload = {}) {
  if (res.destroyed || res.writableEnded) return;
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function prepareSse(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.flushHeaders?.();
}

function parseToolCallArgs(rawArgs = '{}') {
  try {
    return JSON.parse(rawArgs || '{}');
  } catch (e) {
    return {};
  }
}

function emitAgentQueue(res, queue, activeId, completedIds = [], note = '') {
  writeSse(res, 'queue', {
    activeId,
    note,
    agents: queue.map(agent => ({
      ...agent,
      status: completedIds.includes(agent.id)
        ? 'done'
        : agent.id === activeId
          ? 'running'
          : 'queued'
    }))
  });
}

function memoryCandidatesFromToolResult(toolName, result) {
  if (!result || result.error) return [];
  if (toolName === 'lookup_word') {
    const item = result.source === 'local' ? result : result.result;
    if (!item) return [];
    const word = item.kanji || item.word || '';
    if (!word) return [];
    const meaning = item.meaning || item.meanings?.[0]?.definitions || '';
    return [{
      word,
      reading: item.kana || item.reading || '',
      meaning,
      wordType: item.wordType || 'other',
      source: 'agent-lookup'
    }];
  }
  if (toolName === 'recommend_similar' && Array.isArray(result)) {
    return result.slice(0, 6).map(item => ({
      word: item.kanji || item.word || '',
      reading: item.kana || item.reading || '',
      meaning: item.meaning || '',
      wordType: item.wordType || 'other',
      source: 'agent-similar'
    })).filter(item => item.word);
  }
  return [];
}

function dedupeMemoryCandidates(candidates = []) {
  const seen = new Set();
  return candidates.filter(item => {
    const key = `${item.word}-${item.reading}`;
    if (!item.word || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 8);
}

function buildFallbackTutorAnswer(message, toolCalls = []) {
  const lookupSummaries = toolCalls
    .filter(call => call.name === 'lookup_word')
    .map(call => {
      const word = call.arguments?.word || '目标词';
      return `- **${word}**：${call.result || '未找到明确词典结果。'}`;
    })
    .join('\n');
  const usedTools = toolCalls.map(call => `\`${call.name}\``).join('、') || '本地规则';

  return `## 核心结论
这次问题是：${message}

Researcher 已调用 ${usedTools} 收集资料。DeepSeek 流式生成暂时超时，所以先给出稳定版学习摘要。

## 工具结果
${lookupSummaries || '- 已执行外部检索和记忆状态检查，等待模型恢复后可生成更完整解释。'}

## 下一步练习
1. 把目标词各造一个日语例句。
2. 标出普通说法、敬语说法和不能用于自己的表达。
3. 把容易混淆的词加入记忆卡片，明天复习。`;
}

function extractFirstJsonObject(text = '') {
  const trimmed = String(text || '').trim();
  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = fencedMatch ? fencedMatch[1].trim() : trimmed;
  const firstBrace = candidate.indexOf('{');
  const lastBrace = candidate.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) return null;
  const jsonSlice = candidate.slice(firstBrace, lastBrace + 1);
  try {
    return JSON.parse(jsonSlice);
  } catch {
    return null;
  }
}

function normalizeJlptLevel(raw = '') {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const text = String(value || '').trim().toUpperCase();
  const match = text.match(/N[1-5]/);
  return match ? match[0] : '';
}

function resolveDifficultyLevel({
  requested = 'auto',
  lookup = null,
  memoryCandidates = []
} = {}) {
  const normalizedRequested = String(requested || 'auto').trim();
  if (normalizedRequested && normalizedRequested !== 'auto') {
    const explicit = normalizeJlptLevel(normalizedRequested);
    return explicit || 'N3';
  }

  const lookupLevel = normalizeJlptLevel(lookup?.jlpt);
  if (lookupLevel) return lookupLevel;

  for (const item of memoryCandidates) {
    const candidateLevel = normalizeJlptLevel(item?.jlpt);
    if (candidateLevel) return candidateLevel;
  }

  return 'N3';
}

function buildDifficultyInstruction(level = 'N3') {
  const instructions = {
    N5: '使用最基础、最短的句式，优先日常词汇，避免从句、被动、使役、敬语嵌套。',
    N4: '保持句式简单自然，可加入少量常见补语，但避免明显超纲表达。',
    N3: '允许常见复合句和场景表达，保持清楚易懂，不要过度书面化。',
    N2: '可以使用更自然的书面/会话表达，允许适度复杂句，但仍需便于学习者拆解。',
    N1: '可以使用更成熟自然的复杂表达、书面感和语气变化，但要保持例句可分析。'
  };
  return instructions[level] || instructions.N3;
}

function normalizeAgentExamples(items = []) {
  return items
    .filter(item => item && (item.japanese || item.kana || item.chinese))
    .map(item => ({
      japanese: String(item.japanese || '').trim(),
      kana: String(item.kana || '').trim(),
      chinese: String(item.chinese || '').trim(),
      components: Array.isArray(item.components)
        ? item.components
          .map(part => ({
            label: String(part?.label || '').trim(),
            text: String(part?.text || '').trim()
          }))
          .filter(part => part.label && part.text)
        : []
    }))
    .filter(item => item.japanese && item.chinese)
    .map(item => ({
      ...item,
      components: item.components.length > 0 ? item.components : annotateSentenceComponents(item.japanese)
    }))
    .slice(0, 3);
}

function buildFallbackAgentExamples({ message, memoryCandidates = [], difficultyLevel = 'N3' }) {
  const source = memoryCandidates.length > 0
    ? memoryCandidates
    : extractJapaneseTerms(message).slice(0, 3).map(word => ({ word, reading: '' }));

  const examples = source.slice(0, 3).map((item, index) => {
    const word = item.word || 'この表現';
    const reading = item.reading || word;
    const templatesByDifficulty = {
      N5: [
        {
          japanese: `わたしは ${word} を つかいます。`,
          kana: `わたしは ${reading} を つかいます。`,
          chinese: `我会使用“${word}”。`
        },
        {
          japanese: `きょう ${word} を れんしゅうします。`,
          kana: `きょう ${reading} を れんしゅうします。`,
          chinese: `今天我来练习“${word}”。`
        }
      ],
      N4: [
        {
          japanese: `会話では「${word}」をよく使います。`,
          kana: `かいわでは「${reading}」をよくつかいます。`,
          chinese: `在会话里经常会用到“${word}”。`
        },
        {
          japanese: `授業で「${word}」を使って文を作りました。`,
          kana: `じゅぎょうで「${reading}」をつかってぶんをつくりました。`,
          chinese: `上课时我用“${word}”造了句子。`
        }
      ],
      N3: [
        {
          japanese: `会話では「${word}」のほうが自然に聞こえることがあります。`,
          kana: `かいわでは「${reading}」のほうがしぜんにきこえることがあります。`,
          chinese: `在会话里，“${word}”有时听起来会更自然。`
        },
        {
          japanese: `授業のあとで、「${word}」を使って短い文を作ってみました。`,
          kana: `じゅぎょうのあとで、「${reading}」をつかってみじかいぶんをつくってみました。`,
          chinese: `课后我试着用“${word}”造了一个短句。`
        },
        {
          japanese: `この場面では「${word}」と似た表現の違いも意識すると覚えやすいです。`,
          kana: `このばめんでは「${reading}」とにたひょうげんのちがいもいしきするとおぼえやすいです。`,
          chinese: `在这个场景里，顺便注意“${word}”和近义表达的区别会更容易记住。`
        }
      ]
    };
    const templates = templatesByDifficulty[difficultyLevel] || templatesByDifficulty.N3;
    const fallbackTemplates = [
      {
        japanese: `この場面では「${word}」を自然に使えると表現の幅が広がります。`,
        kana: `このばめんでは「${reading}」をしぜんにつかえるとひょうげんのはばがひろがります。`,
        chinese: `在这个场景里能自然使用“${word}”，表达会更丰富。`
      },
      {
        japanese: `「${word}」を使って自分の例文を一つ作ると覚えやすいです。`,
        kana: `「${reading}」をつかってじぶんのれいぶんをひとつつくるとおぼえやすいです。`,
        chinese: `自己用“${word}”造一个句子会更容易记住。`
      }
    ];
    return [...templates, ...fallbackTemplates][index % [...templates, ...fallbackTemplates].length];
  });

  return normalizeAgentExamples(examples);
}

function pickPracticeForm(message = '') {
  const formCandidates = [
    { key: 'teForm', label: formLabelMap.teForm, tests: [/て形/, /て-form/i] },
    { key: 'taForm', label: formLabelMap.taForm, tests: [/过去式/, /た形/, /past/i] },
    { key: 'negative', label: formLabelMap.negative, tests: [/否定/, /ない形/, /negative/i] },
    { key: 'polite', label: formLabelMap.polite, tests: [/礼貌/, /ます形/, /polite/i] },
    { key: 'potential', label: formLabelMap.potential, tests: [/可能/, /can\b/i] },
    { key: 'passive', label: formLabelMap.passive, tests: [/被动/] },
    { key: 'causative', label: formLabelMap.causative, tests: [/使役/] },
    { key: 'imperative', label: formLabelMap.imperative, tests: [/命令/] },
    { key: 'volitional', label: formLabelMap.volitional, tests: [/意向/] }
  ];
  const matched = formCandidates.find(item => item.tests.some(test => test.test(message)));
  return matched || { key: 'teForm', label: formLabelMap.teForm };
}

function inferMarkedRole(text = '', marker = '') {
  const trimmed = String(text || '').trim();
  if (!trimmed || !marker) return '补足';
  const timePattern = /(今日|きょう|明日|あした|昨日|きのう|今朝|けさ|今晩|こんばん|毎日|まいにち|毎週|毎月|毎年|週末|しゅうまつ|朝|昼|夜|時|分|月|年|曜日)$/;
  const locationPattern = /(学校|がっこう|会社|かいしゃ|店|みせ|コンビニ|駅|えき|家|いえ|うち|教室|きょうしつ|部屋|へや|日本|にほん|東京|とうきょう|レストラン|スーパー)$/;

  switch (marker) {
    case 'は':
      return '主题';
    case 'も':
      return '追加主题';
    case 'が':
      return '主语';
    case 'を':
      return '宾语';
    case 'へ':
      return '方向';
    case 'と':
      return '对象/并列';
    case 'から':
      return '起点/原因';
    case 'まで':
      return '终点';
    case 'より':
      return '比较基准';
    case 'に':
      if (timePattern.test(trimmed)) return '时间';
      if (locationPattern.test(trimmed)) return '地点';
      return '补语';
    case 'で':
      if (locationPattern.test(trimmed)) return '地点/方式';
      return '方式/场所';
    default:
      return '补足';
  }
}

function inferPredicateStart(tokens = []) {
  for (let index = tokens.length - 1; index >= 0; index -= 1) {
    const token = tokens[index];
    const pos = token?.pos || '';
    const surface = token?.surface_form || '';
    if (['動詞', '形容詞', '助動詞'].includes(pos)) {
      let start = index;
      while (start > 0) {
        const previousPos = tokens[start - 1]?.pos || '';
        if (!['動詞', '形容詞', '助動詞'].includes(previousPos)) break;
        start -= 1;
      }
      return start;
    }
    if (surface && ['です', 'だ', 'でした', 'ます', 'ません', 'ください'].includes(surface)) {
      let start = Math.max(0, index - 1);
      while (start > 0) {
        const previousPos = tokens[start - 1]?.pos || '';
        if (!['動詞', '形容詞', '助動詞'].includes(previousPos)) break;
        start -= 1;
      }
      return start;
    }
  }
  return -1;
}

function annotateSentenceComponents(sentence = '') {
  if (!tokenizer || !sentence) return [];

  try {
    const tokens = tokenizer.tokenize(sentence).filter(token => token?.surface_form);
    if (tokens.length === 0) return [];

    const predicateStart = inferPredicateStart(tokens);
    const components = [];
    const appendComponent = (label, text) => {
      const normalizedText = String(text || '').trim();
      if (!label || !normalizedText) return;
      const previous = components.at(-1);
      if (previous && previous.label === label) {
        previous.text = `${previous.text}${normalizedText}`;
        return;
      }
      components.push({ label, text: normalizedText });
    };

    const boundary = predicateStart >= 0 ? predicateStart : tokens.length;
    let buffer = [];

    for (let index = 0; index < boundary; index += 1) {
      const token = tokens[index];
      buffer.push(token);
      if (token.pos === '助詞' && ['は', 'も', 'が', 'を', 'に', 'へ', 'で', 'と', 'から', 'まで', 'より'].includes(token.surface_form)) {
        const phraseTokens = buffer.slice(0, -1);
        const phrase = phraseTokens.map(item => item.surface_form).join('');
        const marker = token.surface_form;
        appendComponent(inferMarkedRole(phrase, marker), `${phrase}${marker}`);
        buffer = [];
      }
    }

    if (buffer.length > 0) {
      appendComponent('补足', buffer.map(item => item.surface_form).join(''));
    }

    if (predicateStart >= 0) {
      appendComponent('谓语', tokens.slice(predicateStart).map(item => item.surface_form).join(''));
    }

    return components.slice(0, 6);
  } catch (error) {
    return [];
  }
}

function shouldOfferInteractivePractice({ message = '', context = {}, memoryCandidates = [] }) {
  const lowered = String(message || '').toLowerCase();
  if (/readme|github|repo|sse|langgraph|api|prompt|system prompt|架构|bug|样式|前端|后端|页面|模型|provider|llm|deepseek|openai|tavily/.test(lowered)) {
    return false;
  }
  if (context.lookup?.wordType === 'verb') return true;
  if (memoryCandidates.some(item => item.wordType === 'verb' || detectVerbType(item.reading || item.word || ''))) return true;
  if ((context.intent?.terms || []).some(term => detectVerbType(term))) return true;
  return extractJapaneseTerms(message).some(term => detectVerbType(term));
}

function buildInteractivePractice({ message = '', intent = {}, context = {}, memoryCandidates = [] }) {
  if (!shouldOfferInteractivePractice({ message, context: { ...context, intent }, memoryCandidates })) return null;

  const sourceLookup = context.lookup?.wordType === 'verb' ? context.lookup : null;
  const candidateWord = sourceLookup?.dictionaryForm
    || sourceLookup?.parsedAs
    || sourceLookup?.word
    || memoryCandidates.find(item => detectVerbType(item.reading || item.word))?.reading
    || intent.terms?.find(term => detectVerbType(term))
    || null;

  if (!candidateWord) return null;

  const normalizedVerb = wanakana.toHiragana(candidateWord);
  const verbType = detectVerbType(normalizedVerb);
  if (!verbType) return null;

  try {
    const conjugation = conjugate(normalizedVerb, verbType);
    const form = pickPracticeForm(message);
    const answer = conjugation[form.key];
    if (!answer) return null;
    const difficultyLevel = resolveDifficultyLevel({
      requested: context.exampleDifficulty || getMemorySettings().exampleDifficulty,
      lookup: sourceLookup,
      memoryCandidates
    });
    const options = buildPracticeOptions(conjugation, form.key, answer, difficultyLevel);
    const displayVerb = sourceLookup?.dictionaryForm || sourceLookup?.word || sourceLookup?.parsedAs || candidateWord;
    return {
      mode: 'agent_practice',
      prompt: `「${displayVerb}」的 ${form.label} 是哪一个？`,
      question: {
        verb: displayVerb,
        reading: sourceLookup?.reading || normalizedVerb,
        meaning: sourceLookup?.meaning || context.lookup?.meaning || '',
        romaji: sourceLookup?.romaji || '',
        verbType,
        wordType: 'verb',
        formKey: form.key,
        formLabel: form.label,
        answer,
        options,
        difficultyLevel,
        jlpt: normalizeJlptLevel(sourceLookup?.jlpt),
        sceneId: 'agent-practice',
        sceneName: 'Agent 练习'
      }
    };
  } catch (error) {
    return null;
  }
}

function buildFallbackFollowUpQuestions({ intent = {}, context = {}, memoryCandidates = [] }) {
  const focusWord = context.lookup?.dictionaryForm || context.lookup?.word || memoryCandidates[0]?.word || '这个表达';

  if (intent?.wantsExamples) {
    return [
      `把这些例句改成更礼貌的说法`,
      `再给我3个更口语的${focusWord}场景`,
      `把这些例句改成填空练习`
    ];
  }

  if (intent?.wantsPractice) {
    return [
      `为什么这题要这样变形`,
      `再给我一个类似难度的练习`,
      `顺便比较一下相关变形区别`
    ];
  }

  return [
    `再给我3个${focusWord}的场景例句`,
    `把${focusWord}和相近表达做个对比`,
    `基于${focusWord}给我出一道小练习`
  ];
}

function stripMarkdownCodeFence(text = '') {
  const stripped = String(text || '').trim();
  if (!stripped.startsWith('```')) return stripped;
  const lines = stripped.split('\n');
  if (lines.length >= 3 && lines[0].startsWith('```') && lines.at(-1)?.startsWith('```')) {
    return lines.slice(1, -1).join('\n').trim();
  }
  return stripped;
}

function parseJsonStringList(text = '') {
  const candidate = stripMarkdownCodeFence(text);
  const arrayStart = candidate.indexOf('[');
  const arrayEnd = candidate.lastIndexOf(']');
  if (arrayStart === -1 || arrayEnd === -1 || arrayEnd <= arrayStart) return null;
  try {
    const parsed = JSON.parse(candidate.slice(arrayStart, arrayEnd + 1));
    if (!Array.isArray(parsed)) return null;
    return parsed
      .map(item => String(item || '').trim())
      .filter(Boolean);
  } catch (error) {
    return null;
  }
}

function formatSuggestionConversation(conversation = []) {
  return conversation
    .map((item) => {
      const role = item?.role === 'assistant' ? 'Assistant' : 'User';
      return `${role}: ${String(item?.content || '').trim()}`;
    })
    .filter(Boolean)
    .join('\n')
    .trim();
}

function compactConversationTurns(conversation = [], keepTail = 4) {
  const safeConversation = Array.isArray(conversation) ? conversation : [];
  const normalized = safeConversation
    .map((item) => ({
      role: item?.role === 'assistant' ? 'assistant' : 'user',
      content: String(item?.content || '').trim()
    }))
    .filter(item => item.content)
    .map(item => ({ ...item, content: item.content.slice(0, 320) }));

  if (normalized.length <= keepTail) {
    return {
      recentConversation: normalized,
      olderConversationDigest: '',
      compactedTurnCount: 0
    };
  }

  const older = normalized.slice(0, -keepTail);
  const recentConversation = normalized.slice(-keepTail);
  const olderConversationDigest = older
    .map(item => `${item.role === 'assistant' ? 'Assistant' : 'User'}: ${item.content}`)
    .join('\n')
    .slice(0, 1600);

  return {
    recentConversation,
    olderConversationDigest,
    compactedTurnCount: older.length
  };
}

function isCompactFocusWord(word = '') {
  const value = String(word || '').trim();
  if (!value) return false;
  if (value.length < 2) return false;
  if (!/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー]/u.test(value)) return false;
  const denied = new Set(['がる', 'する']);
  return !denied.has(value);
}

function normalizeThreadTopic(topic = '') {
  return String(topic || '')
    .replace(/\s+/g, '')
    .replace(/[.…]{2,}$/g, '')
    .trim();
}

function buildThreadSummary({ currentRunId = '', threadId = '', limit = 10 } = {}) {
  const runs = listAgentRunsByThread({ threadId, limit: limit + 2 })
    .filter(run => run.runId !== currentRunId)
    .filter(run => ['completed', 'cancelled', 'failed'].includes(run.status))
    .slice(0, limit);

  const seenTopics = new Set();
  const topics = runs
    .map(run => run.title || buildAgentRunTitle(run.question || ''))
    .filter(Boolean)
    .filter((topic) => {
      const normalized = normalizeThreadTopic(topic);
      if (!normalized || seenTopics.has(normalized)) return false;
      seenTopics.add(normalized);
      return true;
    })
    .slice(0, 8);

  const focusWords = [...new Set(runs.flatMap(run => run.metadata?.compactEntry?.focusWords || []))]
    .filter(isCompactFocusWord)
    .slice(0, 12);

  const practiceFocuses = runs
    .map(run => run.metadata?.compactEntry?.practiceFocus || '')
    .filter(Boolean)
    .filter((item, index, source) => source.indexOf(item) === index)
    .slice(0, 6);

  const seenSummaryTitles = new Set();
  const latestSummaries = runs
    .map(run => {
      const summary = String(run.metadata?.compactEntry?.summary || run.summary || '').trim();
      if (!summary) return '';
      const title = run.title || buildAgentRunTitle(run.question || '');
      const normalizedTitle = normalizeThreadTopic(title);
      if (!normalizedTitle || seenSummaryTitles.has(normalizedTitle)) return '';
      seenSummaryTitles.add(normalizedTitle);
      return `${title}：${summary}`.slice(0, 140);
    })
    .filter(Boolean)
    .slice(0, 5);

  return {
    runCount: runs.length,
    topics,
    focusWords,
    practiceFocuses,
    latestSummaries,
    digest: latestSummaries.join('\n').slice(0, 900)
  };
}

function buildRunCompactEntry({ message = '', intent = {}, context = {}, finalState = {} }) {
  const focusWords = [
    context.lookup?.word,
    ...(Array.isArray(finalState.memoryCandidates) ? finalState.memoryCandidates.map(item => item.word) : [])
  ]
    .map(item => String(item || '').trim())
    .filter(isCompactFocusWord)
    .filter((item, index, source) => source.indexOf(item) === index)
    .slice(0, 6);

  const exampleHighlights = Array.isArray(finalState.structuredExamples)
    ? finalState.structuredExamples
      .map(item => String(item?.japanese || '').trim())
      .filter(Boolean)
      .slice(0, 2)
    : [];

  return {
    title: buildAgentRunTitle(message),
    intentType: intent?.type || 'lookup',
    focusWords,
    practiceFocus: finalState.interactivePractice?.question?.formLabel || '',
    summary: String(finalState.finalAnswer || '').replace(/\s+/g, ' ').trim().slice(0, 320),
    exampleHighlights
  };
}

function buildPersistedCompactSummary({ currentRunId = '', threadId = '', conversation = [], model = '' } = {}) {
  const threadSummary = buildThreadSummary({ currentRunId, threadId, limit: 8 });
  const conversationCompact = compactConversationTurns(conversation, 4);
  const rawConversation = Array.isArray(conversation) ? conversation : [];
  const rawConversationTokens = estimateChatTokens(
    rawConversation.map(item => ({
      role: item?.role || 'user',
      content: String(item?.content || '').slice(0, 600)
    })),
    model || getDefaultLlmModel()
  );
  const threadDigestTokens = estimateChatTokens([
    {
      role: 'system',
      content: `${threadSummary.digest}\n${threadSummary.focusWords.join('、')}\n${threadSummary.practiceFocuses.join('、')}`
    }
  ], model || getDefaultLlmModel());
  const contextWindow = getModelContextWindow(model || getDefaultLlmModel());
  const estimatedRatio = contextWindow > 0 ? (rawConversationTokens + threadDigestTokens) / contextWindow : 0;

  let mode = 'none';
  if (rawConversation.length > 10 || estimatedRatio >= 0.35) {
    mode = 'aggressive';
  } else if (rawConversation.length > 6 || estimatedRatio >= 0.18 || threadSummary.runCount >= 4) {
    mode = 'standard';
  } else if (rawConversation.length > 4 || estimatedRatio >= 0.08 || threadSummary.runCount >= 2) {
    mode = 'light';
  }

  const applied = mode !== 'none';
  const recentConversation = !applied
    ? rawConversation
      .slice(-6)
      .map(item => ({
        role: item?.role === 'assistant' ? 'assistant' : 'user',
        content: String(item?.content || '').trim().slice(0, 320)
      }))
      .filter(item => item.content)
    : conversationCompact.recentConversation;

  const persistedRunCount = mode === 'none'
    ? 0
    : mode === 'light'
      ? Math.min(2, threadSummary.runCount)
      : mode === 'standard'
        ? Math.min(5, threadSummary.runCount)
        : threadSummary.runCount;

  const focusWords = threadSummary.focusWords.slice(
    0,
    mode === 'aggressive' ? 10 : mode === 'standard' ? 8 : 5
  );
  const recentTopics = threadSummary.topics.slice(
    0,
    mode === 'aggressive' ? 6 : mode === 'standard' ? 5 : 3
  );
  const practiceFocuses = threadSummary.practiceFocuses.slice(
    0,
    mode === 'aggressive' ? 5 : 3
  );
  const historicalDigest = applied
    ? threadSummary.latestSummaries
      .slice(0, mode === 'aggressive' ? 5 : mode === 'standard' ? 4 : 2)
      .join('\n')
    : '';

  return {
    applied,
    mode,
    estimatedRatio: Number(estimatedRatio.toFixed(4)),
    estimatedInputTokens: rawConversationTokens + threadDigestTokens,
    recentConversation,
    olderConversationDigest: applied ? conversationCompact.olderConversationDigest : '',
    compactedTurnCount: applied ? conversationCompact.compactedTurnCount : 0,
    persistedRunCount,
    recentTopics,
    focusWords,
    practiceFocuses,
    historicalDigest: historicalDigest.slice(0, 900),
    threadSummary
  };
}

async function generateFollowUpQuestions({ message = '', finalAnswer = '', intent = {}, context = {}, memoryCandidates = [] }) {
  const fallback = buildFallbackFollowUpQuestions({ intent, context, memoryCandidates });
  const conversation = Array.isArray(context.conversation) ? context.conversation.slice(-6) : [];
  const conversationText = formatSuggestionConversation([
    ...conversation,
    { role: 'user', content: message },
    { role: 'assistant', content: finalAnswer }
  ]);

  if (getLlmProvider() === 'ollama') {
    return fallback;
  }

  try {
    const text = await callLlmText({
      messages: [
        {
          role: 'system',
          content: [
            '你是日语学习产品里的追问建议器。',
            '请基于最近完整对话，生成 EXACTLY 3 个用户下一步最可能继续问的问题。',
            '要求：',
            '- 必须和刚刚这轮具体内容强相关，不能泛泛而谈',
            '- 必须使用和用户相同的语言',
            '- 每条尽量简短自然，不超过 40 个汉字',
            '- 三条问题的方向要有差异，例如例句/对比/练习/误用/场景',
            '- 不要编号，不要 markdown，不要解释',
            '- 输出必须是 JSON 数组，例如 ["问题1","问题2","问题3"]'
          ].join('\n')
        },
        {
          role: 'user',
          content: [
            'Conversation Context:',
            conversationText || `User: ${message}\nAssistant: ${finalAnswer.slice(0, 1200)}`,
            '',
            `Intent: ${intent?.type || 'lookup'}`,
            `Lookup Focus: ${JSON.stringify(context.lookup || null)}`,
            `Memory Candidates: ${JSON.stringify(memoryCandidates.slice(0, 4))}`,
            '',
            'Generate 3 follow-up questions.'
          ].join('\n')
        }
      ],
      model: getDefaultLlmModel(),
      temperature: 0.7,
      maxTokens: 220
    });

    const items = parseJsonStringList(text) || [];
    const normalized = [...new Set(items
      .map(item => String(item || '').replace(/\s+/g, ' ').trim())
      .filter(Boolean)
    )].slice(0, 3);

    return normalized.length === 3 ? normalized : fallback;
  } catch (error) {
    return fallback;
  }
}

// Agent Memory 抽取（写路径）：run 结束时判断本轮有没有值得长期记的用户信息。
// 借鉴 mem0 的"抽原子事实"：只抽稳定的目标/偏好/事实/长期任务，不抽一次性问答内容。
// 返回 [{ type, mkey, value }]；ollama 或异常时返回 []（不阻塞主流程）。
async function extractAgentMemoryCandidates({ message = '', finalAnswer = '' }) {
  if (getLlmProvider() === 'ollama' || !message.trim()) return [];
  try {
    const text = await callLlmText({
      messages: [
        {
          role: 'system',
          content: [
            '你是日语学习产品的「长期记忆抽取器」。从这一轮对话里抽取**关于用户本人、值得跨会话长期记住**的信息。',
            '只抽稳定信息，分四类（type）：',
            '- goal：学习目标（如"备考 N2"、"想练商务日语"）',
            '- preference：偏好（如"例句要商务场景"、"解释要简短"、"先给假名"）',
            '- fact：关于用户的事实（如"母语中文"、"在日企做开发"）',
            '- task：正在推进的长期任务（如"系统过一遍 N2 语法点"）',
            '严格要求：',
            '- 只抽用户**明确表达或强暗示**的，不要臆测、不要把一次性的查词问题当记忆',
            '- 每条给一个稳定的英文 snake_case 归一化键 mkey（如 jlpt_target / example_style / native_lang），同类信息复用同一 mkey',
            '- value 用简短中文陈述句',
            '- 没有值得记的就返回空数组',
            '- 只输出 JSON 数组：[{"type":"goal","mkey":"jlpt_target","value":"备考 N2"}]'
          ].join('\n')
        },
        {
          role: 'user',
          content: `User: ${String(message).slice(0, 800)}\nAssistant: ${String(finalAnswer).slice(0, 800)}\n\n抽取长期记忆条目（JSON 数组，没有则 []）。`
        }
      ],
      model: getDefaultLlmModel(),
      temperature: 0.2,
      maxTokens: 320,
      responseFormat: { type: 'json_object' }
    });

    let parsed = [];
    try {
      const obj = JSON.parse(text);
      parsed = Array.isArray(obj) ? obj : (Array.isArray(obj.items) ? obj.items : (Array.isArray(obj.memories) ? obj.memories : []));
    } catch (e) {
      parsed = [];
    }
    return parsed
      .filter(item => item && AGENT_MEMORY_TYPES.includes(String(item.type)) && item.mkey && item.value)
      .map(item => ({
        type: String(item.type),
        mkey: String(item.mkey).trim().toLowerCase().slice(0, 60),
        value: String(item.value).replace(/\s+/g, ' ').trim().slice(0, 280)
      }))
      .slice(0, 6);
  } catch (error) {
    return [];
  }
}

// 用同一动词的其他活用形作为干扰项——并根据难度控制“迷惑程度”。
function buildPracticeOptions(conjugation, answerKey, answer, difficultyLevel = 'N3') {
  const distractorPools = {
    N5: ['taForm', 'negative', 'polite', 'teForm'],
    N4: ['taForm', 'negative', 'polite', 'potential', 'teForm'],
    N3: ['taForm', 'negative', 'polite', 'potential', 'passive', 'teForm'],
    N2: ['taForm', 'negative', 'polite', 'potential', 'passive', 'causative', 'volitional', 'teForm'],
    N1: ['taForm', 'negative', 'polite', 'potential', 'passive', 'causative', 'volitional', 'imperative', 'teForm']
  };
  const distractorKeys = distractorPools[difficultyLevel] || distractorPools.N3;
  const seen = new Set([answer]);
  const distractors = [];
  for (const key of distractorKeys) {
    if (key === answerKey) continue;
    const value = conjugation[key];
    if (value && !seen.has(value)) {
      seen.add(value);
      distractors.push(value);
    }
    if (distractors.length >= 3) break;
  }
  const options = [answer, ...distractors];
  // Fisher–Yates 洗牌，避免正确答案总在首位。
  for (let i = options.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [options[i], options[j]] = [options[j], options[i]];
  }
  return options;
}

async function generateStructuredAgentExamples({ message, finalAnswer, toolCalls, memoryCandidates = [], context = {} }) {
  const memorySettings = getMemorySettings();
  const exampleDifficulty = resolveDifficultyLevel({
    requested: memorySettings.exampleDifficulty || 'auto',
    lookup: context.lookup || null,
    memoryCandidates
  });
  const prompt = `你是日语学习应用里的 Example Composer。
请根据用户问题、Agent 最终回答、以及工具结果，输出 2 到 3 条适合学习者复习的例句。

要求：
1. 只输出 JSON，不要输出任何额外说明。
2. JSON 结构固定为：
{
  "examples": [
    { "japanese": "日文原句", "kana": "平假名注音", "chinese": "中文翻译" }
  ]
}
3. 例句必须自然、日常、和当前问题高度相关。
4. kana 必须是完整平假名，不要留空。
5. chinese 要简洁、准确。
6. 例句难度设定：严格按 JLPT ${exampleDifficulty} 学习者可理解的难度来写，避免明显超纲表达。
7. 难度控制说明：${buildDifficultyInstruction(exampleDifficulty)}`;

  const text = await callLlmText({
    messages: [
      { role: 'system', content: prompt },
      {
        role: 'user',
        content: JSON.stringify({
          message,
          finalAnswer,
          toolCalls: toolCalls.map(call => ({
            name: call.name,
            arguments: call.arguments,
            result: call.result
          })),
          exampleDifficulty
        })
      }
    ],
    model: getDefaultLlmModel(),
    temperature: 0.2,
    maxTokens: 420,
    responseFormat: getLlmProvider() === 'ollama' ? undefined : { type: 'json_object' }
  });

  const parsed = extractFirstJsonObject(text);
  const normalized = normalizeAgentExamples(parsed?.examples || []);
  return normalized.length > 0
    ? normalized
    : buildFallbackAgentExamples({ message, memoryCandidates, difficultyLevel: exampleDifficulty });
}

function emitTextAsTokens(res, text, size = 12) {
  for (let i = 0; i < text.length; i += size) {
    writeSse(res, 'token', { content: text.slice(i, i + size) });
  }
}

const LearningAgentState = Annotation.Root({
  runId: Annotation({ reducer: (x, y) => y ?? x, default: () => '' }),
  message: Annotation({ reducer: (x, y) => y ?? x, default: () => '' }),
  context: Annotation({ reducer: (x, y) => y ?? x, default: () => ({}) }),
  intent: Annotation({ reducer: (x, y) => y ?? x, default: () => ({}) }),
  agentQueue: Annotation({ reducer: (x, y) => y ?? x, default: () => [] }),
  subagentContexts: Annotation({ reducer: (x, y) => y ?? x, default: () => ({}) }),
  systemPrompt: Annotation({ reducer: (x, y) => y ?? x, default: () => '' }),
  userContent: Annotation({ reducer: (x, y) => y ?? x, default: () => '' }),
  completed: Annotation({ reducer: (x, y) => y ?? x, default: () => [] }),
  plannerNote: Annotation({ reducer: (x, y) => y ?? x, default: () => ({}) }),
  messages: Annotation({ reducer: (x, y) => y ?? x, default: () => [] }),
  toolCalls: Annotation({ reducer: (x, y) => y ?? x, default: () => [] }),
  memoryCandidates: Annotation({ reducer: (x, y) => y ?? x, default: () => [] }),
  finalAnswer: Annotation({ reducer: (x, y) => y ?? x, default: () => '' }),
  structuredExamples: Annotation({ reducer: (x, y) => y ?? x, default: () => [] }),
  memorySnapshot: Annotation({ reducer: (x, y) => y ?? x, default: () => null }),
  interactivePractice: Annotation({ reducer: (x, y) => y ?? x, default: () => null }),
  followUpQuestions: Annotation({ reducer: (x, y) => y ?? x, default: () => [] }),
  usageReport: Annotation({ reducer: (x, y) => y ?? x, default: () => null })
});

function createLearningAgentGraph({ res, closedRef, intent, runId, knowledgeHits = [] }) {
  const specialistId = selectSpecialistSubagent(intent);
  // 工具结果在 toolCalls 里会被摘要截断为字符串，无法回取结构化命中；
  // 这里包一层，把 knowledge_search 的原始命中收集到请求级数组，供 done 事件引用。
  const executeToolWithKnowledge = async (name, args) => {
    const result = await executeAgentTool(name, args);
    if (name === 'knowledge_search' && Array.isArray(result?.hits)) {
      knowledgeHits.push(...result.hits);
    }
    return result;
  };
  const researcherExecutor = new SubagentExecutor({
    subagentId: 'researcher',
    label: 'Researcher',
    runId,
    executeTool: executeToolWithKnowledge,
    summarizeToolResult,
    writeSse,
    emitAgentQueue,
    res,
    closedRef
  });
  const memoryExecutor = new SubagentExecutor({
    subagentId: 'memory_manager',
    label: 'Memory Manager',
    runId,
    executeTool: executeAgentTool,
    summarizeToolResult,
    writeSse,
    emitAgentQueue,
    res,
    closedRef
  });
  const tutorExecutor = new SubagentExecutor({
    subagentId: 'tutor',
    label: 'Tutor',
    runId,
    executeTool: executeAgentTool,
    summarizeToolResult,
    writeSse,
    emitAgentQueue,
    res,
    closedRef
  });

  let graph = new StateGraph(LearningAgentState)
    .addNode('planner', async (state) => {
      emitAgentQueue(res, state.agentQueue, 'planner', state.completed, '正在拆解任务和选择工具路线');
      const nextIntent = detectLearningIntent(state.message);
      const plannerNote = learningSubagentRegistry.planner.buildBrief({ intent: nextIntent });
      // Background investigation：规划前先做一次轻量本地检索，让 Planner 知道本地有哪些资料
      let backgroundKnowledge = '';
      try {
        const { results } = await knowledgeRetriever.queryRelevantDocuments(state.message || nextIntent?.query || '', { topK: 3 });
        if (results.length > 0) {
          backgroundKnowledge = results
            .map(r => `- [${r.category}/${r.level}] ${r.title}: ${r.content.slice(0, 80)}`)
            .join('\n');
        }
      } catch {
        // 本地检索失败不阻塞规划
      }
      if (closedRef.closed) return {};
      writeSse(res, 'agent_note', {
        agent: 'planner',
        title: 'Planner 计划',
        content: formatPlannerNote(plannerNote) + (backgroundKnowledge
          ? `\n\n本地知识库预查（规划参考）：\n${backgroundKnowledge}`
          : '\n\n本地知识库预查：无相关条目')
      });

      return {
        intent: nextIntent,
        plannerNote,
        subagentContexts: {
          ...state.subagentContexts,
          planner: plannerNote
        },
        completed: [...state.completed, 'planner']
      };
    })
    .addNode('researcher', async (state) => {
      const researcherSpec = learningSubagentRegistry.researcher;
      const memoryCandidates = [];

      return researcherExecutor.runToolSubagent({
        state,
        queueNote: '正在调用工具收集事实',
        title: 'Researcher',
        buildBrief: (currentState, sandboxContext) => researcherSpec.buildBrief({
          message: currentState.message,
          intent: currentState.intent,
          plannerNote: currentState.plannerNote,
          userContent: JSON.stringify({
            ...JSON.parse(currentState.userContent || '{}'),
            sandboxContext
          })
        }),
        planTools: (currentState) => pickScopedTools(
          researcherSpec.allowedTools,
          researcherSpec.planTools({ intent: currentState.intent, message: currentState.message })
        ),
        buildToolMessage: ({ tool, rawResult }) => ({
          role: 'user',
          content: `Researcher 工具 ${tool.name} 参数 ${JSON.stringify(tool.arguments)} 返回：${JSON.stringify(rawResult)}`
        }),
        onToolResult: ({ toolRecord, rawResult }) => {
          memoryCandidates.push(...memoryCandidatesFromToolResult(toolRecord.name, rawResult));
        },
        buildStatePatch: ({ state: currentState, brief, sandbox, toolCalls }) => ({
          messages: [
            {
              role: 'system',
              content: `${currentState.systemPrompt}\n${brief.system}`
            },
            { role: 'user', content: brief.user }
          ],
          toolCalls,
          memoryCandidates: dedupeMemoryCandidates(memoryCandidates),
          subagentContexts: {
            ...currentState.subagentContexts,
            researcher: {
              intent: currentState.intent?.type || 'lookup',
              usedTools: toolCalls.map(tool => tool.name),
              sandbox: sandbox.describe()
            }
          }
        })
      });
    })
    .addNode('tutor', async (state) => {
      return tutorExecutor.runTextSubagent({
        state,
        queueNote: '正在流式生成最终回答',
        title: 'Tutor',
        buildBrief: (currentState) => learningSubagentRegistry.tutor.buildBrief({
          message: currentState.message,
          intent: currentState.intent,
          plannerNote: currentState.plannerNote,
          subagentContexts: currentState.subagentContexts
        }),
        buildMessages: (currentState, brief) => [
          {
            role: 'system',
            content: `${currentState.systemPrompt}\n${brief}\n例句会由独立结构化卡片展示，所以正文里不要再输出一整段例句列表。`
          },
          ...currentState.messages,
          {
            role: 'user',
            content: `请基于以上计划和工具结果，回答用户原问题：${currentState.message}`
          }
        ],
        estimateUsage: (messages, sandbox) => {
          const estimatedPromptTokens = estimateChatTokens(messages, getDefaultLlmModel());
          const usage = buildUsageReport({
            model: getDefaultLlmModel(),
            promptTokens: estimatedPromptTokens,
            completionTokens: 0,
            totalTokens: estimatedPromptTokens,
            estimated: true
          });
          writeSse(res, 'usage', {
            stage: 'preflight',
            ...usage,
            agent: 'tutor',
            sandboxId: sandbox.id
          });
          return usage;
        },
        streamText: async ({ messages, sandbox, onToken, onUsage }) => {
          await streamLlmText({
            messages,
            model: getDefaultLlmModel(),
            temperature: 0.25,
            maxTokens: sandbox.policy.maxCompletionTokens || 1700,
            onToken,
            onUsage: (usage) => {
              const report = buildUsageReport({
                model: getDefaultLlmModel(),
                promptTokens: usage.prompt_tokens || 0,
                completionTokens: usage.completion_tokens || 0,
                totalTokens: usage.total_tokens || ((usage.prompt_tokens || 0) + (usage.completion_tokens || 0)),
                estimated: false
              });
              writeSse(res, 'usage', {
                stage: 'final',
                ...report,
                agent: 'tutor',
                sandboxId: sandbox.id
              });
              onUsage(report);
            }
          });
        },
        buildFallbackAnswer: (currentState) => buildFallbackTutorAnswer(currentState.message, currentState.toolCalls),
        onFallback: (_error, sandbox) => {
          writeSse(res, 'agent_note', {
            agent: 'tutor',
            title: 'Tutor 降级',
            content: `DeepSeek token 流暂时超时，已基于工具结果生成本地摘要。Sandbox timeout ${sandbox.policy.timeoutMs || 0}ms`,
            sandbox: sandbox.describe()
          });
        },
        emitFallbackText: (text) => emitTextAsTokens(res, text)
      });
    })
    .addNode('memory_manager', async (state) => {
      const memoryBrief = learningSubagentRegistry.memory_manager.buildBrief({
        context: state.context
      });
      const memoryResult = await memoryExecutor.runToolSubagent({
        state,
        queueNote: '正在刷新记忆队列',
        title: 'Memory Manager',
        buildBrief: () => memoryBrief,
        planTools: () => [{ name: 'memory_status', arguments: {} }],
        buildToolMessage: ({ tool, rawResult }) => ({
          role: 'user',
          content: `Memory Manager 工具 ${tool.name} 返回：${JSON.stringify(rawResult)}`
        }),
        buildStatePatch: ({ state: currentState, sandbox, toolPayloads, toolCalls }) => ({
          messages: currentState.messages,
          toolCalls: [...currentState.toolCalls, ...toolCalls],
          subagentContexts: {
            ...currentState.subagentContexts,
            memory_manager: {
              ...memoryBrief,
              sandbox: sandbox.describe()
            }
          },
          memorySnapshot: toolPayloads[0]?.rawResult || null
        })
      });

      const memorySnapshot = memoryResult.memorySnapshot;
      let structuredExamples = [];
      const interactivePractice = buildInteractivePractice({
        message: state.message,
        intent: state.intent,
        context: state.context,
        memoryCandidates: state.memoryCandidates
      });
      try {
        structuredExamples = await generateStructuredAgentExamples({
          message: state.message,
          finalAnswer: state.finalAnswer,
          toolCalls: state.toolCalls,
          memoryCandidates: state.memoryCandidates,
          context: state.context
        });
      } catch (error) {
        console.error('Failed to generate structured agent examples:', error);
        structuredExamples = buildFallbackAgentExamples({
          message: state.message,
          memoryCandidates: state.memoryCandidates,
          difficultyLevel: resolveDifficultyLevel({
            requested: state.context?.exampleDifficulty || getMemorySettings().exampleDifficulty,
            lookup: state.context?.lookup || null,
            memoryCandidates: state.memoryCandidates
          })
        });
      }
      writeSse(res, 'agent_note', {
        agent: 'memory_manager',
        title: 'Memory Manager',
        content: `当前记忆卡 ${memorySnapshot.memory.total} 张，待复习 ${memorySnapshot.memory.due} 张，已稳定 ${memorySnapshot.memory.mastered} 张。`
      });

      return {
        ...memoryResult,
        memorySnapshot,
        structuredExamples,
        interactivePractice,
        subagentContexts: {
          ...memoryResult.subagentContexts,
          memory_manager: {
            ...(memoryResult.subagentContexts?.memory_manager || {}),
            ...memoryBrief
          }
        }
      };
    });

  if (specialistId === 'example_designer') {
    graph = graph.addNode('example_designer', buildSpecialistNodeExecutor({
      specialistId: 'example_designer',
      runId,
      queueNote: '正在整理场景例句 brief',
      stateKey: 'example_designer',
      title: 'Example Coach',
      buildBrief: (state) => learningSubagentRegistry.example_designer.buildBrief({
        message: state.message,
        intent: state.intent
      }),
      writeSse,
      emitAgentQueue,
      res,
      closedRef
    }));
  }

  if (specialistId === 'practice_coach') {
    graph = graph.addNode('practice_coach', buildSpecialistNodeExecutor({
      specialistId: 'practice_coach',
      runId,
      queueNote: '正在按画像整理练习 brief',
      stateKey: 'practice_coach',
      title: 'Practice Coach',
      buildBrief: (state) => learningSubagentRegistry.practice_coach.buildBrief({
        message: state.message,
        context: state.context
      }),
      writeSse,
      emitAgentQueue,
      res,
      closedRef
    }));
  }

  graph = graph
    .addEdge(START, 'planner')
    .addEdge('planner', 'researcher');

  if (specialistId === 'example_designer') {
    graph = graph.addEdge('researcher', 'example_designer').addEdge('example_designer', 'tutor');
  } else if (specialistId === 'practice_coach') {
    graph = graph.addEdge('researcher', 'practice_coach').addEdge('practice_coach', 'tutor');
  } else {
    graph = graph.addEdge('researcher', 'tutor');
  }

  graph = graph
    .addEdge('tutor', 'memory_manager')
    .addEdge('memory_manager', END);

  return graph.compile();
}

async function streamLlmText(options) {
  const {
    messages,
    model,
    temperature = 0.25,
    maxTokens = 1600,
    onToken,
    onUsage
  } = options;
  let content = '';
  let usage = null;

  return traceLangSmithRun({
    name: 'llm.stream',
    runType: 'llm',
    inputs: {
      messages,
      model: model || getDefaultLlmModel(),
      temperature,
      maxTokens,
      stream: true
    },
    metadata: {
      provider: getLlmProvider(),
      model: model || getDefaultLlmModel(),
      temperature,
      max_tokens: maxTokens,
      stream: true
    },
    tags: ['llm', 'stream', getLlmProvider()]
  }, () => streamLlmTextImpl({
    ...options,
    temperature,
    maxTokens,
    onToken: (chunk) => {
      content += chunk;
      onToken?.(chunk);
    },
    onUsage: (nextUsage) => {
      usage = nextUsage;
      onUsage?.(nextUsage);
    }
  }), {
    processOutputs: () => ({
      content: content.slice(0, 4000),
      contentLength: content.length,
      usage
    })
  });
}

async function streamLlmTextImpl({ messages, model, temperature = 0.25, maxTokens = 1600, onToken, onUsage, shouldCancel }) {
  if (getLlmProvider() !== 'ollama') {
    const response = await callOpenAiCompatibleChat({ messages, model, stream: true, temperature, maxTokens, timeoutMs: 25000 });
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    while (true) {
      if (shouldCancel?.()) {
        await reader.cancel().catch(() => {});
        throw new Error('Tutor cancelled');
      }
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split('\n\n');
      buffer = events.pop() || '';

      for (const event of events) {
        const line = event.split('\n').find(item => item.startsWith('data: '));
        if (!line) continue;
        const dataStr = line.slice(6).trim();
        if (dataStr === '[DONE]') return;
        if (shouldCancel?.()) {
          await reader.cancel().catch(() => {});
          throw new Error('Tutor cancelled');
        }
        try {
          const data = JSON.parse(dataStr);
          if (data.usage && typeof onUsage === 'function') {
            onUsage(data.usage);
          }
          const content = data.choices?.[0]?.delta?.content || '';
          if (content) onToken(content);
        } catch (e) {
          // Ignore malformed partial stream frames.
        }
      }
    }
    return;
  }

  const response = await ollama.chat({
    model: model || process.env.OLLAMA_MODEL || 'qwen2.5',
    messages,
    stream: true
  });

  for await (const part of response) {
    if (shouldCancel?.()) {
      throw new Error('Tutor cancelled');
    }
    const content = part.message?.content || '';
    if (content) onToken(content);
  }
}

// 调用 Jisho API 获取词汇（支持全词类）
function searchJisho(keyword, verbOnly = true) {
  return new Promise((resolve, reject) => {
    const req = https.get(`https://jisho.org/api/v1/search/words?keyword=${encodeURIComponent(keyword)}`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          const words = [];
          if (!parsed.data) return resolve([]);
          
          for (const item of parsed.data) {
            const senses = item.senses || [];
            let meaning = '';
            let wordType = 'other';
            
            for (const sense of senses) {
              const pos = sense.parts_of_speech || [];
              const posStr = pos.join(' ').toLowerCase();
              if (!meaning) {
                meaning = sense.english_definitions.slice(0, 2).join(', ');
              }
              if (wordType === 'other') {
                if (posStr.includes('verb')) wordType = 'verb';
                else if (posStr.includes('i-adjective')) wordType = 'i-adjective';
                else if (posStr.includes('na-adjective')) wordType = 'na-adjective';
                else if (posStr.includes('noun')) wordType = 'noun';
                else if (posStr.includes('adverb')) wordType = 'adverb';
              }
            }
            
            if (verbOnly && wordType !== 'verb') continue;
            if (!verbOnly && wordType === 'other') continue;
            
            if (item.japanese && item.japanese.length > 0) {
              const kanji = item.japanese[0].word || item.japanese[0].reading;
              const kana = item.japanese[0].reading || kanji;
              words.push({
                kanji,
                kana,
                romaji: wanakana.toRomaji(kana),
                meaning,
                wordType
              });
            }
          }
          resolve(words);
        } catch (e) {
          reject(e);
        }
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(5000, () => {
      req.destroy();
      reject(new Error('Jisho API timeout'));
    });
  });
}

// 查询单个词的详细信息（用于非动词查词）
function lookupWordJisho(keyword) {
  return new Promise((resolve, reject) => {
    const url = `https://jisho.org/api/v1/search/words?keyword=${encodeURIComponent(keyword)}`;
    const req = https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (!parsed.data || parsed.data.length === 0) return resolve(null);
          
          const item = parsed.data[0];
          if (!item.japanese || item.japanese.length === 0) return resolve(null);
          
          const japanese = item.japanese[0];
          const word = japanese.word || japanese.reading;
          const reading = japanese.reading || word;
          
          let wordType = 'other';
          const meanings = [];
          
          for (const sense of (item.senses || [])) {
            const pos = sense.parts_of_speech || [];
            const posStr = pos.join(' ').toLowerCase();
            
            if (wordType === 'other') {
              if (posStr.includes('verb')) wordType = 'verb';
              else if (posStr.includes('i-adjective')) wordType = 'i-adjective';
              else if (posStr.includes('na-adjective')) wordType = 'na-adjective';
              else if (posStr.includes('noun')) wordType = 'noun';
              else if (posStr.includes('adverb')) wordType = 'adverb';
            }
            
            meanings.push({
              pos: pos.join(', '),
              definitions: (sense.english_definitions || []).join(', ')
            });
          }
          
          const jlpt = item.jlpt?.length > 0 ? item.jlpt[0].replace('jlpt-', '').toUpperCase() : '';
          
          resolve({
            wordType,
            word,
            reading,
            romaji: wanakana.toRomaji(reading),
            meanings,
            jlpt,
            isCommon: item.is_common || false
          });
        } catch (e) {
          reject(e);
        }
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(5000, () => {
      req.destroy();
      reject(new Error('Jisho API timeout'));
    });
  });
}

// 初始化 Ollama
const app = express();
const PORT = process.env.PORT || 3456;
// 容器环境（Render/Docker/Fly 等）必须监听 0.0.0.0 才能从外部访问；
// 本地默认绑回环更安全。Render 自动注入 RENDER=true 让我们识别。
const HOST = process.env.HOST || (process.env.RENDER ? '0.0.0.0' : '127.0.0.1');
const feishuClient = createFeishuClient();
const shouldProcessFeishuEvent = createRecentEventDedupe();
let feishuLongConnection = null;

// 中间件
// 跨域：默认放开（演示/开发），生产可设 CORS_ORIGIN 为具体域名收紧。
// Authorization 必须放行；X-LLM-* 是用户自带 key 的运行时覆盖（每请求生效，不入库）。
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-LLM-API-Key', 'X-LLM-Provider', 'X-LLM-Base-Url', 'X-LLM-Model']
}));
app.use(express.json());

// 请求级 LLM 配置覆盖：前端把用户的 key/配置放在 header 里，每请求独立、不入库；
// getRuntimeLlmSettings 取此 store 作最高优先级，避免共享一把 key 被打爆额度。
const llmRequestStore = new AsyncLocalStorage();
app.use((req, _res, next) => {
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

// 用户认证：建 users 表 + 默认用户；authOptional 给每个请求挂 req.userId
// （未登录或历史数据 fallback 到默认用户 1，保证向后兼容、不破坏现有功能）
ensureAuthSchema(db);
app.use(authOptional);

// 注册：用户名 + 密码，scrypt 哈希
app.post('/api/auth/register', (req, res) => {
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');
  if (username.length < 2 || username.length > 32) {
    return res.status(400).json({ error: '用户名需 2-32 个字符' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: '密码至少 6 位' });
  }
  if (username === '__default__') {
    return res.status(400).json({ error: '该用户名不可用' });
  }
  const exists = db.prepare('SELECT 1 FROM users WHERE username = ?').get(username);
  if (exists) {
    return res.status(409).json({ error: '用户名已被占用' });
  }
  const info = db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)')
    .run(username, hashPassword(password));
  const userId = info.lastInsertRowid;
  res.status(201).json({ token: signToken(userId), user: { id: userId, username } });
});

// 登录
app.post('/api/auth/login', (req, res) => {
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');
  const row = db.prepare('SELECT id, username, password_hash FROM users WHERE username = ?').get(username);
  if (!row || !verifyPassword(password, row.password_hash)) {
    return res.status(401).json({ error: '用户名或密码错误' });
  }
  res.json({ token: signToken(row.id), user: { id: row.id, username: row.username } });
});

// 当前用户：未登录返回 null（前端据此显示登录入口）
app.get('/api/auth/me', (req, res) => {
  if (!req.isAuthed) return res.json({ user: null });
  const row = db.prepare('SELECT id, username FROM users WHERE id = ?').get(req.userId);
  res.json({ user: row || null });
});

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
app.get('/api/knowledge/metrics', (req, res) => {
  res.json(knowledgeMetrics.snapshot());
});

// === 支付（A2A demo：应用发起订单，资金确认权在用户）===
const paymentProvider = await createPaymentProvider({ db });

app.get('/api/entitlements', (req, res) => {
  const entitlements = {};
  for (const def of Object.values(SKUS)) {
    entitlements[def.entitlement] = hasEntitlement(db, def.entitlement, req.userId);
  }
  res.json({ provider: paymentProvider.name, entitlements });
});

app.post('/api/payments/orders', async (req, res) => {
  const skuDef = SKUS[req.body?.sku];
  if (!skuDef) return res.status(400).json({ error: 'Unknown sku' });
  if (hasEntitlement(db, skuDef.entitlement, req.userId)) {
    return res.status(409).json({ error: 'Already unlocked' });
  }
  try {
    const order = await paymentProvider.createOrder(skuDef, req.userId);
    res.status(201).json({ provider: paymentProvider.name, ...order });
  } catch (error) {
    res.status(502).json({ error: error.message });
  }
});

app.get('/api/payments/orders/:outTradeNo', async (req, res) => {
  const order = await paymentProvider.queryOrder(req.params.outTradeNo);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  res.json(order);
});

// 仅 mock provider：模拟用户在支付宝 App 完成扫码 + 密码确认
app.post('/api/payments/orders/:outTradeNo/simulate-confirm', async (req, res) => {
  if (typeof paymentProvider.simulateBuyerConfirm !== 'function') {
    return res.status(404).json({ error: 'Not available for this provider' });
  }
  const result = await paymentProvider.simulateBuyerConfirm(req.params.outTradeNo);
  if (!result.ok) return res.status(404).json({ error: result.error });
  res.json(result);
});
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

let tokenizer = null;

// 初始化 Kuromoji 分词器
const dicPath = path.join(__dirname, 'node_modules/kuromoji/dict');
kuromoji.builder({ dicPath }).build((err, _tokenizer) => {
  if (err) {
    console.error('Failed to build Kuromoji tokenizer:', err);
  } else {
    tokenizer = _tokenizer;
    setKnowledgeTokenizer(_tokenizer);
    console.log('Kuromoji tokenizer ready');
  }
});

// 自动检测动词类型
function detectVerbType(verb) {
  if (!tokenizer) throw new Error('Tokenizer not ready');
  
  // 处理罗马音输入，将其转换为平假名
  const hiraganaVerb = wanakana.toHiragana(verb);

  // 特殊情况硬编码：カ变动词（来る / くる）
  if (hiraganaVerb === 'くる' || hiraganaVerb === '来る') {
    return 'KURU';
  }

  const tokens = tokenizer.tokenize(hiraganaVerb);
  if (tokens.length === 0) return null;
  
  // 对于像 勉強する 这样的词，动词部分在最后
  let verbToken = tokens.slice().reverse().find(t => t.pos === '動詞');
  
  // 如果没有找到动词，说明输入的词并不是一个有效的动词
  if (!verbToken) return null;
  
  // 严格匹配：确保输入的整个词就是一个动词，或者是以动词结尾的复合词（如勉強する）
  // 避免像 "tebe" 这种无意义的词被拆分成助词，或者被错误地当作动词的一部分
  // 检查提取出的动词原形（basic_form）是否能和输入的词（或其后缀）对得上
  // 因为像 `tabe` 提取出来 basic_form 是 `たべる`，如果输入只有 `tabe` 就不完整
  // 如果是复合动词如 `勉強する`，verbToken.surface_form 会是 `する`
  if (!hiraganaVerb.endsWith(verbToken.surface_form)) {
     return null;
  }
  // 还需要检查提取出的动词是否是一个完整的字典形（基本形）
  if (verbToken.conjugated_form && verbToken.conjugated_form !== '基本形') {
      return null;
  }

  const cType = verbToken.conjugated_type;
  if (cType.includes('一段')) return 'ICHIDAN';
  if (cType.includes('五段')) return 'GODAN';
  if (cType.includes('サ変')) return 'SURU';
  if (cType.includes('カ変')) return 'KURU';
  
  return null;
}

// 初始化 LLM Provider：默认本地 Ollama；Web 设置可切换 OpenAI-compatible provider。
const ollama = new Ollama({ host: 'http://127.0.0.1:11434' });
const providerDefaults = {
  deepseek: { baseUrl: 'https://api.deepseek.com', model: 'deepseek-v4-flash' },
  openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  openrouter: { baseUrl: 'https://openrouter.ai/api/v1', model: 'anthropic/claude-3.5-sonnet' },
  siliconflow: { baseUrl: 'https://api.siliconflow.cn/v1', model: 'deepseek-ai/DeepSeek-V3' },
  custom: { baseUrl: '', model: '' },
  ollama: { baseUrl: 'http://127.0.0.1:11434', model: 'qwen2.5' }
};

const contextWindowByModel = {
  'deepseek-v4-flash': 1_000_000,
  'gpt-4o-mini': 128_000,
  'anthropic/claude-3.5-sonnet': 200_000,
  'deepseek-ai/DeepSeek-V3': 128_000,
  'qwen2.5': 32_768
};

function getModelContextWindow(model = '') {
  return contextWindowByModel[model] || 128_000;
}

function buildAgentRunTitle(text = '') {
  const normalized = String(text || '')
    .replace(/\s+/g, ' ')
    .replace(/[？?！!。]+$/g, '')
    .trim();
  if (!normalized) return '新问题';
  const firstClause = normalized.split(/[，。！？；,.!?:：]/)[0]?.trim() || normalized;
  return firstClause.length > 18 ? `${firstClause.slice(0, 18)}…` : firstClause;
}

function getTokenEncoder(model = '') {
  try {
    return encodingForModel(model || 'gpt-4o-mini');
  } catch (error) {
    return getEncoding('cl100k_base');
  }
}

function estimateChatTokens(messages = [], model = '') {
  const encoder = getTokenEncoder(model);
  try {
    let total = 0;
    for (const message of messages) {
      const role = String(message?.role || '');
      const content = Array.isArray(message?.content)
        ? JSON.stringify(message.content)
        : String(message?.content || '');
      total += 8;
      total += encoder.encode(role).length;
      total += encoder.encode(content).length;
    }
    return total + 12;
  } finally {
    encoder.free?.();
  }
}

function buildUsageReport({
  model,
  promptTokens = 0,
  completionTokens = 0,
  totalTokens = 0,
  estimated = false
}) {
  const contextWindow = getModelContextWindow(model);
  const ratio = contextWindow > 0 ? totalTokens / contextWindow : 0;
  const remainingTokens = Math.max(0, contextWindow - totalTokens);
  let level = 'ok';
  let warning = '';

  if (ratio >= 0.9) {
    level = 'danger';
    warning = '上下文已接近上限，较早对话可能被压缩或忽略。';
  } else if (ratio >= 0.75) {
    level = 'warn';
    warning = '上下文已经较长，继续追问时建议及时收束或让我先总结。';
  }

  return {
    model,
    contextWindow,
    promptTokens,
    completionTokens,
    totalTokens,
    remainingTokens,
    usageRatio: Number(ratio.toFixed(4)),
    estimated,
    level,
    warning
  };
}

function getRuntimeLlmSettings({ includeSecret = false } = {}) {
  // 优先用本次请求的 header override（A 方案：每用户带自己的 key，不入库）。
  const override = llmRequestStore.getStore();
  const saved = getLlmSettings({ includeSecret: true });
  const envProvider = process.env.LLM_PROVIDER;
  const provider = override?.provider || envProvider || saved.provider || (process.env.DEEPSEEK_API_KEY ? 'deepseek' : 'ollama');
  const defaults = providerDefaults[provider] || providerDefaults.custom;
  const apiKey = override?.apiKey || process.env.DEEPSEEK_API_KEY || saved.apiKey || '';
  const settings = {
    provider,
    baseUrl: override?.baseUrl || process.env.DEEPSEEK_BASE_URL || saved.baseUrl || defaults.baseUrl,
    model: override?.model || process.env.DEEPSEEK_MODEL || saved.model || defaults.model,
    apiKey,
    apiKeySet: !!apiKey
  };
  if (!includeSecret) {
    delete settings.apiKey;
  }
  return settings;
}

function getLlmProvider() {
  return getRuntimeLlmSettings().provider;
}

function getDefaultLlmModel() {
  const settings = getRuntimeLlmSettings();
  return settings.provider === 'ollama'
    ? (settings.model || process.env.OLLAMA_MODEL || 'qwen2.5')
    : settings.model;
}

function buildChatCompletionsUrl(baseUrl = '') {
  const trimmed = baseUrl.replace(/\/$/, '');
  if (trimmed.endsWith('/chat/completions')) return trimmed;
  if (trimmed.endsWith('/v1')) return `${trimmed}/chat/completions`;
  if (trimmed.endsWith('/v1/')) return `${trimmed.replace(/\/$/, '')}/chat/completions`;
  return `${trimmed}/chat/completions`;
}

async function callOpenAiCompatibleChat(options) {
  const {
    messages,
    model,
    stream = false,
    temperature = 0.4,
    maxTokens = 1200,
    responseFormat,
    tools,
    toolChoice
  } = options;

  return traceLangSmithRun({
    name: stream ? 'llm.request.stream' : 'llm.request',
    runType: 'llm',
    inputs: {
      messages,
      model: model || getDefaultLlmModel(),
      stream,
      temperature,
      maxTokens,
      responseFormat: responseFormat || null,
      tools: Array.isArray(tools) ? tools.map(tool => tool.function?.name || tool.name).filter(Boolean) : undefined,
      toolChoice: toolChoice || null
    },
    metadata: {
      provider: getLlmProvider(),
      model: model || getDefaultLlmModel(),
      stream,
      temperature,
      max_tokens: maxTokens
    },
    tags: ['llm', getLlmProvider(), stream ? 'stream' : 'request']
  }, () => callOpenAiCompatibleChatImpl({
    ...options,
    stream,
    temperature,
    maxTokens
  }), {
    processOutputs: (response) => ({
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      stream
    })
  });
}

async function callOpenAiCompatibleChatImpl({
  messages,
  model,
  stream = false,
  temperature = 0.4,
  maxTokens = 1200,
  responseFormat,
  tools,
  toolChoice,
  timeoutMs = 45000
}) {
  const settings = getRuntimeLlmSettings({ includeSecret: true });
  if (!settings.apiKey) {
    throw new Error(`${settings.provider} API key is not configured`);
  }

  const body = {
    model: model || settings.model,
    messages,
    stream,
    temperature,
    max_tokens: maxTokens
  };
  if (stream) {
    body.stream_options = { include_usage: true };
  }
  // `thinking` 是 DeepSeek 专有字段，OpenAI / OpenRouter 等会因未知参数报 400，需按 provider 区分。
  if (settings.provider === 'deepseek') {
    body.thinking = { type: 'disabled' };
  }
  if (responseFormat) {
    body.response_format = responseFormat;
  }
  if (tools) {
    body.tools = tools;
  }
  if (toolChoice) {
    body.tool_choice = toolChoice;
  }

  const makeRequest = async (requestBody) => {
    const response = await fetch(buildChatCompletionsUrl(settings.baseUrl), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.apiKey}`
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(timeoutMs)
    });
    return response;
  };

  let response = await makeRequest(body);
  if (!response.ok && stream && body.stream_options) {
    const errorText = await response.text().catch(() => '');
    const unsupportedUsage = response.status === 400 && /stream_options|include_usage|unsupported/i.test(errorText);
    if (unsupportedUsage) {
      delete body.stream_options;
      response = await makeRequest(body);
    } else {
      throw new Error(`${settings.provider} API error ${response.status}: ${errorText.slice(0, 240)}`);
    }
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`${settings.provider} API error ${response.status}: ${errorText.slice(0, 240)}`);
  }

  return response;
}

async function callLlmText({ messages, model, temperature = 0.4, maxTokens = 1200, responseFormat }) {
  return traceLangSmithRun({
    name: 'llm.chat',
    runType: 'llm',
    inputs: {
      messages,
      model: model || getDefaultLlmModel(),
      temperature,
      maxTokens,
      responseFormat: responseFormat || null
    },
    metadata: {
      provider: getLlmProvider(),
      model: model || getDefaultLlmModel(),
      temperature,
      max_tokens: maxTokens,
      stream: false
    },
    tags: ['llm', 'chat', getLlmProvider()]
  }, () => callLlmTextImpl({ messages, model, temperature, maxTokens, responseFormat }), {
    processOutputs: (text) => ({
      content: String(text || '').slice(0, 4000),
      contentLength: String(text || '').length
    })
  });
}

async function callLlmTextImpl({ messages, model, temperature = 0.4, maxTokens = 1200, responseFormat }) {
  if (getLlmProvider() !== 'ollama') {
    const response = await callOpenAiCompatibleChat({ messages, model, stream: false, temperature, maxTokens, responseFormat });
    const data = await response.json();
    return data.choices?.[0]?.message?.content || '';
  }

  const response = await ollama.chat({
    model: model || process.env.OLLAMA_MODEL || 'qwen2.5',
    messages,
    stream: false
  });
  return response.message?.content || '';
}

async function pipeLlmStreamToSse({ res, messages, model, temperature = 0.4, maxTokens = 1800 }) {
  if (getLlmProvider() !== 'ollama') {
    const response = await callOpenAiCompatibleChat({ messages, model, stream: true, temperature, maxTokens });
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split('\n\n');
      buffer = events.pop() || '';

      for (const event of events) {
        const line = event.split('\n').find(item => item.startsWith('data: '));
        if (!line) continue;
        const dataStr = line.slice(6).trim();
        if (dataStr === '[DONE]') {
          res.write('data: [DONE]\n\n');
          return;
        }
        try {
          const data = JSON.parse(dataStr);
          const content = data.choices?.[0]?.delta?.content || '';
          if (content) {
            res.write(`data: ${JSON.stringify({ content })}\n\n`);
          }
        } catch (e) {
          // Ignore malformed partial stream frames.
        }
      }
    }
    res.write('data: [DONE]\n\n');
    return;
  }

  const response = await ollama.chat({
    model: model || process.env.OLLAMA_MODEL || 'qwen2.5',
    messages,
    stream: true
  });

  for await (const part of response) {
    res.write(`data: ${JSON.stringify({ content: part.message.content })}\n\n`);
  }
  res.write('data: [DONE]\n\n');
}

// 用 Ollama 将英文释义翻译为中文
async function translateMeaningsToChinese(meanings) {
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
    console.error('Translation failed, using English:', e.message);
    return meanings;
  }
}

// 用 kuromoji 为日语文本生成 furigana（ruby HTML）
function generateFuriganaHtml(text) {
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
function rubyForMixedToken(surface, reading) {
  const isKanjiChar = (ch) => /[\u4E00-\u9FFF\u3400-\u4DBF\uF900-\uFAFF]/.test(ch);
  const segments = [];
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
  } catch (e) {
    // regex 构建失败时 fallback
  }
  
  // fallback: 整体加 ruby
  return `<ruby>${escapeHtml(surface)}<rt>${escapeHtml(reading)}</rt></ruby>`;
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeDojoAnswer(text = '') {
  return wanakana.toHiragana(String(text || ''))
    .replace(/\s+/g, '')
    .replace(/[・ー]/g, '');
}

// 标准答案由读音假名生成，但用户可能用汉字作答（如「歌え」对「うたえ」）。
// 根据 verb（汉字形）与 reading（假名形）的公共词尾推导出答案的汉字写法变体。
function buildDojoAnswerVariants(question = {}) {
  const variants = new Set();
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

function buildDojoHint(question = {}) {
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

function buildDojoExplanation(question = {}, isCorrect = false) {
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

async function generateDojoAgentCopy({ mode = 'check', question = {}, userAnswer = '', isCorrect = false }) {
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

// 健康检查
app.get('/health', (req, res) => {
  res.json({ status: 'ok', dictionaryReady: !!tokenizer });
});

app.get('/api/llm-status', (req, res) => {
  const settings = getRuntimeLlmSettings();
  res.json({
    provider: settings.provider,
    model: settings.model,
    baseUrl: settings.baseUrl,
    apiKeySet: settings.apiKeySet
  });
});

app.get('/api/hot-placeholders', async (req, res) => {
  try {
    const data = await fetchHotPlaceholderExamples(String(req.query.force || '') === '1');
    res.json({
      source: data.source,
      updatedAt: data.updatedAt,
      examples: data.examples
    });
  } catch (error) {
    res.status(500).json({
      source: 'fallback',
      updatedAt: Date.now(),
      examples: [...defaultHotPlaceholderExamples]
    });
  }
});

app.get('/api/llm-settings', (req, res) => {
  res.json(getRuntimeLlmSettings());
});

app.post('/api/llm-settings', (req, res) => {
  try {
    res.json(saveLlmSettings(req.body || {}));
  } catch (error) {
    res.status(500).json({ error: 'Failed to save LLM settings.' });
  }
});

function verifyFeishuToken(payload = {}) {
  const expected = String(process.env.FEISHU_VERIFICATION_TOKEN || '').trim();
  if (!expected) return true;
  return String(payload.token || payload.header?.token || '').trim() === expected;
}

function truncatePlatformReply(text = '', limit = 3500) {
  const normalized = String(text || '').trim() || '我暂时没有生成有效回答。';
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, limit - 20)}\n\n（内容较长，已截断）`;
}

async function processFeishuMessage(parsed, { dedupe = true } = {}) {
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

async function startFeishuLongConnection() {
  const mode = String(process.env.FEISHU_CONNECTION_MODE || FEISHU_CONNECTION_MODES.DISABLED).trim().toLowerCase();
  if (mode !== FEISHU_CONNECTION_MODES.WEBSOCKET) return;

  try {
    feishuLongConnection = await createFeishuLongConnection({
      onMessage: processFeishuMessage
    });
    await feishuLongConnection.start();
    console.log('[feishu] long connection started.');
  } catch (error) {
    console.error('[feishu] long connection disabled:', error.message || error);
  }
}

app.post('/api/integrations/feishu/webhook', (req, res) => {
  const payload = req.body || {};

  if (payload.type === 'url_verification') {
    if (!verifyFeishuToken(payload)) {
      return res.status(403).json({ error: 'Invalid Feishu verification token.' });
    }
    return res.json({ challenge: payload.challenge });
  }

  if (!verifyFeishuToken(payload)) {
    return res.status(403).json({ error: 'Invalid Feishu verification token.' });
  }

  const parsed = parseFeishuTextMessage(payload);
  if (!parsed) {
    return res.json({ ok: true, ignored: true, reason: 'not_text_message' });
  }
  if (!shouldProcessFeishuEvent(parsed.eventId || parsed.messageId)) {
    return res.json({ ok: true, ignored: true, reason: 'duplicate_event' });
  }

  res.json({ ok: true, accepted: true });
  processFeishuMessage(parsed, { dedupe: false }).catch((error) => {
    console.error('[feishu] failed to process message:', error);
    feishuClient.replyText(parsed.messageId, `处理失败：${error.message || '未知错误'}`).catch((replyError) => {
      console.error('[feishu] failed to send error reply:', replyError);
    });
  });
});

app.get('/api/subagent-tasks', (req, res) => {
  const limit = Math.max(0, Number.parseInt(String(req.query.limit || '0'), 10) || 0);
  res.json(listBackgroundTasks({
    runId: String(req.query.runId || ''),
    status: String(req.query.status || ''),
    limit
  }));
});

app.get('/api/subagent-tasks/:taskId', (req, res) => {
  const task = getBackgroundTaskResult(req.params.taskId);
  if (!task) {
    return res.status(404).json({ error: 'Task not found.' });
  }
  res.json(task);
});

app.post('/api/subagent-tasks/:taskId/cancel', (req, res) => {
  const ok = requestCancelBackgroundTask(req.params.taskId);
  if (!ok) {
    return res.status(404).json({ error: 'Task not found.' });
  }
  res.json({ ok: true, taskId: req.params.taskId });
});

app.get('/api/agent-runs', (req, res) => {
  const limit = Math.max(1, Number.parseInt(String(req.query.limit || '30'), 10) || 30);
  const threadId = String(req.query.threadId || '');
  res.json(threadId ? listAgentRunsByThread({ threadId, limit }) : listAgentRuns(limit));
});

app.get('/api/agent-runs/:runId', (req, res) => {
  const run = getAgentRun(req.params.runId);
  if (!run) {
    return res.status(404).json({ error: 'Run not found.' });
  }
  res.json(run);
});

app.get('/api/agent-thread-summary', (req, res) => {
  const limit = Math.max(1, Number.parseInt(String(req.query.limit || '8'), 10) || 8);
  res.json(buildThreadSummary({
    currentRunId: String(req.query.currentRunId || ''),
    threadId: String(req.query.threadId || ''),
    limit
  }));
});

app.post('/api/agent-runs/:runId/cancel', (req, res) => {
  updateAgentRun(req.params.runId, {
    status: 'cancelled',
    error: 'Cancellation requested by user',
    summary: '运行被用户主动停止。'
  });
  const cancelled = requestCancelTasksForRun(req.params.runId);
  res.json({ ok: true, runId: req.params.runId, cancelled });
});

// Furigana API: 用 kuromoji 为日文文本生成 ruby HTML
app.post('/api/furigana', express.json(), (req, res) => {
  const { texts } = req.body; // 支持批量: string[]
  if (!texts || !Array.isArray(texts)) {
    return res.status(400).json({ error: 'texts array required' });
  }
  if (!tokenizer) {
    return res.status(503).json({ error: 'Tokenizer not ready' });
  }
  const results = texts.map(t => generateFuriganaHtml(t));
  res.json({ results });
});

// 获取可用模型
app.get('/api/ai-models', async (req, res) => {
  if (getLlmProvider() !== 'ollama') {
    const model = getDefaultLlmModel();
    return res.json([...new Set([model, 'deepseek-v4-flash', 'gpt-4o-mini', 'claude-3-5-sonnet-20241022'].filter(Boolean))]);
  }
  try {
    const response = await ollama.list();
    res.json(response.models.map(m => m.name));
  } catch (error) {
    console.error('Failed to fetch models:', error);
    res.status(500).json({ error: 'Failed to fetch models' });
  }
});

// 场景列表 API
app.get('/api/scenes', (req, res) => {
  res.json(sceneCatalog);
});

// 练习画像 API
app.get('/api/practice-profile', (req, res) => {
  try {
    const records = listRecentPracticeRecords(2000);
    res.json(buildPracticeProfile(records));
  } catch (error) {
    res.status(500).json({ error: 'Failed to build practice profile.' });
  }
});

app.get('/api/user-profile', (req, res) => {
  try {
    const records = listRecentPracticeRecords(2000, req.userId);
    const practiceProfile = buildPracticeProfile(records);
    const memoryCards = listMemoryCards(500, req.userId);
    res.json(buildUserProfile({ memoryCards, practiceProfile }));
  } catch (error) {
    res.status(500).json({ error: 'Failed to build user profile.' });
  }
});

// 练习记录写入 API
app.post('/api/practice-records', (req, res) => {
  try {
    const {
      verb,
      formKey,
      sceneId,
      sceneName,
      userAnswer,
      correctAnswer,
      isCorrect,
      durationMs,
      answeredAt
    } = req.body || {};

    if (!verb || !formKey || typeof isCorrect !== 'boolean') {
      return res.status(400).json({ error: 'Missing required practice record fields.' });
    }

    insertPracticeRecord({
      verb,
      formKey,
      sceneId,
      sceneName,
      userAnswer,
      correctAnswer,
      isCorrect,
      durationMs,
      answeredAt
    }, req.userId);

    const records = listRecentPracticeRecords(2000, req.userId);
    res.status(201).json(buildPracticeProfile(records));
  } catch (error) {
    res.status(500).json({ error: 'Failed to save practice record.' });
  }
});

// 把一次交互练习的结果反馈到长期记忆（间隔复习）系统。
// 这是核心闭环：Agent 出的题 -> 用户作答 -> 结果驱动 SRS 调度，错题缩短间隔、对题拉长间隔。
function recordAgentPracticeToMemory({ question, userAnswer, isCorrect, hintUsed }, userId = DEFAULT_USER_ID) {
  // 答对且没用提示 = good；答对但用了提示 = hard；答错 = forgot。
  const grade = !isCorrect ? 'forgot' : hintUsed ? 'hard' : 'good';

  insertPracticeRecord({
    verb: question.verb,
    formKey: question.formKey,
    sceneId: question.sceneId || 'agent-practice',
    sceneName: question.sceneName || 'Agent 练习',
    userAnswer,
    correctAnswer: question.answer,
    isCorrect,
    durationMs: 0,
    answeredAt: new Date().toISOString()
  }, userId);

  let card = getMemoryCardByWord(question.verb, userId);
  let created = false;
  if (!card) {
    // 练过的词若尚未进入记忆库，自动建卡，让它纳入复习队列。
    upsertMemoryCard({
      word: question.verb,
      reading: question.reading || '',
      meaning: question.meaning || '',
      wordType: question.wordType || 'verb',
      verbType: question.verbType || '',
      sample: '',
      source: 'agent-practice'
    }, userId);
    card = getMemoryCardByWord(question.verb, userId);
    created = true;
  }

  let updatedCard = null;
  if (card) {
    updatedCard = reviewMemoryCard(card.id, grade, getMemorySettings(), userId);
  }

  return {
    grade,
    created,
    card: updatedCard || card,
    cards: listMemoryCards(500, userId),
    profile: buildPracticeProfile(listRecentPracticeRecords(2000, userId))
  };
}

app.post('/api/dojo-agent-turn', async (req, res) => {
  try {
    const {
      question = {},
      userAnswer = '',
      action = 'check',
      hintUsed = false,
      recordToMemory = false
    } = req.body || {};
    if (!question.answer || !question.verb || !question.formKey) {
      return res.status(400).json({ error: 'Missing required dojo question fields.' });
    }

    if (action === 'hint') {
      const hint = await generateDojoAgentCopy({ mode: 'hint', question });
      return res.json({
        role: 'dojo-coach',
        action: 'hint',
        hint
      });
    }

    const normalizedUser = normalizeDojoAnswer(userAnswer);
    const isCorrect = buildDojoAnswerVariants(question).has(normalizedUser);
    const explanation = await generateDojoAgentCopy({
      mode: 'check',
      question,
      userAnswer,
      isCorrect
    });

    let memory = null;
    if (recordToMemory) {
      try {
        memory = recordAgentPracticeToMemory({ question, userAnswer, isCorrect, hintUsed }, req.userId);
      } catch (memoryError) {
        console.error('Failed to record agent practice to memory:', memoryError);
      }
    }

    return res.json({
      role: 'dojo-coach',
      action: 'check',
      isCorrect,
      correctAnswer: question.answer,
      explanation,
      memory
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to run dojo coach.' });
  }
});

// 记忆卡片 API：间隔复习队列
app.get('/api/memory-cards', (req, res) => {
  try {
    res.json(listMemoryCards(500, req.userId));
  } catch (error) {
    res.status(500).json({ error: 'Failed to load memory cards.' });
  }
});

app.post('/api/memory-cards', (req, res) => {
  try {
    const card = req.body || {};
    if (!card.word) {
      return res.status(400).json({ error: 'Missing required field: word.' });
    }
    upsertMemoryCard(card, req.userId);
    res.status(201).json(listMemoryCards(500, req.userId));
  } catch (error) {
    res.status(500).json({ error: 'Failed to save memory card.' });
  }
});

app.delete('/api/memory-cards/:id', (req, res) => {
  try {
    const removed = deleteMemoryCard(req.params.id, req.userId);
    if (!removed.changes) {
      return res.status(404).json({ error: 'Memory card not found.' });
    }
    res.json(listMemoryCards(500, req.userId));
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete memory card.' });
  }
});

// 限流后的当日复习队列 + 配额（newCardsPerDay / reviewLimitPerDay 在此生效）
app.get('/api/memory-review-queue', (req, res) => {
  try {
    res.json(getReviewQueue(req.userId, getMemorySettings()));
  } catch (error) {
    res.status(500).json({ error: 'Failed to build review queue.' });
  }
});

app.post('/api/memory-cards/:id/review', (req, res) => {
  try {
    const { grade } = req.body || {};
    if (!['forgot', 'hard', 'good'].includes(grade)) {
      return res.status(400).json({ error: 'Invalid review grade.' });
    }
    const updated = reviewMemoryCard(req.params.id, grade, getMemorySettings(), req.userId);
    if (!updated) {
      return res.status(404).json({ error: 'Memory card not found.' });
    }
    res.json({
      updated,
      cards: listMemoryCards(500, req.userId),
      quota: getDailyQuota(req.userId, getMemorySettings())
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to review memory card.' });
  }
});

app.get('/api/memory-settings', (req, res) => {
  res.json(getMemorySettings());
});

app.post('/api/memory-settings', (req, res) => {
  try {
    res.json(saveMemorySettings(req.body || {}));
  } catch (error) {
    res.status(500).json({ error: 'Failed to save memory settings.' });
  }
});

// Agent Memory 管理：用户可查看/删除 Agent 记住的长期信息（透明可控）
app.get('/api/agent-memory', (req, res) => {
  try {
    res.json(listAgentMemory(req.userId));
  } catch (error) {
    res.status(500).json({ error: 'Failed to load agent memory.' });
  }
});

app.delete('/api/agent-memory/:id', (req, res) => {
  try {
    const removed = deleteAgentMemory(req.params.id, req.userId);
    if (!removed.changes) {
      return res.status(404).json({ error: 'Agent memory not found.' });
    }
    res.json(listAgentMemory(req.userId));
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete agent memory.' });
  }
});

// 相似词推荐：词典结构 + 读音 + 释义 + 场景的轻量推荐
app.post('/api/similar-words', (req, res) => {
  try {
    const lookup = extractLookupForAgent(req.body || {});
    if (!lookup.word) {
      return res.status(400).json({ error: 'Missing word.' });
    }

    const similarWords = lookup.wordType === 'verb'
      ? buildVerbSimilarWords(lookup, 8)
      : findSimilarWords({
          word: lookup.word,
          kana: lookup.reading,
          wordType: lookup.wordType,
          meaning: lookup.meaning,
          limit: 8
        });

    res.json(similarWords);
  } catch (error) {
    res.status(500).json({ error: 'Failed to recommend similar words.' });
  }
});

// 垂类学习 Agent：整合查词、相似词、记忆和练习画像
app.post('/api/agent/learning-plan', async (req, res) => {
  try {
    const lookup = extractLookupForAgent(req.body?.lookup || req.body || {});
    const memoryCards = listMemoryCards(500);
    const profile = buildPracticeProfile(listRecentPracticeRecords(2000));
    const similarWords = lookup.word
      ? (lookup.wordType === 'verb'
          ? buildVerbSimilarWords(lookup, 8)
          : findSimilarWords({
              word: lookup.word,
              kana: lookup.reading,
              wordType: lookup.wordType,
              meaning: lookup.meaning,
              limit: 8
            }))
      : [];

    const payload = buildLearningAgentPayload({ lookup, profile, memoryCards, similarWords });

    if (lookup.word && getLlmProvider() !== 'ollama') {
      try {
        const enhancedNote = await callLlmText({
          messages: [
            {
              role: 'system',
              content: '你是一个日语学习教练。只输出一段简洁中文建议，最多80字，具体、可执行。'
            },
            {
              role: 'user',
              content: JSON.stringify({
                lookup,
                similarWords: similarWords.slice(0, 5),
                memory: payload.memory,
                weakestForms: profile.weakestForms?.slice(0, 2) || []
              })
            }
          ],
          model: getDefaultLlmModel(),
          temperature: 0.3,
          maxTokens: 180
        });
        if (enhancedNote.trim()) {
          payload.coachNote = enhancedNote.trim();
        }
      } catch (e) {
        console.error('LLM agent note failed:', e.message);
      }
    }

    res.json(payload);
  } catch (error) {
    res.status(500).json({ error: 'Failed to build learning agent payload.' });
  }
});

async function runToolCallingAgent({ message, context = {} }) {
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

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userContent }
  ];
  const toolCalls = [];

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
      let args = {};
      try {
        args = JSON.parse(call.function?.arguments || '{}');
      } catch (e) {
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

// Tool-calling Agent：LLM 决策，后端执行工具，再汇总答案
app.post('/api/agent/run', async (req, res) => {
  try {
    const { message, context = {} } = req.body || {};
    if (!message || !message.trim()) {
      return res.status(400).json({ error: 'Missing agent message.' });
    }
    const result = await traceLangSmithRun({
      name: 'agent.run',
      runType: 'chain',
      inputs: {
        message,
        context: {
          channel: context.channel || 'api',
          sessionId: context.sessionId || null,
          hasLookup: !!context.lookup,
          hasMemoryStats: !!context.memoryStats
        }
      },
      metadata: {
        endpoint: '/api/agent/run',
        provider: getLlmProvider(),
        model: getDefaultLlmModel()
      },
      tags: ['agent', 'tool-calling']
    }, () => runToolCallingAgent({ message, context }), {
      processOutputs: (output) => ({
        answer: String(output?.answer || '').slice(0, 4000),
        toolCalls: Array.isArray(output?.toolCalls) ? output.toolCalls.map(call => call.name) : []
      })
    });
    res.json(result);
  } catch (error) {
    console.error('Agent run failed:', error);
    res.status(500).json({ error: 'Agent run failed.' });
  }
});

// LangGraph streaming multi-agent runtime：Planner -> Researcher(tools) -> Tutor(tokens) -> Memory Manager
app.post('/api/agent/stream', async (req, res) => {
  prepareSse(res);

  try {
    const { message, context = {}, runId: clientRunId, threadId: clientThreadId } = req.body || {};
    if (!message || !message.trim()) {
      writeSse(res, 'error', { message: 'Missing agent message.' });
      return res.end();
    }
    const runId = String(clientRunId || `agent-run-${Date.now()}`);
    const threadId = String(clientThreadId || 'default-thread');
    const closedRef = { closed: false };
    res.on('close', () => {
      closedRef.closed = true;
      requestCancelTasksForRun(runId);
    });

    const systemPrompt = `你是 Japanese Word Master 的日语学习 Agent 编排器。
你采用 DeerFlow 风格的多 Agent 工作流：Planner 规划，Researcher 调工具查证，Tutor 输出学习解释，Memory Manager 维护复习上下文。
回答要求：
1. 用中文回答，必要时保留日语原文。
2. 工具结果优先，不确定就说明不确定。
3. 输出要适合日语学习者：对比表、例句、误用提醒、下一步练习。
4. 若 context 里有 agentMemory（用户的长期目标/偏好/事实/任务），请据此个性化：贴合其学习目标与水平、遵守其偏好（如例句风格、解释详略），但不要生硬复述这些记忆。`;

    const compactSummary = buildPersistedCompactSummary({
      currentRunId: runId,
      threadId,
      conversation: context.conversation || [],
      model: getDefaultLlmModel()
    });

    // Agent Memory 注入（读路径）：检索 top-k 长期记忆，喂给编排器做个性化
    const agentMemory = retrieveAgentMemory(req.userId, { limit: 8 })
      .map(m => ({ type: m.type, value: m.value }));

    const userContent = JSON.stringify({
      userMessage: message,
      currentLookup: context.lookup || null,
      memoryStats: context.memoryStats || null,
      userProfile: context.userProfile || null,
      agentMemory: agentMemory.length > 0 ? agentMemory : null,
      exampleDifficulty: context.exampleDifficulty || getMemorySettings().exampleDifficulty || 'auto',
      compactSummary,
      recentConversation: compactSummary.recentConversation
    });

    const intent = detectLearningIntent(message);
    const agentQueue = getAgentQueue(intent);
    createAgentRun({
      runId,
      title: buildAgentRunTitle(message),
      question: message,
      intentType: intent.type || 'lookup',
      provider: getLlmProvider(),
      model: getDefaultLlmModel(),
      status: 'running',
      metadata: {
        queue: agentQueue,
        runtime: 'langgraph',
        exampleDifficulty: context.exampleDifficulty || getMemorySettings().exampleDifficulty || 'auto',
        threadId,
        compactSummary
      }
    });

    writeSse(res, 'run_start', {
      id: runId,
      provider: getLlmProvider(),
      model: getDefaultLlmModel(),
      queue: agentQueue,
      runtime: 'langgraph',
      threadId,
      compactSummary
    });

    writeSse(res, 'runtime_state', {
      threadId,
      compactSummary,
      threadSummary: compactSummary.threadSummary || null
    });

    if (compactSummary.applied) {
      writeSse(res, 'agent_note', {
        agent: 'runtime',
        title: 'Compact',
        content: [
          `压缩模式：${compactSummary.mode}`,
          compactSummary.compactedTurnCount > 0
            ? `已压缩当前会话较早的 ${compactSummary.compactedTurnCount} 条对话`
            : '',
          compactSummary.persistedRunCount > 0
            ? `并吸收最近 ${compactSummary.persistedRunCount} 轮历史摘要`
            : '',
          compactSummary.focusWords.length > 0
            ? `保留焦点词：${compactSummary.focusWords.slice(0, 5).join('、')}`
            : ''
        ].filter(Boolean).join('；')
      });
    }

    const knowledgeHits = [];
    const graph = createLearningAgentGraph({ res, closedRef, intent, runId, knowledgeHits });
    const finalState = await traceLangSmithRun({
      name: 'agent.stream',
      runType: 'chain',
      inputs: {
        message,
        runId,
        threadId,
        intent,
        context: {
          channel: context.channel || 'web',
          sessionId: context.sessionId || null,
          hasLookup: !!context.lookup,
          hasMemoryStats: !!context.memoryStats,
          conversationTurns: Array.isArray(context.conversation) ? context.conversation.length : 0
        }
      },
      metadata: {
        endpoint: '/api/agent/stream',
        runtime: 'langgraph',
        runId,
        threadId,
        provider: getLlmProvider(),
        model: getDefaultLlmModel(),
        intentType: intent.type || 'lookup'
      },
      tags: ['agent', 'langgraph', 'stream']
    }, () => {
      addLangSmithEvent('agent_queue', {
        agents: agentQueue.map(item => item.id || item.label || item)
      });
      return graph.invoke({
        runId,
        message,
        context: {
          ...context,
          compactSummary,
          conversation: compactSummary.recentConversation
        },
        intent,
        agentQueue,
        subagentContexts: {},
        systemPrompt,
        userContent,
        completed: [],
        plannerNote: {},
        messages: [],
        toolCalls: [],
        memoryCandidates: [],
        finalAnswer: '',
        structuredExamples: [],
        memorySnapshot: null,
        interactivePractice: null,
        followUpQuestions: [],
        usageReport: null
      });
    }, {
      processOutputs: (state) => ({
        finalAnswer: String(state?.finalAnswer || '').slice(0, 4000),
        completed: state?.completed || [],
        toolCalls: Array.isArray(state?.toolCalls) ? state.toolCalls.map(call => call.name) : [],
        usage: state?.usageReport || null
      })
    });

    emitAgentQueue(res, agentQueue, '', finalState.completed, '本轮 Agent 工作流完成');
    updateAgentRun(runId, {
      status: 'completed',
      summary: String(finalState.finalAnswer || '').slice(0, 500),
      metadata: {
        queue: agentQueue,
        runtime: 'langgraph',
        completed: finalState.completed || [],
        usage: finalState.usageReport || null,
        threadId,
        compactSummary,
        compactEntry: buildRunCompactEntry({
          message,
          intent,
          context,
          finalState
        })
      }
    });

    // Agent Memory 抽取（写路径，fire-and-forget 不阻塞响应）：
    // 从本轮对话抽取值得长期记的用户目标/偏好/事实/任务 → 写入 agent_memory。
    const memUserId = req.userId;
    extractAgentMemoryCandidates({ message, finalAnswer: finalState.finalAnswer || '' })
      .then(candidates => {
        if (candidates.length > 0) writeAgentMemory(candidates, memUserId, runId);
      })
      .catch(err => console.error('Agent Memory 抽取失败', err?.message || err));

    const knowledgeSources = knowledgeHits
      .filter((hit, index, arr) => arr.findIndex(h => h.id === hit.id) === index)
      .slice(0, 5);
    writeSse(res, 'done', {
      answer: finalState.finalAnswer,
      toolCalls: finalState.toolCalls,
      memoryCandidates: finalState.memoryCandidates || [],
      examples: finalState.structuredExamples || [],
      memory: finalState.memorySnapshot?.memory || null,
      interactivePractice: finalState.interactivePractice || null,
      subagentContexts: finalState.subagentContexts || {},
      knowledgeSources,
      usage: finalState.usageReport || null,
      runtime: 'langgraph'
    });
    res.end();
  } catch (error) {
    console.error('Streaming agent failed:', error);
    if (/cancelled/i.test(error?.message || '')) {
      updateAgentRun(req.body?.runId || '', {
        status: 'cancelled',
        error: error.message || 'Streaming agent cancelled.',
        summary: '运行已停止。'
      });
      writeSse(res, 'cancelled', { message: error.message || 'Streaming agent cancelled.' });
    } else {
      updateAgentRun(req.body?.runId || '', {
        status: 'failed',
        error: error.message || 'Streaming agent failed.',
        summary: '运行失败，请检查日志。'
      });
      writeSse(res, 'error', { message: error.message || 'Streaming agent failed.' });
    }
    res.end();
  }
});

app.post('/api/agent/follow-ups', async (req, res) => {
  try {
    const { message = '', answer = '', context = {}, intent = null } = req.body || {};
    if (!message.trim()) {
      return res.status(400).json({ error: 'Missing source message.' });
    }
    const resolvedIntent = intent || detectLearningIntent(message);
    const suggestions = await generateFollowUpQuestions({
      message,
      finalAnswer: answer,
      intent: resolvedIntent,
      context,
      memoryCandidates: Array.isArray(context.memoryCandidates) ? context.memoryCandidates : []
    });
    return res.json({ suggestions });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to generate follow-up suggestions.' });
  }
});

// AI 词汇解析 API（动词校验 + 非动词解析）
app.post('/api/ai-explain', async (req, res) => {
  try {
    const { verb, model, conjugationResult, wordType, wordInfo } = req.body;
    if (!verb) {
      return res.status(400).json({ error: 'Missing required parameter: verb' });
    }
    const selectedModel = model || getDefaultLlmModel();

    let prompt;

    if (wordType && wordType !== 'verb') {
      // 非动词 prompt：查词解析 + 例句 + 助记
      const wordTypeNames = {
        'noun': '名词', 'i-adjective': 'い形容词',
        'na-adjective': 'な形容词', 'adverb': '副词'
      };
      const typeName = wordTypeNames[wordType] || wordType;
      const meaningsStr = wordInfo?.meanings
        ? wordInfo.meanings.map((m, i) => `${i + 1}. [${m.pos}] ${m.definitions}`).join('\n')
        : '';

      prompt = `你是一个专业的日语教师。请详细解析日语单词「${verb}」。

单词信息：
- 词性：${typeName}
- 读音：${wordInfo?.reading || ''}
${meaningsStr ? '- 释义：\n' + meaningsStr : ''}

【重要】你的回答必须严格按以下格式：

1. 回答开头必须直接是一个 JSON 代码块（\`\`\`json 开始），不要有任何前置文字。
2. JSON 结构如下（只有 examples，不需要 verification）：
\`\`\`json
{
  "examples": [
    { "japanese": "日文例句", "kana": "平假名注音", "chinese": "中文翻译" },
    { "japanese": "...", "kana": "...", "chinese": "..." },
    { "japanese": "...", "kana": "...", "chinese": "..." }
  ]
}
\`\`\`

3. JSON 代码块闭合后，请用中文输出一段详细解析（支持 Markdown），包括：
   - 词义详解（不同语境下的含义）
   - 常用搭配和惯用表达
   - 联想记忆法或词源拆解
   - 易混淆词对比
   - 文化小知识（如有）`;
    } else {
      // 动词 prompt：活用校验 + 例句 + 助记
      const conjugationForAi = {
        dictionaryForm: conjugationResult.dictionaryForm,
        verbType: conjugationResult.verbType,
        negative: conjugationResult.negative,
        polite: conjugationResult.polite,
        teForm: conjugationResult.teForm,
        taForm: conjugationResult.taForm,
        potential: conjugationResult.potential,
        passive: conjugationResult.passive,
        causative: conjugationResult.causative,
        imperative: conjugationResult.imperative,
        volitional: conjugationResult.volitional
      };

      prompt = `你是一个严谨的日语语言学专家。请校对以下动词 "${verb}" 的活用变形结果，并提供例句和词义解析。

程序生成的活用结果：
${JSON.stringify(conjugationForAi, null, 2)}

【重要】你的回答必须严格按以下格式，不得有任何偏差：

1. 回答的开头必须直接是一个 JSON 代码块（\`\`\`json 开始），不要有任何前置文字。
2. JSON 中 "verification" 必须是第一个键，"examples" 必须是第二个键。严禁调换顺序。
3. verification 逐项校对这 9 种变形：negative, polite, teForm, taForm, potential, passive, causative, imperative, volitional。正确则 isCorrect=true, correction=""；错误则 isCorrect=false 并给出正确日文。汉字/假名写法不同不算错。
4. examples 提供 2 个日常例句，含 japanese（日文原文）、kana（平假名注音）、chinese（中文翻译）。

严格遵循此 JSON 结构（verification 在前，examples 在后）：
\`\`\`json
{
  "verification": {
    "negative": { "isCorrect": true, "correction": "" },
    "polite": { "isCorrect": true, "correction": "" },
    "teForm": { "isCorrect": true, "correction": "" },
    "taForm": { "isCorrect": true, "correction": "" },
    "potential": { "isCorrect": true, "correction": "" },
    "passive": { "isCorrect": true, "correction": "" },
    "causative": { "isCorrect": true, "correction": "" },
    "imperative": { "isCorrect": true, "correction": "" },
    "volitional": { "isCorrect": true, "correction": "" }
  },
  "examples": [
    { "japanese": "...", "kana": "...", "chinese": "..." },
    { "japanese": "...", "kana": "...", "chinese": "..." }
  ]
}
\`\`\`

5. JSON 代码块闭合后，请用中文输出一段「助记」内容（支持 Markdown），帮助学习者记忆这个动词。可以包括：词源或字形拆解、联想记忆法、易混淆词对比、文化小知识等。不要重复列举上面已有的变形结果。
6. 动词类型请使用中国通用术语：五段动词、一段动词、サ变动词、カ变动词，不要用 Godan、Ichidan 等英文。`;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    await pipeLlmStreamToSse({
      res,
      model: selectedModel,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.35,
      maxTokens: 2200
    });
    res.end();
  } catch (error) {
    console.error('LLM API Error:', error);
    if (!res.headersSent) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
    }
    res.write(`data: ${JSON.stringify({ error: 'AI 服务暂不可用，请检查 DeepSeek API Key 或本地 Ollama 服务。' })}\n\n`);
    res.end();
  }
});

// 词汇联想补全 API（双轨：local 秒回 + remote 补充）
app.get('/api/suggest', async (req, res) => {
  try {
    const { q, remote } = req.query;
    if (!q || q.trim() === '') {
      return res.json([]);
    }

    const query = q.toLowerCase().trim();
    // 用 wanakana 转假名，支持用户输入罗马音匹配假名
    const queryHira = wanakana.isRomaji(query) ? wanakana.toHiragana(query) : '';
    
    // 1. SQLite 本地词库快速匹配（索引加速，毫秒级）
    let localSuggestions = searchWords(query, 8);
    // 补充罗马音转假名匹配
    if (queryHira && localSuggestions.length < 8) {
      const hiraSuggestions = searchWords(queryHira, 8);
      const seen = new Set(localSuggestions.map(w => w.kanji + w.kana));
      for (const s of hiraSuggestions) {
        if (!seen.has(s.kanji + s.kana)) {
          localSuggestions.push(s);
          seen.add(s.kanji + s.kana);
        }
      }
      localSuggestions = localSuggestions.slice(0, 8);
    }

    // 如果不是 remote 请求，直接返回本地结果（秒回）
    if (!remote) {
      return res.json(localSuggestions.slice(0, 8));
    }

    // remote=1: 查询 Jisho API 补充远程结果
    let jishoSuggestions = [];
    try {
      jishoSuggestions = await Promise.race([
        searchJisho(query, false),
        new Promise(resolve => setTimeout(() => resolve([]), 5000))
      ]);
    } catch(e) {
      console.error('Jisho API fetch failed', e);
    }

    // 合并去重（本地优先）
    const seen = new Set(localSuggestions.map(w => w.kanji + w.kana));
    const remoteOnly = [];
    for (const item of jishoSuggestions) {
      const key = item.kanji + item.kana;
      if (!seen.has(key)) {
        seen.add(key);
        remoteOnly.push(item);
      }
    }

    // 将远程新词缓存到 SQLite（异步，不阻塞响应）
    if (remoteOnly.length > 0) {
      try {
        bulkInsert(remoteOnly.map(item => ({
          kanji: item.kanji,
          kana: item.kana,
          romaji: item.romaji,
          meaning: item.meaning || '',
          wordType: item.wordType || 'other',
          jlpt: '',
          isCommon: 0
        })));
      } catch (e) {
        // 忽略缓存失败
      }
    }

    res.json([...localSuggestions, ...remoteOnly].slice(0, 12));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch suggestions' });
  }
});

// 词汇查询 API（动词走活用流程，其他词走查词流程）
app.get('/api/conjugate', async (req, res) => {
  try {
    let { verb, type } = req.query;
    
    if (!verb) {
      return res.status(400).json({
        error: 'Missing required parameter: verb'
      });
    }

    // 处理罗马音，转换成平假名
    const processedVerb = wanakana.toHiragana(verb);

    // 如果前端没有传 type，就用 kuromoji 自动推断
    if (!type) {
      if (!tokenizer) {
        return res.status(503).json({ error: 'Dictionary is initializing, please try again later.' });
      }
      type = detectVerbType(processedVerb);
      
      // 非动词：优先查 SQLite 本地词库（毫秒级）
      if (!type) {
        const localWord = findWord(verb) || findWord(processedVerb);
        if (localWord && localWord.wordType !== 'verb' && localWord.wordType !== 'other') {
          return res.json({
            wordType: localWord.wordType,
            word: localWord.kanji,
            reading: localWord.kana,
            romaji: localWord.romaji,
            meanings: [{
              pos: localWord.wordType,
              definitions: localWord.meaning
            }],
            jlpt: localWord.jlpt || '',
            isCommon: !!localWord.isCommon,
            originalInput: verb,
            parsedAs: processedVerb
          });
        }

        // 本地未命中，回退到 Jisho 查词
        try {
          const wordInfo = await lookupWordJisho(verb);
          if (wordInfo && wordInfo.wordType !== 'other') {
            if (wordInfo.wordType === 'verb') {
              return res.status(400).json({
                error: `"${verb}" 似乎是动词，但无法解析其原形。请输入动词的辞书形（原形），如「食べる」而非「食べた」。`
              });
            }
            // 翻译英文释义为中文
            wordInfo.meanings = await translateMeaningsToChinese(wordInfo.meanings);
            // 缓存到 SQLite，下次秒回
            try {
              bulkInsert([{
                kanji: wordInfo.word,
                kana: wordInfo.reading,
                romaji: wordInfo.romaji,
                meaning: wordInfo.meanings.map(m => m.definitions).join('; '),
                wordType: wordInfo.wordType,
                jlpt: wordInfo.jlpt || '',
                isCommon: wordInfo.isCommon ? 1 : 0
              }]);
            } catch(e) { /* ignore cache error */ }
            return res.json({
              ...wordInfo,
              originalInput: verb,
              parsedAs: processedVerb
            });
          }
        } catch (e) {
          console.error('Word lookup failed:', e);
        }
        return res.status(400).json({ 
          error: `无法识别 "${verb}" (解析为 "${processedVerb}")。请确保输入正确的日语单词。` 
        });
      }
    }

    const result = conjugate(processedVerb, type);

    // 从 SQLite 本地词库查找中文释义（优先），fallback 到旧 JSON
    const dictForm = result.dictionaryForm;
    const dbWord = findWord(dictForm) || findWord(processedVerb);
    const matchedVerb = dbWord || commonVerbs.find(v => 
      v.kanji === dictForm || v.kana === dictForm || v.kanji === processedVerb || v.kana === processedVerb
    );
    const meaning = dbWord ? dbWord.meaning : (matchedVerb ? matchedVerb.meaning : '');
    const reading = dbWord ? dbWord.kana : (matchedVerb ? matchedVerb.kana : '');

    res.json({
      wordType: 'verb',
      ...result,
      meaning,
      reading,
      originalInput: verb,
      parsedAs: processedVerb
    });
  } catch (error) {
    res.status(400).json({
      error: error.message
    });
  }
});

// 获取支持的动词类型
app.get('/api/verb-types', (req, res) => {
  res.json({
    types: [
      {
        id: 'GODAN',
        name: '五段动词 (Group 1)',
        description: 'Verbs ending in う, く, ぐ, す, つ, ぬ, ふ, ぶ, む, る'
      },
      {
        id: 'ICHIDAN',
        name: '一段动词 (Group 2)',
        description: 'Verbs ending in える or いる'
      },
      {
        id: 'SURU',
        name: 'サ变动词 (Group 3)',
        description: 'Verbs ending in する'
      },
      {
        id: 'KURU',
        name: 'カ变动词 (Group 3)',
        description: 'Verbs ending in 来る'
      }
    ]
  });
});

// Dojo (动词变形道场) 题库 API
app.get('/api/dojo-quiz', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const sceneId = typeof req.query.scene === 'string' ? req.query.scene.trim() : '';
    // N1 专项：付费解锁的高阶变形包，不属于普通场景词表
    const isN1Pack = sceneId === 'n1';
    const selectedScene = sceneId && !isN1Pack ? getSceneById(sceneId) : null;
    if (!tokenizer) {
      return res.status(503).json({ error: 'Dictionary is initializing, please try again later.' });
    }
    if (sceneId && !isN1Pack && !selectedScene) {
      return res.status(400).json({ error: 'Invalid scene id.' });
    }
    if (isN1Pack && !hasEntitlement(db, 'n1-pack', req.userId)) {
      // 与支付宝「AI 收」同款语义：资源对未付费访问回 402
      return res.status(402).json({ error: 'Payment required', sku: 'n1-pack' });
    }

    const forms = isN1Pack
      ? [
          { key: 'causativePassive', label: '使役被动形' },
          { key: 'causative', label: '使役形' },
          { key: 'passive', label: '被动形' },
          { key: 'volitional', label: '意向形' },
          { key: 'imperative', label: '命令形' }
        ]
      : [
          { key: 'negative', label: '否定式 (ない形)' },
          { key: 'polite', label: '礼貌式 (ます形)' },
          { key: 'teForm', label: 'て形' },
          { key: 'taForm', label: '过去式 (た形)' },
          { key: 'potential', label: '可能形' },
          { key: 'passive', label: '被动形' },
          { key: 'causative', label: '使役形' },
          { key: 'imperative', label: '命令形' },
          { key: 'volitional', label: '意向形' }
        ];

    const sourceVerbs = selectedScene ? getVerbsForScene(commonVerbs, selectedScene.id) : commonVerbs;
    if (sourceVerbs.length === 0) {
      return res.status(400).json({ error: 'No verbs available for the selected scene.' });
    }

    const questions = [];
    const usedVerbs = new Set();

    // 从词库中随机抽取
    while (questions.length < limit && usedVerbs.size < sourceVerbs.length) {
      const randomIndex = Math.floor(Math.random() * sourceVerbs.length);
      const verbObj = sourceVerbs[randomIndex];
      
      if (usedVerbs.has(verbObj.kanji)) continue;
      usedVerbs.add(verbObj.kanji);

      // 解析动词类型
      const type = detectVerbType(verbObj.kana);
      if (!type) continue;

      try {
        // 生成所有变形
        const result = conjugate(verbObj.kana, type);
        
        // 随机挑一个考点
        const formObj = forms[Math.floor(Math.random() * forms.length)];
        const answerKana = result[formObj.key];
        
        if (!answerKana) continue;

        const options = new Set([answerKana]);
        const shuffledSourceVerbs = shuffleArray(sourceVerbs);

        for (const candidateVerb of shuffledSourceVerbs) {
          if (options.size >= 4) break;
          if (candidateVerb.kanji === verbObj.kanji) continue;

          try {
            const candidateType = detectVerbType(candidateVerb.kana);
            if (!candidateType) continue;
            const candidateResult = conjugate(candidateVerb.kana, candidateType);
            const distractor = candidateResult[formObj.key];
            if (distractor) {
              options.add(distractor);
            }
          } catch (e) {
            // ignore invalid distractor candidate
          }
        }

        if (options.size < 4) {
          for (const fallbackForm of forms) {
            if (options.size >= 4) break;
            const fallbackAnswer = result[fallbackForm.key];
            if (fallbackAnswer) {
              options.add(fallbackAnswer);
            }
          }
        }

        questions.push({
          verb: verbObj.kanji,
          kana: verbObj.kana,
          romaji: verbObj.romaji,
          meaning: verbObj.meaning,
          sceneId: isN1Pack ? 'n1' : (selectedScene?.id || getSceneIdsForVerb(verbObj.kanji)[0] || ''),
          sceneName: isN1Pack ? 'N1 专项' : (selectedScene?.name || getSceneById(getSceneIdsForVerb(verbObj.kanji)[0])?.name || ''),
          formKey: formObj.key,
          formLabel: formObj.label,
          answer: answerKana,
          options: shuffleArray(Array.from(options)).slice(0, 4)
        });
      } catch (e) {
        // 忽略解析失败的动词
      }
    }

    res.json(questions);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// === 静态托管前端 ===
// 单平台部署：Express 同时提供 API + 前端静态文件，避免跨域、省一个 Vercel。
// build 阶段已把 frontend 构建到 ../frontend/dist；找不到目录就只跑 API（开发模式）。
const frontendDist = path.join(__dirname, '..', 'frontend', 'dist');
if (fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist));
  // SPA fallback：非 /api/* 的未匹配路由都回 index.html，让前端路由接管
  app.get(/^\/(?!api\/).*/, (_req, res) => {
    res.sendFile(path.join(frontendDist, 'index.html'));
  });
  console.log(`Serving frontend from ${frontendDist}`);
}

// 启动服务器
app.listen(PORT, HOST, () => {
  console.log(`Japanese Verb Master API running on http://${HOST}:${PORT}`);
  startFeishuLongConnection();
});
