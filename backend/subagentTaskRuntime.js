export const SubagentTaskStatus = {
  PENDING: 'pending',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
  TIMED_OUT: 'timed_out'
};

import {
  getSubagentTask,
  listSubagentTasks as listPersistedSubagentTasks,
  upsertSubagentTask
} from './db.js';

const backgroundTasks = new Map();
const completedTaskHistory = [];
const maxCompletedHistory = 120;

function cloneTask(task) {
  return structuredClone(task);
}

function getTaskTimestamp(task) {
  return task?.completedAt || task?.startedAt || task?.createdAt || '';
}

function sortTasksByNewest(tasks = []) {
  return [...tasks].sort((a, b) => {
    const aTime = Date.parse(getTaskTimestamp(a)) || 0;
    const bTime = Date.parse(getTaskTimestamp(b)) || 0;
    return bTime - aTime;
  });
}

function nowIso() {
  return new Date().toISOString();
}

function persistTask(task) {
  if (!task?.taskId) return null;
  return upsertSubagentTask(task);
}

function isTerminal(status = '') {
  return [
    SubagentTaskStatus.COMPLETED,
    SubagentTaskStatus.FAILED,
    SubagentTaskStatus.CANCELLED,
    SubagentTaskStatus.TIMED_OUT
  ].includes(status);
}

export function createBackgroundTask({ subagentId, title, sandbox = null, runId = '' }) {
  const taskId = `subagent-${subagentId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const task = {
    taskId,
    runId,
    subagentId,
    title,
    status: SubagentTaskStatus.PENDING,
    createdAt: nowIso(),
    startedAt: null,
    completedAt: null,
    error: null,
    result: null,
    sandbox,
    events: [],
    cancelRequested: false
  };
  backgroundTasks.set(taskId, task);
  persistTask(task);
  return task;
}

export function startBackgroundTask(taskId) {
  const task = backgroundTasks.get(taskId);
  if (!task) return null;
  task.status = SubagentTaskStatus.RUNNING;
  task.startedAt = task.startedAt || nowIso();
  task.updatedAt = nowIso();
  persistTask(task);
  return task;
}

export function appendBackgroundTaskEvent(taskId, event) {
  const task = backgroundTasks.get(taskId);
  if (!task) return null;
  task.events.push({
    at: nowIso(),
    ...event
  });
  if (task.events.length > 40) {
    task.events = task.events.slice(-40);
  }
  task.updatedAt = nowIso();
  persistTask(task);
  return task;
}

export function completeBackgroundTask(taskId, { status = SubagentTaskStatus.COMPLETED, result = null, error = null, sandbox = null } = {}) {
  const task = backgroundTasks.get(taskId);
  if (!task) return null;
  task.status = status;
  task.completedAt = nowIso();
  task.result = result;
  task.error = error;
  if (sandbox) task.sandbox = sandbox;
  task.updatedAt = nowIso();
  persistTask(task);
  return task;
}

export function requestCancelBackgroundTask(taskId) {
  const task = backgroundTasks.get(taskId);
  if (!task) return false;
  task.cancelRequested = true;
  appendBackgroundTaskEvent(taskId, {
    type: 'cancel_requested',
    message: 'Cancellation requested by parent runtime'
  });
  task.updatedAt = nowIso();
  persistTask(task);
  return true;
}

export function isBackgroundTaskCancelRequested(taskId) {
  return !!backgroundTasks.get(taskId)?.cancelRequested;
}

export function getBackgroundTaskResult(taskId) {
  const task = backgroundTasks.get(taskId) || completedTaskHistory.find(item => item.taskId === taskId);
  if (task) return cloneTask(task);
  return getSubagentTask(taskId);
}

export function listBackgroundTasks({ runId = '', status = '', limit = 0 } = {}) {
  const hasRunningMemoryTasks = normalized => Array.from(backgroundTasks.values()).some(task => {
    if (normalized.runId && task.runId !== normalized.runId) return false;
    if (normalized.status && task.status !== normalized.status) return false;
    return true;
  });
  const normalizedRunId = String(runId || '').trim();
  const normalizedStatus = String(status || '').trim();
  if (!hasRunningMemoryTasks({ runId: normalizedRunId, status: normalizedStatus })) {
    return listPersistedSubagentTasks({
      runId: normalizedRunId,
      status: normalizedStatus,
      limit
    });
  }
  const filtered = [
    ...Array.from(backgroundTasks.values()),
    ...completedTaskHistory
  ].filter(task => {
    if (normalizedRunId && task.runId !== normalizedRunId) return false;
    if (normalizedStatus && task.status !== normalizedStatus) return false;
    return true;
  });

  const sorted = sortTasksByNewest(filtered).map(task => cloneTask(task));
  if (limit > 0) {
    return sorted.slice(0, limit);
  }
  return sorted;
}

export function requestCancelTasksForRun(runId) {
  const normalizedRunId = String(runId || '').trim();
  if (!normalizedRunId) return 0;
  let count = 0;
  for (const task of backgroundTasks.values()) {
    if (task.runId !== normalizedRunId) continue;
    if (task.cancelRequested) continue;
    task.cancelRequested = true;
    appendBackgroundTaskEvent(task.taskId, {
      type: 'cancel_requested',
      message: 'Cancellation requested by run controller'
    });
    task.updatedAt = nowIso();
    persistTask(task);
    count += 1;
  }
  return count;
}

export function cleanupBackgroundTask(taskId) {
  const task = backgroundTasks.get(taskId);
  if (!task) return false;
  if (!isTerminal(task.status)) return false;
  completedTaskHistory.unshift(cloneTask(task));
  if (completedTaskHistory.length > maxCompletedHistory) {
    completedTaskHistory.splice(maxCompletedHistory);
  }
  persistTask(task);
  backgroundTasks.delete(taskId);
  return true;
}
