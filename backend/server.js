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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 读取动词库
const commonVerbs = JSON.parse(fs.readFileSync(path.join(__dirname, 'common-verbs.json'), 'utf8'));

// 调用 Jisho API 获取汉字（如果 kuromoji 没有汉字的话）
function getKanjiFromJisho(verb) {
  return new Promise((resolve) => {
    https.get(`https://jisho.org/api/v1/search/words?keyword=${encodeURIComponent(verb)}`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.data && parsed.data.length > 0) {
            for (const item of parsed.data) {
              if (item.japanese && item.japanese.length > 0) {
                // 检查这个词是否能匹配我们输入的读音
                const reading = item.japanese[0].reading;
                const word = item.japanese[0].word;
                if (reading === verb && word) {
                  return resolve(word);
                }
              }
            }
          }
          resolve(verb); // 没找到合适的汉字，返回原词
        } catch (e) {
          resolve(verb);
        }
      });
    }).on('error', () => resolve(verb));
  });
}
function searchJisho(keyword) {
  return new Promise((resolve, reject) => {
    https.get(`https://jisho.org/api/v1/search/words?keyword=${encodeURIComponent(keyword)}`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          const verbs = [];
          if (!parsed.data) return resolve([]);
          
          for (const item of parsed.data) {
            const senses = item.senses || [];
            let isVerb = false;
            let meaning = '';
            
            for (const sense of senses) {
              const pos = sense.parts_of_speech || [];
              if (pos.some(p => p.toLowerCase().includes('verb'))) {
                isVerb = true;
                meaning = sense.english_definitions.slice(0, 2).join(', ');
                break;
              }
            }
            
            if (isVerb && item.japanese && item.japanese.length > 0) {
              const kanji = item.japanese[0].word || item.japanese[0].reading;
              const kana = item.japanese[0].reading || kanji;
              verbs.push({
                kanji,
                kana,
                romaji: wanakana.toRomaji(kana),
                meaning
              });
            }
          }
          resolve(verbs);
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

// 初始化 Ollama
const app = express();
const PORT = process.env.PORT || 3000;

// 中间件
app.use(cors());
app.use(express.json());

let tokenizer = null;

// 初始化 Kuromoji 分词器
kuromoji.builder({ dicPath: 'node_modules/kuromoji/dict' }).build((err, _tokenizer) => {
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
    return { type: 'KURU', basicForm: '来る' };
  }
  // 特殊情况硬编码：サ变动词（する）
  if (hiraganaVerb === 'する') {
    return { type: 'SURU', basicForm: 'する' };
  }

  // 尝试分词，首先用转换后的平假名
  let tokens = tokenizer.tokenize(hiraganaVerb);
  
  // 如果输入包含汉字且能被正确分词，则使用原输入以保留汉字
  // 但我们需要确保它是一个有效的动词
  const originalTokens = tokenizer.tokenize(verb);
  if (originalTokens.length > 0) {
      const originalVerbToken = originalTokens.slice().reverse().find(t => t.pos === '動詞');
      if (originalVerbToken && originalVerbToken.conjugated_form === '基本形') {
          // 如果原输入（可能包含汉字）能被正确解析为基本形动词，则优先使用它
          tokens = originalTokens;
      }
  }

  if (tokens.length === 0) return null;
  
  // 对于像 勉強する 这样的词，动词部分在最后
  let verbToken = tokens.slice().reverse().find(t => t.pos === '動詞');
  
  // 如果没有找到动词，说明输入的词并不是一个有效的动词
  if (!verbToken) return null;
  
  // 严格匹配：确保输入的整个词就是一个动词，或者是以动词结尾的复合词（如勉強する）
  // 注意：如果是复合动词，basic_form 可能只包含动词部分（如 する），需要特殊处理
  const surfaceMatches = verb.endsWith(verbToken.surface_form) || hiraganaVerb.endsWith(verbToken.surface_form);
  
  if (!surfaceMatches) {
     return null;
  }
  
  // 还需要检查提取出的动词是否是一个完整的字典形（基本形）
  if (verbToken.conjugated_form !== '基本形') {
      return null;
  }

  const cType = verbToken.conjugated_type;
  
  // 构建包含汉字的完整基本形
  // 如果是复合动词（如 勉強する），需要把前面的名词部分拼起来
  let fullBasicForm = verbToken.basic_form;
  if (tokens.length > 1) {
      // 找到动词前的名词部分
      const nounTokens = tokens.slice(0, tokens.indexOf(verbToken));
      const prefix = nounTokens.map(t => t.surface_form).join('');
      // 只有当输入的原始字符串包含这个前缀时，才拼起来
      if (verb.startsWith(prefix) || hiraganaVerb.startsWith(wanakana.toHiragana(prefix))) {
          // 如果原输入是以汉字开头的（如 勉強），就用原输入的汉字部分
          const originalPrefix = verb.substring(0, prefix.length);
          fullBasicForm = originalPrefix + verbToken.basic_form;
      }
  } else if (verbToken.surface_form === verbToken.basic_form) {
      // 如果 surface_form 和 basic_form 一样，尽量使用输入的表面形式（如果输入是汉字的话）
      // 比如输入 食べる，verbToken.basic_form 可能是 食べる，也可能是 たべる
      // 我们倾向于保留用户输入的汉字
      if (wanakana.toHiragana(verb) === wanakana.toHiragana(verbToken.basic_form)) {
          fullBasicForm = verb;
      }
  }

  let type = null;
  if (cType.includes('一段')) type = 'ICHIDAN';
  else if (cType.includes('五段')) type = 'GODAN';
  else if (cType.includes('サ変')) type = 'SURU';
  else if (cType.includes('カ変')) type = 'KURU';
  
  if (type) {
      return { type, basicForm: fullBasicForm };
  }
  
  return null;
}

// 初始化 Ollama
const ollama = new Ollama({ host: 'http://127.0.0.1:11434' });

// 健康检查
app.get('/health', (req, res) => {
  res.json({ status: 'ok', dictionaryReady: !!tokenizer });
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

// AI 动词解析及例句生成 API
app.post('/api/ai-explain', async (req, res) => {
  try {
    const { verb, model, conjugationResult } = req.body;
    if (!verb) {
      return res.status(400).json({ error: 'Missing required parameter: verb' });
    }
    const selectedModel = model || 'qwen2.5:7b';

    const prompt = `你是一个严谨的日语语言学专家。
我为你提供了一个日语动词 "${verb}" 以及程序自动生成的活用变形结果：
\`\`\`json
${JSON.stringify(conjugationResult, null, 2)}
\`\`\`

请你严格按照以下结构执行任务：

第一步：优先逐个核对上述 JSON 中的变形结果。必须且只能以一个 JSON 代码块开始你的回答，不要有任何前置文本。格式要求：
1. 请只核对这 9 种变形：negative, polite, teForm, taForm, potential, passive, causative, imperative, volitional。
2. 必须使用给定的英文 key。
3. 如果结果完全正确，请将 isCorrect 设置为 true，correction 必须为空字符串 ""。
4. 只有当你 100% 确定系统生成的结果错误时，才将 isCorrect 设置为 false，并在 correction 中给出正确的日文。
5. 不要因为送气音或汉字/假名的写法不同就认为是错的。

返回的 JSON 必须严格遵循如下结构（此为全对的示例）：
\`\`\`json
{
  "negative": { "isCorrect": true, "correction": "" },
  "polite": { "isCorrect": true, "correction": "" },
  "teForm": { "isCorrect": true, "correction": "" },
  "taForm": { "isCorrect": true, "correction": "" },
  "potential": { "isCorrect": true, "correction": "" },
  "passive": { "isCorrect": true, "correction": "" },
  "causative": { "isCorrect": true, "correction": "" },
  "imperative": { "isCorrect": true, "correction": "" },
  "volitional": { "isCorrect": true, "correction": "" }
}
\`\`\`

第二步：在 JSON 代码块之后，用中文简明扼要地解释该动词的含义，并提供2个实用的日常例句（必须包含日文原文、平假名注音和精准的中文翻译）。支持使用 Markdown 格式加粗、高亮。
注意：解释动词类型时，请使用中文习惯的称呼（如“五段动词”、“一段动词”、“サ变动词”、“カ变动词”），不要使用英文（如 Godan、Ichidan、Group 1、Group 2）。`;

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
    res.write(`data: ${JSON.stringify({ error: 'AI 服务暂不可用，请确保本地 Ollama 正在运行且模型存在。' })}\n\n`);
    res.end();
  }
});

// 动词自动补全 API
app.get('/api/suggest', async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.trim() === '') {
      return res.json([]);
    }

    const query = q.toLowerCase().trim();
    
    // 1. 本地高频词库快速匹配
    const localSuggestions = commonVerbs.filter(verb => {
      return verb.kanji.includes(query) || 
             verb.kana.includes(query) || 
             verb.romaji.includes(query) ||
             verb.meaning.includes(query);
    });

    // 2. 并行调用 Jisho API 获取更广泛的词汇（限制等待时间）
    let jishoSuggestions = [];
    try {
      jishoSuggestions = await Promise.race([
        searchJisho(query),
        new Promise(resolve => setTimeout(() => resolve([]), 800)) // 800ms 超时，保证输入流畅
      ]);
    } catch(e) {
      console.error('Jisho API fetch failed', e);
    }

    // 3. 合并去重（以 kanji 作为唯一标识）
    const merged = [...localSuggestions, ...jishoSuggestions];
    const unique = [];
    const seen = new Set();
    
    for (const verb of merged) {
      if (!seen.has(verb.kanji)) {
        seen.add(verb.kanji);
        unique.push(verb);
      }
    }

    res.json(unique.slice(0, 8)); // 最多返回8条记录
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch suggestions' });
  }
});

// 动词活用 API
app.get('/api/conjugate', async (req, res) => {
  try {
    let { verb, type } = req.query;
    
    if (!verb) {
      return res.status(400).json({
        error: 'Missing required parameter: verb'
      });
    }

    // 处理罗马音，转换成平假名
    // 比如：nomu -> のむ，taberu -> たべる
    // 原有的汉字会被保留（如 飲む 不变）
    const processedVerb = wanakana.toHiragana(verb);

    // 如果前端没有传 type，就用 kuromoji 自动推断
    let finalVerb = processedVerb;
    
    if (!type) {
      if (!tokenizer) {
        return res.status(503).json({ error: 'Dictionary is initializing, please try again later.' });
      }
      const detectResult = detectVerbType(verb);
      if (!detectResult) {
        return res.status(400).json({ 
          error: `无法自动识别 "${verb}" (解析为 "${processedVerb}") 的动词类型。请确保输入的是正确的日语动词原形（如：食べる、飲む、勉強する）。` 
        });
      }
      type = detectResult.type;
      finalVerb = detectResult.basicForm;
    }

    // 检查字符串是否完全没有汉字（wanakana.isKanji 检查是否只包含汉字，所以要手写正则）
    const hasKanji = (str) => /[\u4e00-\u9faf]/.test(str);

    // 如果推断出来的还是全平假名，尝试用 Jisho 转换成带汉字的常用形式
    // 只有当输入不包含任何汉字（即只有平假名或罗马音）时才尝试转换
    if (!hasKanji(verb) && !hasKanji(finalVerb)) {
        const kanjiVerb = await getKanjiFromJisho(finalVerb);
        if (kanjiVerb) {
            finalVerb = kanjiVerb;
        }
    }

    const result = conjugate(finalVerb, type);
    // 如果转换后有变化，可以在返回结果里告诉前端这是基于罗马音解析的
    res.json({
      ...result,
      dictionaryForm: finalVerb, // 覆盖为带汉字的原形
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

// 启动服务器
app.listen(PORT, () => {
  console.log(`Japanese Verb Master API running on port ${PORT}`);
});
