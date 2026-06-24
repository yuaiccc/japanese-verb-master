<template>
    <main class="main-content">
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
            <button
              class="memory-btn"
              :class="{ active: isCurrentMemorized }"
              @click="addCurrentToMemory"
            >
              {{ isCurrentMemorized ? '取消记忆' : '加入记忆' }}
            </button>
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
            <button
              class="memory-btn"
              :class="{ active: isCurrentMemorized }"
              @click="addCurrentToMemory"
            >
              {{ isCurrentMemorized ? '取消记忆' : '加入记忆' }}
            </button>
          </div>
          <div class="dict-meanings">
            <h3 class="title-with-icon">
              <Icon name="book" />
              释义
            </h3>
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
              <select :value="selectedModel" @change="onModelChange" class="model-select" v-if="availableModels.length > 0">
                <option v-for="m in availableModels" :key="m" :value="m">{{ m }}</option>
              </select>
              <button v-if="(!loadingAi && result) || aiRawExplanation" @click="$emit('fetch-ai-explanation')" class="btn-secondary btn-secondary--with-icon" :disabled="loadingAi">
                <Icon name="sparkles" />
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
            <button @click="$emit('fetch-ai-explanation')" class="retry-btn">
              <Icon name="arrow-right" />
              重试
            </button>
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
</template>

<script setup lang="ts">
import * as wanakana from 'wanakana';
import Icon from './Icon.vue';
import { useMemoryCards } from '../composables/useMemoryCards';
import { useSpeech } from '../composables/useSpeech';

const props = withDefaults(defineProps<{
  result?: any;
  loading?: boolean;
  loadingAi?: boolean;
  aiError?: string;
  aiProgress?: number;
  aiRawExplanation?: string;
  aiExplanation?: string;
  aiExamples?: any[];
  verificationStatus?: Record<string, any>;
  selectedModel?: string;
  availableModels?: any[];
  furiganaDict?: string;
  furiganaWord?: string;
  furiganaExamples?: any[];
  isVerb?: boolean;
  conjugationItems?: any[];
  verbTypeMap?: Record<string, any>;
  wordTypeDisplayMap?: Record<string, any>;
}>(), {
  result: null,
  loading: false,
  loadingAi: false,
  aiError: '',
  aiProgress: 0,
  aiRawExplanation: '',
  aiExplanation: '',
  aiExamples: () => [],
  verificationStatus: () => ({}),
  selectedModel: '',
  availableModels: () => [],
  furiganaDict: '',
  furiganaWord: '',
  furiganaExamples: () => [],
  isVerb: false,
  conjugationItems: () => [],
  verbTypeMap: () => ({}),
  wordTypeDisplayMap: () => ({}),
});

const emit = defineEmits(['fetch-ai-explanation', 'update:selected-model']);

const onModelChange = (event: Event) => {
  emit('update:selected-model', (event.target as HTMLSelectElement).value);
};

const { isCurrentMemorized, addCurrentToMemory } = useMemoryCards();
const { speak } = useSpeech();

// 提取日文文本中的假名部分（去掉汉字），用于模糊比较
const extractKana = (text: any) => {
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
const isEquivalentCorrection = (correction: any, original: any) => {
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
</script>

<style scoped>
/* === 布局 === */
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

/* === 错误消息 === */
.error-message {
  color: var(--danger);
  background-color: rgba(254, 226, 226, 0.16);
  border: 1px solid rgba(248, 113, 113, 0.46);
  padding: 10px var(--space-4);
  border-radius: var(--radius-md);
  margin-top: 10px;
  font-size: 0.88em;
}

/* === 结果卡片 === */
.result-card {
  animation: cardIn 0.4s ease both;
}

.result-card + .result-card {
  margin-top: 20px;
}

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

/* === 例句 === */
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
  line-height: 1.7;
}

.ex-japanese :deep(mark),
.ex-japanese mark {
  padding: 0.06em 0.22em;
  border-radius: 0.3em;
  color: inherit;
  box-decoration-break: clone;
  -webkit-box-decoration-break: clone;
}

.ex-chinese {
  font-size: 0.95em;
  color: var(--text-secondary);
}

/* === AI 加载 === */
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

/* === 按钮 === */
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

/* === 模型选择 === */
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

/* === 重试按钮 === */
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

/* === 记忆按钮 === */
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

/* === 过渡动画 === */
.card-fade-enter-active {
  animation: cardIn 0.5s var(--ease-spring) both;
}

.card-fade-leave-active {
  animation: cardIn 0.22s var(--ease-out) reverse both;
}

/* === 关键帧 === */
@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
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
</style>
