/**
 * SSE 辅助函数 —— 从 server.js 抽离的纯函数，无外部依赖。
 */

export function writeSse(res: any, event: string, payload: any = {}): void {
  if (res.destroyed || res.writableEnded) return;
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

export function prepareSse(res: any): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.flushHeaders?.();
}

export function parseToolCallArgs(rawArgs: string = '{}'): any {
  try {
    return JSON.parse(rawArgs || '{}');
  } catch (e) {
    return {};
  }
}

export function emitAgentQueue(res: any, queue: any[], activeId: string, completedIds: string[] = [], note: string = ''): void {
  writeSse(res, 'queue', {
    activeId,
    note,
    agents: queue.map((agent: any) => ({
      ...agent,
      status: completedIds.includes(agent.id)
        ? 'done'
        : agent.id === activeId
          ? 'running'
          : 'queued'
    }))
  });
}

export function emitTextAsTokens(res: any, text: string, size: number = 12): void {
  for (let i = 0; i < text.length; i += size) {
    writeSse(res, 'token', { content: text.slice(i, i + size) });
  }
}
