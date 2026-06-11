// 受约束的答案生成（RAG 的"生成"段）：只依据检索到的上下文回答，并支持两道防幻觉闸门——
//   1) 距离预过滤：最近邻向量距离 > 阈值 ⇒ 语料无相关内容，直接拒答（省一次 LLM 调用）；
//   2) LLM gatekeeper：指令模型"无依据则只回 ABSTAIN"，拦住预过滤漏掉的边界情况。
// forceCitation 开启时强制每句事实标注来源编号，配合后处理统计引用覆盖率。

export const ABSTAIN_MARK = 'ABSTAIN';
const ABSTAIN_REPLY = '知识库中暂未找到能回答该问题的依据。';

function buildMessages(query, chunks, { forceCitation, abstain }) {
  const ctx = chunks.map((c, i) => `[${i + 1}] ${c.title}\n${String(c.content || '').replace(/\s+/g, ' ')}`).join('\n\n');
  const citeRule = forceCitation
    ? '每一条事实陈述都必须在句末标注来源编号（如「…。[1]」）；没有出处支撑的内容一律不要写。'
    : '可在合适处标注来源编号。';
  const abstainRule = abstain
    ? `如果参考资料无法回答该问题，请只回复一个词：${ABSTAIN_MARK}，不要编造。`
    : '';
  return [
    {
      role: 'system',
      content: `你是日语语法助教。只能依据下面的「参考资料」回答，不得编造资料中没有的内容。${citeRule}${abstainRule}`
    },
    { role: 'user', content: `问题：${query}\n\n参考资料：\n${ctx}\n\n请回答。` }
  ];
}

function isAbstainText(text) {
  const t = String(text || '').trim();
  return t.length < 24 && t.toUpperCase().includes(ABSTAIN_MARK);
}

export function createAnswerer({
  chatFn,
  retriever,
  topK = 5,
  distanceThreshold = 1.0,
  forceCitation = false,
  abstain = false
} = {}) {
  return {
    async answer(query) {
      const { results, topVectorDistance } = await retriever.queryRelevantDocuments(query, { topK });

      // 闸门 1：距离预过滤
      if (abstain && typeof topVectorDistance === 'number' && topVectorDistance > distanceThreshold) {
        return { abstained: true, reason: 'low-confidence', answer: ABSTAIN_REPLY, contextChunks: results, citedIndices: [] };
      }

      let text = '';
      try {
        text = await chatFn({
          messages: buildMessages(query, results, { forceCitation, abstain }),
          temperature: 0,
          maxTokens: 700,
          responseFormat: undefined
        });
      } catch {
        return { abstained: true, reason: 'llm-error', answer: ABSTAIN_REPLY, contextChunks: results, citedIndices: [] };
      }

      // 闸门 2：LLM gatekeeper
      if (abstain && isAbstainText(text)) {
        return { abstained: true, reason: 'gatekeeper', answer: ABSTAIN_REPLY, contextChunks: results, citedIndices: [] };
      }

      const cited = [...String(text).matchAll(/\[(\d+)\]/g)]
        .map(m => Number(m[1]))
        .filter(n => n >= 1 && n <= results.length);
      return { abstained: false, reason: null, answer: text, contextChunks: results, citedIndices: [...new Set(cited)] };
    }
  };
}
