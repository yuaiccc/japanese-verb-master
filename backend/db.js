import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.join(__dirname, 'dictionary.db');
const db = new Database(dbPath);

// 性能优化
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');

// 建表
db.exec(`
  CREATE TABLE IF NOT EXISTS words (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kanji TEXT NOT NULL,
    kana TEXT NOT NULL,
    romaji TEXT NOT NULL,
    meaning TEXT NOT NULL DEFAULT '',
    word_type TEXT NOT NULL DEFAULT 'other',
    jlpt TEXT DEFAULT '',
    is_common INTEGER DEFAULT 0,
    UNIQUE(kanji, kana)
  )
`);

// 创建索引
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_words_kanji ON words(kanji);
  CREATE INDEX IF NOT EXISTS idx_words_kana ON words(kana);
  CREATE INDEX IF NOT EXISTS idx_words_romaji ON words(romaji);
  CREATE INDEX IF NOT EXISTS idx_words_meaning ON words(meaning);
  CREATE INDEX IF NOT EXISTS idx_words_type ON words(word_type);
`);

// 查询函数：多字段 LIKE 模糊匹配
const searchStmt = db.prepare(`
  SELECT kanji, kana, romaji, meaning, word_type AS wordType, jlpt, is_common AS isCommon
  FROM words
  WHERE kanji LIKE ? OR kana LIKE ? OR romaji LIKE ? OR meaning LIKE ?
  LIMIT ?
`);

export function searchWords(query, limit = 8) {
  const pattern = `%${query}%`;
  return searchStmt.all(pattern, pattern, pattern, pattern, limit);
}

// 精确查找（用于 conjugate 端点查 meaning/reading）
const findExactStmt = db.prepare(`
  SELECT kanji, kana, romaji, meaning, word_type AS wordType, jlpt, is_common AS isCommon
  FROM words
  WHERE kanji = ? OR kana = ?
  LIMIT 1
`);

export function findWord(keyword) {
  return findExactStmt.get(keyword, keyword) || null;
}

// 插入函数
const insertStmt = db.prepare(`
  INSERT OR IGNORE INTO words (kanji, kana, romaji, meaning, word_type, jlpt, is_common)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

export function insertWord(word) {
  return insertStmt.run(
    word.kanji,
    word.kana,
    word.romaji,
    word.meaning || '',
    word.wordType || word.word_type || 'other',
    word.jlpt || '',
    word.isCommon || word.is_common ? 1 : 0
  );
}

// 批量插入（事务）
const insertMany = db.transaction((words) => {
  for (const w of words) {
    insertWord(w);
  }
});

export function bulkInsert(words) {
  insertMany(words);
}

// 获取词条数量
export function getWordCount() {
  return db.prepare('SELECT COUNT(*) AS count FROM words').get().count;
}

export default db;
