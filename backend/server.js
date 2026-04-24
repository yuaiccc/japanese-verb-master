import express from 'express';
import cors from 'cors';
import kuromoji from 'kuromoji';
import { conjugate } from './conjugationEngine.js';

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
  
  const tokens = tokenizer.tokenize(verb);
  if (tokens.length === 0) return null;
  
  // 对于像 勉強する 这样的词，动词部分在最后
  let verbToken = tokens.slice().reverse().find(t => t.pos === '動詞');
  
  // 如果没有找到动词，可能是输入的词有问题
  if (!verbToken) return null;
  
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

// 动词活用 API
app.get('/api/conjugate', (req, res) => {
  try {
    let { verb, type } = req.query;
    
    if (!verb) {
      return res.status(400).json({
        error: 'Missing required parameter: verb'
      });
    }

    // 如果前端没有传 type，就用 kuromoji 自动推断
    if (!type) {
      if (!tokenizer) {
        return res.status(503).json({ error: 'Dictionary is initializing, please try again later.' });
      }
      type = detectVerbType(verb);
      if (!type) {
        return res.status(400).json({ 
          error: `Could not automatically detect verb type for '${verb}'. Please ensure it is a valid dictionary form Japanese verb or provide the type manually.` 
        });
      }
    }

    const result = conjugate(verb, type);
    res.json(result);
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
