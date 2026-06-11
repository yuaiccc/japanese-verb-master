export function createReindexQueue({ run, delayMs = 2000 }) {
  let timer = null;
  let running = false;
  let pendingAgain = false;

  async function execute() {
    running = true;
    try {
      await run();
    } catch (error) {
      console.warn('[knowledge] reindex failed:', error.message);
    } finally {
      running = false;
      if (pendingAgain) {
        pendingAgain = false;
        schedule();
      }
    }
  }

  function schedule() {
    if (running) {
      pendingAgain = true;
      return;
    }
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; execute(); }, delayMs);
  }

  return { schedule, isRunning: () => running };
}
