import test from 'node:test';
import assert from 'node:assert/strict';
import { tokenizeForFts, setTokenizer } from '../knowledge/tokenize';

test('falls back to bigram for CJK when tokenizer missing', () => {
  setTokenizer(null);
  assert.equal(tokenizeForFts('食べる'), '食べ べる');
});

test('keeps ascii words intact and lowercases', () => {
  setTokenizer(null);
  assert.equal(tokenizeForFts('BM25 排序'), 'bm25 排序');
});

test('uses injected tokenizer when available', () => {
  setTokenizer({ tokenize: () => [{ surface_form: '食べる' }, { surface_form: 'こと' }] });
  assert.equal(tokenizeForFts('食べること'), '食べる こと');
  setTokenizer(null);
});
