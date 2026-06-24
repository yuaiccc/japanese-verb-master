import test from 'node:test';
import assert from 'node:assert/strict';
import { scheduleReview, buildReviewQueue } from '../db';

const settings = {
  desiredRetention: 0.9,
  lapseMinutes: 20,
  hardMultiplier: 1.2,
  goodInitialDays: 1,
  easeBonus: 0.08,
  easePenalty: 0.1,
  lapsePenalty: 0.25,
  maxIntervalDays: 180
};
const NOW = new Date('2026-06-22T08:00:00.000Z');

test('scheduleReview: forgot 回炉到分钟级、ease 扣减、记一次 lapse', () => {
  const r = scheduleReview({ ease: 2.2, intervalDays: 10 }, 'forgot', settings, NOW);
  assert.equal(r.intervalDays, 0);
  assert.equal(r.lapseDelta, 1);
  assert.ok(Math.abs(r.ease - 1.95) < 1e-9); // 2.2 - 0.25
  assert.equal(r.dueAt.getTime(), NOW.getTime() + 20 * 60 * 1000);
});

test('scheduleReview: forgot 的 ease 不低于 1.4 下限', () => {
  const r = scheduleReview({ ease: 1.5, intervalDays: 3 }, 'forgot', settings, NOW);
  assert.equal(r.ease, 1.4);
});

test('scheduleReview: good 新卡用 goodInitialDays 起步', () => {
  const r = scheduleReview({ ease: 2.2, intervalDays: 0 }, 'good', settings, NOW);
  assert.equal(r.intervalDays, 1);
  assert.ok(Math.abs(r.ease - 2.28) < 1e-9); // +easeBonus
  assert.equal(r.lapseDelta, 0);
});

test('scheduleReview: good 复习卡按 interval×ease×retentionScale 增长', () => {
  const r = scheduleReview({ ease: 2.5, intervalDays: 10 }, 'good', settings, NOW);
  // 10 * 2.5 * (0.9/0.9) = 25
  assert.equal(r.intervalDays, 25);
});

test('scheduleReview: good 受 maxIntervalDays 封顶', () => {
  const r = scheduleReview({ ease: 2.8, intervalDays: 100 }, 'good', { ...settings, maxIntervalDays: 180 }, NOW);
  assert.equal(r.intervalDays, 180);
});

test('scheduleReview: 更高 desiredRetention 让区间增长更慢', () => {
  const loose = scheduleReview({ ease: 2.5, intervalDays: 10 }, 'good', { ...settings, desiredRetention: 0.8 }, NOW);
  const tight = scheduleReview({ ease: 2.5, intervalDays: 10 }, 'good', { ...settings, desiredRetention: 0.95 }, NOW);
  assert.ok(tight.intervalDays < loose.intervalDays);
});

test('scheduleReview: hard 小步增长且 ease 扣减', () => {
  const r = scheduleReview({ ease: 2.2, intervalDays: 10 }, 'hard', settings, NOW);
  assert.equal(r.intervalDays, 12); // ceil(10 * 1.2)
  assert.ok(Math.abs(r.ease - 2.1) < 1e-9); // -easePenalty
});

const card = (id: any, dueAt: any, reviewCount: any) => ({ id, dueAt, reviewCount });

test('buildReviewQueue: 只放到期卡，按 due 升序', () => {
  const now = Date.parse('2026-06-22T08:00:00Z');
  const cards = [
    card(1, '2026-06-22T07:00:00Z', 3),
    card(2, '2026-06-23T08:00:00Z', 3), // 未到期
    card(3, '2026-06-22T06:00:00Z', 3)
  ];
  const q = buildReviewQueue(cards, { reviewsRemaining: 50, newRemaining: 12 }, now);
  assert.deepEqual(q.map((c: any) => c.id), [3, 1]);
});

test('buildReviewQueue: 新卡受 newRemaining 约束，复习卡不受影响', () => {
  const now = Date.parse('2026-06-22T08:00:00Z');
  const due = '2026-06-22T07:00:00Z';
  const cards = [
    card(1, due, 0), // 新
    card(2, due, 0), // 新
    card(3, due, 0), // 新
    card(4, due, 5)  // 复习
  ];
  const q = buildReviewQueue(cards, { reviewsRemaining: 50, newRemaining: 1 }, now);
  const ids = q.map((c: any) => c.id).sort();
  // 只放 1 张新卡 + 那张复习卡
  assert.equal(q.filter((c: any) => c.reviewCount === 0).length, 1);
  assert.ok(ids.includes(4));
  assert.equal(q.length, 2);
});

test('buildReviewQueue: 整体不超过当日复习上限 reviewsRemaining', () => {
  const now = Date.parse('2026-06-22T08:00:00Z');
  const due = '2026-06-22T07:00:00Z';
  const cards = Array.from({ length: 10 }, (_, i) => card(i + 1, due, 5));
  const q = buildReviewQueue(cards, { reviewsRemaining: 3, newRemaining: 12 }, now);
  assert.equal(q.length, 3);
});

test('buildReviewQueue: reviewsRemaining 为 0 时队列为空', () => {
  const now = Date.parse('2026-06-22T08:00:00Z');
  const cards = [card(1, '2026-06-22T07:00:00Z', 5)];
  const q = buildReviewQueue(cards, { reviewsRemaining: 0, newRemaining: 12 }, now);
  assert.equal(q.length, 0);
});
