<template>
  <section class="agent-panel agent-panel--hero card">
    <div class="agent-chat">
      <div v-if="agentMessages.length === 0" class="hero-intro">
        <h1 class="hero-title">問<span class="hero-title-accent">日本語</span></h1>
      </div>
      <div class="agent-chat-input">
        <input
          id="agent-command"
          v-model="agentInput"
          type="text"
          :placeholder="animatedAgentPlaceholder"
          @input="$emit('on-input', $event)"
          @focus="$emit('on-focus', $event)"
          @blur="$emit('hide-suggestions')"
          @compositionstart="$emit('update:is-composing', true)"
          @compositionend="$emit('update:is-composing', false)"
          @keyup.enter="handleAgentEnter"
          autocomplete="off"
        >
        <button
          v-if="activeAgentRunIsRunning"
          class="agent-stop-btn"
          type="button"
          @click="stopActiveAgentRun"
        >
          停止
        </button>
        <button
          class="search-btn search-btn--icon"
          :class="{ 'is-loading': loading }"
          :disabled="loading || !agentInput.trim()"
          :aria-label="agentRunning ? '切换' : loading ? '查询中' : '执行'"
          :title="agentRunning ? '切换' : loading ? '查询中' : '执行'"
          @click="submitAgentCommand"
        >
          <span v-if="loading" class="search-btn__spinner" aria-hidden="true"></span>
          <Icon v-else name="arrow-up" class="search-btn__arrow" />
        </button>
      </div>

      <div v-if="agentMessages.length === 0" class="hero-chips">
        <button
          v-for="chip in heroChips"
          :key="chip.prompt"
          type="button"
          class="hero-chip"
          @click="runHeroExample(chip.prompt)"
        >
          <Icon :name="chip.icon" />
          {{ chip.label }}
        </button>
      </div>

      <ul v-if="showDropdown && (suggestions.length > 0 || showHistory)" class="suggestions-list agent-suggestions">
        <li v-if="showHistory && history.length > 0" class="history-section">
          <div class="suggestion-label">
            <span class="label-with-icon">
              <Icon name="clock" class="icon-clock" />
              查询历史
            </span>
            <button @mousedown.prevent="$emit('clear-history')" class="btn-clear-mini" title="清空历史">
              <Icon name="trash" class="icon-trash" />
              清空
            </button>
          </div>
        </li>
        <li
          v-for="(item, index) in (showHistory ? history : suggestions)"
          :key="item.verb || index"
          @mousedown.prevent="$emit('select-item', item)"
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

    <transition name="agent-flow">
    <div v-if="agentRuns.length > 0" class="agent-run-history">
      <button
        v-for="run in agentRuns"
        :key="run.id"
        class="agent-run-chip"
        :class="{ active: activeAgentRunId === run.id, 'is-running': run.status === 'running' }"
        @click="activeAgentRunId = run.id"
      >
        <span class="agent-run-chip__title">{{ run.title }}</span>
        <span v-if="run.status === 'running'" class="agent-run-chip__dot" aria-hidden="true"></span>
      </button>
    </div>
    </transition>

    <transition name="agent-flow">
    <section v-if="currentAgentThreadSummary" class="agent-thread-summary card">
      <div class="agent-thread-summary__head">
        <strong>线程摘要</strong>
        <span v-if="currentAgentRun?.compactSummary?.mode && currentAgentRun.compactSummary.mode !== 'none'">{{ currentAgentRun.compactSummary.mode }}</span>
      </div>
      <p v-if="currentAgentThreadSummary.digest" class="agent-thread-summary__digest">{{ stripMarkdownInline(currentAgentThreadSummary.digest) }}</p>
      <div v-if="currentAgentThreadSummary.focusWords?.length" class="agent-thread-summary__group">
        <span class="agent-thread-summary__label">焦点词</span>
        <div class="agent-thread-summary__pills">
          <span v-for="word in currentAgentThreadSummary.focusWords" :key="word" class="agent-thread-summary__pill">{{ word }}</span>
        </div>
      </div>
      <div v-if="currentAgentThreadSummary.practiceFocuses?.length" class="agent-thread-summary__group">
        <span class="agent-thread-summary__label">练习焦点</span>
        <div class="agent-thread-summary__pills">
          <span v-for="item in currentAgentThreadSummary.practiceFocuses" :key="item" class="agent-thread-summary__pill agent-thread-summary__pill--muted">{{ item }}</span>
        </div>
      </div>
    </section>
    </transition>

    <transition name="agent-flow">
    <section
      v-if="latestAssistantMessage"
      id="agent-sec-answer"
      class="agent-answer-core"
      :class="{ 'agent-answer-core--streaming': agentRunning }"
      aria-live="polite"
    >
      <span v-if="agentRunning" class="agent-answer-pulse" aria-hidden="true"></span>
      <div v-if="currentAgentMemoryCandidates.length > 0" class="agent-memory-suggestions agent-memory-suggestions--top">
        <button
          v-for="item in currentAgentMemoryCandidates"
          :key="`${item.word}-${item.reading}`"
          class="agent-memory-pill"
          :class="{ 'agent-memory-pill--added': item.added }"
          :title="item.added ? '从记忆库移除' : '加入记忆库'"
          :aria-label="item.added ? `从记忆库移除 ${item.word}` : `加入记忆库 ${item.word}`"
          @click="addAgentMemoryCandidate(item)"
        >
          <strong>{{ item.word }}</strong>
          <span v-if="item.reading">{{ item.reading }}</span>
          <span class="agent-memory-pill__toggle" aria-hidden="true">
            <Icon :name="item.added ? 'minus' : 'plus'" />
          </span>
        </button>
      </div>
      <p v-if="latestUserMessage" class="agent-answer-question">{{ latestUserMessage }}</p>
      <AgentRuntime
        :runtime-note="agentRuntimeNote"
        :subagent-tasks="currentSubagentTasks"
        :usage-summary="agentUsageSummary"
        @toggle-subagent="toggleSubagentTask"
      />
      <div
        v-if="activeAgentRunIsRunning"
        class="agent-markdown markdown-body typewriter-output typewriter-output--live is-streaming"
        v-html="renderedStreamingMarkdown"
      ></div>
      <div
        v-else
        class="agent-markdown markdown-body typewriter-output"
        v-html="renderMarkdown(latestAssistantMessage.content)"
      ></div>
      <div v-if="currentAgentInteractivePractice" id="agent-sec-practice" class="agent-practice-card">
        <div class="agent-practice-card__head">
          <span class="agent-practice-card__eyebrow">即时练习 · 选择题</span>
          <span class="agent-practice-card__tag">{{ currentAgentInteractivePractice.question.formLabel }}</span>
        </div>
        <p class="agent-practice-card__prompt">{{ currentAgentInteractivePractice.prompt }}</p>
        <div class="agent-practice-options" role="radiogroup">
          <button
            v-for="(option, idx) in practiceOptions"
            :key="`${option}-${idx}`"
            class="agent-practice-option"
            :class="optionStateClass(option)"
            :disabled="agentPracticeBusy || !!agentPracticeFeedback"
            role="radio"
            :aria-checked="agentPracticeInput === option"
            @click="selectPracticeOption(option)"
          >
            <span class="agent-practice-option__index">{{ optionLabels[Number(idx)] }}</span>
            <span class="agent-practice-option__text">{{ option }}</span>
            <Icon
              v-if="agentPracticeFeedback && option === agentPracticeFeedback.correctAnswer"
              name="check"
              class="agent-practice-option__icon"
            />
            <Icon
              v-else-if="agentPracticeFeedback && agentPracticeInput === option"
              name="x"
              class="agent-practice-option__icon"
            />
          </button>
        </div>
        <div class="agent-practice-card__actions" v-if="!agentPracticeFeedback">
          <button class="agent-ghost-btn" :disabled="agentPracticeBusy" @click="requestAgentPracticeHint">需要提示</button>
        </div>
        <transition name="card-fade">
          <div v-if="agentPracticeHint && !agentPracticeFeedback" class="agent-practice-hint">
            <Icon name="sparkles" class="agent-practice-hint__icon" /> {{ agentPracticeHint }}
          </div>
        </transition>
        <transition name="card-fade">
          <div
            v-if="agentPracticeFeedback"
            class="agent-practice-result"
            :class="agentPracticeFeedback.isCorrect ? 'is-correct' : 'is-wrong'"
          >
            <div class="agent-practice-result__msg">
              <template v-if="agentPracticeFeedback.isCorrect">
                <Icon name="check" class="agent-practice-result__icon" /> 回答正确
              </template>
              <template v-else>
                <Icon name="error" class="agent-practice-result__icon" /> 正确答案是 <strong>{{ agentPracticeFeedback.correctAnswer }}</strong>
              </template>
            </div>
            <p v-if="agentPracticeFeedback.explanation" class="agent-practice-result__copy">{{ agentPracticeFeedback.explanation }}</p>
            <p v-if="agentPracticeFeedback.memoryNote" class="agent-practice-memory-note">
              <Icon name="brain" class="icon-memory" /> {{ agentPracticeFeedback.memoryNote }}
            </p>
            <div class="agent-practice-card__actions">
              <button class="agent-ghost-btn" @click="resetAgentPracticeState">再答一次</button>
            </div>
          </div>
        </transition>
      </div>
      <div v-if="currentAgentExamples.length > 0" id="agent-sec-examples" class="agent-examples-panel">
        <div class="examples-grid">
          <div v-for="(ex, idx) in currentAgentExamples" :key="`${ex.japanese}-${idx}`" class="example-box">
            <div class="ex-row">
              <div class="ex-japanese">
                <template v-for="(segment, segmentIndex) in buildExampleSegments(ex)" :key="`${ex.japanese}-${idx}-${segmentIndex}`">
                  <button
                    v-if="segment.isComponent"
                    type="button"
                    class="example-highlight example-highlight--button"
                    :class="[segment.highlightClass, { 'is-active': isExampleComponentActive(ex, idx, segment.component) }]"
                    :title="`查看${segment.component.label}说明`"
                    @click="toggleExampleComponent(ex, idx, segment.component)"
                  >
                    {{ segment.text }}
                  </button>
                  <span v-else>{{ segment.text }}</span>
                </template>
              </div>
              <button class="btn-speak btn-speak--sm" @click="speak(ex.japanese)" title="朗读例句">
                <Icon name="volume" class="icon-volume" />
              </button>
            </div>
            <div v-if="ex.kana" class="ex-kana">{{ ex.kana }}</div>
            <div class="ex-chinese">{{ ex.chinese }}</div>
            <div
              v-if="getActiveExampleComponent(ex, idx)"
              class="example-inspector"
            >
              <div class="example-inspector__title">
                {{ getActiveExampleComponent(ex, idx).label }} · {{ getActiveExampleComponent(ex, idx).text }}
              </div>
              <div class="example-inspector__body">
                {{ explainExampleComponent(getActiveExampleComponent(ex, idx), ex) }}
              </div>
            </div>
          </div>
        </div>
      </div>
      <div v-if="currentAgentKnowledgeSources.length > 0" id="agent-sec-citations" class="knowledge-citations">
        <div class="knowledge-citations__head">
          <span class="knowledge-citations__label">知识库引用</span>
          <span class="knowledge-citations__count">{{ currentAgentKnowledgeSources.length }} 条</span>
        </div>
        <div class="knowledge-citations__list">
          <article
            v-for="(src, idx) in currentAgentKnowledgeSources"
            :key="src.id"
            class="knowledge-citation-card"
            :class="{ 'is-expanded': expandedCitations.has(src.id) }"
            role="button"
            tabindex="0"
            @click="toggleCitation(src.id)"
            @keydown.enter.prevent="toggleCitation(src.id)"
          >
            <div class="knowledge-citation-card__top">
              <span class="knowledge-citation-card__index">{{ Number(idx) + 1 }}</span>
              <strong class="knowledge-citation-card__title">{{ src.title }}</strong>
              <span class="knowledge-citation-card__caret" aria-hidden="true">▾</span>
            </div>
            <div class="knowledge-citation-card__meta">
              <span class="knowledge-citation-card__pill">{{ src.category }}</span>
              <span class="knowledge-citation-card__pill knowledge-citation-card__pill--level">{{ src.level }}</span>
            </div>
            <p class="knowledge-citation-card__excerpt">{{ src.excerpt }}</p>
            <span class="knowledge-citation-card__hint">{{ expandedCitations.has(src.id) ? '收起' : '展开全文' }}</span>
          </article>
        </div>
      </div>
      <div v-if="currentAgentFollowUpQuestions.length > 0" id="agent-sec-followups" class="agent-followups">
        <div class="agent-followups-header">继续追问</div>
        <div class="agent-followups-list">
          <button
            v-for="question in currentAgentFollowUpQuestions"
            :key="question"
            class="agent-followup-chip"
            @click="askSuggestedFollowUp(question)"
          >
            {{ question }}
          </button>
        </div>
      </div>
      <div v-else-if="currentAgentFollowUpLoading" class="agent-followups-loading">正在生成追问建议…</div>
    </section>
    </transition>

    <ToolTrace
      :tool-calls="currentAgentToolCalls"
      :trace="currentAgentTrace"
      :is-running="activeAgentRunIsRunning"
    />

    <div v-if="similarWords.length > 0" class="agent-section">
      <h3 class="title-with-icon">
        <Icon name="sparkles" />
        相似词推荐
      </h3>
      <div class="similar-grid">
        <button
          v-for="item in similarWords"
          :key="`${item.kanji}-${item.kana}`"
          class="similar-card"
          @click="$emit('conjugate', item.kanji)"
        >
          <strong>{{ item.kanji }}</strong>
          <span>{{ item.kana }}</span>
          <small>{{ item.meaning }}</small>
          <em>{{ item.reason }}</em>
        </button>
      </div>
    </div>

    <div v-if="agentPlan?.recommendedActions?.length" class="agent-section">
      <h3 class="title-with-icon">
        <Icon name="arrow-right" />
        下一步学习动作
      </h3>
      <div class="agent-actions-list">
        <div v-for="action in agentPlan.recommendedActions" :key="`${action.type}-${action.title}`" class="agent-action">
          <strong>{{ action.title }}</strong>
          <span>{{ action.detail }}</span>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import Icon from './Icon.vue';
import AgentRuntime from './AgentRuntime.vue';
import ToolTrace from './ToolTrace.vue';
import { useAgentStream } from '../composables/useAgentStream';
import { useSpeech } from '../composables/useSpeech';

const props = withDefaults(defineProps<{
  loading?: boolean;
  error?: string;
  form: Record<string, any>;
  suggestions?: any[];
  showDropdown?: boolean;
  showHistory?: boolean;
  history?: any[];
  isComposing?: boolean;
  verbTypeMap?: Record<string, any>;
  wordTypeDisplayMap?: Record<string, any>;
}>(), {
  loading: false,
  error: '',
  suggestions: () => [],
  showDropdown: false,
  showHistory: false,
  history: () => [],
  isComposing: false,
  verbTypeMap: () => ({}),
  wordTypeDisplayMap: () => ({}),
});

const emit = defineEmits([
  'on-input', 'on-focus', 'hide-suggestions', 'select-item',
  'clear-history', 'conjugate', 'update:is-composing',
]);

const {
  agentInput, agentMessages, agentRuns, activeAgentRunId, agentRunning, agentLoading,
  animatedAgentPlaceholder, heroChips, agentRuntimeNote,
  currentAgentRun, activeAgentRunIsRunning, currentAgentMemoryCandidates, currentAgentExamples,
  currentAgentInteractivePractice, currentAgentKnowledgeSources, currentAgentFollowUpQuestions,
  currentAgentFollowUpLoading, currentAgentToolCalls, currentAgentTrace, currentSubagentTasks,
  agentUsageSummary, currentAgentThreadSummary, latestAssistantMessage, latestUserMessage,
  renderedStreamingMarkdown, practiceOptions, agentSectionNav,
  agentPlan, similarWords, expandedCitations, activeAgentSection, agentScrollProgress,
  agentPracticeInput, agentPracticeBusy, agentPracticeHint, agentPracticeFeedback,
  streamedAssistantText, optionLabels, componentHighlightClassMap,
  runAgent, submitAgentCommand, stopActiveAgentRun, handleAgentEnter, runHeroExample,
  toggleSubagentTask, addAgentMemoryCandidate, selectPracticeOption, optionStateClass,
  resetAgentPracticeState, requestAgentPracticeHint, submitAgentPracticeAnswer,
  buildExampleSegments, toggleExampleComponent, getActiveExampleComponent,
  isExampleComponentActive, explainExampleComponent, toggleCitation,
  renderMarkdown, stripMarkdownInline, askSuggestedFollowUp,
} = useAgentStream();

const { speak } = useSpeech();
</script>

<style scoped>

.search-btn--icon {
  min-width: 0;
  width: 42px;
  height: 42px;
  padding: 0;
  border-radius: 999px;
  transition: transform 0.32s var(--ease-spring), background 0.2s var(--ease-out), box-shadow 0.32s var(--ease-out), opacity 0.2s;
}

.search-btn--icon:not(:disabled):hover {
  transform: translateY(-1px) scale(1.06);
}

.search-btn--icon:not(:disabled):active {
  transform: scale(0.9);
}

.search-btn__arrow {
  width: 20px;
  height: 20px;
  stroke-width: 2.4;
}

.search-btn__spinner {
  width: 18px;
  height: 18px;
  border-radius: 999px;
  border: 2.2px solid rgba(255, 255, 255, 0.35);
  border-top-color: #fff;
  animation: spinnerRotate 0.7s linear infinite;
}

@keyframes spinnerRotate {
  to { transform: rotate(360deg); }
}


.suggestions-list {
  position: static;
  background: var(--dropdown-bg);
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-md);
  padding: 8px;
  margin: 10px 0 0;
  list-style: none;
  box-shadow: var(--shadow-lift);
  max-height: 280px;
  overflow-y: auto;
  backdrop-filter: blur(10px);
}

.suggestions-list li {
  padding: 11px 12px;
  cursor: pointer;
  display: flex;
  align-items: center;
  border-bottom: 1px solid var(--surface-border);
  border-radius: var(--radius-sm);
  transition: background-color 0.15s;
}

.suggestions-list li:last-child {
  border-bottom: none;
}

.suggestions-list li:hover {
  background-color: var(--primary-soft);
}

.suggestions-list li.history-section {
  background: var(--surface-soft);
  padding: 8px 12px;
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
  background: rgba(254, 226, 226, 0.2);
  border-color: rgba(248, 113, 113, 0.42);
}

.btn-clear-mini:active {
  transform: translateY(1px);
}

.suggestions-list li.history-row {
  background: var(--surface-soft);
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
  color: var(--text-muted);
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
  background: var(--accent-soft);
  color: var(--primary);
  border-radius: var(--radius-sm);
  font-weight: 500;
  margin-left: 8px;
  white-space: nowrap;
}

.search-btn__spinner { animation-duration: 1.2s; }

.agent-panel--hero {
  border-color: color-mix(in srgb, var(--primary) 32%, var(--surface-border));
  box-shadow: var(--shadow-lift);
}


.hero-intro {
  text-align: center;
  padding: 18px 12px 22px;
}

.hero-title {
  margin: 0;
  font-size: clamp(2.4rem, 6vw, 3.4rem);
  font-weight: 700;
  letter-spacing: 0.04em;
  line-height: 1.1;
  color: var(--text-primary);
}

.hero-title-accent {
  color: var(--primary);
}

.hero-chips {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 9px;
  margin-top: 16px;
}

.hero-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 1px solid var(--surface-border);
  background:
    linear-gradient(135deg, rgba(255, 255, 255, 0.5), transparent),
    var(--field-bg);
  color: var(--text-secondary);
  border-radius: 999px;
  padding: 7px 15px;
  font-size: 0.86rem;
  font-family: inherit;
  cursor: pointer;
  transition: border-color 0.2s var(--ease-out), color 0.2s var(--ease-out),
    transform 0.3s var(--ease-spring), box-shadow 0.25s var(--ease-out);
}

.hero-chip .icon {
  width: 15px;
  height: 15px;
}

.hero-chip:hover {
  border-color: var(--primary);
  color: var(--primary);
  transform: translateY(-2px);
  box-shadow: var(--shadow-soft);
}

.agent-chat {
  margin: 0;
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-md);
  background: var(--field-bg);
  padding: 10px;
}


.agent-panel--hero .agent-chat {
  border-radius: var(--radius-md);
  transition: border-color 0.25s var(--ease-out), box-shadow 0.25s var(--ease-out);
}

.agent-panel--hero .agent-chat:focus-within {
  border-color: var(--primary);
  box-shadow: var(--focus-ring);
}

.agent-chat--conversation {
  margin-top: 12px;
  background: var(--panel-bg);
}

.agent-run-history {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin: 0 0 14px;
}

.agent-run-chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  max-width: 220px;
  padding: 8px 12px;
  border: 1px solid var(--surface-border);
  border-radius: 999px;
  background: var(--panel-bg);
  color: var(--text-muted);
  font: inherit;
  font-size: 0.84rem;
  cursor: pointer;
  transition: border-color 0.2s ease, background 0.2s ease, transform 0.2s ease, color 0.2s ease;
}

.agent-run-chip:hover {
  transform: translateY(-1px);
  border-color: var(--primary);
  color: var(--text-primary);
}

.agent-run-chip.active {
  background: color-mix(in srgb, var(--primary) 10%, var(--panel-bg));
  border-color: color-mix(in srgb, var(--primary) 38%, var(--surface-border));
  color: var(--text-primary);
}

.agent-run-chip.is-running {
  border-color: color-mix(in srgb, var(--primary) 30%, var(--surface-border));
}

.agent-run-chip__title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.agent-run-chip__dot {
  width: 7px;
  height: 7px;
  border-radius: 999px;
  background: var(--primary);
  box-shadow: 0 0 0 6px color-mix(in srgb, var(--primary) 14%, transparent);
  animation: pulseDot 1.5s ease-in-out infinite;
  flex-shrink: 0;
}

.agent-thread-summary {
  margin: 0 0 14px;
  padding: 14px 16px;
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-md);
  background: var(--panel-bg);
  display: grid;
  gap: 10px;
}

.agent-thread-summary__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.agent-thread-summary__head strong {
  font-size: 0.92rem;
  color: var(--text-primary);
}

.agent-thread-summary__head span {
  font-size: 0.76rem;
  color: var(--text-muted);
  text-transform: uppercase;
}

.agent-thread-summary__digest {
  margin: 0;
  color: var(--text-secondary);
  font-size: 0.88rem;
  line-height: 1.55;
}

.agent-thread-summary__group {
  display: grid;
  gap: 6px;
}

.agent-thread-summary__label {
  font-size: 0.76rem;
  color: var(--text-muted);
}

.agent-thread-summary__pills {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.agent-thread-summary__pill {
  display: inline-flex;
  align-items: center;
  padding: 5px 10px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--primary) 8%, var(--panel-bg));
  border: 1px solid color-mix(in srgb, var(--primary) 20%, var(--surface-border));
  color: var(--text-secondary);
  font-size: 0.78rem;
}

.agent-thread-summary__pill--muted {
  background: var(--field-bg);
  border-color: var(--surface-border);
}

.agent-answer-core {
  position: relative;
  margin: 12px 0 10px;
  padding: 16px;
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-md);
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--primary-soft) 38%, transparent), transparent 34%),
    var(--field-bg);
  box-shadow: 0 16px 34px rgba(25, 52, 60, 0.08);
  overflow: hidden;
}

.agent-answer-core::before {
  content: '';
  position: absolute;
  inset: 0 0 auto;
  height: 2px;
  background: var(--primary);
  opacity: 0.55;
}

.agent-answer-core--streaming {
  border-color: color-mix(in srgb, var(--primary) 55%, var(--surface-border));
}

.agent-answer-core--streaming::before {
  background-size: 180% 100%;
  animation: streamSweep 1.8s ease-in-out infinite;
}

.agent-answer-pulse {
  position: absolute;
  top: 12px;
  right: 12px;
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: var(--primary);
  box-shadow: 0 0 0 5px var(--primary-soft);
  animation: pulseDot 1.25s ease-in-out infinite;
}

.agent-answer-question {
  margin: 0 0 12px;
  padding: 9px 11px;
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-sm);
  background: var(--panel-bg);
  color: var(--text-primary);
  font-size: 0.92rem;
  line-height: 1.55;
}

.agent-memory-suggestions {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
  margin: 0 0 12px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--surface-border);
}

.agent-memory-pill {
  min-height: 30px;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  border: 1px solid var(--surface-border);
  border-radius: 999px;
  background: var(--panel-bg);
  color: var(--text-primary);
  padding: 0 10px;
  cursor: pointer;
  font: inherit;
  font-size: 0.8rem;
}

.agent-memory-pill:hover {
  border-color: var(--primary);
  background: var(--primary-soft);
}

.agent-memory-pill span:not(.agent-memory-pill__toggle) {
  color: var(--text-muted);
}


.agent-memory-pill__toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 999px;
  background: var(--primary-soft);
  color: var(--primary);
  transition: transform 0.32s var(--ease-spring), background 0.2s var(--ease-out), color 0.2s var(--ease-out);
}

.agent-memory-pill__toggle .icon {
  width: 13px;
  height: 13px;
  stroke-width: 2.6;
}

.agent-memory-pill:hover .agent-memory-pill__toggle {
  transform: rotate(90deg) scale(1.08);
}


.agent-memory-pill--added .agent-memory-pill__toggle {
  background: var(--primary);
  color: #fff;
}

.agent-memory-pill--added:hover {
  border-color: var(--danger);
  background: color-mix(in srgb, var(--danger) 10%, transparent);
}

.agent-memory-pill--added:hover .agent-memory-pill__toggle {
  background: var(--danger);
  transform: scale(1.12);
}

.typewriter-output {
  min-height: 42px;
  font-size: 0.98rem;
}

.typewriter-output--live {
  color: var(--text-secondary);
  line-height: 1.75;
  white-space: pre-wrap;
}

.typewriter-output.is-streaming::after {
  content: '';
  display: inline-block;
  width: 8px;
  height: 1.05em;
  margin-left: 4px;
  border-radius: 2px;
  background: var(--primary);
  vertical-align: -0.16em;
  animation: caretBlink 0.85s steps(1, end) infinite;
}

@keyframes streamSweep {
  0% { background-position: 0% 50%; }
  50% { background-position: 100% 50%; }
  100% { background-position: 0% 50%; }
}

@keyframes caretBlink {
  50% { opacity: 0; }
}

.agent-markdown {
  color: var(--text-secondary);
  line-height: 1.7;
}

.agent-markdown :deep(*) {
  white-space: normal;
}

.agent-markdown :deep(h1),
.agent-markdown :deep(h2),
.agent-markdown :deep(h3) {
  margin: 12px 0 8px;
  color: var(--text-primary);
  font-size: 1rem;
  line-height: 1.35;
}

.agent-markdown :deep(h1:first-child),
.agent-markdown :deep(h2:first-child),
.agent-markdown :deep(h3:first-child),
.agent-markdown :deep(p:first-child) {
  margin-top: 0;
}

.agent-markdown :deep(p) {
  margin: 0 0 8px;
  white-space: normal;
}

.agent-markdown :deep(ul),
.agent-markdown :deep(ol) {
  margin: 8px 0 10px;
  padding-left: 20px;
}

.agent-markdown :deep(li) {
  margin: 4px 0;
}

.agent-markdown :deep(blockquote) {
  margin: 10px 0;
  padding: 8px 12px;
  border-left: 3px solid var(--primary);
  background: var(--primary-soft);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
}

.agent-markdown :deep(code) {
  padding: 2px 5px;
  border-radius: 5px;
  background: var(--surface-muted);
  color: var(--text-primary);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.92em;
}

.agent-markdown :deep(pre) {
  overflow-x: auto;
  padding: 10px 12px;
  border-radius: var(--radius-sm);
  background: var(--surface-muted);
}

.agent-markdown :deep(pre code) {
  padding: 0;
  background: transparent;
}

.agent-markdown :deep(a) {
  color: var(--primary);
  font-weight: 700;
}

.agent-markdown :deep(table) {
  width: 100%;
  border-collapse: collapse;
  margin: 10px 0;
  overflow: hidden;
  border-radius: var(--radius-sm);
}

.agent-markdown :deep(th),
.agent-markdown :deep(td) {
  border: 1px solid var(--surface-border);
  padding: 8px 10px;
  text-align: left;
}

.agent-markdown :deep(th) {
  background: var(--panel-bg);
  color: var(--text-primary);
}

.agent-chat-input {
  display: flex;
  gap: 10px;
  align-items: stretch;
}

.agent-chat-input input {
  flex: 1;
  min-width: 0;
  min-height: 46px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-primary);
  padding: 0 12px;
  font-size: 0.96rem;
}

.agent-chat-input input::placeholder {
  color: color-mix(in srgb, var(--text-muted) 88%, transparent);
}

.agent-chat-input input:focus {
  outline: none;
}

.agent-stop-btn {
  flex-shrink: 0;
  min-height: 46px;
  padding: 0 14px;
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, var(--danger, #b85c38) 12%, var(--field-bg));
  color: var(--text-secondary);
  font: inherit;
  font-size: 0.9rem;
  cursor: pointer;
  transition: border-color 0.2s ease, background-color 0.2s ease, color 0.2s ease, transform 0.2s ease;
}

.agent-stop-btn:hover {
  border-color: color-mix(in srgb, var(--danger, #b85c38) 46%, var(--surface-border));
  color: var(--text-primary);
}

.agent-stop-btn:active {
  transform: scale(0.98);
}

.agent-section + .agent-section {
  margin-top: 18px;
}

.agent-section h3 {
  margin: 0 0 10px;
}

.similar-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
  gap: 10px;
}

.similar-card {
  text-align: left;
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-md);
  background: var(--field-bg);
  padding: 12px;
  color: inherit;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 4px;
  transition: all 0.2s ease;
}

.similar-card:hover {
  transform: translateY(-2px);
  border-color: var(--primary);
  box-shadow: 0 12px 24px rgba(24, 35, 31, 0.1);
}

.similar-card strong {
  color: var(--text-primary);
  font-size: 1.1rem;
}

.similar-card span,
.similar-card small {
  color: var(--text-muted);
}

.similar-card em {
  color: var(--primary);
  font-style: normal;
  font-size: 0.78rem;
}

.agent-actions-list {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 10px;
}

.agent-action {
  padding: 12px;
  border-left: 4px solid var(--primary);
  border-radius: var(--radius-sm);
  background: var(--panel-bg);
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.agent-action strong {
  color: var(--text-primary);
}

.agent-action span {
  color: var(--text-muted);
  line-height: 1.5;
}

.ex-japanese ruby rt {
  font-size: 0.55em;
  color: var(--text-muted);
}


.agent-examples-panel {
  margin-top: var(--space-6);
}

.agent-examples-panel::before {
  content: '例句';
  display: block;
  margin-bottom: 10px;
  color: var(--text-muted);
  font-size: 0.74rem;
  font-weight: 700;
  letter-spacing: 0.18em;
}


.agent-practice-card {
  position: relative;
  margin-top: var(--space-6);
  padding: 18px 20px 20px;
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-lg);
  background: var(--surface-soft);
  box-shadow: var(--shadow-soft);
  overflow: hidden;
  animation: slideUp 0.55s var(--ease-out) both;
}


.agent-practice-card::before {
  content: '';
  position: absolute;
  left: 0;
  top: 14px;
  bottom: 14px;
  width: 3px;
  border-radius: 999px;
  background: var(--primary);
  opacity: 0.85;
}

.agent-practice-card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.agent-practice-card__eyebrow {
  color: var(--text-muted);
  font-size: 0.74rem;
  font-weight: 700;
  letter-spacing: 0.16em;
}

.agent-practice-card__tag {
  padding: 3px 11px;
  border-radius: 999px;
  background: var(--primary-soft);
  color: var(--primary);
  font-size: 0.78rem;
  font-weight: 700;
}

.agent-practice-card__prompt {
  margin: 12px 0 16px;
  color: var(--text-primary);
  font-size: 1.12rem;
  font-weight: 600;
  line-height: 1.5;
}

.agent-practice-options {
  display: flex;
  flex-direction: column;
  gap: 9px;
}

.agent-practice-option {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 12px 14px;
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-md);
  background: var(--field-bg);
  color: var(--text-primary);
  font: inherit;
  font-size: 1.04rem;
  text-align: left;
  cursor: pointer;
  transition: border-color 0.25s var(--ease-out), background 0.25s var(--ease-out), transform 0.35s var(--ease-spring), box-shadow 0.25s var(--ease-out);
}

.agent-practice-option:not(:disabled):hover {
  border-color: var(--primary);
  transform: translateX(3px);
  box-shadow: var(--shadow-soft);
}

.agent-practice-option:not(:disabled):active {
  transform: scale(0.99);
}

.agent-practice-option__index {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  flex-shrink: 0;
  border-radius: 999px;
  background: var(--accent-soft);
  color: var(--text-secondary);
  font-size: 0.82rem;
  font-weight: 700;
}

.agent-practice-option__text {
  flex: 1;
}

.agent-practice-option__icon {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
}

.agent-practice-option.is-selected {
  border-color: var(--primary);
  background: var(--primary-soft);
}

.agent-practice-option.is-answer {
  border-color: var(--success);
  background: color-mix(in srgb, var(--success) 14%, transparent);
  color: var(--success);
}

.agent-practice-option.is-answer .agent-practice-option__index {
  background: var(--success);
  color: #fff;
}

.agent-practice-option.is-missed {
  border-color: var(--danger);
  background: color-mix(in srgb, var(--danger) 12%, transparent);
  color: var(--danger);
}

.agent-practice-option.is-missed .agent-practice-option__index {
  background: var(--danger);
  color: #fff;
}

.agent-practice-option.is-dimmed {
  opacity: 0.5;
}

.agent-practice-option:disabled {
  cursor: default;
}

.agent-practice-card__actions {
  display: flex;
  gap: 10px;
  margin-top: 14px;
}

.agent-ghost-btn {
  border: 1px solid var(--surface-border);
  border-radius: 999px;
  background: transparent;
  color: var(--text-secondary);
  padding: 7px 16px;
  font: inherit;
  font-size: 0.84rem;
  font-weight: 600;
  cursor: pointer;
  transition: border-color 0.18s, color 0.18s;
}

.agent-ghost-btn:not(:disabled):hover {
  border-color: var(--primary);
  color: var(--primary);
}

.agent-ghost-btn:disabled {
  opacity: 0.5;
  cursor: default;
}

.agent-practice-hint {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 14px;
  padding: 10px 14px;
  border-radius: var(--radius-md);
  background: var(--primary-soft);
  color: var(--text-secondary);
  font-size: 0.9rem;
  line-height: 1.55;
}

.agent-practice-hint__icon {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  color: var(--primary);
}

.agent-practice-result {
  margin-top: 16px;
  padding: 14px 16px;
  border-radius: var(--radius-md);
  border: 1px solid transparent;
}

.agent-practice-result.is-correct {
  background: color-mix(in srgb, var(--success) 12%, transparent);
  border-color: color-mix(in srgb, var(--success) 36%, transparent);
}

.agent-practice-result.is-wrong {
  background: color-mix(in srgb, var(--danger) 10%, transparent);
  border-color: color-mix(in srgb, var(--danger) 34%, transparent);
}

.agent-practice-result__msg {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 700;
  color: var(--text-primary);
}

.agent-practice-result__icon {
  width: 18px;
  height: 18px;
}

.agent-practice-result.is-correct .agent-practice-result__icon {
  color: var(--success);
}

.agent-practice-result.is-wrong .agent-practice-result__icon {
  color: var(--danger);
}

.agent-practice-result__copy {
  margin: 8px 0 0;
  color: var(--text-secondary);
  font-size: 0.92rem;
  line-height: 1.65;
}

.agent-practice-memory-note {
  display: flex;
  align-items: center;
  gap: 7px;
  margin: 10px 0 0;
  padding: 8px 12px;
  border-radius: var(--radius-sm);
  font-size: 0.84rem;
  color: var(--primary);
  background: var(--primary-soft);
}

.agent-practice-memory-note .icon-memory {
  width: 15px;
  height: 15px;
  flex-shrink: 0;
}

.agent-followups {
  margin-top: 16px;
  padding-top: 14px;
  border-top: 1px solid var(--surface-border);
}

.agent-followups-header {
  color: var(--text-muted);
  font-size: 0.84rem;
  margin-bottom: 10px;
}

.agent-followups-list {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.agent-followups-loading {
  margin-top: 14px;
  color: var(--text-muted);
  font-size: 0.86rem;
}

.agent-followup-chip {
  border: 1px solid var(--surface-border);
  border-radius: 999px;
  background: var(--panel-bg);
  color: var(--text-primary);
  padding: 9px 14px;
  font: inherit;
  font-size: 0.9rem;
  cursor: pointer;
  transition: transform 0.18s ease, border-color 0.18s ease, background 0.18s ease;
}

.agent-followup-chip:hover {
  transform: translateY(-1px);
  border-color: var(--primary);
  background: rgba(35, 103, 244, 0.06);
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

.example-highlight--button {
  border: 0;
  font: inherit;
  line-height: inherit;
  cursor: pointer;
  transition: transform 0.16s ease, box-shadow 0.16s ease, filter 0.16s ease;
}

.example-highlight--button:hover {
  transform: translateY(-1px);
  filter: saturate(1.06);
}

.example-highlight--button.is-active {
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--text-primary) 16%, transparent), 0 0 0 2px color-mix(in srgb, var(--panel-bg) 86%, transparent);
}

.example-highlight.is-topic,
.example-highlight.is-subject,
.example-highlight.is-object,
.example-highlight.is-predicate,
.example-highlight.is-location,
.example-highlight.is-time,
.example-highlight.is-direction {
  background: color-mix(in srgb, var(--primary) 14%, transparent);
}

.example-highlight.is-support {
  background: color-mix(in srgb, var(--surface-border) 50%, transparent);
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

.example-inspector {
  margin-top: 10px;
  padding: 10px 12px;
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--panel-bg) 74%, var(--surface-soft));
  border: 1px solid var(--surface-border);
}

.example-inspector__title {
  color: var(--text-primary);
  font-size: 0.86rem;
  font-weight: 700;
  margin-bottom: 6px;
}

.example-inspector__body {
  color: var(--text-secondary);
  font-size: 0.88rem;
  line-height: 1.65;
}

.shake-enter-active {
  animation: shakeIn 0.45s ease both;
}

.shake-leave-active {
  animation: fadeOut 0.2s ease both;
}

.suggestion-meaning,
  .suggestion-romaji {
    display: none;
  }

.knowledge-citations { margin-top: 18px; }

.knowledge-citations__head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 8px;
}

.knowledge-citations__label {
  font-size: 0.8rem;
  letter-spacing: 0.08em;
  color: var(--text-muted);
}

.knowledge-citations__count {
  font-size: 0.72rem;
  color: var(--text-muted);
  opacity: 0.7;
}

.knowledge-citations__list {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 10px;
  align-items: start;
}

.knowledge-citation-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px 14px;
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-md);
  background: var(--panel-bg);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  box-shadow: var(--glass-highlight);
  transition: transform 0.18s ease, box-shadow 0.18s ease;
}

.knowledge-citation-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-soft), var(--glass-highlight);
}

.knowledge-citation-card__top {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}

.knowledge-citation-card__index {
  flex: none;
  width: 18px;
  height: 18px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 0.7rem;
  border-radius: 50%;
  color: var(--primary);
  background: color-mix(in srgb, var(--primary) 12%, transparent);
}

.knowledge-citation-card__title {
  font-size: 0.92rem;
  color: var(--text-primary);
  line-height: 1.4;
}

.knowledge-citation-card__meta {
  display: flex;
  gap: 6px;
}

.knowledge-citation-card__pill {
  font-size: 0.7rem;
  padding: 2px 8px;
  border-radius: 999px;
  color: var(--text-muted);
  border: 1px solid var(--surface-border);
  background: transparent;
}

.knowledge-citation-card__pill--level {
  color: var(--primary);
  border-color: color-mix(in srgb, var(--primary) 30%, transparent);
}

.knowledge-citation-card__excerpt {
  margin: 0;
  font-size: 0.84rem;
  line-height: 1.65;
  color: var(--text-secondary);
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
  white-space: pre-line;
}

.knowledge-citation-card { cursor: pointer; }

.knowledge-citation-card.is-expanded .knowledge-citation-card__excerpt {
  display: block;
  -webkit-line-clamp: unset;
  overflow: visible;
}

.knowledge-citation-card__caret {
  margin-left: auto;
  flex: none;
  font-size: 0.7rem;
  color: var(--text-muted);
  transition: transform 0.18s ease;
}

.knowledge-citation-card.is-expanded .knowledge-citation-card__caret {
  transform: rotate(180deg);
}

.knowledge-citation-card__hint {
  align-self: flex-end;
  font-size: 0.7rem;
  color: var(--primary);
  opacity: 0.75;
}



.error-message {
  color: var(--danger);
  background-color: rgba(254, 226, 226, 0.16);
  border: 1px solid rgba(248, 113, 113, 0.46);
  padding: 10px var(--space-4);
  border-radius: var(--radius-md);
  margin-top: 10px;
  font-size: 0.88em;
}

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

.markdown-body p {
  margin-bottom: 10px;
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

.btn-speak--sm .icon {
  width: 14px;
  height: 14px;
}

.btn-speak--lg .icon {
  width: 20px;
  height: 20px;
}



.icon-clock {
  width: 14px;
  height: 14px;
}

.icon-trash {
  width: 12px;
  height: 12px;
}
</style>
