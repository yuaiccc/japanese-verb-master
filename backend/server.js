import express from 'express';
import cors from 'cors';
import kuromoji from 'kuromoji';
import * as wanakana from 'wanakana';
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
  upsertMemoryCard,
  reviewMemoryCard,
  findSimilarWords,
  getMemorySettings,
  saveMemorySettings
} from './db.js';
import { getSceneById, getSceneCatalog, getSceneIdsForVerb, getVerbsForScene } from './sceneData.js';

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

function getDateKey(value) {
  const date = new Date(value);
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
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
  const text = JSON.stringify(result);
  return text.length > 900 ? `${text.slice(0, 900)}...` : text;
}

function writeSse(res, event, payload = {}) {
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

const agentQueueTemplate = [
  { id: 'planner', label: 'Planner', description: '拆解学习任务与工具路线' },
  { id: 'researcher', label: 'Researcher', description: '调用词典、搜索和相似词工具' },
  { id: 'tutor', label: 'Tutor', description: '组织解释、例句和练习建议' },
  { id: 'memory_manager', label: 'Memory Manager', description: '读取记忆队列并更新复习上下文' }
];

function emitAgentQueue(res, activeId, completedIds = [], note = '') {
  writeSse(res, 'queue', {
    activeId,
    note,
    agents: agentQueueTemplate.map(agent => ({
      ...agent,
      status: completedIds.includes(agent.id)
        ? 'done'
        : agent.id === activeId
          ? 'running'
          : 'queued'
    }))
  });
}

function extractJapaneseTerms(text = '') {
  const matches = text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー]{2,}/gu) || [];
  const stopWords = new Set(['什么区别', '有什么区别', '请简短回答', '请回答', '区别']);
  return [...new Set(matches)]
    .map(item => item.trim())
    .filter(item => item && !stopWords.has(item))
    .slice(0, 4);
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

function emitTextAsTokens(res, text, size = 12) {
  for (let i = 0; i < text.length; i += size) {
    writeSse(res, 'token', { content: text.slice(i, i + size) });
  }
}

const LearningAgentState = Annotation.Root({
  message: Annotation({ reducer: (x, y) => y ?? x, default: () => '' }),
  context: Annotation({ reducer: (x, y) => y ?? x, default: () => ({}) }),
  systemPrompt: Annotation({ reducer: (x, y) => y ?? x, default: () => '' }),
  userContent: Annotation({ reducer: (x, y) => y ?? x, default: () => '' }),
  completed: Annotation({ reducer: (x, y) => y ?? x, default: () => [] }),
  plannerNote: Annotation({ reducer: (x, y) => y ?? x, default: () => '' }),
  messages: Annotation({ reducer: (x, y) => y ?? x, default: () => [] }),
  toolCalls: Annotation({ reducer: (x, y) => y ?? x, default: () => [] }),
  finalAnswer: Annotation({ reducer: (x, y) => y ?? x, default: () => '' }),
  memorySnapshot: Annotation({ reducer: (x, y) => y ?? x, default: () => null })
});

function createLearningAgentGraph({ res, closedRef }) {
  const graph = new StateGraph(LearningAgentState)
    .addNode('planner', async (state) => {
      emitAgentQueue(res, 'planner', state.completed, '正在拆解任务和选择工具路线');
      const plannerNote = [
        '识别用户问题中的核心词、语法点或学习目标。',
        'Researcher 优先调用 lookup_word 与 external_search 查证词义、敬语和例句。',
        '如果当前上下文涉及复习，读取 memory_status 并交给 Memory Manager 更新学习建议。',
        'Tutor 用表格、例句、误用提醒和下一步练习组织最终答案。'
      ].join('\n');
      if (closedRef.closed) return {};
      writeSse(res, 'agent_note', {
        agent: 'planner',
        title: 'Planner 计划',
        content: plannerNote
      });

      return {
        plannerNote,
        completed: [...state.completed, 'planner']
      };
    })
    .addNode('researcher', async (state) => {
      emitAgentQueue(res, 'researcher', state.completed, '正在调用工具收集事实');
      const messages = [
        {
          role: 'system',
          content: `${state.systemPrompt}
你现在扮演 Researcher。你的任务是通过工具收集事实，不要给最终长答案。
可用工具包括外部搜索、词典查询、相似词推荐、记忆状态、加入记忆卡。
如果用户问词义、语法、例句或敬语差异，优先使用 lookup_word 和 external_search。
如果问题涉及复习安排，使用 memory_status。`
        },
        { role: 'user', content: `${state.userContent}\n\nPlanner 计划：${state.plannerNote}` }
      ];
      const toolCalls = [];
      const terms = extractJapaneseTerms(state.message);
      const plannedTools = [
        ...terms.slice(0, 3).map(word => ({ name: 'lookup_word', arguments: { word } })),
        { name: 'external_search', arguments: { query: state.message } },
        ...(terms[0] ? [{ name: 'recommend_similar', arguments: { word: terms[0] } }] : []),
        { name: 'memory_status', arguments: {} }
      ];

      for (const tool of plannedTools) {
        if (closedRef.closed) return {};
        writeSse(res, 'tool_start', tool);
        const result = await executeAgentTool(tool.name, tool.arguments);
        const summarized = summarizeToolResult(result);
        const toolRecord = { ...tool, result: summarized };
        toolCalls.push(toolRecord);
        writeSse(res, 'tool_end', toolRecord);
        messages.push({
          role: 'user',
          content: `Researcher 工具 ${tool.name} 参数 ${JSON.stringify(tool.arguments)} 返回：${JSON.stringify(result)}`
        });
      }

      return {
        messages,
        toolCalls,
        completed: [...state.completed, 'researcher']
      };
    })
    .addNode('tutor', async (state) => {
      emitAgentQueue(res, 'tutor', state.completed, '正在流式生成最终回答');
      const finalMessages = [
        {
          role: 'system',
          content: `${state.systemPrompt}
你现在扮演 Tutor。基于 Researcher 的工具结果给最终答案。
请使用 Markdown，但不要写“我作为 AI”。必须包含：核心结论、对比或结构化说明、例句、误用提醒、下一步练习。`
        },
        ...state.messages,
        {
          role: 'user',
          content: `请基于以上计划和工具结果，回答用户原问题：${state.message}`
        }
      ];

      let finalAnswer = '';
      try {
        await streamLlmText({
          messages: finalMessages,
          model: getDefaultLlmModel(),
          temperature: 0.25,
          maxTokens: 1700,
          onToken: (content) => {
            finalAnswer += content;
            writeSse(res, 'token', { content });
          }
        });
      } catch (e) {
        finalAnswer = buildFallbackTutorAnswer(state.message, state.toolCalls);
        writeSse(res, 'agent_note', {
          agent: 'tutor',
          title: 'Tutor 降级',
          content: 'DeepSeek token 流暂时超时，已基于工具结果生成本地摘要。'
        });
        emitTextAsTokens(res, finalAnswer);
      }

      return {
        finalAnswer,
        completed: [...state.completed, 'tutor']
      };
    })
    .addNode('memory_manager', async (state) => {
      emitAgentQueue(res, 'memory_manager', state.completed, '正在刷新记忆队列');
      const memorySnapshot = await executeAgentTool('memory_status', {});
      writeSse(res, 'agent_note', {
        agent: 'memory_manager',
        title: 'Memory Manager',
        content: `当前记忆卡 ${memorySnapshot.memory.total} 张，待复习 ${memorySnapshot.memory.due} 张，已稳定 ${memorySnapshot.memory.mastered} 张。`
      });

      return {
        memorySnapshot,
        completed: [...state.completed, 'memory_manager']
      };
    })
    .addEdge(START, 'planner')
    .addEdge('planner', 'researcher')
    .addEdge('researcher', 'tutor')
    .addEdge('tutor', 'memory_manager')
    .addEdge('memory_manager', END);

  return graph.compile();
}

async function streamLlmText({ messages, model, temperature = 0.25, maxTokens = 1600, onToken }) {
  if (getLlmProvider() === 'deepseek') {
    const response = await callDeepSeekChat({ messages, model, stream: true, temperature, maxTokens, timeoutMs: 25000 });
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
        if (dataStr === '[DONE]') return;
        try {
          const data = JSON.parse(dataStr);
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

// 中间件
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type']
}));
app.use(express.json());

let tokenizer = null;

// 初始化 Kuromoji 分词器
const dicPath = path.join(__dirname, 'node_modules/kuromoji/dict');
kuromoji.builder({ dicPath }).build((err, _tokenizer) => {
  if (err) {
    console.error('Failed to build Kuromoji tokenizer:', err);
  } else {
    tokenizer = _tokenizer;
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

// 初始化 LLM Provider：默认本地 Ollama；设置 LLM_PROVIDER=deepseek 后走 DeepSeek
const ollama = new Ollama({ host: 'http://127.0.0.1:11434' });
const deepSeekBaseUrl = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com';
const deepSeekModel = process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash';

function getLlmProvider() {
  if (process.env.LLM_PROVIDER === 'deepseek' || process.env.DEEPSEEK_API_KEY) {
    return 'deepseek';
  }
  return 'ollama';
}

function getDefaultLlmModel() {
  return getLlmProvider() === 'deepseek' ? deepSeekModel : (process.env.OLLAMA_MODEL || 'qwen2.5');
}

async function callDeepSeekChat({
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
  if (!process.env.DEEPSEEK_API_KEY) {
    throw new Error('DEEPSEEK_API_KEY is not configured');
  }

  const body = {
    model: model || deepSeekModel,
    messages,
    stream,
    temperature,
    max_tokens: maxTokens,
    thinking: { type: 'disabled' }
  };
  if (responseFormat) {
    body.response_format = responseFormat;
  }
  if (tools) {
    body.tools = tools;
  }
  if (toolChoice) {
    body.tool_choice = toolChoice;
  }

  const response = await fetch(`${deepSeekBaseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs)
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`DeepSeek API error ${response.status}: ${errorText.slice(0, 240)}`);
  }

  return response;
}

async function callLlmText({ messages, model, temperature = 0.4, maxTokens = 1200, responseFormat }) {
  if (getLlmProvider() === 'deepseek') {
    const response = await callDeepSeekChat({ messages, model, stream: false, temperature, maxTokens, responseFormat });
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
  if (getLlmProvider() === 'deepseek') {
    const response = await callDeepSeekChat({ messages, model, stream: true, temperature, maxTokens });
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

// 健康检查
app.get('/health', (req, res) => {
  res.json({ status: 'ok', dictionaryReady: !!tokenizer });
});

app.get('/api/llm-status', (req, res) => {
  res.json({
    provider: getLlmProvider(),
    model: getDefaultLlmModel(),
    deepSeekReady: !!process.env.DEEPSEEK_API_KEY
  });
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
  if (getLlmProvider() === 'deepseek') {
    return res.json([deepSeekModel, 'deepseek-v4-pro']);
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
    });

    const records = listRecentPracticeRecords(2000);
    res.status(201).json(buildPracticeProfile(records));
  } catch (error) {
    res.status(500).json({ error: 'Failed to save practice record.' });
  }
});

// 记忆卡片 API：间隔复习队列
app.get('/api/memory-cards', (req, res) => {
  try {
    res.json(listMemoryCards(500));
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
    upsertMemoryCard(card);
    res.status(201).json(listMemoryCards(500));
  } catch (error) {
    res.status(500).json({ error: 'Failed to save memory card.' });
  }
});

app.post('/api/memory-cards/:id/review', (req, res) => {
  try {
    const { grade } = req.body || {};
    if (!['forgot', 'hard', 'good'].includes(grade)) {
      return res.status(400).json({ error: 'Invalid review grade.' });
    }
    const updated = reviewMemoryCard(req.params.id, grade, getMemorySettings());
    if (!updated) {
      return res.status(404).json({ error: 'Memory card not found.' });
    }
    res.json({ updated, cards: listMemoryCards(500) });
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

    if (lookup.word && getLlmProvider() === 'deepseek') {
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
          model: deepSeekModel,
          temperature: 0.3,
          maxTokens: 180
        });
        if (enhancedNote.trim()) {
          payload.coachNote = enhancedNote.trim();
        }
      } catch (e) {
        console.error('DeepSeek agent note failed:', e.message);
      }
    }

    res.json(payload);
  } catch (error) {
    res.status(500).json({ error: 'Failed to build learning agent payload.' });
  }
});

// Tool-calling Agent：DeepSeek 决策，后端执行工具，再汇总答案
app.post('/api/agent/run', async (req, res) => {
  try {
    const { message, context = {} } = req.body || {};
    if (!message || !message.trim()) {
      return res.status(400).json({ error: 'Missing agent message.' });
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
      memoryStats: context.memoryStats || null
    });

    if (getLlmProvider() !== 'deepseek') {
      const searchResult = await externalJapaneseSearch(message);
      const answer = await callLlmText({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `${userContent}\n\n工具结果：${JSON.stringify(searchResult)}` }
        ],
        maxTokens: 1000
      });
      return res.json({
        answer,
        toolCalls: [{ name: 'external_search', arguments: { query: message }, result: summarizeToolResult(searchResult) }]
      });
    }

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent }
    ];
    const toolCalls = [];

    for (let i = 0; i < 4; i++) {
      const response = await callDeepSeekChat({
        messages,
        model: deepSeekModel,
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
        return res.json({ answer: assistantMessage.content || '', toolCalls });
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
      model: deepSeekModel,
      temperature: 0.25,
      maxTokens: 1200
    });
    res.json({ answer: finalAnswer, toolCalls });
  } catch (error) {
    console.error('Agent run failed:', error);
    res.status(500).json({ error: 'Agent run failed.' });
  }
});

// LangGraph streaming multi-agent runtime：Planner -> Researcher(tools) -> Tutor(tokens) -> Memory Manager
app.post('/api/agent/stream', async (req, res) => {
  prepareSse(res);

  const closedRef = { closed: false };
  res.on('close', () => {
    closedRef.closed = true;
  });

  try {
    const { message, context = {} } = req.body || {};
    if (!message || !message.trim()) {
      writeSse(res, 'error', { message: 'Missing agent message.' });
      return res.end();
    }

    const systemPrompt = `你是 Japanese Word Master 的日语学习 Agent 编排器。
你采用 DeerFlow 风格的多 Agent 工作流：Planner 规划，Researcher 调工具查证，Tutor 输出学习解释，Memory Manager 维护复习上下文。
回答要求：
1. 用中文回答，必要时保留日语原文。
2. 工具结果优先，不确定就说明不确定。
3. 输出要适合日语学习者：对比表、例句、误用提醒、下一步练习。`;

    const userContent = JSON.stringify({
      userMessage: message,
      currentLookup: context.lookup || null,
      memoryStats: context.memoryStats || null
    });

    writeSse(res, 'run_start', {
      id: `agent-run-${Date.now()}`,
      provider: getLlmProvider(),
      model: getDefaultLlmModel(),
      queue: agentQueueTemplate,
      runtime: 'langgraph'
    });

    const graph = createLearningAgentGraph({ res, closedRef });
    const finalState = await graph.invoke({
      message,
      context,
      systemPrompt,
      userContent,
      completed: [],
      plannerNote: '',
      messages: [],
      toolCalls: [],
      finalAnswer: '',
      memorySnapshot: null
    });

    emitAgentQueue(res, '', finalState.completed, '本轮 Agent 工作流完成');
    writeSse(res, 'done', {
      answer: finalState.finalAnswer,
      toolCalls: finalState.toolCalls,
      memory: finalState.memorySnapshot?.memory || null,
      runtime: 'langgraph'
    });
    res.end();
  } catch (error) {
    console.error('Streaming agent failed:', error);
    writeSse(res, 'error', { message: error.message || 'Streaming agent failed.' });
    res.end();
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
    const selectedScene = sceneId ? getSceneById(sceneId) : null;
    if (!tokenizer) {
      return res.status(503).json({ error: 'Dictionary is initializing, please try again later.' });
    }
    if (sceneId && !selectedScene) {
      return res.status(400).json({ error: 'Invalid scene id.' });
    }

    const forms = [
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
          sceneId: selectedScene?.id || getSceneIdsForVerb(verbObj.kanji)[0] || '',
          sceneName: selectedScene?.name || getSceneById(getSceneIdsForVerb(verbObj.kanji)[0])?.name || '',
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

// 启动服务器
app.listen(PORT, () => {
  console.log(`Japanese Verb Master API running on port ${PORT}`);
});
