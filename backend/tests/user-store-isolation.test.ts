import test from 'node:test';
import assert from 'node:assert/strict';
import db from '../db';
import { createUserStore } from '../userStore';

test('访客数据隔离、注册升级与 Agent run 隔离', async (t) => {
  if (process.env.DATABASE_URL) {
    t.skip('local isolation test only');
    return;
  }

  const store = await createUserStore();
  const guestA = await store.createGuestUser();
  const guestB = await store.createGuestUser();
  const runId = `isolation-run-${Date.now()}`;

  try {
    await store.upsertMemoryCard({ word: '__guest_a_word__' }, guestA.id);
    assert.deepEqual((await store.listMemoryCards(20, guestA.id)).map((card: any) => card.word), ['__guest_a_word__']);
    assert.equal((await store.listMemoryCards(20, guestB.id)).length, 0);

    const claimed = await store.claimGuestUser(guestA.id, `claimed_${Date.now()}`, 'hash');
    assert.equal(claimed.id, guestA.id);
    assert.deepEqual((await store.listMemoryCards(20, claimed.id)).map((card: any) => card.word), ['__guest_a_word__']);

    await store.upsertAgentRun({ runId, question: 'A', status: 'running' }, claimed.id);
    assert.equal((await store.listAgentRuns({ userId: claimed.id })).length, 1);
    assert.equal((await store.listAgentRuns({ userId: guestB.id })).length, 0);
    assert.equal(await store.getAgentRun(runId, guestB.id), null);
  } finally {
    db.prepare('DELETE FROM subagent_tasks WHERE user_id IN (?, ?)').run(guestA.id, guestB.id);
    db.prepare('DELETE FROM agent_runs WHERE user_id IN (?, ?)').run(guestA.id, guestB.id);
    db.prepare('DELETE FROM review_logs WHERE user_id IN (?, ?)').run(guestA.id, guestB.id);
    db.prepare('DELETE FROM memory_cards WHERE user_id IN (?, ?)').run(guestA.id, guestB.id);
    db.prepare('DELETE FROM practice_records WHERE user_id IN (?, ?)').run(guestA.id, guestB.id);
    db.prepare('DELETE FROM users WHERE id IN (?, ?)').run(guestA.id, guestB.id);
  }
});
