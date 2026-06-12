// 支付 provider 抽象：演示「Agent/应用发起订单 → 用户扫码确认 → 轮询到账 → 解锁权益」的
// A2A 支付形态（对标支付宝 AI 付：发起权在应用、资金确认权在用户）。
//
// - mock provider（默认）：无外部依赖的完整闭环，订单落库、收银台为本地模拟页、
//   提供 simulate-confirm 接口模拟用户扫码付款。
// - alipay provider（接入位）：设置 ALIPAY_APP_ID / ALIPAY_PRIVATE_KEY / ALIPAY_PUBLIC_KEY 后
//   走支付宝当面付（alipay.trade.precreate 生成二维码 + alipay.trade.query 查单），
//   或挂支付宝官方支付 MCP Server（@alipay/mcp-server-alipay）由 Agent 直接调用。
//   两者同构：本模块的 createOrder/queryOrder 即 MCP 工具 create-payment/query-payment 的语义。
import crypto from 'node:crypto';

export const SKUS = {
  'n1-pack': {
    sku: 'n1-pack',
    subject: 'N1 专项练习（使役被动・高阶变形）',
    amount: '0.01',
    entitlement: 'n1-pack'
  }
};

export function ensurePaymentSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS payment_orders (
      out_trade_no TEXT PRIMARY KEY,
      sku TEXT NOT NULL,
      subject TEXT NOT NULL,
      amount TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'WAIT_BUYER_PAY',
      provider TEXT NOT NULL DEFAULT 'mock',
      created_at TEXT NOT NULL,
      paid_at TEXT
    );
    CREATE TABLE IF NOT EXISTS entitlements (
      key TEXT PRIMARY KEY,
      out_trade_no TEXT NOT NULL,
      unlocked_at TEXT NOT NULL
    );
  `);
}

export function hasEntitlement(db, key) {
  return !!db.prepare('SELECT key FROM entitlements WHERE key = ?').get(key);
}

function grantEntitlement(db, key, outTradeNo) {
  db.prepare(`
    INSERT INTO entitlements (key, out_trade_no, unlocked_at) VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO NOTHING
  `).run(key, outTradeNo);
}

function createMockProvider({ db }) {
  return {
    name: 'mock',
    async createOrder(skuDef) {
      const outTradeNo = `JVM${Date.now()}${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
      db.prepare(`
        INSERT INTO payment_orders (out_trade_no, sku, subject, amount, status, provider, created_at)
        VALUES (?, ?, ?, ?, 'WAIT_BUYER_PAY', 'mock', datetime('now'))
      `).run(outTradeNo, skuDef.sku, skuDef.subject, skuDef.amount);
      return {
        outTradeNo,
        subject: skuDef.subject,
        amount: skuDef.amount,
        // mock 收银台：真实 alipay provider 在此返回 qr_code（支付宝收银台串），
        // 前端将其渲染为二维码；mock 模式给一个可点击的模拟确认入口。
        qrContent: `jvm-mock-pay://confirm/${outTradeNo}`,
        cashierHint: '演示模式：点击「模拟扫码支付」即可完成付款（真实接入时此处为支付宝收银台二维码）'
      };
    },
    async queryOrder(outTradeNo) {
      const row = db.prepare('SELECT * FROM payment_orders WHERE out_trade_no = ?').get(outTradeNo);
      if (!row) return null;
      return { outTradeNo: row.out_trade_no, sku: row.sku, status: row.status, paidAt: row.paid_at };
    },
    // 仅 mock 有：模拟「用户在支付宝完成扫码+密码确认」这一步
    async simulateBuyerConfirm(outTradeNo) {
      const row = db.prepare('SELECT * FROM payment_orders WHERE out_trade_no = ?').get(outTradeNo);
      if (!row) return { ok: false, error: 'order not found' };
      if (row.status !== 'TRADE_SUCCESS') {
        db.prepare("UPDATE payment_orders SET status = 'TRADE_SUCCESS', paid_at = datetime('now') WHERE out_trade_no = ?")
          .run(outTradeNo);
        const skuDef = SKUS[row.sku];
        if (skuDef) grantEntitlement(db, skuDef.entitlement, outTradeNo);
      }
      return { ok: true, status: 'TRADE_SUCCESS' };
    }
  };
}

function createAlipayProvider() {
  // 接入位：需要支付宝开放平台入驻后的密钥三件套。
  // 实现要点（当面付）：
  //   createOrder → POST alipay.trade.precreate（out_trade_no/subject/total_amount）→ 返回 qr_code
  //   queryOrder  → alipay.trade.query → trade_status（WAIT_BUYER_PAY/TRADE_SUCCESS）
  //   支付确认始终发生在用户的支付宝 App（扫码+密码/生物识别），服务端只读状态。
  // 也可不自实现而挂官方 MCP：npx @alipay/mcp-server-alipay，把两个工具暴露给 Agent。
  throw new Error('Alipay provider 未配置：请设置 ALIPAY_APP_ID/ALIPAY_PRIVATE_KEY/ALIPAY_PUBLIC_KEY 并实现 alipay-sdk 调用，或挂接 @alipay/mcp-server-alipay');
}

export function createPaymentProvider({ db }) {
  ensurePaymentSchema(db);
  const useAlipay = !!(process.env.ALIPAY_APP_ID && process.env.ALIPAY_PRIVATE_KEY);
  if (useAlipay) return createAlipayProvider({ db });
  return createMockProvider({ db });
}
