const FEISHU_OPEN_API = 'https://open.feishu.cn/open-apis';

export const FEISHU_CONNECTION_MODES = {
  WEBSOCKET: 'websocket',
  WEBHOOK: 'webhook',
  DISABLED: 'disabled'
};

interface ParsedFeishuMessage {
  eventId: string;
  eventType: string;
  tenantKey: string;
  messageId: string;
  chatId: string;
  chatType: string;
  text: string;
  sender: {
    openId: string;
    unionId: string;
    userId: string;
    senderType: string;
  };
}

export function parseFeishuTextMessage(payload: any = {}): ParsedFeishuMessage | null {
  const event = payload.event || {};
  const message = event.message || {};
  if (!message.message_id || message.message_type !== 'text') return null;

  let content: any = {};
  try {
    content = JSON.parse(message.content || '{}');
  } catch {
    content = {};
  }

  const senderId = event.sender?.sender_id || {};
  const text = String(content.text || '').trim();
  if (!text) return null;

  return {
    eventId: payload.header?.event_id || '',
    eventType: payload.header?.event_type || '',
    tenantKey: payload.header?.tenant_key || '',
    messageId: message.message_id,
    chatId: message.chat_id || '',
    chatType: message.chat_type || '',
    text,
    sender: {
      openId: senderId.open_id || '',
      unionId: senderId.union_id || '',
      userId: senderId.user_id || '',
      senderType: event.sender?.sender_type || ''
    }
  };
}

export function buildFeishuAgentContext(parsed: ParsedFeishuMessage): any {
  return {
    channel: 'feishu',
    platform: 'feishu',
    sessionId: parsed.chatId || parsed.messageId,
    threadId: parsed.chatId || parsed.messageId,
    platformMessageId: parsed.messageId,
    platformUserId: parsed.sender.unionId || parsed.sender.openId || parsed.sender.userId || '',
    chatType: parsed.chatType,
    userProfile: {
      channel: 'feishu',
      platformUserId: parsed.sender.unionId || parsed.sender.openId || parsed.sender.userId || '',
      note: '来自飞书入口的用户。'
    }
  };
}

interface FeishuClientOptions {
  appId?: string;
  appSecret?: string;
  apiBase?: string;
  fetchImpl?: typeof fetch;
}

export function createFeishuClient({
  appId = process.env.FEISHU_APP_ID || '',
  appSecret = process.env.FEISHU_APP_SECRET || '',
  apiBase = FEISHU_OPEN_API,
  fetchImpl = globalThis.fetch
}: FeishuClientOptions = {}): any {
  let cachedToken = '';
  let tokenExpiresAt = 0;

  async function getTenantAccessToken(): Promise<string> {
    if (cachedToken && Date.now() < tokenExpiresAt - 60_000) return cachedToken;
    if (!appId || !appSecret) {
      throw new Error('FEISHU_APP_ID / FEISHU_APP_SECRET is not configured');
    }
    const response = await fetchImpl(`${apiBase}/auth/v3/tenant_access_token/internal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: appId, app_secret: appSecret })
    });
    const data: any = await response.json().catch(() => ({}));
    if (!response.ok || data.code !== 0 || !data.tenant_access_token) {
      throw new Error(`Feishu tenant token failed: ${data.msg || response.status}`);
    }
    cachedToken = data.tenant_access_token;
    tokenExpiresAt = Date.now() + Math.max(60, Number(data.expire) || 7200) * 1000;
    return cachedToken;
  }

  async function replyText(messageId: string, text: string): Promise<any> {
    const token = await getTenantAccessToken();
    const response = await fetchImpl(`${apiBase}/im/v1/messages/${encodeURIComponent(messageId)}/reply`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        msg_type: 'text',
        content: JSON.stringify({ text })
      })
    });
    const data: any = await response.json().catch(() => ({}));
    if (!response.ok || data.code !== 0) {
      throw new Error(`Feishu reply failed: ${data.msg || response.status}`);
    }
    return data;
  }

  return { getTenantAccessToken, replyText };
}

interface FeishuEventDispatcherOptions {
  verificationToken?: string;
  encryptKey?: string;
}

export function createFeishuEventDispatcher(sdk: any, onMessage: (parsed: ParsedFeishuMessage) => Promise<void> | void, {
  verificationToken = process.env.FEISHU_VERIFICATION_TOKEN || '',
  encryptKey = process.env.FEISHU_ENCRYPT_KEY || ''
}: FeishuEventDispatcherOptions = {}): any {
  if (!sdk?.EventDispatcher) {
    throw new Error('Feishu SDK does not expose EventDispatcher.');
  }
  if (typeof onMessage !== 'function') {
    throw new Error('onMessage must be a function.');
  }

  const dispatcher = new sdk.EventDispatcher({
    verificationToken: verificationToken || undefined,
    encryptKey: encryptKey || undefined
  });
  return dispatcher.register({
    'im.message.receive_v1': async (event: any) => {
      const parsed = parseFeishuTextMessage(event);
      if (!parsed) return;
      await onMessage(parsed);
    }
  });
}

export async function loadFeishuSdk(): Promise<any> {
  try {
    return await import('@larksuiteoapi/node-sdk');
  } catch (error: any) {
    const wrapped = new Error(
      'Feishu long connection requires @larksuiteoapi/node-sdk. Run `npm install @larksuiteoapi/node-sdk` in backend/.'
    );
    wrapped.cause = error;
    throw wrapped;
  }
}

interface FeishuLongConnectionOptions {
  appId?: string;
  appSecret?: string;
  domain?: string;
  sdkLoader?: () => Promise<any>;
  onMessage?: (parsed: ParsedFeishuMessage) => Promise<void> | void;
}

export async function createFeishuLongConnection({
  appId = process.env.FEISHU_APP_ID || '',
  appSecret = process.env.FEISHU_APP_SECRET || '',
  domain = process.env.FEISHU_DOMAIN || 'feishu',
  sdkLoader = loadFeishuSdk,
  onMessage
}: FeishuLongConnectionOptions = {}): Promise<any> {
  if (!appId || !appSecret) {
    throw new Error('FEISHU_APP_ID / FEISHU_APP_SECRET is not configured.');
  }

  const sdk = await sdkLoader();
  if (!sdk?.WSClient) {
    throw new Error('Feishu SDK does not expose WSClient.');
  }

  const sdkDomain = domain === 'lark'
    ? sdk.Domain?.Lark
    : domain === 'feishu'
      ? sdk.Domain?.Feishu
      : domain;
  const wsClient = new sdk.WSClient({
    appId,
    appSecret,
    domain: sdkDomain || undefined,
    loggerLevel: sdk.LoggerLevel?.info,
    wsConfig: {
      PingInterval: 30,
      PingTimeout: 3
    }
  });
  const eventDispatcher = createFeishuEventDispatcher(sdk, onMessage || (() => {}));

  return {
    async start(): Promise<void> {
      await wsClient.start({ eventDispatcher });
    },
    async stop(): Promise<void> {
      if (typeof wsClient.stop === 'function') {
        await wsClient.stop();
      }
    },
    wsClient,
    eventDispatcher
  };
}

export function createRecentEventDedupe({ ttlMs = 10 * 60 * 1000, maxSize = 1000 }: { ttlMs?: number; maxSize?: number } = {}): (eventId: string) => boolean {
  const seen = new Map<string, number>();
  return function shouldProcess(eventId: string): boolean {
    const now = Date.now();
    for (const [key, ts] of seen) {
      if (now - ts > ttlMs) seen.delete(key);
    }
    const key = String(eventId || '').trim();
    if (!key) return true;
    if (seen.has(key)) return false;
    seen.set(key, now);
    if (seen.size > maxSize) {
      const oldest = seen.keys().next().value;
      if (oldest) seen.delete(oldest);
    }
    return true;
  };
}
