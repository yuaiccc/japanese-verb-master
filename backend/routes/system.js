// 系统路由：从 server.js 抽离，逻辑保持不变。
// 包含健康检查、LLM 设置、飞书 webhook、认证、支付等路由。
// 所有依赖通过 registerSystemRoutes(app, deps) 的 deps 参数注入。

import { parseFeishuTextMessage } from '../integrations/feishu.js';

export function registerSystemRoutes(app, deps) {
  const {
    registerLimiter,
    guestLimiter,
    loginLimiter,
    getTurnstileConfig,
    verifyTurnstileToken,
    userStore,
    hashPassword,
    verifyPassword,
    signToken,
    SKUS,
    paymentProvider,
    getTokenizer,
    getRuntimeLlmSettings,
    saveLlmSettings,
    fetchHotPlaceholderExamples,
    defaultHotPlaceholderExamples,
    verifyFeishuToken,
    shouldProcessFeishuEvent,
    processFeishuMessage,
    feishuClient
  } = deps;

  // 注册：用户名 + 密码，scrypt 哈希
  app.get('/api/auth/captcha-config', (_req, res) => {
    res.json(getTurnstileConfig());
  });

  app.post('/api/auth/guest', guestLimiter, async (req, res) => {
    if (req.isAuthed || req.isGuest) {
      return res.json({ token: req.headers.authorization?.slice(7) || '', guest: req.isGuest });
    }
    try {
      const guest = await userStore.createGuestUser();
      res.status(201).json({ token: signToken(guest.id, { guest: true }), guest: true });
    } catch (error) {
      console.error('[auth] guest identity failed:', error);
      res.status(500).json({ error: '访客身份初始化失败' });
    }
  });

  app.post('/api/auth/register', registerLimiter, async (req, res) => {
    const username = String(req.body?.username || '').trim();
    const password = String(req.body?.password || '');
    if (username.length < 2 || username.length > 32) {
      return res.status(400).json({ error: '用户名需 2-32 个字符' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: '密码至少 6 位' });
    }
    if (username === '__default__') {
      return res.status(400).json({ error: '该用户名不可用' });
    }
    try {
      const captcha = await verifyTurnstileToken({
        token: req.body?.captchaToken,
        remoteIp: req.ip,
        expectedHostname: process.env.TURNSTILE_EXPECTED_HOSTNAME || req.hostname,
        expectedAction: 'register'
      });
      if (!captcha.success) {
        return res.status(403).json({ error: '人机验证失败，请刷新后重试', code: 'captcha_failed' });
      }
      const exists = await userStore.findUserByUsername(username);
      if (exists) {
        return res.status(409).json({ error: '用户名已被占用' });
      }
      const passwordHash = hashPassword(password);
      const user = req.isGuest
        ? await userStore.claimGuestUser(req.userId, username, passwordHash)
        : await userStore.createUser(username, passwordHash);
      if (!user) {
        return res.status(409).json({ error: '访客身份已失效，请刷新后重试' });
      }
      res.status(201).json({ token: signToken(user.id), user });
    } catch (error) {
      if (error?.code === '23505' || String(error?.message || '').includes('UNIQUE')) {
        return res.status(409).json({ error: '用户名已被占用' });
      }
      console.error('[auth] register failed:', error);
      res.status(500).json({ error: '注册失败，请稍后重试' });
    }
  });

  // 登录
  app.post('/api/auth/login', loginLimiter, async (req, res) => {
    const username = String(req.body?.username || '').trim();
    const password = String(req.body?.password || '');
    try {
      const row = await userStore.findUserByUsername(username);
      if (!row || !verifyPassword(password, row.password_hash)) {
        return res.status(401).json({ error: '用户名或密码错误' });
      }
      res.json({ token: signToken(row.id), user: { id: row.id, username: row.username } });
    } catch (error) {
      console.error('[auth] login failed:', error);
      res.status(500).json({ error: '登录失败，请稍后重试' });
    }
  });

  // 当前用户：未登录返回 null（前端据此显示登录入口）
  app.get('/api/auth/me', async (req, res) => {
    if (req.isGuest) return res.json({ user: null, guest: true });
    if (!req.isAuthed) return res.json({ user: null });
    try {
      const row = await userStore.findUserById(req.userId);
      res.json({ user: row || null });
    } catch (error) {
      res.status(500).json({ error: '读取用户失败' });
    }
  });

  // === 支付（A2A demo：应用发起订单，资金确认权在用户）===
  app.get('/api/entitlements', async (req, res) => {
    try {
      const entitlements = {};
      for (const def of Object.values(SKUS)) {
        entitlements[def.entitlement] = await userStore.hasEntitlement(def.entitlement, req.userId);
      }
      res.json({ provider: paymentProvider.name, entitlements });
    } catch (error) {
      res.status(500).json({ error: 'Failed to load entitlements' });
    }
  });

  app.post('/api/payments/orders', async (req, res) => {
    const skuDef = SKUS[req.body?.sku];
    if (!skuDef) return res.status(400).json({ error: 'Unknown sku' });
    if (await userStore.hasEntitlement(skuDef.entitlement, req.userId)) {
      return res.status(409).json({ error: 'Already unlocked' });
    }
    try {
      const order = await paymentProvider.createOrder(skuDef, req.userId);
      res.status(201).json({ provider: paymentProvider.name, ...order });
    } catch (error) {
      res.status(502).json({ error: error.message });
    }
  });

  app.get('/api/payments/orders/:outTradeNo', async (req, res) => {
    try {
      const order = await paymentProvider.queryOrder(req.params.outTradeNo, req.userId);
      if (!order) return res.status(404).json({ error: 'Order not found' });
      res.json(order);
    } catch (error) {
      res.status(502).json({ error: error.message });
    }
  });

  app.post('/api/payments/orders/:outTradeNo/txid', async (req, res) => {
    if (typeof paymentProvider.submitTransaction !== 'function') {
      return res.status(404).json({ error: 'Not available for this provider' });
    }
    try {
      const result = await paymentProvider.submitTransaction(
        req.params.outTradeNo,
        req.body?.txId,
        req.userId
      );
      if (!result.ok) return res.status(result.status || 400).json({ error: result.error });
      res.json(result.order);
    } catch (error) {
      res.status(502).json({ error: error.message });
    }
  });

  // 仅 mock provider：模拟用户在支付宝 App 完成扫码 + 密码确认
  app.post('/api/payments/orders/:outTradeNo/simulate-confirm', async (req, res) => {
    try {
      if (typeof paymentProvider.simulateBuyerConfirm !== 'function') {
        return res.status(404).json({ error: 'Not available for this provider' });
      }
      const result = await paymentProvider.simulateBuyerConfirm(req.params.outTradeNo, req.userId);
      if (!result.ok) return res.status(404).json({ error: result.error });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 健康检查
  app.get('/health', (req, res) => {
    res.json({ status: 'ok', dictionaryReady: !!getTokenizer() });
  });

  app.get('/api/llm-status', (req, res) => {
    const settings = getRuntimeLlmSettings();
    res.json({
      provider: settings.provider,
      model: settings.model,
      baseUrl: settings.baseUrl,
      apiKeySet: settings.apiKeySet
    });
  });

  app.get('/api/hot-placeholders', async (req, res) => {
    try {
      const data = await fetchHotPlaceholderExamples(String(req.query.force || '') === '1');
      res.json({
        source: data.source,
        updatedAt: data.updatedAt,
        examples: data.examples
      });
    } catch (error) {
      res.status(500).json({
        source: 'fallback',
        updatedAt: Date.now(),
        examples: [...defaultHotPlaceholderExamples]
      });
    }
  });

  app.get('/api/llm-settings', (req, res) => {
    res.json(getRuntimeLlmSettings());
  });

  app.post('/api/llm-settings', (req, res) => {
    try {
      res.json(saveLlmSettings(req.body || {}));
    } catch (error) {
      res.status(500).json({ error: 'Failed to save LLM settings.' });
    }
  });

  app.post('/api/integrations/feishu/webhook', (req, res) => {
    const payload = req.body || {};

    if (payload.type === 'url_verification') {
      if (!verifyFeishuToken(payload)) {
        return res.status(403).json({ error: 'Invalid Feishu verification token.' });
      }
      return res.json({ challenge: payload.challenge });
    }

    if (!verifyFeishuToken(payload)) {
      return res.status(403).json({ error: 'Invalid Feishu verification token.' });
    }

    const parsed = parseFeishuTextMessage(payload);
    if (!parsed) {
      return res.json({ ok: true, ignored: true, reason: 'not_text_message' });
    }
    if (!shouldProcessFeishuEvent(parsed.eventId || parsed.messageId)) {
      return res.json({ ok: true, ignored: true, reason: 'duplicate_event' });
    }

    res.json({ ok: true, accepted: true });
    processFeishuMessage(parsed, { dedupe: false }).catch((error) => {
      console.error('[feishu] failed to process message:', error);
      feishuClient.replyText(parsed.messageId, `处理失败：${error.message || '未知错误'}`).catch((replyError) => {
        console.error('[feishu] failed to send error reply:', replyError);
      });
    });
  });
}
