// Agent 相关路由：从 server.js 抽离，逻辑保持不变。
// 所有依赖通过 registerAgentRoutes(app, deps) 的 deps 参数注入。

export function registerAgentRoutes(app: any, deps: Record<string, any>): void {
  const {
    userStore,
    agentLimiter,
    prepareSse,
    writeSse,
    getRuntimeLlmSettings,
    detectLearningIntent,
    getAgentQueue,
    buildAgentRunTitle,
    createLearningAgentGraph,
    emitAgentQueue,
    traceLangSmithRun,
    addLangSmithEvent,
    requestCancelTasksForRun,
    getDefaultLlmModel,
    getLlmProvider,
    getMemorySettings,
    findSimilarWords,
    callLlmText,
    runToolCallingAgent,
    agentHelpers,
    listBackgroundTasks,
    getBackgroundTaskResult,
    requestCancelBackgroundTask,
    extractLookupForAgent,
    buildLearningAgentPayload
  } = deps;

  app.get('/api/subagent-tasks', async (req: any, res: any) => {
    try {
      const limit = Math.max(0, Number.parseInt(String(req.query.limit || '0'), 10) || 0);
      res.json(await listBackgroundTasks({
        userId: req.userId,
        runId: String(req.query.runId || ''),
        status: String(req.query.status || ''),
        limit
      }));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/subagent-tasks/:taskId', async (req: any, res: any) => {
    try {
      const task = await getBackgroundTaskResult(req.params.taskId, req.userId);
      if (!task) {
        return res.status(404).json({ error: 'Task not found.' });
      }
      res.json(task);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/subagent-tasks/:taskId/cancel', (req: any, res: any) => {
    const ok = requestCancelBackgroundTask(req.params.taskId, req.userId);
    if (!ok) {
      return res.status(404).json({ error: 'Task not found.' });
    }
    res.json({ ok: true, taskId: req.params.taskId });
  });

  app.get('/api/agent-runs', async (req: any, res: any) => {
    try {
      const limit = Math.max(1, Number.parseInt(String(req.query.limit || '30'), 10) || 30);
      const threadId = String(req.query.threadId || '');
      res.json(await userStore.listAgentRuns({ userId: req.userId, threadId, limit }));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/agent-runs/:runId', async (req: any, res: any) => {
    try {
      const run = await userStore.getAgentRun(req.params.runId, req.userId);
      if (!run) {
        return res.status(404).json({ error: 'Run not found.' });
      }
      res.json(run);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/agent-thread-summary', async (req: any, res: any) => {
    try {
      const limit = Math.max(1, Number.parseInt(String(req.query.limit || '8'), 10) || 8);
      res.json(await agentHelpers.buildThreadSummary(userStore, {
        userId: req.userId,
        currentRunId: String(req.query.currentRunId || ''),
        threadId: String(req.query.threadId || ''),
        limit
      }));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/agent-runs/:runId/cancel', async (req: any, res: any) => {
    try {
      const existingRun = await userStore.getAgentRun(req.params.runId, req.userId);
      if (!existingRun) return res.status(404).json({ error: 'Run not found.' });
      const updated = await userStore.upsertAgentRun({
        runId: req.params.runId,
        status: 'cancelled',
        error: 'Cancellation requested by user',
        summary: '运行被用户主动停止。'
      }, req.userId);
      const cancelled = requestCancelTasksForRun(req.params.runId, req.userId);
      res.json({ ok: true, runId: req.params.runId, cancelled });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Agent Memory 管理：用户可查看/删除 Agent 记住的长期信息（透明可控）
  app.get('/api/agent-memory', async (req: any, res: any) => {
    try {
      res.json(await userStore.listAgentMemory(req.userId));
    } catch (error) {
      res.status(500).json({ error: 'Failed to load agent memory.' });
    }
  });

  app.delete('/api/agent-memory/:id', async (req: any, res: any) => {
    try {
      const removed = await userStore.deleteAgentMemory(req.params.id, req.userId);
      if (!removed) {
        return res.status(404).json({ error: 'Agent memory not found.' });
      }
      res.json(await userStore.listAgentMemory(req.userId));
    } catch (error) {
      res.status(500).json({ error: 'Failed to delete agent memory.' });
    }
  });

  // 相似词推荐：词典结构 + 读音 + 释义 + 场景的轻量推荐
  app.post('/api/similar-words', (req: any, res: any) => {
    try {
      const lookup = extractLookupForAgent(req.body || {});
      if (!lookup.word) {
        return res.status(400).json({ error: 'Missing word.' });
      }

      const similarWords = lookup.wordType === 'verb'
        ? agentHelpers.buildVerbSimilarWords(lookup, 8)
        : findSimilarWords({
            word: lookup.word,
            kana: lookup.reading,
            wordType: lookup.wordType,
            meaning: lookup.meaning,
            limit: 8
          });

      res.json(similarWords);
    } catch (error) {
      res.status(500).json({ error: 'Failed to recommend similar words.' });
    }
  });

  // 垂类学习 Agent：整合查词、相似词、记忆和练习画像
  app.post('/api/agent/learning-plan', async (req: any, res: any) => {
    try {
      const lookup = extractLookupForAgent(req.body?.lookup || req.body || {});
      const [memoryCards, practiceRecords] = await Promise.all([
        userStore.listMemoryCards(500, req.userId),
        userStore.listPracticeRecords(2000, req.userId)
      ]);
      const profile = agentHelpers.buildPracticeProfile(practiceRecords);
      const similarWords = lookup.word
        ? (lookup.wordType === 'verb'
            ? agentHelpers.buildVerbSimilarWords(lookup, 8)
            : findSimilarWords({
                word: lookup.word,
                kana: lookup.reading,
                wordType: lookup.wordType,
                meaning: lookup.meaning,
                limit: 8
              }))
        : [];

      const payload = buildLearningAgentPayload({ lookup, profile, memoryCards, similarWords });

      if (lookup.word && getLlmProvider() !== 'ollama') {
        try {
          const enhancedNote = await callLlmText({
            messages: [
              {
                role: 'system',
                content: '你是一个日语学习教练。只输出一段简洁中文建议，最多80字，具体、可执行。'
              },
              {
                role: 'user',
                content: JSON.stringify({
                  lookup,
                  similarWords: similarWords.slice(0, 5),
                  memory: payload.memory,
                  weakestForms: profile.weakestForms?.slice(0, 2) || []
                })
              }
            ],
            model: getDefaultLlmModel(),
            temperature: 0.3,
            maxTokens: 180
          });
          if (enhancedNote.trim()) {
            payload.coachNote = enhancedNote.trim();
          }
        } catch (e: any) {
          console.error('LLM agent note failed:', e.message);
        }
      }

      res.json(payload);
    } catch (error) {
      res.status(500).json({ error: 'Failed to build learning agent payload.' });
    }
  });

  // Tool-calling Agent：LLM 决策，后端执行工具，再汇总答案
  app.post('/api/agent/run', agentLimiter, async (req: any, res: any) => {
    try {
      const { message, context = {} } = req.body || {};
      if (!message || !message.trim()) {
        return res.status(400).json({ error: 'Missing agent message.' });
      }
      if (!getRuntimeLlmSettings({ includeSecret: true }).apiKey) {
        return res.status(400).json({
          error: '尚未配置 LLM API Key。请到设置面板填入你自己的 OpenAI 兼容 API Key。',
          code: 'no_llm_key'
        });
      }
      const result = await traceLangSmithRun({
        name: 'agent.run',
        runType: 'chain',
        inputs: {
          message,
          context: {
            channel: context.channel || 'api',
            sessionId: context.sessionId || null,
            hasLookup: !!context.lookup,
            hasMemoryStats: !!context.memoryStats
          }
        },
        metadata: {
          endpoint: '/api/agent/run',
          provider: getLlmProvider(),
          model: getDefaultLlmModel()
        },
        tags: ['agent', 'tool-calling']
      }, () => runToolCallingAgent({ message, context }), {
        processOutputs: (output: any) => ({
          answer: String(output?.answer || '').slice(0, 4000),
          toolCalls: Array.isArray(output?.toolCalls) ? output.toolCalls.map((call: any) => call.name) : []
        })
      });
      res.json(result);
    } catch (error) {
      console.error('Agent run failed:', error);
      res.status(500).json({ error: 'Agent run failed.' });
    }
  });

  // LangGraph streaming multi-agent runtime：Planner -> Researcher(tools) -> Tutor(tokens) -> Memory Manager
  app.post('/api/agent/stream', agentLimiter, async (req: any, res: any) => {
    prepareSse(res);

    let runId = '';
    try {
      const { message, context = {}, runId: clientRunId, threadId: clientThreadId } = req.body || {};
      if (!message || !message.trim()) {
        writeSse(res, 'error', { message: 'Missing agent message.' });
        return res.end();
      }
      // 自带 key 模式：未提供 LLM key 直接给清晰的中文提示，避免让用户跑完 agent 才看到"超时"等误导文案
      if (!getRuntimeLlmSettings({ includeSecret: true }).apiKey) {
        writeSse(res, 'error', {
          message: '尚未配置 LLM API Key。请点击右上角「设置」填入你自己的 OpenAI 兼容 API Key（推荐 DeepSeek，注册赠送免费额度），key 只保存在你的浏览器里，不会上传服务器。',
          code: 'no_llm_key'
        });
        return res.end();
      }
      runId = String(clientRunId || `agent-run-${Date.now()}`);
      const threadId = String(clientThreadId || 'default-thread');
      const closedRef = { closed: false };
      res.on('close', () => {
        closedRef.closed = true;
        requestCancelTasksForRun(runId, req.userId);
      });

      const systemPrompt = `你是 Japanese Word Master 的日语学习 Agent 编排器。
你采用 DeerFlow 风格的多 Agent 工作流：Planner 规划，Researcher 调工具查证，Tutor 输出学习解释，Memory Manager 维护复习上下文。
回答要求：
1. 用中文回答，必要时保留日语原文。
2. 工具结果优先，不确定就说明不确定。
3. 输出要适合日语学习者：对比表、例句、误用提醒、下一步练习。
4. 若 context 里有 agentMemory（用户的长期目标/偏好/事实/任务），请据此个性化：贴合其学习目标与水平、遵守其偏好（如例句风格、解释详略），但不要生硬复述这些记忆。`;

      const compactSummary = await agentHelpers.buildPersistedCompactSummary(userStore, {
        userId: req.userId,
        currentRunId: runId,
        threadId,
        conversation: context.conversation || [],
        model: getDefaultLlmModel()
      });

      // Agent Memory 注入（读路径）：检索 top-k 长期记忆，喂给编排器做个性化
      const agentMemory = (await userStore.retrieveAgentMemory(req.userId, { limit: 8 }))
        .map((m: any) => ({ type: m.type, value: m.value }));

      const userContent = JSON.stringify({
        userMessage: message,
        currentLookup: context.lookup || null,
        memoryStats: context.memoryStats || null,
        userProfile: context.userProfile || null,
        agentMemory: agentMemory.length > 0 ? agentMemory : null,
        exampleDifficulty: context.exampleDifficulty || getMemorySettings().exampleDifficulty || 'auto',
        compactSummary,
        recentConversation: compactSummary.recentConversation
      });

      const intent = detectLearningIntent(message);
      const agentQueue = getAgentQueue(intent);
      await userStore.upsertAgentRun({
        runId,
        title: buildAgentRunTitle(message),
        question: message,
        intentType: intent.type || 'lookup',
        provider: getLlmProvider(),
        model: getDefaultLlmModel(),
        status: 'running',
        metadata: {
          queue: agentQueue,
          runtime: 'langgraph',
          exampleDifficulty: context.exampleDifficulty || getMemorySettings().exampleDifficulty || 'auto',
          threadId,
          compactSummary
        }
      }, req.userId);

      writeSse(res, 'run_start', {
        id: runId,
        provider: getLlmProvider(),
        model: getDefaultLlmModel(),
        queue: agentQueue,
        runtime: 'langgraph',
        threadId,
        compactSummary
      });

      writeSse(res, 'runtime_state', {
        threadId,
        compactSummary,
        threadSummary: compactSummary.threadSummary || null
      });

      if (compactSummary.applied) {
        writeSse(res, 'agent_note', {
          agent: 'runtime',
          title: 'Compact',
          content: [
            `压缩模式：${compactSummary.mode}`,
            compactSummary.compactedTurnCount > 0
              ? `已压缩当前会话较早的 ${compactSummary.compactedTurnCount} 条对话`
              : '',
            compactSummary.persistedRunCount > 0
              ? `并吸收最近 ${compactSummary.persistedRunCount} 轮历史摘要`
              : '',
            compactSummary.focusWords.length > 0
              ? `保留焦点词：${compactSummary.focusWords.slice(0, 5).join('、')}`
              : ''
          ].filter(Boolean).join('；')
        });
      }

      const knowledgeHits: any[] = [];
      const graph = createLearningAgentGraph({ res, closedRef, intent, runId, userId: req.userId, knowledgeHits });
      const finalState = await traceLangSmithRun({
        name: 'agent.stream',
        runType: 'chain',
        inputs: {
          message,
          runId,
          threadId,
          intent,
          context: {
            channel: context.channel || 'web',
            sessionId: context.sessionId || null,
            hasLookup: !!context.lookup,
            hasMemoryStats: !!context.memoryStats,
            conversationTurns: Array.isArray(context.conversation) ? context.conversation.length : 0
          }
        },
        metadata: {
          endpoint: '/api/agent/stream',
          runtime: 'langgraph',
          runId,
          threadId,
          provider: getLlmProvider(),
          model: getDefaultLlmModel(),
          intentType: intent.type || 'lookup'
        },
        tags: ['agent', 'langgraph', 'stream']
      }, () => {
        addLangSmithEvent('agent_queue', {
          agents: agentQueue.map((item: any) => item.id || item.label || item)
        });
        return graph.invoke({
          runId,
          message,
          context: {
            ...context,
            compactSummary,
            conversation: compactSummary.recentConversation
          },
          intent,
          agentQueue,
          subagentContexts: {},
          systemPrompt,
          userContent,
          completed: [],
          plannerNote: {},
          messages: [],
          toolCalls: [],
          memoryCandidates: [],
          finalAnswer: '',
          structuredExamples: [],
          memorySnapshot: null,
          interactivePractice: null,
          followUpQuestions: [],
          usageReport: null
        });
      }, {
        processOutputs: (state: any) => ({
          finalAnswer: String(state?.finalAnswer || '').slice(0, 4000),
          completed: state?.completed || [],
          toolCalls: Array.isArray(state?.toolCalls) ? state.toolCalls.map((call: any) => call.name) : [],
          usage: state?.usageReport || null
        })
      });

      emitAgentQueue(res, agentQueue, '', finalState.completed, '本轮 Agent 工作流完成');
      await userStore.upsertAgentRun({
        runId,
        status: 'completed',
        summary: String(finalState.finalAnswer || '').slice(0, 500),
        metadata: {
          queue: agentQueue,
          runtime: 'langgraph',
          completed: finalState.completed || [],
          usage: finalState.usageReport || null,
          threadId,
          compactSummary,
          compactEntry: agentHelpers.buildRunCompactEntry({
            message,
            intent,
            context,
            finalState
          })
        }
      }, req.userId);

      // Agent Memory 抽取（写路径，fire-and-forget 不阻塞响应）：
      // 从本轮对话抽取值得长期记的用户目标/偏好/事实/任务 → 写入 agent_memory。
      const memUserId = req.userId;
      agentHelpers.extractAgentMemoryCandidates({ message, finalAnswer: finalState.finalAnswer || '' })
        .then((candidates: any[]) => {
          if (candidates.length > 0) return userStore.writeAgentMemory(candidates, memUserId, runId);
          return 0;
        })
        .catch((err: any) => console.error('Agent Memory 抽取失败', err?.message || err));

      const knowledgeSources = knowledgeHits
        .filter((hit: any, index: number, arr: any[]) => arr.findIndex((h: any) => h.id === hit.id) === index)
        .slice(0, 5);
      writeSse(res, 'done', {
        answer: finalState.finalAnswer,
        toolCalls: finalState.toolCalls,
        memoryCandidates: finalState.memoryCandidates || [],
        examples: finalState.structuredExamples || [],
        memory: finalState.memorySnapshot?.memory || null,
        interactivePractice: finalState.interactivePractice || null,
        subagentContexts: finalState.subagentContexts || {},
        knowledgeSources,
        usage: finalState.usageReport || null,
        runtime: 'langgraph'
      });
      res.end();
    } catch (error: any) {
      console.error('Streaming agent failed:', error);
      if (/cancelled/i.test(error?.message || '')) {
        await userStore.upsertAgentRun({
          runId,
          status: 'cancelled',
          error: error.message || 'Streaming agent cancelled.',
          summary: '运行已停止。'
        }, req.userId);
        writeSse(res, 'cancelled', { message: error.message || 'Streaming agent cancelled.' });
      } else {
        await userStore.upsertAgentRun({
          runId,
          status: 'failed',
          error: error.message || 'Streaming agent failed.',
          summary: '运行失败，请检查日志。'
        }, req.userId);
        writeSse(res, 'error', { message: error.message || 'Streaming agent failed.' });
      }
      res.end();
    }
  });

  app.post('/api/agent/follow-ups', agentLimiter, async (req: any, res: any) => {
    try {
      const { message = '', answer = '', context = {}, intent = null } = req.body || {};
      if (!message.trim()) {
        return res.status(400).json({ error: 'Missing source message.' });
      }
      const resolvedIntent = intent || detectLearningIntent(message);
      const suggestions = await agentHelpers.generateFollowUpQuestions({
        message,
        finalAnswer: answer,
        intent: resolvedIntent,
        context,
        memoryCandidates: Array.isArray(context.memoryCandidates) ? context.memoryCandidates : []
      });
      return res.json({ suggestions });
    } catch (error) {
      return res.status(500).json({ error: 'Failed to generate follow-up suggestions.' });
    }
  });
}
