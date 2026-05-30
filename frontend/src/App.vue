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
        <div class="brand-block">
          <span class="brand-mark" aria-hidden="true">日</span>
        </div>

        <div class="preference-bar" aria-label="显示偏好设置">
          <label class="pref-toggle">
            <input
              v-model="darkMode"
              type="checkbox"
              class="pref-toggle-input"
            >
            <span class="pref-toggle-track" aria-hidden="true">
              <span class="pref-toggle-thumb"></span>
            </span>
            <span>深色模式</span>
          </label>
          <label class="pref-toggle">
            <input
              v-model="accessibilityMode"
              type="checkbox"
              class="pref-toggle-input"
            >
            <span class="pref-toggle-track" aria-hidden="true">
              <span class="pref-toggle-thumb"></span>
            </span>
            <span>无障碍模式</span>
          </label>
        </div>
      </div>

      <div class="header-bottom">
        <div class="mode-switch" aria-label="功能模式">
          <button :class="{ active: currentMode === 'dict' }" @click="currentMode = 'dict'">词典查询</button>
          <button :class="{ active: currentMode === 'dojo' }" @click="currentMode = 'dojo'">变形道场</button>
        </div>
      </div>
    </header>

    <section class="agent-panel agent-panel--hero card">
      <div class="agent-header">
        <div>
          <p class="eyebrow memory-eyebrow">Learning Agent</p>
          <h2>日语学习 Agent 指挥台</h2>
        </div>
        <span v-if="agentLoading" class="agent-status">分析中...</span>
        <span v-else class="agent-status">{{ llmStatusLabel }}</span>
      </div>

      <p class="agent-note">{{ agentPlan?.coachNote || agentDefaultNote }}</p>

      <div class="agent-chat">
        <div class="agent-chat-input">
          <input
            id="agent-command"
            v-model="agentInput"
            type="text"
            placeholder="输入日语词或问题：食べる / neko / 食べる 和 召し上がる 有什么区别？"
            @input="onInput"
            @focus="onFocus"
            @blur="hideSuggestionsWithDelay"
            @compositionstart="isComposing = true"
            @compositionend="isComposing = false"
            @keyup.enter="handleAgentEnter"
            autocomplete="off"
          >
          <button class="search-btn" :disabled="loading || !agentInput.trim()" @click="submitAgentCommand">
            {{ agentRunning ? '切换' : loading ? '查询中' : '执行' }}
          </button>
        </div>

        <div class="agent-quick-actions">
          <button class="agent-chip" @click="focusSearch">查词</button>
          <button class="agent-chip" @click="currentMode = 'dojo'">练习</button>
          <button class="agent-chip" @click="memoryRevealed = !!activeMemoryCard">复习</button>
          <button class="agent-chip" @click="showMemorySettings = !showMemorySettings">参数</button>
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
      <div v-if="agentRunning || agentMessages.length > 0" class="agent-runtime" aria-label="Agent 运行队列">
        <div
          v-for="agent in agentQueue"
          :key="agent.id"
          class="agent-runtime-node"
          :class="`agent-runtime-node--${agent.status}`"
        >
          <span class="runtime-dot" aria-hidden="true"></span>
          <div>
            <strong>{{ agent.label }}</strong>
            <span>{{ agent.description }}</span>
          </div>
        </div>
      </div>
      </transition>
      <p v-if="agentRuntimeNote" class="agent-runtime-note">{{ agentRuntimeNote }}</p>

      <transition name="agent-flow">
      <div class="agent-chat agent-chat--conversation" v-if="agentMessages.length > 0 || agentToolCalls.length > 0">
        <div class="agent-chat-log" v-if="agentMessages.length > 0">
          <transition-group name="agent-message-list">
          <div
            v-for="(msg, index) in agentMessages"
            :key="index"
            class="agent-message"
            :class="`agent-message--${msg.role}`"
          >
            <strong>{{ msg.role === 'user' ? '你' : 'Agent' }}</strong>
            <div
              v-if="msg.role === 'assistant'"
              class="agent-markdown markdown-body"
              v-html="renderMarkdown(msg.content)"
            ></div>
            <p v-else>{{ msg.content }}</p>
          </div>
          </transition-group>
        </div>
        <details v-if="agentToolCalls.length > 0" class="agent-tool-trace" :open="agentRunning">
          <summary class="tool-trace-header">
            <span>Agent 工具轨迹</span>
            <small>{{ agentToolCalls.length }} steps</small>
          </summary>
          <transition-group name="agent-tool-list">
          <div v-for="(call, index) in agentToolCalls" :key="`${call.name}-${index}`" class="agent-tool-card" :class="`agent-tool-card--${call.status || 'done'}`">
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

      <div v-if="showMemorySettings" class="memory-settings">
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
        <label class="settings-check">
          <input v-model="memorySettings.autoAddSimilar" type="checkbox">
          <span>查词后自动收集推荐词</span>
        </label>
        <button class="search-btn settings-save" @click="saveMemorySettingsToServer">保存参数</button>
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

    <section class="memory-panel card">
      <div class="memory-header">
        <div>
          <p class="eyebrow memory-eyebrow">Memory Queue</p>
          <h2>记忆复习</h2>
        </div>
        <div class="memory-stats">
          <span><strong>{{ memoryStats.total }}</strong> 张卡片</span>
          <span><strong>{{ memoryStats.due }}</strong> 待复习</span>
          <span><strong>{{ memoryStats.mastered }}</strong> 已稳定</span>
        </div>
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
          <button v-if="!memoryRevealed" class="btn-secondary" @click="memoryRevealed = true">显示答案</button>
          <template v-else>
            <button class="memory-grade grade-forgot" @click="reviewMemory(activeMemoryCard.id, 'forgot')">忘记</button>
            <button class="memory-grade grade-hard" @click="reviewMemory(activeMemoryCard.id, 'hard')">模糊</button>
            <button class="memory-grade grade-good" @click="reviewMemory(activeMemoryCard.id, 'good')">记住</button>
          </template>
          <button class="btn-secondary" @click="searchMemoryCard(activeMemoryCard)">查这个词</button>
        </div>
      </div>

      <div v-else class="memory-empty">
        <strong>{{ memoryCards.length > 0 ? '今天没有到期卡片' : '还没有记忆卡片' }}</strong>
        <p>{{ memoryCards.length > 0 ? nextMemoryText : '查询一个词后点“加入记忆”，它会进入复习队列。' }}</p>
      </div>
    </section>

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
            <button
              class="memory-btn"
              :class="{ active: isCurrentMemorized }"
              @click="addCurrentToMemory"
            >
              {{ isCurrentMemorized ? '已在记忆库' : '加入记忆' }}
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
              {{ isCurrentMemorized ? '已在记忆库' : '加入记忆' }}
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
    </div>

    <!-- Dojo 模式 -->
    <div v-if="currentMode === 'dojo'" class="dojo-wrapper">
      <transition name="card-fade" mode="out-in">
        <!-- 准备界面 -->
        <div v-if="dojoState === 'start'" class="card dojo-card dojo-start" key="start">
          <Icon name="brain" class="icon-brain-large" />
          <h2>动词变形道场</h2>
          <p class="dojo-start-copy">先选一个练习场景，再开始 10 题挑战。你在道场里的答题表现会自动生成学习画像。</p>
          <div class="dojo-scene-grid">
            <button
              v-for="scene in sceneOptions"
              :key="scene.id"
              class="scene-card"
              :class="{ active: selectedSceneId === scene.id }"
              @click="selectedSceneId = scene.id"
            >
              <span class="scene-card-title">{{ scene.name }}</span>
              <span class="scene-card-desc">{{ scene.description }}</span>
              <span class="scene-card-meta">{{ scene.meta }}</span>
              <span v-if="scene.preview" class="scene-card-preview">{{ scene.preview }}</span>
            </button>
          </div>
          <div class="dojo-profile-panel" v-if="practiceProfile.totalAttempts > 0">
            <div class="dojo-profile-header">
              <h3>学习画像</h3>
              <span class="profile-badge">最近 {{ practiceProfile.totalAttempts }} 次练习</span>
            </div>
            <div class="dojo-profile-stats">
              <div class="profile-stat">
                <strong>{{ practiceProfile.accuracy }}%</strong>
                <span>综合正确率</span>
              </div>
              <div class="profile-stat">
                <strong>{{ practiceProfile.todayAttempts }}</strong>
                <span>今日练习</span>
              </div>
              <div class="profile-stat">
                <strong>{{ practiceProfile.avgDuration }}s</strong>
                <span>平均答题</span>
              </div>
            </div>
            <p class="profile-recommendation">{{ practiceProfile.recommendation }}</p>
            <div class="profile-subsection" v-if="practiceProfile.weakestForms.length > 0">
              <span class="profile-subtitle">薄弱变形</span>
              <div class="profile-tag-list">
                <span v-for="item in practiceProfile.weakestForms" :key="item.key" class="profile-tag">
                  {{ item.label }} {{ item.accuracy }}%
                </span>
              </div>
            </div>
            <div class="profile-subsection" v-if="practiceProfile.sceneStats.length > 0">
              <span class="profile-subtitle">场景掌握度</span>
              <div class="scene-progress-list">
                <div v-for="item in practiceProfile.sceneStats" :key="item.id" class="scene-progress-row">
                  <span>{{ item.name }}</span>
                  <strong>{{ item.accuracy }}%</strong>
                </div>
              </div>
            </div>
            <div class="profile-subsection" v-if="practiceProfile.wrongBook.length > 0">
              <span class="profile-subtitle">错题本</span>
              <div class="wrong-book-list">
                <div v-for="item in practiceProfile.wrongBook" :key="`${item.verb}-${item.formKey}`" class="wrong-book-item">
                  <div class="wrong-book-main">
                    <strong>{{ item.verb }}</strong>
                    <span>{{ item.formLabel }}</span>
                    <span class="wrong-book-scene">{{ item.sceneName }}</span>
                  </div>
                  <div class="wrong-book-meta">
                    <span>正确：{{ item.correctAnswer }}</span>
                    <span>最近写成：{{ item.latestUserAnswer || '未记录' }}</span>
                    <span>累计错 {{ item.wrongCount }} 次</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <p v-else class="dojo-profile-empty">完成几轮挑战后，这里会出现你的薄弱变形、场景掌握度和推荐练习。</p>
          <button class="search-btn btn-dojo-start" @click="startDojo" :disabled="dojoLoading">
            <span v-if="dojoLoading" class="spinner-small"></span>
            <span v-else>开始{{ selectedSceneName }}挑战</span>
          </button>
        </div>

        <!-- 游戏界面 -->
        <div v-else-if="dojoState === 'playing'" class="card dojo-card dojo-playing" key="playing">
          <div class="dojo-header">
            <span class="dojo-progress">进度: {{ dojoCurrentIndex + 1 }} / {{ dojoQuestions.length }}</span>
            <span class="dojo-scene-pill">{{ activeDojoSceneName }}</span>
            <span class="dojo-score">得分: <strong>{{ dojoScore }}</strong></span>
          </div>

          <div class="dojo-question">
            <div class="dojo-verb">
              <span class="dojo-kanji">{{ currentQuestion.verb }}</span>
              <span class="dojo-romaji" v-if="currentQuestion.romaji">{{ currentQuestion.romaji }}</span>
              <span class="dojo-meaning">{{ currentQuestion.meaning }}</span>
            </div>
            <div class="dojo-prompt">
              请写出它的 <strong>{{ currentQuestion.formLabel }}</strong>
            </div>
          </div>

          <div class="dojo-choice-area">
            <button
              v-for="option in currentQuestion.options || []"
              :key="option"
              class="dojo-choice-btn"
              :class="getDojoChoiceClass(option)"
              :disabled="!!dojoFeedback"
              @click="selectDojoOption(option)"
            >
              {{ option }}
            </button>
          </div>

          <div class="dojo-action-row">
            <button v-if="dojoFeedback" class="search-btn btn-next" @click="nextDojoQuestion">
              {{ dojoCurrentIndex < dojoQuestions.length - 1 ? '下一题' : '查看成绩' }}
            </button>
          </div>

          <div v-if="dojoFeedback" class="dojo-feedback" :class="dojoFeedback.isCorrect ? 'feedback-correct' : 'feedback-error'">
            <div v-if="dojoFeedback.isCorrect" class="feedback-msg">
              <Icon name="check" class="icon-check" /> 完全正确！
            </div>
            <div v-else class="feedback-msg">
              <Icon name="error" class="icon-error" /> 错误。正确答案是: <strong>{{ dojoFeedback.correctAnswer }}</strong>
            </div>
          </div>
        </div>

        <!-- 结算界面 -->
        <div v-else-if="dojoState === 'end'" class="card dojo-card dojo-end" key="end">
          <h2>挑战结束！</h2>
          <p class="dojo-end-scene">{{ activeDojoSceneName }}</p>
          <div class="final-score">
            <span class="score-number">{{ dojoScore }}</span> / {{ dojoQuestions.length }}
          </div>
          <p class="score-eval">
            {{ dojoScore === dojoQuestions.length ? '完美！你是动词大师 🏆' : 
               dojoScore >= 8 ? '非常棒！只有一点点小瑕疵 🌟' : 
               dojoScore >= 5 ? '不错，继续加油！💪' : 
               '看来还需要多加练习哦 📚' }}
          </p>
          <button class="search-btn btn-dojo-start" @click="startDojo">再来一局</button>
        </div>
      </transition>
    </div>

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
</template>

<script setup>
import { ref, watch, onMounted, computed, onUnmounted, nextTick } from 'vue';
import axios from 'axios';
import { marked } from 'marked';
import * as wanakana from 'wanakana';
import Icon from './components/Icon.vue';

// 全局模式
const currentMode = ref('dict'); // 'dict' | 'dojo'
const isComposing = ref(false); // 跟踪输入法状态，防止回车键误触
const darkMode = ref(false);
const accessibilityMode = ref(false);

const readBooleanPreference = (key, fallback = false) => {
  try {
    const saved = localStorage.getItem(key);
    if (saved === null) return fallback;
    return saved === 'true';
  } catch (e) {
    return fallback;
  }
};

const saveBooleanPreference = (key, value) => {
  try {
    localStorage.setItem(key, String(value));
  } catch (e) {
    // Ignore storage failures in private browsing or restricted environments.
  }
};

const applyDisplayPreferences = () => {
  document.documentElement.dataset.theme = darkMode.value ? 'dark' : 'light';
  document.documentElement.dataset.accessibility = accessibilityMode.value ? 'on' : 'off';
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
const llmStatus = ref({ provider: 'ollama', model: '', deepSeekReady: false });
let suggestTimeout = null;

// Dojo 模式状态
const dojoState = ref('start'); // 'start' | 'playing' | 'end'
const dojoQuestions = ref([]);
const dojoCurrentIndex = ref(0);
const dojoScore = ref(0);
const dojoFeedback = ref(null); // { isCorrect: boolean, correctAnswer: string }
const dojoLoading = ref(false);
const dojoQuestionStartedAt = ref(0);
const dojoSelectedOption = ref('');
const scenes = ref([]);
const selectedSceneId = ref('all');
const practiceProfile = ref({
  totalAttempts: 0,
  accuracy: 0,
  todayAttempts: 0,
  avgDuration: 0,
  weakestForms: [],
  sceneStats: [],
  wrongBook: [],
  recommendation: '先完成一轮挑战，系统会开始生成你的长期学习画像。'
});

const currentQuestion = computed(() => {
  return dojoQuestions.value[dojoCurrentIndex.value] || {};
});

const sceneOptions = computed(() => {
  const sceneCards = scenes.value.map(scene => ({
    ...scene,
    meta: `${scene.verbCount} 个核心动词`,
    preview: scene.featuredVerbs?.map(verb => verb.kanji).join(' / ')
  }));

  return [
    {
      id: 'all',
      name: '随机混合',
      description: '跨场景综合训练，适合热身和复习。',
      meta: `${sceneCards.length} 个场景`,
      preview: '综合抽题'
    },
    ...sceneCards
  ];
});

const selectedSceneName = computed(() => {
  return sceneOptions.value.find(scene => scene.id === selectedSceneId.value)?.name || '随机混合';
});

const activeDojoSceneName = computed(() => {
  return currentQuestion.value.sceneName || selectedSceneName.value;
});

const recordPractice = async ({ question, userAnswer, isCorrect, durationMs }) => {
  try {
    const res = await axios.post('/api/practice-records', {
      verb: question.verb,
      formKey: question.formKey,
      sceneId: question.sceneId || 'all',
      sceneName: question.sceneName || '随机混合',
      userAnswer,
      correctAnswer: question.answer,
      isCorrect,
      durationMs,
      answeredAt: new Date().toISOString()
    });
    practiceProfile.value = res.data;
  } catch (e) {
    console.error('保存练习记录失败', e);
  }
};

const startDojo = async () => {
  dojoLoading.value = true;
  dojoError.value = '';
  try {
    const params = { limit: 10 };
    if (selectedSceneId.value !== 'all') {
      params.scene = selectedSceneId.value;
    }
    const res = await axios.get('/api/dojo-quiz', { params });
    dojoQuestions.value = res.data;
    if (dojoQuestions.value.length === 0) throw new Error('题库为空');
    
    dojoCurrentIndex.value = 0;
    dojoScore.value = 0;
    dojoState.value = 'playing';
    dojoSelectedOption.value = '';
    dojoFeedback.value = null;
    dojoQuestionStartedAt.value = Date.now();
  } catch (err) {
    alert('加载题库失败，请稍后再试。');
    console.error(err);
  } finally {
    dojoLoading.value = false;
  }
};

const getDojoChoiceClass = (option) => {
  if (!dojoFeedback.value) {
    return dojoSelectedOption.value === option ? 'choice-selected' : '';
  }
  if (option === currentQuestion.value.answer) return 'choice-correct';
  if (option === dojoSelectedOption.value && !dojoFeedback.value.isCorrect) return 'choice-wrong';
  return '';
};

const selectDojoOption = async (option) => {
  if (dojoFeedback.value) return;

  const q = currentQuestion.value;
  dojoSelectedOption.value = option;
  const isCorrect = option === q.answer;
  const durationMs = dojoQuestionStartedAt.value ? Date.now() - dojoQuestionStartedAt.value : 0;
  
  if (isCorrect) dojoScore.value++;
  await recordPractice({ question: q, userAnswer: option, isCorrect, durationMs });
  dojoFeedback.value = { isCorrect, correctAnswer: q.answer };
};

const nextDojoQuestion = () => {
  if (dojoCurrentIndex.value < dojoQuestions.value.length - 1) {
    dojoCurrentIndex.value++;
    dojoSelectedOption.value = '';
    dojoFeedback.value = null;
    dojoQuestionStartedAt.value = Date.now();
  } else {
    dojoState.value = 'end';
  }
};

const dojoError = ref('');

// 文档区折叠状态
const showDocs = ref(false);

// 查询历史
const MAX_HISTORY = 20;
const history = ref([]);
const memoryCards = ref([]);
const memoryRevealed = ref(false);
const agentPlan = ref(null);
const similarWords = ref([]);
const agentLoading = ref(false);
const agentRunning = ref(false);
const agentInput = ref('');
const agentMessages = ref([]);
const agentToolCalls = ref([]);
const agentAbortController = ref(null);
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
const agentDefaultNote = '我是这个工具的学习中枢：查词后我会生成相似词、记忆卡片建议、场景练习路径和复习优先级。';
const memorySettings = ref({
  desiredRetention: 0.9,
  newCardsPerDay: 12,
  reviewLimitPerDay: 60,
  lapseMinutes: 20,
  hardMultiplier: 1.2,
  maxIntervalDays: 180,
  autoAddSimilar: false
});

const llmStatusLabel = computed(() => {
  if (llmStatus.value.provider === 'deepseek') {
    return llmStatus.value.deepSeekReady ? `DeepSeek · ${llmStatus.value.model}` : 'DeepSeek 未配置';
  }
  return `Ollama · ${llmStatus.value.model || '本地模型'}`;
});

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
  } catch (e) {
    console.error('加载记忆卡片失败', e);
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
  external_search: '外部搜索',
  lookup_word: '词典查询',
  recommend_similar: '相似词推荐',
  memory_status: '记忆状态',
  add_memory_card: '加入记忆卡'
}[name] || name);

const resetAgentRuntime = () => {
  agentQueue.value = defaultAgentQueue.map(item => ({ ...item }));
  agentRuntimeNote.value = '';
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
  const card = dueMemoryCards.value[0];
  if (!card) return null;
  return {
    ...card,
    typeLabel: card.wordType === 'verb'
      ? (verbTypeMap[card.verbType] || '动词')
      : (wordTypeDisplayMap[card.wordType] || card.wordType || '词汇')
  };
});

const memoryStats = computed(() => ({
  total: memoryCards.value.length,
  due: dueMemoryCards.value.length,
  mastered: memoryCards.value.filter(card => card.intervalDays >= 7).length
}));

const nextMemoryText = computed(() => {
  const futureCards = memoryCards.value
    .filter(card => new Date(card.dueAt).getTime() > Date.now())
    .sort((a, b) => new Date(a.dueAt) - new Date(b.dueAt));
  if (futureCards.length === 0) return '继续添加查询过的词，记忆队列会自动安排复习。';
  const nextDate = new Date(futureCards[0].dueAt);
  return `下一张卡片将在 ${nextDate.toLocaleDateString()} 到期。`;
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
    const res = await axios.post('/api/memory-cards', buildMemoryCard(result.value));
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
    memoryRevealed.value = false;
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
    agentAbortController.value.abort();
  }

  const runSeq = ++agentRunSeq;
  agentRunning.value = true;
  agentToolCalls.value = [];
  resetAgentRuntime();
  agentMessages.value.push({ role: 'user', content: message });
  const assistantMessage = { role: 'assistant', content: '' };
  agentMessages.value.push(assistantMessage);
  agentInput.value = '';

  try {
    const controller = new AbortController();
    agentAbortController.value = controller;
    let timeoutId = window.setTimeout(() => controller.abort(), 90000);
    const response = await fetch('/api/agent/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        message,
        context: {
          lookup: result.value,
          memoryStats: memoryStats.value
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
      } else if (event === 'agent_note') {
        agentRuntimeNote.value = payload.agent === 'planner'
          ? 'Planner 已完成任务拆解，正在进入工具检索。'
          : `${payload.title}: ${compactText(payload.content, 80)}`;
      } else if (event === 'tool_start') {
        upsertStreamingToolCall(payload, 'running');
      } else if (event === 'tool_end') {
        upsertStreamingToolCall(payload, 'done');
      } else if (event === 'token') {
        assistantMessage.content += payload.content || '';
      } else if (event === 'done') {
        streamDone = true;
        if (payload.answer && !assistantMessage.content.trim()) {
          assistantMessage.content = payload.answer;
        }
        if (Array.isArray(payload.toolCalls) && payload.toolCalls.length > 0) {
          agentToolCalls.value = payload.toolCalls.map(call => ({ ...call, status: 'done' }));
        }
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
    window.clearTimeout(timeoutId);

    if (!assistantMessage.content.trim()) {
      assistantMessage.content = '我暂时没有得到明确结果。';
    }
    await loadMemoryCards();
  } catch (e) {
    if (e.name === 'AbortError') {
      assistantMessage.content ||= '已停止上一次请求。';
      agentRuntimeNote.value = '上一次请求已停止，可以继续新的查询。';
    } else {
      assistantMessage.content = 'Agent 调用失败，请检查 DeepSeek Key、网络或后端日志。';
      agentRuntimeNote.value = e.message || 'Agent 调用失败。';
    }
  } finally {
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

watch(darkMode, (value) => {
  saveBooleanPreference('jvmDarkMode', value);
  applyDisplayPreferences();
});

watch(accessibilityMode, (value) => {
  saveBooleanPreference('jvmAccessibilityMode', value);
  applyDisplayPreferences();
});

onMounted(async () => {
  const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches || false;
  darkMode.value = readBooleanPreference('jvmDarkMode', prefersDark);
  accessibilityMode.value = readBooleanPreference('jvmAccessibilityMode', false);
  applyDisplayPreferences();

  const [modelsResult, scenesResult, profileResult] = await Promise.allSettled([
    axios.get('/api/ai-models'),
    axios.get('/api/scenes'),
    axios.get('/api/practice-profile')
  ]);

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

  if (scenesResult.status === 'fulfilled') {
    scenes.value = scenesResult.value.data;
  } else {
    console.error('获取场景列表失败', scenesResult.reason);
  }

  if (profileResult.status === 'fulfilled') {
    practiceProfile.value = profileResult.value.data;
  } else {
    console.error('获取学习画像失败', profileResult.reason);
  }
  loadHistory();
  await loadMemoryCards();
  await loadMemorySettings();
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
  const results = await fetchFurigana(jaTexts);
  if (requestId !== latestFuriganaExamplesRequest) return;
  furiganaExamples.value = results;
});

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
  background:
    linear-gradient(90deg, rgba(20, 184, 166, 0.07) 1px, transparent 1px),
    linear-gradient(180deg, rgba(79, 70, 229, 0.055) 1px, transparent 1px),
    linear-gradient(135deg, #f7faf9 0%, #eef6f4 46%, #f6f7fb 100%);
  background-size: 42px 42px, 42px 42px, auto;
  color: #0f172a;
  transition: background-color 0.25s ease, color 0.25s ease;
}

:global(html[data-theme='dark'] body) {
  background:
    linear-gradient(90deg, rgba(45, 212, 191, 0.055) 1px, transparent 1px),
    linear-gradient(180deg, rgba(250, 204, 21, 0.04) 1px, transparent 1px),
    linear-gradient(135deg, #101511 0%, #151916 48%, #191720 100%);
  background-size: 42px 42px, 42px 42px, auto;
  color: #eef7f1;
}

:global(html[data-accessibility='on']) {
  font-size: 18px;
  scroll-behavior: auto;
}

.container {
  --surface: rgba(255, 255, 255, 0.88);
  --surface-soft: rgba(244, 248, 247, 0.92);
  --surface-muted: rgba(232, 240, 238, 0.92);
  --surface-border: rgba(188, 202, 200, 0.9);
  --field-bg: rgba(255, 255, 255, 0.96);
  --panel-bg: rgba(246, 250, 249, 0.96);
  --dropdown-bg: rgba(255, 255, 255, 0.98);
  --text-primary: #18231f;
  --text-secondary: #33443f;
  --text-muted: #61736e;
  --primary: #167d77;
  --primary-hover: #0f6662;
  --primary-soft: rgba(20, 184, 166, 0.12);
  --accent: #4f46e5;
  --accent-soft: rgba(79, 70, 229, 0.1);
  --success: #128447;
  --danger: #c2414a;
  --error: var(--danger);
  --border: var(--surface-border);
  --shadow-soft: 0 18px 44px rgba(24, 35, 31, 0.09);
  --shadow-lift: 0 24px 54px rgba(24, 35, 31, 0.11);
  --focus-ring: 0 0 0 3px rgba(20, 184, 166, 0.24);
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --radius-sm: 6px;
  --radius-md: 8px;
  min-height: 100vh;
  padding: 28px 22px 48px;
  max-width: 1240px;
  margin: 0 auto;
}

.container.app-dark {
  --surface: rgba(25, 31, 27, 0.88);
  --surface-soft: rgba(31, 38, 33, 0.92);
  --surface-muted: rgba(45, 55, 49, 0.96);
  --surface-border: rgba(113, 132, 122, 0.44);
  --field-bg: rgba(19, 25, 21, 0.94);
  --panel-bg: rgba(29, 36, 31, 0.94);
  --dropdown-bg: rgba(18, 24, 20, 0.98);
  --text-primary: #f4fbf6;
  --text-secondary: #dbe8df;
  --text-muted: #a9b9af;
  --primary: #5eead4;
  --primary-hover: #99f6e4;
  --primary-soft: rgba(94, 234, 212, 0.15);
  --accent: #facc15;
  --accent-soft: rgba(250, 204, 21, 0.12);
  --success: #86efac;
  --danger: #fda4af;
  --shadow-soft: 0 22px 48px rgba(0, 0, 0, 0.34);
  --shadow-lift: 0 26px 58px rgba(0, 0, 0, 0.38);
  --focus-ring: 0 0 0 3px rgba(94, 234, 212, 0.32);
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
  padding-bottom: 18px;
  border-bottom: 1px solid var(--surface-border);
}

.header-bottom {
  padding-top: 14px;
}

.brand-block {
  display: flex;
  align-items: center;
  gap: 16px;
  min-width: 0;
}

.brand-mark {
  width: 54px;
  height: 54px;
  border-radius: var(--radius-md);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  color: white;
  background:
    linear-gradient(135deg, rgba(22, 125, 119, 0.96), rgba(79, 70, 229, 0.92));
  box-shadow: 0 16px 30px rgba(22, 125, 119, 0.22);
  font-size: 1.7rem;
  font-weight: 800;
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

.pref-toggle {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 36px;
  padding: 7px 10px;
  color: var(--text-secondary);
  background: var(--surface);
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-sm);
  cursor: pointer;
  box-shadow: 0 10px 22px rgba(24, 35, 31, 0.06);
  user-select: none;
}

.pref-toggle-input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}

.pref-toggle-track {
  position: relative;
  width: 38px;
  height: 22px;
  border-radius: 999px;
  background: rgba(148, 163, 184, 0.38);
  border: 1px solid var(--surface-border);
  transition: background-color 0.2s ease, border-color 0.2s ease;
  flex-shrink: 0;
}

.pref-toggle-thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: white;
  box-shadow: 0 2px 6px rgba(15, 23, 42, 0.2);
  transition: transform 0.2s ease;
}

.pref-toggle-input:checked + .pref-toggle-track {
  background: var(--primary);
  border-color: var(--primary);
}

.pref-toggle-input:checked + .pref-toggle-track .pref-toggle-thumb {
  transform: translateX(16px);
}

.pref-toggle:focus-within {
  outline: none;
  box-shadow: var(--focus-ring);
}

/* === 模式切换 === */
.mode-switch {
  display: inline-flex;
  background: var(--surface);
  padding: 4px;
  border-radius: var(--radius-md);
  box-shadow: 0 12px 26px rgba(24, 35, 31, 0.07);
  border: 1px solid var(--surface-border);
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
  color: var(--text-primary);
  box-shadow: 0 8px 18px rgba(24, 35, 31, 0.09);
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
  box-shadow: var(--shadow-lift);
  padding: 6px 6px 6px 14px;
  transition: box-shadow 0.25s ease, border-color 0.25s ease, background-color 0.25s ease;
  border: 1px solid var(--surface-border);
  backdrop-filter: blur(12px);
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

.search-btn {
  padding: 0 22px;
  background: var(--primary);
  color: white;
  border: none;
  border-radius: var(--radius-sm);
  font-size: 0.95em;
  font-weight: 800;
  cursor: pointer;
  transition: transform 0.2s, box-shadow 0.2s, opacity 0.2s;
  white-space: nowrap;
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 72px;
  height: 44px;
}

.search-btn:hover {
  transform: translateY(-1px);
  background: var(--primary-hover);
  box-shadow: 0 10px 24px rgba(22, 125, 119, 0.28);
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
.card {
  background: var(--surface);
  border-radius: var(--radius-md);
  padding: 24px;
  box-shadow: var(--shadow-soft);
  border: 1px solid var(--surface-border);
  backdrop-filter: blur(12px);
}

.card h3 {
  color: var(--text-primary);
  margin-bottom: 14px;
  font-size: 1.05em;
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
  align-items: flex-start;
  justify-content: space-between;
  gap: 18px;
  margin-bottom: 16px;
}

.memory-header h2,
.agent-header h2 {
  margin: 0;
  color: var(--text-primary);
  font-size: 1.28rem;
}

.memory-eyebrow {
  margin-bottom: 4px;
}

.memory-stats {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.memory-stats span,
.agent-status {
  padding: 5px 9px;
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-sm);
  background: var(--panel-bg);
  color: var(--text-secondary);
  font-size: 0.82rem;
}

.memory-review {
  display: grid;
  grid-template-columns: minmax(190px, 0.7fr) 1fr;
  gap: 14px;
  align-items: stretch;
}

.memory-card-face {
  min-height: 150px;
  border: 1px solid var(--surface-border);
  border-left: 4px solid var(--accent);
  border-radius: var(--radius-md);
  background: var(--panel-bg);
  padding: 18px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 8px;
}

.memory-word {
  color: var(--text-primary);
  font-size: 2rem;
  font-weight: 800;
}

.memory-reading,
.memory-type {
  color: var(--text-muted);
}

.memory-answer {
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-md);
  background: var(--field-bg);
  padding: 18px;
  color: var(--text-secondary);
  line-height: 1.6;
}

.memory-sample {
  margin-top: 10px;
  color: var(--text-primary);
  font-weight: 700;
}

.memory-actions {
  grid-column: 1 / -1;
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.memory-btn,
.memory-grade {
  height: 32px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--surface-border);
  background: var(--field-bg);
  color: var(--text-primary);
  padding: 0 12px;
  cursor: pointer;
  font-weight: 700;
}

.memory-btn.active {
  color: var(--primary);
  background: var(--primary-soft);
  border-color: var(--primary);
}

.memory-grade {
  height: 40px;
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

.agent-note {
  margin: 0 0 14px;
  color: var(--text-secondary);
  line-height: 1.6;
}

.agent-panel--hero {
  border-color: rgba(22, 125, 119, 0.32);
  box-shadow: var(--shadow-lift);
}

.agent-quick-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 10px;
}

.agent-chip {
  height: 30px;
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  padding: 0 10px;
  font-weight: 700;
  font-size: 0.84rem;
}

.agent-chip:hover {
  border-color: var(--primary);
  background: var(--primary-soft);
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

.agent-runtime-node span:not(.runtime-dot) {
  display: none;
  margin-top: 1px;
  color: var(--text-muted);
  font-size: 0.7rem;
  line-height: 1.35;
}

.agent-runtime-node--running span:not(.runtime-dot) {
  display: block;
}

.agent-runtime-note {
  margin: 4px 0 10px;
  color: var(--text-muted);
  font-size: 0.82rem;
  line-height: 1.55;
}

.agent-chat {
  margin: 0;
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-md);
  background: var(--field-bg);
  padding: 10px;
}

.agent-chat--conversation {
  margin-top: 12px;
  background: var(--panel-bg);
}

.agent-flow-enter-active,
.agent-flow-leave-active {
  transition: opacity 0.22s ease, transform 0.22s ease;
}

.agent-flow-enter-from,
.agent-flow-leave-to {
  opacity: 0;
  transform: translateY(8px);
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
  margin-top: 6px;
  color: var(--text-muted);
  font-size: 0.84rem;
}

.tool-trace-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-weight: 700;
  cursor: pointer;
  list-style: none;
  padding: 8px 0 0;
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

.agent-chat-input input:focus {
  outline: none;
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

.memory-settings input {
  height: 38px;
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-sm);
  background: var(--field-bg);
  color: var(--text-primary);
  padding: 0 10px;
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
  background: var(--panel-bg);
  padding: var(--space-3);
  border-radius: var(--radius-sm);
  border-left: 4px solid var(--primary);
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
  background-color: var(--surface-soft);
  transition: background-color 0.2s, border-color 0.2s;
}

.doc-header:hover {
  background-color: var(--panel-bg);
}

.doc-title {
  margin: 0;
  font-size: 1.15rem;
  color: var(--text-primary);
  font-weight: 700;
}

.doc-content {
  padding: 20px 24px;
  border-top: 1px solid var(--surface-border);
}

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
  background: var(--panel-bg);
  border-radius: var(--radius-sm);
  border-left: 4px solid var(--primary);
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

/* === 道场模式 Dojo === */
.dojo-wrapper {
  max-width: 760px;
  margin: 0 auto 40px;
}

.dojo-card {
  text-align: center;
  padding: 34px 28px;
}

.icon-brain-large {
  width: 64px;
  height: 64px;
  color: var(--primary);
  margin-bottom: 16px;
}

.dojo-start h2 {
  font-size: 2em;
  margin-bottom: 16px;
  color: var(--text-primary);
}

.dojo-start p {
  color: var(--text-muted);
  line-height: 1.6;
  margin-bottom: 30px;
}

.dojo-start-copy {
  max-width: 700px;
  margin: 0 auto 24px;
}

.dojo-scene-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 20px;
  text-align: left;
}

.scene-card {
  border: 1px solid var(--surface-border);
  background: var(--field-bg);
  border-radius: var(--radius-md);
  padding: 15px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 6px;
  transition: all 0.2s ease;
  color: inherit;
}

.scene-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 14px 26px rgba(24, 35, 31, 0.1);
  border-color: var(--primary);
}

.scene-card.active {
  border-color: var(--primary);
  background: var(--primary-soft);
  box-shadow: var(--focus-ring);
}

.scene-card-title {
  font-size: 1rem;
  font-weight: 700;
  color: var(--text-primary);
}

.scene-card-desc {
  font-size: 0.88rem;
  color: var(--text-secondary);
  line-height: 1.5;
}

.scene-card-meta,
.scene-card-preview {
  font-size: 0.8rem;
  color: var(--text-muted);
}

.dojo-profile-panel {
  margin: 0 auto 24px;
  padding: 18px;
  border-radius: var(--radius-md);
  background: var(--panel-bg);
  border: 1px solid var(--surface-border);
  text-align: left;
}

.dojo-profile-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}

.dojo-profile-header h3 {
  margin: 0;
}

.profile-badge {
  font-size: 0.78rem;
  color: var(--primary);
  background: rgba(35, 103, 244, 0.1);
  padding: 4px 10px;
  border-radius: 999px;
}

.dojo-profile-stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  margin-bottom: 14px;
}

.profile-stat {
  background: var(--field-bg);
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-sm);
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.profile-stat strong {
  font-size: 1.25rem;
  color: var(--text-primary);
}

.profile-stat span {
  font-size: 0.82rem;
  color: var(--text-muted);
}

.profile-recommendation {
  margin: 0 0 14px;
  color: var(--text-secondary);
}

.profile-subsection + .profile-subsection {
  margin-top: 12px;
}

.profile-subtitle {
  display: inline-block;
  margin-bottom: 8px;
  font-size: 0.84rem;
  font-weight: 700;
  color: var(--text-primary);
}

.profile-tag-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.profile-tag {
  background: var(--field-bg);
  border: 1px solid var(--surface-border);
  border-radius: 999px;
  padding: 4px 10px;
  font-size: 0.8rem;
  color: var(--text-secondary);
}

.scene-progress-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.scene-progress-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 12px;
  background: var(--field-bg);
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-sm);
  font-size: 0.88rem;
}

.wrong-book-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.wrong-book-item {
  background: var(--field-bg);
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-sm);
  padding: 12px;
}

.wrong-book-main {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 6px;
}

.wrong-book-main strong {
  color: var(--text-primary);
}

.wrong-book-main span {
  font-size: 0.82rem;
  color: var(--text-secondary);
}

.wrong-book-scene {
  color: var(--primary) !important;
}

.wrong-book-meta {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 0.8rem;
  color: var(--text-muted);
}

.dojo-profile-empty {
  color: var(--text-muted);
  margin-bottom: 24px;
}

.btn-dojo-start {
  padding: 12px 32px;
  font-size: 1.1em;
  border-radius: var(--radius-md);
}

.dojo-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 24px;
  padding-bottom: 16px;
  border-bottom: 2px dashed var(--surface-border);
  color: var(--text-muted);
  font-weight: 600;
}

.dojo-scene-pill {
  padding: 4px 10px;
  background: rgba(35, 103, 244, 0.1);
  color: var(--primary);
  border-radius: 999px;
  font-size: 0.82rem;
}

.dojo-score strong {
  color: var(--primary);
  font-size: 1.2em;
}

.dojo-question {
  margin-bottom: 32px;
}

.dojo-verb {
  margin-bottom: 16px;
}

.dojo-kanji {
  display: block;
  font-size: 3em;
  font-weight: 800;
  color: var(--text-primary);
  line-height: 1.2;
}

.dojo-romaji {
  display: block;
  font-size: 1.2em;
  color: var(--text-muted);
  font-family: monospace;
  margin-bottom: 8px;
}

.dojo-meaning {
  display: block;
  font-size: 1.1em;
  color: var(--text-muted);
}

.dojo-prompt {
  font-size: 1.2em;
  color: var(--text-secondary);
}

.dojo-prompt strong {
  color: var(--primary);
  padding: 2px 8px;
  background: rgba(35, 103, 244, 0.1);
  border-radius: 6px;
  margin: 0 4px;
}

.dojo-input-area {
  display: flex;
  gap: 12px;
  margin-bottom: 24px;
  justify-content: center;
}

.dojo-input-wrapper {
  position: relative;
  display: flex;
  align-items: center;
}

.dojo-input {
  border: 2px solid var(--surface-border);
  border-radius: var(--radius-md);
  padding: 12px 36px 12px 16px; /* Added right padding for the clear button */
  font-size: 1.2em;
  text-align: center;
  transition: all 0.3s;
  background: var(--field-bg);
  color: var(--text-primary);
  width: 100%;
}

.dojo-clear-btn {
  position: absolute;
  right: 10px;
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  padding: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  transition: all 0.2s;
}

.dojo-clear-btn:hover {
  color: var(--text-primary);
  background: var(--primary-soft);
}

.icon-x {
  width: 16px;
  height: 16px;
}

.dojo-input:focus {
  border-color: var(--primary);
  box-shadow: var(--focus-ring);
}

.input-correct {
  border-color: var(--success) !important;
  background: rgba(34, 197, 94, 0.12) !important;
  color: var(--success);
}

.input-error {
  border-color: var(--danger) !important;
  background: rgba(254, 226, 226, 0.16) !important;
  color: var(--danger);
  text-decoration: line-through;
}

.btn-next {
  background: var(--text-primary);
}
.btn-next:hover {
  background: var(--primary-hover);
}

.dojo-feedback {
  padding: 16px;
  border-radius: var(--radius-md);
  font-weight: 600;
  font-size: 1.1em;
  animation: slideUp 0.3s ease;
}

.feedback-correct {
  background: rgba(34, 197, 94, 0.12);
  color: var(--success);
  border: 1px solid #bbf7d0;
}

.feedback-error {
  background: rgba(254, 226, 226, 0.16);
  color: var(--danger);
  border: 1px solid #fecaca;
}

.feedback-msg {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.dojo-end h2 {
  font-size: 2.5em;
  color: var(--text-primary);
  margin-bottom: 20px;
}

.dojo-end-scene {
  margin-top: -8px;
  margin-bottom: 18px;
  color: var(--text-muted);
}

.final-score {
  font-size: 1.5em;
  color: var(--text-muted);
  margin-bottom: 20px;
}

.score-number {
  font-size: 3em;
  font-weight: 800;
  color: var(--primary);
}

.score-eval {
  font-size: 1.2em;
  color: var(--text-secondary);
  margin-bottom: 32px;
}

/* === 选择题样式 === */
.dojo-choice-area {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin: 24px 0;
}

.dojo-choice-btn {
  padding: 16px 20px;
  font-size: 1.2rem;
  background: var(--surface);
  border: 2px solid var(--border);
  border-radius: var(--radius-md);
  color: var(--text-primary);
  cursor: pointer;
  transition: all 0.2s ease;
  font-family: inherit;
  outline: none;
}

.dojo-choice-btn:hover:not(:disabled) {
  border-color: var(--primary);
  background: var(--primary-soft);
  transform: translateY(-2px);
}

.dojo-choice-btn:active:not(:disabled) {
  transform: translateY(0);
}

.dojo-choice-btn:disabled {
  cursor: default;
  opacity: 0.7;
}

.choice-selected {
  border-color: var(--primary);
  background: var(--primary-soft);
}

.choice-correct {
  border-color: var(--success) !important;
  background: rgba(34, 197, 94, 0.1) !important;
  color: var(--success);
  font-weight: 600;
  box-shadow: 0 0 0 1px var(--success);
  opacity: 1 !important;
}

.choice-wrong {
  border-color: var(--error) !important;
  background: rgba(239, 68, 68, 0.08) !important;
  color: var(--error);
  opacity: 1 !important;
}

.dojo-action-row {
  display: flex;
  justify-content: center;
  margin-top: 20px;
  min-height: 44px; /* 预留按钮高度避免跳动 */
}

@media (max-width: 768px) {
  .dojo-choice-area {
    grid-template-columns: 1fr;
  }
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

.app-dark .mode-switch button.active,
.app-dark .pref-toggle-thumb {
  background: #f8fafc;
}

.app-dark .brand-mark {
  color: #102019;
  background: linear-gradient(135deg, #5eead4, #facc15);
  box-shadow: 0 16px 34px rgba(94, 234, 212, 0.18);
}

.app-dark .search-bar--success {
  border-color: rgba(74, 222, 128, 0.58);
}

.app-dark .suggestion-type,
.app-dark .profile-badge,
.app-dark .dojo-scene-pill,
.app-dark .dojo-prompt strong {
  background: var(--primary-soft);
  color: var(--primary-hover);
}

.app-dark .btn-next:hover {
  background: var(--primary-hover);
  color: #102019;
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

  .header-top,
  .header-bottom {
    align-items: flex-start;
    flex-direction: column;
  }

  .preference-bar {
    justify-content: flex-start;
    width: 100%;
  }

  .brand-block {
    align-items: flex-start;
  }

  .brand-mark {
    width: 46px;
    height: 46px;
    font-size: 1.45rem;
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

  .result-grid {
    grid-template-columns: 1fr;
  }

  .memory-review {
    grid-template-columns: 1fr;
  }

  .suggestion-meaning,
  .suggestion-romaji {
    display: none;
  }
}
</style>
