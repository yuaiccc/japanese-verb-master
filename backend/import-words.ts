import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { bulkInsert, getWordCount } from './db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 读取 common-words.json
const wordsPath = path.join(__dirname, 'common-words.json');
const words = JSON.parse(fs.readFileSync(wordsPath, 'utf8'));

console.log(`📦 读取到 ${words.length} 条词汇，正在导入...`);

// 批量插入
bulkInsert(words);

const count = getWordCount();
console.log(`✅ 导入完成！数据库中共 ${count} 条词汇。`);
