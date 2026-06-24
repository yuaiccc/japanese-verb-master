// 验证：多用户隔离迁移 + 认证 + 数据隔离。运行后清理掉测试用户/数据。
import db from '../db';
import {
  listMemoryCards, upsertMemoryCard, deleteMemoryCard,
  listRecentPracticeRecords, insertPracticeRecord
} from '../db';
import { ensureAuthSchema, hashPassword, verifyPassword, signToken, verifyToken } from '../auth';
import { ensurePaymentSchema, hasEntitlement } from '../payments/provider';

const out: string[] = [];
const ok = (m: string) => out.push('PASS ' + m);
const bad = (m: string) => out.push('FAIL ' + m);

// 1. 迁移：列存在
const memCols = db.prepare('PRAGMA table_info(memory_cards)').all().map((c: any) => c.name);
const prCols = db.prepare('PRAGMA table_info(practice_records)').all().map((c: any) => c.name);
memCols.includes('user_id') ? ok('memory_cards.user_id') : bad('memory_cards.user_id 缺失');
prCols.includes('user_id') ? ok('practice_records.user_id') : bad('practice_records.user_id 缺失');

ensureAuthSchema(db);
ensurePaymentSchema(db);
const entCols = db.prepare('PRAGMA table_info(entitlements)').all().map((c: any) => c.name);
entCols.includes('user_id') ? ok('entitlements.user_id') : bad('entitlements.user_id 缺失');

// 2. 认证：哈希 + 校验 + token
const h = hashPassword('secret123');
verifyPassword('secret123', h) ? ok('verifyPassword 正确密码') : bad('verifyPassword 正确密码');
!verifyPassword('wrong', h) ? ok('verifyPassword 错误密码拒绝') : bad('verifyPassword 错误密码应拒绝');
const tok = signToken(4242);
verifyToken(tok)?.userId === 4242 ? ok('token 签发/校验') : bad('token 签发/校验');
verifyToken(tok + 'x') === null ? ok('token 篡改拒绝') : bad('token 篡改应拒绝');

// 3. 数据隔离：两个测试用户各自的记忆卡互不可见
const U_A = 900001, U_B = 900002;
// 清理可能的残留
db.prepare('DELETE FROM memory_cards WHERE user_id IN (?, ?)').run(U_A, U_B);
upsertMemoryCard({ word: '__test_word_A__', meaning: 'A' }, U_A);
upsertMemoryCard({ word: '__test_word_B__', meaning: 'B' }, U_B);
const aCards = listMemoryCards(500, U_A).map((c: any) => c.word);
const bCards = listMemoryCards(500, U_B).map((c: any) => c.word);
(aCards.includes('__test_word_A__') && !aCards.includes('__test_word_B__')) ? ok('记忆卡隔离 A') : bad('记忆卡隔离 A: ' + JSON.stringify(aCards));
(bCards.includes('__test_word_B__') && !bCards.includes('__test_word_A__')) ? ok('记忆卡隔离 B') : bad('记忆卡隔离 B: ' + JSON.stringify(bCards));

// 同词跨用户可共存（UNIQUE(user_id, word) 而非 UNIQUE(word)）
db.prepare('DELETE FROM memory_cards WHERE word = ?').run('__shared_word__');
upsertMemoryCard({ word: '__shared_word__', meaning: 'shared' }, U_A);
upsertMemoryCard({ word: '__shared_word__', meaning: 'shared' }, U_B);
const sharedCount = db.prepare('SELECT COUNT(*) AS n FROM memory_cards WHERE word = ?').get('__shared_word__').n;
sharedCount === 2 ? ok('同词跨用户共存') : bad('同词跨用户共存 应为2 实为 ' + sharedCount);

// 4. 权益隔离
db.prepare('DELETE FROM entitlements WHERE user_id IN (?, ?)').run(U_A, U_B);
db.prepare("INSERT INTO entitlements (user_id, key, out_trade_no, unlocked_at) VALUES (?, 'n1-pack', 'X', datetime('now'))").run(U_A);
hasEntitlement(db, 'n1-pack', U_A) ? ok('权益 A 已解锁') : bad('权益 A 应已解锁');
!hasEntitlement(db, 'n1-pack', U_B) ? ok('权益 B 未解锁(隔离)') : bad('权益 B 不应解锁');

// 清理测试数据
db.prepare('DELETE FROM memory_cards WHERE user_id IN (?, ?)').run(U_A, U_B);
db.prepare('DELETE FROM memory_cards WHERE word = ?').run('__shared_word__');
db.prepare('DELETE FROM entitlements WHERE user_id IN (?, ?)').run(U_A, U_B);

const failed = out.filter(l => l.startsWith('FAIL'));
console.log('\n' + out.join('\n'));
console.log('\n=== ' + (failed.length ? `${failed.length} FAILED` : 'ALL PASSED') + ' ===');
process.exit(failed.length ? 1 : 0);
