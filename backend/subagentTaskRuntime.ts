export const SubagentTaskStatus: Record<string, string> = {
  PENDING: 'pending',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
  TIMED_OUT: 'timed_out'
};

const backgroundTasks = new Map<string, any>();
const completedTaskHistory: any[] = [];
const maxCompletedHistory = 120;
let taskStore: any = null;

export function configureSubagentTaskStore(store: any): void {
  taskStore = store;
}

function cloneTask(task: any): any {
  return structuredClone(task);
}

function getTaskTimestamp(task: any): string {
  return task?.completedAt || task?.startedAt || task?.createdAt || '';
}

function sortTasksByNewest(tasks: any[] = []): any[] {
  return [...tasks].sort((a: any, b: any) => {
    const aTime = Date.parse(getTaskTimestamp(a)) || 0;
    const bTime = Date.parse(getTaskTimestamp(b)) || 0;
    return bTime - aTime;
  });
}

function nowIso(): string {
  return new Date().toISOString();
}

let persistChain: Promise<void> = Promise.resolve();
function persistTask(task: any): Promise<void> {
  if (!task?.taskId || !taskStore) return Promise.resolve();
  persistChain = persistChain
    .then(() => taskStore.upsertSubagentTask(task, task.userId))
    .catch((error: any) => {
      console.error('[subagent-task] persist failed:', error?.message || error);
    });
  return persistChain;
}

function isTerminal(status: string = ''): boolean {
  return [
    SubagentTaskStatus.COMPLETED,
    SubagentTaskStatus.FAILED,
    SubagentTaskStatus.CANCELLED,
    SubagentTaskStatus.TIMED_OUT
  ].includes(status);
}

export function createBackgroundTask({ subagentId, title, sandbox = null, runId = '', userId = 1 }: any): any {
  const taskId = `subagent-${subagentId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const task = {
    taskId,
    userId,
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

export function startBackgroundTask(taskId: string): any {
  const task = backgroundTasks.get(taskId);
  if (!task) return null;
  task.status = SubagentTaskStatus.RUNNING;
  task.startedAt = task.startedAt || nowIso();
  task.updatedAt = nowIso();
  persistTask(task);
  return task;
}

export function appendBackgroundTaskEvent(taskId: string, event: any): any {
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

export function completeBackgroundTask(taskId: string, { status = SubagentTaskStatus.COMPLETED, result = null, error = null, sandbox = null }: any = {}): any {
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

export function requestCancelBackgroundTask(taskId: string, userId: any = null): boolean {
  const task = backgroundTasks.get(taskId);
  if (!task) return false;
  if (userId !== null && Number(task.userId) !== Number(userId)) return false;
  task.cancelRequested = true;
  appendBackgroundTaskEvent(taskId, {
    type: 'cancel_requested',
    message: 'Cancellation requested by parent runtime'
  });
  return true;
}

export function isBackgroundTaskCancelRequested(taskId: string): boolean {
  return !!backgroundTasks.get(taskId)?.cancelRequested;
}

export async function getBackgroundTaskResult(taskId: string, userId: any): Promise<any> {
  const task = backgroundTasks.get(taskId) || completedTaskHistory.find(item => item.taskId === taskId);
  if (task && Number(task.userId) === Number(userId)) return cloneTask(task);
  return taskStore?.getSubagentTask(taskId, userId) || null;
}

export async function listBackgroundTasks({ userId, runId = '', status = '', limit = 0 }: any = {}): Promise<any[]> {
  const normalizedRunId = String(runId || '').trim();
  const normalizedStatus = String(status || '').trim();

  const matches = (task: any) => {
    if (Number(task.userId) !== Number(userId)) return false;
    if (normalizedRunId && task.runId !== normalizedRunId) return false;
    if (normalizedStatus && task.status !== normalizedStatus) return false;
    return true;
  };

  // 始终从 taskStore 查询
  const storedTasks = (await taskStore?.listSubagentTasks({
    userId,
    runId: normalizedRunId,
    status: normalizedStatus,
    limit
  }) || []).filter(matches);

  // 始终合并内存中的任务（backgroundTasks + completedTaskHistory）
  const memoryTasks = [
    ...Array.from(backgroundTasks.values()),
    ...completedTaskHistory
  ].filter(matches);

  // 按 taskId 去重，内存中的优先（状态更新）
  const byTaskId = new Map();
  for (const task of storedTasks) {
    byTaskId.set(task.taskId, task);
  }
  for (const task of memoryTasks) {
    byTaskId.set(task.taskId, task);
  }

  const sorted = sortTasksByNewest(Array.from(byTaskId.values())).map((task: any) => cloneTask(task));
  if (limit > 0) {
    return sorted.slice(0, limit);
  }
  return sorted;
}

export function requestCancelTasksForRun(runId: string, userId: any = null): number {
  const normalizedRunId = String(runId || '').trim();
  if (!normalizedRunId) return 0;
  let count = 0;
  for (const task of backgroundTasks.values()) {
    if (task.runId !== normalizedRunId) continue;
    if (userId !== null && Number(task.userId) !== Number(userId)) continue;
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

export function cleanupBackgroundTask(taskId: string): boolean {
  const task = backgroundTasks.get(taskId);
  if (!task) return false;
  if (!isTerminal(task.status)) {
    console.warn(`[cleanupBackgroundTask] cleaning non-terminal task ${task.taskId} in state ${task.status}`);
  }
  completedTaskHistory.unshift(cloneTask(task));
  if (completedTaskHistory.length > maxCompletedHistory) {
    completedTaskHistory.splice(maxCompletedHistory);
  }
  persistTask(task);
  backgroundTasks.delete(taskId);
  return true;
}
