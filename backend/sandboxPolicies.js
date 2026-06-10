export const subagentSandboxPolicies = {
  researcher: {
    id: 'researcher',
    label: 'Researcher Sandbox',
    allowedTools: ['knowledge_search', 'external_search', 'lookup_word', 'recommend_similar', 'memory_status'],
    exposedContextKeys: ['lookup', 'memoryStats', 'userProfile', 'exampleDifficulty', 'conversation', 'compactSummary'],
    maxToolCalls: 7,
    allowNetwork: true,
    allowMemoryWrite: false,
    maxResultChars: 1400
  },
  example_designer: {
    id: 'example_designer',
    label: 'Example Designer Sandbox',
    allowedTools: [],
    exposedContextKeys: ['lookup', 'userProfile', 'exampleDifficulty', 'compactSummary'],
    maxToolCalls: 0,
    allowNetwork: false,
    allowMemoryWrite: false,
    maxResultChars: 600
  },
  practice_coach: {
    id: 'practice_coach',
    label: 'Practice Coach Sandbox',
    allowedTools: [],
    exposedContextKeys: ['lookup', 'userProfile', 'memoryStats', 'exampleDifficulty', 'compactSummary'],
    maxToolCalls: 0,
    allowNetwork: false,
    allowMemoryWrite: false,
    timeoutMs: 12000,
    maxCompletionTokens: 500,
    maxResultChars: 600
  },
  tutor: {
    id: 'tutor',
    label: 'Tutor Sandbox',
    allowedTools: [],
    exposedContextKeys: ['lookup', 'memoryStats', 'userProfile', 'exampleDifficulty', 'conversation', 'compactSummary'],
    maxToolCalls: 0,
    allowNetwork: true,
    allowMemoryWrite: false,
    timeoutMs: 30000,
    maxCompletionTokens: 1700,
    maxResultChars: 6000
  },
  memory_manager: {
    id: 'memory_manager',
    label: 'Memory Manager Sandbox',
    allowedTools: ['memory_status'],
    exposedContextKeys: ['memoryStats', 'userProfile', 'exampleDifficulty', 'compactSummary'],
    maxToolCalls: 2,
    allowNetwork: false,
    allowMemoryWrite: false,
    timeoutMs: 10000,
    maxCompletionTokens: 400,
    maxResultChars: 1200
  }
};

export function getSubagentSandboxPolicy(subagentId = '') {
  return subagentSandboxPolicies[subagentId] || {
    id: subagentId || 'default',
    label: 'Default Sandbox',
    allowedTools: [],
    exposedContextKeys: [],
    maxToolCalls: 0,
    allowNetwork: false,
    allowMemoryWrite: false,
    timeoutMs: 10000,
    maxCompletionTokens: 600,
    maxResultChars: 800
  };
}
