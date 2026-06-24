import { SubagentExecutor } from './subagentExecutor';

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
}: any): any {
  const executor = new SubagentExecutor({
    subagentId: specialistId,
    label: title,
    runId,
    userId,
    executeTool: async () => ({ ok: true }),
    summarizeToolResult: (result: any) => JSON.stringify(result),
    writeSse,
    emitAgentQueue,
    res,
    closedRef
  });

  return async (state: any) => {
    return executor.runSpecialist({
      state,
      queueNote,
      title,
      stateKey,
      buildBrief
    });
  };
}
