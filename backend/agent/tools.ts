/**
 * Agent 工具定义与执行 —— 从 server.js 抽离。
 *
 * 包含：外部搜索（DuckDuckGo / MediaWiki / Jisho）、工具定义数组、
 * 工具执行器、结果摘要。
 *
 * 运行时实例（knowledgeRetriever / knowledgeRewriter / userRequestStore / userStore）
 * 通过 configureAgentTools 注入，避免循环依赖。
 */

import https from 'https';
import * as wanakana from 'wanakana';
import { findWord, findSimilarWords, getMemorySettings, AGENT_MEMORY_TYPES } from '../db';
import { DEFAULT_USER_ID } from '../auth';
import { traceLangSmithRun } from '../tracing/langsmith';
import { buildVerbSimilarWords, buildPracticeProfile } from './helpers';

// 运行时实例（由 server.js 启动时通过 configureAgentTools 注入）
let _knowledgeRetriever: any = null;
let _knowledgeRewriter: any = null;
let _userRequestStore: any = null;
let _userStore: any = null;

export function configureAgentTools({ knowledgeRetriever, knowledgeRewriter, userRequestStore, userStore }: Record<string, any>): void {
  _knowledgeRetriever = knowledgeRetriever;
  _knowledgeRewriter = knowledgeRewriter;
  _userRequestStore = userRequestStore;
  _userStore = userStore;
}

export async function searchDuckDuckGo(query: string): Promise<any[]> {
  try {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
    const response = await fetch(url, {
      headers: { 'User-Agent': 'JapaneseVerbMaster/1.0' },
      signal: AbortSignal.timeout(6000)
    });
    if (!response.ok) return [];
    const data: any = await response.json();
    const results: any[] = [];
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

export async function searchMediaWiki(query: string, project: string): Promise<any[]> {
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
    const data: any = await response.json();
    return (data.query?.search || []).slice(0, 5).map((item: any) => ({
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

// 调用 Jisho API 获取词汇（支持全词类）
export function searchJisho(keyword: string, verbOnly: boolean = true): Promise<any[]> {
  return new Promise((resolve, reject) => {
    const req = https.get(`https://jisho.org/api/v1/search/words?keyword=${encodeURIComponent(keyword)}`, (res: any) => {
      let data = '';
      res.on('data', (chunk: any) => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          const words: any[] = [];
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
export function lookupWordJisho(keyword: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const url = `https://jisho.org/api/v1/search/words?keyword=${encodeURIComponent(keyword)}`;
    const req = https.get(url, (res: any) => {
      let data = '';
      res.on('data', (chunk: any) => data += chunk);
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
          const meanings: any[] = [];

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

export async function externalJapaneseSearch(query: string): Promise<any> {
  const [webResults, wikiResults, wiktionaryResults, jishoResults] = await Promise.all([
    searchDuckDuckGo(`${query} Japanese grammar meaning examples`),
    searchMediaWiki(query, 'wikipedia'),
    searchMediaWiki(query, 'wiktionary'),
    searchJisho(query, false).catch(() => [])
  ]);
  return {
    query,
    webResults: [...webResults, ...wiktionaryResults, ...wikiResults].slice(0, 8),
    dictionaryResults: jishoResults.slice(0, 6).map((item: any) => ({
      word: item.kanji,
      reading: item.kana,
      romaji: item.romaji,
      meaning: item.meaning,
      wordType: item.wordType,
      source: 'Jisho'
    }))
  };
}

export const agentTools: any[] = [
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

export async function executeAgentTool(name: string, args: any = {}): Promise<any> {
  return traceLangSmithRun({
    name: `tool.${name || 'unknown'}`,
    runType: 'tool',
    inputs: { name, args },
    metadata: { tool_name: name || 'unknown' },
    tags: ['tool', String(name || 'unknown')]
  }, () => executeAgentToolImpl(name, args), {
    processOutputs: (result: any) => ({ result: summarizeToolResult(result) })
  });
}

async function executeAgentToolImpl(name: string, args: any = {}): Promise<any> {
  if (name === 'knowledge_search') {
    const rawQuery = args.query || '';
    // 查询改写（默认开）：口语提问→检索友好查询 + 关键术语，与原查询拼接做多路召回；失败降级为原查询。
    const rewrite = args.rewrite === false
      ? { query: rawQuery, rewritten: rawQuery, changed: false }
      : await _knowledgeRewriter.rewrite(rawQuery);
    const { results, degraded, reranked } = await _knowledgeRetriever.queryRelevantDocuments(rewrite.query, {
      topK: args.topK || 5, level: args.level || '', category: args.category || '',
      rerank: args.rerank !== false // 默认走三段式精排，Researcher 可显式传 false 关闭
    });
    return {
      degraded,
      reranked,
      rewritten: rewrite.changed ? rewrite.rewritten : undefined,
      hits: results.map((r: any) => ({
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
    const userId = _userRequestStore.getStore()?.userId || DEFAULT_USER_ID;
    const [cards, records] = await Promise.all([
      _userStore.listMemoryCards(500, userId),
      _userStore.listPracticeRecords(2000, userId)
    ]);
    return {
      settings: getMemorySettings(),
      memory: {
        total: cards.length,
        due: cards.filter((card: any) => new Date(card.dueAt).getTime() <= Date.now()).length,
        mastered: cards.filter((card: any) => card.intervalDays >= 7).length
      },
      dueCards: cards.filter((card: any) => new Date(card.dueAt).getTime() <= Date.now()).slice(0, 10),
      profile: buildPracticeProfile(records)
    };
  }
  if (name === 'add_memory_card') {
    const userId = _userRequestStore.getStore()?.userId || DEFAULT_USER_ID;
    await _userStore.upsertMemoryCard({
      word: args.word,
      reading: args.reading || '',
      meaning: args.meaning || '',
      wordType: args.wordType || 'other',
      verbType: args.verbType || '',
      sample: args.sample || '',
      source: 'agent-tool'
    }, userId);
    return { ok: true, cards: (await _userStore.listMemoryCards(500, userId)).slice(0, 5) };
  }
  return { error: `Unknown tool: ${name}` };
}

export function summarizeToolResult(result: any): string {
  // knowledge_search 命中含大体积 excerpt，整体 JSON 会超 900 字被截成无法解析的串；
  // 这里先压成「标题 + 短摘要 + 管线标记」的紧凑结构，保证摘要可被前端解析展示。
  if (result && Array.isArray(result.hits)) {
    const compact = {
      degraded: result.degraded,
      reranked: result.reranked,
      rewritten: result.rewritten,
      hitCount: result.hits.length,
      hits: result.hits.slice(0, 5).map((h: any) => ({
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
