import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreCase, summarize } from '../knowledge/eval';

test('scoreCase computes rank and reciprocal rank', () => {
  const hits = [{ docId: 'a', title: 'x' }, { docId: 'b', title: 'y' }];
  assert.deepEqual(scoreCase(hits, 'b::y'), { rank: 2, rr: 0.5 });
  assert.deepEqual(scoreCase(hits, 'c::z'), { rank: null, rr: 0 });
});

test('summarize aggregates recall@k and mrr', () => {
  const rows = [{ rank: 1, rr: 1 }, { rank: 4, rr: 0.25 }, { rank: null, rr: 0 }];
  const summary = summarize(rows);
  assert.equal(summary['recall@1'], '1/3');
  assert.equal(summary['recall@3'], '1/3');
  assert.equal(summary['recall@5'], '2/3');
  assert.equal(summary.mrr, '0.417');
});
