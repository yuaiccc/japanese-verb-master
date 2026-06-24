import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import axios from 'axios';
import { marked } from 'marked';

// === 常量 ===
const defaultAgentPlaceholderExamples = [
  '问日语：食べる 和 召し上がる 有什么区别',
  '问日语：为什么 〜ている 有时表示状态',
  '问日语：给我 3 个便利店场景例句',
  '问日语：把 猫 翻成日语并推荐相近词'
];

const defaultAgentQueue = [
  { id: 'planner', label: 'Planner', description: '拆解学习任务与工具路线', status: 'queued' },
  { id: 'researcher', label: 'Researcher', description: '调用词典、搜索和相似词工具', status: 'queued' },
  { id: 'tutor', label: 'Tutor', description: '流式组织解释、例句和练习', status: 'queued' },
  { id: 'memory_manager', label: 'Memory Manager', description: '刷新记忆队列与复习上下文', status: 'queued' }
];

const optionLabels = ['A', 'B', 'C', 'D'];

const componentHighlightClassMap = {
  主题: 'is-topic',
  主语: 'is-subject',
  宾语: 'is-object',
  谓语: 'is-predicate',
  补足: 'is-support',
  时间: 'is-time',
  地点: 'is-location',
  '地点/方式': 'is-location',
  '方式/场所': 'is-location',
  方向: 'is-direction',
  '对象/并列': 'is-support',
  '起点/原因': 'is-support',
  终点: 'is-support',
  比较基准: 'is-support',
  补语: 'is-support',
  追加主题: 'is-topic'
};

// 首屏快捷示例：短标签 + 实际发送的完整提问
const heroChips = [
  { label: '食べる 的活用', prompt: '问日语：食べる 的全部活用形式', icon: 'dictionary' },
  { label: '〜ている 的用法', prompt: '问日语：为什么 〜ている 有时表示状态', icon: 'book' },
  { label: '便利店场景例句', prompt: '问日语：给我 3 个便利店场景例句', icon: 'chat' },
  { label: '把「猫」翻成日语', prompt: '问日语：把 猫 翻成日语并推荐相近词', icon: 'sparkles' }
];

// === 模块级单例状态 ===
const agentThreadSummary = ref(null);
const agentThreadId = ref('');
const agentPlan = ref(null);
const similarWords = ref([]);
const agentLoading = ref(false);
const agentRunning = ref(false);
const agentInput = ref('');
const agentMessages = ref([]);
const agentRuns = ref([]);
const activeAgentRunId = ref(null);
const agentToolCalls = ref([]);
const agentTrace = ref([]); // 完整执行轨迹（上限 80 步），随 run 持久化，前端折叠展示
const agentMemoryCandidates = ref([]);
const agentExamples = ref([]);
const agentInteractivePractice = ref(null);
const agentFollowUpQuestions = ref([]);
const agentFollowUpLoading = ref(false);
const agentUsage = ref(null);
const agentPracticeInput = ref('');
const agentPracticeBusy = ref(false);
const agentPracticeHint = ref('');
const agentPracticeFeedback = ref(null);
const streamedAssistantText = ref('');
const agentAbortController = ref(null);
const agentPlaceholderExamples = ref([...defaultAgentPlaceholderExamples]);
const animatedAgentPlaceholder = ref(agentPlaceholderExamples.value[0]);
const agentRuntimeEngine = ref('LangGraph');
const agentQueue = ref(defaultAgentQueue.map(item => ({ ...item })));
const agentRuntimeNote = ref('');
const activeSubagentTaskId = ref('');
const activeExampleInspector = ref({});
const expandedCitations = ref(new Set());
const activeAgentSection = ref('');
const agentScrollProgress = ref(0);

// === 模块级 let 变量 ===
let agentRunSeq = 0;
let placeholderInterval = null;
let placeholderRefreshInterval = null;
let streamRenderQueue = '';
let streamRenderTimer = null;
let streamRenderDone = false;
let streamRenderDrainResolvers = [];
let agentScrollRaf = 0;

// === 外部依赖注入 ===
// 这些状态/函数不属于 useAgentStream 范围，由调用方通过 useAgentStream(deps) 注入。
const _deps = {
  result: ref(null),
  memoryStats: computed(() => ({})),
  userProfile: ref({}),
  memorySettings: ref({}),
  memoryCards: ref([]),
  normalizeMemoryCard: (card) => card,
  loadMemoryCards: async () => {},
  loadUserProfile: async () => {},
  refreshAgentPlan: async () => {},
  buildAuthHeaders: () => ({}),
  buildLlmHeaders: () => ({}),
  apiUrl: (path) => path,
  speak: () => {},
  prewarmSpeech: () => {},
  formatMemoryDueLabel: () => '',
  showLlmSettings: ref(false),
  showDropdown: ref(false),
  isComposing: ref(false),
  llmStatusLabel: ref(''),
  workbenchSection: ref('dict'),
  currentMode: ref('dict'),
};

// === 内部辅助函数 ===
const AUTH_TOKEN_KEY = 'jvm_auth_token';
const buildAuthHeaders = () => {
  const token = localStorage.getItem(AUTH_TOKEN_KEY);
  return token ? { Authorization: `Bearer ${token}` } : {};
};

const LLM_SETTINGS_KEY = 'jvm_llm_settings';
const readLocalLlmSettings = () => {
  try { return JSON.parse(localStorage.getItem(LLM_SETTINGS_KEY) || '{}'); }
  catch { return {}; }
};
const buildLlmHeaders = () => {
  const s = readLocalLlmSettings();
  if (!s.apiKey) return {};
  return {
    'X-LLM-API-Key': s.apiKey,
    ...(s.provider ? { 'X-LLM-Provider': s.provider } : {}),
    ...(s.baseUrl ? { 'X-LLM-Base-Url': s.baseUrl } : {}),
    ...(s.model ? { 'X-LLM-Model': s.model } : {})
  };
};

const apiUrl = (path) => `${import.meta.env.VITE_API_BASE || ''}${path}`;

// === 纯工具函数 ===
const escapeHtml = (value = '') => String(value || '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');

const stripMarkdownInline = (text) => {
  if (!text) return '';
  return String(text)
    .replace(/\|[-: ]+\|/g, ' ')
    .replace(/[|#*`~_>]+/g, ' ')
    .replace(/-{3,}/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
};

const renderMarkdown = (content) => {
  if (!content) return '';
  const html = marked.parse(content, {
    breaks: true,
    gfm: true
  });
  if (typeof window === 'undefined' || typeof DOMParser === 'undefined') return html;

  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script, iframe, object, embed, style, form, input, button').forEach(node => node.remove());
  doc.body.querySelectorAll('*').forEach((node) => {
    [...node.attributes].forEach((attr) => {
      const name = attr.name.toLowerCase();
      const value = attr.value.trim().toLowerCase();
      if (name.startsWith('on') || value.startsWith('javascript:') || value.startsWith('data:text/html') || value.startsWith('vbscript:') || value.startsWith('data:image/svg+xml')) {
        node.removeAttribute(attr.name);
      }
    });
  });
  return doc.body.innerHTML;
};

const compactText = (text, limit = 120) => {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  return value.length > limit ? `${value.slice(0, limit)}...` : value;
};

const formatToolArgs = (args = {}) => {
  const parsedArgs = typeof args === 'string'
    ? (() => {
        try {
          return JSON.parse(args);
        } catch {
          return { query: args };
        }
      })()
    : args;
  const text = Object.entries(parsedArgs || {})
    .map(([key, value]) => `${key}:${value}`)
    .join(' ');
  return text.length > 80 ? `${text.slice(0, 80)}...` : text || '无参数';
};

const parseToolPayload = (payload) => {
  if (!payload) return null;
  if (typeof payload !== 'string') return payload;
  try {
    return JSON.parse(payload);
  } catch {
    return payload;
  }
};

const formatToolResult = (call = {}) => {
  const data = parseToolPayload(call.result);
  if (!data) return '';

  if (call.name === 'knowledge_search') {
    const hits = Array.isArray(data.hits) ? data.hits : [];
    const parts = [`命中 ${data.hitCount ?? hits.length} 条`];
    if (data.rewritten) parts.push(`改写「${compactText(data.rewritten, 24)}」`);
    if (data.reranked) parts.push('已精排');
    if (data.degraded) parts.push('降级 BM25');
    if (hits[0]) parts.push(`首条：${hits[0].title}`);
    return parts.join(' · ');
  }

  if (call.name === 'lookup_word') {
    const item = data.source === 'local' ? data : data.result;
    if (!item) return '词典里没有找到明确条目';
    const word = item.kanji || item.word || call.arguments?.word || '';
    const reading = item.kana || item.reading || '';
    const meaning = item.meaning || item.meanings?.[0]?.definitions || '';
    return compactText([word, reading, meaning].filter(Boolean).join(' · '));
  }

  if (call.name === 'external_search') {
    const webCount = data.webResults?.length || 0;
    const dictCount = data.dictionaryResults?.length || 0;
    const sources = [
      ...new Set((data.webResults || []).map(item => item.source).filter(Boolean))
    ].slice(0, 3).join(' / ');
    return `找到 ${webCount} 条网页资料、${dictCount} 条词典资料${sources ? ` · ${sources}` : ''}`;
  }

  if (call.name === 'recommend_similar') {
    const words = Array.isArray(data)
      ? data.map(item => item.kanji || item.word).filter(Boolean).slice(0, 5)
      : [];
    return words.length ? `推荐：${words.join('、')}` : '没有找到足够相似词';
  }

  if (call.name === 'memory_status') {
    const memory = data.memory || {};
    return `记忆卡 ${memory.total || 0} 张 · 待复习 ${memory.due || 0} · 已稳定 ${memory.mastered || 0}`;
  }

  if (call.name === 'add_memory_card') {
    return data.ok ? '已加入记忆卡片' : '记忆卡片未更新';
  }

  if (typeof data === 'string') return compactText(data);
  return compactText(JSON.stringify(data));
};

const toolNameLabel = (name) => ({
  knowledge_search: '知识库检索',
  external_search: '外部搜索',
  lookup_word: '词典查询',
  recommend_similar: '相似词推荐',
  memory_status: '记忆状态',
  add_memory_card: '加入记忆卡'
}[name] || name);

// === 线程 / Run 管理 ===
const ensureAgentThreadId = () => {
  if (agentThreadId.value) return agentThreadId.value;
  const storageKey = 'jvm-agent-thread-id';
  let value = '';
  try {
    value = localStorage.getItem(storageKey) || '';
    if (!value) {
      value = `thread-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      localStorage.setItem(storageKey, value);
    }
  } catch (error) {
    value = `thread-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }
  agentThreadId.value = value;
  return value;
};

const buildAgentRunTitle = (text = '') => {
  const normalized = String(text || '')
    .replace(/\s+/g, ' ')
    .replace(/[？?！!。]+$/g, '')
    .trim();
  if (!normalized) return '新问题';
  const firstClause = normalized.split(/[，。！？；,.!?:：]/)[0]?.trim() || normalized;
  return firstClause.length > 18 ? `${firstClause.slice(0, 18)}…` : firstClause;
};

const syncAgentRun = (runId, patch = {}) => {
  const target = agentRuns.value.find(run => run.id === runId);
  if (!target) return;
  Object.assign(target, patch);
};

const normalizePersistedAgentRun = (run = {}) => ({
  id: run.runId,
  threadId: run.metadata?.threadId || '',
  title: run.title || buildAgentRunTitle(run.question || ''),
  question: run.question || '',
  answer: run.summary || '',
  status: run.status || 'done',
  toolCalls: [],
  memoryCandidates: [],
  examples: [],
  interactivePractice: null,
  followUpQuestions: [],
  followUpLoading: false,
  usage: run.metadata?.usage || null,
  compactSummary: run.metadata?.compactSummary || null,
  compactEntry: run.metadata?.compactEntry || null,
  subagentTasks: []
});

const normalizeSubagentTaskRecord = (task = {}) => ({
  taskId: task.taskId,
  runId: task.runId || '',
  agent: task.agent || task.subagentId,
  label: task.label || task.title || task.subagentId,
  status: task.status || 'running',
  sandbox: task.sandbox || null,
  startedAt: task.startedAt || null,
  completedAt: task.completedAt || null,
  error: task.error || null,
  cancelRequested: !!task.cancelRequested,
  events: Array.isArray(task.events) ? task.events.slice(-8) : []
});

const formatSubagentTaskStatus = (status = '') => {
  const map = {
    pending: '排队中',
    running: '运行中',
    completed: '已完成',
    failed: '失败',
    cancelled: '已取消',
    timed_out: '超时'
  };
  return map[status] || status || '运行中';
};

const toggleSubagentTask = (taskId) => {
  activeSubagentTaskId.value = activeSubagentTaskId.value === taskId ? '' : taskId;
};

const upsertSubagentTask = (runId, payload = {}) => {
  const target = agentRuns.value.find(run => run.id === runId);
  if (!target) return;
  if (!Array.isArray(target.subagentTasks)) {
    target.subagentTasks = [];
  }
  const existingIndex = target.subagentTasks.findIndex(task => task.taskId === payload.taskId);
  const record = {
    ...normalizeSubagentTaskRecord({
      taskId: payload.taskId,
      runId: payload.runId,
      agent: payload.agent,
      title: payload.title,
      status: payload.status,
      sandbox: payload.sandbox,
      startedAt: payload.startedAt,
      completedAt: payload.completedAt,
      error: payload.error,
      cancelRequested: payload.cancelRequested,
      events: payload.eventEntry ? [payload.eventEntry] : []
    })
  };
  if (existingIndex >= 0) {
    const existing = target.subagentTasks[existingIndex];
    const nextEvents = payload.eventEntry
      ? [...(existing.events || []), payload.eventEntry].slice(-8)
      : (existing.events || []);
    target.subagentTasks.splice(existingIndex, 1, {
      ...existing,
      ...record,
      events: nextEvents
    });
  } else {
    target.subagentTasks.push(record);
  }
  // 详情卡默认收起（事件明细已在「执行过程」面板里），点击 pill 才展开，避免重复信息占满中段
};

const cancelAgentRunTasks = async (runId = '') => {
  if (!runId) return;
  try {
    await fetch(`/api/agent-runs/${encodeURIComponent(runId)}/cancel`, {
      method: 'POST',
      headers: buildAuthHeaders()
    });
  } catch (error) {
    console.warn('Failed to cancel run tasks:', error);
  }
};

const refreshRunTaskHistory = async (runId = '') => {
  if (!runId) return;
  try {
    const response = await fetch(`/api/subagent-tasks?runId=${encodeURIComponent(runId)}&limit=24`, {
      headers: buildAuthHeaders()
    });
    if (!response.ok) return;
    const tasks = await response.json();
    syncAgentRun(runId, {
      subagentTasks: Array.isArray(tasks)
        ? tasks.map(normalizeSubagentTaskRecord)
        : []
    });
  } catch (error) {
    console.warn('Failed to refresh run task history:', error);
  }
};

const loadPersistedAgentRuns = async () => {
  try {
    const threadId = ensureAgentThreadId();
    const response = await fetch(`/api/agent-runs?limit=16&threadId=${encodeURIComponent(threadId)}`, {
      headers: buildAuthHeaders()
    });
    if (!response.ok) return;
    const runs = await response.json();
    if (!Array.isArray(runs) || runs.length === 0) return;
    const normalized = runs.map(normalizePersistedAgentRun);
    for (const run of normalized.reverse()) {
      const existingIndex = agentRuns.value.findIndex(item => item.id === run.id);
      if (existingIndex >= 0) {
        agentRuns.value.splice(existingIndex, 1, {
          ...agentRuns.value[existingIndex],
          ...run
        });
      } else {
        agentRuns.value.unshift(run);
      }
    }
    if (!activeAgentRunId.value && agentRuns.value.length > 0) {
      activeAgentRunId.value = agentRuns.value[agentRuns.value.length - 1].id;
    }
  } catch (error) {
    console.warn('Failed to load persisted agent runs:', error);
  }
};

const loadAgentThreadSummary = async (currentRunId = '') => {
  try {
    const threadId = ensureAgentThreadId();
    const query = currentRunId
      ? `?limit=8&threadId=${encodeURIComponent(threadId)}&currentRunId=${encodeURIComponent(currentRunId)}`
      : `?limit=8&threadId=${encodeURIComponent(threadId)}`;
    const response = await fetch(`/api/agent-thread-summary${query}`, { headers: buildAuthHeaders() });
    if (!response.ok) return;
    agentThreadSummary.value = await response.json();
  } catch (error) {
    console.warn('Failed to load agent thread summary:', error);
  }
};

// === 流式渲染器 ===
const resetStreamRenderer = () => {
  streamedAssistantText.value = '';
  streamRenderQueue = '';
  streamRenderDone = false;
  streamRenderDrainResolvers = [];
  if (streamRenderTimer) {
    window.clearTimeout(streamRenderTimer);
    streamRenderTimer = null;
  }
};

const resolveStreamDrain = () => {
  if (!streamRenderDone || streamRenderQueue.length > 0 || streamRenderTimer) return;
  while (streamRenderDrainResolvers.length > 0) {
    const resolve = streamRenderDrainResolvers.shift();
    resolve?.();
  }
};

const pumpStreamRenderer = (assistantMessage) => {
  if (streamRenderTimer || !streamRenderQueue.length) {
    resolveStreamDrain();
    return;
  }

  const step = () => {
    const sliceLength = streamRenderQueue.length > 20 ? 4 : streamRenderQueue.length > 8 ? 3 : 2;
    const chunk = streamRenderQueue.slice(0, sliceLength);
    streamRenderQueue = streamRenderQueue.slice(sliceLength);
    streamedAssistantText.value += chunk;
    assistantMessage.content = streamedAssistantText.value;

    if (streamRenderQueue.length > 0) {
      streamRenderTimer = window.setTimeout(step, 18);
      return;
    }

    streamRenderTimer = null;
    resolveStreamDrain();
  };

  streamRenderTimer = window.setTimeout(step, 18);
};

const enqueueStreamText = (text, assistantMessage) => {
  if (!text) return;
  streamRenderQueue += text;
  pumpStreamRenderer(assistantMessage);
};

const markStreamRendererDone = () => {
  streamRenderDone = true;
  resolveStreamDrain();
};

const waitForStreamRendererDrain = () => {
  if (!streamRenderQueue.length && !streamRenderTimer) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    streamRenderDrainResolvers.push(resolve);
    resolveStreamDrain();
  });
};

// === Agent 运行时 ===
const resetAgentRuntime = () => {
  agentQueue.value = defaultAgentQueue.map(item => ({ ...item }));
  agentRuntimeNote.value = '';
  agentUsage.value = null;
};

const applyAgentQueue = (payload = {}) => {
  if (Array.isArray(payload.agents)) {
    agentQueue.value = payload.agents.map(agent => ({ ...agent }));
  }
  agentRuntimeNote.value = payload.note || '';
};

const upsertStreamingToolCall = (payload = {}, status = 'done') => {
  const existingIndex = agentToolCalls.value.findIndex(call => (
    call.name === payload.name &&
    JSON.stringify(call.arguments || {}) === JSON.stringify(payload.arguments || {}) &&
    call.status === 'running'
  ));
  const record = {
    name: payload.name,
    arguments: payload.arguments || {},
    result: payload.result || '',
    status
  };
  if (existingIndex >= 0) {
    agentToolCalls.value.splice(existingIndex, 1, record);
  } else {
    agentToolCalls.value.push(record);
  }
};

// 完整执行轨迹：保留全过程（上限 80 步防失控），供「执行过程」折叠面板展示
const pushAgentEvent = ({ title, body, status = 'running' }) => {
  agentTrace.value.push({
    id: `trace-${agentTrace.value.length}-${Math.random().toString(36).slice(2, 6)}`,
    seq: agentTrace.value.length + 1,
    title,
    body,
    status,
    time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  });
  if (agentTrace.value.length > 80) {
    agentTrace.value = agentTrace.value.slice(-80);
  }
};

// run 结束后持久化轨迹：running 步骤已成历史，翻成 done，避免折叠面板里残留永久闪烁的进行中状态
const snapshotAgentTrace = () => agentTrace.value.map(step => ({
  ...step,
  status: step.status === 'running' ? 'done' : step.status
}));

const parseSseFrames = (chunk, onEvent) => {
  const frames = chunk.split('\n\n');
  const rest = frames.pop() || '';
  for (const frame of frames) {
    const lines = frame.split('\n');
    const event = lines.find(line => line.startsWith('event: '))?.slice(7).trim() || 'message';
    const dataLines = lines.filter(line => line.startsWith('data: ')).map(line => line.slice(6));
    if (dataLines.length === 0) continue;
    let payload = {};
    try {
      payload = JSON.parse(dataLines.join('\n'));
    } catch (e) {
      console.error('Agent SSE 解析失败', e);
      continue;
    }
    onEvent(event, payload);
  }
  return rest;
};

// === 练习 ===
const optionStateClass = (option) => {
  const feedback = agentPracticeFeedback.value;
  if (!feedback) {
    return { 'is-selected': agentPracticeInput.value === option };
  }
  if (option === feedback.correctAnswer) return { 'is-answer': true };
  if (agentPracticeInput.value === option) return { 'is-missed': true };
  return { 'is-dimmed': true };
};

const selectPracticeOption = (option) => {
  if (agentPracticeBusy.value || agentPracticeFeedback.value) return;
  agentPracticeInput.value = option;
  submitAgentPracticeAnswer();
};

const resetAgentPracticeState = () => {
  agentPracticeInput.value = '';
  agentPracticeBusy.value = false;
  agentPracticeHint.value = '';
  agentPracticeFeedback.value = null;
};

const requestAgentPracticeHint = async () => {
  if (!currentAgentInteractivePractice.value?.question || agentPracticeFeedback.value) return;
  agentPracticeBusy.value = true;
  try {
    const { data } = await axios.post('/api/dojo-agent-turn', {
      question: currentAgentInteractivePractice.value.question,
      action: 'hint'
    });
    agentPracticeHint.value = data.hint || '';
  } catch (e) {
    console.error('Agent 练习提示失败', e);
  } finally {
    agentPracticeBusy.value = false;
  }
};

const submitAgentPracticeAnswer = async () => {
  if (!currentAgentInteractivePractice.value?.question || !agentPracticeInput.value.trim() || agentPracticeFeedback.value) return;
  agentPracticeBusy.value = true;
  try {
    const { data } = await axios.post('/api/dojo-agent-turn', {
      question: currentAgentInteractivePractice.value.question,
      userAnswer: agentPracticeInput.value.trim(),
      action: 'check',
      hintUsed: !!agentPracticeHint.value,
      recordToMemory: true
    });
    agentPracticeFeedback.value = {
      isCorrect: !!data.isCorrect,
      correctAnswer: data.correctAnswer || currentAgentInteractivePractice.value.question.answer,
      explanation: data.explanation || '',
      memoryNote: ''
    };
    // 把判题结果反馈到长期记忆队列：刷新卡片列表（统计自动重算）并提示下次复习安排。
    if (data.memory) {
      if (Array.isArray(data.memory.cards)) {
        _deps.memoryCards.value = data.memory.cards.map(_deps.normalizeMemoryCard);
      }
      if (data.memory.profile) {
        _deps.userProfile.value = { ..._deps.userProfile.value, ...data.memory.profile };
      }
      const card = data.memory.card;
      if (card) {
        const dueLabel = _deps.formatMemoryDueLabel(_deps.normalizeMemoryCard(card));
        agentPracticeFeedback.value.memoryNote = data.memory.created
          ? `已加入记忆库并安排复习 · ${dueLabel}`
          : data.isCorrect
            ? `记忆已巩固，间隔延长 · ${dueLabel}`
            : `已标记为需巩固，将尽快重现 · ${dueLabel}`;
      }
    }
  } catch (e) {
    console.error('Agent 练习判题失败', e);
  } finally {
    agentPracticeBusy.value = false;
  }
};

// === 记忆候选 ===
const addAgentMemoryCandidate = async (item) => {
  if (!item) return;
  try {
    if (item.added) {
      const existing = _deps.memoryCards.value.find(card => card.word === item.word);
      if (!existing) {
        item.added = false;
        return;
      }
      const res = await axios.delete(`/api/memory-cards/${existing.id}`);
      _deps.memoryCards.value = res.data.map(_deps.normalizeMemoryCard);
      item.added = false;
      return;
    }

    const res = await axios.post('/api/memory-cards', {
      word: item.word,
      reading: item.reading || '',
      meaning: item.meaning || '',
      wordType: item.wordType || 'other',
      sample: item.sample || '',
      source: item.source || 'agent-suggestion'
    });
    _deps.memoryCards.value = res.data.map(_deps.normalizeMemoryCard);
    item.added = true;
  } catch (e) {
    console.error('加入 Agent 推荐记忆失败', e);
  }
};

const mergeAgentMemoryCandidates = (candidates = []) => {
  const existing = new Map(agentMemoryCandidates.value.map(item => [`${item.word}-${item.reading}`, item]));
  for (const item of candidates) {
    const key = `${item.word}-${item.reading || ''}`;
    if (!item.word || existing.has(key)) continue;
    existing.set(key, { ...item, added: _deps.memoryCards.value.some(card => card.word === item.word) });
  }
  agentMemoryCandidates.value = [...existing.values()].slice(0, 8);
};

// === 对话上下文 / 追问 ===
const buildAgentConversationContext = () => {
  const threadId = ensureAgentThreadId();
  const threadRuns = agentRuns.value
    .filter(run => (run.threadId || threadId) === threadId)
    .slice()
    .sort((a, b) => String(a.id || '').localeCompare(String(b.id || '')))
    .slice(-4);

  const runConversation = threadRuns.flatMap(run => {
    const parts = [];
    if (String(run.question || '').trim()) {
      parts.push({ role: 'user', content: run.question });
    }
    if (String(run.answer || '').trim()) {
      parts.push({ role: 'assistant', content: run.answer });
    }
    return parts;
  });

  const fallbackConversation = agentMessages.value
    .filter(item => (item?.role === 'user' || item?.role === 'assistant') && String(item.content || '').trim())
    .map(item => ({
      role: item.role,
      content: item.content || ''
    }));

  const source = runConversation.length > 0 ? runConversation : fallbackConversation;
  return source.slice(-8);
};

const fetchFollowUpSuggestions = async ({ message, answer }) => {
  const runId = activeAgentRunId.value;
  agentFollowUpLoading.value = true;
  if (runId) syncAgentRun(runId, { followUpLoading: true });
  try {
    const conversation = buildAgentConversationContext();
    if (conversation.length > 0 && conversation[conversation.length - 1]?.role === 'assistant') {
      conversation[conversation.length - 1] = { role: 'assistant', content: answer };
    }
    const { data } = await axios.post('/api/agent/follow-ups', {
      message,
      answer,
      context: {
        lookup: _deps.result.value,
        memoryStats: _deps.memoryStats.value,
        userProfile: _deps.userProfile.value,
        conversation,
        memoryCandidates: agentMemoryCandidates.value,
        exampleDifficulty: _deps.memorySettings.value.exampleDifficulty
      }
    });
    const suggestions = Array.isArray(data.suggestions) ? data.suggestions.slice(0, 3) : [];
    agentFollowUpQuestions.value = suggestions;
    if (runId) syncAgentRun(runId, { followUpQuestions: suggestions, followUpLoading: false });
  } catch (e) {
    console.error('追问建议生成失败', e);
    agentFollowUpQuestions.value = [];
    if (runId) syncAgentRun(runId, { followUpQuestions: [], followUpLoading: false });
  } finally {
    agentFollowUpLoading.value = false;
  }
};

const askSuggestedFollowUp = async (question) => {
  agentInput.value = question;
  await submitAgentCommand();
};

// === 例句成分解析 ===
const buildExampleComponentKey = (example, index, component) => {
  const label = component?.label || '';
  const text = component?.text || '';
  return `${currentAgentRun.value?.id || 'run'}::${index}::${example?.japanese || ''}::${label}::${text}`;
};

const buildExampleSegments = (example) => {
  const japanese = String(example?.japanese || '');
  const components = Array.isArray(example?.components) ? example.components : [];
  if (!japanese) return [];
  if (!components.length) return [{ text: japanese, isComponent: false }];

  let cursor = 0;
  const segments = [];

  for (const component of components) {
    const text = String(component?.text || '');
    if (!text) continue;
    const start = japanese.indexOf(text, cursor);
    if (start === -1) continue;
    if (start > cursor) {
      segments.push({ text: japanese.slice(cursor, start), isComponent: false });
    }
    segments.push({
      text,
      isComponent: true,
      component,
      highlightClass: componentHighlightClassMap[component.label] || 'is-support'
    });
    cursor = start + text.length;
  }

  if (cursor < japanese.length) {
    segments.push({ text: japanese.slice(cursor), isComponent: false });
  }

  return segments.length > 0 ? segments : [{ text: japanese, isComponent: false }];
};

const toggleExampleComponent = (example, index, component) => {
  const key = `${currentAgentRun.value?.id || 'run'}::${index}::${example?.japanese || ''}`;
  const nextKey = buildExampleComponentKey(example, index, component);
  activeExampleInspector.value[key] = activeExampleInspector.value[key] === nextKey ? null : nextKey;
};

const getActiveExampleComponent = (example, index) => {
  const key = `${currentAgentRun.value?.id || 'run'}::${index}::${example?.japanese || ''}`;
  const activeKey = activeExampleInspector.value[key];
  if (!activeKey) return null;
  return (example?.components || []).find(component => buildExampleComponentKey(example, index, component) === activeKey) || null;
};

const isExampleComponentActive = (example, index, component) => {
  const active = getActiveExampleComponent(example, index);
  return !!active && active.label === component.label && active.text === component.text;
};

const explainExampleComponent = (component, example) => {
  if (!component) return '';
  const text = String(component.text || '');
  const label = String(component.label || '');
  const particle = [...text].at(-1) || '';
  const readingHint = example?.kana ? `这一句的读音是「${example.kana}」。` : '';

  const explanations = {
    主题: `这里用「${particle}」把「${text}」提出来当整句的话题，后面是在围绕它继续说明。${readingHint}`,
    追加主题: `这里的「${particle}」有"也"的感觉，把「${text}」并入当前话题，表示它也适用同样的说明。${readingHint}`,
    主语: `这里常见是因为后面的动作或状态由「${text}」来承担，所以它被看作主语。${readingHint}`,
    宾语: `这里带有「${particle}」的提示，说明「${text}」是动作直接作用到的对象，所以是宾语。${readingHint}`,
    谓语: `这一段放在句子后半段，真正说出了"做什么/是什么/怎么样"，所以它是谓语核心。${readingHint}`,
    时间: `这一段在交代动作发生的时间点或时间范围，通常会和「に」这类助词一起出现。${readingHint}`,
    地点: `这里是在说明动作发生或目标所在的地点，所以被归为地点成分。${readingHint}`,
    '地点/方式': `这一段既可能表示地点，也可能表示进行动作的方式，要结合后面的动作一起理解。${readingHint}`,
    '方式/场所': `这里不是动作对象，而是在补充"在哪里/用什么方式"完成这个动作。${readingHint}`,
    方向: `这里常带方向感，说明动作朝向哪里去。${readingHint}`,
    '对象/并列': `这里通常是在说明动作的对象，或者把两个并列项连接起来。${readingHint}`,
    '起点/原因': `这一段常常表示"从哪里开始"或"为什么如此"，属于补充说明。${readingHint}`,
    终点: `这里交代动作、范围或时间延伸到哪里结束。${readingHint}`,
    比较基准: `这里是拿来做比较的参照物，帮助理解差异从哪里来。${readingHint}`,
    补语: `这一段是在补充条件、状态或落点，让句意更完整。${readingHint}`,
    补足: `这部分是对句子核心的补充说明，帮助把场景、条件或细节交代清楚。${readingHint}`
  };

  return explanations[label] || `${text} 在这句里承担的是「${label}」作用，用来帮助句子把关系说完整。${readingHint}`;
};

// === 引用展开 ===
const toggleCitation = (id) => {
  const next = new Set(expandedCitations.value);
  if (next.has(id)) next.delete(id); else next.add(id);
  expandedCitations.value = next;
};

// === 回答区右侧模块导航 ===
const jumpToAgentSection = (id) => {
  const el = document.getElementById(id);
  if (!el) return;
  activeAgentSection.value = id;
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

const updateAgentSectionSpy = () => {
  agentScrollRaf = 0;
  const doc = document.documentElement;
  const maxScroll = doc.scrollHeight - window.innerHeight;
  agentScrollProgress.value = maxScroll > 0 ? Math.min(100, Math.max(0, (window.scrollY / maxScroll) * 100)) : 0;
  const probe = window.innerHeight * 0.3;
  let current = '';
  for (const item of agentSectionNav.value) {
    const el = document.getElementById(item.id);
    if (!el) continue;
    if (el.getBoundingClientRect().top <= probe) current = item.id;
  }
  activeAgentSection.value = current || agentSectionNav.value[0]?.id || '';
};

const onAgentSectionScroll = () => {
  if (agentScrollRaf) return;
  agentScrollRaf = requestAnimationFrame(updateAgentSectionSpy);
};

// === 占位符动画 ===
const startAgentPlaceholderAnimation = () => {
  if (placeholderInterval) window.clearInterval(placeholderInterval);
  let exampleIndex = 0;
  let charIndex = 0;
  let deleting = false;
  let holdUntil = 0;
  animatedAgentPlaceholder.value = '';

  placeholderInterval = window.setInterval(() => {
    if (document.activeElement?.id === 'agent-command' || agentInput.value.trim() || agentRunning.value) {
      return;
    }
    if (holdUntil && Date.now() < holdUntil) {
      return;
    }
    const examples = agentPlaceholderExamples.value.length > 0
      ? agentPlaceholderExamples.value
      : defaultAgentPlaceholderExamples;
    const current = examples[exampleIndex % examples.length];
    if (!deleting) {
      charIndex += 1;
      animatedAgentPlaceholder.value = current.slice(0, charIndex);
      if (charIndex >= current.length) {
        holdUntil = Date.now() + 1600;
        deleting = true;
      }
      return;
    }
    charIndex -= 1;
    animatedAgentPlaceholder.value = current.slice(0, Math.max(0, charIndex));
    if (charIndex <= 0) {
      holdUntil = 0;
      deleting = false;
      exampleIndex = (exampleIndex + 1) % examples.length;
    }
  }, 90);
};

const loadHotPlaceholderExamples = async (force = false) => {
  try {
    const { data } = await axios.get('/api/hot-placeholders', {
      params: force ? { force: 1 } : {}
    });
    if (Array.isArray(data?.examples) && data.examples.length > 0) {
      agentPlaceholderExamples.value = data.examples;
    }
  } catch (error) {
    console.error('加载热点占位词失败', error);
    agentPlaceholderExamples.value = [...defaultAgentPlaceholderExamples];
  }
};

// === computed ===
const currentAgentRun = computed(() => {
  if (!agentRuns.value.length) return null;
  return agentRuns.value.find(run => run.id === activeAgentRunId.value) || agentRuns.value[agentRuns.value.length - 1];
});

const activeAgentRunIsRunning = computed(() => currentAgentRun.value?.status === 'running');

const currentAgentMemoryCandidates = computed(() => currentAgentRun.value?.memoryCandidates || []);
const currentAgentExamples = computed(() => currentAgentRun.value?.examples || []);
const currentAgentInteractivePractice = computed(() => currentAgentRun.value?.interactivePractice || null);
const currentAgentKnowledgeSources = computed(() => currentAgentRun.value?.knowledgeSources || []);

const currentAgentFollowUpQuestions = computed(() => currentAgentRun.value?.followUpQuestions || []);
const currentAgentFollowUpLoading = computed(() => !!currentAgentRun.value?.followUpLoading);
const currentAgentToolCalls = computed(() => currentAgentRun.value?.toolCalls || []);
const currentAgentTrace = computed(() => currentAgentRun.value?.trace || []);
const currentSubagentTasks = computed(() => currentAgentRun.value?.subagentTasks || []);
const activeSubagentTaskDetails = computed(() => currentSubagentTasks.value.find(task => task.taskId === activeSubagentTaskId.value) || null);

const agentRuntimeLabel = computed(() => {
  return agentRuntimeEngine.value ? `${agentRuntimeEngine.value} · ${_deps.llmStatusLabel.value}` : _deps.llmStatusLabel.value;
});

const agentUsageSummary = computed(() => {
  const usage = currentAgentRun.value?.usage || agentUsage.value;
  if (!usage) return null;
  const used = typeof usage.totalTokens === 'number' ? usage.totalTokens.toLocaleString() : '--';
  const limit = typeof usage.contextWindow === 'number' ? usage.contextWindow.toLocaleString() : '--';
  const ratio = typeof usage.usageRatio === 'number' ? Math.round(usage.usageRatio * 100) : null;
  return {
    level: usage.level || 'ok',
    warning: usage.warning || '',
    label: `上下文 ${used} / ${limit} tokens${ratio !== null ? ` · ${ratio}%` : ''}${usage.estimated ? ' · 预估' : ''}`
  };
});

const currentAgentThreadSummary = computed(() => {
  const summary = currentAgentRun.value?.compactSummary?.threadSummary;
  if (summary?.digest || summary?.focusWords?.length || summary?.practiceFocuses?.length) {
    return summary;
  }
  const fallback = agentThreadSummary.value;
  if (fallback?.digest || fallback?.focusWords?.length || fallback?.practiceFocuses?.length) {
    return fallback;
  }
  return null;
});

const latestAssistantMessage = computed(() => {
  if (!currentAgentRun.value?.answer) return null;
  return { role: 'assistant', content: currentAgentRun.value.answer };
});

const latestUserMessage = computed(() => {
  return currentAgentRun.value?.question || '';
});

const latestAssistantText = computed(() => {
  return currentAgentRun.value?.answer || '';
});

const renderedStreamingMarkdown = computed(() => {
  return renderMarkdown(latestAssistantText.value);
});

const practiceOptions = computed(() => {
  const q = currentAgentInteractivePractice.value?.question;
  if (!q) return [];
  if (Array.isArray(q.options) && q.options.length > 0) return q.options;
  // 兜底：旧数据没有 options 时，至少展示正确答案。
  return q.answer ? [q.answer] : [];
});

const agentSectionNav = computed(() => {
  if (_deps.workbenchSection.value !== 'dict' || _deps.currentMode.value === 'credits') return [];
  const sections = [];
  if (latestAssistantMessage.value) sections.push({ id: 'agent-sec-answer', label: '回答' });
  if (currentAgentInteractivePractice.value) sections.push({ id: 'agent-sec-practice', label: '练习' });
  if (currentAgentExamples.value.length > 0) sections.push({ id: 'agent-sec-examples', label: '例句' });
  if (currentAgentKnowledgeSources.value.length > 0) sections.push({ id: 'agent-sec-citations', label: '引用' });
  if (currentAgentFollowUpQuestions.value.length > 0) sections.push({ id: 'agent-sec-followups', label: '追问' });
  if (currentAgentToolCalls.value.length > 0 && !activeAgentRunIsRunning.value) sections.push({ id: 'agent-sec-tools', label: '工具' });
  if (currentAgentTrace.value.length > 0 && !activeAgentRunIsRunning.value) sections.push({ id: 'agent-sec-trace', label: '过程' });
  return sections;
});

// === 核心函数：runAgent ===
const runAgent = async () => {
  const message = agentInput.value.trim();
  if (!message) return;
  if (agentRunning.value && agentAbortController.value) {
    cancelAgentRunTasks(activeAgentRunId.value);
    agentAbortController.value.abort();
  }

  const runSeq = ++agentRunSeq;
  agentRunning.value = true;
  agentToolCalls.value = [];
  agentTrace.value = [];
  agentMemoryCandidates.value = [];
  agentExamples.value = [];
  agentFollowUpQuestions.value = [];
  agentFollowUpLoading.value = false;
  agentInteractivePractice.value = null;
  resetAgentPracticeState();
  resetStreamRenderer();
  resetAgentRuntime();
  const runId = `run-${Date.now()}-${runSeq}`;
  const runRecord = {
    id: runId,
    threadId: ensureAgentThreadId(),
    title: buildAgentRunTitle(message),
    question: message,
    answer: '',
    status: 'running',
    toolCalls: [],
    memoryCandidates: [],
    examples: [],
    interactivePractice: null,
    followUpQuestions: [],
    followUpLoading: false,
    usage: null,
    subagentTasks: []
  };
  agentRuns.value.push(runRecord);
  activeAgentRunId.value = runId;
  activeSubagentTaskId.value = '';
  agentMessages.value.push({ role: 'user', content: message });
  const assistantMessage = { role: 'assistant', content: '' };
  agentMessages.value.push(assistantMessage);
  agentInput.value = '';
  let hasTutorToken = false;
  let timeoutId = null;
  let timedOut = false;

  const setStreamingPlaceholder = (text) => {
    if (!hasTutorToken) {
      assistantMessage.content = `> ${text}`;
    }
  };

  try {
    const controller = new AbortController();
    agentAbortController.value = controller;
    timeoutId = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 60000);
    const response = await fetch(apiUrl('/api/agent/stream'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...buildAuthHeaders(), ...buildLlmHeaders() },
      signal: controller.signal,
      body: JSON.stringify({
        runId,
        threadId: ensureAgentThreadId(),
        message,
        context: {
          lookup: _deps.result.value,
          memoryStats: _deps.memoryStats.value,
          userProfile: _deps.userProfile.value,
          conversation: buildAgentConversationContext(),
          exampleDifficulty: _deps.memorySettings.value.exampleDifficulty
        }
      })
    });

    if (!response.ok || !response.body) {
      throw new Error(`Agent stream failed: ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let streamDone = false;
    const handleEvent = (event, payload) => {
      if (event === 'queue') {
        applyAgentQueue(payload);
        if (payload.activeId) {
          const activeAgent = payload.agents?.find(agent => agent.id === payload.activeId);
          pushAgentEvent({
            title: activeAgent?.label || payload.activeId,
            body: payload.note || activeAgent?.description || 'Agent 节点运行中',
            status: 'running'
          });
        }
        setStreamingPlaceholder('处理中...');
      } else if (event === 'run_start') {
        if (payload.id && payload.id !== runId) {
          syncAgentRun(runId, { id: payload.id });
          activeAgentRunId.value = payload.id;
        }
        syncAgentRun(runId, {
          threadId: payload.threadId || ensureAgentThreadId(),
          compactSummary: payload.compactSummary || null
        });
        agentRuntimeEngine.value = payload.runtime === 'langgraph' ? 'LangGraph' : 'Agent';
        pushAgentEvent({
          title: '开始',
          body: `${payload.runtime || 'agent'} · ${payload.model || 'model'} 已建立流式连接`,
          status: 'running'
        });
        setStreamingPlaceholder('处理中...');
      } else if (event === 'agent_note') {
        agentRuntimeNote.value = payload.agent === 'planner'
          ? 'Planner 已完成任务拆解，正在进入工具检索。'
          : `${payload.title}: ${compactText(payload.content, 80)}`;
        pushAgentEvent({
          title: payload.title || payload.agent || 'Agent Note',
          body: compactText(payload.content || agentRuntimeNote.value, 120),
          status: 'done'
        });
        setStreamingPlaceholder('处理中...');
      } else if (event === 'subagent_task') {
        upsertSubagentTask(runId, {
          ...payload,
          eventEntry: {
            type: payload.type,
            message: `${payload.title} · ${formatSubagentTaskStatus(payload.status)}`
          }
        });
        pushAgentEvent({
          title: payload.title || payload.agent || 'Subagent Task',
          body: `${formatSubagentTaskStatus(payload.status)} · ${payload.sandbox?.policy || 'sandbox'}`,
          status: payload.status === 'failed' || payload.status === 'timed_out' ? 'error' : payload.status === 'completed' ? 'done' : 'running'
        });
      } else if (event === 'usage') {
        agentUsage.value = payload;
        syncAgentRun(runId, { usage: payload });
        if (payload.warning) {
          agentRuntimeNote.value = payload.warning;
        }
      } else if (event === 'runtime_state') {
        syncAgentRun(runId, {
          threadId: payload.threadId || ensureAgentThreadId(),
          compactSummary: payload.compactSummary || null
        });
        if (payload.threadSummary) {
          agentThreadSummary.value = payload.threadSummary;
        }
      } else if (event === 'tool_start') {
        upsertStreamingToolCall(payload, 'running');
        syncAgentRun(runId, { toolCalls: agentToolCalls.value.map(call => ({ ...call })) });
        pushAgentEvent({
          title: toolNameLabel(payload.name),
          body: `调用工具：${formatToolArgs(payload.arguments || {})}`,
          status: 'running'
        });
        setStreamingPlaceholder('处理中...');
      } else if (event === 'tool_end') {
        upsertStreamingToolCall(payload, 'done');
        syncAgentRun(runId, { toolCalls: agentToolCalls.value.map(call => ({ ...call })) });
        pushAgentEvent({
          title: `${toolNameLabel(payload.name)} 完成`,
          body: formatToolResult({ ...payload, status: 'done' }),
          status: payload.error ? 'error' : 'done'
        });
        setStreamingPlaceholder('处理中...');
      } else if (event === 'token') {
        if (!hasTutorToken) {
          assistantMessage.content = '';
          streamedAssistantText.value = '';
          hasTutorToken = true;
          pushAgentEvent({
            title: '输出',
            body: '最终回答开始按 token 输出',
            status: 'running'
          });
        }
        enqueueStreamText(payload.content || '', assistantMessage);
        syncAgentRun(runId, { answer: `${assistantMessage.content || ''}${payload.content || ''}` });
      } else if (event === 'done') {
        streamDone = true;
        pushAgentEvent({
          title: '完成',
          body: '本轮学习 Agent 工作流已完成',
          status: 'done'
        });
        markStreamRendererDone();
        mergeAgentMemoryCandidates(payload.memoryCandidates || []);
        agentExamples.value = Array.isArray(payload.examples) ? payload.examples.slice(0, 3) : [];
        agentInteractivePractice.value = payload.interactivePractice || null;
        resetAgentPracticeState();
        if (payload.usage) {
          agentUsage.value = payload.usage;
        }
        if (payload.answer && !assistantMessage.content.trim()) {
          assistantMessage.content = payload.answer;
          streamedAssistantText.value = payload.answer;
        }
        if (Array.isArray(payload.toolCalls) && payload.toolCalls.length > 0) {
          agentToolCalls.value = payload.toolCalls.map(call => ({ ...call, status: 'done' }));
        }
        syncAgentRun(runId, {
          answer: payload.answer || assistantMessage.content || '',
          status: 'done',
          toolCalls: agentToolCalls.value.map(call => ({ ...call })),
          memoryCandidates: [...agentMemoryCandidates.value],
          examples: [...agentExamples.value],
          interactivePractice: agentInteractivePractice.value,
          knowledgeSources: Array.isArray(payload.knowledgeSources) ? payload.knowledgeSources : [],
          usage: agentUsage.value || null,
          compactSummary: agentRuns.value.find(run => run.id === runId)?.compactSummary || null,
          subagentTasks: [...(agentRuns.value.find(run => run.id === runId)?.subagentTasks || [])],
          trace: snapshotAgentTrace()
        });
        loadAgentThreadSummary(runId);
        fetchFollowUpSuggestions({
          message,
          answer: payload.answer || assistantMessage.content || ''
        });
      } else if (event === 'cancelled') {
        streamDone = true;
        assistantMessage.content ||= '已停止当前请求。';
        streamedAssistantText.value = assistantMessage.content;
        pushAgentEvent({
          title: '已停止',
          body: payload.message || '本轮 Agent 运行已停止',
          status: 'done'
        });
        syncAgentRun(runId, {
          answer: assistantMessage.content,
          status: 'cancelled',
          toolCalls: agentToolCalls.value.map(call => ({ ...call })),
          memoryCandidates: [...agentMemoryCandidates.value],
          examples: [...agentExamples.value],
          interactivePractice: agentInteractivePractice.value,
          trace: snapshotAgentTrace(),
          usage: agentUsage.value || null
        });
      } else if (event === 'error') {
        // 后端用 code 区分语义化错误，比如 no_llm_key 是用户没在设置面板填 key
        const err = new Error(payload.message || 'Agent stream failed.');
        if (payload.code) err.code = payload.code;
        throw err;
      }
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      buffer = parseSseFrames(buffer, handleEvent);
      if (streamDone) {
        await reader.cancel().catch(() => {});
        break;
      }
    }
    if (!streamDone) {
      throw new Error('连接提前结束，尚未收到 Agent 完成事件。请重试；如果仍失败，多半是模型服务或网络中断。');
    }
    if (timeoutId) {
      window.clearTimeout(timeoutId);
      timeoutId = null;
    }

    markStreamRendererDone();
    await waitForStreamRendererDrain();

    if (!assistantMessage.content.trim()) {
      assistantMessage.content = '我暂时没有得到明确结果。';
      streamedAssistantText.value = assistantMessage.content;
    }
    syncAgentRun(runId, {
      answer: assistantMessage.content,
      status: 'done',
      toolCalls: agentToolCalls.value.map(call => ({ ...call })),
      memoryCandidates: [...agentMemoryCandidates.value],
      examples: [...agentExamples.value],
      interactivePractice: agentInteractivePractice.value,
      followUpQuestions: [...agentFollowUpQuestions.value],
      trace: snapshotAgentTrace(),
      usage: agentUsage.value || null
    });
    await refreshRunTaskHistory(runId);
    await _deps.loadMemoryCards();
  } catch (e) {
    if (e.name === 'AbortError') {
      assistantMessage.content = timedOut
        ? '这次请求超过 60 秒没有完成，已自动停止。请检查 API Key 是否有效，或稍后重试。'
        : (assistantMessage.content || '已停止上一次请求。');
      streamedAssistantText.value = assistantMessage.content;
      if (runSeq === agentRunSeq) {
        agentRuntimeNote.value = timedOut
          ? '请求已超时停止，可以修改问题或检查模型配置后重试。'
          : '上一次请求已停止，可以继续新的查询。';
      }
    } else if (e.code === 'no_llm_key') {
      // 自带 key 模式：用户没填，自动展开设置面板引导
      assistantMessage.content = e.message;
      streamedAssistantText.value = assistantMessage.content;
      _deps.showLlmSettings.value = true;
      if (runSeq === agentRunSeq) {
        agentRuntimeNote.value = '👈 在上方设置面板填入 API Key 后即可使用 AI 功能。';
      }
    } else {
      assistantMessage.content = e.message || 'Agent 调用失败，请检查网络或后端日志。';
      streamedAssistantText.value = assistantMessage.content;
      if (runSeq === agentRunSeq) {
        agentRuntimeNote.value = e.message || 'Agent 调用失败。';
      }
    }
    syncAgentRun(runId, {
      answer: assistantMessage.content,
      status: e.name === 'AbortError' || /cancelled/i.test(e?.message || '') ? 'cancelled' : 'error',
      toolCalls: agentToolCalls.value.map(call => ({ ...call })),
      memoryCandidates: [...agentMemoryCandidates.value],
      examples: [...agentExamples.value],
      interactivePractice: agentInteractivePractice.value,
      followUpQuestions: [...agentFollowUpQuestions.value],
      trace: snapshotAgentTrace(),
      usage: agentUsage.value || null
    });
    await refreshRunTaskHistory(runId);
  } finally {
    if (timeoutId) {
      window.clearTimeout(timeoutId);
    }
    if (runSeq === agentRunSeq) {
      agentRunning.value = false;
      agentAbortController.value = null;
    }
  }
};

// === 命令提交 / 停止 / 回车 ===
const submitAgentCommand = async () => {
  const value = agentInput.value.trim();
  if (!value) return;
  _deps.showDropdown.value = false;
  await runAgent();
};

const stopActiveAgentRun = async () => {
  const runId = activeAgentRunId.value;
  if (!runId || !agentAbortController.value) return;
  agentRuntimeNote.value = '正在停止当前 Agent 运行...';
  await cancelAgentRunTasks(runId);
  agentAbortController.value.abort();
};

const handleAgentEnter = async (e) => {
  if (_deps.isComposing.value) return;
  if (e.key === 'Enter') {
    await submitAgentCommand();
  }
};

const runHeroExample = (prompt) => {
  agentInput.value = prompt;
  submitAgentCommand();
};

export function useAgentStream(deps = {}) {
  Object.assign(_deps, deps);

  watch(activeAgentRunId, (runId) => {
    if (!runId) return;
    const target = agentRuns.value.find(run => run.id === runId);
    if (!target) return;
    if (!Array.isArray(target.subagentTasks) || target.subagentTasks.length === 0) {
      refreshRunTaskHistory(runId);
    }
    loadAgentThreadSummary(runId);
  });

  onMounted(() => {
    window.addEventListener('scroll', onAgentSectionScroll, { passive: true });
    window.addEventListener('resize', onAgentSectionScroll, { passive: true });
  });

  onUnmounted(() => {
    window.removeEventListener('scroll', onAgentSectionScroll);
    window.removeEventListener('resize', onAgentSectionScroll);
    if (agentScrollRaf) cancelAnimationFrame(agentScrollRaf);
    if (streamRenderTimer) { window.clearTimeout(streamRenderTimer); streamRenderTimer = null; }
    if (placeholderInterval) window.clearInterval(placeholderInterval);
    if (placeholderRefreshInterval) window.clearInterval(placeholderRefreshInterval);
  });

  return {
    // 常量
    heroChips, optionLabels, defaultAgentPlaceholderExamples, defaultAgentQueue,
    componentHighlightClassMap,
    // 状态
    agentThreadSummary, agentThreadId, agentPlan, similarWords,
    agentLoading, agentRunning, agentInput, agentMessages,
    agentRuns, activeAgentRunId, agentToolCalls, agentTrace,
    agentMemoryCandidates, agentExamples, agentInteractivePractice,
    agentFollowUpQuestions, agentFollowUpLoading, agentUsage,
    agentPracticeInput, agentPracticeBusy, agentPracticeHint,
    agentPracticeFeedback, streamedAssistantText, agentAbortController,
    agentPlaceholderExamples, animatedAgentPlaceholder, agentRuntimeEngine,
    agentQueue, agentRuntimeNote, activeSubagentTaskId,
    activeExampleInspector, expandedCitations, activeAgentSection,
    agentScrollProgress,
    // 计算属性
    currentAgentRun, activeAgentRunIsRunning,
    currentAgentMemoryCandidates, currentAgentExamples,
    currentAgentInteractivePractice, currentAgentKnowledgeSources,
    currentAgentFollowUpQuestions, currentAgentFollowUpLoading,
    currentAgentToolCalls, currentAgentTrace, currentSubagentTasks,
    activeSubagentTaskDetails, agentRuntimeLabel, agentUsageSummary,
    currentAgentThreadSummary, latestAssistantMessage, latestUserMessage,
    latestAssistantText, renderedStreamingMarkdown, practiceOptions,
    agentSectionNav,
    // 线程 / Run 管理
    ensureAgentThreadId, buildAgentRunTitle, syncAgentRun,
    normalizePersistedAgentRun, loadPersistedAgentRuns, loadAgentThreadSummary,
    // 子任务
    normalizeSubagentTaskRecord, formatSubagentTaskStatus, toggleSubagentTask,
    upsertSubagentTask, cancelAgentRunTasks, refreshRunTaskHistory,
    // 流式渲染器
    resetStreamRenderer, pumpStreamRenderer, enqueueStreamText,
    markStreamRendererDone, waitForStreamRendererDrain,
    // Agent 运行时
    resetAgentRuntime, applyAgentQueue, upsertStreamingToolCall,
    pushAgentEvent, snapshotAgentTrace, parseSseFrames,
    // 练习
    optionStateClass, selectPracticeOption, resetAgentPracticeState,
    requestAgentPracticeHint, submitAgentPracticeAnswer,
    // 记忆候选
    addAgentMemoryCandidate, mergeAgentMemoryCandidates,
    // 对话 / 追问
    buildAgentConversationContext, fetchFollowUpSuggestions, askSuggestedFollowUp,
    // 工具格式化
    formatToolArgs, formatToolResult, parseToolPayload, compactText, toolNameLabel,
    // Markdown / HTML
    renderMarkdown, stripMarkdownInline, escapeHtml,
    // 例句成分
    buildExampleComponentKey, buildExampleSegments, toggleExampleComponent,
    getActiveExampleComponent, isExampleComponentActive, explainExampleComponent,
    // 引用
    toggleCitation,
    // 模块导航
    jumpToAgentSection, updateAgentSectionSpy, onAgentSectionScroll,
    // 占位符动画
    startAgentPlaceholderAnimation, loadHotPlaceholderExamples,
    // 核心函数
    runAgent, submitAgentCommand, stopActiveAgentRun, handleAgentEnter,
    runHeroExample,
    // 辅助函数
    buildAuthHeaders, buildLlmHeaders, apiUrl,
  };
}
