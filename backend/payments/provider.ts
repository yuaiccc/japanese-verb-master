// 支付 provider 抽象：演示「Agent/应用发起订单 → 用户扫码确认 → 轮询到账 → 解锁权益」的
// A2A 支付形态（对标支付宝 AI 付：发起权在应用、资金确认权在用户）。
//
// - mock provider（默认）：无外部依赖的完整闭环，订单落库、收银台为本地模拟页、
//   提供 simulate-confirm 接口模拟用户扫码付款。
// - okx provider：设置 OKX_API_KEY / OKX_API_SECRET / OKX_API_PASSPHRASE 后，
//   展示指定币种和网络的充值地址。用户提交 TxID，服务端用只读 API 核验到账后解锁。
// - alipay provider（接入位）：设置 ALIPAY_APP_ID / ALIPAY_PRIVATE_KEY / ALIPAY_PUBLIC_KEY 后
//   走支付宝当面付（alipay.trade.precreate 生成二维码 + alipay.trade.query 查单），
//   或挂支付宝官方支付 MCP Server（@alipay/mcp-server-alipay）由 Agent 直接调用。
//   两者同构：本模块的 createOrder/queryOrder 即 MCP 工具 create-payment/query-payment 的语义。
import crypto from 'node:crypto';

export const SKUS: Record<string, { sku: string; subject: string; amount: string; entitlement: string }> = {
  'n1-pack': {
    sku: 'n1-pack',
    subject: 'N1 专项练习（使役被动・高阶变形）',
    amount: '0.01',
    entitlement: 'n1-pack'
  }
};

function columnExists(db: any, table: string, column: string): boolean {
  return db.prepare(`PRAGMA table_info(${table})`).all().some((col: any) => col.name === column);
}

export function ensurePaymentSchema(db: any): void {
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
  // 多用户隔离迁移（幂等，node 进程内执行）：给存量库补 user_id
  if (!columnExists(db, 'payment_orders', 'user_id')) {
    db.exec(`ALTER TABLE payment_orders ADD COLUMN user_id INTEGER NOT NULL DEFAULT 1`);
  }
  const paymentColumns = [
    ['payment_currency', "TEXT NOT NULL DEFAULT ''"],
    ['payment_chain', "TEXT NOT NULL DEFAULT ''"],
    ['deposit_address', "TEXT NOT NULL DEFAULT ''"],
    ['deposit_tag', "TEXT NOT NULL DEFAULT ''"],
    ['tx_id', 'TEXT'],
    ['provider_payload', "TEXT NOT NULL DEFAULT ''"]
  ];
  for (const [column, definition] of paymentColumns) {
    if (!columnExists(db, 'payment_orders', column)) {
      db.exec(`ALTER TABLE payment_orders ADD COLUMN ${column} ${definition}`);
    }
  }
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_orders_tx_id
    ON payment_orders(tx_id) WHERE tx_id IS NOT NULL AND tx_id <> ''
  `);
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

export function hasEntitlement(db: any, key: string, userId: number = 1): boolean {
  return !!db.prepare('SELECT key FROM entitlements WHERE user_id = ? AND key = ?').get(Number(userId) || 1, key);
}

function createSqlitePaymentStore(db: any): any {
  ensurePaymentSchema(db);
  return {
    async hasEntitlement(key: string, userId: number = 1): Promise<boolean> {
      return hasEntitlement(db, key, userId);
    },
    async createPaymentOrder(order: any): Promise<void> {
      db.prepare(`
        INSERT INTO payment_orders (
          out_trade_no, user_id, sku, subject, amount, status, provider,
          payment_currency, payment_chain, deposit_address, deposit_tag,
          tx_id, provider_payload, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        order.outTradeNo,
        Number(order.userId) || 1,
        order.sku,
        order.subject,
        order.amount,
        order.status,
        order.provider,
        order.paymentCurrency || '',
        order.paymentChain || '',
        order.depositAddress || '',
        order.depositTag || '',
        order.txId || null,
        JSON.stringify(order.providerPayload || {}),
        order.createdAt
      );
    },
    async getPaymentOrder(outTradeNo: string): Promise<any> {
      return db.prepare('SELECT * FROM payment_orders WHERE out_trade_no = ?').get(outTradeNo) || null;
    },
    async updatePaymentOrder(outTradeNo: string, updates: any): Promise<any> {
      const allowed: Record<string, string> = {
        status: 'status',
        txId: 'tx_id',
        providerPayload: 'provider_payload'
      };
      const entries = Object.entries(updates || {}).filter(([key]) => allowed[key]);
      if (!entries.length) return this.getPaymentOrder(outTradeNo);
      const assignments = entries.map(([key]) => `${allowed[key]} = ?`).join(', ');
      const values = entries.map(([key, value]) =>
        key === 'providerPayload' ? JSON.stringify(value || {}) : value
      );
      db.prepare(`UPDATE payment_orders SET ${assignments} WHERE out_trade_no = ?`)
        .run(...values, outTradeNo);
      return this.getPaymentOrder(outTradeNo);
    },
    async settlePaymentOrder(outTradeNo: string, entitlement: string): Promise<any> {
      const row = db.prepare('SELECT * FROM payment_orders WHERE out_trade_no = ?').get(outTradeNo);
      if (!row) return null;
      const paidAt = new Date().toISOString();
      const tx = db.transaction(() => {
        db.prepare("UPDATE payment_orders SET status = 'TRADE_SUCCESS', paid_at = ? WHERE out_trade_no = ?")
          .run(paidAt, outTradeNo);
        if (entitlement) {
          db.prepare(`
            INSERT INTO entitlements (user_id, key, out_trade_no, unlocked_at) VALUES (?, ?, ?, ?)
            ON CONFLICT(user_id, key) DO NOTHING
          `).run(row.user_id, entitlement, outTradeNo, paidAt);
        }
      });
      tx();
      return { ...row, status: 'TRADE_SUCCESS', paid_at: paidAt };
    }
  };
}

function createMockProvider({ store }: { store: any }): any {
  return {
    name: 'mock',
    async createOrder(skuDef: any, userId: number = 1): Promise<any> {
      const outTradeNo = `JVM${Date.now()}${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
      await store.createPaymentOrder({
        outTradeNo,
        userId,
        sku: skuDef.sku,
        subject: skuDef.subject,
        amount: skuDef.amount,
        status: 'WAIT_BUYER_PAY',
        provider: 'mock',
        createdAt: new Date().toISOString()
      });
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
    async queryOrder(outTradeNo: string, userId: number = 1): Promise<any> {
      const row = await store.getPaymentOrder(outTradeNo);
      if (!row || Number(row.user_id) !== Number(userId)) return null;
      return { outTradeNo: row.out_trade_no, sku: row.sku, status: row.status, paidAt: row.paid_at };
    },
    // 仅 mock 有：模拟「用户在支付宝完成扫码+密码确认」这一步
    async simulateBuyerConfirm(outTradeNo: string, userId: number = 1): Promise<any> {
      const row = await store.getPaymentOrder(outTradeNo);
      if (!row || Number(row.user_id) !== Number(userId)) return { ok: false, error: 'order not found' };
      if (row.status !== 'TRADE_SUCCESS') {
        const skuDef = SKUS[row.sku];
        await store.settlePaymentOrder(outTradeNo, skuDef?.entitlement || '');
      }
      return { ok: true, status: 'TRADE_SUCCESS' };
    }
  };
}

function newOutTradeNo(): string {
  return `JVM${Date.now()}${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

function normalizeAmount(value: any): string | null {
  const raw = String(value ?? '').trim();
  if (!/^\d+(?:\.\d+)?$/.test(raw)) return null;
  if (Number(raw) <= 0) return null;
  const [whole, fraction = ''] = raw.split('.');
  return `${whole.replace(/^0+(?=\d)/, '') || '0'}.${fraction.replace(/0+$/, '')}`;
}

function amountsEqual(left: any, right: any): boolean {
  return normalizeAmount(left) === normalizeAmount(right);
}

function createOkxClient({ apiKey, secretKey, passphrase, baseUrl }: { apiKey: string; secretKey: string; passphrase: string; baseUrl: string }): any {
  const request = async (path: string, params: Record<string, any> = {}): Promise<any[]> => {
    const query = new URLSearchParams(
      Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== '')
    ).toString();
    const requestPath = query ? `${path}?${query}` : path;
    const timestamp = new Date().toISOString();
    const prehash = `${timestamp}GET${requestPath}`;
    const signature = crypto.createHmac('sha256', secretKey).update(prehash).digest('base64');
    const response = await fetch(`${baseUrl}${requestPath}`, {
      headers: {
        'OK-ACCESS-KEY': apiKey,
        'OK-ACCESS-SIGN': signature,
        'OK-ACCESS-TIMESTAMP': timestamp,
        'OK-ACCESS-PASSPHRASE': passphrase
      },
      signal: AbortSignal.timeout(10_000)
    });
    const payload: any = await response.json().catch(() => ({}));
    if (!response.ok || payload.code !== '0') {
      throw new Error(`OKX API ${payload.code || response.status}: ${payload.msg || 'request failed'}`);
    }
    return Array.isArray(payload.data) ? payload.data : [];
  };
  return {
    getDepositAddresses: (ccy: string): Promise<any[]> => request('/api/v5/asset/deposit-address', { ccy }),
    getDepositHistory: ({ ccy, txId }: { ccy: string; txId: string }): Promise<any[]> =>
      request('/api/v5/asset/deposit-history', { ccy, txId, limit: '100' })
  };
}

async function createOkxProvider({ store }: { store: any }): Promise<any> {
  const apiKey = String(process.env.OKX_API_KEY || '').trim();
  const secretKey = String(process.env.OKX_API_SECRET || '').trim();
  const passphrase = String(process.env.OKX_API_PASSPHRASE || '').trim();
  const baseUrl = String(process.env.OKX_API_BASE_URL || 'https://www.okx.com').replace(/\/+$/, '');
  const currency = String(process.env.OKX_PAYMENT_CURRENCY || 'USDT').trim().toUpperCase();
  const chain = String(process.env.OKX_PAYMENT_CHAIN || 'USDT-TRC20').trim();
  const amount = String(process.env.OKX_PAYMENT_AMOUNT || '1').trim();
  if (!normalizeAmount(amount)) throw new Error('OKX_PAYMENT_AMOUNT 必须是正数');

  const client = createOkxClient({ apiKey, secretKey, passphrase, baseUrl });
  const addresses = await client.getDepositAddresses(currency);
  const address = addresses.find((item: any) => String(item.chain).toLowerCase() === chain.toLowerCase());
  if (!address?.addr) {
    const available = addresses.map((item: any) => item.chain).filter(Boolean).join(', ');
    throw new Error(`OKX 未返回 ${chain} 充值地址；可用网络：${available || '无'}`);
  }

  const QRCode = (await import('qrcode')).default;
  const qrDataUrl = await QRCode.toDataURL(address.addr, { margin: 1, width: 220 });

  const publicOrder = (row: any): any => ({
    outTradeNo: row.out_trade_no,
    sku: row.sku,
    status: row.status,
    paidAt: row.paid_at,
    txId: row.tx_id || '',
    currency: row.payment_currency,
    chain: row.payment_chain,
    amount: row.amount,
    depositAddress: row.deposit_address,
    depositTag: row.deposit_tag || '',
    qrDataUrl,
    verificationStatus: row.tx_id && row.status !== 'TRADE_SUCCESS'
      ? '正在等待 OKX 确认到账'
      : ''
  });

  const verifyOrder = async (row: any): Promise<any> => {
    if (!row?.tx_id || row.status === 'TRADE_SUCCESS') return row;
    const deposits = await client.getDepositHistory({
      ccy: row.payment_currency,
      txId: row.tx_id
    });
    const deposit = deposits.find((item: any) =>
      String(item.txId || '').toLowerCase() === String(row.tx_id).toLowerCase()
    );
    if (!deposit) return row;

    const createdAt = new Date(row.created_at).getTime();
    const depositAt = Number(deposit.ts);
    const addressMatches = !deposit.to
      || String(deposit.to).toLowerCase() === String(row.deposit_address).toLowerCase();
    const matches = (
      String(deposit.ccy).toUpperCase() === String(row.payment_currency).toUpperCase()
      && String(deposit.chain).toLowerCase() === String(row.payment_chain).toLowerCase()
      && amountsEqual(deposit.amt, row.amount)
      && addressMatches
      && Number.isFinite(depositAt)
      && depositAt >= createdAt - 10 * 60 * 1000
    );
    if (!matches || String(deposit.state) !== '2') {
      await store.updatePaymentOrder(row.out_trade_no, {
        providerPayload: {
          state: String(deposit.state || ''),
          depositId: String(deposit.depId || ''),
          checkedAt: new Date().toISOString()
        }
      });
      return store.getPaymentOrder(row.out_trade_no);
    }

    const skuDef = SKUS[row.sku];
    await store.updatePaymentOrder(row.out_trade_no, {
      providerPayload: {
        state: '2',
        depositId: String(deposit.depId || ''),
        checkedAt: new Date().toISOString()
      }
    });
    return store.settlePaymentOrder(row.out_trade_no, skuDef?.entitlement || '');
  };

  return {
    name: 'okx',
    async createOrder(skuDef: any, userId: number = 1): Promise<any> {
      const outTradeNo = newOutTradeNo();
      await store.createPaymentOrder({
        outTradeNo,
        userId,
        sku: skuDef.sku,
        subject: skuDef.subject,
        amount,
        status: 'WAIT_BUYER_PAY',
        provider: 'okx',
        paymentCurrency: currency,
        paymentChain: chain,
        depositAddress: address.addr,
        depositTag: address.tag || address.memo || address.pmtId || '',
        createdAt: new Date().toISOString()
      });
      return {
        outTradeNo,
        subject: skuDef.subject,
        amount,
        currency,
        chain,
        depositAddress: address.addr,
        depositTag: address.tag || address.memo || address.pmtId || '',
        qrDataUrl,
        cashierHint: `请通过 ${chain} 网络充值准确的 ${amount} ${currency}，完成后提交 TxID。不要使用其他网络。`
      };
    },
    async submitTransaction(outTradeNo: string, txId: string, userId: number = 1): Promise<any> {
      const normalizedTxId = String(txId || '').trim();
      if (!/^[A-Za-z0-9:_-]{8,200}$/.test(normalizedTxId)) {
        return { ok: false, status: 400, error: 'TxID 格式无效' };
      }
      const row = await store.getPaymentOrder(outTradeNo);
      if (!row || Number(row.user_id) !== Number(userId)) {
        return { ok: false, status: 404, error: 'Order not found' };
      }
      if (row.status === 'TRADE_SUCCESS') {
        return { ok: true, order: publicOrder(row) };
      }
      try {
        await store.updatePaymentOrder(outTradeNo, { txId: normalizedTxId });
      } catch (error: any) {
        if (/unique|duplicate/i.test(error.message)) {
          return { ok: false, status: 409, error: '该 TxID 已被其他订单使用' };
        }
        throw error;
      }
      const fresh = await verifyOrder(await store.getPaymentOrder(outTradeNo));
      return { ok: true, order: publicOrder(fresh) };
    },
    async queryOrder(outTradeNo: string, userId: number = 1): Promise<any> {
      const row = await store.getPaymentOrder(outTradeNo);
      if (!row || Number(row.user_id) !== Number(userId)) return null;
      const fresh = await verifyOrder(row);
      return publicOrder(fresh);
    }
  };
}

// 支付宝「当面付」接入（alipay-sdk v4）。资金确认权始终在用户手机端：
//   createOrder → alipay.trade.precreate 生成二维码码串（qr_code）
//   queryOrder  → 用户扫码付款后，商户轮询 alipay.trade.query 同步 trade_status
// alipay-sdk / qrcode 用动态 import：未配置支付宝时根本不加载，CI 与 mock 不受影响。
async function createAlipayProvider({ store }: { store: any }): Promise<any> {
  let AlipaySdk: any;
  let QRCode: any;
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
  const settleIfPaid = async (outTradeNo: string, tradeStatus: string): Promise<void> => {
    if (tradeStatus !== 'TRADE_SUCCESS' && tradeStatus !== 'TRADE_FINISHED') return;
    const row = await store.getPaymentOrder(outTradeNo);
    if (!row || row.status === 'TRADE_SUCCESS') return;
    const skuDef = SKUS[row.sku];
    await store.settlePaymentOrder(outTradeNo, skuDef?.entitlement || '');
  };

  return {
    name: 'alipay',
    async createOrder(skuDef: any, userId: number = 1): Promise<any> {
      const outTradeNo = newOutTradeNo();
      await store.createPaymentOrder({
        outTradeNo,
        userId,
        sku: skuDef.sku,
        subject: skuDef.subject,
        amount: skuDef.amount,
        status: 'WAIT_BUYER_PAY',
        provider: 'alipay',
        createdAt: new Date().toISOString()
      });

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
    async queryOrder(outTradeNo: string, userId: number = 1): Promise<any> {
      const row = await store.getPaymentOrder(outTradeNo);
      if (!row || Number(row.user_id) !== Number(userId)) return null;
      if (row.status !== 'TRADE_SUCCESS') {
        try {
          const res = await sdk.curl('POST', '/v3/alipay/trade/query', { body: { out_trade_no: outTradeNo } });
          const tradeStatus = res?.data?.tradeStatus || res?.data?.trade_status;
          if (tradeStatus) await settleIfPaid(outTradeNo, tradeStatus);
        } catch {
          // 交易尚未创建完成等情况下 query 会报错，保持 WAIT_BUYER_PAY 即可
        }
      }
      const fresh = await store.getPaymentOrder(outTradeNo);
      return { outTradeNo: fresh.out_trade_no, sku: fresh.sku, status: fresh.status, paidAt: fresh.paid_at };
    }
    // 注意：alipay provider 没有 simulateBuyerConfirm —— 付款只能由用户在支付宝完成
  };
}

export async function createPaymentProvider({ store, db }: { store?: any; db?: any }): Promise<any> {
  const paymentStore = store || createSqlitePaymentStore(db);
  const useOkx = !!(
    process.env.OKX_API_KEY
    && process.env.OKX_API_SECRET
    && process.env.OKX_API_PASSPHRASE
  );
  if (useOkx) {
    try {
      const provider = await createOkxProvider({ store: paymentStore });
      console.log(
        `[payments] OKX provider 已启用（${process.env.OKX_PAYMENT_CURRENCY || 'USDT'} / `
        + `${process.env.OKX_PAYMENT_CHAIN || 'USDT-TRC20'}）`
      );
      return provider;
    } catch (err: any) {
      console.warn(`[payments] OKX 初始化失败，继续检查其他 provider：${err.message}`);
    }
  }
  const useAlipay = !!(process.env.ALIPAY_APP_ID && process.env.ALIPAY_PRIVATE_KEY);
  if (useAlipay) {
    try {
      const provider = await createAlipayProvider({ store: paymentStore });
      const env = process.env.ALIPAY_ENDPOINT?.includes('sandbox') ? '沙箱' : '生产';
      console.log(`[payments] Alipay provider 已启用（${env}，APP_ID=${process.env.ALIPAY_APP_ID}）`);
      return provider;
    } catch (err: any) {
      // 半配置 / 缺依赖 / 密钥错不应让服务起不来：回退 mock 并告警
      console.warn(`[payments] Alipay 初始化失败，回退 mock provider：${err.message}`);
      return createMockProvider({ store: paymentStore });
    }
  }
  console.log('[payments] 未配置可用的 OKX/ALIPAY provider，使用 mock provider（零资金演示）');
  return createMockProvider({ store: paymentStore });
}
