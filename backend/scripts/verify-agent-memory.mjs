// 端到端验证 Agent Memory 抽取 + 注入。直接打 /api/agent/stream 模拟真实 SSE 流。
import http from 'node:http';
import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, '..', 'dictionary.db');

function streamAgent(message, { runId = `verify-${Date.now()}`, threadId = 'verify-thread' } = {}) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      message,
      context: { conversation: [], lookup: null },
      runId, threadId
    });
    const req = http.request({
      host: 'localhost', port: 3456, path: '/api/agent/stream', method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(payload),
        accept: 'text/event-stream'
      }
    }, (res) => {
      let buf = '';
      const events = [];
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        buf += chunk;
        let idx;
        while ((idx = buf.indexOf('\n\n')) !== -1) {
          const block = buf.slice(0, idx); buf = buf.slice(idx + 2);
          const evMatch = block.match(/^event:\s*(.+)$/m);
          const dataMatch = block.match(/^data:\s*([\s\S]+)$/m);
          if (evMatch && dataMatch) {
            try { events.push({ event: evMatch[1].trim(), data: JSON.parse(dataMatch[1]) }); }
            catch { events.push({ event: evMatch[1].trim(), data: dataMatch[1] }); }
          }
        }
      });
      res.on('end', () => resolve(events));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.write(payload); req.end();
  });
}

function snapshotMemory() {
  const db = new Database(dbPath, { readonly: true });
  const rows = db.prepare('SELECT id, type, mkey, value, salience, source_run_id, updated_at FROM agent_memory ORDER BY id').all();
  db.close();
  return rows;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
  console.log('=== Baseline ===');
  console.log('agent_memory rows:', snapshotMemory().length);

  // Round 1：强偏好/目标信号
  const Q1 = '我下半年准备考 JLPT N2。我母语是中文，例句尽量用商务场景，解释短一点就好。先帮我比较一下 する 和 やる 的区别。';
  console.log('\n=== Round 1: 含目标+偏好+事实信号 ===');
  console.log('Q:', Q1);
  const r1RunId = `verify-r1-${Date.now()}`;
  const events1 = await streamAgent(Q1, { runId: r1RunId });
  const done1 = events1.find(e => e.event === 'done');
  const answer1 = (done1?.data?.answer || '').slice(0, 200);
  console.log('A (前 200 字):', answer1);

  // 抽取是 fire-and-forget，要等
  console.log('\n等待 12s 让 LLM 抽取写库…');
  await sleep(12000);

  const afterR1 = snapshotMemory();
  console.log('\n=== 抽取结果 ===');
  console.log('agent_memory rows:', afterR1.length);
  for (const m of afterR1) {
    console.log(`  [${m.type}] ${m.mkey} = "${m.value}"  (salience=${m.salience})`);
  }

  if (afterR1.length === 0) {
    console.log('\n❌ 抽取未产出。可能：LLM 调用失败 / 返回非 JSON / 抽取认为无可记内容');
    process.exit(1);
  }

  // Round 2：无关问题，验证注入
  const Q2 = 'よろしく 怎么用？';
  console.log('\n=== Round 2: 无关问题，验证 agentMemory 是否被注入到 userContent ===');
  console.log('Q:', Q2);
  // 用 stderr 监听后端日志看不到 userContent；改为前端等响应后看抽取/注入侧效果
  const r2RunId = `verify-r2-${Date.now()}`;
  const events2 = await streamAgent(Q2, { runId: r2RunId, threadId: 'verify-thread-2' });
  const done2 = events2.find(e => e.event === 'done');
  const answer2 = (done2?.data?.answer || '').slice(0, 400);
  console.log('A (前 400 字):', answer2);

  // 间接验证注入：看回答是否体现个性化（提到商务/简短/N2）
  const personalized = /商务|商务场景|N2|N\s*2|备考|简短|简洁|短/.test(answer2);
  console.log('\n=== 注入间接验证 ===');
  console.log('回答中出现 个性化信号 (商务/N2/简短)?:', personalized ? '✅' : '❓ （不一定意味失败：模型也可能没明显复述记忆）');

  // 让 Round 2 也跑完抽取（看是否产生新记忆 / 仅提 salience）
  console.log('\n等待 8s 让 R2 抽取写库…');
  await sleep(8000);
  const afterR2 = snapshotMemory();
  console.log('\n=== R2 后快照 ===');
  console.log('agent_memory rows:', afterR2.length);
  for (const m of afterR2) {
    console.log(`  [${m.type}] ${m.mkey} = "${m.value}"  (salience=${m.salience})`);
  }

  console.log('\n=== 验证完成 ===');
  console.log(`Round 1 抽取: ${afterR1.length} 条`);
  console.log(`Round 2 抽取后总: ${afterR2.length} 条 (差值 = 新增/无重复，同键会更新)`);
  process.exit(0);
}

main().catch((e) => { console.error('验证脚本异常:', e); process.exit(2); });
