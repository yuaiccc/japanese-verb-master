import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createJapaneseVerbMasterMcpServer,
  getBaseUrl,
  toolNames
} from '../scripts/jvm-mcp-server';

test('jvm mcp server exposes expected tool names', () => {
  assert.deepEqual(toolNames, [
    'ask_japanese_verb_master',
    'japanese_verb_master_health'
  ]);
});

test('jvm mcp server can be constructed with official sdk', () => {
  const server = createJapaneseVerbMasterMcpServer();
  assert.equal(server.isConnected(), false);
});

test('getBaseUrl normalizes trailing slashes', () => {
  const oldValue = process.env.JVM_AGENT_BASE_URL;
  process.env.JVM_AGENT_BASE_URL = 'http://127.0.0.1:3456///';
  assert.equal(getBaseUrl(), 'http://127.0.0.1:3456');
  if (oldValue === undefined) {
    delete process.env.JVM_AGENT_BASE_URL;
  } else {
    process.env.JVM_AGENT_BASE_URL = oldValue;
  }
});
