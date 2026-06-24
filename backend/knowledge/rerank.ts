// LLM 精排：检索链路的第三段（召回 → RRF 融合 → 精排）。
// 对融合后的 top-N 候选用 LLM 按语义相关性重排序。任何失败（LLM 不可用、超时、
// 返回无法解析）都原样降级为融合顺序，保证精排只会变好不会破坏召回。

function buildMessages(query: string, candidates: any[]): any[] {
  const list = candidates
    .map((c: any, i: number) => `[${i}] 标题：${c.title}\n摘要：${String(c.content || '').replace(/\s+/g, ' ').slice(0, 200)}`)
    .join('\n\n');
  return [
    {
      role: 'system',
      content:
        '你是日语学习知识库的检索精排器。根据用户问题，把候选条目按相关性从高到低排序。' +
        '只输出 JSON，格式为 {"order":[序号,...]}，序号是候选的 [n] 编号，最相关的排在最前。不要输出任何解释。'
    },
    {
      role: 'user',
      content: `用户问题：${query}\n\n候选条目：\n${list}\n\n请输出排序 JSON。`
    }
  ];
}

function parseOrder(text: string, n: number): number[] | null {
  if (!text) return null;
  let raw = String(text).trim();
  const match = raw.match(/\{[\s\S]*\}/);
  if (match) raw = match[0];
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const order = parsed.order || parsed.ranking || parsed.indices;
  if (!Array.isArray(order)) return null;
  const seen = new Set();
  const clean: number[] = [];
  for (const x of order) {
    const idx = Number(x);
    if (Number.isInteger(idx) && idx >= 0 && idx < n && !seen.has(idx)) {
      seen.add(idx);
      clean.push(idx);
    }
  }
  return clean.length ? clean : null;
}

// 返回 { items, applied }：applied=false 表示精排未真正生效（LLM 不可用/解析失败/候选不足），
// 调用方据此如实上报 reranked 状态，避免降级被误标成"已精排"。
export function createReranker({ chatFn, model, candidateLimit = 10, temperature = 0 }: any = {}): any {
  return {
    enabled: !!chatFn,
    async rerank(query: string, candidates: any[], { topK = 5 }: any = {}): Promise<any> {
      if (!chatFn || candidates.length <= 1) {
        return { items: candidates.slice(0, topK), applied: false };
      }
      const pool = candidates.slice(0, candidateLimit);
      const tail = candidates.slice(candidateLimit);

      let text = '';
      try {
        text = await chatFn({
          messages: buildMessages(query, pool),
          model,
          temperature,
          maxTokens: 200,
          responseFormat: { type: 'json_object' }
        });
      } catch {
        return { items: candidates.slice(0, topK), applied: false }; // LLM 不可用 → 降级
      }

      const order = parseOrder(text, pool.length);
      if (!order) return { items: candidates.slice(0, topK), applied: false }; // 解析失败 → 降级

      const reordered = order.map((i: number) => pool[i]);
      const used = new Set(order);
      pool.forEach((c: any, i: number) => { if (!used.has(i)) reordered.push(c); }); // 补回 LLM 漏排的候选
      return { items: [...reordered, ...tail].slice(0, topK), applied: true };
    }
  };
}
