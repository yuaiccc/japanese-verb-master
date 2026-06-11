// 查询改写：把口语化提问改写成检索友好的查询 + 关键术语，缩小"用户措辞 vs 语料措辞"的差距。
// 改写结果与原查询拼接后检索（多路），即使改写跑偏原查询仍在，保证召回不退化；任何失败降级为原查询。

function parseRewrite(text) {
  if (!text) return null;
  let raw = String(text).trim();
  const match = raw.match(/\{[\s\S]*\}/);
  if (match) raw = match[0];
  try {
    const parsed = JSON.parse(raw);
    const query = typeof parsed.query === 'string' ? parsed.query.trim() : '';
    const terms = Array.isArray(parsed.terms)
      ? parsed.terms.filter(t => typeof t === 'string' && t.trim()).map(t => t.trim())
      : [];
    if (!query && !terms.length) return null;
    return { query, terms };
  } catch {
    return null;
  }
}

export function createQueryRewriter({ chatFn, model, temperature = 0 } = {}) {
  const passthrough = (original) => ({ query: original, rewritten: original, terms: [], changed: false });
  return {
    enabled: !!chatFn,
    async rewrite(query) {
      const original = String(query || '').trim();
      if (!chatFn || !original) return passthrough(original);

      let text = '';
      try {
        text = await chatFn({
          messages: [
            {
              role: 'system',
              content:
                '你是日语学习知识库的查询改写器。把用户口语化的提问改写成更适合检索的简洁查询，' +
                '并提取关键术语（日语语法术语优先用日文，如「て形」「可能形」「は が」）。' +
                '只输出 JSON：{"query":"改写后的查询","terms":["关键词",...]}，不要任何解释。'
            },
            { role: 'user', content: `用户提问：${original}` }
          ],
          model,
          temperature,
          maxTokens: 150,
          responseFormat: { type: 'json_object' }
        });
      } catch {
        return passthrough(original);
      }

      const parsed = parseRewrite(text);
      if (!parsed) return passthrough(original);

      const rewritten = [parsed.query, ...parsed.terms].filter(Boolean).join(' ').trim() || original;
      const merged = rewritten === original ? original : `${original} ${rewritten}`.trim();
      return { query: merged, rewritten, terms: parsed.terms, changed: rewritten !== original };
    }
  };
}
