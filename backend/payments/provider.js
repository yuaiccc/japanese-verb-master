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

function columnExists(db, table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some(col => col.name === column);
}

export function ensurePaymentSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS payment_orders (
      out_trade_no TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL DEFAULT 1,
      sku TEXT NOT NULL,
      subject TEXT NOT NULL,
      amount TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'WAIT_BUYER_PAY',
      provider TEXT NOT NULL DEFAULT 'mock',
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
  // 多用户隔离迁移（幂等，node 进程内执行）：给存量库补 user_id
  if (!columnExists(db, 'payment_orders', 'user_id')) {
    db.exec(`ALTER TABLE payment_orders ADD COLUMN user_id INTEGER NOT NULL DEFAULT 1`);
  }
  if (!columnExists(db, 'entitlements', 'user_id')) {
    // 原 PRIMARY KEY(key) 需改为 (user_id, key) → 重建表，历史权益归默认用户 1
    db.exec(`
      CREATE TABLE entitlements_new (
        user_id INTEGER NOT NULL DEFAULT 1,
        key TEXT NOT NULL,
        out_trade_no TEXT NOT NULL,
        unlocked_at TEXT NOT NULL,
        PRIMARY KEY (user_id, key)
      );
      INSERT INTO entitlements_new (user_id, key, out_trade_no, unlocked_at)
        SELECT 1, key, out_trade_no, unlocked_at FROM entitlements;
      DROP TABLE entitlements;
      ALTER TABLE entitlements_new RENAME TO entitlements;
    `);
  }
}

export function hasEntitlement(db, key, userId = 1) {
  return !!db.prepare('SELECT key FROM entitlements WHERE user_id = ? AND key = ?').get(Number(userId) || 1, key);
}

function grantEntitlement(db, key, outTradeNo, userId = 1) {
  db.prepare(`
    INSERT INTO entitlements (user_id, key, out_trade_no, unlocked_at) VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(user_id, key) DO NOTHING
  `).run(Number(userId) || 1, key, outTradeNo);
}

function createMockProvider({ db }) {
  return {
    name: 'mock',
    async createOrder(skuDef, userId = 1) {
      const outTradeNo = `JVM${Date.now()}${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
      db.prepare(`
        INSERT INTO payment_orders (out_trade_no, user_id, sku, subject, amount, status, provider, created_at)
        VALUES (?, ?, ?, ?, ?, 'WAIT_BUYER_PAY', 'mock', datetime('now'))
      `).run(outTradeNo, Number(userId) || 1, skuDef.sku, skuDef.subject, skuDef.amount);
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
        if (skuDef) grantEntitlement(db, skuDef.entitlement, outTradeNo, row.user_id);
      }
      return { ok: true, status: 'TRADE_SUCCESS' };
    }
  };
}

function newOutTradeNo() {
  return `JVM${Date.now()}${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

// 支付宝「当面付」接入（alipay-sdk v4）。资金确认权始终在用户手机端：
//   createOrder → alipay.trade.precreate 生成二维码码串（qr_code）
//   queryOrder  → 用户扫码付款后，商户轮询 alipay.trade.query 同步 trade_status
// alipay-sdk / qrcode 用动态 import：未配置支付宝时根本不加载，CI 与 mock 不受影响。
async function createAlipayProvider({ db }) {
  let AlipaySdk;
  let QRCode;
  try {
    ({ AlipaySdk } = await import('alipay-sdk'));
    QRCode = (await import('qrcode')).default;
  } catch {
    throw new Error('Alipay provider 需要额外依赖，请在 backend 下执行：npm i alipay-sdk qrcode');
  }

  // SDK 有两个基址：endpoint 给 v3 curl()（precreate/query）；gateway 给 v1 表单类
  // pageExecute（电脑网站支付）。沙箱两者都要指向沙箱，否则 payUrl 会落到生产网关。
  const endpoint = process.env.ALIPAY_ENDPOINT || '';
  const gateway = process.env.ALIPAY_GATEWAY
    || (endpoint ? `${endpoint.replace(/\/+$/, '')}/gateway.do` : '');
  const sdk = new AlipaySdk({
    appId: process.env.ALIPAY_APP_ID,
    privateKey: process.env.ALIPAY_PRIVATE_KEY,
    alipayPublicKey: process.env.ALIPAY_PUBLIC_KEY,
    signType: 'RSA2',
    // 私钥格式：密钥工具生成的多为 PKCS8（-----BEGIN PRIVATE KEY-----）；
    // 老格式 PKCS1（-----BEGIN RSA PRIVATE KEY-----）。验签失败先改这个。
    keyType: process.env.ALIPAY_KEY_TYPE || 'PKCS8',
    // 沙箱 v3 endpoint：https://openapi-sandbox.dl.alipaydev.com ；生产留空走默认
    ...(endpoint ? { endpoint } : {}),
    ...(gateway ? { gateway } : {})
  });

  // 支付方式：page = 电脑网站支付（浏览器收银台，无需 App，默认）；qr = 当面付扫码（需 App 扫）
  const payMode = (process.env.ALIPAY_PAY_MODE || 'page').toLowerCase();
  const returnUrl = process.env.ALIPAY_RETURN_URL || '';

  // 到账后落库 + 授予权益（幂等）
  const settleIfPaid = (outTradeNo, tradeStatus) => {
    if (tradeStatus !== 'TRADE_SUCCESS' && tradeStatus !== 'TRADE_FINISHED') return;
    const row = db.prepare('SELECT * FROM payment_orders WHERE out_trade_no = ?').get(outTradeNo);
    if (!row || row.status === 'TRADE_SUCCESS') return;
    db.prepare("UPDATE payment_orders SET status = 'TRADE_SUCCESS', paid_at = datetime('now') WHERE out_trade_no = ?")
      .run(outTradeNo);
    const skuDef = SKUS[row.sku];
    if (skuDef) grantEntitlement(db, skuDef.entitlement, outTradeNo, row.user_id);
  };

  return {
    name: 'alipay',
    async createOrder(skuDef, userId = 1) {
      const outTradeNo = newOutTradeNo();
      db.prepare(`
        INSERT INTO payment_orders (out_trade_no, user_id, sku, subject, amount, status, provider, created_at)
        VALUES (?, ?, ?, ?, ?, 'WAIT_BUYER_PAY', 'alipay', datetime('now'))
      `).run(outTradeNo, Number(userId) || 1, skuDef.sku, skuDef.subject, skuDef.amount);

      // 电脑网站支付：pageExecute 本地签名生成收银台 URL（不发网络请求）。
      // 浏览器打开 → 用沙箱买家账号登录付款，无需 App。到账靠 queryOrder 轮询。
      if (payMode === 'page') {
        const payUrl = sdk.pageExecute('alipay.trade.page.pay', 'GET', {
          ...(returnUrl ? { returnUrl } : {}),
          bizContent: {
            out_trade_no: outTradeNo,
            total_amount: skuDef.amount,
            subject: skuDef.subject,
            product_code: 'FAST_INSTANT_TRADE_PAY'
          }
        });
        return {
          outTradeNo,
          subject: skuDef.subject,
          amount: skuDef.amount,
          payUrl,
          cashierHint: '点击前往支付宝收银台，用沙箱买家账号登录付款，到账后本页自动解锁'
        };
      }

      // 当面付：扫码（需支付宝 App 扫）
      const res = await sdk.curl('POST', '/v3/alipay/trade/precreate', {
        body: { out_trade_no: outTradeNo, subject: skuDef.subject, total_amount: skuDef.amount }
      });
      const qrCode = res?.data?.qrCode || res?.data?.qr_code;
      if (!qrCode) {
        throw new Error(`precreate 未返回二维码：${JSON.stringify(res?.data || res).slice(0, 200)}`);
      }
      const qrDataUrl = await QRCode.toDataURL(qrCode, { margin: 1, width: 220 });
      return {
        outTradeNo,
        subject: skuDef.subject,
        amount: skuDef.amount,
        qrContent: qrCode,
        qrDataUrl,
        cashierHint: '请用支付宝扫码完成支付，到账后本页自动解锁'
      };
    },
    async queryOrder(outTradeNo) {
      const row = db.prepare('SELECT * FROM payment_orders WHERE out_trade_no = ?').get(outTradeNo);
      if (!row) return null;
      if (row.status !== 'TRADE_SUCCESS') {
        try {
          const res = await sdk.curl('POST', '/v3/alipay/trade/query', { body: { out_trade_no: outTradeNo } });
          const tradeStatus = res?.data?.tradeStatus || res?.data?.trade_status;
          if (tradeStatus) settleIfPaid(outTradeNo, tradeStatus);
        } catch {
          // 交易尚未创建完成等情况下 query 会报错，保持 WAIT_BUYER_PAY 即可
        }
      }
      const fresh = db.prepare('SELECT * FROM payment_orders WHERE out_trade_no = ?').get(outTradeNo);
      return { outTradeNo: fresh.out_trade_no, sku: fresh.sku, status: fresh.status, paidAt: fresh.paid_at };
    }
    // 注意：alipay provider 没有 simulateBuyerConfirm —— 付款只能由用户在支付宝完成
  };
}

export async function createPaymentProvider({ db }) {
  ensurePaymentSchema(db);
  const useAlipay = !!(process.env.ALIPAY_APP_ID && process.env.ALIPAY_PRIVATE_KEY);
  if (useAlipay) {
    try {
      const provider = await createAlipayProvider({ db });
      const env = process.env.ALIPAY_ENDPOINT?.includes('sandbox') ? '沙箱' : '生产';
      console.log(`[payments] Alipay provider 已启用（${env}，APP_ID=${process.env.ALIPAY_APP_ID}）`);
      return provider;
    } catch (err) {
      // 半配置 / 缺依赖 / 密钥错不应让服务起不来：回退 mock 并告警
      console.warn(`[payments] Alipay 初始化失败，回退 mock provider：${err.message}`);
      return createMockProvider({ db });
    }
  }
  console.log('[payments] 未配置 ALIPAY_* ，使用 mock provider（零资金演示）');
  return createMockProvider({ db });
}
