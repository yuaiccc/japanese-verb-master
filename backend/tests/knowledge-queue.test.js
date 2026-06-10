import test from 'node:test';
import assert from 'node:assert/strict';
import { createReindexQueue } from '../knowledge/queue.js';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

test('debounces multiple schedule calls into one run', async () => {
  let runs = 0;
  const queue = createReindexQueue({ run: async () => { runs += 1; }, delayMs: 30 });
  queue.schedule();
  queue.schedule();
  queue.schedule();
  await sleep(80);
  assert.equal(runs, 1);
});

test('schedule during run queues one follow-up', async () => {
  let runs = 0;
  const queue = createReindexQueue({
    run: async () => { runs += 1; await sleep(40); },
    delayMs: 10
  });
  queue.schedule();
  await sleep(20); // 进入执行中
  queue.schedule(); // 执行期间再次请求
  await sleep(150);
  assert.equal(runs, 2);
});

test('run errors are swallowed and logged, queue stays usable', async () => {
  let runs = 0;
  const queue = createReindexQueue({
    run: async () => { runs += 1; if (runs === 1) throw new Error('boom'); },
    delayMs: 10
  });
  queue.schedule();
  await sleep(40);
  queue.schedule();
  await sleep(40);
  assert.equal(runs, 2);
});
