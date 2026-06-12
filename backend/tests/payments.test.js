import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { createPaymentProvider, ensurePaymentSchema, hasEntitlement, SKUS } from '../payments/provider.js';

function freshDb() {
  const db = new Database(':memory:');
  ensurePaymentSchema(db);
  return db;
}

test('mock provider 完整支付闭环：创建→待支付→确认→解锁权益', async () => {
  const db = freshDb();
  const provider = createPaymentProvider({ db });
  assert.equal(provider.name, 'mock');

  const skuDef = SKUS['n1-pack'];
  const order = await provider.createOrder(skuDef);
  assert.ok(order.outTradeNo.startsWith('JVM'));
  assert.equal(order.amount, '0.01');
  assert.ok(order.qrContent.includes(order.outTradeNo));

  let status = await provider.queryOrder(order.outTradeNo);
  assert.equal(status.status, 'WAIT_BUYER_PAY');
  assert.equal(hasEntitlement(db, 'n1-pack'), false); // 未付款不解锁

  const confirm = await provider.simulateBuyerConfirm(order.outTradeNo);
  assert.equal(confirm.ok, true);

  status = await provider.queryOrder(order.outTradeNo);
  assert.equal(status.status, 'TRADE_SUCCESS');
  assert.ok(status.paidAt);
  assert.equal(hasEntitlement(db, 'n1-pack'), true); // 付款后解锁
});

test('确认不存在的订单返回错误', async () => {
  const db = freshDb();
  const provider = createPaymentProvider({ db });
  const result = await provider.simulateBuyerConfirm('JVM-NOT-EXIST');
  assert.equal(result.ok, false);
});

test('重复确认幂等：权益只授一次', async () => {
  const db = freshDb();
  const provider = createPaymentProvider({ db });
  const order = await provider.createOrder(SKUS['n1-pack']);
  await provider.simulateBuyerConfirm(order.outTradeNo);
  await provider.simulateBuyerConfirm(order.outTradeNo); // 二次确认
  const rows = db.prepare('SELECT COUNT(*) AS n FROM entitlements').get();
  assert.equal(rows.n, 1);
});

test('查询不存在的订单返回 null', async () => {
  const db = freshDb();
  const provider = createPaymentProvider({ db });
  assert.equal(await provider.queryOrder('NOPE'), null);
});
