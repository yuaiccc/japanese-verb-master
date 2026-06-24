import { getSandboxProvider } from './sandboxProvider.js';
import { formatSpecialistNote, serializeSpecialistBrief } from './subagentContexts.js';
import {
  SubagentTaskStatus,
  appendBackgroundTaskEvent,
  cleanupBackgroundTask,
  completeBackgroundTask,
  createBackgroundTask,
  requestCancelBackgroundTask,
  startBackgroundTask
} from './subagentTaskRuntime.js';

export class SubagentExecutor {
  constructor({
    subagentId,
    label,
    runId = '',
    userId = 1,
    executeTool,
    summarizeToolResult,
    writeSse,
    emitAgentQueue,
    res,
    closedRef
  }) {
    this.subagentId = subagentId;
    this.label = label;
    this.runId = runId;
    this.userId = userId;
    this.executeTool = executeTool;
    this.summarizeToolResult = summarizeToolResult;
    this.writeSse = writeSse;
    this.emitAgentQueue = emitAgentQueue;
    this.res = res;
    this.closedRef = closedRef;
    this.provider = getSandboxProvider();
  }

  acquireSandbox(state) {
    return this.provider.acquire(this.subagentId, { context: state.context || {} });
  }

  emitSandboxNote(sandbox, title, content) {
    this.writeSse(this.res, 'agent_note', {
      agent: this.subagentId,
      title,
      content,
      sandbox: sandbox.describe()
    });
  }

  async withSandboxTimeout(sandbox, task) {
    const timeoutMs = sandbox.policy.timeoutMs || 15000;
    let timer = null;
    try {
      return await Promise.race([
        task(),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error(`${this.label} sandbox timeout after ${timeoutMs}ms`)), timeoutMs);
        })
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async runManagedTask({ title, sandbox, run, onStatus }) {
    const task = createBackgroundTask({
      subagentId: this.subagentId,
      title,
      sandbox: sandbox.describe(),
      runId: this.runId,
      userId: this.userId
    });
    startBackgroundTask(task.taskId);
    onStatus?.('started', task);
    appendBackgroundTaskEvent(task.taskId, {
      type: 'started',
      message: `${title} started`
    });

    try {
      const result = await run(task);
      completeBackgroundTask(task.taskId, {
        status: SubagentTaskStatus.COMPLETED,
        result,
        sandbox: sandbox.describe()
      });
      appendBackgroundTaskEvent(task.taskId, {
        type: 'completed',
        message: `${title} completed`
      });
      onStatus?.('completed', { ...task, status: SubagentTaskStatus.COMPLETED });
      return result;
    } catch (error) {
      const cancelled = task.cancelRequested;
      const timedOut = /timeout/i.test(error?.message || '');
      const status = cancelled
        ? SubagentTaskStatus.CANCELLED
        : timedOut
          ? SubagentTaskStatus.TIMED_OUT
          : SubagentTaskStatus.FAILED;
      completeBackgroundTask(task.taskId, {
        status,
        error: error?.message || `${title} failed`,
        sandbox: sandbox.describe()
      });
      appendBackgroundTaskEvent(task.taskId, {
        type: status,
        message: error?.message || `${title} failed`
      });
      onStatus?.(status, { ...task, status, error: error?.message || `${title} failed` });
      throw error;
    } finally {
      cleanupBackgroundTask(task.taskId);
    }
  }

  async runSpecialist({
    state,
    queueNote,
    title,
    stateKey,
    buildBrief
  }) {
    this.emitAgentQueue(this.res, state.agentQueue, this.subagentId, state.completed, queueNote);
    const sandbox = this.acquireSandbox(state);
    const brief = buildBrief(state);
    const statusEmitter = (type, task) => {
      this.writeSse(this.res, 'subagent_task', {
        type,
        taskId: task.taskId,
        runId: this.runId,
        agent: this.subagentId,
        title,
        status: task.status,
        sandbox: sandbox.describe(),
        startedAt: task.startedAt || null,
        completedAt: task.completedAt || null,
        error: task.error || null,
        cancelRequested: !!task.cancelRequested
      });
    };

    this.emitSandboxNote(
      sandbox,
      title,
      `${formatSpecialistNote(this.subagentId, brief)}\nSandbox: ${sandbox.describe().provider}`
    );

    return this.runManagedTask({
      title,
      sandbox,
      onStatus: statusEmitter,
      run: async () => ({
        messages: [
          ...state.messages,
          {
            role: 'user',
            content: serializeSpecialistBrief(title, brief)
          }
        ],
        subagentContexts: {
          ...state.subagentContexts,
          [stateKey]: {
            ...brief,
            sandbox: sandbox.describe()
          }
        },
        completed: [...state.completed, this.subagentId]
      })
    });
  }

  async runToolSubagent({
    state,
    queueNote,
    title,
    buildBrief,
    planTools,
    buildToolMessage,
    onToolResult,
    buildStatePatch
  }) {
    this.emitAgentQueue(this.res, state.agentQueue, this.subagentId, state.completed, queueNote);
    const sandbox = this.acquireSandbox(state);
    const brief = buildBrief(state, sandbox.sanitizeContext());
    const plannedTools = sandbox.filterPlannedTools(planTools(state, sandbox.sanitizeContext()));
    const toolCalls = [];
    const toolPayloads = [];
    const statusEmitter = (type, task) => {
      this.writeSse(this.res, 'subagent_task', {
        type,
        taskId: task.taskId,
        runId: this.runId,
        agent: this.subagentId,
        title,
        status: task.status,
        sandbox: sandbox.describe(),
        startedAt: task.startedAt || null,
        completedAt: task.completedAt || null,
        error: task.error || null,
        cancelRequested: !!task.cancelRequested
      });
    };

    this.emitSandboxNote(
      sandbox,
      title,
      `${title} 已进入独立沙盒，允许工具：${plannedTools.map(tool => tool.name).join('、') || '无'}`
    );

    const basePatch = await this.runManagedTask({
      title,
      sandbox,
      onStatus: statusEmitter,
      run: async (task) => {
        await this.withSandboxTimeout(sandbox, async () => {
          for (const tool of plannedTools) {
            if (this.closedRef.closed || task.cancelRequested) break;
            this.writeSse(this.res, 'tool_start', {
              ...tool,
              agent: this.subagentId,
              sandboxId: sandbox.id
            });

            let result;
            try {
              result = await this.executeTool(tool.name, tool.arguments);
            } catch (error) {
              result = { error: error.message || `Tool ${tool.name} failed` };
            }

            const summarized = sandbox.clampResult(this.summarizeToolResult(result));
            const toolRecord = {
              ...tool,
              result: summarized,
              error: !!result?.error,
              agent: this.subagentId,
              sandboxId: sandbox.id
            };
            sandbox.recordToolCall(toolRecord);
            toolCalls.push(toolRecord);

            appendBackgroundTaskEvent(task.taskId, {
              type: 'tool',
              message: `${tool.name} finished`,
              tool: tool.name
            });

            if (!this.closedRef.closed) {
              this.writeSse(this.res, 'tool_end', toolRecord);
            }

            const payload = {
              tool,
              toolRecord,
              rawResult: result,
              sandbox: sandbox.describe()
            };
            toolPayloads.push(payload);
            onToolResult?.(payload);
          }

          if (this.closedRef.closed || task.cancelRequested) {
            requestCancelBackgroundTask(task.taskId);
            throw new Error(`${title} cancelled`);
          }
        });

        return buildStatePatch({
          state,
          brief,
          sandbox,
          toolCalls,
          toolPayloads
        });
      }
    });

    return {
      ...basePatch,
      messages: [
        ...(basePatch.messages || []),
        ...toolPayloads.map(payload => buildToolMessage(payload)).filter(Boolean)
      ],
      subagentContexts: {
        ...state.subagentContexts,
        ...(basePatch.subagentContexts || {}),
        [this.subagentId]: {
          ...(basePatch.subagentContexts?.[this.subagentId] || {}),
          sandbox: sandbox.describe(),
          plannedTools: plannedTools.map(tool => tool.name)
        }
      },
      completed: [...state.completed, this.subagentId]
    };
  }

  async runTextSubagent({
    state,
    queueNote,
    title,
    buildBrief,
    buildMessages,
    estimateUsage,
    streamText,
    buildFallbackAnswer,
    onFallback,
    emitFallbackText
  }) {
    this.emitAgentQueue(this.res, state.agentQueue, this.subagentId, state.completed, queueNote);
    const sandbox = this.acquireSandbox(state);
    const brief = buildBrief(state, sandbox.sanitizeContext());
    const messages = buildMessages(state, brief, sandbox.sanitizeContext());
    const preflightUsage = estimateUsage(messages, sandbox);
    const statusEmitter = (type, task) => {
      this.writeSse(this.res, 'subagent_task', {
        type,
        taskId: task.taskId,
        runId: this.runId,
        agent: this.subagentId,
        title,
        status: task.status,
        sandbox: sandbox.describe(),
        startedAt: task.startedAt || null,
        completedAt: task.completedAt || null,
        error: task.error || null,
        cancelRequested: !!task.cancelRequested
      });
    };

    this.emitSandboxNote(
      sandbox,
      title,
      `${title} 已进入独立沙盒，生成预算 ${sandbox.policy.maxCompletionTokens || 'default'} tokens，超时 ${sandbox.policy.timeoutMs || 0}ms`
    );

    let finalAnswer = '';
    let usageReport = preflightUsage;

    try {
      await this.runManagedTask({
        title,
        sandbox,
        onStatus: statusEmitter,
        run: async (task) => {
          await this.withSandboxTimeout(sandbox, async () => {
            if (task.cancelRequested) {
              requestCancelBackgroundTask(task.taskId);
              throw new Error(`${title} cancelled`);
            }
            await streamText({
              messages,
              sandbox,
              shouldCancel: () => this.closedRef.closed || task.cancelRequested,
              onToken: (content) => {
                if (this.closedRef.closed || task.cancelRequested) return;
                finalAnswer += content;
                this.writeSse(this.res, 'token', { content, agent: this.subagentId, sandboxId: sandbox.id });
              },
              onUsage: (usage) => {
                usageReport = usage;
              }
            });
          });
          return { finalAnswer, usageReport };
        }
      });
    } catch (error) {
      finalAnswer = buildFallbackAnswer(state, error);
      onFallback?.(error, sandbox);
      emitFallbackText?.(finalAnswer, sandbox);
    }

    return {
      finalAnswer,
      usageReport,
      subagentContexts: {
        ...state.subagentContexts,
        [this.subagentId]: {
          sandbox: sandbox.describe(),
          mode: 'text_generation'
        }
      },
      completed: [...state.completed, this.subagentId]
    };
  }
}
