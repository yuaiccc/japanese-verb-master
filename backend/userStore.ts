import db, {
  buildReviewQueue,
  deleteAgentMemory as deleteLocalAgentMemory,
  deleteMemoryCard as deleteLocalMemoryCard,
  getMemoryCardByWord as getLocalMemoryCardByWord,
  insertPracticeRecord as insertLocalPracticeRecord,
  listAgentMemory as listLocalAgentMemory,
  listMemoryCards as listLocalMemoryCards,
  listRecentPracticeRecords as listLocalPracticeRecords,
  rankAgentMemories,
  resolveAgentMemoryConflicts,
  reviewMemoryCard as reviewLocalMemoryCard,
  scheduleReview,
  upsertMemoryCard as upsertLocalMemoryCard,
  writeAgentMemory as writeLocalAgentMemory
} from './db.js';
import { ensureAuthSchema } from './auth.js';
import crypto from 'node:crypto';

const DEFAULT_USER_ID = 1;

function uid(value: any): number {
  return Number(value) || DEFAULT_USER_ID;
}

function normalizeMemoryCard(row: any): any {
  if (!row) return null;
  return {
    id: Number(row.id),
    word: row.word,
    reading: row.reading,
    meaning: row.meaning,
    wordType: row.word_type,
    verbType: row.verb_type,
    sample: row.sample,
    source: row.source,
    ease: Number(row.ease),
    intervalDays: Number(row.interval_days),
    reviewCount: Number(row.review_count),
    lapses: Number(row.lapses),
    dueAt: new Date(row.due_at).toISOString(),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString()
  };
}

function normalizePracticeRecord(row: any): any {
  return {
    verb: row.verb,
    formKey: row.form_key,
    sceneId: row.scene_id,
    sceneName: row.scene_name,
    userAnswer: row.user_answer,
    correctAnswer: row.correct_answer,
    isCorrect: !!row.is_correct,
    durationMs: Number(row.duration_ms),
    answeredAt: new Date(row.answered_at).toISOString()
  };
}

function normalizeAgentMemory(row: any): any {
  return {
    id: Number(row.id),
    userId: Number(row.user_id),
    type: row.type,
    mkey: row.mkey,
    value: row.value,
    salience: Number(row.salience),
    sourceRunId: row.source_run_id,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    lastUsedAt: row.last_used_at ? new Date(row.last_used_at).toISOString() : ''
  };
}

function parseJson(value: any, fallback: any): any {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function normalizeAgentRun(row: any): any {
  if (!row) return null;
  return {
    runId: row.run_id,
    title: row.title,
    question: row.question,
    intentType: row.intent_type,
    provider: row.provider,
    model: row.model,
    status: row.status,
    summary: row.summary,
    error: row.error,
    metadata: parseJson(row.metadata, {}),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    completedAt: row.completed_at ? new Date(row.completed_at).toISOString() : null
  };
}

function normalizeSubagentTask(row: any): any {
  if (!row) return null;
  return {
    taskId: row.task_id,
    runId: row.run_id,
    subagentId: row.subagent_id,
    title: row.title,
    status: row.status,
    sandbox: parseJson(row.sandbox, {}),
    result: parseJson(row.result, null),
    error: row.error,
    events: parseJson(row.events, []),
    cancelRequested: !!row.cancel_requested,
    createdAt: new Date(row.created_at).toISOString(),
    startedAt: row.started_at ? new Date(row.started_at).toISOString() : null,
    completedAt: row.completed_at ? new Date(row.completed_at).toISOString() : null,
    updatedAt: new Date(row.updated_at).toISOString()
  };
}

class LocalUserStore {
  provider = 'sqlite';

  async init(): Promise<void> {
    ensureAuthSchema(db);
    if (!db.prepare("PRAGMA table_info(users)").all().some((column: any) => column.name === 'is_guest')) {
      db.exec('ALTER TABLE users ADD COLUMN is_guest INTEGER NOT NULL DEFAULT 0');
    }
    if (!db.prepare("PRAGMA table_info(agent_runs)").all().some((column: any) => column.name === 'user_id')) {
      db.exec('ALTER TABLE agent_runs ADD COLUMN user_id INTEGER NOT NULL DEFAULT 1');
    }
    if (!db.prepare("PRAGMA table_info(subagent_tasks)").all().some((column: any) => column.name === 'user_id')) {
      db.exec('ALTER TABLE subagent_tasks ADD COLUMN user_id INTEGER NOT NULL DEFAULT 1');
    }
    db.exec(`
      CREATE TABLE IF NOT EXISTS payment_orders (
        out_trade_no TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL DEFAULT 1,
        sku TEXT NOT NULL,
        subject TEXT NOT NULL,
        amount TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'WAIT_BUYER_PAY',
        provider TEXT NOT NULL DEFAULT 'mock',
        payment_currency TEXT NOT NULL DEFAULT '',
        payment_chain TEXT NOT NULL DEFAULT '',
        deposit_address TEXT NOT NULL DEFAULT '',
        deposit_tag TEXT NOT NULL DEFAULT '',
        tx_id TEXT,
        provider_payload TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        paid_at TEXT
      );
      CREATE TABLE IF NOT EXISTS entitlements (
        user_id INTEGER NOT NULL DEFAULT 1,
        key TEXT NOT NULL,
        out_trade_no TEXT NOT NULL,
        unlocked_at TEXT NOT NULL,
        PRIMARY KEY (user_id, key)
      );
    `);
    const paymentColumns = [
      ['payment_currency', "TEXT NOT NULL DEFAULT ''"],
      ['payment_chain', "TEXT NOT NULL DEFAULT ''"],
      ['deposit_address', "TEXT NOT NULL DEFAULT ''"],
      ['deposit_tag', "TEXT NOT NULL DEFAULT ''"],
      ['tx_id', 'TEXT'],
      ['provider_payload', "TEXT NOT NULL DEFAULT ''"]
    ];
    for (const [column, definition] of paymentColumns) {
      if (!db.prepare('PRAGMA table_info(payment_orders)').all().some((item: any) => item.name === column)) {
        db.exec(`ALTER TABLE payment_orders ADD COLUMN ${column} ${definition}`);
      }
    }
    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_orders_tx_id
      ON payment_orders(tx_id) WHERE tx_id IS NOT NULL AND tx_id <> ''
    `);
  }

  async findUserByUsername(username: string): Promise<any> {
    return db.prepare('SELECT id, username, password_hash FROM users WHERE username = ?').get(username) || null;
  }

  async findUserById(userId: any): Promise<any> {
    return db.prepare('SELECT id, username FROM users WHERE id = ?').get(uid(userId)) || null;
  }

  async createUser(username: string, passwordHash: string): Promise<any> {
    const info = db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(username, passwordHash);
    return { id: Number(info.lastInsertRowid), username };
  }

  async createGuestUser(): Promise<any> {
    const username = `__guest__${crypto.randomUUID()}`;
    const info = db.prepare('INSERT INTO users (username, password_hash, is_guest) VALUES (?, ?, 1)')
      .run(username, '');
    return { id: Number(info.lastInsertRowid), username, isGuest: true };
  }

  async claimGuestUser(userId: any, username: string, passwordHash: string): Promise<any> {
    const info = db.prepare(`
      UPDATE users SET username = ?, password_hash = ?, is_guest = 0
      WHERE id = ? AND is_guest = 1
    `).run(username, passwordHash, uid(userId));
    if (!info.changes) return null;
    return { id: uid(userId), username };
  }

  async insertPracticeRecord(record: any, userId: any): Promise<void> {
    insertLocalPracticeRecord(record, userId);
  }

  async listPracticeRecords(limit: number, userId: any): Promise<any[]> {
    return listLocalPracticeRecords(limit, userId);
  }

  async listMemoryCards(limit: number, userId: any): Promise<any[]> {
    return listLocalMemoryCards(limit, userId);
  }

  async getMemoryCardByWord(word: string, userId: any): Promise<any> {
    return getLocalMemoryCardByWord(word, userId);
  }

  async upsertMemoryCard(card: any, userId: any): Promise<void> {
    upsertLocalMemoryCard(card, userId);
  }

  async deleteMemoryCard(id: any, userId: any): Promise<boolean> {
    return deleteLocalMemoryCard(id, userId).changes > 0;
  }

  async reviewMemoryCard(id: any, grade: string, settings: any, userId: any): Promise<any> {
    return reviewLocalMemoryCard(id, grade, settings, userId);
  }

  async getDailyReviewStats(userId: any): Promise<{ reviewsToday: number; newCardsToday: number }> {
    const since = new Date();
    since.setHours(0, 0, 0, 0);
    const reviewsToday = (db.prepare(
      'SELECT COUNT(*) AS n FROM review_logs WHERE user_id = ? AND reviewed_at >= ?'
    ).get(uid(userId), since.toISOString()) as any).n;
    const newCardsToday = (db.prepare(
      'SELECT COUNT(DISTINCT card_id) AS n FROM review_logs WHERE user_id = ? AND reviewed_at >= ? AND was_new = 1'
    ).get(uid(userId), since.toISOString()) as any).n;
    return { reviewsToday, newCardsToday };
  }

  async listAgentMemory(userId: any): Promise<any[]> {
    return listLocalAgentMemory(userId);
  }

  async retrieveAgentMemory(userId: any, options: any): Promise<any[]> {
    const ranked = rankAgentMemories(await this.listAgentMemory(userId), options);
    const now = new Date().toISOString();
    const update = db.prepare('UPDATE agent_memory SET last_used_at = ? WHERE id = ?');
    const tx = db.transaction((rows: any[]) => rows.forEach(row => update.run(now, row.id)));
    tx(ranked);
    return ranked;
  }

  async writeAgentMemory(candidates: any[], userId: any, sourceRunId: string): Promise<number> {
    return writeLocalAgentMemory(candidates, userId, sourceRunId);
  }

  async deleteAgentMemory(id: any, userId: any): Promise<boolean> {
    return deleteLocalAgentMemory(id, userId).changes > 0;
  }

  async hasEntitlement(key: string, userId: any): Promise<boolean> {
    return !!db.prepare('SELECT key FROM entitlements WHERE user_id = ? AND key = ?').get(uid(userId), key);
  }

  async createPaymentOrder(order: any): Promise<void> {
    db.prepare(`
      INSERT INTO payment_orders (
        out_trade_no, user_id, sku, subject, amount, status, provider,
        payment_currency, payment_chain, deposit_address, deposit_tag,
        tx_id, provider_payload, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      order.outTradeNo, uid(order.userId), order.sku, order.subject, order.amount,
      order.status, order.provider, order.paymentCurrency || '', order.paymentChain || '',
      order.depositAddress || '', order.depositTag || '', order.txId || null,
      JSON.stringify(order.providerPayload || {}), order.createdAt
    );
  }

  async getPaymentOrder(outTradeNo: string): Promise<any> {
    return db.prepare('SELECT * FROM payment_orders WHERE out_trade_no = ?').get(outTradeNo) || null;
  }

  async updatePaymentOrder(outTradeNo: string, updates: any): Promise<any> {
    const allowed: Record<string, string> = { status: 'status', txId: 'tx_id', providerPayload: 'provider_payload' };
    const entries = Object.entries(updates || {}).filter(([key]) => allowed[key]);
    if (!entries.length) return this.getPaymentOrder(outTradeNo);
    const values = entries.map(([key, value]) =>
      key === 'providerPayload' ? JSON.stringify(value || {}) : value
    );
    db.prepare(`
      UPDATE payment_orders SET ${entries.map(([key]) => `${allowed[key]} = ?`).join(', ')}
      WHERE out_trade_no = ?
    `).run(...values, outTradeNo);
    return this.getPaymentOrder(outTradeNo);
  }

  async settlePaymentOrder(outTradeNo: string, entitlement: string): Promise<any> {
    const row = await this.getPaymentOrder(outTradeNo);
    if (!row) return null;
    const now = new Date().toISOString();
    const tx = db.transaction(() => {
      db.prepare("UPDATE payment_orders SET status = 'TRADE_SUCCESS', paid_at = COALESCE(paid_at, ?) WHERE out_trade_no = ? AND status != 'TRADE_SUCCESS'")
        .run(now, outTradeNo);
      if (entitlement) {
        db.prepare(`
          INSERT INTO entitlements (user_id, key, out_trade_no, unlocked_at) VALUES (?, ?, ?, ?)
          ON CONFLICT(user_id, key) DO NOTHING
        `).run(row.user_id, entitlement, outTradeNo, now);
      }
    });
    tx();
    return { ...row, status: 'TRADE_SUCCESS', paid_at: now };
  }

  async upsertAgentRun(record: any, userId: any): Promise<any> {
    const now = new Date().toISOString();
    const current = await this.getAgentRun(record.runId, userId);
    const next = { ...current, ...record };
    const completedAt = next.completedAt
      || (['completed', 'failed', 'cancelled', 'timed_out'].includes(next.status) ? now : null);
    db.prepare(`
      INSERT INTO agent_runs (
        run_id, user_id, title, question, intent_type, provider, model, status,
        summary, error, metadata, created_at, updated_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(run_id) DO UPDATE SET
        title = excluded.title, question = excluded.question, intent_type = excluded.intent_type,
        provider = excluded.provider, model = excluded.model, status = excluded.status,
        summary = excluded.summary, error = excluded.error, metadata = excluded.metadata,
        updated_at = excluded.updated_at, completed_at = excluded.completed_at
      WHERE agent_runs.user_id = excluded.user_id
    `).run(
      next.runId, uid(userId), next.title || '', next.question || '', next.intentType || 'lookup',
      next.provider || '', next.model || '', next.status || 'running', next.summary || '',
      next.error || '', JSON.stringify(next.metadata || {}), next.createdAt || now,
      next.updatedAt || now, completedAt
    );
    return this.getAgentRun(next.runId, userId);
  }

  async getAgentRun(runId: string, userId: any): Promise<any> {
    return normalizeAgentRun(db.prepare(
      'SELECT * FROM agent_runs WHERE run_id = ? AND user_id = ?'
    ).get(runId, uid(userId)));
  }

  async listAgentRuns({ userId, threadId = '', limit = 50 }: { userId?: any; threadId?: string; limit?: number } = {}): Promise<any[]> {
    const rows = db.prepare(`
      SELECT * FROM agent_runs WHERE user_id = ?
      ORDER BY datetime(updated_at) DESC, rowid DESC LIMIT ?
    `).all(uid(userId), Math.max(1, Math.min(200, Number(limit) || 50)) * 3).map(normalizeAgentRun);
    return threadId
      ? rows.filter((run: any) => String(run.metadata?.threadId || '') === String(threadId)).slice(0, limit)
      : rows;
  }

  async upsertSubagentTask(task: any, userId: any): Promise<any> {
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO subagent_tasks (
        task_id, user_id, run_id, subagent_id, title, status, sandbox, result,
        error, events, cancel_requested, created_at, started_at, completed_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(task_id) DO UPDATE SET
        status = excluded.status, sandbox = excluded.sandbox, result = excluded.result,
        error = excluded.error, events = excluded.events,
        cancel_requested = excluded.cancel_requested, started_at = excluded.started_at,
        completed_at = excluded.completed_at, updated_at = excluded.updated_at
      WHERE subagent_tasks.user_id = excluded.user_id
    `).run(
      task.taskId, uid(userId), task.runId || '', task.subagentId || '', task.title || '',
      task.status || 'pending', JSON.stringify(task.sandbox || {}),
      task.result === null || task.result === undefined ? null : JSON.stringify(task.result),
      task.error || '', JSON.stringify(task.events || []), task.cancelRequested ? 1 : 0,
      task.createdAt || now, task.startedAt || null, task.completedAt || null, task.updatedAt || now
    );
    return this.getSubagentTask(task.taskId, userId);
  }

  async getSubagentTask(taskId: string, userId: any): Promise<any> {
    return normalizeSubagentTask(db.prepare(
      'SELECT * FROM subagent_tasks WHERE task_id = ? AND user_id = ?'
    ).get(taskId, uid(userId)));
  }

  async listSubagentTasks({ userId, runId = '', status = '', limit = 50 }: { userId?: any; runId?: string; status?: string; limit?: number } = {}): Promise<any[]> {
    const clauses = ['user_id = ?'];
    const params: any[] = [uid(userId)];
    if (runId) { clauses.push('run_id = ?'); params.push(runId); }
    if (status) { clauses.push('status = ?'); params.push(status); }
    params.push(Math.max(1, Math.min(500, Number(limit) || 50)));
    return db.prepare(`
      SELECT * FROM subagent_tasks WHERE ${clauses.join(' AND ')}
      ORDER BY datetime(updated_at) DESC, rowid DESC LIMIT ?
    `).all(...params).map(normalizeSubagentTask);
  }
}

class PostgresUserStore {
  provider = 'postgres';
  pool: any;

  constructor(connectionString: string, Pool: any) {
    this.pool = new Pool({
      connectionString,
      ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
      max: Math.max(1, Number(process.env.DATABASE_POOL_SIZE) || 5),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000
    });
  }

  async init(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id BIGSERIAL PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        is_guest BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS practice_records (
        id BIGSERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        verb TEXT NOT NULL,
        form_key TEXT NOT NULL,
        scene_id TEXT NOT NULL DEFAULT 'all',
        scene_name TEXT NOT NULL DEFAULT '',
        user_answer TEXT NOT NULL DEFAULT '',
        correct_answer TEXT NOT NULL DEFAULT '',
        is_correct BOOLEAN NOT NULL DEFAULT FALSE,
        duration_ms INTEGER NOT NULL DEFAULT 0,
        answered_at TIMESTAMPTZ NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_practice_user_time ON practice_records(user_id, answered_at DESC);
      CREATE TABLE IF NOT EXISTS memory_cards (
        id BIGSERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        word TEXT NOT NULL,
        reading TEXT NOT NULL DEFAULT '',
        meaning TEXT NOT NULL DEFAULT '',
        word_type TEXT NOT NULL DEFAULT 'other',
        verb_type TEXT NOT NULL DEFAULT '',
        sample TEXT NOT NULL DEFAULT '',
        source TEXT NOT NULL DEFAULT 'lookup',
        ease DOUBLE PRECISION NOT NULL DEFAULT 2.2,
        interval_days INTEGER NOT NULL DEFAULT 0,
        review_count INTEGER NOT NULL DEFAULT 0,
        lapses INTEGER NOT NULL DEFAULT 0,
        due_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL,
        UNIQUE(user_id, word)
      );
      CREATE INDEX IF NOT EXISTS idx_memory_user_due ON memory_cards(user_id, due_at);
      CREATE TABLE IF NOT EXISTS review_logs (
        id BIGSERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        card_id BIGINT NOT NULL REFERENCES memory_cards(id) ON DELETE CASCADE,
        grade TEXT NOT NULL,
        was_new BOOLEAN NOT NULL DEFAULT FALSE,
        ease_before DOUBLE PRECISION NOT NULL DEFAULT 0,
        ease_after DOUBLE PRECISION NOT NULL DEFAULT 0,
        interval_before INTEGER NOT NULL DEFAULT 0,
        interval_after INTEGER NOT NULL DEFAULT 0,
        reviewed_at TIMESTAMPTZ NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_review_user_time ON review_logs(user_id, reviewed_at);
      CREATE TABLE IF NOT EXISTS agent_memory (
        id BIGSERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        mkey TEXT NOT NULL,
        value TEXT NOT NULL,
        salience DOUBLE PRECISION NOT NULL DEFAULT 1,
        source_run_id TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL,
        last_used_at TIMESTAMPTZ,
        UNIQUE(user_id, type, mkey)
      );
      CREATE INDEX IF NOT EXISTS idx_agent_memory_user ON agent_memory(user_id, type);
      CREATE TABLE IF NOT EXISTS payment_orders (
        out_trade_no TEXT PRIMARY KEY,
        user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        sku TEXT NOT NULL,
        subject TEXT NOT NULL,
        amount TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'WAIT_BUYER_PAY',
        provider TEXT NOT NULL DEFAULT 'mock',
        payment_currency TEXT NOT NULL DEFAULT '',
        payment_chain TEXT NOT NULL DEFAULT '',
        deposit_address TEXT NOT NULL DEFAULT '',
        deposit_tag TEXT NOT NULL DEFAULT '',
        tx_id TEXT,
        provider_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL,
        paid_at TIMESTAMPTZ
      );
      ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS payment_currency TEXT NOT NULL DEFAULT '';
      ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS payment_chain TEXT NOT NULL DEFAULT '';
      ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS deposit_address TEXT NOT NULL DEFAULT '';
      ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS deposit_tag TEXT NOT NULL DEFAULT '';
      ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS tx_id TEXT;
      ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS provider_payload JSONB NOT NULL DEFAULT '{}'::jsonb;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_orders_tx_id
      ON payment_orders(tx_id) WHERE tx_id IS NOT NULL AND tx_id <> '';
      CREATE TABLE IF NOT EXISTS entitlements (
        user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        key TEXT NOT NULL,
        out_trade_no TEXT NOT NULL,
        unlocked_at TIMESTAMPTZ NOT NULL,
        PRIMARY KEY (user_id, key)
      );
      CREATE TABLE IF NOT EXISTS agent_runs (
        run_id TEXT PRIMARY KEY,
        user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title TEXT NOT NULL DEFAULT '',
        question TEXT NOT NULL DEFAULT '',
        intent_type TEXT NOT NULL DEFAULT 'lookup',
        provider TEXT NOT NULL DEFAULT '',
        model TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'running',
        summary TEXT NOT NULL DEFAULT '',
        error TEXT NOT NULL DEFAULT '',
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL,
        completed_at TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS idx_agent_runs_user_updated ON agent_runs(user_id, updated_at DESC);
      CREATE TABLE IF NOT EXISTS subagent_tasks (
        task_id TEXT PRIMARY KEY,
        user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        run_id TEXT NOT NULL DEFAULT '',
        subagent_id TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'pending',
        sandbox JSONB NOT NULL DEFAULT '{}'::jsonb,
        result JSONB,
        error TEXT NOT NULL DEFAULT '',
        events JSONB NOT NULL DEFAULT '[]'::jsonb,
        cancel_requested BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL,
        started_at TIMESTAMPTZ,
        completed_at TIMESTAMPTZ,
        updated_at TIMESTAMPTZ NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_subagent_tasks_user_run ON subagent_tasks(user_id, run_id, updated_at DESC);
    `);
    await this.pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS is_guest BOOLEAN NOT NULL DEFAULT FALSE');
    await this.pool.query(`
      INSERT INTO users (id, username, password_hash)
      VALUES (1, '__default__', '')
      ON CONFLICT (id) DO NOTHING
    `);
    await this.pool.query(`
      SELECT setval(
        pg_get_serial_sequence('users', 'id'),
        GREATEST((SELECT COALESCE(MAX(id), 1) FROM users), 1),
        true
      )
    `);
  }

  async findUserByUsername(username: string): Promise<any> {
    const { rows } = await this.pool.query(
      'SELECT id, username, password_hash FROM users WHERE username = $1',
      [username]
    );
    return rows[0] ? { ...rows[0], id: Number(rows[0].id) } : null;
  }

  async findUserById(userId: any): Promise<any> {
    const { rows } = await this.pool.query('SELECT id, username FROM users WHERE id = $1', [uid(userId)]);
    return rows[0] ? { ...rows[0], id: Number(rows[0].id) } : null;
  }

  async createUser(username: string, passwordHash: string): Promise<any> {
    const { rows } = await this.pool.query(
      'INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id, username',
      [username, passwordHash]
    );
    return { ...rows[0], id: Number(rows[0].id) };
  }

  async createGuestUser(): Promise<any> {
    const username = `__guest__${crypto.randomUUID()}`;
    const { rows } = await this.pool.query(
      'INSERT INTO users (username, password_hash, is_guest) VALUES ($1, $2, TRUE) RETURNING id, username',
      [username, '']
    );
    return { id: Number(rows[0].id), username: rows[0].username, isGuest: true };
  }

  async claimGuestUser(userId: any, username: string, passwordHash: string): Promise<any> {
    const { rows } = await this.pool.query(`
      UPDATE users SET username = $1, password_hash = $2, is_guest = FALSE
      WHERE id = $3 AND is_guest = TRUE
      RETURNING id, username
    `, [username, passwordHash, uid(userId)]);
    return rows[0] ? { id: Number(rows[0].id), username: rows[0].username } : null;
  }

  async insertPracticeRecord(record: any, userId: any): Promise<void> {
    await this.pool.query(`
      INSERT INTO practice_records (
        user_id, verb, form_key, scene_id, scene_name, user_answer,
        correct_answer, is_correct, duration_ms, answered_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    `, [
      uid(userId), record.verb, record.formKey, record.sceneId || 'all',
      record.sceneName || '', record.userAnswer || '', record.correctAnswer || '',
      !!record.isCorrect, Math.max(0, Number(record.durationMs) || 0),
      record.answeredAt || new Date().toISOString()
    ]);
  }

  async listPracticeRecords(limit: number = 1000, userId: number = 1): Promise<any[]> {
    const { rows } = await this.pool.query(`
      SELECT verb, form_key, scene_id, scene_name, user_answer, correct_answer,
             is_correct, duration_ms, answered_at
      FROM practice_records
      WHERE user_id = $1
      ORDER BY answered_at DESC, id DESC
      LIMIT $2
    `, [uid(userId), limit]);
    return rows.map(normalizePracticeRecord);
  }

  async listMemoryCards(limit: number = 500, userId: number = 1): Promise<any[]> {
    const { rows } = await this.pool.query(`
      SELECT * FROM memory_cards
      WHERE user_id = $1
      ORDER BY due_at ASC, updated_at DESC
      LIMIT $2
    `, [uid(userId), limit]);
    return rows.map(normalizeMemoryCard);
  }

  async getMemoryCardByWord(word: string, userId: number = 1): Promise<any> {
    if (!word) return null;
    const { rows } = await this.pool.query(
      'SELECT * FROM memory_cards WHERE user_id = $1 AND word = $2 LIMIT 1',
      [uid(userId), word]
    );
    return normalizeMemoryCard(rows[0]);
  }

  async upsertMemoryCard(card: any, userId: number = 1): Promise<void> {
    const now = new Date().toISOString();
    await this.pool.query(`
      INSERT INTO memory_cards (
        user_id, word, reading, meaning, word_type, verb_type, sample, source,
        ease, interval_days, review_count, lapses, due_at, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15
      )
      ON CONFLICT(user_id, word) DO UPDATE SET
        reading = EXCLUDED.reading,
        meaning = EXCLUDED.meaning,
        word_type = EXCLUDED.word_type,
        verb_type = EXCLUDED.verb_type,
        sample = CASE WHEN EXCLUDED.sample <> '' THEN EXCLUDED.sample ELSE memory_cards.sample END,
        source = EXCLUDED.source,
        updated_at = EXCLUDED.updated_at
    `, [
      uid(userId), card.word, card.reading || '', card.meaning || '',
      card.wordType || 'other', card.verbType || '', card.sample || '',
      card.source || 'lookup', Number(card.ease) || 2.2,
      Number(card.intervalDays) || 0, Number(card.reviewCount) || 0,
      Number(card.lapses) || 0, card.dueAt || now, card.createdAt || now, now
    ]);
  }

  async deleteMemoryCard(id: any, userId: number = 1): Promise<boolean> {
    const result = await this.pool.query(
      'DELETE FROM memory_cards WHERE id = $1 AND user_id = $2',
      [Number(id), uid(userId)]
    );
    return result.rowCount > 0;
  }

  async reviewMemoryCard(id: any, grade: string, settings: any, userId: number = 1): Promise<any> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        'SELECT * FROM memory_cards WHERE id = $1 AND user_id = $2 FOR UPDATE',
        [Number(id), uid(userId)]
      );
      const raw = rows[0];
      if (!raw) {
        await client.query('ROLLBACK');
        return null;
      }
      const card = normalizeMemoryCard(raw);
      const now = new Date();
      const wasNew = card.reviewCount === 0;
      const next = scheduleReview(card, grade, settings, now);
      const { rows: updatedRows } = await client.query(`
        UPDATE memory_cards
        SET ease = $1, interval_days = $2, review_count = review_count + 1,
            lapses = lapses + $3, due_at = $4, updated_at = $5
        WHERE id = $6
        RETURNING *
      `, [
        next.ease, next.intervalDays, next.lapseDelta, next.dueAt.toISOString(),
        now.toISOString(), Number(id)
      ]);
      await client.query(`
        INSERT INTO review_logs (
          user_id, card_id, grade, was_new, ease_before, ease_after,
          interval_before, interval_after, reviewed_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `, [
        uid(userId), Number(id), grade, wasNew, card.ease, next.ease,
        card.intervalDays, next.intervalDays, now.toISOString()
      ]);
      await client.query('COMMIT');
      return normalizeMemoryCard(updatedRows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async getDailyReviewStats(userId: number = 1): Promise<{ reviewsToday: number; newCardsToday: number }> {
    const since = new Date();
    since.setHours(0, 0, 0, 0);
    const { rows } = await this.pool.query(`
      SELECT
        COUNT(*)::int AS reviews_today,
        COUNT(DISTINCT card_id) FILTER (WHERE was_new)::int AS new_cards_today
      FROM review_logs
      WHERE user_id = $1 AND reviewed_at >= $2
    `, [uid(userId), since.toISOString()]);
    return {
      reviewsToday: Number(rows[0]?.reviews_today) || 0,
      newCardsToday: Number(rows[0]?.new_cards_today) || 0
    };
  }

  async listAgentMemory(userId: number = 1): Promise<any[]> {
    const { rows } = await this.pool.query(
      'SELECT * FROM agent_memory WHERE user_id = $1 ORDER BY updated_at DESC',
      [uid(userId)]
    );
    return rows.map(normalizeAgentMemory);
  }

  async retrieveAgentMemory(userId: number = 1, options: any = {}): Promise<any[]> {
    const ranked = rankAgentMemories(await this.listAgentMemory(userId), options);
    if (ranked.length > 0) {
      await this.pool.query(
        'UPDATE agent_memory SET last_used_at = NOW() WHERE user_id = $1 AND id = ANY($2::bigint[])',
        [uid(userId), ranked.map((row: any) => row.id)]
      );
    }
    return ranked;
  }

  async writeAgentMemory(candidates: any[] = [], userId: number = 1, sourceRunId: string = ''): Promise<number> {
    const existing = await this.listAgentMemory(userId);
    const { upserts } = resolveAgentMemoryConflicts(existing, candidates);
    if (upserts.length === 0) return 0;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      for (const row of upserts) {
        await client.query(`
          INSERT INTO agent_memory (
            user_id, type, mkey, value, salience, source_run_id, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
          ON CONFLICT(user_id, type, mkey) DO UPDATE SET
            value = EXCLUDED.value,
            salience = EXCLUDED.salience,
            source_run_id = EXCLUDED.source_run_id,
            updated_at = NOW()
        `, [uid(userId), row.type, row.mkey, row.value, row.salience, sourceRunId]);
      }
      await client.query('COMMIT');
      return upserts.length;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async deleteAgentMemory(id: any, userId: number = 1): Promise<boolean> {
    const result = await this.pool.query(
      'DELETE FROM agent_memory WHERE id = $1 AND user_id = $2',
      [Number(id), uid(userId)]
    );
    return result.rowCount > 0;
  }

  async hasEntitlement(key: string, userId: number = 1): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      'SELECT 1 FROM entitlements WHERE user_id = $1 AND key = $2',
      [uid(userId), key]
    );
    return rowCount > 0;
  }

  async createPaymentOrder(order: any): Promise<void> {
    await this.pool.query(`
      INSERT INTO payment_orders (
        out_trade_no, user_id, sku, subject, amount, status, provider,
        payment_currency, payment_chain, deposit_address, deposit_tag,
        tx_id, provider_payload, created_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7,
        $8, $9, $10, $11, $12, $13, $14
      )
    `, [
      order.outTradeNo, uid(order.userId), order.sku, order.subject,
      order.amount, order.status, order.provider, order.paymentCurrency || '',
      order.paymentChain || '', order.depositAddress || '', order.depositTag || '',
      order.txId || null, order.providerPayload || {}, order.createdAt
    ]);
  }

  async getPaymentOrder(outTradeNo: string): Promise<any> {
    const { rows } = await this.pool.query(
      'SELECT * FROM payment_orders WHERE out_trade_no = $1',
      [outTradeNo]
    );
    return rows[0] || null;
  }

  async updatePaymentOrder(outTradeNo: string, updates: any): Promise<any> {
    const allowed: Record<string, string> = { status: 'status', txId: 'tx_id', providerPayload: 'provider_payload' };
    const entries = Object.entries(updates || {}).filter(([key]) => allowed[key]);
    if (!entries.length) return this.getPaymentOrder(outTradeNo);
    const values = entries.map(([key, value]) => key === 'providerPayload' ? (value || {}) : value);
    const assignments = entries.map(([key], index) => `${allowed[key]} = $${index + 1}`);
    values.push(outTradeNo);
    const { rows } = await this.pool.query(`
      UPDATE payment_orders SET ${assignments.join(', ')}
      WHERE out_trade_no = $${values.length}
      RETURNING *
    `, values);
    return rows[0] || null;
  }

  async settlePaymentOrder(outTradeNo: string, entitlement: string): Promise<any> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        'SELECT * FROM payment_orders WHERE out_trade_no = $1 FOR UPDATE',
        [outTradeNo]
      );
      const row = rows[0];
      if (!row) {
        await client.query('ROLLBACK');
        return null;
      }
      await client.query(`
        UPDATE payment_orders
        SET status = 'TRADE_SUCCESS', paid_at = COALESCE(paid_at, NOW())
        WHERE out_trade_no = $1
      `, [outTradeNo]);
      if (entitlement) {
        await client.query(`
          INSERT INTO entitlements (user_id, key, out_trade_no, unlocked_at)
          VALUES ($1, $2, $3, NOW())
          ON CONFLICT(user_id, key) DO NOTHING
        `, [row.user_id, entitlement, outTradeNo]);
      }
      await client.query('COMMIT');
      return { ...row, status: 'TRADE_SUCCESS' };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async upsertAgentRun(record: any, userId: any): Promise<any> {
    const now = new Date().toISOString();
    const current = await this.getAgentRun(record.runId, userId);
    const next = { ...current, ...record };
    const completedAt = next.completedAt
      || (['completed', 'failed', 'cancelled', 'timed_out'].includes(next.status) ? now : null);
    const { rows } = await this.pool.query(`
      INSERT INTO agent_runs (
        run_id, user_id, title, question, intent_type, provider, model, status,
        summary, error, metadata, created_at, updated_at, completed_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      ON CONFLICT(run_id) DO UPDATE SET
        title=EXCLUDED.title, question=EXCLUDED.question, intent_type=EXCLUDED.intent_type,
        provider=EXCLUDED.provider, model=EXCLUDED.model, status=EXCLUDED.status,
        summary=EXCLUDED.summary, error=EXCLUDED.error, metadata=EXCLUDED.metadata,
        updated_at=EXCLUDED.updated_at, completed_at=EXCLUDED.completed_at
      WHERE agent_runs.user_id = EXCLUDED.user_id
      RETURNING *
    `, [
      next.runId, uid(userId), next.title || '', next.question || '', next.intentType || 'lookup',
      next.provider || '', next.model || '', next.status || 'running', next.summary || '',
      next.error || '', JSON.stringify(next.metadata || {}), next.createdAt || now,
      next.updatedAt || now, completedAt
    ]);
    return normalizeAgentRun(rows[0]);
  }

  async getAgentRun(runId: string, userId: any): Promise<any> {
    const { rows } = await this.pool.query(
      'SELECT * FROM agent_runs WHERE run_id = $1 AND user_id = $2',
      [runId, uid(userId)]
    );
    return normalizeAgentRun(rows[0]);
  }

  async listAgentRuns({ userId, threadId = '', limit = 50 }: { userId?: any; threadId?: string; limit?: number } = {}): Promise<any[]> {
    const safeLimit = Math.max(1, Math.min(200, Number(limit) || 50));
    const params: any[] = [uid(userId)];
    let where = 'user_id = $1';
    if (threadId) {
      params.push(String(threadId));
      where += ` AND metadata->>'threadId' = $2`;
    }
    params.push(safeLimit);
    const { rows } = await this.pool.query(`
      SELECT * FROM agent_runs WHERE ${where}
      ORDER BY updated_at DESC LIMIT $${params.length}
    `, params);
    return rows.map(normalizeAgentRun);
  }

  async upsertSubagentTask(task: any, userId: any): Promise<any> {
    const now = new Date().toISOString();
    const { rows } = await this.pool.query(`
      INSERT INTO subagent_tasks (
        task_id, user_id, run_id, subagent_id, title, status, sandbox, result,
        error, events, cancel_requested, created_at, started_at, completed_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
      ON CONFLICT(task_id) DO UPDATE SET
        status=EXCLUDED.status, sandbox=EXCLUDED.sandbox, result=EXCLUDED.result,
        error=EXCLUDED.error, events=EXCLUDED.events,
        cancel_requested=EXCLUDED.cancel_requested, started_at=EXCLUDED.started_at,
        completed_at=EXCLUDED.completed_at, updated_at=EXCLUDED.updated_at
      WHERE subagent_tasks.user_id = EXCLUDED.user_id
      RETURNING *
    `, [
      task.taskId, uid(userId), task.runId || '', task.subagentId || '', task.title || '',
      task.status || 'pending', JSON.stringify(task.sandbox || {}),
      task.result === null || task.result === undefined ? null : JSON.stringify(task.result),
      task.error || '', JSON.stringify(task.events || []), !!task.cancelRequested,
      task.createdAt || now, task.startedAt || null, task.completedAt || null, task.updatedAt || now
    ]);
    return normalizeSubagentTask(rows[0]);
  }

  async getSubagentTask(taskId: string, userId: any): Promise<any> {
    const { rows } = await this.pool.query(
      'SELECT * FROM subagent_tasks WHERE task_id = $1 AND user_id = $2',
      [taskId, uid(userId)]
    );
    return normalizeSubagentTask(rows[0]);
  }

  async listSubagentTasks({ userId, runId = '', status = '', limit = 50 }: { userId?: any; runId?: string; status?: string; limit?: number } = {}): Promise<any[]> {
    const clauses = ['user_id = $1'];
    const params: any[] = [uid(userId)];
    if (runId) { params.push(runId); clauses.push(`run_id = $${params.length}`); }
    if (status) { params.push(status); clauses.push(`status = $${params.length}`); }
    params.push(Math.max(1, Math.min(500, Number(limit) || 50)));
    const { rows } = await this.pool.query(`
      SELECT * FROM subagent_tasks WHERE ${clauses.join(' AND ')}
      ORDER BY updated_at DESC LIMIT $${params.length}
    `, params);
    return rows.map(normalizeSubagentTask);
  }
}

export function buildDailyQuota(stats: { reviewsToday: number; newCardsToday: number }, settings: any = {}): any {
  const reviewLimit = Number(settings.reviewLimitPerDay) || 60;
  const newLimit = Number(settings.newCardsPerDay) || 12;
  return {
    reviewsToday: stats.reviewsToday,
    reviewLimit,
    reviewsRemaining: Math.max(0, reviewLimit - stats.reviewsToday),
    newCardsToday: stats.newCardsToday,
    newLimit,
    newRemaining: Math.max(0, newLimit - stats.newCardsToday)
  };
}

export async function buildStoreReviewQueue(store: any, userId: any, settings: any): Promise<{ cards: any[]; quota: any }> {
  const [cards, stats] = await Promise.all([
    store.listMemoryCards(500, userId),
    store.getDailyReviewStats(userId)
  ]);
  const quota = buildDailyQuota(stats, settings);
  return { cards: buildReviewQueue(cards, quota), quota };
}

export async function createUserStore(): Promise<LocalUserStore | PostgresUserStore> {
  const connectionString = String(process.env.DATABASE_URL || '').trim();
  let store;
  if (connectionString) {
    const { Pool } = await import('pg');
    store = new PostgresUserStore(connectionString, Pool);
  } else {
    store = new LocalUserStore();
  }
  await store.init();
  console.log(`[user-store] ${store.provider} 已就绪`);
  return store;
}
