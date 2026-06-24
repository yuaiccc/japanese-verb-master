let kuromojiTokenizer: any = null;

export function setTokenizer(tokenizer: any): void {
  kuromojiTokenizer = tokenizer;
}

const CJK_RE = /[぀-ヿ㐀-鿿]/;

function bigrams(text: string): string[] {
  if (text.length <= 2) return [text];
  const out: string[] = [];
  for (let i = 0; i < text.length - 1; i += 1) out.push(text.slice(i, i + 2));
  return out;
}

export function tokenizeForFts(text: string = ''): string {
  const value = String(text || '').trim();
  if (!value) return '';
  if (kuromojiTokenizer) {
    try {
      return kuromojiTokenizer.tokenize(value)
        .map((t: any) => t.surface_form.trim().toLowerCase())
        .filter(Boolean)
        .join(' ');
    } catch {
      // fall through to bigram
    }
  }
  // 降级：CJK 连续段切 bigram，其余按空白切
  // Process CJK and non-CJK segments separately to avoid cross-boundary
  // bigrams (e.g. "o世" from "hello世界").
  const cjkRegex = /[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff]+/g;
  const tokens: string[] = [];
  let lastIndex = 0;
  let match;
  while ((match = cjkRegex.exec(value)) !== null) {
    if (match.index > lastIndex) {
      const words = value.slice(lastIndex, match.index).toLowerCase().split(/\s+/).filter(Boolean);
      tokens.push(...words);
    }
    tokens.push(...bigrams(match[0]));
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < value.length) {
    const words = value.slice(lastIndex).toLowerCase().split(/\s+/).filter(Boolean);
    tokens.push(...words);
  }
  return tokens.join(' ');
}
