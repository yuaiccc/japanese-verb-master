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

db.exec(`
  CREATE TABLE IF NOT EXISTS practice_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    verb TEXT NOT NULL,
    form_key TEXT NOT NULL,
    scene_id TEXT NOT NULL DEFAULT 'all',
    scene_name TEXT NOT NULL DEFAULT '',
    user_answer TEXT NOT NULL DEFAULT '',
    correct_answer TEXT NOT NULL DEFAULT '',
    is_correct INTEGER NOT NULL DEFAULT 0,
    duration_ms INTEGER NOT NULL DEFAULT 0,
    answered_at TEXT NOT NULL
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS memory_cards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    word TEXT NOT NULL UNIQUE,
    reading TEXT NOT NULL DEFAULT '',
    meaning TEXT NOT NULL DEFAULT '',
    word_type TEXT NOT NULL DEFAULT 'other',
    verb_type TEXT NOT NULL DEFAULT '',
    sample TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT 'lookup',
    ease REAL NOT NULL DEFAULT 2.2,
    interval_days INTEGER NOT NULL DEFAULT 0,
    review_count INTEGER NOT NULL DEFAULT 0,
    lapses INTEGER NOT NULL DEFAULT 0,
    due_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )
`);

// 创建索引
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_words_kanji ON words(kanji);
  CREATE INDEX IF NOT EXISTS idx_words_kana ON words(kana);
  CREATE INDEX IF NOT EXISTS idx_words_romaji ON words(romaji);
  CREATE INDEX IF NOT EXISTS idx_words_meaning ON words(meaning);
  CREATE INDEX IF NOT EXISTS idx_words_type ON words(word_type);
  CREATE INDEX IF NOT EXISTS idx_practice_answered_at ON practice_records(answered_at DESC);
  CREATE INDEX IF NOT EXISTS idx_practice_scene ON practice_records(scene_id);
  CREATE INDEX IF NOT EXISTS idx_practice_form ON practice_records(form_key);
  CREATE INDEX IF NOT EXISTS idx_practice_correct ON practice_records(is_correct);
  CREATE INDEX IF NOT EXISTS idx_memory_due_at ON memory_cards(due_at);
  CREATE INDEX IF NOT EXISTS idx_memory_word_type ON memory_cards(word_type);
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

const insertPracticeStmt = db.prepare(`
  INSERT INTO practice_records (
    verb,
    form_key,
    scene_id,
    scene_name,
    user_answer,
    correct_answer,
    is_correct,
    duration_ms,
    answered_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

export function insertPracticeRecord(record) {
  return insertPracticeStmt.run(
    record.verb,
    record.formKey,
    record.sceneId || 'all',
    record.sceneName || '',
    record.userAnswer || '',
    record.correctAnswer || '',
    record.isCorrect ? 1 : 0,
    Math.max(0, Number(record.durationMs) || 0),
    record.answeredAt || new Date().toISOString()
  );
}

const recentPracticeStmt = db.prepare(`
  SELECT
    verb,
    form_key AS formKey,
    scene_id AS sceneId,
    scene_name AS sceneName,
    user_answer AS userAnswer,
    correct_answer AS correctAnswer,
    is_correct AS isCorrect,
    duration_ms AS durationMs,
    answered_at AS answeredAt
  FROM practice_records
  ORDER BY datetime(answered_at) DESC, id DESC
  LIMIT ?
`);

export function listRecentPracticeRecords(limit = 1000) {
  return recentPracticeStmt.all(limit);
}

const listMemoryStmt = db.prepare(`
  SELECT
    id,
    word,
    reading,
    meaning,
    word_type AS wordType,
    verb_type AS verbType,
    sample,
    source,
    ease,
    interval_days AS intervalDays,
    review_count AS reviewCount,
    lapses,
    due_at AS dueAt,
    created_at AS createdAt,
    updated_at AS updatedAt
  FROM memory_cards
  ORDER BY datetime(due_at) ASC, datetime(updated_at) DESC
  LIMIT ?
`);

export function listMemoryCards(limit = 500) {
  return listMemoryStmt.all(limit);
}

const defaultMemorySettings = {
  desiredRetention: 0.9,
  newCardsPerDay: 12,
  reviewLimitPerDay: 60,
  lapseMinutes: 20,
  hardMultiplier: 1.2,
  goodInitialDays: 1,
  easeBonus: 0.08,
  easePenalty: 0.1,
  lapsePenalty: 0.25,
  maxIntervalDays: 180,
  autoAddSimilar: false
};

const getSettingStmt = db.prepare('SELECT value FROM app_settings WHERE key = ?');
const upsertSettingStmt = db.prepare(`
  INSERT INTO app_settings (key, value, updated_at)
  VALUES (?, ?, ?)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
`);

export function getMemorySettings() {
  const row = getSettingStmt.get('memory_settings');
  if (!row) return { ...defaultMemorySettings };
  try {
    return { ...defaultMemorySettings, ...JSON.parse(row.value) };
  } catch (e) {
    return { ...defaultMemorySettings };
  }
}

export function saveMemorySettings(settings = {}) {
  const next = {
    ...defaultMemorySettings,
    ...settings,
    desiredRetention: Math.min(0.98, Math.max(0.7, Number(settings.desiredRetention) || defaultMemorySettings.desiredRetention)),
    newCardsPerDay: Math.min(100, Math.max(1, Number(settings.newCardsPerDay) || defaultMemorySettings.newCardsPerDay)),
    reviewLimitPerDay: Math.min(300, Math.max(5, Number(settings.reviewLimitPerDay) || defaultMemorySettings.reviewLimitPerDay)),
    lapseMinutes: Math.min(1440, Math.max(5, Number(settings.lapseMinutes) || defaultMemorySettings.lapseMinutes)),
    hardMultiplier: Math.min(2.5, Math.max(1, Number(settings.hardMultiplier) || defaultMemorySettings.hardMultiplier)),
    maxIntervalDays: Math.min(3650, Math.max(7, Number(settings.maxIntervalDays) || defaultMemorySettings.maxIntervalDays)),
    autoAddSimilar: !!settings.autoAddSimilar
  };
  upsertSettingStmt.run('memory_settings', JSON.stringify(next), new Date().toISOString());
  return next;
}

const upsertMemoryStmt = db.prepare(`
  INSERT INTO memory_cards (
    word,
    reading,
    meaning,
    word_type,
    verb_type,
    sample,
    source,
    ease,
    interval_days,
    review_count,
    lapses,
    due_at,
    created_at,
    updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(word) DO UPDATE SET
    reading = excluded.reading,
    meaning = excluded.meaning,
    word_type = excluded.word_type,
    verb_type = excluded.verb_type,
    sample = CASE WHEN excluded.sample != '' THEN excluded.sample ELSE memory_cards.sample END,
    source = excluded.source,
    updated_at = excluded.updated_at
`);

export function upsertMemoryCard(card) {
  const now = new Date().toISOString();
  return upsertMemoryStmt.run(
    card.word,
    card.reading || '',
    card.meaning || '',
    card.wordType || 'other',
    card.verbType || '',
    card.sample || '',
    card.source || 'lookup',
    Number(card.ease) || 2.2,
    Number(card.intervalDays) || 0,
    Number(card.reviewCount) || 0,
    Number(card.lapses) || 0,
    card.dueAt || now,
    card.createdAt || now,
    now
  );
}

const reviewMemoryStmt = db.prepare(`
  UPDATE memory_cards
  SET
    ease = ?,
    interval_days = ?,
    review_count = review_count + 1,
    lapses = lapses + ?,
    due_at = ?,
    updated_at = ?
  WHERE id = ?
`);

export function reviewMemoryCard(id, grade, settings = getMemorySettings()) {
  const card = listMemoryStmt.all(10000).find(item => item.id === Number(id));
  if (!card) return null;

  const now = new Date();
  let ease = Number(card.ease) || 2.2;
  let intervalDays = Number(card.intervalDays) || 0;
  let lapseDelta = 0;
  let dueAt;

  if (grade === 'forgot') {
    ease = Math.max(1.4, ease - (Number(settings.lapsePenalty) || 0.25));
    intervalDays = 0;
    lapseDelta = 1;
    dueAt = new Date(now.getTime() + (Number(settings.lapseMinutes) || 20) * 60 * 1000);
  } else if (grade === 'hard') {
    ease = Math.max(1.5, ease - (Number(settings.easePenalty) || 0.1));
    intervalDays = Math.max(1, Math.ceil(intervalDays * (Number(settings.hardMultiplier) || 1.2)));
    dueAt = new Date(now.getTime() + intervalDays * 24 * 60 * 60 * 1000);
  } else {
    const retentionScale = 0.9 / (Number(settings.desiredRetention) || 0.9);
    intervalDays = intervalDays === 0
      ? (Number(settings.goodInitialDays) || 1)
      : Math.ceil(intervalDays * ease * retentionScale);
    intervalDays = Math.min(intervalDays, Number(settings.maxIntervalDays) || 180);
    ease = Math.min(2.8, ease + (Number(settings.easeBonus) || 0.08));
    dueAt = new Date(now.getTime() + intervalDays * 24 * 60 * 60 * 1000);
  }

  reviewMemoryStmt.run(ease, intervalDays, lapseDelta, dueAt.toISOString(), now.toISOString(), id);
  return listMemoryCards(500).find(item => item.id === Number(id));
}

export function findSimilarWords({ word, kana = '', wordType = '', meaning = '', limit = 8 }) {
  const candidates = db.prepare(`
    SELECT kanji, kana, romaji, meaning, word_type AS wordType, jlpt, is_common AS isCommon
    FROM words
    WHERE kanji != ? AND kana != ?
    LIMIT 500
  `).all(word, kana || word);

  const meaningTerms = String(meaning)
    .toLowerCase()
    .split(/[,;，；、\s]+/)
    .filter(term => term.length >= 2)
    .slice(0, 8);
  const kanaPrefix = kana ? kana.slice(0, 1) : '';
  const kanjiChars = new Set(String(word).split('').filter(ch => /[\u4e00-\u9fff]/.test(ch)));

  return candidates
    .map(candidate => {
      let score = 0;
      const reasons = [];
      if (wordType && candidate.wordType === wordType) {
        score += 3;
        reasons.push('词性相同');
      }
      if (kanaPrefix && candidate.kana?.startsWith(kanaPrefix)) {
        score += 1.4;
        reasons.push('读音接近');
      }
      const sharedKanji = String(candidate.kanji).split('').filter(ch => kanjiChars.has(ch));
      if (sharedKanji.length > 0) {
        score += sharedKanji.length * 2;
        reasons.push(`共享汉字「${sharedKanji[0]}」`);
      }
      const lowerMeaning = String(candidate.meaning).toLowerCase();
      const matchedTerms = meaningTerms.filter(term => lowerMeaning.includes(term));
      if (matchedTerms.length > 0) {
        score += matchedTerms.length * 1.5;
        reasons.push('释义语义接近');
      }
      if (candidate.isCommon) {
        score += 0.6;
        reasons.push('常用词');
      }
      return { ...candidate, score, reason: reasons.slice(0, 2).join('、') || '适合作为同组扩展词' };
    })
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export default db;
