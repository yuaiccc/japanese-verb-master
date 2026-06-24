<template>
  <transition name="agent-flow">
    <div
      id="agent-sec-tools"
      class="agent-chat agent-chat--trace"
      v-if="props.toolCalls.length > 0 && !props.isRunning"
    >
      <details v-if="props.toolCalls.length > 0" class="agent-tool-trace">
        <summary class="tool-trace-header">
          <span>工具</span>
          <small>{{ props.toolCalls.length }}</small>
        </summary>
        <transition-group name="agent-tool-list">
          <div
            v-for="(call, index) in props.toolCalls"
            :key="`${call.name}-${index}`"
            class="agent-tool-card"
            :class="`agent-tool-card--${call.status || 'done'}`"
          >
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

  <div
    id="agent-sec-trace"
    class="agent-chat agent-chat--trace"
    v-if="props.trace.length > 0 && !props.isRunning"
  >
    <details class="agent-tool-trace agent-exec-trace">
      <summary class="tool-trace-header">
        <span>执行过程</span>
        <small>{{ props.trace.length }} 步</small>
      </summary>
      <ol class="exec-trace-list">
        <li
          v-for="step in props.trace"
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
</template>

<script setup>
const props = defineProps({
  toolCalls: { type: Array, default: () => [] },
  trace: { type: Array, default: () => [] },
  isRunning: { type: Boolean, default: false }
});

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
</script>

<style scoped>
.agent-chat {
  margin: 0;
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-md);
  background: var(--field-bg);
  padding: 10px;
}

.agent-chat--trace {
  margin-top: 10px;
  padding: 10px 14px;
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-md);
  background: var(--field-bg);
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

.agent-tool-list-enter-active,
.agent-tool-list-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.agent-tool-list-enter-from,
.agent-tool-list-leave-to {
  opacity: 0;
  transform: translateY(8px);
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
</style>
