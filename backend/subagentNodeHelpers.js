import { formatSpecialistNote, serializeSpecialistBrief } from './subagentContexts.js';

export function buildSpecialistNodeExecutor({
  specialistId,
  queueNote,
  stateKey,
  title,
  buildBrief,
  writeSse,
  emitAgentQueue,
  res
}) {
  return async (state) => {
    emitAgentQueue(res, state.agentQueue, specialistId, state.completed, queueNote);
    const brief = buildBrief(state);

    writeSse(res, 'agent_note', {
      agent: specialistId,
      title,
      content: formatSpecialistNote(specialistId, brief)
    });

    return {
      messages: [
        ...state.messages,
        {
          role: 'user',
          content: serializeSpecialistBrief(title, brief)
        }
      ],
      subagentContexts: {
        ...state.subagentContexts,
        [stateKey]: brief
      },
      completed: [...state.completed, specialistId]
    };
  };
}
