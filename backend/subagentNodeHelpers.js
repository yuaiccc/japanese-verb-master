import { SubagentExecutor } from './subagentExecutor.js';

export function buildSpecialistNodeExecutor({
  specialistId,
  runId = '',
  userId = 1,
  queueNote,
  stateKey,
  title,
  buildBrief,
  emitAgentQueue,
  writeSse,
  res,
  closedRef
}) {
  const executor = new SubagentExecutor({
    subagentId: specialistId,
    label: title,
    runId,
    userId,
    executeTool: async () => ({ ok: true }),
    summarizeToolResult: (result) => JSON.stringify(result),
    writeSse,
    emitAgentQueue,
    res,
    closedRef
  });

  return async (state) => {
    return executor.runSpecialist({
      state,
      queueNote,
      title,
      stateKey,
      buildBrief
    });
  };
}
