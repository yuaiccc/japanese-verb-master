/**
 * LangGraph 学习 Agent 图定义 —— 从 server.js 抽离。
 *
 * 包含：LearningAgentState 状态定义、createLearningAgentGraph 工厂函数。
 * 图节点：planner → researcher → [specialists] → tutor → memory_manager → END
 *
 * knowledgeRetriever 运行时实例通过 configureAgentGraph 注入。
 */

import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import { writeSse, emitAgentQueue, emitTextAsTokens } from './sse.js';
import {
  streamLlmText,
  getDefaultLlmModel,
  estimateChatTokens,
  buildUsageReport
} from '../llm/provider.js';
import { executeAgentTool, summarizeToolResult } from './tools.js';
import {
  buildFallbackTutorAnswer,
  buildInteractivePractice,
  generateStructuredAgentExamples,
  buildFallbackAgentExamples,
  resolveDifficultyLevel,
  memoryCandidatesFromToolResult,
  dedupeMemoryCandidates
} from './helpers.js';
import {
  selectSpecialistSubagents,
  learningSubagentRegistry,
  pickScopedTools,
  detectLearningIntent
} from '../learningSubagents.js';
import { formatPlannerNote } from '../subagentContexts.js';
import { buildSpecialistNodeExecutor } from '../subagentNodeHelpers.js';
import { SubagentExecutor } from '../subagentExecutor.js';
import { getMemorySettings } from '../db.js';

// 运行时实例（由 server.js 启动时通过 configureAgentGraph 注入）
let _knowledgeRetriever = null;

export function configureAgentGraph({ knowledgeRetriever }) {
  _knowledgeRetriever = knowledgeRetriever;
}

export const LearningAgentState = Annotation.Root({
  runId: Annotation({ reducer: (x, y) => y ?? x, default: () => '' }),
  message: Annotation({ reducer: (x, y) => y ?? x, default: () => '' }),
  context: Annotation({ reducer: (x, y) => y ?? x, default: () => ({}) }),
  intent: Annotation({ reducer: (x, y) => y ?? x, default: () => ({}) }),
  agentQueue: Annotation({ reducer: (x, y) => y ?? x, default: () => [] }),
  subagentContexts: Annotation({ reducer: (x, y) => y ?? x, default: () => ({}) }),
  systemPrompt: Annotation({ reducer: (x, y) => y ?? x, default: () => '' }),
  userContent: Annotation({ reducer: (x, y) => y ?? x, default: () => '' }),
  completed: Annotation({ reducer: (x, y) => y ?? x, default: () => [] }),
  plannerNote: Annotation({ reducer: (x, y) => y ?? x, default: () => ({}) }),
  messages: Annotation({ reducer: (x, y) => y ?? x, default: () => [] }),
  toolCalls: Annotation({ reducer: (x, y) => y ?? x, default: () => [] }),
  memoryCandidates: Annotation({ reducer: (x, y) => y ?? x, default: () => [] }),
  finalAnswer: Annotation({ reducer: (x, y) => y ?? x, default: () => '' }),
  structuredExamples: Annotation({ reducer: (x, y) => y ?? x, default: () => [] }),
  memorySnapshot: Annotation({ reducer: (x, y) => y ?? x, default: () => null }),
  interactivePractice: Annotation({ reducer: (x, y) => y ?? x, default: () => null }),
  followUpQuestions: Annotation({ reducer: (x, y) => y ?? x, default: () => [] }),
  usageReport: Annotation({ reducer: (x, y) => y ?? x, default: () => null })
});

export function createLearningAgentGraph({ res, closedRef, intent, runId, userId, knowledgeHits = [] }) {
  const specialistIds = selectSpecialistSubagents(intent);
  // 工具结果在 toolCalls 里会被摘要截断为字符串，无法回取结构化命中；
  // 这里包一层，把 knowledge_search 的原始命中收集到请求级数组，供 done 事件引用。
  const executeToolWithKnowledge = async (name, args) => {
    const result = await executeAgentTool(name, args);
    if (name === 'knowledge_search' && Array.isArray(result?.hits)) {
      knowledgeHits.push(...result.hits);
    }
    return result;
  };
  const researcherExecutor = new SubagentExecutor({
    subagentId: 'researcher',
    label: 'Researcher',
    runId,
    userId,
    executeTool: executeToolWithKnowledge,
    summarizeToolResult,
    writeSse,
    emitAgentQueue,
    res,
    closedRef
  });
  const memoryExecutor = new SubagentExecutor({
    subagentId: 'memory_manager',
    label: 'Memory Manager',
    runId,
    userId,
    executeTool: executeAgentTool,
    summarizeToolResult,
    writeSse,
    emitAgentQueue,
    res,
    closedRef
  });
  const tutorExecutor = new SubagentExecutor({
    subagentId: 'tutor',
    label: 'Tutor',
    runId,
    userId,
    executeTool: executeAgentTool,
    summarizeToolResult,
    writeSse,
    emitAgentQueue,
    res,
    closedRef
  });

  let graph = new StateGraph(LearningAgentState)
    .addNode('planner', async (state) => {
      emitAgentQueue(res, state.agentQueue, 'planner', state.completed, '正在拆解任务和选择工具路线');
      const nextIntent = detectLearningIntent(state.message);
      const plannerNote = learningSubagentRegistry.planner.buildBrief({ intent: nextIntent });
      // Background investigation：规划前先做一次轻量本地检索，让 Planner 知道本地有哪些资料
      let backgroundKnowledge = '';
      try {
        const { results } = await _knowledgeRetriever.queryRelevantDocuments(state.message || nextIntent?.query || '', { topK: 3 });
        if (results.length > 0) {
          backgroundKnowledge = results
            .map(r => `- [${r.category}/${r.level}] ${r.title}: ${r.content.slice(0, 80)}`)
            .join('\n');
        }
      } catch {
        // 本地检索失败不阻塞规划
      }
      if (closedRef.closed) return {};
      writeSse(res, 'agent_note', {
        agent: 'planner',
        title: 'Planner 计划',
        content: formatPlannerNote(plannerNote) + (backgroundKnowledge
          ? `\n\n本地知识库预查（规划参考）：\n${backgroundKnowledge}`
          : '\n\n本地知识库预查：无相关条目')
      });

      return {
        intent: nextIntent,
        plannerNote,
        subagentContexts: {
          ...state.subagentContexts,
          planner: plannerNote
        },
        completed: [...state.completed, 'planner']
      };
    })
    .addNode('researcher', async (state) => {
      const researcherSpec = learningSubagentRegistry.researcher;
      const memoryCandidates = [];

      return researcherExecutor.runToolSubagent({
        state,
        queueNote: '正在调用工具收集事实',
        title: 'Researcher',
        buildBrief: (currentState, sandboxContext) => researcherSpec.buildBrief({
          message: currentState.message,
          intent: currentState.intent,
          plannerNote: currentState.plannerNote,
          userContent: JSON.stringify({
            ...JSON.parse(currentState.userContent || '{}'),
            sandboxContext
          })
        }),
        planTools: (currentState) => pickScopedTools(
          researcherSpec.allowedTools,
          researcherSpec.planTools({ intent: currentState.intent, message: currentState.message })
        ),
        buildToolMessage: ({ tool, rawResult }) => ({
          role: 'user',
          content: `Researcher 工具 ${tool.name} 参数 ${JSON.stringify(tool.arguments)} 返回：${JSON.stringify(rawResult)}`
        }),
        onToolResult: ({ toolRecord, rawResult }) => {
          memoryCandidates.push(...memoryCandidatesFromToolResult(toolRecord.name, rawResult));
        },
        buildStatePatch: ({ state: currentState, brief, sandbox, toolCalls }) => ({
          messages: [
            {
              role: 'system',
              content: `${currentState.systemPrompt}\n${brief.system}`
            },
            { role: 'user', content: brief.user }
          ],
          toolCalls,
          memoryCandidates: dedupeMemoryCandidates(memoryCandidates),
          subagentContexts: {
            ...currentState.subagentContexts,
            researcher: {
              intent: currentState.intent?.type || 'lookup',
              usedTools: toolCalls.map(tool => tool.name),
              sandbox: sandbox.describe()
            }
          }
        })
      });
    })
    .addNode('tutor', async (state) => {
      return tutorExecutor.runTextSubagent({
        state,
        queueNote: '正在流式生成最终回答',
        title: 'Tutor',
        buildBrief: (currentState) => learningSubagentRegistry.tutor.buildBrief({
          message: currentState.message,
          intent: currentState.intent,
          plannerNote: currentState.plannerNote,
          subagentContexts: currentState.subagentContexts
        }),
        buildMessages: (currentState, brief) => [
          {
            role: 'system',
            content: `${currentState.systemPrompt}\n${brief}\n例句会由独立结构化卡片展示，所以正文里不要再输出一整段例句列表。`
          },
          ...currentState.messages,
          {
            role: 'user',
            content: `请基于以上计划和工具结果，回答用户原问题：${currentState.message}`
          }
        ],
        estimateUsage: (messages, sandbox) => {
          const estimatedPromptTokens = estimateChatTokens(messages, getDefaultLlmModel());
          const usage = buildUsageReport({
            model: getDefaultLlmModel(),
            promptTokens: estimatedPromptTokens,
            completionTokens: 0,
            totalTokens: estimatedPromptTokens,
            estimated: true
          });
          writeSse(res, 'usage', {
            stage: 'preflight',
            ...usage,
            agent: 'tutor',
            sandboxId: sandbox.id
          });
          return usage;
        },
        streamText: async ({ messages, sandbox, onToken, onUsage }) => {
          await streamLlmText({
            messages,
            model: getDefaultLlmModel(),
            temperature: 0.25,
            maxTokens: sandbox.policy.maxCompletionTokens || 1700,
            onToken,
            onUsage: (usage) => {
              const report = buildUsageReport({
                model: getDefaultLlmModel(),
                promptTokens: usage.prompt_tokens || 0,
                completionTokens: usage.completion_tokens || 0,
                totalTokens: usage.total_tokens || ((usage.prompt_tokens || 0) + (usage.completion_tokens || 0)),
                estimated: false
              });
              writeSse(res, 'usage', {
                stage: 'final',
                ...report,
                agent: 'tutor',
                sandboxId: sandbox.id
              });
              onUsage(report);
            }
          });
        },
        buildFallbackAnswer: (currentState) => buildFallbackTutorAnswer(currentState.message, currentState.toolCalls),
        onFallback: (_error, sandbox) => {
          writeSse(res, 'agent_note', {
            agent: 'tutor',
            title: 'Tutor 降级',
            content: `DeepSeek token 流暂时超时，已基于工具结果生成本地摘要。Sandbox timeout ${sandbox.policy.timeoutMs || 0}ms`,
            sandbox: sandbox.describe()
          });
        },
        emitFallbackText: (text) => emitTextAsTokens(res, text)
      });
    })
    .addNode('memory_manager', async (state) => {
      const memoryBrief = learningSubagentRegistry.memory_manager.buildBrief({
        context: state.context
      });
      const memoryResult = await memoryExecutor.runToolSubagent({
        state,
        queueNote: '正在刷新记忆队列',
        title: 'Memory Manager',
        buildBrief: () => memoryBrief,
        planTools: () => [{ name: 'memory_status', arguments: {} }],
        buildToolMessage: ({ tool, rawResult }) => ({
          role: 'user',
          content: `Memory Manager 工具 ${tool.name} 返回：${JSON.stringify(rawResult)}`
        }),
        buildStatePatch: ({ state: currentState, sandbox, toolPayloads, toolCalls }) => ({
          messages: currentState.messages,
          toolCalls: [...currentState.toolCalls, ...toolCalls],
          subagentContexts: {
            ...currentState.subagentContexts,
            memory_manager: {
              ...memoryBrief,
              sandbox: sandbox.describe()
            }
          },
          memorySnapshot: toolPayloads[0]?.rawResult || null
        })
      });

      const memorySnapshot = memoryResult.memorySnapshot;
      let structuredExamples = [];
      const interactivePractice = buildInteractivePractice({
        message: state.message,
        intent: state.intent,
        context: state.context,
        memoryCandidates: state.memoryCandidates
      });
      try {
        structuredExamples = await generateStructuredAgentExamples({
          message: state.message,
          finalAnswer: state.finalAnswer,
          toolCalls: state.toolCalls,
          memoryCandidates: state.memoryCandidates,
          context: state.context
        });
      } catch (error) {
        console.error('Failed to generate structured agent examples:', error);
        structuredExamples = buildFallbackAgentExamples({
          message: state.message,
          memoryCandidates: state.memoryCandidates,
          difficultyLevel: resolveDifficultyLevel({
            requested: state.context?.exampleDifficulty || getMemorySettings().exampleDifficulty,
            lookup: state.context?.lookup || null,
            memoryCandidates: state.memoryCandidates
          })
        });
      }
      writeSse(res, 'agent_note', {
        agent: 'memory_manager',
        title: 'Memory Manager',
        content: `当前记忆卡 ${memorySnapshot.memory.total} 张，待复习 ${memorySnapshot.memory.due} 张，已稳定 ${memorySnapshot.memory.mastered} 张。`
      });

      return {
        ...memoryResult,
        memorySnapshot,
        structuredExamples,
        interactivePractice,
        subagentContexts: {
          ...memoryResult.subagentContexts,
          memory_manager: {
            ...(memoryResult.subagentContexts?.memory_manager || {}),
            ...memoryBrief
          }
        }
      };
    });

  if (specialistIds.includes('example_designer')) {
    graph = graph.addNode('example_designer', buildSpecialistNodeExecutor({
      specialistId: 'example_designer',
      runId,
      userId,
      queueNote: '正在整理场景例句 brief',
      stateKey: 'example_designer',
      title: 'Example Coach',
      buildBrief: (state) => learningSubagentRegistry.example_designer.buildBrief({
        message: state.message,
        intent: state.intent
      }),
      writeSse,
      emitAgentQueue,
      res,
      closedRef
    }));
  }

  if (specialistIds.includes('practice_coach')) {
    graph = graph.addNode('practice_coach', buildSpecialistNodeExecutor({
      specialistId: 'practice_coach',
      runId,
      userId,
      queueNote: '正在按画像整理练习 brief',
      stateKey: 'practice_coach',
      title: 'Practice Coach',
      buildBrief: (state) => learningSubagentRegistry.practice_coach.buildBrief({
        message: state.message,
        context: state.context
      }),
      writeSse,
      emitAgentQueue,
      res,
      closedRef
    }));
  }

  graph = graph
    .addEdge(START, 'planner')
    .addEdge('planner', 'researcher');

  if (specialistIds.length > 0) {
    let previousNode = 'researcher';
    for (const specialistId of specialistIds) {
      graph = graph.addEdge(previousNode, specialistId);
      previousNode = specialistId;
    }
    graph = graph.addEdge(previousNode, 'tutor');
  } else {
    graph = graph.addEdge('researcher', 'tutor');
  }

  graph = graph
    .addEdge('tutor', 'memory_manager')
    .addEdge('memory_manager', END);

  return graph.compile();
}
