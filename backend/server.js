import express from 'express';
import cors from 'cors';
import kuromoji from 'kuromoji';
import * as wanakana from 'wanakana';
import { conjugate } from './conjugationEngine.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Ollama } from 'ollama';
import https from 'https';
import { searchWords, findWord, bulkInsert } from './db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 读取动词库（conjugationEngine 辅助数据，保留）
const commonVerbs = JSON.parse(fs.readFileSync(path.join(__dirname, 'common-verbs.json'), 'utf8'));

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

// 初始化 Ollama
const ollama = new Ollama({ host: 'http://127.0.0.1:11434' });

// 用 Ollama 将英文释义翻译为中文
async function translateMeaningsToChinese(meanings) {
  try {
    const englishDefs = meanings.map((m, i) => `${i + 1}. [${m.pos}] ${m.definitions}`).join('\n');
    const response = await ollama.chat({
      model: 'qwen2.5:7b',
      messages: [{
        role: 'user',
        content: `将以下日语单词的英文释义翻译为简洁的中文。每条保持编号，只输出中文翻译，不要输出原文、词性或任何解释。格式："1. 中文释义"\n\n${englishDefs}`
      }],
      stream: false
    });
    const lines = response.message.content.trim().split('\n').filter(l => l.trim());
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

// 获取本地可用模型
app.get('/api/ai-models', async (req, res) => {
  try {
    const response = await ollama.list();
    res.json(response.models.map(m => m.name));
  } catch (error) {
    console.error('Failed to fetch models:', error);
    res.status(500).json({ error: 'Failed to fetch models' });
  }
});

// AI 词汇解析 API（动词校验 + 非动词解析）
app.post('/api/ai-explain', async (req, res) => {
  try {
    const { verb, model, conjugationResult, wordType, wordInfo } = req.body;
    if (!verb) {
      return res.status(400).json({ error: 'Missing required parameter: verb' });
    }
    const selectedModel = model || 'qwen2.5:7b';

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

    const response = await ollama.chat({
      model: selectedModel,
      messages: [{ role: 'user', content: prompt }],
      stream: true,
    });

    for await (const part of response) {
      res.write(`data: ${JSON.stringify({ content: part.message.content })}\n\n`);
    }
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (error) {
    console.error('Ollama API Error:', error);
    if (!res.headersSent) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
    }
    res.write(`data: ${JSON.stringify({ error: 'AI 服务暂不可用，请确保本地 Ollama 正在运行且模型存在。' })}\n\n`);
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
    if (!tokenizer) {
      return res.status(503).json({ error: 'Dictionary is initializing, please try again later.' });
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

    const questions = [];
    const usedVerbs = new Set();

    // 从 commonVerbs 中随机抽取
    while (questions.length < limit && usedVerbs.size < commonVerbs.length) {
      const randomIndex = Math.floor(Math.random() * commonVerbs.length);
      const verbObj = commonVerbs[randomIndex];
      
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

        questions.push({
          verb: verbObj.kanji,
          kana: verbObj.kana,
          romaji: verbObj.romaji,
          meaning: verbObj.meaning,
          formKey: formObj.key,
          formLabel: formObj.label,
          answer: answerKana
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
