let kuromojiTokenizer = null;

export function setTokenizer(tokenizer) {
  kuromojiTokenizer = tokenizer;
}

const CJK_RE = /[぀-ヿ㐀-鿿]/;

function bigrams(text) {
  if (text.length <= 2) return [text];
  const out = [];
  for (let i = 0; i < text.length - 1; i += 1) out.push(text.slice(i, i + 2));
  return out;
}

export function tokenizeForFts(text = '') {
  const value = String(text || '').trim();
  if (!value) return '';
  if (kuromojiTokenizer) {
    try {
      return kuromojiTokenizer.tokenize(value)
        .map(t => t.surface_form.trim().toLowerCase())
        .filter(Boolean)
        .join(' ');
    } catch {
      // fall through to bigram
    }
  }
  // 降级：CJK 连续段切 bigram，其余按空白切
  return value
    .split(/\s+/)
    .flatMap(seg => (CJK_RE.test(seg) ? bigrams(seg) : [seg.toLowerCase()]))
    .join(' ');
}
