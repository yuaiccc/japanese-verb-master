import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildFeishuAgentContext,
  createFeishuClient,
  createFeishuEventDispatcher,
  createFeishuLongConnection,
  createRecentEventDedupe,
  parseFeishuTextMessage
} from '../integrations/feishu';

test('parseFeishuTextMessage parses v2 text message events', () => {
  const parsed = parseFeishuTextMessage({
    header: {
      event_id: 'evt-1',
      event_type: 'im.message.receive_v1',
      tenant_key: 'tenant-1'
    },
    event: {
      sender: {
        sender_type: 'user',
        sender_id: {
          open_id: 'ou_xxx',
          union_id: 'on_xxx',
          user_id: 'u_xxx'
        }
      },
      message: {
        message_id: 'om_xxx',
        chat_id: 'oc_xxx',
        chat_type: 'p2p',
        message_type: 'text',
        content: JSON.stringify({ text: 'て形是什么？' })
      }
    }
  });

  assert.equal(parsed!.eventId, 'evt-1');
  assert.equal(parsed!.messageId, 'om_xxx');
  assert.equal(parsed!.text, 'て形是什么？');
  assert.equal(parsed!.sender.unionId, 'on_xxx');
});

test('buildFeishuAgentContext maps platform ids into a stable Agent context', () => {
  const context = buildFeishuAgentContext({
    messageId: 'om_xxx',
    chatId: 'oc_xxx',
    chatType: 'p2p',
    sender: { unionId: 'on_xxx', openId: 'ou_xxx', userId: '' }
  } as any);

  assert.equal(context.channel, 'feishu');
  assert.equal(context.sessionId, 'oc_xxx');
  assert.equal(context.platformUserId, 'on_xxx');
  assert.equal(context.userProfile.channel, 'feishu');
});

test('createRecentEventDedupe rejects duplicate event ids', () => {
  const shouldProcess = createRecentEventDedupe();
  assert.equal(shouldProcess('evt-1'), true);
  assert.equal(shouldProcess('evt-1'), false);
  assert.equal(shouldProcess('evt-2'), true);
});

test('createFeishuClient obtains tenant token and sends text replies', async () => {
  const calls: any[] = [];
  const fetchImpl = async (url: any, options: any) => {
    calls.push({ url, options });
    if (String(url).includes('/auth/v3/tenant_access_token/internal')) {
      return {
        ok: true,
        json: async () => ({ code: 0, tenant_access_token: 'tenant-token', expire: 7200 })
      };
    }
    return {
      ok: true,
      json: async () => ({ code: 0, data: { message_id: 'reply-id' } })
    };
  };

  const client = createFeishuClient({
    appId: 'app-id',
    appSecret: 'app-secret',
    apiBase: 'https://example.test/open-apis',
    fetchImpl: fetchImpl as any
  });
  await client.replyText('om_xxx', '你好');

  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /tenant_access_token/);
  assert.equal(JSON.parse(calls[0].options.body).app_id, 'app-id');
  assert.match(calls[1].url, /\/im\/v1\/messages\/om_xxx\/reply$/);
  assert.equal(calls[1].options.headers.Authorization, 'Bearer tenant-token');
  assert.equal(JSON.parse(JSON.parse(calls[1].options.body).content).text, '你好');
});

test('createFeishuEventDispatcher forwards text message events', async () => {
  const received: any[] = [];
  class FakeEventDispatcher {
    handlers: any;
    constructor() {
      this.handlers = {};
    }

    register(handlers: any) {
      this.handlers = handlers;
      return this;
    }
  }

  const dispatcher = createFeishuEventDispatcher({ EventDispatcher: FakeEventDispatcher }, async (parsed) => {
    received.push(parsed);
  });

  await dispatcher.handlers['im.message.receive_v1']({
    header: { event_id: 'evt-ws-1' },
    event: {
      sender: { sender_id: { open_id: 'ou_ws' } },
      message: {
        message_id: 'om_ws',
        chat_id: 'oc_ws',
        chat_type: 'p2p',
        message_type: 'text',
        content: JSON.stringify({ text: 'ます形是什么？' })
      }
    }
  });

  assert.equal(received.length, 1);
  assert.equal(received[0].messageId, 'om_ws');
  assert.equal(received[0].text, 'ます形是什么？');
});

test('createFeishuLongConnection starts official SDK websocket client', async () => {
  const calls: any[] = [];
  class FakeEventDispatcher {
    register(handlers: any) {
      calls.push({ type: 'register', handlers });
      return { handlers };
    }
  }

  class FakeWSClient {
    constructor(options: any) {
      calls.push({ type: 'construct', options });
    }

    async start(options: any) {
      calls.push({ type: 'start', options });
    }

    async stop() {
      calls.push({ type: 'stop' });
    }
  }

  const connection = await createFeishuLongConnection({
    appId: 'cli_xxx',
    appSecret: 'secret',
    sdkLoader: async () => ({ EventDispatcher: FakeEventDispatcher, WSClient: FakeWSClient }),
    onMessage: async () => {}
  });

  await connection.start();
  await connection.stop();

  assert.equal(calls[0].type, 'construct');
  assert.equal(calls[0].options.appId, 'cli_xxx');
  assert.equal(calls[0].options.appSecret, 'secret');
  assert.deepEqual(calls[0].options.wsConfig, { PingInterval: 30, PingTimeout: 3 });
  assert.equal(calls[1].type, 'register');
  assert.equal(typeof calls[1].handlers['im.message.receive_v1'], 'function');
  assert.equal(calls[2].type, 'start');
  assert.equal(calls[3].type, 'stop');
});
