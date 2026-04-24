import express from 'express';
import cors from 'cors';
import { conjugate } from './conjugationEngine.js';

const app = express();
const PORT = process.env.PORT || 3000;

// 中间件
app.use(cors());
app.use(express.json());

// 健康检查
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// 动词活用 API
app.get('/api/conjugate', (req, res) => {
  try {
    const { verb, type } = req.query;
    
    if (!verb || !type) {
      return res.status(400).json({
        error: 'Missing required parameters: verb and type'
      });
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
