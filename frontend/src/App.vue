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
            致谢
          </button>
          <template v-if="authUser">
            <span class="auth-user" :title="`已登录：${authUser.username}`">{{ authUser.username }}</span>
            <button type="button" class="pref-link" title="退出登录" @click="logout">退出</button>
          </template>
          <button v-else type="button" class="pref-link auth-login-btn" title="登录 / 注册" @click="openAuthModal('login')">
            登录
          </button>
        </div>
      </div>

      <AuthModal :modal="authModal" @submit="submitAuth" @close="closeAuthModal" />

      <div class="header-bottom">
        <div class="mode-switch" aria-label="功能模式">
          <button
            v-if="currentMode === 'credits'"
            class="active"
            @click="currentMode = 'dict'"
          >
            返回工作台
          </button>
          <button
            v-if="currentMode !== 'credits'"
            :class="{ active: workbenchSection === 'dict' }"
            @click="workbenchSection = 'dict'"
          >
            词典查询
          </button>
          <button
            v-if="currentMode !== 'credits'"
            :class="{ active: workbenchSection === 'memory' }"
            @click="workbenchSection = 'memory'"
          >
            单词复习
          </button>
          <button
            v-if="currentMode !== 'credits'"
            :class="{ active: workbenchSection === 'docs' }"
            @click="workbenchSection = 'docs'"
          >
            说明
          </button>
          <button
            v-if="currentMode !== 'credits'"
            :class="{ active: workbenchSection === 'dojo' }"
            @click="workbenchSection = 'dojo'"
          >
            变形道场
          </button>
        </div>
        <button class="nav-llm-toggle" @click="showLlmSettings = !showLlmSettings">
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
        <button class="agent-chip" @click="saveLlmSettingsToServer">保存</button>
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
          <button class="agent-chip" @click="saveEmbeddingSettings">保存检索设置</button>
        </div>
      </div>
      </transition>
    </header>

    <template v-if="currentMode !== 'credits'">
    <section v-if="workbenchSection === 'dict'" class="agent-panel agent-panel--hero card">
      <div class="agent-chat">
        <div v-if="agentMessages.length === 0" class="hero-intro">
          <p class="hero-eyebrow">JAPANESE WORD MASTER</p>
          <h1 class="hero-title">問<span class="hero-title-accent">日本語</span></h1>
          <p class="hero-subtitle">查词 · 辨析 · 活用 · 造句 —— 用一句中文提问，AI 帮你拆解日语。</p>
        </div>
        <div class="agent-chat-input">
          <input
            id="agent-command"
            v-model="agentInput"
            type="text"
            :placeholder="animatedAgentPlaceholder"
            @input="onInput"
            @focus="onFocus"
            @blur="hideSuggestionsWithDelay"
            @compositionstart="isComposing = true"
            @compositionend="isComposing = false"
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
          >{{ chip.label }}</button>
        </div>

        <ul v-if="showDropdown && (suggestions.length > 0 || showHistory)" class="suggestions-list agent-suggestions">
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
        <p v-if="activeAgentRunIsRunning && agentRuntimeNote" class="agent-runtime-note">{{ agentRuntimeNote }}</p>
        <div v-if="currentSubagentTasks.length > 0" class="agent-subagent-strip">
          <button
            v-for="task in currentSubagentTasks"
            :key="task.taskId"
            class="agent-subagent-pill"
            :class="`agent-subagent-pill--${task.status || 'running'}`"
            type="button"
            @click="toggleSubagentTask(task.taskId)"
          >
            <span class="agent-subagent-pill__name">{{ task.label || task.agent }}</span>
            <span class="agent-subagent-pill__status">{{ formatSubagentTaskStatus(task.status) }}</span>
          </button>
        </div>
        <div v-if="activeSubagentTaskDetails" class="agent-subagent-card">
          <div class="agent-subagent-card__head">
            <strong>{{ activeSubagentTaskDetails.label || activeSubagentTaskDetails.agent }}</strong>
            <span>{{ formatSubagentTaskStatus(activeSubagentTaskDetails.status) }}</span>
          </div>
          <div class="agent-subagent-card__meta">
            <span v-if="activeSubagentTaskDetails.sandbox?.policy">policy · {{ activeSubagentTaskDetails.sandbox.policy }}</span>
            <span v-if="activeSubagentTaskDetails.sandbox?.timeoutMs">timeout · {{ activeSubagentTaskDetails.sandbox.timeoutMs }}ms</span>
            <span v-if="activeSubagentTaskDetails.sandbox?.maxCompletionTokens">budget · {{ activeSubagentTaskDetails.sandbox.maxCompletionTokens }}</span>
          </div>
          <div v-if="activeSubagentTaskDetails.events?.length" class="agent-subagent-card__events">
            <div
              v-for="(entry, idx) in activeSubagentTaskDetails.events"
              :key="`${activeSubagentTaskDetails.taskId}-${idx}`"
              class="agent-subagent-card__event"
            >
              <span>{{ entry.type }}</span>
              <small>{{ entry.message }}</small>
            </div>
          </div>
        </div>
        <div v-if="agentUsageSummary" class="agent-usage-banner" :class="`agent-usage-banner--${agentUsageSummary.level}`">
          <span>{{ agentUsageSummary.label }}</span>
          <strong v-if="agentUsageSummary.warning">{{ agentUsageSummary.warning }}</strong>
        </div>
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
              <span class="agent-practice-option__index">{{ optionLabels[idx] }}</span>
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
                <span class="knowledge-citation-card__index">{{ idx + 1 }}</span>
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

      <transition name="agent-flow">
      <div id="agent-sec-tools" class="agent-chat agent-chat--trace" v-if="currentAgentToolCalls.length > 0 && !activeAgentRunIsRunning">
        <details v-if="currentAgentToolCalls.length > 0" class="agent-tool-trace">
          <summary class="tool-trace-header">
            <span>工具</span>
            <small>{{ currentAgentToolCalls.length }}</small>
          </summary>
          <transition-group name="agent-tool-list">
          <div v-for="(call, index) in currentAgentToolCalls" :key="`${call.name}-${index}`" class="agent-tool-card" :class="`agent-tool-card--${call.status || 'done'}`">
            <span class="tool-step">{{ index + 1 }}</span>
            <div>
              <strong>{{ toolNameLabel(call.name) }}</strong>
              <p>{{ call.status === 'running' ? '调用中：' : '' }}{{ formatToolArgs(call.arguments) }}</p>
              <small v-if="call.result">{{ formatToolResult(call) }}</small>
            </div>
          </div>
          </transition-group>
        </details>
      </div>
      </transition>

      <div id="agent-sec-trace" class="agent-chat agent-chat--trace" v-if="currentAgentTrace.length > 0 && !activeAgentRunIsRunning">
        <details class="agent-tool-trace agent-exec-trace">
          <summary class="tool-trace-header">
            <span>执行过程</span>
            <small>{{ currentAgentTrace.length }} 步</small>
          </summary>
          <ol class="exec-trace-list">
            <li
              v-for="step in currentAgentTrace"
              :key="step.id"
              class="exec-trace-step"
              :class="`exec-trace-step--${step.status || 'done'}`"
            >
              <span class="exec-trace-dot" aria-hidden="true"></span>
              <div class="exec-trace-body">
                <div class="exec-trace-head">
                  <strong>{{ step.title }}</strong>
                  <time>{{ step.time }}</time>
                </div>
                <p v-if="step.body">{{ step.body }}</p>
              </div>
            </li>
          </ol>
        </details>
      </div>

      <div v-if="similarWords.length > 0" class="agent-section">
        <h3>相似词推荐</h3>
        <div class="similar-grid">
          <button
            v-for="item in similarWords"
            :key="`${item.kanji}-${item.kana}`"
            class="similar-card"
            @click="form.verb = item.kanji; conjugate()"
          >
            <strong>{{ item.kanji }}</strong>
            <span>{{ item.kana }}</span>
            <small>{{ item.meaning }}</small>
            <em>{{ item.reason }}</em>
          </button>
        </div>
      </div>

      <div v-if="agentPlan?.recommendedActions?.length" class="agent-section">
        <h3>下一步学习动作</h3>
        <div class="agent-actions-list">
          <div v-for="action in agentPlan.recommendedActions" :key="`${action.type}-${action.title}`" class="agent-action">
            <strong>{{ action.title }}</strong>
            <span>{{ action.detail }}</span>
          </div>
        </div>
      </div>
    </section>

    <section v-if="workbenchSection === 'memory'" class="memory-panel card">
      <div class="memory-header">
        <div>
          <h2>记忆复习</h2>
        </div>
        <div class="memory-traffic" role="img" :aria-label="`待复习 ${memoryStats.due}，学习中 ${memoryStats.learning}，已稳定 ${memoryStats.mastered}`">
          <span class="traffic-dot traffic-dot--red" :class="{ 'is-active': memoryStats.due > 0 }" title="待复习">{{ memoryStats.due }}</span>
          <span class="traffic-dot traffic-dot--amber" :class="{ 'is-active': memoryStats.learning > 0 }" title="学习中">{{ memoryStats.learning }}</span>
          <span class="traffic-dot traffic-dot--green" :class="{ 'is-active': memoryStats.mastered > 0 }" title="已稳定">{{ memoryStats.mastered }}</span>
        </div>
      </div>

      <div class="memory-settings memory-settings--panel">
        <div class="memory-settings__header">
          <h3>参数</h3>
          <button class="agent-chip" @click="showMemorySettings = !showMemorySettings">
            {{ showMemorySettings ? '收起' : '展开' }}
          </button>
        </div>
        <div v-if="showMemorySettings" class="memory-settings__grid">
          <label>
            <span>目标保持率</span>
            <input v-model.number="memorySettings.desiredRetention" type="number" min="0.7" max="0.98" step="0.01">
          </label>
          <label>
            <span>每日新卡</span>
            <input v-model.number="memorySettings.newCardsPerDay" type="number" min="1" max="100">
          </label>
          <label>
            <span>每日复习上限</span>
            <input v-model.number="memorySettings.reviewLimitPerDay" type="number" min="5" max="300">
          </label>
          <label>
            <span>忘记后间隔(分钟)</span>
            <input v-model.number="memorySettings.lapseMinutes" type="number" min="5" max="1440">
          </label>
          <label>
            <span>困难倍率</span>
            <input v-model.number="memorySettings.hardMultiplier" type="number" min="1" max="2.5" step="0.1">
          </label>
          <label>
            <span>最大间隔(天)</span>
            <input v-model.number="memorySettings.maxIntervalDays" type="number" min="7" max="3650">
          </label>
          <label>
            <span>学习等级</span>
            <select v-model="memorySettings.exampleDifficulty">
              <option value="auto">自动</option>
              <option value="N5">N5</option>
              <option value="N4">N4</option>
              <option value="N3">N3</option>
              <option value="N2">N2</option>
              <option value="N1">N1</option>
            </select>
          </label>
          <label class="settings-check">
            <input v-model="memorySettings.autoAddSimilar" type="checkbox">
            <span>查词后自动收集推荐词</span>
          </label>
          <button class="search-btn settings-save" @click="saveMemorySettingsToServer">保存参数</button>
        </div>
      </div>

      <div v-if="reviewQuota" class="memory-quota">
        <span class="memory-quota-item">今日复习 <strong>{{ reviewQuota.reviewsToday }}/{{ reviewQuota.reviewLimit }}</strong></span>
        <span class="memory-quota-dot" aria-hidden="true">·</span>
        <span class="memory-quota-item">新卡 <strong>{{ reviewQuota.newCardsToday }}/{{ reviewQuota.newLimit }}</strong></span>
      </div>

      <div v-if="activeMemoryCard" class="memory-review">
        <div class="memory-card-face">
          <span class="memory-word">{{ activeMemoryCard.word }}</span>
          <span v-if="activeMemoryCard.reading" class="memory-reading">{{ activeMemoryCard.reading }}</span>
          <span class="memory-type">{{ activeMemoryCard.typeLabel }}</span>
        </div>
        <div v-if="memoryRevealed" class="memory-answer">
          <p>{{ activeMemoryCard.meaning || '暂无释义，建议查询后补充。' }}</p>
          <div v-if="activeMemoryCard.sample" class="memory-sample">{{ activeMemoryCard.sample }}</div>
        </div>
        <div class="memory-actions">
          <button v-if="!memoryRevealed" class="btn-secondary" @click="memoryRevealed = true">显示</button>
          <template v-else>
            <button class="memory-grade grade-forgot" @click="reviewMemory(activeMemoryCard.id, 'forgot')">忘记</button>
            <button class="memory-grade grade-hard" @click="reviewMemory(activeMemoryCard.id, 'hard')">模糊</button>
            <button class="memory-grade grade-good" @click="reviewMemory(activeMemoryCard.id, 'good')">记住</button>
          </template>
          <button class="btn-secondary" @click="searchMemoryCard(activeMemoryCard)">查词</button>
        </div>
      </div>

      <div v-else class="memory-empty">
        <strong>{{ reviewLimitReached ? '今日已达上限' : (memoryCards.length > 0 ? '今日清空' : '暂无卡片') }}</strong>
        <p>{{ reviewLimitReached ? '今天的复习 / 新卡配额已用完，明天继续。' : (memoryCards.length > 0 ? nextMemoryText : '查词后加入记忆。') }}</p>
      </div>

      <div class="memory-library">
        <div class="memory-library-toolbar">
          <input
            v-model="memoryLibraryQuery"
            type="text"
            class="memory-library-search"
            placeholder="搜索已保存词条"
          >
          <div class="memory-library-filters">
            <button
              v-for="filter in memoryLibraryFilters"
              :key="filter.id"
              class="memory-library-filter"
              :class="{ active: memoryLibraryFilter === filter.id }"
              @click="memoryLibraryFilter = filter.id"
            >
              {{ filter.label }}
            </button>
          </div>
        </div>

        <div v-if="filteredMemoryCards.length > 0" class="memory-library-list">
          <div
            v-for="card in filteredMemoryCards"
            :key="card.id"
            class="memory-library-item"
          >
            <div class="memory-library-copy">
              <strong>{{ card.word }}</strong>
              <span v-if="card.reading">{{ card.reading }}</span>
              <p>{{ card.meaning || '暂无释义' }}</p>
            </div>
            <div class="memory-library-meta">
              <small>{{ formatMemoryDueLabel(card) }}</small>
              <button class="memory-library-action" @click="searchMemoryCard(card)">查词</button>
            </div>
          </div>
        </div>
        <div v-else class="memory-library-empty">没有匹配到已保存词条。</div>
      </div>

      <!-- Agent 长期记忆：区别于上面的 SRS 复习卡，记的是"你是谁/要什么/在做什么" -->
      <div class="agent-memory-block">
        <div class="agent-memory-head">
          <h3>Agent 长期记忆</h3>
          <span class="agent-memory-sub">个性化回答的依据 · 与复习卡相互独立</span>
        </div>
        <div v-if="agentMemoryList.length > 0" class="agent-memory-list">
          <div v-for="item in agentMemoryList" :key="item.id" class="agent-memory-item">
            <span class="agent-memory-tag" :data-type="item.type">{{ agentMemoryTypeLabel(item.type) }}</span>
            <span class="agent-memory-value">{{ item.value }}</span>
            <button class="agent-memory-del" title="忘记这条" @click="deleteAgentMemoryItem(item.id)">×</button>
          </div>
        </div>
        <p v-else class="agent-memory-empty">还没有长期记忆。多和 Agent 聊聊学习目标和偏好，它会逐渐记住你。</p>
      </div>
    </section>

    <main class="main-content" v-if="workbenchSection === 'dict' && (result || loadingAi)">
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

// 认证：token 存 localStorage，拦截器给每个请求自动带上 Authorization
const AUTH_TOKEN_KEY = 'jvm_auth_token';
axios.interceptors.request.use((config) => {
  const token = localStorage.getItem(AUTH_TOKEN_KEY);
  if (token) {
    config.headers = config.headers || {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// 全局模式
const currentMode = ref('dict'); // 'dict' | 'credits'
const authUser = ref(null); // 当前登录用户 { id, username }，null 表示未登录
const authModal = ref({ open: false, mode: 'login', username: '', password: '', error: '', loading: false });
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
    if (!authUser.value) localStorage.removeItem(AUTH_TOKEN_KEY); // token 失效
  } catch (e) {
    authUser.value = null;
  }
};

const openAuthModal = (mode = 'login') => {
  authModal.value = { open: true, mode, username: '', password: '', error: '', loading: false };
};

const closeAuthModal = () => {
  authModal.value.open = false;
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
    const { data } = await axios.post(url, { username, password: m.password });
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
let suggestTimeout = null;

const agentThreadSummary = ref(null);
const agentThreadId = ref('');


// 查询历史
const MAX_HISTORY = 20;
const history = ref([]);
const memoryCards = ref([]);
const reviewQueue = ref([]);      // 服务端限流后的当日复习队列
const reviewQuota = ref(null);    // { reviewsToday/reviewLimit/newCardsToday/newLimit/... }
const agentMemoryList = ref([]);  // Agent 长期记忆（goal/preference/fact/task）
const memoryRevealed = ref(false);
const memoryLibraryQuery = ref('');
const memoryLibraryFilter = ref('all');
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
const defaultAgentPlaceholderExamples = [
  '问日语：食べる 和 召し上がる 有什么区别',
  '问日语：为什么 〜ている 有时表示状态',
  '问日语：给我 3 个便利店场景例句',
  '问日语：把 猫 翻成日语并推荐相近词'
];
const agentPlaceholderExamples = ref([...defaultAgentPlaceholderExamples]);

// 首屏快捷示例：短标签 + 实际发送的完整提问
const heroChips = [
  { label: '食べる 的活用', prompt: '问日语：食べる 的全部活用形式' },
  { label: '〜ている 的用法', prompt: '问日语：为什么 〜ている 有时表示状态' },
  { label: '便利店场景例句', prompt: '问日语：给我 3 个便利店场景例句' },
  { label: '把「猫」翻成日语', prompt: '问日语：把 猫 翻成日语并推荐相近词' }
];
const runHeroExample = (prompt) => {
  agentInput.value = prompt;
  submitAgentCommand();
};
const animatedAgentPlaceholder = ref(agentPlaceholderExamples.value[0]);
let placeholderInterval = null;
let placeholderRefreshInterval = null;
const agentRuntimeEngine = ref('LangGraph');
let agentRunSeq = 0;
const defaultAgentQueue = [
  { id: 'planner', label: 'Planner', description: '拆解学习任务与工具路线', status: 'queued' },
  { id: 'researcher', label: 'Researcher', description: '调用词典、搜索和相似词工具', status: 'queued' },
  { id: 'tutor', label: 'Tutor', description: '流式组织解释、例句和练习', status: 'queued' },
  { id: 'memory_manager', label: 'Memory Manager', description: '刷新记忆队列与复习上下文', status: 'queued' }
];
const agentQueue = ref(defaultAgentQueue.map(item => ({ ...item })));
const agentRuntimeNote = ref('');
const showMemorySettings = ref(false);
const showLlmSettings = ref(false);
const llmProviderPresets = {
  deepseek: { baseUrl: 'https://api.deepseek.com', model: 'deepseek-v4-flash' },
  openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  openrouter: { baseUrl: 'https://openrouter.ai/api/v1', model: 'anthropic/claude-3.5-sonnet' },
  siliconflow: { baseUrl: 'https://api.siliconflow.cn/v1', model: 'deepseek-ai/DeepSeek-V3' },
  custom: { baseUrl: '', model: '' },
  ollama: { baseUrl: 'http://127.0.0.1:11434', model: 'qwen2.5' }
};
const memorySettings = ref({
  desiredRetention: 0.9,
  newCardsPerDay: 12,
  reviewLimitPerDay: 60,
  lapseMinutes: 20,
  hardMultiplier: 1.2,
  maxIntervalDays: 180,
  autoAddSimilar: false,
  exampleDifficulty: 'auto'
});
const memoryLibraryFilters = [
  { id: 'all', label: '全部' },
  { id: 'due', label: '待复习' },
  { id: 'mastered', label: '稳定' }
];

const llmStatusLabel = computed(() => {
  const provider = llmStatus.value.provider || 'ollama';
  const ready = provider === 'ollama' || llmStatus.value.apiKeySet;
  return `${provider} · ${ready ? (llmStatus.value.model || 'model') : '未配置'}`;
});

const ensureAgentThreadId = () => {
  if (agentThreadId.value) return agentThreadId.value;
  const storageKey = 'jwm-agent-thread-id';
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

const currentAgentRun = computed(() => {
  if (!agentRuns.value.length) return null;
  return agentRuns.value.find(run => run.id === activeAgentRunId.value) || agentRuns.value[agentRuns.value.length - 1];
});

const activeAgentRunIsRunning = computed(() => currentAgentRun.value?.status === 'running');

const currentAgentMemoryCandidates = computed(() => currentAgentRun.value?.memoryCandidates || []);
const currentAgentExamples = computed(() => currentAgentRun.value?.examples || []);
const currentAgentInteractivePractice = computed(() => currentAgentRun.value?.interactivePractice || null);
const currentAgentKnowledgeSources = computed(() => currentAgentRun.value?.knowledgeSources || []);
const expandedCitations = ref(new Set());
const toggleCitation = (id) => {
  const next = new Set(expandedCitations.value);
  if (next.has(id)) next.delete(id); else next.add(id);
  expandedCitations.value = next;
};

// 回答区右侧模块导航：滚动进度 + 锚点跳转
const activeAgentSection = ref('');
const agentScrollProgress = ref(0);
const agentSectionNav = computed(() => {
  if (workbenchSection.value !== 'dict' || currentMode.value === 'credits') return [];
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

const jumpToAgentSection = (id) => {
  const el = document.getElementById(id);
  if (!el) return;
  activeAgentSection.value = id;
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

let agentScrollRaf = 0;
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
onMounted(() => {
  window.addEventListener('scroll', onAgentSectionScroll, { passive: true });
  window.addEventListener('resize', onAgentSectionScroll, { passive: true });
});
onUnmounted(() => {
  window.removeEventListener('scroll', onAgentSectionScroll);
  window.removeEventListener('resize', onAgentSectionScroll);
  if (agentScrollRaf) cancelAnimationFrame(agentScrollRaf);
});
const currentAgentFollowUpQuestions = computed(() => currentAgentRun.value?.followUpQuestions || []);
const currentAgentFollowUpLoading = computed(() => !!currentAgentRun.value?.followUpLoading);
const currentAgentToolCalls = computed(() => currentAgentRun.value?.toolCalls || []);
const currentAgentTrace = computed(() => currentAgentRun.value?.trace || []);
const currentSubagentTasks = computed(() => currentAgentRun.value?.subagentTasks || []);
const activeSubagentTaskId = ref('');
const activeSubagentTaskDetails = computed(() => currentSubagentTasks.value.find(task => task.taskId === activeSubagentTaskId.value) || null);
const activeExampleInspector = ref({});

const escapeHtml = (value = '') => String(value || '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');

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
    追加主题: `这里的「${particle}」有“也”的感觉，把「${text}」并入当前话题，表示它也适用同样的说明。${readingHint}`,
    主语: `这里常见是因为后面的动作或状态由「${text}」来承担，所以它被看作主语。${readingHint}`,
    宾语: `这里带有「${particle}」的提示，说明「${text}」是动作直接作用到的对象，所以是宾语。${readingHint}`,
    谓语: `这一段放在句子后半段，真正说出了“做什么/是什么/怎么样”，所以它是谓语核心。${readingHint}`,
    时间: `这一段在交代动作发生的时间点或时间范围，通常会和「に」这类助词一起出现。${readingHint}`,
    地点: `这里是在说明动作发生或目标所在的地点，所以被归为地点成分。${readingHint}`,
    '地点/方式': `这一段既可能表示地点，也可能表示进行动作的方式，要结合后面的动作一起理解。${readingHint}`,
    '方式/场所': `这里不是动作对象，而是在补充“在哪里/用什么方式”完成这个动作。${readingHint}`,
    方向: `这里常带方向感，说明动作朝向哪里去。${readingHint}`,
    '对象/并列': `这里通常是在说明动作的对象，或者把两个并列项连接起来。${readingHint}`,
    '起点/原因': `这一段常常表示“从哪里开始”或“为什么如此”，属于补充说明。${readingHint}`,
    终点: `这里交代动作、范围或时间延伸到哪里结束。${readingHint}`,
    比较基准: `这里是拿来做比较的参照物，帮助理解差异从哪里来。${readingHint}`,
    补语: `这一段是在补充条件、状态或落点，让句意更完整。${readingHint}`,
    补足: `这部分是对句子核心的补充说明，帮助把场景、条件或细节交代清楚。${readingHint}`
  };

  return explanations[label] || `${text} 在这句里承担的是「${label}」作用，用来帮助句子把关系说完整。${readingHint}`;
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
      method: 'POST'
    });
  } catch (error) {
    console.warn('Failed to cancel run tasks:', error);
  }
};

const refreshRunTaskHistory = async (runId = '') => {
  if (!runId) return;
  try {
    const response = await fetch(`/api/subagent-tasks?runId=${encodeURIComponent(runId)}&limit=24`);
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
    const response = await fetch(`/api/agent-runs?limit=16&threadId=${encodeURIComponent(threadId)}`);
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
    const response = await fetch(`/api/agent-thread-summary${query}`);
    if (!response.ok) return;
    agentThreadSummary.value = await response.json();
  } catch (error) {
    console.warn('Failed to load agent thread summary:', error);
  }
};

const agentRuntimeLabel = computed(() => {
  return agentRuntimeEngine.value ? `${agentRuntimeEngine.value} · ${llmStatusLabel.value}` : llmStatusLabel.value;
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

const stripMarkdownInline = (text) => {
  if (!text) return '';
  return String(text)
    .replace(/\|[-: ]+\|/g, ' ')
    .replace(/[|#*`~_>]+/g, ' ')
    .replace(/-{3,}/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
};

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

watch(activeAgentRunId, (runId) => {
  if (!runId) return;
  const target = agentRuns.value.find(run => run.id === runId);
  if (!target) return;
  if (!Array.isArray(target.subagentTasks) || target.subagentTasks.length === 0) {
    refreshRunTaskHistory(runId);
  }
  loadAgentThreadSummary(runId);
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

let streamRenderQueue = '';
let streamRenderTimer = null;
let streamRenderDone = false;
let streamRenderDrainResolvers = [];

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

const optionLabels = ['A', 'B', 'C', 'D'];

const practiceOptions = computed(() => {
  const q = currentAgentInteractivePractice.value?.question;
  if (!q) return [];
  if (Array.isArray(q.options) && q.options.length > 0) return q.options;
  // 兜底：旧数据没有 options 时，至少展示正确答案。
  return q.answer ? [q.answer] : [];
});

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
        memoryCards.value = data.memory.cards.map(normalizeMemoryCard);
      }
      if (data.memory.profile) {
        userProfile.value = { ...userProfile.value, ...data.memory.profile };
      }
      const card = data.memory.card;
      if (card) {
        const dueLabel = formatMemoryDueLabel(normalizeMemoryCard(card));
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
        lookup: result.value,
        memoryStats: memoryStats.value,
        userProfile: userProfile.value,
        conversation,
        memoryCandidates: agentMemoryCandidates.value,
        exampleDifficulty: memorySettings.value.exampleDifficulty
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

const waitForStreamRendererDrain = () => {
  if (!streamRenderQueue.length && !streamRenderTimer) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    streamRenderDrainResolvers.push(resolve);
    resolveStreamDrain();
  });
};

const getMemoryWord = (item) => item?.dictionaryForm || item?.word || item?.verb || '';

const normalizeMemoryCard = (card) => ({
  ...card,
  ease: Number(card.ease) || 2.2,
  intervalDays: Number(card.intervalDays) || 0,
  reviewCount: Number(card.reviewCount) || 0,
  lapses: Number(card.lapses) || 0,
  dueAt: card.dueAt || new Date().toISOString(),
  createdAt: card.createdAt || new Date().toISOString(),
  updatedAt: card.updatedAt || new Date().toISOString()
});

const loadMemoryCards = async () => {
  try {
    const res = await axios.get('/api/memory-cards');
    memoryCards.value = res.data.map(normalizeMemoryCard);
    await Promise.allSettled([loadUserProfile(), loadReviewQueue(), loadAgentMemory()]);
  } catch (e) {
    console.error('加载记忆卡片失败', e);
  }
};

// 服务端限流后的复习队列 + 当日配额（newCardsPerDay / reviewLimitPerDay 在此生效）
const loadReviewQueue = async () => {
  try {
    const { data } = await axios.get('/api/memory-review-queue');
    reviewQueue.value = (data.cards || []).map(normalizeMemoryCard);
    reviewQuota.value = data.quota || null;
  } catch (e) {
    console.error('加载复习队列失败', e);
  }
};

const AGENT_MEMORY_TYPE_LABELS = { goal: '目标', preference: '偏好', fact: '事实', task: '任务' };
const agentMemoryTypeLabel = (type) => AGENT_MEMORY_TYPE_LABELS[type] || type;

const loadAgentMemory = async () => {
  try {
    const { data } = await axios.get('/api/agent-memory');
    agentMemoryList.value = Array.isArray(data) ? data : [];
  } catch (e) {
    console.error('加载 Agent 记忆失败', e);
  }
};

const deleteAgentMemoryItem = async (id) => {
  try {
    const { data } = await axios.delete(`/api/agent-memory/${id}`);
    agentMemoryList.value = Array.isArray(data) ? data : [];
  } catch (e) {
    console.error('删除 Agent 记忆失败', e);
  }
};

const loadMemorySettings = async () => {
  try {
    const res = await axios.get('/api/memory-settings');
    memorySettings.value = { ...memorySettings.value, ...res.data };
  } catch (e) {
    console.error('加载记忆参数失败', e);
  }
};

const saveMemorySettingsToServer = async () => {
  try {
    const res = await axios.post('/api/memory-settings', memorySettings.value);
    memorySettings.value = { ...memorySettings.value, ...res.data };
  } catch (e) {
    console.error('保存记忆参数失败', e);
  }
};

const loadLlmSettings = async () => {
  try {
    const res = await axios.get('/api/llm-settings');
    llmSettings.value = { ...llmSettings.value, ...res.data, apiKey: '' };
    llmStatus.value = res.data;
  } catch (e) {
    console.error('加载 LLM 设置失败', e);
  }
};

const embeddingSettings = ref({ provider: 'ollama', model: 'bge-m3', baseUrl: 'http://localhost:11434', apiKey: '', apiKeySet: false });
const loadEmbeddingSettings = async () => {
  try { embeddingSettings.value = { ...embeddingSettings.value, ...(await axios.get('/api/knowledge/embedding-settings')).data }; } catch (e) { console.error('加载检索设置失败', e); }
};
const saveEmbeddingSettings = async () => {
  const { apiKeySet, ...payload } = embeddingSettings.value;
  try { embeddingSettings.value = { ...embeddingSettings.value, ...(await axios.post('/api/knowledge/embedding-settings', payload)).data, apiKey: '' }; } catch (e) { console.error('保存检索设置失败', e); }
};

const saveLlmSettingsToServer = async () => {
  try {
    const payload = { ...llmSettings.value };
    if (!payload.apiKey) delete payload.apiKey;
    const res = await axios.post('/api/llm-settings', payload);
    llmSettings.value = { ...llmSettings.value, ...res.data, apiKey: '' };
    llmStatus.value = res.data;
  } catch (e) {
    console.error('保存 LLM 设置失败', e);
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
    apiKey: ''
  };
};

const addAgentMemoryCandidate = async (item) => {
  if (!item) return;
  try {
    if (item.added) {
      const existing = memoryCards.value.find(card => card.word === item.word);
      if (!existing) {
        item.added = false;
        return;
      }
      const res = await axios.delete(`/api/memory-cards/${existing.id}`);
      memoryCards.value = res.data.map(normalizeMemoryCard);
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
    memoryCards.value = res.data.map(normalizeMemoryCard);
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
    existing.set(key, { ...item, added: memoryCards.value.some(card => card.word === item.word) });
  }
  agentMemoryCandidates.value = [...existing.values()].slice(0, 8);
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

const compactText = (text, limit = 120) => {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  return value.length > limit ? `${value.slice(0, limit)}...` : value;
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

const renderMarkdown = (content) => {
  if (!content) return '';
  const html = marked.parse(content, {
    breaks: true,
    gfm: true
  });
  if (typeof window === 'undefined' || typeof DOMParser === 'undefined') return html;

  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script, iframe, object, embed, style').forEach(node => node.remove());
  doc.body.querySelectorAll('*').forEach((node) => {
    [...node.attributes].forEach((attr) => {
      const name = attr.name.toLowerCase();
      const value = attr.value.trim().toLowerCase();
      if (name.startsWith('on') || value.startsWith('javascript:') || value.startsWith('data:text/html')) {
        node.removeAttribute(attr.name);
      }
    });
  });
  return doc.body.innerHTML;
};

const dueMemoryCards = computed(() => {
  const now = Date.now();
  return memoryCards.value
    .filter(card => new Date(card.dueAt).getTime() <= now)
    .sort((a, b) => new Date(a.dueAt) - new Date(b.dueAt));
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
  const mastered = memoryCards.value.filter(card => card.intervalDays >= 7).length;
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
    .filter(card => new Date(card.dueAt).getTime() > Date.now())
    .sort((a, b) => new Date(a.dueAt) - new Date(b.dueAt));
  if (futureCards.length === 0) return '继续添加查询过的词，记忆队列会自动安排复习。';
  const nextDate = new Date(futureCards[0].dueAt);
  return `下一张卡片将在 ${nextDate.toLocaleDateString()} 到期。`;
});

const filteredMemoryCards = computed(() => {
  const keyword = memoryLibraryQuery.value.trim().toLowerCase();
  return memoryCards.value.filter((card) => {
    if (memoryLibraryFilter.value === 'due' && new Date(card.dueAt).getTime() > Date.now()) {
      return false;
    }
    if (memoryLibraryFilter.value === 'mastered' && card.intervalDays < 7) {
      return false;
    }
    if (!keyword) return true;
    return [card.word, card.reading, card.meaning]
      .filter(Boolean)
      .some(text => String(text).toLowerCase().includes(keyword));
  });
});

const currentMemoryId = computed(() => {
  const word = getMemoryWord(result.value);
  if (!word) return '';
  return memoryCards.value.find(card => card.word === word)?.id || '';
});

const isCurrentMemorized = computed(() => !!currentMemoryId.value);

watch(() => activeMemoryCard.value?.id, () => {
  memoryRevealed.value = false;
});

watch(memoryCards, (cards) => {
  const savedWords = new Set(cards.map(card => card.word));
  agentMemoryCandidates.value = agentMemoryCandidates.value.map(item => ({
    ...item,
    added: savedWords.has(item.word)
  }));
}, { deep: true });

const buildMemoryCard = (item) => {
  const word = getMemoryWord(item);
  const meanings = item.meanings?.map(m => m.definitions).filter(Boolean).join('; ');
  const now = new Date().toISOString();
  return normalizeMemoryCard({
    id: `${word}-${Date.now()}`,
    word,
    reading: item.reading || item.kana || '',
    meaning: item.meaning || meanings || '',
    wordType: item.wordType || 'verb',
    verbType: item.verbType || '',
    sample: aiExamples.value[0]?.japanese || '',
    ease: 2.2,
    intervalDays: 0,
    reviewCount: 0,
    lapses: 0,
    dueAt: now,
    createdAt: now,
    updatedAt: now
  });
};

const addCurrentToMemory = async () => {
  if (!result.value) return;
  const word = getMemoryWord(result.value);
  if (!word) return;

  try {
    let res;
    if (currentMemoryId.value) {
      res = await axios.delete(`/api/memory-cards/${currentMemoryId.value}`);
    } else {
      res = await axios.post('/api/memory-cards', buildMemoryCard(result.value));
    }
    memoryCards.value = res.data.map(normalizeMemoryCard);
    await refreshAgentPlan(result.value);
  } catch (e) {
    console.error('保存记忆卡片失败', e);
  }
};

const reviewMemory = async (id, grade) => {
  try {
    const res = await axios.post(`/api/memory-cards/${id}/review`, { grade });
    memoryCards.value = res.data.cards.map(normalizeMemoryCard);
    if (res.data.quota) reviewQuota.value = res.data.quota;
    memoryRevealed.value = false;
    await loadReviewQueue(); // 取下一张（仍受当日限流约束）
    if (result.value) await refreshAgentPlan(result.value);
  } catch (e) {
    console.error('复习记录保存失败', e);
  }
};

const searchMemoryCard = (card) => {
  if (!card?.word) return;
  form.value.verb = card.word;
  conjugate();
};

const formatMemoryDueLabel = (card) => {
  const dueTime = new Date(card.dueAt).getTime();
  if (Number.isNaN(dueTime)) return '时间未知';
  if (dueTime <= Date.now()) return '现在可复习';
  const due = new Date(card.dueAt);
  return `下次 ${due.toLocaleDateString()}`;
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

  const setStreamingPlaceholder = (text) => {
    if (!hasTutorToken) {
      assistantMessage.content = `> ${text}`;
    }
  };

  try {
    const controller = new AbortController();
    agentAbortController.value = controller;
    timeoutId = window.setTimeout(() => controller.abort(), 90000);
    const response = await fetch('/api/agent/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        runId,
        threadId: ensureAgentThreadId(),
        message,
        context: {
          lookup: result.value,
          memoryStats: memoryStats.value,
          userProfile: userProfile.value,
          conversation: buildAgentConversationContext(),
          exampleDifficulty: memorySettings.value.exampleDifficulty
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
        throw new Error(payload.message || 'Agent stream failed.');
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
    await loadMemoryCards();
  } catch (e) {
    if (e.name === 'AbortError') {
      assistantMessage.content ||= '已停止上一次请求。';
      streamedAssistantText.value = assistantMessage.content;
      if (runSeq === agentRunSeq) {
        agentRuntimeNote.value = '上一次请求已停止，可以继续新的查询。';
      }
    } else {
      assistantMessage.content = 'Agent 调用失败，请检查 DeepSeek Key、网络或后端日志。';
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

const submitAgentCommand = async () => {
  const value = agentInput.value.trim();
  if (!value) return;
  showDropdown.value = false;
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
  if (isComposing.value) return;
  if (e.key === 'Enter') {
    await submitAgentCommand();
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
  return aiRawExplanation.value ? marked(aiRawExplanation.value) : '';
});

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

onMounted(async () => {
  ensureAgentThreadId();
  await loadCurrentUser();
  initDisplayPreferences();
  startAgentPlaceholderAnimation();
  loadHotPlaceholderExamples();
  placeholderRefreshInterval = window.setInterval(() => {
    loadHotPlaceholderExamples(true);
  }, 30 * 60 * 1000);
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
  await loadPersistedAgentRuns();
  await loadAgentThreadSummary();
  await loadMemoryCards();
  await loadMemorySettings();
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
    return texts; // fallback: 返回原文
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
  if (placeholderInterval) window.clearInterval(placeholderInterval);
  if (placeholderRefreshInterval) window.clearInterval(placeholderRefreshInterval);
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
    const response = await fetch('/api/ai-explain', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      signal: controller.signal,
      body: JSON.stringify(requestBody)
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
    if (err.name === 'AbortError') return;
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

/* === 下拉补全 === */
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

.agent-memory-sub {
  font-size: 0.76rem;
  color: var(--text-muted);
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
  flex-shrink: 0;
  border: none;
  background: transparent;
  color: var(--text-muted);
  font-size: 1.1rem;
  line-height: 1;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: var(--radius-sm);
  transition: color 0.2s, background 0.2s;
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

.agent-panel--hero {
  border-color: color-mix(in srgb, var(--primary) 32%, var(--surface-border));
  box-shadow: var(--shadow-lift);
}

/* 首屏引导 */
.hero-intro {
  text-align: center;
  padding: 18px 12px 22px;
}

.hero-eyebrow {
  margin: 0 0 10px;
  font-size: 0.72rem;
  letter-spacing: 0.32em;
  font-weight: 700;
  color: var(--primary);
  opacity: 0.85;
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

.hero-subtitle {
  margin: 12px auto 0;
  max-width: 30em;
  font-size: 0.98rem;
  line-height: 1.7;
  color: var(--text-muted);
}

.hero-chips {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 9px;
  margin-top: 16px;
}

.hero-chip {
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

.hero-chip:hover {
  border-color: var(--primary);
  color: var(--primary);
  transform: translateY(-2px);
  box-shadow: var(--shadow-soft);
}

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

.agent-chat {
  margin: 0;
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-md);
  background: var(--field-bg);
  padding: 10px;
}

/* 主搜索框：方形（圆角矩形），聚焦时主色描边 */
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

.agent-chat--trace {
  margin-top: 10px;
  padding: 10px 14px;
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-md);
  background: var(--field-bg);
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

/* 加号 / 减号圆形徽标 */
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

/* 已加入：徽标变实色减号，悬停旋转回去暗示「移除」 */
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

/* ── 即时练习：独立的和风选择题卡片 ── */
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

/* 左侧竖线点缀，呼应和风装帧 */
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
