<template>
  <p v-if="props.runtimeNote" class="agent-runtime-note">{{ props.runtimeNote }}</p>
  <div v-if="props.subagentTasks.length > 0" class="agent-subagent-strip">
    <button
      v-for="task in props.subagentTasks"
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
  <div v-if="props.usageSummary" class="agent-usage-banner" :class="`agent-usage-banner--${props.usageSummary.level}`">
    <span>{{ props.usageSummary.label }}</span>
    <strong v-if="props.usageSummary.warning">{{ props.usageSummary.warning }}</strong>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';

const props = withDefaults(defineProps<{
  runtimeNote?: string;
  subagentTasks?: any[];
  usageSummary?: any;
}>(), {
  runtimeNote: '',
  subagentTasks: () => [],
  usageSummary: null,
});

const emit = defineEmits(['toggle-subagent']);

const activeSubagentTaskId = ref<string>('');
const activeSubagentTaskDetails = computed(
  () => props.subagentTasks.find((task: any) => task.taskId === activeSubagentTaskId.value) || null
);

const formatSubagentTaskStatus = (status: string = '') => {
  const map: Record<string, string> = {
    pending: '排队中',
    running: '运行中',
    completed: '已完成',
    failed: '失败',
    cancelled: '已取消',
    timed_out: '超时'
  };
  return map[status] || status || '运行中';
};

const toggleSubagentTask = (taskId: string) => {
  activeSubagentTaskId.value = activeSubagentTaskId.value === taskId ? '' : taskId;
  emit('toggle-subagent', taskId);
};
</script>

<style scoped>
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
</style>
