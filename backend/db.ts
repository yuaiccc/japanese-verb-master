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
    user_id INTEGER NOT NULL DEFAULT 1,
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
    user_id INTEGER NOT NULL DEFAULT 1,
    word TEXT NOT NULL,
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
    updated_at TEXT NOT NULL,
    UNIQUE(user_id, word)
  )
`);

// 逐次复习日志：每次评分写一行，保留调度前后状态。
// 用途：每日复习量统计 / 复习曲线分析 / 未来拟合 FSRS 参数的训练数据。
db.exec(`
  CREATE TABLE IF NOT EXISTS review_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL DEFAULT 1,
    card_id INTEGER NOT NULL,
    grade TEXT NOT NULL,
    was_new INTEGER NOT NULL DEFAULT 0,
    ease_before REAL NOT NULL DEFAULT 0,
    ease_after REAL NOT NULL DEFAULT 0,
    interval_before INTEGER NOT NULL DEFAULT 0,
    interval_after INTEGER NOT NULL DEFAULT 0,
    reviewed_at TEXT NOT NULL
  )
`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_review_logs_user_time ON review_logs(user_id, reviewed_at)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_review_logs_card ON review_logs(card_id)`);

// Agent Memory（区别于上面的学习记忆/SRS）：记"用户是谁、要什么、长期在做什么"。
// 借鉴 Hermes 的 USER.md（结构化版）+ mem0 的事实抽取/冲突消解思路。
// type: goal 目标 / preference 偏好 / fact 关于用户的事实 / task 长期任务。
// mkey 是归一化的记忆键，(user_id, type, mkey) 唯一 → 同一条信息更新而非堆积。
db.exec(`
  CREATE TABLE IF NOT EXISTS agent_memory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL DEFAULT 1,
    type TEXT NOT NULL,
    mkey TEXT NOT NULL,
    value TEXT NOT NULL,
    salience REAL NOT NULL DEFAULT 1.0,
    source_run_id TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_used_at TEXT NOT NULL DEFAULT '',
    UNIQUE(user_id, type, mkey)
  )
`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_agent_memory_user ON agent_memory(user_id, type)`);

db.exec(`
  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS agent_runs (
    run_id TEXT PRIMARY KEY,
    title TEXT NOT NULL DEFAULT '',
    question TEXT NOT NULL DEFAULT '',
    intent_type TEXT NOT NULL DEFAULT 'lookup',
    provider TEXT NOT NULL DEFAULT '',
    model TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'running',
    summary TEXT NOT NULL DEFAULT '',
    error TEXT NOT NULL DEFAULT '',
    metadata TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS subagent_tasks (
    task_id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL DEFAULT '',
    subagent_id TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending',
    sandbox TEXT NOT NULL DEFAULT '{}',
    result TEXT NOT NULL DEFAULT '',
    error TEXT NOT NULL DEFAULT '',
    events TEXT NOT NULL DEFAULT '[]',
    cancel_requested INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    started_at TEXT,
    completed_at TEXT,
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
  CREATE INDEX IF NOT EXISTS idx_agent_runs_updated_at ON agent_runs(updated_at DESC);
  CREATE INDEX IF NOT EXISTS idx_agent_runs_status ON agent_runs(status);
  CREATE INDEX IF NOT EXISTS idx_subagent_tasks_run_id ON subagent_tasks(run_id, updated_at DESC);
  CREATE INDEX IF NOT EXISTS idx_subagent_tasks_status ON subagent_tasks(status);
`);

// 多用户隔离迁移：给存量库的 practice_records / memory_cards 补 user_id。
// 在 node 进程内同步执行（不经 shell），幂等——已迁移则跳过。历史数据归默认用户 1。
function columnExists(table: string, column: string): boolean {
  return db.prepare(`PRAGMA table_info(${table})`).all().some((col: any) => col.name === column);
}

(function migrateUserIsolation() {
  // practice_records：无内容唯一约束，直接加列
  if (!columnExists('practice_records', 'user_id')) {
    db.exec(`ALTER TABLE practice_records ADD COLUMN user_id INTEGER NOT NULL DEFAULT 1`);
  }
  // memory_cards：原 UNIQUE(word) 需改为 UNIQUE(user_id, word)，SQLite 不能改约束 → 重建表
  if (!columnExists('memory_cards', 'user_id')) {
    db.exec(`
      CREATE TABLE memory_cards_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL DEFAULT 1,
        word TEXT NOT NULL,
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
        updated_at TEXT NOT NULL,
        UNIQUE(user_id, word)
      );
      INSERT INTO memory_cards_new
        (id, user_id, word, reading, meaning, word_type, verb_type, sample, source, ease, interval_days, review_count, lapses, due_at, created_at, updated_at)
        SELECT id, 1, word, reading, meaning, word_type, verb_type, sample, source, ease, interval_days, review_count, lapses, due_at, created_at, updated_at
        FROM memory_cards;
      DROP TABLE memory_cards;
      ALTER TABLE memory_cards_new RENAME TO memory_cards;
    `);
  }
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_practice_user ON practice_records(user_id);
    CREATE INDEX IF NOT EXISTS idx_memory_user ON memory_cards(user_id);
    CREATE INDEX IF NOT EXISTS idx_memory_due_at ON memory_cards(due_at);
    CREATE INDEX IF NOT EXISTS idx_memory_word_type ON memory_cards(word_type);
  `);
})();

// 查询函数：多字段 LIKE 模糊匹配
const searchStmt = db.prepare(`
  SELECT kanji, kana, romaji, meaning, word_type AS wordType, jlpt, is_common AS isCommon
  FROM words
  WHERE kanji LIKE ? ESCAPE '\\' OR kana LIKE ? ESCAPE '\\' OR romaji LIKE ? ESCAPE '\\' OR meaning LIKE ? ESCAPE '\\'
  LIMIT ?
`);

export function searchWords(query: string, limit: number = 8): any[] {
  const escaped = String(query).replace(/[%_]/g, m => '\\' + m);
  const pattern = `%${escaped}%`;
  return searchStmt.all(pattern, pattern, pattern, pattern, limit);
}

// 精确查找（用于 conjugate 端点查 meaning/reading）
const findExactStmt = db.prepare(`
  SELECT kanji, kana, romaji, meaning, word_type AS wordType, jlpt, is_common AS isCommon
  FROM words
  WHERE kanji = ? OR kana = ?
  LIMIT 1
`);

export function findWord(keyword: string): any {
  return findExactStmt.get(keyword, keyword) || null;
}

// 插入函数
const insertStmt = db.prepare(`
  INSERT OR IGNORE INTO words (kanji, kana, romaji, meaning, word_type, jlpt, is_common)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

export function insertWord(word: any): any {
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
const insertMany = db.transaction((words: any[]) => {
  for (const w of words) {
    insertWord(w);
  }
});

export function bulkInsert(words: any[]): void {
  insertMany(words);
}

// 获取词条数量
export function getWordCount(): number {
  return (db.prepare('SELECT COUNT(*) AS count FROM words').get() as any).count;
}

const insertPracticeStmt = db.prepare(`
  INSERT INTO practice_records (
    user_id,
    verb,
    form_key,
    scene_id,
    scene_name,
    user_answer,
    correct_answer,
    is_correct,
    duration_ms,
    answered_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

export function insertPracticeRecord(record: any, userId: number = 1): any {
  return insertPracticeStmt.run(
    Number(userId) || 1,
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
  WHERE user_id = ?
  ORDER BY datetime(answered_at) DESC, id DESC
  LIMIT ?
`);

export function listRecentPracticeRecords(limit: number = 1000, userId: number = 1): any[] {
  return recentPracticeStmt.all(Number(userId) || 1, limit);
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
  WHERE user_id = ?
  ORDER BY datetime(due_at) ASC, datetime(updated_at) DESC
  LIMIT ?
`);

export function listMemoryCards(limit: number = 500, userId: number = 1): any[] {
  return listMemoryStmt.all(Number(userId) || 1, limit);
}

const findMemoryByWordStmt = db.prepare(`
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
  WHERE user_id = ? AND word = ?
  LIMIT 1
`);

export function getMemoryCardByWord(word: string, userId: number = 1): any {
  if (!word) return null;
  return findMemoryByWordStmt.get(Number(userId) || 1, word) || null;
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
  autoAddSimilar: false,
  exampleDifficulty: 'auto'
};

const getSettingStmt = db.prepare('SELECT value FROM app_settings WHERE key = ?');
const upsertSettingStmt = db.prepare(`
  INSERT INTO app_settings (key, value, updated_at)
  VALUES (?, ?, ?)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
`);

export function getMemorySettings(): any {
  const row = getSettingStmt.get('memory_settings') as any;
  if (!row) return { ...defaultMemorySettings };
  try {
    return { ...defaultMemorySettings, ...JSON.parse(row.value) };
  } catch (e) {
    return { ...defaultMemorySettings };
  }
}

export function saveMemorySettings(settings: any = {}): any {
  const rawDifficulty = String(settings.exampleDifficulty || defaultMemorySettings.exampleDifficulty).trim();
  const normalizedDifficulty = rawDifficulty.toLowerCase() === 'auto' ? 'auto' : rawDifficulty.toUpperCase();
  const next = {
    ...defaultMemorySettings,
    ...settings,
    desiredRetention: Math.min(0.98, Math.max(0.7, Number(settings.desiredRetention) || defaultMemorySettings.desiredRetention)),
    newCardsPerDay: Math.min(100, Math.max(1, Number(settings.newCardsPerDay) || defaultMemorySettings.newCardsPerDay)),
    reviewLimitPerDay: Math.min(300, Math.max(5, Number(settings.reviewLimitPerDay) || defaultMemorySettings.reviewLimitPerDay)),
    lapseMinutes: Math.min(1440, Math.max(5, Number(settings.lapseMinutes) || defaultMemorySettings.lapseMinutes)),
    hardMultiplier: Math.min(2.5, Math.max(1, Number(settings.hardMultiplier) || defaultMemorySettings.hardMultiplier)),
    maxIntervalDays: Math.min(3650, Math.max(7, Number(settings.maxIntervalDays) || defaultMemorySettings.maxIntervalDays)),
    autoAddSimilar: !!settings.autoAddSimilar,
    exampleDifficulty: ['auto', 'N5', 'N4', 'N3', 'N2', 'N1'].includes(normalizedDifficulty)
      ? normalizedDifficulty
      : defaultMemorySettings.exampleDifficulty
  };
  upsertSettingStmt.run('memory_settings', JSON.stringify(next), new Date().toISOString());
  return next;
}

const defaultLlmSettings = {
  provider: 'deepseek',
  baseUrl: 'https://api.deepseek.com',
  model: 'deepseek-v4-flash',
  apiKey: '',
  apiKeySet: false,
  updatedAt: ''
};

export function getLlmSettings({ includeSecret = false }: { includeSecret?: boolean } = {}): any {
  const row = getSettingStmt.get('llm_settings') as any;
  let parsed: any = {};
  if (row) {
    try {
      parsed = JSON.parse(row.value);
    } catch (e) {
      parsed = {};
    }
  }
  const settings = {
    ...defaultLlmSettings,
    ...parsed,
    provider: String(parsed.provider || defaultLlmSettings.provider).trim() || defaultLlmSettings.provider,
    baseUrl: String(parsed.baseUrl || defaultLlmSettings.baseUrl).trim(),
    model: String(parsed.model || defaultLlmSettings.model).trim(),
    apiKey: String(parsed.apiKey || '').trim()
  };
  // 部署场景兜底：db 中无 apiKey 时回退到环境变量（Render/容器重启不丢配置）。
  // 优先按 provider 查具体变量（DEEPSEEK_API_KEY / OPENAI_API_KEY 等），再退到通用 LLM_API_KEY。
  if (!settings.apiKey) {
    const providerKey = process.env[`${settings.provider.toUpperCase()}_API_KEY`];
    settings.apiKey = (providerKey || process.env.LLM_API_KEY || '').trim();
  }
  if (!parsed.baseUrl && process.env.LLM_BASE_URL) {
    settings.baseUrl = String(process.env.LLM_BASE_URL).trim();
  }
  if (!parsed.model && process.env.LLM_MODEL) {
    settings.model = String(process.env.LLM_MODEL).trim();
  }
  settings.apiKeySet = !!settings.apiKey;
  if (!includeSecret) {
    delete settings.apiKey;
  }
  return settings;
}

export function saveLlmSettings(settings: any = {}): any {
  const current = getLlmSettings({ includeSecret: true });
  const provider = String(settings.provider || current.provider || defaultLlmSettings.provider).trim();
  const providerChanged = provider !== current.provider;
  const hasNewKey = settings.apiKey !== undefined && settings.apiKey !== '';
  const next = {
    provider,
    baseUrl: String(settings.baseUrl || current.baseUrl || defaultLlmSettings.baseUrl).trim(),
    model: String(settings.model || current.model || defaultLlmSettings.model).trim(),
    // 切换 provider 且未提供新 key 时清空旧 key，避免把上一个 provider 的密钥误用到新 provider。
    apiKey: hasNewKey
      ? String(settings.apiKey).trim()
      : (providerChanged ? '' : current.apiKey),
    updatedAt: new Date().toISOString()
  };
  upsertSettingStmt.run('llm_settings', JSON.stringify(next), next.updatedAt);
  return getLlmSettings();
}

const upsertMemoryStmt = db.prepare(`
  INSERT INTO memory_cards (
    user_id,
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
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(user_id, word) DO UPDATE SET
    reading = excluded.reading,
    meaning = excluded.meaning,
    word_type = excluded.word_type,
    verb_type = excluded.verb_type,
    sample = CASE WHEN excluded.sample != '' THEN excluded.sample ELSE memory_cards.sample END,
    source = excluded.source,
    updated_at = excluded.updated_at
`);

export function upsertMemoryCard(card: any, userId: number = 1): any {
  const now = new Date().toISOString();
  return upsertMemoryStmt.run(
    Number(userId) || 1,
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
  WHERE id = ? AND user_id = ?
`);

const deleteMemoryStmt = db.prepare(`
  DELETE FROM memory_cards
  WHERE id = ? AND user_id = ?
`);

export function deleteMemoryCard(id: number, userId: number = 1): any {
  return deleteMemoryStmt.run(Number(id), Number(userId) || 1);
}

const getMemoryByIdStmt = db.prepare(`
  SELECT id, ease, interval_days AS intervalDays, review_count AS reviewCount
  FROM memory_cards
  WHERE id = ? AND user_id = ?
  LIMIT 1
`);

const insertReviewLogStmt = db.prepare(`
  INSERT INTO review_logs (
    user_id, card_id, grade, was_new,
    ease_before, ease_after, interval_before, interval_after, reviewed_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

interface ScheduleReviewResult {
  ease: number;
  intervalDays: number;
  lapseDelta: number;
  dueAt: Date;
}

/**
 * 纯调度函数（无 db 副作用，便于单测）。算法是 **SM-2 衍生**（ease factor + 区间倍增），
 * 不是 FSRS：没有 FSRS 的 stability / difficulty 双状态变量。命名里的 `desiredRetention`
 * 在这里仅作为区间缩放系数（retention 越高、区间增长越慢），并非 FSRS 的目标保持率拟合。
 * grade: 'forgot' 遗忘（回炉）/ 'hard' 偏难（小步增长）/ 'good' 正常（ease 增长）。
 * 返回调度后的 { ease, intervalDays, lapseDelta, dueAt }（dueAt 为 Date）。
 */
export function scheduleReview(card: any = {}, grade: string = 'good', settings: any = {}, now: Date = new Date()): ScheduleReviewResult {
  let ease = Number(card.ease) || 2.2;
  let intervalDays = Number(card.intervalDays ?? card.interval_days) || 0;
  let lapseDelta = 0;
  let dueAt: Date;

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
  return { ease, intervalDays, lapseDelta, dueAt };
}

// 每次评分写入 review_logs，为将来真正拟合 FSRS 参数预留训练数据。
export function reviewMemoryCard(id: number, grade: string, settings: any = getMemorySettings(), userId: number = 1): any {
  const card = getMemoryByIdStmt.get(Number(id), Number(userId) || 1) as any;
  if (!card) return null;

  const now = new Date();
  const easeBefore = Number(card.ease) || 2.2;
  const intervalBefore = Number(card.intervalDays) || 0;
  const wasNew = (Number(card.reviewCount) || 0) === 0 ? 1 : 0;
  const { ease, intervalDays, lapseDelta, dueAt } = scheduleReview(card, grade, settings, now);

  const tx = db.transaction(() => {
    reviewMemoryStmt.run(ease, intervalDays, lapseDelta, dueAt.toISOString(), now.toISOString(), id, Number(userId) || 1);
    insertReviewLogStmt.run(
      Number(userId) || 1, Number(id), grade, wasNew,
      easeBefore, ease, intervalBefore, intervalDays, now.toISOString()
    );
  });
  tx();
  return listMemoryCards(500, Number(userId) || 1).find(item => item.id === Number(id));
}

// 当日起点（服务器本地时区零点），用于每日复习/新卡限流统计。
function startOfTodayISO(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

const countReviewsTodayStmt = db.prepare(
  'SELECT COUNT(*) AS n FROM review_logs WHERE user_id = ? AND reviewed_at >= ?'
);
const countNewTodayStmt = db.prepare(
  'SELECT COUNT(DISTINCT card_id) AS n FROM review_logs WHERE user_id = ? AND reviewed_at >= ? AND was_new = 1'
);

export function getDailyReviewStats(userId: number = 1): { reviewsToday: number; newCardsToday: number } {
  const since = startOfTodayISO();
  const uid = Number(userId) || 1;
  return {
    reviewsToday: (countReviewsTodayStmt.get(uid, since) as any).n,
    newCardsToday: (countNewTodayStmt.get(uid, since) as any).n
  };
}

export function getDailyQuota(userId: number = 1, settings: any = getMemorySettings()): any {
  const { reviewsToday, newCardsToday } = getDailyReviewStats(userId);
  const reviewLimit = Number(settings.reviewLimitPerDay) || 60;
  const newLimit = Number(settings.newCardsPerDay) || 12;
  return {
    reviewsToday,
    reviewLimit,
    reviewsRemaining: Math.max(0, reviewLimit - reviewsToday),
    newCardsToday,
    newLimit,
    newRemaining: Math.max(0, newLimit - newCardsToday)
  };
}

// 纯队列构建（无 db，便于单测）：到期卡按 due 升序后，新卡（review_count===0）受当日新卡
// 上限约束，整体不超过当日复习上限；new 卡配额用尽时仍优先放行复习卡。
export function buildReviewQueue(dueCards: any[] = [], quota: any = {}, nowMs: number = Date.now()): any[] {
  const due = dueCards
    .filter(card => new Date(card.dueAt ?? card.due_at).getTime() <= nowMs)
    .sort((a, b) => new Date(a.dueAt ?? a.due_at).getTime() - new Date(b.dueAt ?? b.due_at).getTime());

  const reviewsRemaining = Math.max(0, Number(quota.reviewsRemaining) || 0);
  let newAllowance = Math.max(0, Number(quota.newRemaining) || 0);
  const cards = [];
  for (const card of due) {
    if (cards.length >= reviewsRemaining) break;
    const isNew = (Number(card.reviewCount ?? card.review_count) || 0) === 0;
    if (isNew) {
      if (newAllowance <= 0) continue;
      newAllowance -= 1;
    }
    cards.push(card);
  }
  return cards;
}

// 限流后的当日复习队列 + 配额。
export function getReviewQueue(userId: number = 1, settings: any = getMemorySettings()): { cards: any[]; quota: any } {
  const quota = getDailyQuota(userId, settings);
  const cards = buildReviewQueue(listMemoryCards(500, userId), quota);
  return { cards, quota };
}

// ===== Agent Memory =====

export const AGENT_MEMORY_TYPES = ['goal', 'preference', 'fact', 'task'];

/**
 * 纯排序（无 db，便于单测）：salience × 时间衰减。
 * 借鉴 mem0 的 recency×salience 检索：近期更新/常用的记忆排前，旧的自然下沉。
 * 半衰期默认 30 天。返回按分数降序的 top-k。
 */
export function rankAgentMemories(memories: any[] = [], { nowMs = Date.now(), limit = 8, halfLifeDays = 30 }: { nowMs?: number; limit?: number; halfLifeDays?: number } = {}): any[] {
  const halfLifeMs = halfLifeDays * 24 * 60 * 60 * 1000;
  return memories
    .map((m) => {
      const ref = new Date(m.updatedAt || m.updated_at || m.createdAt || m.created_at || 0).getTime();
      const ageMs = Math.max(0, nowMs - (Number.isFinite(ref) ? ref : 0));
      const recency = Math.pow(0.5, ageMs / halfLifeMs); // 1 → 0
      const score = (Number(m.salience) || 1) * recency;
      return { ...m, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(0, limit));
}

/**
 * 纯冲突消解（无 db）：把抽取到的候选并入已有记忆。
 * 同 (type, mkey) 视为同一条 → 更新 value、salience 提分（mem0 的 conflict resolution）。
 * 新键则新增。返回 { upserts:[...], skipped:[...] }，由调用方落库。
 */
export function resolveAgentMemoryConflicts(existing: any[] = [], candidates: any[] = [], { bump = 0.5 }: { bump?: number } = {}): { upserts: any[]; skipped: any[] } {
  const index = new Map(existing.map((m) => [`${m.type}::${m.mkey}`, m]));
  const upserts = [];
  const skipped = [];
  for (const cand of candidates) {
    const type = String(cand.type || '').trim();
    const mkey = String(cand.mkey || '').trim().toLowerCase();
    const value = String(cand.value || '').trim();
    if (!AGENT_MEMORY_TYPES.includes(type) || !mkey || !value) {
      skipped.push(cand);
      continue;
    }
    const prev = index.get(`${type}::${mkey}`);
    if (prev && String(prev.value).trim() === value) {
      // 内容完全一致：只提 salience，不算更新
      upserts.push({ type, mkey, value, salience: (Number(prev.salience) || 1) + bump, unchanged: true });
    } else if (prev) {
      upserts.push({ type, mkey, value, salience: (Number(prev.salience) || 1) + bump, unchanged: false });
    } else {
      upserts.push({ type, mkey, value, salience: 1, unchanged: false });
    }
  }
  return { upserts, skipped };
}

const listAgentMemoryStmt = db.prepare(`
  SELECT id, user_id AS userId, type, mkey, value, salience,
         source_run_id AS sourceRunId,
         created_at AS createdAt, updated_at AS updatedAt, last_used_at AS lastUsedAt
  FROM agent_memory
  WHERE user_id = ?
  ORDER BY datetime(updated_at) DESC
`);

export function listAgentMemory(userId: number = 1): any[] {
  return listAgentMemoryStmt.all(Number(userId) || 1);
}

const upsertAgentMemoryStmt = db.prepare(`
  INSERT INTO agent_memory (user_id, type, mkey, value, salience, source_run_id, created_at, updated_at, last_used_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, '')
  ON CONFLICT(user_id, type, mkey) DO UPDATE SET
    value = excluded.value,
    salience = excluded.salience,
    source_run_id = excluded.source_run_id,
    updated_at = excluded.updated_at
`);

// 把抽取候选并入持久库（内部先做纯冲突消解，再落库）。返回写入条数。
export function writeAgentMemory(candidates: any[] = [], userId: number = 1, sourceRunId: string = ''): number {
  const uid = Number(userId) || 1;
  const { upserts } = resolveAgentMemoryConflicts(listAgentMemory(uid), candidates);
  const now = new Date().toISOString();
  const tx = db.transaction((rows: any[]) => {
    for (const row of rows) {
      upsertAgentMemoryStmt.run(uid, row.type, row.mkey, row.value, row.salience, sourceRunId, now, now);
    }
  });
  tx(upserts);
  return upserts.length;
}

const touchAgentMemoryStmt = db.prepare('UPDATE agent_memory SET last_used_at = ? WHERE id = ? AND user_id = ?');

// 检索注入用 top-k：排序后顺手标记 last_used_at（便于将来做使用频率衰减）。
export function retrieveAgentMemory(userId: number = 1, { limit = 8 }: { limit?: number } = {}): any[] {
  const ranked = rankAgentMemories(listAgentMemory(userId), { limit });
  const now = new Date().toISOString();
  const uid = Number(userId) || 1;
  const tx = db.transaction((rows: any[]) => {
    for (const r of rows) touchAgentMemoryStmt.run(now, r.id, uid);
  });
  tx(ranked);
  return ranked;
}

const deleteAgentMemoryStmt = db.prepare('DELETE FROM agent_memory WHERE id = ? AND user_id = ?');

export function deleteAgentMemory(id: number, userId: number = 1): any {
  return deleteAgentMemoryStmt.run(Number(id), Number(userId) || 1);
}

export function findSimilarWords({ word, kana = '', wordType = '', meaning = '', limit = 8 }: { word: string; kana?: string; wordType?: string; meaning?: string; limit?: number }): any[] {
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
    .map((candidate: any) => {
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
    .filter((item: any) => item.score > 0)
    .sort((a: any, b: any) => b.score - a.score)
    .slice(0, limit);
}

const createAgentRunStmt = db.prepare(`
  INSERT INTO agent_runs (
    run_id,
    title,
    question,
    intent_type,
    provider,
    model,
    status,
    summary,
    error,
    metadata,
    created_at,
    updated_at,
    completed_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(run_id) DO UPDATE SET
    title = excluded.title,
    question = excluded.question,
    intent_type = excluded.intent_type,
    provider = excluded.provider,
    model = excluded.model,
    status = excluded.status,
    summary = excluded.summary,
    error = excluded.error,
    metadata = excluded.metadata,
    updated_at = excluded.updated_at,
    completed_at = excluded.completed_at
`);

const getAgentRunStmt = db.prepare(`
  SELECT
    run_id AS runId,
    title,
    question,
    intent_type AS intentType,
    provider,
    model,
    status,
    summary,
    error,
    metadata,
    created_at AS createdAt,
    updated_at AS updatedAt,
    completed_at AS completedAt
  FROM agent_runs
  WHERE run_id = ?
  LIMIT 1
`);

const listAgentRunsStmt = db.prepare(`
  SELECT
    run_id AS runId,
    title,
    question,
    intent_type AS intentType,
    provider,
    model,
    status,
    summary,
    error,
    metadata,
    created_at AS createdAt,
    updated_at AS updatedAt,
    completed_at AS completedAt
  FROM agent_runs
  ORDER BY datetime(updated_at) DESC, rowid DESC
  LIMIT ?
`);

const upsertSubagentTaskStmt = db.prepare(`
  INSERT INTO subagent_tasks (
    task_id,
    run_id,
    subagent_id,
    title,
    status,
    sandbox,
    result,
    error,
    events,
    cancel_requested,
    created_at,
    started_at,
    completed_at,
    updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(task_id) DO UPDATE SET
    run_id = excluded.run_id,
    subagent_id = excluded.subagent_id,
    title = excluded.title,
    status = excluded.status,
    sandbox = excluded.sandbox,
    result = excluded.result,
    error = excluded.error,
    events = excluded.events,
    cancel_requested = excluded.cancel_requested,
    started_at = excluded.started_at,
    completed_at = excluded.completed_at,
    updated_at = excluded.updated_at
`);

const getSubagentTaskStmt = db.prepare(`
  SELECT
    task_id AS taskId,
    run_id AS runId,
    subagent_id AS subagentId,
    title,
    status,
    sandbox,
    result,
    error,
    events,
    cancel_requested AS cancelRequested,
    created_at AS createdAt,
    started_at AS startedAt,
    completed_at AS completedAt,
    updated_at AS updatedAt
  FROM subagent_tasks
  WHERE task_id = ?
  LIMIT 1
`);

const listSubagentTasksBaseSql = `
  SELECT
    task_id AS taskId,
    run_id AS runId,
    subagent_id AS subagentId,
    title,
    status,
    sandbox,
    result,
    error,
    events,
    cancel_requested AS cancelRequested,
    created_at AS createdAt,
    started_at AS startedAt,
    completed_at AS completedAt,
    updated_at AS updatedAt
  FROM subagent_tasks
`;

function parseJsonField(value: any, fallback: any): any {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch (error) {
    return fallback;
  }
}

function normalizeAgentRunRow(row: any): any {
  if (!row) return null;
  return {
    ...row,
    metadata: parseJsonField(row.metadata, {})
  };
}

function normalizeSubagentTaskRow(row: any): any {
  if (!row) return null;
  return {
    ...row,
    sandbox: parseJsonField(row.sandbox, {}),
    events: parseJsonField(row.events, []),
    cancelRequested: !!row.cancelRequested
  };
}

export function createAgentRun(record: any = {}): any {
  const now = new Date().toISOString();
  const completedAt = record.completedAt || (['completed', 'failed', 'cancelled', 'timed_out'].includes(record.status) ? now : null);
  createAgentRunStmt.run(
    record.runId,
    record.title || '',
    record.question || '',
    record.intentType || 'lookup',
    record.provider || '',
    record.model || '',
    record.status || 'running',
    record.summary || '',
    record.error || '',
    JSON.stringify(record.metadata || {}),
    record.createdAt || now,
    record.updatedAt || now,
    completedAt
  );
  return getAgentRun(record.runId);
}

export function updateAgentRun(runId: string, patch: any = {}): any {
  const current = getAgentRun(runId);
  if (!current) return null;
  const now = new Date().toISOString();
  const next = {
    ...current,
    ...patch,
    runId,
    metadata: patch.metadata !== undefined
      ? patch.metadata
      : current.metadata,
    updatedAt: patch.updatedAt || now
  };
  if (!next.completedAt && ['completed', 'failed', 'cancelled', 'timed_out'].includes(next.status)) {
    next.completedAt = now;
  }
  createAgentRunStmt.run(
    next.runId,
    next.title || '',
    next.question || '',
    next.intentType || 'lookup',
    next.provider || '',
    next.model || '',
    next.status || 'running',
    next.summary || '',
    next.error || '',
    JSON.stringify(next.metadata || {}),
    next.createdAt || now,
    next.updatedAt || now,
    next.completedAt || null
  );
  return getAgentRun(runId);
}

export function getAgentRun(runId: string): any {
  return normalizeAgentRunRow(getAgentRunStmt.get(runId));
}

export function listAgentRuns(limit: number = 50): any[] {
  return listAgentRunsStmt.all(Math.max(1, Math.min(200, Number(limit) || 50))).map(normalizeAgentRunRow);
}

export function listAgentRunsByThread({ threadId = '', limit = 50 }: { threadId?: string; limit?: number } = {}): any[] {
  const normalizedThreadId = String(threadId || '').trim();
  if (!normalizedThreadId) {
    return listAgentRuns(limit);
  }
  return listAgentRuns(Math.max(20, limit * 3))
    .filter(run => String(run.metadata?.threadId || '') === normalizedThreadId)
    .slice(0, Math.max(1, Math.min(200, Number(limit) || 50)));
}

export function upsertSubagentTask(task: any = {}): any {
  const now = new Date().toISOString();
  upsertSubagentTaskStmt.run(
    task.taskId,
    task.runId || '',
    task.subagentId || '',
    task.title || '',
    task.status || 'pending',
    JSON.stringify(task.sandbox || {}),
    task.result ? JSON.stringify(task.result) : '',
    task.error || '',
    JSON.stringify(task.events || []),
    task.cancelRequested ? 1 : 0,
    task.createdAt || now,
    task.startedAt || null,
    task.completedAt || null,
    task.updatedAt || now
  );
  return getSubagentTask(task.taskId);
}

export function getSubagentTask(taskId: string): any {
  return normalizeSubagentTaskRow(getSubagentTaskStmt.get(taskId));
}

export function listSubagentTasks({ runId = '', status = '', limit = 0 }: { runId?: string; status?: string; limit?: number } = {}): any[] {
  const clauses = [];
  const params = [];
  if (runId) {
    clauses.push('run_id = ?');
    params.push(runId);
  }
  if (status) {
    clauses.push('status = ?');
    params.push(status);
  }
  const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
  const sql = `${listSubagentTasksBaseSql}${where} ORDER BY datetime(updated_at) DESC, rowid DESC${limit > 0 ? ' LIMIT ?' : ''}`;
  if (limit > 0) {
    params.push(Math.max(1, Math.min(500, Number(limit) || 50)));
  }
  return db.prepare(sql).all(...params).map(normalizeSubagentTaskRow);
}

export default db;
