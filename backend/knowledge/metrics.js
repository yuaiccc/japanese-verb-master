// 检索可观测性：累积每次检索的延迟与质量信号，暴露聚合快照（avg/p50/p95、降级率、精排率、各腿命中）。
export function createMetrics({ maxSamples = 1000 } = {}) {
  let samples = [];
  return {
    record(sample) {
      samples.push({ ts: Date.now(), ...sample });
      if (samples.length > maxSamples) samples = samples.slice(-maxSamples); // 环形上限，内存有界
    },
    snapshot() {
      const n = samples.length;
      if (!n) return { queries: 0 };
      const lat = samples.map(s => s.latencyMs).sort((a, b) => a - b);
      const pct = (p) => lat[Math.min(n - 1, Math.floor(p * n))];
      const avg = lat.reduce((a, b) => a + b, 0) / n;
      const rate = (key) => +(samples.filter(s => s[key]).length / n).toFixed(3);
      const avgHits = (key) => +(samples.reduce((a, s) => a + (s[key] || 0), 0) / n).toFixed(1);
      return {
        queries: n,
        latencyMs: { avg: +avg.toFixed(1), p50: pct(0.5), p95: pct(0.95), max: lat[n - 1] },
        degradedRate: rate('degraded'),
        rerankedRate: rate('reranked'),
        avgVectorHits: avgHits('vectorHits'),
        avgBm25Hits: avgHits('bm25Hits')
      };
    },
    reset() { samples = []; }
  };
}
