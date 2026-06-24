import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { createPaymentProvider, ensurePaymentSchema, hasEntitlement, SKUS } from '../payments/provider.js';

function freshDb() {
  const db = new Database(':memory:');
  ensurePaymentSchema(db);
  return db;
}

function withOkxEnv() {
  const names = [
    'OKX_API_KEY',
    'OKX_API_SECRET',
    'OKX_API_PASSPHRASE',
    'OKX_PAYMENT_CURRENCY',
    'OKX_PAYMENT_CHAIN',
    'OKX_PAYMENT_AMOUNT'
  ];
  const original = Object.fromEntries(names.map(name => [name, process.env[name]]));
  Object.assign(process.env, {
    OKX_API_KEY: 'test-key',
    OKX_API_SECRET: 'test-secret',
    OKX_API_PASSPHRASE: 'test-passphrase',
    OKX_PAYMENT_CURRENCY: 'USDT',
    OKX_PAYMENT_CHAIN: 'USDT-TRC20',
    OKX_PAYMENT_AMOUNT: '1'
  });
  return () => {
    for (const name of names) {
      if (original[name] === undefined) delete process.env[name];
      else process.env[name] = original[name];
    }
  };
}

test('mock provider 完整支付闭环：创建→待支付→确认→解锁权益', async () => {
  const db = freshDb();
  const provider = await createPaymentProvider({ db });
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
  const provider = await createPaymentProvider({ db });
  const result = await provider.simulateBuyerConfirm('JVM-NOT-EXIST');
  assert.equal(result.ok, false);
});

test('重复确认幂等：权益只授一次', async () => {
  const db = freshDb();
  const provider = await createPaymentProvider({ db });
  const order = await provider.createOrder(SKUS['n1-pack']);
  await provider.simulateBuyerConfirm(order.outTradeNo);
  await provider.simulateBuyerConfirm(order.outTradeNo); // 二次确认
  const rows = db.prepare('SELECT COUNT(*) AS n FROM entitlements').get();
  assert.equal(rows.n, 1);
});

test('查询不存在的订单返回 null', async () => {
  const db = freshDb();
  const provider = await createPaymentProvider({ db });
  assert.equal(await provider.queryOrder('NOPE'), null);
});

test('OKX provider：提交 TxID 后只在成功到账且字段完全匹配时解锁', async () => {
  const restoreEnv = withOkxEnv();
  const originalFetch = globalThis.fetch;
  const db = freshDb();
  let depositState = '0';
  let requestCount = 0;
  globalThis.fetch = async (url, options) => {
    requestCount += 1;
    assert.ok(options.headers['OK-ACCESS-KEY']);
    assert.ok(options.headers['OK-ACCESS-SIGN']);
    assert.ok(options.headers['OK-ACCESS-TIMESTAMP']);
    assert.ok(options.headers['OK-ACCESS-PASSPHRASE']);
    if (String(url).includes('/deposit-address')) {
      return new Response(JSON.stringify({
        code: '0',
        msg: '',
        data: [{ ccy: 'USDT', chain: 'USDT-TRC20', addr: 'TTestDepositAddress' }]
      }), { status: 200 });
    }
    return new Response(JSON.stringify({
      code: '0',
      msg: '',
      data: [{
        ccy: 'USDT',
        chain: 'USDT-TRC20',
        amt: '1.0000',
        to: 'TTestDepositAddress',
        txId: 'abcdef1234567890',
        ts: String(Date.now()),
        state: depositState,
        depId: 'dep-test'
      }]
    }), { status: 200 });
  };

  try {
    const provider = await createPaymentProvider({ db });
    assert.equal(provider.name, 'okx');
    const order = await provider.createOrder(SKUS['n1-pack'], 7);
    assert.equal(order.currency, 'USDT');
    assert.equal(order.chain, 'USDT-TRC20');
    assert.ok(order.qrDataUrl.startsWith('data:image/png;base64,'));

    const pending = await provider.submitTransaction(order.outTradeNo, 'abcdef1234567890', 7);
    assert.equal(pending.ok, true);
    assert.equal(pending.order.status, 'WAIT_BUYER_PAY');
    assert.equal(hasEntitlement(db, 'n1-pack', 7), false);

    depositState = '2';
    const paid = await provider.queryOrder(order.outTradeNo, 7);
    assert.equal(paid.status, 'TRADE_SUCCESS');
    assert.equal(hasEntitlement(db, 'n1-pack', 7), true);
    assert.equal(await provider.queryOrder(order.outTradeNo, 8), null);
    assert.ok(requestCount >= 3);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv();
  }
});

test('OKX provider：同一个 TxID 不能绑定多个订单', async () => {
  const restoreEnv = withOkxEnv();
  const originalFetch = globalThis.fetch;
  const db = freshDb();
  globalThis.fetch = async url => new Response(JSON.stringify({
    code: '0',
    msg: '',
    data: String(url).includes('/deposit-address')
      ? [{ ccy: 'USDT', chain: 'USDT-TRC20', addr: 'TTestDepositAddress' }]
      : []
  }), { status: 200 });

  try {
    const provider = await createPaymentProvider({ db });
    const first = await provider.createOrder(SKUS['n1-pack'], 7);
    const second = await provider.createOrder(SKUS['n1-pack'], 8);
    assert.equal((await provider.submitTransaction(first.outTradeNo, 'same12345678', 7)).ok, true);
    const duplicate = await provider.submitTransaction(second.outTradeNo, 'same12345678', 8);
    assert.equal(duplicate.ok, false);
    assert.equal(duplicate.status, 409);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv();
  }
});
