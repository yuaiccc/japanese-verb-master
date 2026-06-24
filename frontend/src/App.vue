<template>
  <div
    class="container"
    :class="{
      'app-dark': darkMode,
      'app-accessible': accessibilityMode
    }"
  >
    <header class="header">
      <div class="header-top">
        <div class="preference-bar" aria-label="显示偏好设置">
          <button
            type="button"
            class="pref-icon"
            :class="{ 'is-on': darkMode }"
            role="switch"
            :aria-checked="darkMode"
            :title="darkMode ? '切换为浅色模式' : '切换为深色模式'"
            aria-label="深色模式"
            @click="darkMode = !darkMode"
          >
            <Icon :name="darkMode ? 'moon' : 'sun'" />
          </button>
          <button
            type="button"
            class="pref-icon"
            :class="{ 'is-on': accessibilityMode }"
            role="switch"
            :aria-checked="accessibilityMode"
            title="无障碍模式"
            aria-label="无障碍模式"
            @click="accessibilityMode = !accessibilityMode"
          >
            <Icon name="accessibility" />
          </button>
          <button
            type="button"
            class="pref-link"
            :class="{ active: currentMode === 'credits' }"
            title="开源致谢"
            aria-label="开源致谢"
            @click="currentMode = 'credits'"
          >
            <Icon name="github" />
            致谢
          </button>
          <template v-if="authUser">
            <span class="auth-user" :title="`已登录：${authUser.username}`">{{ authUser.username }}</span>
            <button type="button" class="pref-link" title="退出登录" @click="logout">
              <Icon name="logout" />
              退出
            </button>
          </template>
          <button v-else type="button" class="pref-link auth-login-btn" title="登录 / 注册" @click="openAuthModal('login')">
            <Icon name="login" />
            登录
          </button>
        </div>
      </div>

      <AuthModal
        :modal="authModal"
        :site-key="turnstileSiteKey"
        :captcha-token="turnstileToken"
        @submit="submitAuth"
        @close="closeAuthModal"
        @mode-change="setAuthMode"
        @captcha-token="turnstileToken = $event"
        @captcha-error="authModal.error = '人机验证加载失败，请刷新后重试'"
      />

      <div class="header-bottom">
        <div class="mode-switch" aria-label="功能模式">
          <button
            v-if="currentMode === 'credits'"
            class="active"
            @click="currentMode = 'dict'"
          >
            <Icon name="home" />
            返回工作台
          </button>
          <button
            v-if="currentMode !== 'credits'"
            :class="{ active: workbenchSection === 'dict' }"
            @click="workbenchSection = 'dict'"
          >
            <Icon name="dictionary" />
            词典查询
          </button>
          <button
            v-if="currentMode !== 'credits'"
            :class="{ active: workbenchSection === 'memory' }"
            @click="workbenchSection = 'memory'"
          >
            <Icon name="brain" />
            单词复习
          </button>
          <button
            v-if="currentMode !== 'credits'"
            :class="{ active: workbenchSection === 'docs' }"
            @click="workbenchSection = 'docs'"
          >
            <Icon name="book" />
            说明
          </button>
          <button
            v-if="currentMode !== 'credits'"
            :class="{ active: workbenchSection === 'dojo' }"
            @click="workbenchSection = 'dojo'"
          >
            <Icon name="dojo" />
            变形道场
          </button>
        </div>
        <button class="nav-llm-toggle" @click="showLlmSettings = !showLlmSettings">
          <Icon name="settings" />
          {{ llmSettings.provider }} · {{ llmSettings.model || 'model' }}
        </button>
      </div>

      <transition name="agent-flow">
      <div v-if="showLlmSettings" class="nav-llm-panel">
        <select v-model="llmSettings.provider" @change="applyLlmProviderPreset">
          <option value="deepseek">DeepSeek</option>
          <option value="openai">OpenAI</option>
          <option value="openrouter">OpenRouter</option>
          <option value="siliconflow">SiliconFlow</option>
          <option value="custom">Custom</option>
          <option value="ollama">Ollama</option>
        </select>
        <input v-model="llmSettings.model" type="text" placeholder="model">
        <input v-model="llmSettings.baseUrl" type="text" placeholder="Base URL">
        <input v-model="llmSettings.apiKey" type="password" :placeholder="llmSettings.apiKeySet ? 'API Key 已保存' : 'API Key'">
        <button
          class="agent-chip agent-chip--with-icon"
          :class="`agent-chip--${llmSaveStatus}`"
          :disabled="llmSaveStatus === 'saving'"
          @click="saveLlmSettingsToServer"
        >
          <span v-if="llmSaveStatus === 'saving'" class="mini-spinner" aria-hidden="true"></span>
          <Icon v-else :name="llmSaveStatus === 'saved' ? 'check' : 'save'" />
          {{ llmSaveStatus === 'saving' ? '保存中' : llmSaveStatus === 'saved' ? '已保存' : '保存' }}
        </button>
        <span
          v-if="llmSaveMessage"
          class="nav-llm-save-message"
          :class="`nav-llm-save-message--${llmSaveStatus}`"
        >{{ llmSaveMessage }}</span>
        <a
          class="nav-llm-credit"
          href="https://github.com/farion1231/cc-switch"
          target="_blank"
          rel="noreferrer"
        >
          Supported by CC Switch
        </a>
        <div class="nav-llm-panel__embedding">
          <span class="nav-llm-panel__embedding-label">知识库检索 Embedding</span>
          <select v-model="embeddingSettings.provider">
            <option value="ollama">Ollama (本地)</option>
            <option value="openai-compatible">OpenAI 兼容</option>
          </select>
          <input v-model="embeddingSettings.model" type="text" placeholder="embedding model">
          <input v-model="embeddingSettings.baseUrl" type="text" placeholder="Base URL">
          <input v-if="embeddingSettings.provider !== 'ollama'" v-model="embeddingSettings.apiKey" type="password" :placeholder="embeddingSettings.apiKeySet ? 'API Key 已保存' : 'API Key'">
          <button
            class="agent-chip agent-chip--with-icon"
            :class="`agent-chip--${embeddingSaveStatus}`"
            :disabled="embeddingSaveStatus === 'saving'"
            @click="saveEmbeddingSettings"
          >
            <span v-if="embeddingSaveStatus === 'saving'" class="mini-spinner" aria-hidden="true"></span>
            <Icon v-else :name="embeddingSaveStatus === 'saved' ? 'check' : 'save'" />
            {{ embeddingSaveStatus === 'saving' ? '保存中' : embeddingSaveStatus === 'saved' ? '已保存' : '保存检索设置' }}
          </button>
          <span
            v-if="embeddingSaveMessage"
            class="nav-llm-save-message nav-llm-save-message--embedding"
            :class="`nav-llm-save-message--${embeddingSaveStatus}`"
          >{{ embeddingSaveMessage }}</span>
        </div>
      </div>
      </transition>
    </header>

    <template v-if="currentMode !== 'credits'">
    <AgentPanel
      v-if="workbenchSection === 'dict'"
      :loading="loading"
      :error="error"
      :form="form"
      :suggestions="suggestions"
      :show-dropdown="showDropdown"
      :show-history="showHistory"
      :history="history"
      :is-composing="isComposing"
      :verb-type-map="verbTypeMap"
      :word-type-display-map="wordTypeDisplayMap"
      @on-input="onInput"
      @on-focus="onFocus"
      @hide-suggestions="hideSuggestionsWithDelay"
      @select-item="onSelectItem"
      @clear-history="clearHistory"
      @conjugate="(verb) => { form.verb = verb; conjugate(); }"
      @update:is-composing="isComposing = $event"
    />

    <MemoryQueue v-if="workbenchSection === 'memory'" />

    <DictPanel
      v-if="workbenchSection === 'dict' && (result || loadingAi)"
      :result="result"
      :loading-ai="loadingAi"
      :ai-error="aiError"
      :ai-progress="aiProgress"
      :ai-raw-explanation="aiRawExplanation"
      :ai-explanation="aiExplanation"
      :ai-examples="aiExamples"
      :verification-status="verificationStatus"
      :selected-model="selectedModel"
      :available-models="availableModels"
      :furigana-dict="furiganaDict"
      :furigana-word="furiganaWord"
      :furigana-examples="furiganaExamples"
      :is-verb="isVerb"
      :conjugation-items="conjugationItems"
      :verb-type-map="verbTypeMap"
      :word-type-display-map="wordTypeDisplayMap"
      @fetch-ai-explanation="fetchAiExplanation"
      @update:selected-model="selectedModel = $event"
    />
    <!-- 底部：文档区 -->
    <DocsView v-if="workbenchSection === 'docs'" />
    </template>

    <DojoView v-if="workbenchSection === 'dojo'" />

    <CreditsPage v-if="currentMode === 'credits'" />

    <transition name="agent-flow">
    <nav v-if="agentSectionNav.length >= 2" class="agent-section-nav" aria-label="回答模块导航">
      <span class="agent-section-nav__track" aria-hidden="true">
        <span class="agent-section-nav__progress" :style="{ height: `${agentScrollProgress}%` }"></span>
      </span>
      <button
        v-for="item in agentSectionNav"
        :key="item.id"
        type="button"
        class="agent-section-nav__item"
        :class="{ 'is-active': activeAgentSection === item.id }"
        @click="jumpToAgentSection(item.id)"
      >
        <span class="agent-section-nav__dot" aria-hidden="true"></span>
        <span class="agent-section-nav__label">{{ item.label }}</span>
      </button>
    </nav>
    </transition>
  </div>

</template>

<script setup>
import { ref, watch, onMounted, computed, onUnmounted, nextTick } from 'vue';
import axios from 'axios';
import { marked } from 'marked';
import * as wanakana from 'wanakana';
import Icon from './components/Icon.vue';
import DojoView from './components/DojoView.vue';
import DocsView from './components/DocsView.vue';
import CreditsPage from './components/CreditsPage.vue';
import AuthModal from './components/AuthModal.vue';
import { useDisplayPreferences } from './composables/useDisplayPreferences';
import { useSpeech } from './composables/useSpeech';
import { useDojo } from './composables/useDojo';
import AgentPanel from './components/AgentPanel.vue';
import MemoryQueue from './components/MemoryQueue.vue';
import DictPanel from './components/DictPanel.vue';
import { useAgentStream } from './composables/useAgentStream.js';
import { useMemoryCards } from './composables/useMemoryCards.js';

// 认证：token 存 localStorage，拦截器给每个请求自动带上 Authorization
const AUTH_TOKEN_KEY = 'jvm_auth_token';
const buildAuthHeaders = () => {
  const token = localStorage.getItem(AUTH_TOKEN_KEY);
  return token ? { Authorization: `Bearer ${token}` } : {};
};

// 自带 LLM key（方案 A）：key 只存浏览器 localStorage，每请求带 header；不入库、不被他人共享。
const LLM_SETTINGS_KEY = 'jvm_llm_settings';
const readLocalLlmSettings = () => {
  try { return JSON.parse(localStorage.getItem(LLM_SETTINGS_KEY) || '{}'); }
  catch { return {}; }
};
const writeLocalLlmSettings = (s) => {
  localStorage.setItem(LLM_SETTINGS_KEY, JSON.stringify({
    provider: s.provider || '', baseUrl: s.baseUrl || '', model: s.model || '', apiKey: s.apiKey || ''
  }));
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

// 拼接绝对 API 地址：生产构建 VITE_API_BASE=https://xxx，开发不设时退到相对路径走 Vite proxy。
// 单平台部署（Express 同时托管前端）也走相对路径，不用设 VITE_API_BASE。
const apiUrl = (path) => `${import.meta.env.VITE_API_BASE || ''}${path}`;

axios.interceptors.request.use((config) => {
  config.headers = config.headers || {};
  const token = localStorage.getItem(AUTH_TOKEN_KEY);
  if (token) config.headers.Authorization = `Bearer ${token}`;
  // 注入用户自带的 LLM key（仅 LLM 相关端点，后端 AsyncLocalStorage 取它）
  const url = config.url || '';
  const isLlmEndpoint = url.includes('/api/ai-explain') || url.includes('/api/agent/') || url.includes('/api/llm-');
  if (isLlmEndpoint) {
    Object.assign(config.headers, buildLlmHeaders());
  }
  return config;
});

// 全局模式
const currentMode = ref('dict'); // 'dict' | 'credits'
const authUser = ref(null); // 当前登录用户 { id, username }，null 表示未登录
const authModal = ref({ open: false, mode: 'login', username: '', password: '', error: '', loading: false });
const turnstileSiteKey = ref('');
const turnstileToken = ref('');
const workbenchSection = ref('dict'); // 'dict' | 'memory' | 'docs' | 'dojo'
const isComposing = ref(false); // 跟踪输入法状态，防止回车键误触

// 显示偏好（深色 / 无障碍）：逻辑见 composables/useDisplayPreferences
const { darkMode, accessibilityMode, initDisplayPreferences } = useDisplayPreferences();

// 练习道场 / 付费 / 学习画像：完整逻辑见 composables/useDojo（DojoView 内部也用同一单例）。
// App.vue 只需 userProfile（Agent 记忆回写）+ 几个加载器（认证/首屏复用）。
const { userProfile, loadUserProfile, loadEntitlements, loadDojoBootstrap } = useDojo();

// === 认证 ===
const loadCurrentUser = async () => {
  if (!localStorage.getItem(AUTH_TOKEN_KEY)) {
    authUser.value = null;
    return;
  }
  try {
    const { data } = await axios.get('/api/auth/me');
    authUser.value = data.user || null;
    if (!authUser.value && !data.guest) localStorage.removeItem(AUTH_TOKEN_KEY);
  } catch (e) {
    authUser.value = null;
  }
};

const ensureGuestIdentity = async () => {
  try {
    if (localStorage.getItem(AUTH_TOKEN_KEY)) return;
    const { data } = await axios.post('/api/auth/guest');
    localStorage.setItem(AUTH_TOKEN_KEY, data.token);
  } catch (e) {
    console.error('创建访客身份失败', e);
  }
};

const loadTurnstileConfig = async () => {
  if (turnstileSiteKey.value) return;
  try {
    const { data } = await axios.get('/api/auth/captcha-config');
    turnstileSiteKey.value = data.enabled ? String(data.siteKey || '') : '';
  } catch {
    turnstileSiteKey.value = '';
  }
};

const setAuthMode = (mode) => {
  authModal.value.mode = mode;
  authModal.value.error = '';
  turnstileToken.value = '';
  if (mode === 'register') loadTurnstileConfig();
};

const openAuthModal = (mode = 'login') => {
  authModal.value = { open: true, mode, username: '', password: '', error: '', loading: false };
  turnstileToken.value = '';
  if (mode === 'register') loadTurnstileConfig();
};

const closeAuthModal = () => {
  authModal.value.open = false;
  turnstileToken.value = '';
};

const submitAuth = async () => {
  const m = authModal.value;
  const username = m.username.trim();
  if (username.length < 2) { m.error = '用户名至少 2 个字符'; return; }
  if (m.password.length < 6) { m.error = '密码至少 6 位'; return; }
  m.loading = true;
  m.error = '';
  try {
    const url = m.mode === 'register' ? '/api/auth/register' : '/api/auth/login';
    const { data } = await axios.post(url, {
      username,
      password: m.password,
      ...(m.mode === 'register' ? { captchaToken: turnstileToken.value } : {})
    });
    localStorage.setItem(AUTH_TOKEN_KEY, data.token);
    authUser.value = data.user;
    authModal.value.open = false;
    // 切换用户后刷新与用户绑定的数据
    await Promise.allSettled([loadMemoryCards?.(), loadUserProfile?.(), loadEntitlements?.()]);
  } catch (e) {
    m.error = e.response?.data?.error || '操作失败，请重试';
  } finally {
    m.loading = false;
  }
};

const logout = async () => {
  localStorage.removeItem(AUTH_TOKEN_KEY);
  authUser.value = null;
  await ensureGuestIdentity();
  await Promise.allSettled([loadMemoryCards?.(), loadUserProfile?.(), loadEntitlements?.()]);
};

// 词典模式状态
const form = ref({
  verb: ''
});

const result = ref(null);
const aiRawExplanation = ref('');
const verificationStatus = ref({});
const aiExamples = ref([]);
const loading = ref(false);
const loadingAi = ref(false);
const aiProgress = ref(0);
let aiProgressInterval = null;
let hotPlaceholderRefreshInterval = null;
const error = ref('');
const aiError = ref('');
const showDropdown = ref(false);
const suggestions = ref([]);
const availableModels = ref([]);
const selectedModel = ref('');
const llmStatus = ref({ provider: 'ollama', model: '', apiKeySet: false });
const llmSettings = ref({
  provider: 'deepseek',
  model: 'deepseek-v4-flash',
  baseUrl: 'https://api.deepseek.com',
  apiKey: '',
  apiKeySet: false
});
const llmSaveStatus = ref('idle'); // idle | saving | saved | error
const llmSaveMessage = ref('');
let llmSaveMessageTimer = null;
let suggestTimeout = null;

// 查询历史
const MAX_HISTORY = 20;
const history = ref([]);

const showLlmSettings = ref(false);
const llmProviderPresets = {
  deepseek: { baseUrl: 'https://api.deepseek.com', model: 'deepseek-v4-flash' },
  openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  openrouter: { baseUrl: 'https://openrouter.ai/api/v1', model: 'anthropic/claude-3.5-sonnet' },
  siliconflow: { baseUrl: 'https://api.siliconflow.cn/v1', model: 'deepseek-ai/DeepSeek-V3' },
  custom: { baseUrl: '', model: '' },
  ollama: { baseUrl: 'http://127.0.0.1:11434', model: 'qwen2.5' }
};

const llmStatusLabel = computed(() => {
  const provider = llmStatus.value.provider || 'ollama';
  const ready = provider === 'ollama' || llmStatus.value.apiKeySet;
  return `${provider} · ${ready ? (llmStatus.value.model || 'model') : '未配置'}`;
});

// === Composable 初始化（模块级单例） ===
// useAgentStream 和 useMemoryCards 互相依赖，使用延迟注入模式。
const memDeps = {};
const agentDeps = {};

const mem = useMemoryCards(memDeps);
const agent = useAgentStream({
  ...agentDeps,
  result,
  userProfile,
  memoryStats: mem.memoryStats,
  memorySettings: mem.memorySettings,
  memoryCards: mem.memoryCards,
  normalizeMemoryCard: mem.normalizeMemoryCard,
  loadMemoryCards: mem.loadMemoryCards,
  formatMemoryDueLabel: mem.formatMemoryDueLabel,
  showLlmSettings,
  showDropdown,
  isComposing,
  llmStatusLabel,
  workbenchSection,
  currentMode,
});

// 延迟注入 memDeps
Object.assign(memDeps, {
  result,
  aiExamples,
  agentMemoryCandidates: agent.agentMemoryCandidates,
  loadUserProfile,
  refreshAgentPlan: (lookup) => refreshAgentPlan(lookup),
  searchAndConjugate: (verb) => { form.value.verb = verb; conjugate(); },
});

// 解构 composable 返回值到顶层变量（ref 解构后仍保持响应性）
const {
  heroChips, optionLabels, defaultAgentPlaceholderExamples, defaultAgentQueue,
  componentHighlightClassMap,
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
  currentAgentRun, activeAgentRunIsRunning,
  currentAgentMemoryCandidates, currentAgentExamples,
  currentAgentInteractivePractice, currentAgentKnowledgeSources,
  currentAgentFollowUpQuestions, currentAgentFollowUpLoading,
  currentAgentToolCalls, currentAgentTrace, currentSubagentTasks,
  activeSubagentTaskDetails, agentRuntimeLabel, agentUsageSummary,
  currentAgentThreadSummary, latestAssistantMessage, latestUserMessage,
  latestAssistantText, renderedStreamingMarkdown, practiceOptions,
  agentSectionNav,
  ensureAgentThreadId, buildAgentRunTitle, syncAgentRun,
  normalizePersistedAgentRun, loadPersistedAgentRuns, loadAgentThreadSummary,
  normalizeSubagentTaskRecord, formatSubagentTaskStatus, toggleSubagentTask,
  upsertSubagentTask, cancelAgentRunTasks, refreshRunTaskHistory,
  resetStreamRenderer, pumpStreamRenderer, enqueueStreamText,
  markStreamRendererDone, waitForStreamRendererDrain,
  resetAgentRuntime, applyAgentQueue, upsertStreamingToolCall,
  pushAgentEvent, snapshotAgentTrace, parseSseFrames,
  optionStateClass, selectPracticeOption, resetAgentPracticeState,
  requestAgentPracticeHint, submitAgentPracticeAnswer,
  addAgentMemoryCandidate, mergeAgentMemoryCandidates,
  buildAgentConversationContext, fetchFollowUpSuggestions, askSuggestedFollowUp,
  formatToolArgs, formatToolResult, parseToolPayload, compactText, toolNameLabel,
  renderMarkdown, stripMarkdownInline, escapeHtml,
  buildExampleComponentKey, buildExampleSegments, toggleExampleComponent,
  getActiveExampleComponent, isExampleComponentActive, explainExampleComponent,
  toggleCitation,
  jumpToAgentSection, updateAgentSectionSpy, onAgentSectionScroll,
  startAgentPlaceholderAnimation, loadHotPlaceholderExamples,
  runAgent, submitAgentCommand, stopActiveAgentRun, handleAgentEnter,
  runHeroExample,
} = agent;

const {
  memoryCards, reviewQueue, reviewQuota, memoryRevealed,
  memoryLibraryQuery, memoryLibraryFilter, agentMemoryList,
  memorySettings, showMemorySettings, memoryLibraryFilters,
  dueMemoryCards, activeMemoryCard, reviewLimitReached,
  memoryStats, nextMemoryText, filteredMemoryCards,
  currentMemoryId, isCurrentMemorized,
  normalizeMemoryCard, loadMemoryCards, loadReviewQueue,
  loadMemorySettings, saveMemorySettingsToServer,
  buildMemoryCard, addCurrentToMemory, reviewMemory,
  searchMemoryCard, formatMemoryDueLabel, getMemoryWord,
  loadAgentMemory, deleteAgentMemoryItem, agentMemoryTypeLabel,
} = mem;


const loadLlmSettings = async () => {
  // 自带 key（A 方案）：从 localStorage 读，apiKey 保留以便前端显示已配置状态。
  const local = readLocalLlmSettings();
  llmSettings.value = { ...llmSettings.value, ...local, apiKeySet: !!local.apiKey };
  llmStatus.value = { provider: local.provider || llmSettings.value.provider, model: local.model || llmSettings.value.model, apiKeySet: !!local.apiKey };
};

const embeddingSettings = ref({ provider: 'ollama', model: 'bge-m3', baseUrl: 'http://localhost:11434', apiKey: '', apiKeySet: false });
const embeddingSaveStatus = ref('idle');
const embeddingSaveMessage = ref('');
let embeddingSaveMessageTimer = null;

const setTransientSaveMessage = (statusRef, messageRef, timerSetter, status, message, timeout = 2600) => {
  statusRef.value = status;
  messageRef.value = message;
  timerSetter((existingTimer) => {
    if (existingTimer) window.clearTimeout(existingTimer);
    return window.setTimeout(() => {
      statusRef.value = 'idle';
      messageRef.value = '';
      timerSetter(() => null);
    }, timeout);
  });
};

const setLlmSaveMessage = (status, message, timeout) => {
  setTransientSaveMessage(
    llmSaveStatus,
    llmSaveMessage,
    (updater) => { llmSaveMessageTimer = updater(llmSaveMessageTimer); },
    status,
    message,
    timeout
  );
};

const setEmbeddingSaveMessage = (status, message, timeout) => {
  setTransientSaveMessage(
    embeddingSaveStatus,
    embeddingSaveMessage,
    (updater) => { embeddingSaveMessageTimer = updater(embeddingSaveMessageTimer); },
    status,
    message,
    timeout
  );
};

const loadEmbeddingSettings = async () => {
  try { embeddingSettings.value = { ...embeddingSettings.value, ...(await axios.get('/api/knowledge/embedding-settings')).data }; } catch (e) { console.error('加载检索设置失败', e); }
};
const saveEmbeddingSettings = async () => {
  const { apiKeySet, ...payload } = embeddingSettings.value;
  embeddingSaveStatus.value = 'saving';
  embeddingSaveMessage.value = '正在保存检索配置...';
  try {
    embeddingSettings.value = { ...embeddingSettings.value, ...(await axios.post('/api/knowledge/embedding-settings', payload)).data, apiKey: '' };
    setEmbeddingSaveMessage('saved', '检索配置已保存。');
  } catch (e) {
    console.error('保存检索设置失败', e);
    setEmbeddingSaveMessage('error', e.response?.data?.error || '保存失败，请稍后重试。', 4200);
  }
};

const saveLlmSettingsToServer = async () => {
  // 自带 key（A 方案）：保存到 localStorage，不再 POST 到后端，避免共享 key 被打爆额度。
  llmSaveStatus.value = 'saving';
  llmSaveMessage.value = '正在保存到当前浏览器...';
  try {
    writeLocalLlmSettings(llmSettings.value);
    llmSettings.value = {
      ...llmSettings.value,
      apiKeySet: !!llmSettings.value.apiKey
    };
    llmStatus.value = {
      provider: llmSettings.value.provider,
      model: llmSettings.value.model,
      apiKeySet: !!llmSettings.value.apiKey
    };
    const keyMessage = llmSettings.value.apiKey
      ? 'API Key 已保存到当前浏览器。可以重新发送问题。'
      : '配置已保存，但还没有填写 API Key。';
    setLlmSaveMessage(llmSettings.value.apiKey ? 'saved' : 'error', keyMessage, llmSettings.value.apiKey ? 3000 : 5200);
  } catch (e) {
    console.error('保存 LLM 设置失败', e);
    setLlmSaveMessage('error', '浏览器拒绝写入本地设置，请检查隐私模式或存储权限。', 5200);
  }
};

const applyLlmProviderPreset = () => {
  const preset = llmProviderPresets[llmSettings.value.provider];
  if (!preset) return;
  llmSettings.value = {
    ...llmSettings.value,
    baseUrl: preset.baseUrl,
    model: preset.model,
    // 切换 provider 后旧 key 已在后端失效，清空输入提示用户重新填写。
    apiKey: '',
    apiKeySet: false
  };
  llmSaveStatus.value = 'idle';
  llmSaveMessage.value = '';
};


const focusSearch = () => {
  currentMode.value = 'dict';
  nextTick(() => document.getElementById('agent-command')?.focus());
};

const refreshAgentPlan = async (lookup) => {
  if (!lookup) return;
  agentLoading.value = true;
  try {
    const [similarRes, planRes] = await Promise.all([
      axios.post('/api/similar-words', lookup),
      axios.post('/api/agent/learning-plan', { lookup })
    ]);
    similarWords.value = similarRes.data;
    agentPlan.value = planRes.data;
    if (memorySettings.value.autoAddSimilar) {
      const firstTwo = similarWords.value.slice(0, 2);
      for (const item of firstTwo) {
        await axios.post('/api/memory-cards', {
          word: item.kanji,
          reading: item.kana,
          meaning: item.meaning,
          wordType: item.wordType || 'other',
          sample: '',
          source: 'agent-similar'
        });
      }
      await loadMemoryCards();
    }
  } catch (e) {
    console.error('学习 agent 获取失败', e);
    similarWords.value = [];
    agentPlan.value = null;
  } finally {
    agentLoading.value = false;
  }
};

// 从 localStorage 加载历史
const loadHistory = () => {
  try {
    const saved = localStorage.getItem('verbHistory');
    if (saved) {
      history.value = JSON.parse(saved);
    }
  } catch (e) {
    history.value = [];
  }
};

// 保存历史到 localStorage
const saveHistory = () => {
  localStorage.setItem('verbHistory', JSON.stringify(history.value));
};

// 清空历史
const clearHistory = () => {
  history.value = [];
  saveHistory();
};

// 计算属性：是否显示历史记录（输入为空时）
const showHistory = computed(() => {
  return agentInput.value.trim() === '' && history.value.length > 0;
});

// 输入处理：清除错误，触发下拉框状态更新（由 watch 处理联想）
const onInput = () => {
  error.value = '';
};

// 聚焦处理：显示下拉框（为空时显示历史，有输入时触发联想）
const onFocus = () => {
  showDropdown.value = true;
};

// 选择条目（历史或联想补全）
const onSelectItem = (item) => {
  if (showHistory.value) {
    agentInput.value = item.verb || '';
    error.value = '';
    showDropdown.value = false;
    nextTick(() => document.getElementById('agent-command')?.focus());
  } else {
    selectSuggestion(item);
  }
};

// 添加查询记录到历史顶部（去重）
const addToHistory = (verbItem) => {
  const verbName = verbItem.dictionaryForm || verbItem.word || verbItem.verb;
  const wordType = verbItem.wordType || 'verb';
  // 先移除相同单词的旧记录（去重）
  history.value = history.value.filter(h => h.verb !== verbName);
  // 添加到开头，限制最大数量
  history.value.unshift({
    verb: verbName,
    meaning: verbItem.meaning || (verbItem.meanings?.[0]?.definitions) || '',
    verbType: wordType === 'verb' ? verbItem.verbType : wordType,
    time: Date.now()
  });
  if (history.value.length > MAX_HISTORY) {
    history.value = history.value.slice(0, MAX_HISTORY);
  }
  saveHistory();
};

const conjugationItems = [
  { key: 'negative', label: '否定式' },
  { key: 'polite', label: '礼貌式' },
  { key: 'teForm', label: 'て形' },
  { key: 'taForm', label: '过去式' },
  { key: 'potential', label: '可能形' },
  { key: 'passive', label: '被动形' },
  { key: 'causative', label: '使役形' },
  { key: 'imperative', label: '命令形' },
  { key: 'volitional', label: '意向形' }
];

const aiExplanation = computed(() => {
  return aiRawExplanation.value ? renderMarkdown(aiRawExplanation.value) : '';
});


onMounted(async () => {
  await ensureGuestIdentity();
  await loadCurrentUser();
  initDisplayPreferences();
  initTts();

  const [modelsResult] = await Promise.allSettled([
    axios.get('/api/ai-models')
  ]);

  // 场景 / 练习画像 / 长期画像 / 解锁状态：交给道场单例统一加载
  loadDojoBootstrap();

  axios.get('/api/llm-status')
    .then(res => {
      llmStatus.value = res.data;
    })
    .catch(err => {
      console.error('获取 LLM 状态失败', err);
    });

  if (modelsResult.status === 'fulfilled') {
    availableModels.value = modelsResult.value.data;
    if (modelsResult.value.data.length > 0) {
      selectedModel.value =
        modelsResult.value.data.find(model => model === 'qwen2.5' || model === 'qwen2.5:7b') || modelsResult.value.data[0];
    }
  } else {
    console.error('获取模型列表失败', modelsResult.reason);
  }

  loadHistory();

  // composable 数据加载
  mem.loadMemoryCards();
  mem.loadMemorySettings();
  mem.loadAgentMemory();
  mem.loadReviewQueue();
  agent.loadPersistedAgentRuns();
  agent.loadAgentThreadSummary();
  agent.startAgentPlaceholderAnimation();
  agent.loadHotPlaceholderExamples();
  hotPlaceholderRefreshInterval = window.setInterval(() => {
    agent.loadHotPlaceholderExamples(true);
  }, 30 * 60 * 1000);

  await loadLlmSettings();
  loadEmbeddingSettings();
});

// 提取日文文本中的假名部分（去掉汉字），用于模糊比较
const extractKana = (text) => {
  if (!text) return '';
  // 去掉标点、空格
  let cleaned = text.trim()
    .replace(/[。！？、・\s]/g, '')
    .replace(/[\u3099\u309A]/g, '');
  // 提取平假名和片假名字符
  const kanaOnly = cleaned.replace(/[^\u3040-\u309F\u30A0-\u30FF]/g, '');
  // 片假名转平假名
  return wanakana.toHiragana(kanaOnly);
};

// 判断 AI 修正是否等价于原结果（只是写法不同，如汉字vs假名）
const isEquivalentCorrection = (correction, original) => {
  if (!correction || !correction.trim()) return true;
  if (!original) return false;
  // 完全相同
  if (correction.trim() === original.trim()) return true;
  // 比较假名部分是否相同（忽略汉字差异）
  const kanaA = extractKana(correction);
  const kanaB = extractKana(original);
  if (kanaA && kanaB && kanaA === kanaB) return true;
  // 尝试用 toHiragana 转换（处理片假名/罗马音差异）
  const normA = wanakana.toHiragana(correction.trim());
  const normB = wanakana.toHiragana(original.trim());
  return normA === normB;
};

const verbTypeMap = {
  GODAN: '五段动词',
  ICHIDAN: '一段动词',
  SURU: 'サ变动词',
  KURU: 'カ变动词'
};

const wordTypeDisplayMap = {
  'verb': '动词',
  'noun': '名词',
  'i-adjective': 'い形容词',
  'na-adjective': 'な形容词',
  'adverb': '副词'
};

// 语音朗读（浏览器 SpeechSynthesis API）
// 日语语音播报：逻辑见 composables/useSpeech
const { speak, prewarmSpeech, initTts, isSpeaking, ttsVoiceReady } = useSpeech();

// 是否为动词结果
const isVerb = computed(() => {
  return result.value?.wordType === 'verb' || !!result.value?.dictionaryForm;
});

// 调用后端 kuromoji 生成 furigana HTML
const fetchFurigana = async (texts) => {
  try {
    const res = await axios.post('/api/furigana', { texts });
    return res.data.results;
  } catch (e) {
    console.error('Furigana API failed:', e);
    // fallback: 返回 HTML 转义后的原文，避免 v-html 渲染未清洗文本
    return texts.map(text => escapeHtml(text));
  }
};

// 字典卡片 / 动词摘要的 furigana HTML
const furiganaWord = ref('');
const furiganaDict = ref('');
// 例句的 furigana HTML
const furiganaExamples = ref([]);
let latestFuriganaWordRequest = 0;
let latestFuriganaExamplesRequest = 0;

// 当查询结果变化时，获取 furigana
watch(result, async (val) => {
  const requestId = ++latestFuriganaWordRequest;
  if (!val) {
    furiganaWord.value = '';
    furiganaDict.value = '';
    return;
  }
  // 预缓存原形 + 各活用形的朗读，点击朗读按钮时零延迟
  prewarmSpeech([
    val.dictionaryForm, val.word,
    val.negative, val.polite, val.teForm, val.taForm,
    val.potential, val.passive, val.causative, val.imperative, val.volitional
  ]);
  const word = val.dictionaryForm || val.word;
  if (word) {
    const results = await fetchFurigana([word]);
    if (requestId !== latestFuriganaWordRequest) return;
    if (val.dictionaryForm) {
      furiganaDict.value = results[0];
      furiganaWord.value = '';
    } else {
      furiganaWord.value = results[0];
      furiganaDict.value = '';
    }
  }
});

// 当例句变化时，批量获取 furigana
watch(aiExamples, async (examples) => {
  const requestId = ++latestFuriganaExamplesRequest;
  if (!examples || examples.length === 0) {
    furiganaExamples.value = [];
    return;
  }
  const jaTexts = examples.map(ex => ex.japanese);
  prewarmSpeech(jaTexts);
  const results = await fetchFurigana(jaTexts);
  if (requestId !== latestFuriganaExamplesRequest) return;
  furiganaExamples.value = results;
});

// Agent 回答的例句一到达就预缓存朗读
watch(agentExamples, (examples) => {
  prewarmSpeech((examples || []).map(ex => ex.japanese));
}, { deep: true });

// 监听输入，双轨联想补全：先立即返回本地结果，再异步追加远程结果
let remoteAbortController = null;

watch(agentInput, (newVal) => {
  if (suggestTimeout) clearTimeout(suggestTimeout);
  // 取消上一次远程请求
  if (remoteAbortController) {
    remoteAbortController.abort();
    remoteAbortController = null;
  }

  if (!newVal || newVal.trim() === '') {
    suggestions.value = [];
    return;
  }

  showDropdown.value = true;

  // 防抖 150ms
  suggestTimeout = setTimeout(async () => {
    const query = newVal;
    try {
      // 第一轨：本地结果（秒回）
      const localRes = await axios.get('/api/suggest', { params: { q: query } });
      // 确保输入没变（用户可能已继续打字）
      if (agentInput.value !== query) return;
      suggestions.value = localRes.data;

      // 第二轨：异步查询远程结果（本地结果<3时才补充）
      if (localRes.data.length < 3) {
        const controller = new AbortController();
        remoteAbortController = controller;
        try {
          const remoteRes = await axios.get('/api/suggest', {
            params: { q: query, remote: 1 },
            signal: controller.signal
          });
          if (agentInput.value === query) {
            suggestions.value = remoteRes.data;
          }
        } catch (remoteErr) {
          if (remoteErr.name !== 'CanceledError' && remoteErr.code !== 'ERR_CANCELED') {
            console.error('远程联想失败', remoteErr);
          }
        } finally {
          if (remoteAbortController === controller) {
            remoteAbortController = null;
          }
        }
      }
    } catch (err) {
      console.error('获取联想失败', err);
      suggestions.value = [];
    }
  }, 150);
});

const selectSuggestion = (item) => {
  agentInput.value = item.kanji || item.kana || '';
  showDropdown.value = false;
  nextTick(() => document.getElementById('agent-command')?.focus());
};

const hideSuggestionsWithDelay = () => {
  setTimeout(() => {
    showDropdown.value = false;
  }, 200);
};

const startProgress = () => {
  aiProgress.value = 0;
  if (aiProgressInterval) clearInterval(aiProgressInterval);
  // 假设通常响应在 6-10 秒左右
  aiProgressInterval = setInterval(() => {
    if (aiProgress.value < 90) {
      aiProgress.value += (90 - aiProgress.value) * 0.1;
    }
  }, 500);
};

const completeProgress = () => {
  if (aiProgressInterval) clearInterval(aiProgressInterval);
  aiProgress.value = 100;
  setTimeout(() => {
    aiProgress.value = 0;
  }, 500);
};

onUnmounted(() => {
  if (aiProgressInterval) clearInterval(aiProgressInterval);
  if (hotPlaceholderRefreshInterval) window.clearInterval(hotPlaceholderRefreshInterval);
  if (llmSaveMessageTimer) window.clearTimeout(llmSaveMessageTimer);
  if (embeddingSaveMessageTimer) window.clearTimeout(embeddingSaveMessageTimer);
  if (suggestTimeout) { clearTimeout(suggestTimeout); suggestTimeout = null; }
  if (remoteAbortController) { remoteAbortController.abort(); remoteAbortController = null; }
});

const conjugate = async () => {
  if (loading.value) return;
  if (aiAbortController) {
    aiAbortController.abort();
    aiAbortController = null;
  }
  loadingAi.value = false;
  error.value = '';
  result.value = null;
  aiRawExplanation.value = '';
  aiError.value = '';
  verificationStatus.value = {};
  aiExamples.value = [];
  agentPlan.value = null;
  similarWords.value = [];

  if (!form.value.verb || !form.value.verb.trim()) {
    error.value = '请输入动词';
    // 当错误时，让输入框获取焦点
    setTimeout(() => {
      document.getElementById('agent-command')?.focus();
    }, 50);
    return;
  }

  loading.value = true;
  try {
    const response = await axios.get('/api/conjugate', {
      params: {
        verb: form.value.verb
      }
    });
    result.value = response.data;

    // 如果返回了动词结果，同步回输入框
    if (result.value.dictionaryForm) {
      form.value.verb = result.value.dictionaryForm;
    } else if (result.value.word) {
      form.value.verb = result.value.word;
    }

    // 添加到查询历史（去重+置顶）
    addToHistory(result.value);

    refreshAgentPlan(result.value);

    // 自动触发 AI 解析
    fetchAiExplanation();
  } catch (err) {
    error.value = err.response?.data?.error || '请求失败，请检查输入';
    // 错误时重置结果状态
    result.value = null;
    // 错误时让输入框获取焦点，保留用户输入以便修正
    setTimeout(() => {
      document.getElementById('agent-command')?.focus();
    }, 50);
  } finally {
    loading.value = false;
  }
};

let aiAbortController = null;

const fetchAiExplanation = async () => {
  const wordName = result.value?.dictionaryForm || result.value?.word;
  if (!wordName) return;

  if (aiAbortController) {
    aiAbortController.abort();
  }
  const controller = new AbortController();
  aiAbortController = controller;

  const currentWordType = result.value?.wordType || 'verb';
  const currentIsVerb = currentWordType === 'verb';

  loadingAi.value = true;
  aiError.value = '';
  aiRawExplanation.value = '';
  verificationStatus.value = {};
  aiExamples.value = [];
  const requestBody = {
    verb: wordName,
    model: selectedModel.value || undefined,
    conjugationResult: currentIsVerb ? result.value : undefined,
    wordType: currentWordType,
    wordInfo: !currentIsVerb ? result.value : undefined
  };

  try {
    startProgress();
    const response = await fetch(apiUrl('/api/ai-explain'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...buildAuthHeaders(),
        ...buildLlmHeaders()
      },
      signal: controller.signal,
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      // 区分 no_llm_key（自带 key 模式未配置）和真实网络错误
      let errBody = null;
      try { errBody = await response.json(); } catch { /* 非 JSON 当作普通错误 */ }
      if (errBody?.code === 'no_llm_key') {
        aiError.value = errBody.error;
        showLlmSettings.value = true;
        completeProgress();
        return;
      }
      throw new Error(errBody?.error || '网络请求失败');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let fullAiText = '';

    loadingAi.value = false; // 流式请求开始接收，停止显示 loading spinner

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        // 处理 buffer 中可能残留的最后一条数据
        if (buffer.trim()) {
          const eventStr = buffer.trim();
          if (eventStr.startsWith('data: ')) {
            const dataStr = eventStr.slice(6);
            if (dataStr === '[DONE]') {
              completeProgress();
            } else {
              try {
                const data = JSON.parse(dataStr);
                if (data.content) {
                  fullAiText += data.content;
                }
              } catch (e) {
                // ignore incomplete data
              }
            }
          }
        }
        break;
      }

      buffer += decoder.decode(value, { stream: true });

      let eventEndIndex;
      while ((eventEndIndex = buffer.indexOf('\n\n')) >= 0) {
        const eventStr = buffer.slice(0, eventEndIndex);
        buffer = buffer.slice(eventEndIndex + 2);

        if (eventStr.startsWith('data: ')) {
          const dataStr = eventStr.slice(6);
          if (dataStr === '[DONE]') {
            completeProgress();
            break;
          }
          try {
            const data = JSON.parse(dataStr);
            if (data.error) {
              aiError.value = data.error;
              completeProgress();
            } else if (data.content) {
              fullAiText += data.content;

              // 尝试匹配 AI 返回的 JSON 代码块
              const jsonMatch = fullAiText.match(/```(?:json)?\s*\n([\s\S]*?)(?:\n```|$)/i);
              if (jsonMatch) {
                try {
                  // 如果代码块完整，直接解析
                  const parsed = JSON.parse(jsonMatch[1]);
                  verificationStatus.value = parsed.verification || parsed;
                  if (parsed.examples) {
                    aiExamples.value = parsed.examples;
                  }
                  aiRawExplanation.value = fullAiText.substring(jsonMatch.index + jsonMatch[0].length).trim();
                } catch (e) {
                  // JSON 解析失败说明还在流式输出 JSON，尝试用部分匹配提前点亮 ✅
                  const partialJson = jsonMatch[1];
                  // 用正则匹配完整的 "key": { "isCorrect": true/false, "correction": "..." } 结构
                  const completeItemRegex = /"(negative|polite|teForm|taForm|potential|passive|causative|imperative|volitional)"\s*:\s*\{\s*"isCorrect"\s*:\s*(true|false)\s*,\s*"correction"\s*:\s*"([^"]*)"\s*\}/g;
                  let match;
                  while ((match = completeItemRegex.exec(partialJson)) !== null) {
                    const key = match[1];
                    const isCorrect = match[2] === 'true';
                    const correction = match[3];
                    if (!verificationStatus.value[key]) {
                      verificationStatus.value = {
                        ...verificationStatus.value,
                        [key]: { isCorrect, correction }
                      };
                    }
                  }
                  // 由于 JSON 块在最前面，还没解析完时，JSON块之后的内容为空，所以暂不显示
                  aiRawExplanation.value = '';
                }
              } else {
                // 如果还没有遇到 JSON 块开头，或者内容中没有 JSON 块，直接显示当前所有内容
                // 因为我们要求 AI 必须以 JSON 块开头，如果没遇到说明还在生成开头的 ```json 或者 AI 违背了指令
                if (!fullAiText.includes('```')) {
                  aiRawExplanation.value = ''; // 等待 JSON 块
                } else {
                  // 如果遇到了块开头，但还没闭合，只显示开头前面的部分(理论上应该是空)
                  const blockStart = fullAiText.indexOf('```');
                  aiRawExplanation.value = fullAiText.substring(0, blockStart).trim();
                }
              }
            }
          } catch (e) {
            console.error('JSON Parse Error', e);
          }
        }
      }
    }
  } catch (err) {
    if (err.name === 'AbortError') {
      completeProgress();
      return;
    }
    aiError.value = err.message || 'AI 解析请求失败';
    completeProgress();
  } finally {
    if (aiAbortController === controller) {
      loadingAi.value = false;
      aiAbortController = null;
    }
  }
};
</script>

<style scoped>

* {
  box-sizing: border-box;
}

:global(body) {
  margin: 0;
  /* 磨砂玻璃的底层：色斑要够明显且覆盖中部，卡片 backdrop-filter 才有内容可磨 */
  background:
    radial-gradient(1100px 760px at 12% -8%, rgba(185, 95, 69, 0.16), transparent 60%),
    radial-gradient(950px 660px at 86% 10%, rgba(240, 217, 181, 0.6), transparent 58%),
    radial-gradient(800px 580px at 30% 55%, rgba(143, 190, 142, 0.12), transparent 62%),
    radial-gradient(900px 620px at 72% 108%, rgba(185, 95, 69, 0.12), transparent 60%),
    #f4f1ea;
  background-attachment: fixed;
  color: #191714;
  font-family: "Songti SC", "STSong", "Source Han Serif SC", "Noto Serif SC", "Noto Serif JP", "Hiragino Mincho ProN", "Yu Mincho", "游明朝", serif;
  font-feature-settings: "palt" 1;
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-rendering: optimizeLegibility;
  transition: background-color 0.25s ease, color 0.25s ease;
}

:global(html[data-theme='dark'] body) {
  background:
    radial-gradient(1100px 760px at 12% -8%, rgba(224, 139, 112, 0.15), transparent 60%),
    radial-gradient(950px 660px at 88% 6%, rgba(82, 71, 60, 0.55), transparent 56%),
    radial-gradient(800px 580px at 30% 58%, rgba(118, 148, 128, 0.09), transparent 62%),
    radial-gradient(900px 620px at 68% 112%, rgba(224, 139, 112, 0.1), transparent 60%),
    #141210;
  background-attachment: fixed;
  color: #f4f1ea;
}

/* liquid glass 的"液"：两团缓慢漂移的光斑，被卡片的 backdrop-filter 取样后产生流动的磨砂色彩 */


:global(body::before),
:global(body::after) {
  content: '';
  position: fixed;
  z-index: -1;
  border-radius: 50%;
  filter: blur(90px);
  pointer-events: none;
}

:global(body::before) {
  width: 54vw;
  height: 54vw;
  left: -10vw;
  top: -16vh;
  background: radial-gradient(circle at 32% 32%, rgba(224, 156, 124, 0.22), transparent 70%);
  animation: aurora-drift-a 48s ease-in-out infinite alternate;
}

:global(body::after) {
  width: 46vw;
  height: 46vw;
  right: -12vw;
  bottom: -18vh;
  background: radial-gradient(circle at 62% 62%, rgba(240, 217, 181, 0.3), transparent 70%);
  animation: aurora-drift-b 62s ease-in-out infinite alternate;
}

:global(html[data-theme='dark'] body::before) {
  background: radial-gradient(circle at 32% 32%, rgba(224, 139, 112, 0.13), transparent 70%);
}

:global(html[data-theme='dark'] body::after) {
  background: radial-gradient(circle at 62% 62%, rgba(150, 132, 110, 0.16), transparent 70%);
}

@keyframes aurora-drift-a {
  from { transform: translate(0, 0) scale(1); }
  to { transform: translate(14vw, 12vh) scale(1.18); }
}

@keyframes aurora-drift-b {
  from { transform: translate(0, 0) scale(1.1); }
  to { transform: translate(-12vw, -14vh) scale(0.94); }
}

@media (prefers-reduced-motion: reduce) {
  :global(body::before),
  :global(body::after) {
    animation: none;
  }
}

:global(html[data-accessibility='on']) {
  font-size: 18px;
  scroll-behavior: auto;
}

.container {
  --surface: rgba(255, 253, 247, 0.58);
  --surface-soft: rgba(250, 246, 238, 0.55);
  --surface-muted: rgba(232, 225, 212, 0.5);
  --surface-border: rgba(110, 100, 88, 0.16);
  --field-bg: rgba(255, 253, 248, 0.78);
  --panel-bg: rgba(252, 249, 242, 0.62);
  --dropdown-bg: rgba(255, 252, 245, 0.92);
  --glass-blur: blur(22px) saturate(1.6);
  /* 顶部亮沿 + 底部暗沿：模拟玻璃片厚度 */
  --glass-highlight: inset 0 1px 0 rgba(255, 255, 255, 0.55), inset 0 -1px 0 rgba(25, 23, 20, 0.05);
  /* 极淡灰度噪点（feTurbulence + 灰度矩阵），叠在玻璃面上形成"磨砂"颗粒 */
  --glass-noise: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix type='matrix' values='0 0 0 0 0.5 0 0 0 0 0.5 0 0 0 0 0.5 0 0 0 0.045 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
  --text-primary: #191714;
  --text-secondary: #3d3832;
  --text-muted: #756d63;
  --primary: #b95f45;
  --primary-hover: #984d38;
  --primary-soft: rgba(185, 95, 69, 0.11);
  --accent: #191714;
  --accent-soft: rgba(25, 23, 20, 0.08);
  --success: #3f7d55;
  --danger: #a33d2f;
  --error: var(--danger);
  --border: var(--surface-border);
  --shadow-soft: 0 1px 2px rgba(25, 23, 20, 0.04), 0 6px 16px rgba(25, 23, 20, 0.06);
  --shadow-lift: 0 2px 4px rgba(25, 23, 20, 0.05), 0 20px 42px rgba(25, 23, 20, 0.11);
  --focus-ring: 0 0 0 3px rgba(185, 95, 69, 0.24);
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 28px;
  --radius-sm: 6px;
  --radius-md: 10px;
  --radius-lg: 16px;
  --font-ui: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans SC", sans-serif;
  /* Apple 风格非线性缓动：spring 带轻微回弹，out 为平滑减速 */
  --ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --ease-in-out: cubic-bezier(0.65, 0, 0.35, 1);
  min-height: 100vh;
  padding: 28px 22px 48px;
  max-width: 1240px;
  margin: 0 auto;
}

.container.app-dark {
  --surface: rgba(42, 38, 34, 0.55);
  --surface-soft: rgba(48, 44, 38, 0.5);
  --surface-muted: rgba(72, 66, 58, 0.55);
  --surface-border: rgba(244, 241, 234, 0.14);
  --field-bg: rgba(34, 31, 28, 0.7);
  --panel-bg: rgba(44, 40, 35, 0.55);
  --dropdown-bg: rgba(32, 29, 26, 0.92);
  --glass-highlight: inset 0 1px 0 rgba(255, 255, 255, 0.09), inset 0 -1px 0 rgba(0, 0, 0, 0.28);
  --text-primary: #f4f1ea;
  --text-secondary: #ded8cc;
  --text-muted: #a69d91;
  --primary: #e08b70;
  --primary-hover: #f0a28a;
  --primary-soft: rgba(224, 139, 112, 0.14);
  --accent: #f4f1ea;
  --accent-soft: rgba(244, 241, 234, 0.1);
  --success: #8fbe8e;
  --danger: #f19a84;
  --shadow-soft: 0 1px 2px rgba(0, 0, 0, 0.3), 0 8px 22px rgba(0, 0, 0, 0.32);
  --shadow-lift: 0 2px 6px rgba(0, 0, 0, 0.34), 0 22px 46px rgba(0, 0, 0, 0.42);
  --focus-ring: 0 0 0 3px rgba(224, 139, 112, 0.3);
}

.container.app-accessible {
  --surface-border: rgba(71, 85, 105, 0.8);
  --focus-ring: 0 0 0 4px rgba(255, 193, 7, 0.75);
  line-height: 1.65;
}

.header {
  text-align: left;
  color: var(--text-primary);
  margin-bottom: 28px;
}

.header-top,
.header-bottom {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
}

.header-top {
  justify-content: flex-end;
  padding-bottom: 18px;
  border-bottom: 1px solid var(--surface-border);
}

.header-bottom {
  padding-top: 14px;
}

.nav-llm-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  max-width: min(280px, 42vw);
  height: 28px;
  border: 1px solid transparent;
  border-radius: 999px;
  background: transparent;
  color: var(--text-muted);
  padding: 0 10px;
  cursor: pointer;
  font: inherit;
  font-size: 0.74rem;
  font-weight: 600;
  opacity: 0.75;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nav-llm-toggle .icon {
  width: 13px;
  height: 13px;
  flex: 0 0 auto;
}

.nav-llm-toggle:hover {
  color: var(--text-primary);
  border-color: var(--surface-border);
  opacity: 1;
}

.nav-llm-panel {
  display: grid;
  grid-template-columns: 120px minmax(140px, 1fr) minmax(190px, 1.3fr) minmax(150px, 1fr) auto;
  gap: 8px;
  margin-top: 10px;
  padding: 10px;
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-md);
  background: var(--surface);
  box-shadow: var(--shadow-soft);
}

.nav-llm-panel .agent-chip:disabled {
  opacity: 0.72;
  cursor: wait;
}

.agent-chip--saved {
  color: var(--success);
  border-color: color-mix(in srgb, var(--success) 42%, var(--surface-border));
  background: color-mix(in srgb, var(--success) 10%, var(--field-bg));
}

.agent-chip--error {
  color: var(--danger);
  border-color: color-mix(in srgb, var(--danger) 42%, var(--surface-border));
  background: color-mix(in srgb, var(--danger) 8%, var(--field-bg));
}

.mini-spinner {
  width: 13px;
  height: 13px;
  border: 2px solid color-mix(in srgb, currentColor 25%, transparent);
  border-top-color: currentColor;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

.nav-llm-save-message {
  grid-column: 1 / -1;
  justify-self: start;
  min-height: 18px;
  color: var(--text-muted);
  font-size: 0.76rem;
  line-height: 1.4;
}

.nav-llm-save-message--embedding {
  justify-self: start;
}

.nav-llm-save-message--saved {
  color: var(--success);
}

.nav-llm-save-message--error {
  color: var(--danger);
}

.nav-llm-panel select,
.nav-llm-panel input {
  height: 34px;
  min-width: 0;
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-sm);
  background: var(--field-bg);
  color: var(--text-primary);
  padding: 0 9px;
  font: inherit;
  font-size: 0.82rem;
}

.nav-llm-credit {
  grid-column: 1 / -1;
  justify-self: end;
  color: var(--text-muted);
  font-size: 0.74rem;
  text-decoration: none;
  transition: color 160ms ease;
}

.nav-llm-credit:hover {
  color: var(--primary);
}

.eyebrow {
  margin: 0 0 2px;
  color: var(--primary);
  font-size: 0.78rem;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.header h1 {
  font-size: 2.15rem;
  margin: 0 0 4px;
  letter-spacing: 0;
  font-weight: 800;
  line-height: 1.1;
}

.subtitle {
  margin: 0;
  font-size: 0.98rem;
  color: var(--text-muted);
  font-weight: 500;
}

.preference-bar {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  flex-wrap: wrap;
}

.pref-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  padding: 0;
  color: var(--text-secondary);
  background: var(--surface);
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-md);
  cursor: pointer;
  box-shadow: 0 10px 22px rgba(24, 35, 31, 0.06);
  transition: color 0.25s var(--ease-out), background 0.25s var(--ease-out),
    border-color 0.25s var(--ease-out), transform 0.35s var(--ease-spring),
    box-shadow 0.25s var(--ease-out);
}

.pref-icon .icon {
  width: 20px;
  height: 20px;
  transition: transform 0.45s var(--ease-spring);
}

.pref-icon:hover {
  color: var(--primary);
  border-color: var(--primary);
  transform: translateY(-1px);
}

.pref-icon:active {
  transform: scale(0.92);
}

.pref-icon.is-on {
  color: #fff;
  background: var(--primary);
  border-color: var(--primary);
  box-shadow: 0 8px 20px color-mix(in srgb, var(--primary) 32%, transparent);
}

.pref-icon.is-on:hover {
  color: #fff;
}

/* 点亮时图标转入，月亮/无障碍带轻微旋转 */


.pref-icon.is-on .icon {
  transform: rotate(-12deg) scale(1.05);
}

.pref-icon:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}

.pref-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 40px;
  padding: 0 14px;
  border: 1px solid var(--surface-border);
  border-radius: 999px;
  background: color-mix(in srgb, var(--surface) 92%, transparent);
  color: var(--text-secondary);
  font-size: 0.9rem;
  font-weight: 700;
  cursor: pointer;
  transition: color 0.25s var(--ease-out), border-color 0.25s var(--ease-out),
    background 0.25s var(--ease-out), transform 0.3s var(--ease-spring);
}

.pref-link .icon {
  width: 15px;
  height: 15px;
}

.pref-link:hover {
  color: var(--text-primary);
  border-color: color-mix(in srgb, var(--primary) 30%, var(--surface-border));
  background: var(--field-bg);
  transform: translateY(-1px);
}

.pref-link.active {
  color: var(--primary);
  border-color: color-mix(in srgb, var(--primary) 40%, var(--surface-border));
  background: color-mix(in srgb, var(--primary) 8%, var(--field-bg));
}

/* === 登录用户区 + 认证弹窗 === */


.auth-user {
  display: inline-flex;
  align-items: center;
  min-height: 40px;
  padding: 0 12px;
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--primary);
  font-weight: 700;
  font-size: 0.9rem;
}

.pref-link:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}

/* === 模式切换 === */


.mode-switch {
  display: inline-flex;
  background: var(--surface);
  padding: 4px;
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-soft), var(--glass-highlight);
  border: 1px solid var(--surface-border);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
}

.mode-switch button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  background: transparent;
  border: none;
  padding: 8px 18px;
  font-size: 0.92em;
  font-weight: 700;
  color: var(--text-muted);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: all 0.3s ease;
}

.mode-switch button .icon {
  width: 15px;
  height: 15px;
}

.mode-switch button.active {
  background: var(--field-bg);
  color: var(--primary);
  box-shadow: 0 1px 2px rgba(25, 23, 20, 0.08), 0 6px 16px rgba(25, 23, 20, 0.12);
}

/* === 搜索栏 === */


.search-wrapper {
  max-width: 820px;
  margin: 0 0 34px;
  position: relative;
}

.search-bar {
  display: flex;
  align-items: center;
  background: var(--surface);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-lift), var(--glass-highlight);
  padding: 6px 6px 6px 14px;
  transition: box-shadow 0.25s ease, border-color 0.25s ease, background-color 0.25s ease;
  border: 1px solid var(--surface-border);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
}

.search-bar:focus-within {
  box-shadow: var(--focus-ring), var(--shadow-lift);
  border-color: var(--primary);
  background: var(--field-bg);
}

.search-bar--error {
  border-color: rgba(220, 38, 38, 0.4);
  box-shadow: 0 16px 32px rgba(220, 38, 38, 0.12);
}

.search-bar--success {
  border-color: rgba(22, 163, 74, 0.38);
}

.search-icon {
  margin-right: 10px;
  flex-shrink: 0;
  color: var(--text-muted);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.search-input {
  flex: 1;
  border: none;
  outline: none;
  font-size: 1.08em;
  padding: var(--space-3) var(--space-2);
  background: transparent;
  color: var(--text-primary);
  min-width: 0;
}

.search-input::placeholder {
  color: var(--text-muted);
}

/* .search-btn（含 hover/active/disabled）已移至 styles/shared.css（全局共享） */



/* 圆形箭头执行按钮 */

/* === 下拉补全 === */

/* === 主内容区 === */


.main-content {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 18px;
  margin-bottom: 36px;
  animation: fadeIn 0.4s ease;
}

.left-section,
.right-section {
  min-width: 0;
}

.right-section {
  position: sticky;
  top: 18px;
  align-self: start;
}

@media (max-width: 1024px) {
  .main-content {
    grid-template-columns: 1fr;
  }
  .right-section {
    position: static;
  }
}

/* === 卡片 === */


/* .card / .card h3 已移至 styles/shared.css（全局共享） */



.error-message {
  color: var(--danger);
  background-color: rgba(254, 226, 226, 0.16);
  border: 1px solid rgba(248, 113, 113, 0.46);
  padding: 10px var(--space-4);
  border-radius: var(--radius-md);
  margin-top: 10px;
  font-size: 0.88em;
}

.result-card {
  animation: cardIn 0.4s ease both;
}

.result-card + .result-card {
  margin-top: 20px;
}

/* === 记忆与 Agent === */


.memory-panel,
.agent-panel {
  margin: 0 0 24px;
}

.memory-header,
.agent-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.agent-header--minimal {
  justify-content: flex-end;
  margin-bottom: 10px;
}

.memory-header h2,
.agent-header h2 {
  margin: 0;
  color: var(--text-primary);
  font-size: 1.05rem;
  font-weight: 760;
}

.memory-header h2 .icon {
  color: var(--primary);
}

.memory-eyebrow {
  margin-bottom: 4px;
}

.agent-status {
  padding: 4px 7px;
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-sm);
  background: var(--panel-bg);
  color: var(--text-secondary);
  font-size: 0.75rem;
}

/* 记忆状态红绿灯：暗色灯箱内三个发光圆灯，只标数字 */


.memory-traffic {
  display: inline-flex;
  align-items: center;
  gap: 9px;
  padding: 6px 11px;
  border-radius: 999px;
  background: linear-gradient(180deg, #2a2723, #1c1916);
  box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.5), 0 2px 8px rgba(0, 0, 0, 0.14);
}

.traffic-dot {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 999px;
  font-family: var(--font-ui);
  font-size: 0.8rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: rgba(255, 255, 255, 0.45);
  background: rgba(255, 255, 255, 0.06);
  --dot: #6b7280;
  transition: color 0.4s var(--ease-out), background 0.4s var(--ease-out), box-shadow 0.4s var(--ease-out), transform 0.4s var(--ease-spring);
}

.traffic-dot--red { --dot: #ff5f56; }

.traffic-dot--amber { --dot: #febc2e; }

.traffic-dot--green { --dot: #28c840; }

/* 点亮：实色 + 外发光 + 轻微放大，呼吸脉冲 */


.traffic-dot.is-active {
  color: #fff;
  background: var(--dot);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--dot) 60%, transparent),
    0 0 12px color-mix(in srgb, var(--dot) 70%, transparent);
  transform: scale(1.04);
}

.traffic-dot--red.is-active {
  animation: trafficPulse 2.4s var(--ease-in-out) infinite;
}

@keyframes trafficPulse {
  0%, 100% {
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--dot) 60%, transparent),
      0 0 10px color-mix(in srgb, var(--dot) 55%, transparent);
  }
  50% {
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--dot) 70%, transparent),
      0 0 18px color-mix(in srgb, var(--dot) 90%, transparent);
  }
}

@media (prefers-reduced-motion: reduce) {
  .traffic-dot--red.is-active { animation: none; }
  .search-btn__spinner { animation-duration: 1.2s; }
}

.memory-quota {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  font-size: 0.8rem;
  color: var(--text-muted);
}

.memory-quota strong {
  color: var(--primary);
  font-variant-numeric: tabular-nums;
}

.memory-quota-dot {
  color: var(--surface-border);
}

.memory-review {
  display: grid;
  grid-template-columns: minmax(132px, 0.55fr) minmax(0, 1fr) auto;
  gap: 10px;
  align-items: center;
}

.memory-card-face {
  min-height: 88px;
  border: 1px solid var(--surface-border);
  border-left: 3px solid var(--primary);
  border-radius: var(--radius-sm);
  background: var(--panel-bg);
  padding: 12px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 4px;
}

.memory-word {
  color: var(--text-primary);
  font-size: 1.35rem;
  font-weight: 760;
  line-height: 1.15;
}

.memory-reading,
.memory-type {
  color: var(--text-muted);
  font-size: 0.8rem;
}

.memory-answer {
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-sm);
  background: var(--field-bg);
  padding: 11px 12px;
  color: var(--text-secondary);
  line-height: 1.48;
  font-size: 0.88rem;
  min-height: 68px;
}

.memory-answer p {
  margin: 0;
}

.memory-sample {
  margin-top: 7px;
  color: var(--text-primary);
  font-weight: 680;
}

.memory-actions {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.memory-btn,
.memory-grade {
  height: 30px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--surface-border);
  background: var(--field-bg);
  color: var(--text-primary);
  padding: 0 10px;
  cursor: pointer;
  font-weight: 680;
  font-size: 0.82rem;
}

.memory-btn.active {
  color: var(--primary);
  background: var(--primary-soft);
  border-color: var(--primary);
}

.grade-forgot {
  color: var(--danger);
}

.grade-hard {
  color: var(--accent);
}

.grade-good {
  color: var(--success);
}

.memory-empty {
  padding: 18px;
  border: 1px dashed var(--surface-border);
  border-radius: var(--radius-md);
  background: var(--panel-bg);
  color: var(--text-muted);
}

.memory-empty strong {
  display: block;
  color: var(--text-primary);
  margin-bottom: 4px;
}

.memory-empty p {
  margin: 0;
}

.memory-library {
  margin-top: 18px;
  padding-top: 14px;
  border-top: 1px solid var(--surface-border);
}

.memory-library-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}

.memory-library-search {
  flex: 1 1 220px;
  min-width: 0;
  height: 34px;
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-sm);
  background: var(--field-bg);
  color: var(--text-primary);
  padding: 0 11px;
  font: inherit;
}

.memory-library-filters {
  display: inline-flex;
  gap: 6px;
  flex-wrap: wrap;
}

.memory-library-filter,
.memory-library-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  height: 30px;
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-sm);
  background: var(--field-bg);
  color: var(--text-secondary);
  padding: 0 10px;
  cursor: pointer;
  font: inherit;
  font-size: 0.8rem;
  font-weight: 650;
}

.memory-library-action .icon {
  width: 13px;
  height: 13px;
}

.memory-library-filter.active,
.memory-library-action:hover {
  color: var(--primary);
  border-color: var(--primary);
  background: var(--primary-soft);
}

.memory-library-list {
  display: grid;
  grid-template-columns: 1fr;
  gap: 8px;
  max-height: 320px;
  overflow: auto;
  padding-right: 2px;
}

.memory-library-item {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 10px;
  align-items: center;
  padding: 11px 12px;
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-sm);
  background: var(--panel-bg);
}

.memory-library-copy {
  min-width: 0;
}

.memory-library-copy strong,
.memory-library-copy span {
  display: block;
}

.memory-library-copy strong {
  color: var(--text-primary);
  font-size: 0.96rem;
}

.memory-library-copy span {
  margin-top: 3px;
  color: var(--text-muted);
  font-size: 0.78rem;
}

.memory-library-copy p {
  margin: 6px 0 0;
  color: var(--text-secondary);
  font-size: 0.84rem;
  line-height: 1.45;
}

.memory-library-meta {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
  white-space: nowrap;
}

.memory-library-meta small {
  color: var(--text-muted);
  font-size: 0.74rem;
}

.memory-library-empty {
  padding: 14px 0 2px;
  color: var(--text-muted);
  font-size: 0.84rem;
}

/* Agent 长期记忆区 */


.agent-memory-block {
  margin-top: 22px;
  padding-top: 18px;
  border-top: 1px dashed var(--surface-border);
}

.agent-memory-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}

.agent-memory-head h3 {
  margin: 0;
  font-size: 1rem;
  color: var(--text-primary);
}

.agent-memory-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.agent-memory-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-sm);
  background: var(--field-bg);
}

.agent-memory-tag {
  flex-shrink: 0;
  font-size: 0.72rem;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 999px;
  color: var(--primary);
  background: var(--primary-soft);
}

.agent-memory-tag[data-type="fact"] { color: var(--text-secondary); background: var(--surface-muted); }

.agent-memory-value {
  flex: 1;
  min-width: 0;
  font-size: 0.9rem;
  color: var(--text-secondary);
}

.agent-memory-del {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  border: none;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  padding: 4px;
  border-radius: var(--radius-sm);
  transition: color 0.2s, background 0.2s;
}

.agent-memory-del .icon {
  width: 14px;
  height: 14px;
}

.agent-memory-del:hover {
  color: var(--danger);
  background: var(--surface-muted);
}

.agent-memory-empty {
  margin: 0;
  font-size: 0.84rem;
  color: var(--text-muted);
  line-height: 1.6;
}

/* 首屏引导 */

/* .agent-chip（含 hover）已移至 styles/shared.css（全局共享） */



.agent-secondary-actions {
  display: flex;
  gap: 7px;
  justify-content: flex-end;
  margin-top: 8px;
}

.agent-capability-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  margin-bottom: 14px;
}

.agent-capability {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-sm);
  background:
    linear-gradient(135deg, rgba(255, 255, 255, 0.7), transparent),
    var(--field-bg);
}

.agent-capability .icon {
  width: 20px;
  height: 20px;
  color: var(--primary);
  flex: 0 0 auto;
}

.agent-capability strong {
  display: block;
  color: var(--text-primary);
  font-size: 0.92rem;
}

.agent-capability span {
  display: block;
  color: var(--text-muted);
  font-size: 0.82rem;
  margin-top: 2px;
}

.agent-runtime {
  display: flex;
  gap: 6px;
  margin: 10px 0 6px;
  overflow-x: auto;
  padding-bottom: 3px;
  scrollbar-width: thin;
}

.agent-runtime-node {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 30px;
  min-width: 108px;
  padding: 5px 8px;
  border: 1px solid var(--surface-border);
  border-radius: 999px;
  background: transparent;
  opacity: 0.68;
  transform: translateY(0);
  transition: opacity 0.22s ease, border-color 0.22s ease, background-color 0.22s ease, transform 0.22s ease;
}

.agent-runtime-node--running {
  opacity: 1;
  border-color: var(--primary);
  background:
    linear-gradient(110deg, transparent 0%, rgba(255, 255, 255, 0.26) 45%, transparent 70%),
    var(--primary-soft);
  background-size: 220% 100%;
  transform: translateY(-1px);
  box-shadow: 0 5px 14px rgba(22, 125, 119, 0.1);
  animation: agentSheen 1.6s ease-in-out infinite;
}

.agent-runtime-node--done {
  opacity: 1;
}

.runtime-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--surface-border);
  flex: 0 0 auto;
}

.agent-runtime-node--running .runtime-dot {
  background: var(--primary);
  box-shadow: 0 0 0 4px var(--primary-soft);
  animation: pulseDot 1.25s ease-in-out infinite;
}

.agent-runtime-node--done .runtime-dot {
  background: var(--success);
}

.agent-runtime-node strong {
  display: block;
  color: var(--text-primary);
  font-size: 0.78rem;
  line-height: 1.1;
  white-space: nowrap;
}

/* 主搜索框：方形（圆角矩形），聚焦时主色描边 */

.agent-chat--trace {
  margin-top: 10px;
  padding: 10px 14px;
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-md);
  background: var(--field-bg);
}

.agent-runtime-note {
  margin: -2px 0 12px;
  color: var(--text-muted);
  font-size: 0.8rem;
  line-height: 1.45;
}

.agent-subagent-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: -2px 0 12px;
}

.agent-subagent-pill {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  border: 1px solid var(--surface-border);
  border-radius: 999px;
  background: var(--panel-bg);
  color: var(--text-secondary);
  padding: 6px 11px;
  font: inherit;
  font-size: 0.8rem;
  cursor: pointer;
}

.agent-subagent-pill__name {
  color: var(--text-primary);
  font-weight: 700;
}

.agent-subagent-pill--running {
  border-color: color-mix(in srgb, var(--primary) 28%, var(--surface-border));
  background: color-mix(in srgb, var(--primary-soft) 68%, transparent);
}

.agent-subagent-pill--completed {
  border-color: color-mix(in srgb, var(--success) 26%, var(--surface-border));
}

.agent-subagent-pill--failed,
.agent-subagent-pill--timed_out {
  border-color: color-mix(in srgb, var(--danger) 34%, var(--surface-border));
  background: color-mix(in srgb, var(--danger) 8%, transparent);
}

.agent-subagent-card {
  margin: -2px 0 12px;
  padding: 11px 12px;
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-md);
  background: var(--panel-bg);
}

.agent-subagent-card__head,
.agent-subagent-card__meta,
.agent-subagent-card__event {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.agent-subagent-card__head {
  margin-bottom: 7px;
  color: var(--text-primary);
}

.agent-subagent-card__meta {
  flex-wrap: wrap;
  margin-bottom: 7px;
  color: var(--text-muted);
  font-size: 0.78rem;
}

.agent-subagent-card__events {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.agent-subagent-card__event {
  color: var(--text-secondary);
  font-size: 0.8rem;
}

.agent-usage-banner {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: -2px 0 12px;
  color: var(--text-muted);
  font-size: 0.78rem;
  line-height: 1.45;
}

.agent-usage-banner strong {
  font-weight: 700;
}

.agent-usage-banner--ok strong {
  color: var(--text-secondary);
}

.agent-usage-banner--warn strong {
  color: #9a6700;
}

.agent-usage-banner--danger strong {
  color: var(--danger);
}

/* 加号 / 减号圆形徽标 */

/* 已加入：徽标变实色减号，悬停旋转回去暗示「移除」 */

.agent-flow-enter-active {
  transition: opacity 0.4s var(--ease-out), transform 0.5s var(--ease-spring);
}

.agent-flow-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.agent-flow-enter-from,
.agent-flow-leave-to {
  opacity: 0;
  transform: translateY(12px) scale(0.99);
}

.agent-chat-log {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 10px;
  max-height: 360px;
  overflow-y: auto;
}

.agent-message {
  padding: 10px 12px;
  border-radius: var(--radius-sm);
  background: transparent;
  border: 0;
}

.agent-message-list-enter-active,
.agent-message-list-leave-active,
.agent-tool-list-enter-active,
.agent-tool-list-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.agent-message-list-enter-from,
.agent-message-list-leave-to,
.agent-tool-list-enter-from,
.agent-tool-list-leave-to {
  opacity: 0;
  transform: translateY(8px);
}

.agent-message--user {
  background: var(--accent-soft);
}

.agent-message--assistant {
  background: var(--field-bg);
  border: 1px solid var(--surface-border);
}

.agent-message strong {
  display: block;
  color: var(--text-primary);
  margin-bottom: 4px;
}

.agent-message p {
  margin: 0;
  color: var(--text-secondary);
  line-height: 1.65;
  white-space: pre-wrap;
}

.agent-tool-trace {
  display: grid;
  gap: 8px;
  margin-top: 0;
  color: var(--text-muted);
  font-size: 0.78rem;
}

.tool-trace-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-weight: 700;
  cursor: pointer;
  list-style: none;
  padding: 3px 2px;
  color: var(--text-muted);
}

.tool-trace-header::-webkit-details-marker {
  display: none;
}

.agent-tool-card {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  padding: 8px 10px;
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-sm);
  background: var(--field-bg);
  transition: opacity 0.2s ease, transform 0.2s ease, border-color 0.2s ease, background-color 0.2s ease;
}

.agent-tool-card--running {
  border-color: var(--primary);
  background: var(--primary-soft);
  transform: translateX(2px);
}

.tool-step {
  width: 18px;
  height: 18px;
  border-radius: 999px;
  background: var(--primary-soft);
  color: var(--primary);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  font-weight: 800;
  font-size: 0.72rem;
}

.agent-tool-card strong {
  color: var(--text-primary);
}

.agent-tool-card p {
  margin: 3px 0 0;
  color: var(--text-muted);
}

.agent-tool-card small {
  display: block;
  margin-top: 6px;
  color: var(--text-muted);
  line-height: 1.45;
  word-break: break-word;
}

/* 执行过程：竖向时间线 */


.agent-exec-trace .exec-trace-list {
  list-style: none;
  margin: 4px 0 0;
  padding: 0 2px;
}

.exec-trace-step {
  position: relative;
  display: grid;
  grid-template-columns: 16px 1fr;
  gap: 10px;
  padding: 6px 0;
}

.exec-trace-step::before {
  content: '';
  position: absolute;
  left: 7px;
  top: 16px;
  bottom: -6px;
  width: 1px;
  background: var(--surface-border);
}

.exec-trace-step:last-child::before {
  display: none;
}

.exec-trace-dot {
  width: 9px;
  height: 9px;
  margin-top: 5px;
  border-radius: 999px;
  background: var(--primary);
  justify-self: center;
  box-shadow: 0 0 0 3px var(--primary-soft);
}

.exec-trace-step--running .exec-trace-dot {
  animation: exec-pulse 1.2s ease-in-out infinite;
}

.exec-trace-step--error .exec-trace-dot {
  background: #e5484d;
  box-shadow: 0 0 0 3px rgba(229, 72, 77, 0.18);
}

@keyframes exec-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.35; }
}

.exec-trace-body {
  min-width: 0;
}

.exec-trace-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}

.exec-trace-head strong {
  color: var(--text-primary);
  font-size: 0.8rem;
}

.exec-trace-head time {
  color: var(--text-muted);
  font-size: 0.68rem;
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}

.exec-trace-body p {
  margin: 2px 0 0;
  color: var(--text-muted);
  line-height: 1.45;
  word-break: break-word;
}

.memory-settings {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 12px;
  margin: 0 0 18px;
  padding: 14px;
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-md);
  background: var(--panel-bg);
}

.memory-settings label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  color: var(--text-muted);
  font-size: 0.84rem;
  font-weight: 700;
}

.memory-settings input,
.memory-settings select {
  height: 38px;
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-sm);
  background: var(--field-bg);
  color: var(--text-primary);
  padding: 0 10px;
}

.settings-row {
  grid-column: 1 / -1;
}

.settings-row--switch {
  display: grid;
  grid-template-columns: 120px minmax(140px, 1fr) minmax(180px, 1.4fr) minmax(160px, 1fr) auto;
  gap: 8px;
  align-items: end;
}

.memory-settings .settings-check {
  flex-direction: row;
  align-items: center;
}

.memory-settings .settings-check input {
  width: 18px;
  height: 18px;
}

.settings-save {
  align-self: end;
}

/* === 动词活用结果 === */


.result-summary {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 16px;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--surface-border);
  animation: slideUp 0.35s ease both;
}

.summary-dict {
  font-size: 1.6em;
  font-weight: 700;
  color: var(--text-primary);
}

.summary-tag {
  font-size: 0.78em;
  padding: 3px 8px;
  background: var(--primary);
  color: white;
  border-radius: var(--radius-sm);
  font-weight: 500;
}

.summary-meaning {
  font-size: 1em;
  color: var(--text-secondary);
}

.summary-romaji {
  font-size: 0.78em;
  color: var(--text-muted);
  font-style: italic;
}

.result-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(188px, 1fr));
  gap: var(--space-3);
}

.result-item {
  display: flex;
  flex-direction: column;
  padding: 14px;
  background: var(--panel-bg);
  border-radius: var(--radius-sm);
  border-left: 4px solid var(--primary);
  animation: slideUp 0.35s ease both;
  transition: transform 0.2s, box-shadow 0.2s;
}

.result-item:hover {
  transform: translateY(-2px);
  box-shadow: 0 12px 24px rgba(24, 35, 31, 0.1);
}

.result-item .label {
  font-size: 0.82em;
  color: var(--text-muted);
  margin-bottom: 4px;
  font-weight: 500;
}

.result-item .value {
  font-size: 1.2em;
  font-weight: 600;
  color: var(--text-primary);
}

/* === 字典卡片 === */


.dict-card {
  animation: cardIn 0.4s ease both;
}

.dict-header {
  display: flex;
  align-items: baseline;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 12px;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--surface-border);
}

.dict-word {
  font-size: 2.1em;
  font-weight: 700;
  color: var(--text-primary);
  line-height: 1.6;
}

/* === 振り仮名 (Furigana) === */


ruby {
  ruby-align: center;
}

ruby rt {
  font-size: 0.5em;
  font-weight: 400;
  color: var(--primary);
  letter-spacing: 0.05em;
}

.summary-dict ruby rt {
  font-size: 0.45em;
}

.dict-reading {
  font-size: 1.15em;
  color: var(--primary);
  font-weight: 500;
}

.dict-romaji {
  font-size: 0.88em;
  color: var(--text-muted);
  font-family: monospace;
}

.dict-tags {
  display: flex;
  gap: var(--space-2);
  align-items: center;
  flex-wrap: wrap;
  margin-bottom: 16px;
}

.jlpt-badge {
  font-size: 0.78em;
  padding: 2px 8px;
  background: var(--primary-soft);
  color: var(--primary);
  border-radius: var(--radius-sm);
  font-weight: 600;
  border: 1px solid #bee3f8;
}

.common-badge {
  font-size: 0.78em;
  padding: 2px 8px;
  background: rgba(34, 197, 94, 0.12);
  color: var(--success);
  border-radius: var(--radius-sm);
  font-weight: 500;
  border: 1px solid #c6f6d5;
}

.dict-meanings h3 {
  margin-top: 0;
}

.meaning-item {
  padding: 10px 0;
  border-bottom: 1px solid var(--surface-border);
  animation: slideUp 0.3s ease both;
}

.meaning-item:last-child {
  border-bottom: none;
}

.meaning-pos {
  display: inline-block;
  font-size: 0.78em;
  color: var(--text-muted);
  background: var(--panel-bg);
  padding: 1px 8px;
  border-radius: var(--radius-sm);
  margin-right: 8px;
  margin-bottom: 4px;
}

.meaning-def {
  font-size: 1em;
  color: var(--text-primary);
}

/* === AI 卡片 === */


.ai-card {
  animation: cardIn 0.4s ease both;
}

.ai-header-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 15px;
  gap: 12px;
  flex-wrap: wrap;
}

.ai-title {
  margin-bottom: 0;
}

.ai-actions {
  display: flex;
  gap: var(--space-2);
  align-items: center;
  flex-wrap: wrap;
}

.ai-progress-container {
  width: 100%;
  height: 3px;
  background-color: var(--panel-bg);
  border-radius: 2px;
  margin-bottom: 14px;
  overflow: hidden;
}

.ai-progress-bar {
  height: 100%;
  background: linear-gradient(90deg, var(--primary), var(--accent), var(--primary));
  background-size: 200% 100%;
  animation: shimmer 1.5s ease infinite;
  transition: width 0.3s ease;
  border-radius: 2px;
}

.ai-module {
  margin-top: 18px;
  border-top: 1px solid var(--surface-border);
  padding-top: 14px;
}

.module-title {
  color: var(--text-primary);
  font-size: 1.05em;
  margin-top: 0;
  margin-bottom: 14px;
}

.examples-grid {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.example-box {
  background: var(--panel-bg);
  padding: var(--space-3);
  border-radius: var(--radius-md);
  border-left: 3px solid var(--primary);
  animation: slideUp 0.5s var(--ease-out) both;
  transition: transform 0.3s var(--ease-spring), box-shadow 0.3s var(--ease-out);
}

.example-box:nth-child(1) { animation-delay: 0.04s; }

.example-box:nth-child(2) { animation-delay: 0.12s; }

.example-box:nth-child(3) { animation-delay: 0.2s; }

.example-box:hover {
  transform: translateX(4px);
  box-shadow: var(--shadow-soft);
}

/* 例句：清晰成组的卡片区，与正文用留白分隔而非挤在一起 */

/* ── 即时练习：独立的和风选择题卡片 ── */

/* 左侧竖线点缀，呼应和风装帧 */

.ai-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 28px;
  color: var(--text-muted);
}

.spinner {
  width: 22px;
  height: 22px;
  border: 3px solid var(--surface-border);
  border-top-color: var(--primary);
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

.spinner-small {
  width: 16px;
  height: 16px;
  border: 2px solid rgba(255,255,255,0.3);
  border-top-color: white;
  border-radius: 50%;
  animation: spin 1s linear infinite;
  display: inline-block;
}

.ai-content {
  background: var(--panel-bg);
  padding: var(--space-4);
  border-radius: var(--radius-sm);
  border: 1px solid var(--surface-border);
  line-height: 1.7;
  color: var(--text-primary);
}

.btn-secondary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 0 var(--space-3);
  background: var(--panel-bg);
  color: var(--text-primary);
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-sm);
  font-size: 0.85em;
  cursor: pointer;
  transition: all 0.2s;
  height: 40px;
  font-weight: 500;
}

.btn-secondary .icon {
  width: 15px;
  height: 15px;
}

.btn-secondary:hover {
  background: var(--primary-soft);
  border-color: var(--primary);
}

.model-select {
  padding: 0 var(--space-3);
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-sm);
  background-color: var(--field-bg);
  font-size: 0.85em;
  color: var(--text-primary);
  outline: none;
  cursor: pointer;
  height: 40px;
}

.model-select:focus {
  border-color: var(--primary);
  box-shadow: var(--focus-ring);
}

.retry-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-left: 10px;
  background: none;
  border: none;
  text-decoration: underline;
  color: inherit;
  cursor: pointer;
}

.retry-btn .icon {
  width: 13px;
  height: 13px;
}

/* === AI 核对徽章 === */


.verify-badge {
  margin-left: 8px;
  font-size: 0.85em;
  display: inline-flex;
  align-items: center;
}

.text-strike {
  text-decoration: line-through;
  color: var(--text-muted);
}

.success-check {
  color: var(--success);
  animation: popIn 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards;
  display: inline-flex;
  align-items: center;
}

.error-correction {
  color: var(--danger);
  font-weight: 600;
  background: rgba(254, 226, 226, 0.16);
  padding: 2px 6px;
  border-radius: var(--radius-sm);
  border: 1px solid rgba(248, 113, 113, 0.46);
  animation: popIn 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

/* === 文档区 === */



.toggle-btn {
  background: var(--field-bg);
  border: 1px solid var(--surface-border);
  padding: 6px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-sm);
  transition: all 0.2s ease;
}

.toggle-btn:hover {
  border-color: var(--primary);
  background: var(--primary-soft);
}

.toggle-btn:active {
  transform: translateY(1px);
}

.icon-chevron {
  width: 16px;
  height: 16px;
  color: var(--text-muted);
  transition: transform 0.24s ease;
}

.icon-chevron.right {
  transform: rotate(-90deg);
}

.icon-chevron.down {
  transform: rotate(0deg);
}

/* === Markdown === */


.markdown-body h1, .markdown-body h2, .markdown-body h3, .markdown-body h4 {
  margin-top: 10px;
  margin-bottom: 10px;
  color: var(--text-primary);
}

.markdown-body p {
  margin-bottom: 10px;
}

.markdown-body ul, .markdown-body ol {
  padding-left: 20px;
  margin-bottom: 10px;
}

/* === 道场模式 Dojo === */


/* === 动画 === */


@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

.card-fade-enter-active {
  animation: cardIn 0.5s var(--ease-spring) both;
}

.card-fade-leave-active {
  animation: cardIn 0.22s var(--ease-out) reverse both;
}

@keyframes cardIn {
  from {
    opacity: 0;
    transform: translateY(16px) scale(0.98);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

@keyframes slideUp {
  from {
    opacity: 0;
    transform: translateY(12px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes shakeIn {
  0% { opacity: 0; transform: translateX(-12px); }
  25% { transform: translateX(8px); }
  50% { transform: translateX(-5px); }
  75% { transform: translateX(2px); }
  100% { opacity: 1; transform: translateX(0); }
}

@keyframes fadeOut {
  to { opacity: 0; transform: translateY(-8px); }
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

@keyframes popIn {
  0% { transform: scale(0.5); opacity: 0; }
  100% { transform: scale(1); opacity: 1; }
}

@keyframes shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

@keyframes pulseDot {
  0%, 100% {
    transform: scale(1);
    opacity: 1;
  }
  50% {
    transform: scale(0.82);
    opacity: 0.65;
  }
}

@keyframes agentSheen {
  0% { background-position: 120% 0; }
  100% { background-position: -120% 0; }
}

/* === 朗读按钮 === */


.btn-speak {
  background: none;
  border: none;
  cursor: pointer;
  padding: 2px 4px;
  border-radius: 6px;
  transition: transform 0.15s, background-color 0.2s;
  opacity: 0.5;
  line-height: 1;
  flex-shrink: 0;
}

.btn-speak:hover {
  opacity: 1;
  transform: scale(1.2);
  background-color: var(--primary-soft);
}

.btn-speak:active {
  transform: scale(0.95);
}

.btn-speak--sm {
  padding: 1px 3px;
}

.btn-speak--lg {
  padding: 3px 5px;
}

.icon {
  width: 18px;
  height: 18px;
  stroke: currentColor;
  fill: none;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.icon-search {
  width: 17px;
  height: 17px;
}

.btn-speak--sm .icon {
  width: 14px;
  height: 14px;
}

.btn-speak--lg .icon {
  width: 20px;
  height: 20px;
}

/* .icon-check / .icon-error 已移至 styles/shared.css（全局共享） */



.icon-clock {
  width: 14px;
  height: 14px;
}

.icon-trash {
  width: 12px;
  height: 12px;
}

button:focus-visible,
input:focus-visible,
select:focus-visible,
.scene-card:focus-visible,
.similar-card:focus-visible,
.dojo-choice-btn:focus-visible,
.toggle-btn:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}

.app-dark .pref-toggle-thumb {
  background: #f8fafc;
}

.app-dark .mode-switch button.active {
  background: rgba(244, 241, 234, 0.14);
  color: var(--text-primary);
}

.app-dark .search-bar--success {
  border-color: rgba(74, 222, 128, 0.58);
}

.app-dark .suggestion-type {
  background: var(--primary-soft);
  color: var(--primary-hover);
}

.app-accessible .header h1 {
  font-size: 2.35rem;
}

.app-accessible .subtitle,
.app-accessible .mode-switch button,
.app-accessible .pref-toggle,
.app-accessible .search-input,
.app-accessible .search-btn,
.app-accessible .btn-secondary,
.app-accessible .model-select {
  font-size: 1rem;
}

.app-accessible .card,
.app-accessible .search-bar,
.app-accessible .suggestions-list,
.app-accessible .scene-card,
.app-accessible .similar-card,
.app-accessible .dojo-choice-btn {
  border-width: 2px;
}

.app-accessible .text-strike {
  text-decoration-thickness: 3px;
}

.app-accessible .btn-speak {
  opacity: 0.85;
}

.app-accessible *,
.app-accessible *::before,
.app-accessible *::after {
  animation-duration: 0.01ms !important;
  animation-iteration-count: 1 !important;
  scroll-behavior: auto !important;
  transition-duration: 0.01ms !important;
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    scroll-behavior: auto !important;
    transition-duration: 0.01ms !important;
  }
}

@media (max-width: 768px) {
  .container {
    padding: 20px 14px 36px;
  }

  .card {
    padding: 20px;
  }

  /* 窄屏下 logo 与偏好按钮保持同行（共 ~200px 宽放得下），只有功能 tabs 换行占满 */
  .header-top {
    align-items: center;
  }

  .header-bottom {
    align-items: flex-start;
    flex-direction: column;
  }

  .header h1 {
    font-size: 1.65rem;
  }

  .mode-switch,
  .mode-switch button {
    width: 100%;
  }

  .mode-switch button {
    flex: 1;
  }

  .pref-link {
    min-height: 38px;
  }

  .credits-grid {
    grid-template-columns: 1fr;
  }

  .credits-item {
    flex-direction: column;
    align-items: flex-start;
  }

  .credits-item-tag {
    align-self: flex-start;
  }

  .search-bar {
    padding-left: 14px;
  }

  .search-btn {
    padding: 10px 18px;
  }

  .dojo-scene-grid,
  .dojo-profile-stats,
  .agent-capability-grid {
    grid-template-columns: 1fr;
  }

  .agent-runtime-node {
    min-width: 96px;
    padding-inline: 7px;
  }

  .nav-llm-panel {
    grid-template-columns: 1fr;
  }

  .result-grid {
    grid-template-columns: 1fr;
  }

  .memory-review {
    grid-template-columns: 1fr;
  }

  .memory-header,
  .memory-library-toolbar,
  .memory-library-item {
    grid-template-columns: 1fr;
    flex-direction: column;
    align-items: stretch;
  }

  .memory-stats,
  .memory-library-meta {
    justify-content: flex-start;
    align-items: flex-start;
  }

  .settings-row--switch {
    grid-template-columns: 1fr;
  }

  .suggestion-meaning,
  .suggestion-romaji {
    display: none;
  }
}

.agent-section-nav {
  position: fixed;
  top: 50%;
  right: 18px;
  transform: translateY(-50%);
  z-index: 60;
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 14px 10px;
  border: 1px solid var(--surface-border);
  border-radius: 999px;
  background: var(--panel-bg);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  box-shadow: var(--shadow-soft), var(--glass-highlight);
}

.agent-section-nav__track {
  position: absolute;
  top: 18px;
  bottom: 18px;
  left: 50%;
  width: 2px;
  transform: translateX(-50%);
  border-radius: 2px;
  background: color-mix(in srgb, var(--text-muted) 18%, transparent);
  overflow: hidden;
}

.agent-section-nav__progress {
  display: block;
  width: 100%;
  background: var(--primary);
  border-radius: 2px;
  transition: height 0.15s ease-out;
}

.agent-section-nav__item {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  padding: 0;
  border: none;
  background: transparent;
  cursor: pointer;
}

.agent-section-nav__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--text-muted) 45%, transparent);
  transition: background 0.18s ease, transform 0.18s ease;
}

.agent-section-nav__item:hover .agent-section-nav__dot {
  transform: scale(1.3);
}

.agent-section-nav__item.is-active .agent-section-nav__dot {
  background: var(--primary);
  transform: scale(1.4);
}

.agent-section-nav__label {
  position: absolute;
  right: 26px;
  top: 50%;
  transform: translateY(-50%) translateX(4px);
  padding: 3px 10px;
  font-size: 0.74rem;
  white-space: nowrap;
  color: var(--text-secondary);
  border: 1px solid var(--surface-border);
  border-radius: 999px;
  background: var(--panel-bg);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.16s ease, transform 0.16s ease;
}

.agent-section-nav__item:hover .agent-section-nav__label,
.agent-section-nav__item:focus-visible .agent-section-nav__label {
  opacity: 1;
  transform: translateY(-50%) translateX(0);
}

@media (max-width: 900px) {
  .agent-section-nav { display: none; }
}

.nav-llm-panel__embedding {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--surface-border);
}

.nav-llm-panel__embedding-label { font-size: 0.74rem; color: var(--text-muted); }
</style>
