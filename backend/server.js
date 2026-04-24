import express from 'express';
import cors from 'cors';
import kuromoji from 'kuromoji';
import * as wanakana from 'wanakana';
import { conjugate } from './conjugationEngine.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 读取动词库
const commonVerbs = JSON.parse(fs.readFileSync(path.join(__dirname, 'common-verbs.json'), 'utf8'));

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

// 健康检查
app.get('/health', (req, res) => {
  res.json({ status: 'ok', dictionaryReady: !!tokenizer });
});

// 动词自动补全 API
app.get('/api/suggest', (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.trim() === '') {
      return res.json([]);
    }

    const query = q.toLowerCase().trim();
    const suggestions = commonVerbs.filter(verb => {
      return verb.kanji.includes(query) || 
             verb.kana.includes(query) || 
             verb.romaji.includes(query) ||
             verb.meaning.includes(query);
    }).slice(0, 8); // 最多返回8条记录，避免前端渲染过大

    res.json(suggestions);
  } catch (error) {
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
