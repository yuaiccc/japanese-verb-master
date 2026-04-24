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

// 调用 Jisho API 获取更多动词补充
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
  if (verbToken.conjugated_form !== '基本形') {
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

    const prompt = `你是一个严谨且贴近中文母语者习惯的日语语言学专家。
我为你提供了一个日语动词 "${verb}" 以及程序自动生成的活用变形结果：
\`\`\`json
${JSON.stringify(conjugationResult, null, 2)}
\`\`\`

请你严格按照以下步骤和格式执行任务，优先级顺序为：1. 校对结果 -> 2. 实用例句 -> 3. 词义解析。

第一步与第二步：必须且只能以一个 JSON 代码块开始你的回答，包含校对结果（verification）和2个实用例句（examples）。不要有任何前置文本。
格式要求：
1. verification 中只核对这 9 种变形：negative, polite, teForm, taForm, potential, passive, causative, imperative, volitional。如果正确，isCorrect 为 true，correction 为 ""。如果错误，isCorrect 为 false，并在 correction 中给出正确日文。不要因为送气音或汉字/假名写法不同算错。
2. examples 中提供2个实用的日常例句，包含日文原文（japanese）、平假名注音（kana）和中文翻译（chinese）。

返回的 JSON 必须严格遵循如下结构（此为全对的示例）：
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
    {
      "japanese": "日文例句1",
      "kana": "平假名注音1",
      "chinese": "中文翻译1"
    },
    {
      "japanese": "日文例句2",
      "kana": "平假名注音2",
      "chinese": "中文翻译2"
    }
  ]
}
\`\`\`

第三步：在 JSON 代码块闭合之后，用中文简明扼要地输出该动词的词义解析（支持 Markdown）。
重要提示：在解释动词类型时，请务必使用中国国内通用的日语教学术语（如：五段动词、一段动词、サ变动词、カ变动词），绝对不要出现 "Godan"、"Ichidan" 等英文直译词汇。`;

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
app.get('/api/conjugate', (req, res) => {
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
    if (!type) {
      if (!tokenizer) {
        return res.status(503).json({ error: 'Dictionary is initializing, please try again later.' });
      }
      type = detectVerbType(processedVerb);
      if (!type) {
        return res.status(400).json({ 
          error: `无法自动识别 "${verb}" (解析为 "${processedVerb}") 的动词类型。请确保输入的是正确的日语动词原形（如：食べる、飲む、勉強する）。` 
        });
      }
    }

    const result = conjugate(processedVerb, type);
    // 如果转换后有变化，可以在返回结果里告诉前端这是基于罗马音解析的
    res.json({
      ...result,
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
