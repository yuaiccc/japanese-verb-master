import { getSubagentSandboxPolicy } from './sandboxPolicies';
import type { SandboxPolicy } from './sandboxPolicies';

function pickContextSlice(context: Record<string, any> = {}, exposedContextKeys: string[] = []): Record<string, any> {
  if (!context || exposedContextKeys.length === 0) return {};
  return Object.fromEntries(
    exposedContextKeys
      .filter(key => Object.prototype.hasOwnProperty.call(context, key))
      .map(key => [key, context[key]])
  );
}

interface ToolRecord {
  name: string;
  arguments?: Record<string, any>;
  result?: string;
  error?: boolean;
}

class LocalSubagentSandbox {
  subagentId: string;
  policy: SandboxPolicy;
  createdAt: number;
  id: string;
  context: Record<string, any>;
  toolCalls: ToolRecord[];

  constructor({ subagentId, policy, context = {} }: { subagentId: string; policy: SandboxPolicy; context?: Record<string, any> }) {
    this.subagentId = subagentId;
    this.policy = policy;
    this.createdAt = Date.now();
    this.id = `local:${subagentId}:${this.createdAt}`;
    this.context = pickContextSlice(context, policy.exposedContextKeys || []);
    this.toolCalls = [];
  }

  describe(): Record<string, any> {
    return {
      sandboxId: this.id,
      provider: 'local-sandbox',
      policy: this.policy.id,
      toolCount: this.toolCalls.length,
      allowNetwork: !!this.policy.allowNetwork,
      timeoutMs: this.policy.timeoutMs || null,
      maxCompletionTokens: this.policy.maxCompletionTokens || null,
      exposedContextKeys: this.policy.exposedContextKeys || []
    };
  }

  canUseTool(name: string = ''): boolean {
    return (this.policy.allowedTools || []).includes(name);
  }

  sanitizeContext(): Record<string, any> {
    return this.context;
  }

  filterPlannedTools(plannedTools: any[] = []): any[] {
    const allowed = plannedTools.filter(tool => this.canUseTool(tool.name));
    return allowed.slice(0, this.policy.maxToolCalls || allowed.length);
  }

  recordToolCall(toolRecord: ToolRecord): void {
    this.toolCalls.push({
      name: toolRecord.name,
      arguments: toolRecord.arguments || {},
      result: toolRecord.result || '',
      error: !!toolRecord.error
    });
  }

  clampResult(text: string = ''): string {
    const value = String(text || '');
    const maxChars = this.policy.maxResultChars || 1200;
    return value.length > maxChars ? `${value.slice(0, maxChars)}...` : value;
  }
}

export class LocalSandboxProvider {
  acquire(subagentId: string, { context = {} }: { context?: Record<string, any> } = {}): LocalSubagentSandbox {
    const policy = getSubagentSandboxPolicy(subagentId);
    return new LocalSubagentSandbox({
      subagentId,
      policy,
      context
    });
  }
}

let sandboxProvider: LocalSandboxProvider = new LocalSandboxProvider();

export function getSandboxProvider(): LocalSandboxProvider {
  return sandboxProvider;
}

export function setSandboxProvider(provider: LocalSandboxProvider): void {
  sandboxProvider = provider;
}
