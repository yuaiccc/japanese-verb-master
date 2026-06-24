import { ref, computed, watch } from 'vue';
import axios from 'axios';

// === 常量 ===
const verbTypeMap: Record<string, string> = {
  GODAN: '五段动词',
  ICHIDAN: '一段动词',
  SURU: 'サ变动词',
  KURU: 'カ变动词'
};

const wordTypeDisplayMap: Record<string, string> = {
  'verb': '动词',
  'noun': '名词',
  'i-adjective': 'い形容词',
  'na-adjective': 'な形容词',
  'adverb': '副词'
};

const AGENT_MEMORY_TYPE_LABELS: Record<string, string> = { goal: '目标', preference: '偏好', fact: '事实', task: '任务' };

const memoryLibraryFilters = [
  { id: 'all', label: '全部' },
  { id: 'due', label: '待复习' },
  { id: 'mastered', label: '稳定' }
];

// === 模块级单例状态 ===
const memoryCards = ref<any[]>([]);
const reviewQueue = ref<any[]>([]);      // 服务端限流后的当日复习队列
const reviewQuota = ref<any>(null);    // { reviewsToday/reviewLimit/newCardsToday/newLimit/... }
const agentMemoryList = ref<any[]>([]);  // Agent 长期记忆（goal/preference/fact/task）
const memoryRevealed = ref<boolean>(false);
const memoryLibraryQuery = ref<string>('');
const memoryLibraryFilter = ref<string>('all');
const showMemorySettings = ref<boolean>(false);
const memorySettings = ref<any>({
  desiredRetention: 0.9,
  newCardsPerDay: 12,
  reviewLimitPerDay: 60,
  lapseMinutes: 20,
  hardMultiplier: 1.2,
  maxIntervalDays: 180,
  autoAddSimilar: false,
  exampleDifficulty: 'auto'
});

// === 外部依赖注入 ===
// 这些状态/函数不属于 useMemoryCards 范围，由调用方通过 useMemoryCards(deps) 注入。
const _deps: Record<string, any> = {
  result: ref(null),
  aiExamples: ref([]),
  agentMemoryCandidates: ref([]),
  loadUserProfile: async () => {},
  refreshAgentPlan: async () => {},
  searchAndConjugate: () => {},
};

// === 函数 ===
const getMemoryWord = (item: any): string => item?.dictionaryForm || item?.word || item?.verb || '';

const normalizeMemoryCard = (card: any): any => ({
  ...card,
  ease: Number(card.ease) || 2.2,
  intervalDays: Number(card.intervalDays) || 0,
  reviewCount: Number(card.reviewCount) || 0,
  lapses: Number(card.lapses) || 0,
  dueAt: card.dueAt || new Date().toISOString(),
  createdAt: card.createdAt || new Date().toISOString(),
  updatedAt: card.updatedAt || new Date().toISOString()
});

const loadMemoryCards = async (): Promise<void> => {
  try {
    const res = await axios.get('/api/memory-cards');
    memoryCards.value = res.data.map(normalizeMemoryCard);
    await Promise.allSettled([_deps.loadUserProfile(), loadReviewQueue(), loadAgentMemory()]);
  } catch (e) {
    console.error('加载记忆卡片失败', e);
  }
};

// 服务端限流后的复习队列 + 当日配额（newCardsPerDay / reviewLimitPerDay 在此生效）
const loadReviewQueue = async (): Promise<void> => {
  try {
    const { data } = await axios.get('/api/memory-review-queue');
    reviewQueue.value = (data.cards || []).map(normalizeMemoryCard);
    reviewQuota.value = data.quota || null;
  } catch (e) {
    console.error('加载复习队列失败', e);
  }
};

const agentMemoryTypeLabel = (type: string): string => AGENT_MEMORY_TYPE_LABELS[type] || type;

const loadAgentMemory = async (): Promise<void> => {
  try {
    const { data } = await axios.get('/api/agent-memory');
    agentMemoryList.value = Array.isArray(data) ? data : [];
  } catch (e) {
    console.error('加载 Agent 记忆失败', e);
  }
};

const deleteAgentMemoryItem = async (id: string): Promise<void> => {
  try {
    const { data } = await axios.delete(`/api/agent-memory/${id}`);
    agentMemoryList.value = Array.isArray(data) ? data : [];
  } catch (e) {
    console.error('删除 Agent 记忆失败', e);
  }
};

const loadMemorySettings = async (): Promise<void> => {
  try {
    const res = await axios.get('/api/memory-settings');
    memorySettings.value = { ...memorySettings.value, ...res.data };
  } catch (e) {
    console.error('加载记忆参数失败', e);
  }
};

const saveMemorySettingsToServer = async (): Promise<void> => {
  try {
    const res = await axios.post('/api/memory-settings', memorySettings.value);
    memorySettings.value = { ...memorySettings.value, ...res.data };
  } catch (e) {
    console.error('保存记忆参数失败', e);
  }
};

const buildMemoryCard = (item: any): any => {
  const word = getMemoryWord(item);
  const meanings = item.meanings?.map((m: any) => m.definitions).filter(Boolean).join('; ');
  const now = new Date().toISOString();
  return normalizeMemoryCard({
    id: `${word}-${Date.now()}`,
    word,
    reading: item.reading || item.kana || '',
    meaning: item.meaning || meanings || '',
    wordType: item.wordType || 'verb',
    verbType: item.verbType || '',
    sample: _deps.aiExamples.value[0]?.japanese || '',
    ease: 2.2,
    intervalDays: 0,
    reviewCount: 0,
    lapses: 0,
    dueAt: now,
    createdAt: now,
    updatedAt: now
  });
};

const addCurrentToMemory = async (): Promise<void> => {
  if (!_deps.result.value) return;
  const word = getMemoryWord(_deps.result.value);
  if (!word) return;

  try {
    let res;
    if (currentMemoryId.value) {
      res = await axios.delete(`/api/memory-cards/${currentMemoryId.value}`);
    } else {
      res = await axios.post('/api/memory-cards', buildMemoryCard(_deps.result.value));
    }
    memoryCards.value = res.data.map(normalizeMemoryCard);
    await _deps.refreshAgentPlan(_deps.result.value);
  } catch (e) {
    console.error('保存记忆卡片失败', e);
  }
};

const reviewMemory = async (id: string, grade: string): Promise<void> => {
  try {
    const res = await axios.post(`/api/memory-cards/${id}/review`, { grade });
    memoryCards.value = res.data.cards.map(normalizeMemoryCard);
    if (res.data.quota) reviewQuota.value = res.data.quota;
    memoryRevealed.value = false;
    await loadReviewQueue(); // 取下一张（仍受当日限流约束）
    if (_deps.result.value) await _deps.refreshAgentPlan(_deps.result.value);
  } catch (e) {
    console.error('复习记录保存失败', e);
  }
};

const searchMemoryCard = (card: any): void => {
  if (!card?.word) return;
  _deps.searchAndConjugate(card.word);
};

const formatMemoryDueLabel = (card: any): string => {
  const dueTime = new Date(card.dueAt).getTime();
  if (Number.isNaN(dueTime)) return '时间未知';
  if (dueTime <= Date.now()) return '现在可复习';
  const due = new Date(card.dueAt);
  return `下次 ${due.toLocaleDateString()}`;
};

// === computed ===
const dueMemoryCards = computed(() => {
  const now = Date.now();
  return memoryCards.value
    .filter((card: any) => new Date(card.dueAt).getTime() <= now)
    .sort((a: any, b: any) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime());
});

const activeMemoryCard = computed(() => {
  // 复习会话走服务端限流队列；未命中再回退到客户端到期列表（队列未加载时）
  const card = reviewQueue.value[0] || dueMemoryCards.value[0];
  if (!card) return null;
  return {
    ...card,
    typeLabel: card.wordType === 'verb'
      ? (verbTypeMap[card.verbType] || '动词')
      : (wordTypeDisplayMap[card.wordType] || card.wordType || '词汇')
  };
});

// 有到期卡但限流队列为空 → 当日配额用尽（区别于"真的清空了"）
const reviewLimitReached = computed(() =>
  !!reviewQuota.value && dueMemoryCards.value.length > 0 && reviewQueue.value.length === 0
);

const memoryStats = computed(() => {
  const total = memoryCards.value.length;
  const due = dueMemoryCards.value.length;
  const mastered = memoryCards.value.filter((card: any) => card.intervalDays >= 7).length;
  return {
    total,
    due,
    mastered,
    // 学习中：既未稳定也不在待复习队列里的卡片
    learning: Math.max(0, total - mastered - due)
  };
});

const nextMemoryText = computed(() => {
  const futureCards = memoryCards.value
    .filter((card: any) => new Date(card.dueAt).getTime() > Date.now())
    .sort((a: any, b: any) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime());
  if (futureCards.length === 0) return '继续添加查询过的词，记忆队列会自动安排复习。';
  const nextDate = new Date(futureCards[0].dueAt);
  return `下一张卡片将在 ${nextDate.toLocaleDateString()} 到期。`;
});

const filteredMemoryCards = computed(() => {
  const keyword = memoryLibraryQuery.value.trim().toLowerCase();
  return memoryCards.value.filter((card: any) => {
    if (memoryLibraryFilter.value === 'due' && new Date(card.dueAt).getTime() > Date.now()) {
      return false;
    }
    if (memoryLibraryFilter.value === 'mastered' && card.intervalDays < 7) {
      return false;
    }
    if (!keyword) return true;
    return [card.word, card.reading, card.meaning]
      .filter(Boolean)
      .some((text: any) => String(text).toLowerCase().includes(keyword));
  });
});

const currentMemoryId = computed(() => {
  const word = getMemoryWord(_deps.result.value);
  if (!word) return '';
  return memoryCards.value.find((card: any) => card.word === word)?.id || '';
});

const isCurrentMemorized = computed(() => !!currentMemoryId.value);

// === watch ===
watch(() => activeMemoryCard.value?.id, () => {
  memoryRevealed.value = false;
});

watch(memoryCards, (cards: any[]) => {
  const savedWords = new Set(cards.map((card: any) => card.word));
  _deps.agentMemoryCandidates.value = _deps.agentMemoryCandidates.value.map((item: any) => ({
    ...item,
    added: savedWords.has(item.word)
  }));
});

export function useMemoryCards(deps: Record<string, any> = {}) {
  Object.assign(_deps, deps);
  return {
    // 状态
    memoryCards, reviewQueue, reviewQuota, memoryRevealed,
    memoryLibraryQuery, memoryLibraryFilter, agentMemoryList,
    memorySettings, showMemorySettings, memoryLibraryFilters,
    // 计算属性
    dueMemoryCards, activeMemoryCard, reviewLimitReached,
    memoryStats, nextMemoryText, filteredMemoryCards,
    currentMemoryId, isCurrentMemorized,
    // 函数
    normalizeMemoryCard, loadMemoryCards, loadReviewQueue,
    loadMemorySettings, saveMemorySettingsToServer,
    buildMemoryCard, addCurrentToMemory, reviewMemory,
    searchMemoryCard, formatMemoryDueLabel, getMemoryWord,
    loadAgentMemory, deleteAgentMemoryItem, agentMemoryTypeLabel,
  };
}
