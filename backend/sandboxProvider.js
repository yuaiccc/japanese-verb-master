import { getSubagentSandboxPolicy } from './sandboxPolicies.js';

function pickContextSlice(context = {}, exposedContextKeys = []) {
  if (!context || exposedContextKeys.length === 0) return {};
  return Object.fromEntries(
    exposedContextKeys
      .filter(key => Object.prototype.hasOwnProperty.call(context, key))
      .map(key => [key, context[key]])
  );
}

class LocalSubagentSandbox {
  constructor({ subagentId, policy, context = {} }) {
    this.subagentId = subagentId;
    this.policy = policy;
    this.createdAt = Date.now();
    this.id = `local:${subagentId}:${this.createdAt}`;
    this.context = pickContextSlice(context, policy.exposedContextKeys || []);
    this.toolCalls = [];
  }

  describe() {
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

  canUseTool(name = '') {
    return (this.policy.allowedTools || []).includes(name);
  }

  sanitizeContext() {
    return this.context;
  }

  filterPlannedTools(plannedTools = []) {
    const allowed = plannedTools.filter(tool => this.canUseTool(tool.name));
    return allowed.slice(0, this.policy.maxToolCalls || allowed.length);
  }

  recordToolCall(toolRecord) {
    this.toolCalls.push({
      name: toolRecord.name,
      arguments: toolRecord.arguments || {},
      result: toolRecord.result || '',
      error: !!toolRecord.error
    });
  }

  clampResult(text = '') {
    const value = String(text || '');
    const maxChars = this.policy.maxResultChars || 1200;
    return value.length > maxChars ? `${value.slice(0, maxChars)}...` : value;
  }
}

export class LocalSandboxProvider {
  acquire(subagentId, { context = {} } = {}) {
    const policy = getSubagentSandboxPolicy(subagentId);
    return new LocalSubagentSandbox({
      subagentId,
      policy,
      context
    });
  }
}

let sandboxProvider = new LocalSandboxProvider();

export function getSandboxProvider() {
  return sandboxProvider;
}

export function setSandboxProvider(provider) {
  sandboxProvider = provider;
}
