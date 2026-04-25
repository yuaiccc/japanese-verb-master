<template>
  <div class="container">
    <header class="header">
      <h1>🇯🇵 Japanese Word Master</h1>
      <p class="subtitle">日语词汇查询与动词活用工具</p>
    </header>

    <!-- 搜索栏：输入框 + 按钮合一 -->
    <div class="search-wrapper">
      <div class="search-bar" :class="{ 'search-bar--error': error, 'search-bar--success': result }">
        <span class="search-icon" aria-hidden="true">
          <Icon name="search" class="icon-search" />
        </span>
        <input
          id="verb"
          v-model="form.verb"
          type="text"
          class="search-input"
          :placeholder="error ? error : '输入日语单词，如：食べる、猫、きれい、neko'"
          @keyup.enter="conjugate"
          @input="onInput"
          @focus="onFocus"
          @blur="hideSuggestionsWithDelay"
          autocomplete="off"
        >
        <button @click="conjugate" class="search-btn" :disabled="loading">
          <span v-if="loading" class="spinner-small"></span>
          <span v-else>查询</span>
        </button>
      </div>
      <!-- 联想补全 / 查询历史下拉框 -->
      <ul v-if="showDropdown && (suggestions.length > 0 || showHistory)" class="suggestions-list">
        <!-- 查询历史 -->
        <li v-if="showHistory && history.length > 0" class="history-section">
          <div class="suggestion-label">
            <span class="label-with-icon">
              <Icon name="clock" class="icon-clock" />
              查询历史
            </span>
            <button @mousedown.prevent="clearHistory" class="btn-clear-mini" title="清空历史">
              <Icon name="trash" class="icon-trash" />
              清空
            </button>
          </div>
        </li>
        <li
          v-for="(item, index) in (showHistory ? history : suggestions)"
          :key="item.verb || index"
          @mousedown.prevent="onSelectItem(item)"
          :class="{ 'history-row': showHistory }"
        >
          <template v-if="showHistory">
            <span class="suggestion-kanji">{{ item.verb }}</span>
            <span v-if="item.meaning" class="suggestion-meaning">{{ item.meaning }}</span>
            <span class="suggestion-type">{{ verbTypeMap[item.verbType] || wordTypeDisplayMap[item.verbType] || item.verbType }}</span>
          </template>
          <template v-else>
            <span class="suggestion-kanji">{{ item.kanji }}</span>
            <span class="suggestion-kana">{{ item.kana }}</span>
            <span class="suggestion-romaji">{{ item.romaji }}</span>
            <span class="suggestion-meaning">{{ item.meaning }}</span>
            <span v-if="item.wordType && item.wordType !== 'verb'" class="suggestion-type">{{ wordTypeDisplayMap[item.wordType] || item.wordType }}</span>
          </template>
        </li>
      </ul>
      <transition name="shake">
        <div v-if="error" class="error-message">
          {{ error }}
        </div>
      </transition>
    </div>

    <main class="main-content" v-if="result || loadingAi">
      <!-- 左侧：活用变形 / 字典结果 -->
      <section class="left-section">

        <!-- 动词活用结果 -->
        <transition name="card-fade">
        <div v-if="result && isVerb" class="card result-card">
          <div class="result-summary">
            <span class="summary-dict" v-html="furiganaDict"></span>
            <button class="btn-speak" @click="speak(result.dictionaryForm)" title="朗读">
              <Icon name="volume" class="icon-volume" />
            </button>
            <span class="summary-tag">{{ verbTypeMap[result.verbType] || result.verbType }}</span>
            <span v-if="result.meaning" class="summary-meaning">{{ result.meaning }}</span>
            <span v-if="result.originalInput !== result.parsedAs" class="summary-romaji">从罗马音 "{{ result.originalInput }}" 转换</span>
          </div>
          <h3>活用结果</h3>
          <div class="result-grid">
            <div class="result-item" v-for="(item, idx) in conjugationItems" :key="item.key" :style="{ animationDelay: idx * 0.06 + 's' }">
              <span class="label">{{ item.label }}</span>
              <span class="value">
                <span :class="{ 'text-strike': verificationStatus[item.key] && !verificationStatus[item.key].isCorrect && !isEquivalentCorrection(verificationStatus[item.key].correction, result[item.key]) }">
                  {{ result[item.key] }}
                </span>
                <button class="btn-speak btn-speak--sm" @click="speak(result[item.key])" title="朗读">
                  <Icon name="volume" class="icon-volume" />
                </button>
                <span class="verify-badge" v-if="loadingAi && !verificationStatus[item.key]">
                  <span class="spinner-small" title="AI 正在核对..."></span>
                </span>
                <span class="verify-badge" v-else-if="verificationStatus[item.key]">
                  <span v-if="verificationStatus[item.key].isCorrect || isEquivalentCorrection(verificationStatus[item.key].correction, result[item.key])" title="AI 核对正确" class="success-check">
                    <Icon name="check" class="icon-check" />
                  </span>
                  <span v-else title="AI 发现错误" class="error-correction">
                    <Icon name="error" class="icon-error" />
                    修正为: {{ verificationStatus[item.key].correction }}
                  </span>
                </span>
              </span>
            </div>
          </div>
        </div>
        </transition>

        <!-- 非动词字典卡片 -->
        <transition name="card-fade">
        <div v-if="result && !isVerb" class="card result-card dict-card">
          <div class="dict-header">
            <span class="dict-word" v-html="furiganaWord"></span>
            <button class="btn-speak btn-speak--lg" @click="speak(result.word)" title="朗读">
              <Icon name="volume" class="icon-volume" />
            </button>
          </div>
          <div class="dict-tags">
            <span class="summary-tag">{{ wordTypeDisplayMap[result.wordType] || result.wordType }}</span>
            <span v-if="result.jlpt" class="jlpt-badge">{{ result.jlpt }}</span>
            <span v-if="result.isCommon" class="common-badge">常用词</span>
          </div>
          <div class="dict-meanings">
            <h3>📖 释义</h3>
            <div v-for="(m, idx) in result.meanings" :key="idx" class="meaning-item">
              <span class="meaning-pos">{{ m.pos }}</span>
              <span class="meaning-def">{{ m.definitions }}</span>
            </div>
          </div>
        </div>
        </transition>
      </section>

      <!-- 右侧：AI 解析 -->
      <section class="right-section" v-if="result || loadingAi || aiError">
        <transition name="card-fade">
        <div class="card ai-card">
          <div class="ai-header-row">
            <h3 class="ai-title">
              <span class="title-with-icon">
                <Icon name="sparkles" class="icon-sparkles" />
                AI 深度解析与例句
              </span>
            </h3>
            <div class="ai-actions">
              <select v-model="selectedModel" class="model-select" v-if="availableModels.length > 0">
                <option v-for="m in availableModels" :key="m" :value="m">{{ m }}</option>
              </select>
              <button v-if="(!loadingAi && result) || aiRawExplanation" @click="fetchAiExplanation" class="btn-secondary" :disabled="loadingAi">
                {{ aiRawExplanation ? '重新生成' : '获取解析' }}
              </button>
            </div>
          </div>
          
          <div v-if="loadingAi || (aiProgress > 0 && aiProgress < 100)" class="ai-progress-container">
            <div class="ai-progress-bar" :style="{ width: aiProgress + '%' }"></div>
          </div>

          <div v-if="loadingAi && !aiRawExplanation" class="ai-loading">
            <div class="spinner"></div>
            <p>AI 校验中...</p>
          </div>
          
          <div v-else-if="aiError && !aiRawExplanation && aiExamples.length === 0" class="error-message">
            {{ aiError }}
            <button @click="fetchAiExplanation" class="retry-btn">重试</button>
          </div>
          
          <div v-if="aiExamples.length > 0" class="ai-module">
            <h4 class="module-title">
              <span class="title-with-icon">
                <Icon name="chat" class="icon-chat" />
                实用例句
              </span>
            </h4>
            <div class="examples-grid">
              <div v-for="(ex, idx) in aiExamples" :key="idx" class="example-box">
                <div class="ex-row">
                  <div class="ex-japanese" v-html="furiganaExamples[idx] || ex.japanese"></div>
                  <button class="btn-speak btn-speak--sm" @click="speak(ex.japanese)" title="朗读例句">
                    <Icon name="volume" class="icon-volume" />
                  </button>
                </div>
                <div class="ex-chinese">{{ ex.chinese }}</div>
              </div>
            </div>
          </div>
          
          <div v-if="aiRawExplanation" class="ai-module mt-4">
            <h4 class="module-title">
              <span class="title-with-icon">
                <Icon name="brain" class="icon-brain" />
                AI 助记
              </span>
            </h4>
            <div class="ai-content markdown-body" v-html="aiExplanation"></div>
          </div>
        </div>
        </transition>
      </section>
    </main>

    <!-- 底部：文档区 -->
    <div class="doc-wrapper">
      <section class="doc-section">
        <div class="card doc-card">
          <div class="doc-header" @click="showDocs = !showDocs">
            <h2 class="doc-title">
              <span class="title-with-icon">
                <Icon name="book" class="icon-book" />
                动词分类指南与活用形式说明
              </span>
            </h2>
            <button class="toggle-btn" aria-label="Toggle Documents">
              <Icon name="chevron" class="icon-chevron" :class="{ 'down': showDocs, 'right': !showDocs }" />
            </button>
          </div>
          
          <div v-show="showDocs" class="doc-content">
            <div class="guide-group">
              <h3>
                <span class="title-with-icon">
                  <Icon name="brain" class="icon-brain" />
                  动词分类指南
                </span>
              </h3>
              <ul class="guide-list">
                <li class="guide-item">
                  <strong>五段动词 (Group 1)</strong>
                  <p>词尾为 う段 假名的动词（不包括 える/いる）。<br>
                  <em>例：飲む (nomu)、書く (kaku)、話す (hanasu)</em></p>
                </li>
                <li class="guide-item">
                  <strong>一段动词 (Group 2)</strong>
                  <p>词尾为 る，且前一个假名在 い段 或 え段 上。<br>
                  <em>例：食べる (taberu)、見る (miru)</em></p>
                </li>
                <li class="guide-item">
                  <strong>サ变动词 (Group 3)</strong>
                  <p>以「する」结尾的动词。<br>
                  <em>例：勉強する (benkyousuru)</em></p>
                </li>
                <li class="guide-item">
                  <strong>カ变动词 (Group 3)</strong>
                  <p>只有「来る」(kuru) 一个词。</p>
                </li>
              </ul>
            </div>

            <div class="guide-group mt-4">
              <h3>📝 活用形式说明</h3>
              <ul class="guide-list">
                <li class="guide-item">
                  <strong>否定式 (ない形)</strong>
                  <p>表示否定、不去做某事。</p>
                </li>
                <li class="guide-item">
                  <strong>礼貌式 (ます形)</strong>
                  <p>对长辈或不熟悉的人使用的礼貌表达。</p>
                </li>
                <li class="guide-item">
                  <strong>て形</strong>
                  <p>用于连接句子、表示请求或正在进行的状态。</p>
                </li>
                <li class="guide-item">
                  <strong>过去式 (た形)</strong>
                  <p>表示已经发生过的动作。</p>
                </li>
                <li class="guide-item">
                  <strong>可能形</strong>
                  <p>表示有能力做到某事（能...、会...）。</p>
                </li>
                <li class="guide-item">
                  <strong>被动形</strong>
                  <p>表示受到某种动作的影响。</p>
                </li>
                <li class="guide-item">
                  <strong>使役形</strong>
                  <p>表示让某人做某事（让...、使...）。</p>
                </li>
                <li class="guide-item">
                  <strong>命令形</strong>
                  <p>强烈的命令语气（去做！）。</p>
                </li>
                <li class="guide-item">
                  <strong>意向形</strong>
                  <p>表示提议、决心或意志（我们...吧）。</p>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup>
import { ref, watch, onMounted, computed, onUnmounted } from 'vue';
import axios from 'axios';
import { marked } from 'marked';
import * as wanakana from 'wanakana';
import Icon from './components/Icon.vue';

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
const error = ref('');
const aiError = ref('');
const showDropdown = ref(false);
const suggestions = ref([]);
const availableModels = ref([]);
const selectedModel = ref('');
let suggestTimeout = null;

// 文档区折叠状态
const showDocs = ref(false);

// 查询历史
const MAX_HISTORY = 20;
const history = ref([]);

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
  return form.value.verb.trim() === '' && history.value.length > 0;
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
    form.value.verb = item.verb;
    error.value = '';
    conjugate();
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
  return aiRawExplanation.value ? marked(aiRawExplanation.value) : '';
});

onMounted(async () => {
  try {
    const res = await axios.get('/api/ai-models');
    availableModels.value = res.data;
    if (res.data.length > 0) {
      selectedModel.value = res.data.includes('qwen2.5:7b') ? 'qwen2.5:7b' : res.data[0];
    }
  } catch(e) {
    console.error('获取模型列表失败', e);
  }
  loadHistory();
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
const isSpeaking = ref(false);

const speak = (text) => {
  if (!text || !window.speechSynthesis) return;
  // 停止上一次朗读
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'ja-JP';
  utterance.rate = 0.85;
  utterance.pitch = 1;
  // 尝试选择日语语音
  const voices = window.speechSynthesis.getVoices();
  const jaVoice = voices.find(v => v.lang.startsWith('ja'));
  if (jaVoice) utterance.voice = jaVoice;
  utterance.onstart = () => isSpeaking.value = true;
  utterance.onend = () => isSpeaking.value = false;
  utterance.onerror = () => isSpeaking.value = false;
  window.speechSynthesis.speak(utterance);
};

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
    return texts; // fallback: 返回原文
  }
};

// 字典卡片 / 动词摘要的 furigana HTML
const furiganaWord = ref('');
const furiganaDict = ref('');
// 例句的 furigana HTML
const furiganaExamples = ref([]);

// 当查询结果变化时，获取 furigana
watch(result, async (val) => {
  if (!val) {
    furiganaWord.value = '';
    furiganaDict.value = '';
    return;
  }
  const word = val.dictionaryForm || val.word;
  if (word) {
    const results = await fetchFurigana([word]);
    if (val.dictionaryForm) {
      furiganaDict.value = results[0];
    } else {
      furiganaWord.value = results[0];
    }
  }
});

// 当例句变化时，批量获取 furigana
watch(aiExamples, async (examples) => {
  if (!examples || examples.length === 0) {
    furiganaExamples.value = [];
    return;
  }
  const jaTexts = examples.map(ex => ex.japanese);
  const results = await fetchFurigana(jaTexts);
  furiganaExamples.value = results;
});

// 监听输入，双轨联想补全：先立即返回本地结果，再异步追加远程结果
let remoteAbortController = null;

watch(() => form.value.verb, (newVal) => {
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
      if (form.value.verb !== query) return;
      suggestions.value = localRes.data;
      
      // 第二轨：异步查询远程结果（本地结果<3时才补充）
      if (localRes.data.length < 3) {
        remoteAbortController = new AbortController();
        try {
          const remoteRes = await axios.get('/api/suggest', {
            params: { q: query, remote: 1 },
            signal: remoteAbortController.signal
          });
          if (form.value.verb === query) {
            suggestions.value = remoteRes.data;
          }
        } catch (remoteErr) {
          if (remoteErr.name !== 'CanceledError' && remoteErr.code !== 'ERR_CANCELED') {
            console.error('远程联想失败', remoteErr);
          }
        }
        remoteAbortController = null;
      }
    } catch (err) {
      console.error('获取联想失败', err);
      suggestions.value = [];
    }
  }, 150);
});

const selectSuggestion = (item) => {
  form.value.verb = item.kanji;
  showDropdown.value = false;
  conjugate();
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
});

const conjugate = async () => {
  error.value = '';
  result.value = null;
  aiRawExplanation.value = '';
  aiError.value = '';
  verificationStatus.value = {};
  aiExamples.value = [];

  if (!form.value.verb || !form.value.verb.trim()) {
    error.value = '请输入动词';
    // 当错误时，让输入框获取焦点
    setTimeout(() => {
      document.getElementById('verb')?.focus();
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
    
    // 自动触发 AI 解析
    fetchAiExplanation();
  } catch (err) {
    error.value = err.response?.data?.error || '请求失败，请检查输入';
    // 错误时重置结果状态
    result.value = null;
    // 错误时让输入框获取焦点，保留用户输入以便修正
    setTimeout(() => {
      document.getElementById('verb')?.focus();
    }, 50);
  } finally {
    loading.value = false;
  }
};

const fetchAiExplanation = async () => {
  const wordName = result.value?.dictionaryForm || result.value?.word;
  if (!wordName) return;
  
  const currentWordType = result.value?.wordType || 'verb';
  const currentIsVerb = currentWordType === 'verb';
  
  loadingAi.value = true;
  aiError.value = '';
  aiRawExplanation.value = '';
  verificationStatus.value = {};
  aiExamples.value = [];
  
  try {
    startProgress();
    const response = await fetch('/api/ai-explain', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        verb: wordName,
        model: selectedModel.value || 'qwen2.5:7b',
        conjugationResult: currentIsVerb ? result.value : undefined,
        wordType: currentWordType,
        wordInfo: !currentIsVerb ? result.value : undefined
      })
    });
    
    if (!response.ok) {
      throw new Error('网络请求失败');
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
    aiError.value = err.message || 'AI 解析请求失败';
    completeProgress();
  } finally {
    loadingAi.value = false;
  }
};
</script>

<style scoped>
* {
  box-sizing: border-box;
}

:global(body) {
  margin: 0;
  background:
    radial-gradient(1200px 520px at 0% -10%, rgba(99, 102, 241, 0.2), transparent 65%),
    radial-gradient(920px 460px at 100% 0%, rgba(14, 165, 233, 0.16), transparent 58%),
    linear-gradient(180deg, #f8fbff 0%, #f4f7fb 55%, #f7f9fd 100%);
  color: #0f172a;
}

.container {
  --surface: rgba(255, 255, 255, 0.86);
  --surface-soft: rgba(248, 250, 254, 0.9);
  --surface-border: rgba(214, 221, 233, 0.92);
  --text-primary: #212836;
  --text-secondary: #3a4558;
  --text-muted: #5f6e85;
  --primary: #2367f4;
  --primary-hover: #1a59dc;
  --primary-soft: rgba(35, 103, 244, 0.1);
  --success: #16a34a;
  --danger: #dd4444;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --radius-sm: 8px;
  --radius-md: 12px;
  min-height: 100vh;
  padding: 40px 22px 48px;
  max-width: 1320px;
  margin: 0 auto;
}

.header {
  text-align: center;
  color: var(--text-primary);
  margin-bottom: 34px;
}

.header h1 {
  font-size: clamp(2rem, 3.5vw, 2.7rem);
  margin-bottom: 6px;
  letter-spacing: -0.02em;
  font-weight: 800;
}

.subtitle {
  font-size: 1rem;
  color: var(--text-muted);
  font-weight: 500;
}

/* === 搜索栏 === */
.search-wrapper {
  max-width: 680px;
  margin: 0 auto 34px;
  position: relative;
}

.search-bar {
  display: flex;
  align-items: center;
  background: var(--surface);
  border-radius: var(--radius-md);
  box-shadow: 0 16px 36px rgba(15, 23, 42, 0.09);
  padding: 2px var(--space-2) 2px var(--space-3);
  transition: box-shadow 0.25s ease, border-color 0.25s ease, background-color 0.25s ease;
  border: 1px solid var(--surface-border);
  backdrop-filter: blur(12px);
}

.search-bar:focus-within {
  box-shadow: 0 22px 42px rgba(79, 70, 229, 0.18);
  border-color: rgba(79, 70, 229, 0.52);
  background: rgba(255, 255, 255, 0.9);
}

.search-bar--error {
  border-color: rgba(220, 38, 38, 0.4);
  box-shadow: 0 16px 32px rgba(220, 38, 38, 0.12);
}

.search-bar--success {
  border-color: rgba(22, 163, 74, 0.38);
}

.search-icon {
  margin-right: 8px;
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
  font-size: 1.02em;
  padding: var(--space-3) var(--space-2);
  background: transparent;
  color: var(--text-primary);
  min-width: 0;
}

.search-input::placeholder {
  color: #94a3b8;
}

.search-btn {
  padding: 0 var(--space-4);
  background: var(--primary);
  color: white;
  border: none;
  border-radius: var(--radius-sm);
  font-size: 0.95em;
  font-weight: 500;
  cursor: pointer;
  transition: transform 0.2s, box-shadow 0.2s, opacity 0.2s;
  white-space: nowrap;
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 72px;
  height: 40px;
}

.search-btn:hover {
  transform: translateY(-1px);
  background: var(--primary-hover);
  box-shadow: 0 8px 20px rgba(35, 103, 244, 0.28);
}

.search-btn:active {
  transform: scale(0.98);
}

.search-btn:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}

/* === 下拉补全 === */
.suggestions-list {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  background: rgba(255, 255, 255, 0.94);
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-md);
  padding: 6px 0;
  list-style: none;
  box-shadow: 0 20px 38px rgba(15, 23, 42, 0.14);
  z-index: 10;
  max-height: 280px;
  overflow-y: auto;
  backdrop-filter: blur(10px);
}

.suggestions-list li {
  padding: 10px 18px;
  cursor: pointer;
  display: flex;
  align-items: center;
  border-bottom: 1px solid rgba(226, 232, 240, 0.62);
  transition: background-color 0.15s;
}

.suggestions-list li:last-child {
  border-bottom: none;
}

.suggestions-list li:hover {
  background-color: rgba(79, 70, 229, 0.08);
}

.suggestions-list li.history-section {
  background: rgba(248, 250, 252, 0.85);
  padding: 6px 18px;
  cursor: default;
  border-bottom: 1px solid #e2e8f0;
}

.suggestion-label {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
  font-size: 0.82em;
  color: var(--text-muted);
  font-weight: 600;
}

.label-with-icon,
.title-with-icon {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.btn-clear-mini {
  background: transparent;
  border: 1px solid transparent;
  color: var(--text-muted);
  font-size: 0.82em;
  cursor: pointer;
  padding: 2px 8px;
  border-radius: var(--radius-sm);
  transition: all 0.2s;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.btn-clear-mini:hover {
  color: var(--danger);
  background: #fef2f2;
  border-color: #fecaca;
}

.btn-clear-mini:active {
  transform: translateY(1px);
}

.suggestions-list li.history-row {
  background: #fafbfc;
}

.suggestion-kanji {
  font-weight: 600;
  font-size: 1.05em;
  color: var(--text-primary);
  min-width: 56px;
}

.suggestion-kana {
  color: var(--primary);
  font-size: 0.88em;
  margin-left: 10px;
  min-width: 70px;
}

.suggestion-romaji {
  color: #94a3b8;
  font-size: 0.82em;
  margin-left: 10px;
  font-family: monospace;
}

.suggestion-meaning {
  color: var(--text-muted);
  font-size: 0.82em;
  margin-left: auto;
}

.suggestion-type {
  font-size: 0.72em;
  padding: 1px 8px;
  background: linear-gradient(135deg, rgba(79, 70, 229, 0.14), rgba(124, 58, 237, 0.14));
  color: var(--primary);
  border-radius: var(--radius-sm);
  font-weight: 500;
  margin-left: 8px;
  white-space: nowrap;
}

/* === 主内容区 === */
.main-content {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 22px;
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
.card {
  background: var(--surface);
  border-radius: var(--radius-md);
  padding: 28px;
  box-shadow: 0 14px 32px rgba(15, 23, 42, 0.09);
  border: 1px solid var(--surface-border);
  backdrop-filter: blur(12px);
}

.card h3 {
  color: #334155;
  margin-bottom: 14px;
  font-size: 1.05em;
}

.error-message {
  color: #b91c1c;
  background-color: #fff7f7;
  border: 1px solid #fecaca;
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

/* === 动词活用结果 === */
.result-summary {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
  margin-bottom: 16px;
  padding-bottom: 14px;
  border-bottom: 1px solid rgba(226, 232, 240, 0.9);
  animation: slideUp 0.35s ease both;
}

.summary-dict {
  font-size: 1.5em;
  font-weight: 700;
  color: var(--text-primary);
}

.summary-tag {
  font-size: 0.78em;
  padding: 2px var(--space-2);
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
  color: #94a3b8;
  font-style: italic;
}

.result-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: var(--space-3);
}

.result-item {
  display: flex;
  flex-direction: column;
  padding: var(--space-3);
  background: rgba(248, 250, 252, 0.95);
  border-radius: var(--radius-sm);
  border-left: 3px solid var(--primary);
  animation: slideUp 0.35s ease both;
  transition: transform 0.2s, box-shadow 0.2s;
}

.result-item:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 18px rgba(79, 70, 229, 0.16);
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
  border-bottom: 1px solid rgba(226, 232, 240, 0.92);
}

.dict-word {
  font-size: 2em;
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

.ex-japanese ruby rt {
  font-size: 0.55em;
  color: var(--text-muted);
}

.dict-reading {
  font-size: 1.15em;
  color: var(--primary);
  font-weight: 500;
}

.dict-romaji {
  font-size: 0.88em;
  color: #94a3b8;
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
  background: #eff6ff;
  color: #1d4ed8;
  border-radius: var(--radius-sm);
  font-weight: 600;
  border: 1px solid #bee3f8;
}

.common-badge {
  font-size: 0.78em;
  padding: 2px 8px;
  background: #f0fdf4;
  color: #15803d;
  border-radius: var(--radius-sm);
  font-weight: 500;
  border: 1px solid #c6f6d5;
}

.dict-meanings h3 {
  margin-top: 0;
}

.meaning-item {
  padding: 10px 0;
  border-bottom: 1px solid rgba(241, 245, 249, 0.95);
  animation: slideUp 0.3s ease both;
}

.meaning-item:last-child {
  border-bottom: none;
}

.meaning-pos {
  display: inline-block;
  font-size: 0.78em;
  color: #64748b;
  background: #f1f5f9;
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
  background-color: #edf2f7;
  border-radius: 2px;
  margin-bottom: 14px;
  overflow: hidden;
}

.ai-progress-bar {
  height: 100%;
  background: linear-gradient(90deg, #667eea, #764ba2, #667eea);
  background-size: 200% 100%;
  animation: shimmer 1.5s ease infinite;
  transition: width 0.3s ease;
  border-radius: 2px;
}

.ai-module {
  margin-top: 18px;
  border-top: 1px solid rgba(226, 232, 240, 0.9);
  padding-top: 14px;
}

.module-title {
  color: #334155;
  font-size: 1.05em;
  margin-top: 0;
  margin-bottom: 14px;
}

.title-with-icon .icon {
  width: 16px;
  height: 16px;
}

.examples-grid {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.example-box {
  background: rgba(248, 250, 252, 0.95);
  padding: var(--space-3);
  border-radius: var(--radius-sm);
  border-left: 3px solid var(--primary);
  animation: slideUp 0.35s ease both;
  transition: transform 0.2s;
}

.example-box:nth-child(2) {
  animation-delay: 0.08s;
}

.example-box:hover {
  transform: translateX(3px);
}

.ex-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.ex-japanese {
  font-size: 1.15em;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 3px;
  flex: 1;
}

.ex-kana {
  font-size: 0.85em;
  color: var(--text-muted);
  margin-bottom: 6px;
}

.ex-chinese {
  font-size: 0.95em;
  color: var(--text-secondary);
}

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
  border: 3px solid #e2e8f0;
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
  background: rgba(248, 250, 252, 0.9);
  padding: var(--space-4);
  border-radius: var(--radius-sm);
  border: 1px solid rgba(226, 232, 240, 0.9);
  line-height: 1.7;
  color: var(--text-primary);
}

.btn-secondary {
  padding: 0 var(--space-3);
  background: rgba(241, 245, 249, 0.85);
  color: #334155;
  border: 1px solid rgba(203, 213, 225, 0.9);
  border-radius: var(--radius-sm);
  font-size: 0.85em;
  cursor: pointer;
  transition: all 0.2s;
  height: 40px;
  font-weight: 500;
}

.btn-secondary:hover {
  background: rgba(226, 232, 240, 0.95);
  border-color: rgba(148, 163, 184, 0.9);
}

.model-select {
  padding: 0 var(--space-3);
  border: 1px solid rgba(203, 213, 225, 0.95);
  border-radius: var(--radius-sm);
  background-color: white;
  font-size: 0.85em;
  color: #334155;
  outline: none;
  cursor: pointer;
  height: 40px;
}

.model-select:focus {
  border-color: var(--primary);
  box-shadow: 0 0 0 3px rgba(79, 70, 229, 0.12);
}

.retry-btn {
  margin-left: 10px;
  background: none;
  border: none;
  text-decoration: underline;
  color: inherit;
  cursor: pointer;
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
  color: #94a3b8;
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
  background: #fff5f5;
  padding: 2px 6px;
  border-radius: var(--radius-sm);
  border: 1px solid #fed7d7;
  animation: popIn 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

/* === 文档区 === */
.doc-wrapper {
  margin: 0 auto 40px;
}

.doc-card {
  padding: 0;
  overflow: hidden;
}

.doc-header {
  padding: 18px 24px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  cursor: pointer;
  background-color: rgba(248, 250, 252, 0.82);
  transition: background-color 0.2s, border-color 0.2s;
}

.doc-header:hover {
  background-color: rgba(241, 245, 249, 0.94);
}

.doc-title {
  margin: 0;
  font-size: 1.15rem;
  color: #334155;
  font-weight: 700;
}

.doc-content {
  padding: 20px 24px;
  border-top: 1px solid rgba(226, 232, 240, 0.9);
}

.toggle-btn {
  background: rgba(255, 255, 255, 0.72);
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
  border-color: rgba(35, 103, 244, 0.28);
  background: rgba(35, 103, 244, 0.08);
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

.guide-group h3 {
  margin-top: 0;
  margin-bottom: 14px;
  color: var(--text-primary);
  font-size: 1.05rem;
}

.guide-list {
  list-style: none;
  padding: 0;
}

.guide-item {
  padding: var(--space-3) var(--space-4);
  background: rgba(248, 250, 252, 0.95);
  border-radius: var(--radius-sm);
  border-left: 3px solid var(--primary);
  margin-bottom: 10px;
}

.guide-item:last-child {
  margin-bottom: 0;
}

.guide-item strong {
  color: var(--text-primary);
}

.guide-item p {
  color: var(--text-muted);
  font-size: 0.92em;
  line-height: 1.5;
  margin: 4px 0 0;
}

.mt-4 {
  margin-top: 1.5rem;
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

/* === 动画 === */
@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

.card-fade-enter-active {
  animation: cardIn 0.4s ease both;
}

.card-fade-leave-active {
  animation: cardIn 0.25s ease reverse both;
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

.shake-enter-active {
  animation: shakeIn 0.45s ease both;
}

.shake-leave-active {
  animation: fadeOut 0.2s ease both;
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

.icon-check {
  color: var(--success);
}

.icon-error {
  width: 13px;
  height: 13px;
}

.icon-clock {
  width: 14px;
  height: 14px;
}

.icon-trash {
  width: 12px;
  height: 12px;
}

@media (max-width: 768px) {
  .container {
    padding: 26px 14px 36px;
  }

  .card {
    padding: 20px;
    border-radius: 16px;
  }

  .search-bar {
    padding-left: 14px;
  }

  .search-btn {
    padding: 10px 18px;
  }

  .result-grid {
    grid-template-columns: 1fr;
  }

  .suggestion-meaning,
  .suggestion-romaji {
    display: none;
  }
}
</style>
