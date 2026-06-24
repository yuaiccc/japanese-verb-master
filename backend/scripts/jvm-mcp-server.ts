#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const DEFAULT_BASE_URL = 'http://127.0.0.1:3456';

export const toolNames: string[] = [
  'ask_japanese_verb_master',
  'japanese_verb_master_health'
];

export function getBaseUrl(): string {
  return String(process.env.JVM_AGENT_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');
}

export async function callBackendAgent({ message, context = {} }: any): Promise<any> {
  const normalized = String(message || '').trim();
  if (!normalized) {
    throw new Error('message is required.');
  }

  const response = await fetch(`${getBaseUrl()}/api/agent/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: normalized,
      context: {
        channel: 'openclaw-mcp',
        source: 'japanese-verb-master-mcp',
        ...context
      }
    })
  });
  const data: any = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `Backend returned HTTP ${response.status}.`);
  }
  return data;
}

export async function checkHealth(): Promise<any> {
  const response = await fetch(`${getBaseUrl()}/api/llm-settings`);
  if (!response.ok) {
    throw new Error(`Backend returned HTTP ${response.status}.`);
  }
  const data = await response.json().catch(() => ({}));
  return {
    ok: true,
    baseUrl: getBaseUrl(),
    llm: data
  };
}

function asTextResult(payload: any): any {
  return {
    content: [
      {
        type: 'text',
        text: typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2)
      }
    ]
  };
}

export function createJapaneseVerbMasterMcpServer(): any {
  const server = new McpServer({
    name: 'japanese-verb-master',
    version: '1.0.0'
  });

  server.registerTool(
    'ask_japanese_verb_master',
    {
      title: 'Ask Japanese Verb Master',
      description: 'Ask the local Japanese Verb Master Agent for Japanese grammar, vocabulary, conjugation, and learning advice.',
      inputSchema: {
        message: z.string().min(1).describe('User question, preferably in Chinese or Japanese.'),
        context: z.record(z.string(), z.unknown()).optional().describe('Optional Agent context passed through to the backend.')
      }
    },
    async ({ message, context = {} }: any) => {
      const result = await callBackendAgent({ message, context });
      return asTextResult({
        answer: result.answer || '',
        toolCalls: result.toolCalls || []
      });
    }
  );

  server.registerTool(
    'japanese_verb_master_health',
    {
      title: 'Japanese Verb Master Health',
      description: 'Check whether the local Japanese Verb Master backend is reachable.',
      inputSchema: {}
    },
    async () => asTextResult(await checkHealth())
  );

  return server;
}

export async function startServer(): Promise<void> {
  const server = createJapaneseVerbMasterMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

const currentFile = fileURLToPath(import.meta.url);
const entryFile = process.argv[1] ? path.resolve(process.argv[1]) : '';

if (currentFile === entryFile) {
  startServer().catch((error: any) => {
    console.error(error);
    process.exit(1);
  });
}
