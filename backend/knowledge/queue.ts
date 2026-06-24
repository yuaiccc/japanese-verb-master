export function createReindexQueue({ run, delayMs = 2000 }: any): any {
  let timer: any = null;
  let running = false;
  let pendingAgain = false;

  async function execute(): Promise<void> {
    running = true;
    try {
      await run();
    } catch (error: any) {
      console.warn('[knowledge] reindex failed:', error.message);
    } finally {
      running = false;
      if (pendingAgain) {
        pendingAgain = false;
        schedule();
      }
    }
  }

  function schedule(): void {
    if (running) {
      pendingAgain = true;
      return;
    }
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; execute(); }, delayMs);
  }

  return { schedule, isRunning: () => running };
}
