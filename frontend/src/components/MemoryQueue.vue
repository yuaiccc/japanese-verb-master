<template>
    <section class="memory-panel card">
      <div class="memory-header">
        <div>
          <h2 class="title-with-icon">
            <Icon name="brain" />
            记忆复习
          </h2>
        </div>
        <div class="memory-traffic" role="img" :aria-label="`待复习 ${memoryStats.due}，学习中 ${memoryStats.learning}，已稳定 ${memoryStats.mastered}`">
          <span class="traffic-dot traffic-dot--red" :class="{ 'is-active': memoryStats.due > 0 }" title="待复习">{{ memoryStats.due }}</span>
          <span class="traffic-dot traffic-dot--amber" :class="{ 'is-active': memoryStats.learning > 0 }" title="学习中">{{ memoryStats.learning }}</span>
          <span class="traffic-dot traffic-dot--green" :class="{ 'is-active': memoryStats.mastered > 0 }" title="已稳定">{{ memoryStats.mastered }}</span>
        </div>
      </div>

      <div class="memory-settings memory-settings--panel">
        <div class="memory-settings__header">
          <h3 class="title-with-icon">
            <Icon name="settings" />
            参数
          </h3>
          <button class="agent-chip agent-chip--with-icon" @click="showMemorySettings = !showMemorySettings">
            <Icon name="chevron" />
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
          <button class="search-btn settings-save" @click="saveMemorySettingsToServer">
            <Icon name="save" />
            保存参数
          </button>
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
          <button v-if="!memoryRevealed" class="btn-secondary" @click="memoryRevealed = true">
            <Icon name="chevron" />
            显示
          </button>
          <template v-else>
            <button class="memory-grade grade-forgot" @click="reviewMemory(activeMemoryCard.id, 'forgot')">
              <Icon name="x" />
              忘记
            </button>
            <button class="memory-grade grade-hard" @click="reviewMemory(activeMemoryCard.id, 'hard')">
              <Icon name="hourglass" />
              模糊
            </button>
            <button class="memory-grade grade-good" @click="reviewMemory(activeMemoryCard.id, 'good')">
              <Icon name="check" />
              记住
            </button>
          </template>
          <button class="btn-secondary" @click="searchMemoryCard(activeMemoryCard)">
            <Icon name="search" />
            查词
          </button>
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
            <button class="memory-library-action" @click="searchMemoryCard(card)">
              <Icon name="search" />
              查词
            </button>
            </div>
          </div>
        </div>
        <div v-else class="memory-library-empty">没有匹配到已保存词条。</div>
      </div>

      <!-- Agent 长期记忆：区别于上面的 SRS 复习卡，记的是"你是谁/要什么/在做什么" -->
      <div class="agent-memory-block">
        <div class="agent-memory-head">
          <h3>Agent 长期记忆</h3>
        </div>
        <div v-if="agentMemoryList.length > 0" class="agent-memory-list">
          <div v-for="item in agentMemoryList" :key="item.id" class="agent-memory-item">
            <span class="agent-memory-tag" :data-type="item.type">{{ agentMemoryTypeLabel(item.type) }}</span>
            <span class="agent-memory-value">{{ item.value }}</span>
            <button class="agent-memory-del" title="忘记这条" aria-label="忘记这条长期记忆" @click="deleteAgentMemoryItem(item.id)">
              <Icon name="x" />
            </button>
          </div>
        </div>
        <p v-else class="agent-memory-empty">暂无长期记忆</p>
      </div>
    </section>
</template>

<script setup>
import Icon from './Icon.vue';
import { useMemoryCards } from '../composables/useMemoryCards.js';
const {
  memoryCards, reviewQueue, reviewQuota, memoryRevealed,
  memoryLibraryQuery, memoryLibraryFilter, agentMemoryList,
  memorySettings, showMemorySettings, memoryLibraryFilters,
  dueMemoryCards, activeMemoryCard, reviewLimitReached,
  memoryStats, nextMemoryText, filteredMemoryCards,
  currentMemoryId, isCurrentMemorized,
  saveMemorySettingsToServer, reviewMemory, searchMemoryCard,
  formatMemoryDueLabel, loadAgentMemory, deleteAgentMemoryItem,
  agentMemoryTypeLabel,
} = useMemoryCards();
</script>

<style scoped>
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
</style>
