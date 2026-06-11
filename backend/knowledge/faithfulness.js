// 忠实度审计（LLM-judge，借鉴 RAGAS faithfulness 思路）：把答案拆成原子事实陈述，
// 逐条判断能否被检索上下文支撑（supported）、是否带了正确来源引用（cited）。
// 据此聚合两个端到端指标：引用覆盖率(citationCoverage) 与 幻觉率(hallucinationRate)。

export function parseClaims(text) {
  if (!text) return null;
  let raw = String(text).trim();
  const match = raw.match(/\{[\s\S]*\}/);
  if (match) raw = match[0];
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const claims = Array.isArray(parsed.claims) ? parsed.claims : null;
  if (!claims) return null;
  return claims.map(c => ({
    text: String(c.text || ''),
    supported: !!c.supported,
    cited: !!c.cited
  }));
}

export function createFaithfulnessJudge({ chatFn } = {}) {
  return {
    // 返回单题指标；abstained 的答案没有陈述，记为零陈述（既不贡献覆盖率也不贡献幻觉）。
    async judge({ query, answer, contextChunks = [], abstained = false }) {
      if (abstained) {
        return { total: 0, supported: 0, cited: 0, claims: [], abstained: true };
      }
      const ctx = contextChunks
        .map((c, i) => `[${i + 1}] ${c.title}: ${String(c.content || '').replace(/\s+/g, ' ')}`)
        .join('\n\n');
      let text = '';
      try {
        text = await chatFn({
          messages: [
            {
              role: 'system',
              content:
                '你是 RAG 答案审计员。把「答案」拆成若干原子事实陈述，逐条判断：' +
                'supported=该陈述能否被「参考资料」支撑；cited=该陈述是否在原文中标注了正确的来源编号。' +
                '只输出 JSON：{"claims":[{"text":"...","supported":true,"cited":false}]}，不要解释。'
            },
            { role: 'user', content: `问题：${query}\n\n答案：${answer}\n\n参考资料：\n${ctx}` }
          ],
          temperature: 0,
          maxTokens: 900,
          responseFormat: { type: 'json_object' }
        });
      } catch {
        return { total: 0, supported: 0, cited: 0, claims: [], judgeError: true };
      }
      const claims = parseClaims(text);
      if (!claims) return { total: 0, supported: 0, cited: 0, claims: [], parseError: true };
      return {
        total: claims.length,
        supported: claims.filter(c => c.supported).length,
        cited: claims.filter(c => c.cited).length,
        claims
      };
    }
  };
}

// 把多题的单题结果聚合成报告。
export function summarizeFaithfulness(rows) {
  const answered = rows.filter(r => !r.abstained);
  const abstained = rows.filter(r => r.abstained).length;
  const totalClaims = answered.reduce((s, r) => s + r.total, 0);
  const supported = answered.reduce((s, r) => s + r.supported, 0);
  const cited = answered.reduce((s, r) => s + r.cited, 0);
  const denom = Math.max(totalClaims, 1);
  return {
    answered: answered.length,
    abstained,
    claims: totalClaims,
    citationCoverage: +(cited / denom).toFixed(3),
    faithfulness: +(supported / denom).toFixed(3),
    hallucinationRate: +((totalClaims - supported) / denom).toFixed(3)
  };
}
