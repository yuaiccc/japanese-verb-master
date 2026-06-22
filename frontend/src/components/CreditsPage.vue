<template>
  <section class="credits-page">
      <div class="card credits-hero">
        <div>
          <p class="credits-eyebrow">Open Source Credits</p>
          <h2>这个项目用到的开源项目</h2>
          <p class="credits-copy">把真正参与运行、记忆调度、Agent 编排、前端渲染和产品思路借鉴的项目都放在这里，方便单独致谢。</p>
        </div>
      </div>

      <div class="credits-grid">
        <section class="card credits-card" v-for="group in creditsGroups" :key="group.title">
          <div class="credits-card-header">
            <h3>{{ group.title }}</h3>
            <span>{{ group.items.length }} 项</span>
          </div>
          <div class="credits-list">
            <a
              v-for="item in group.items"
              :key="item.name"
              class="credits-item"
              :href="item.url"
              target="_blank"
              rel="noreferrer"
            >
              <div class="credits-item-main">
                <strong>{{ item.name }}</strong>
                <p>{{ item.note }}</p>
                <small class="credits-item-url">{{ item.repo }}</small>
              </div>
              <div class="credits-item-side">
                <span class="credits-item-tag">{{ item.tag }}</span>
                <span class="credits-item-jump">GitHub</span>
              </div>
            </a>
          </div>
        </section>
      </div>

      <section class="card credits-card credits-card--notes">
        <div class="credits-card-header">
          <h3>上下文压缩参考</h3>
          <span>后续方向</span>
        </div>
        <div class="credits-notes">
          <div class="credits-note">
            <strong>DeerFlow</strong>
            <p>现在最接近我们后端形态的参考。它用 SummarizationMiddleware 在接近 token 上限时压缩旧对话，并把 token usage 单独记录下来。</p>
          </div>
          <div class="credits-note">
            <strong>Claude Code</strong>
            <p>核心是 auto-compaction：上下文接近容量时自动总结旧对话，并允许通过 Compact Instructions 控制“压缩时保留什么”。这个思路适合我们做“保留词条、误用点、练习结果”的摘要。</p>
          </div>
          <div class="credits-note">
            <strong>Hermes Agent</strong>
            <p>更强调 context compression + caching 组合。对我们来说，比较值得借的是“先告警，再压缩，再把摘要放回上下文”的多阶段策略。</p>
          </div>
        </div>
      </section>
    </section>
</template>

<script setup>
// 开源致谢列表（静态数据）
const creditsGroups = [
  {
    title: '前端与交互',
    items: [
      { name: 'Vue 3', url: 'https://github.com/vuejs/core', repo: 'vuejs/core', tag: 'UI', note: '整个前端应用的响应式框架。' },
      { name: 'Vite', url: 'https://github.com/vitejs/vite', repo: 'vitejs/vite', tag: 'Build', note: '本地开发与构建工具。' },
      { name: 'Axios', url: 'https://github.com/axios/axios', repo: 'axios/axios', tag: 'HTTP', note: '前后端接口调用。' },
      { name: 'Marked', url: 'https://github.com/markedjs/marked', repo: 'markedjs/marked', tag: 'Markdown', note: 'Agent 回答的 Markdown 渲染。' },
      { name: 'WanaKana', url: 'https://github.com/WaniKani/WanaKana', repo: 'WaniKani/WanaKana', tag: 'Japanese', note: '假名、罗马音和输入规范化处理。' }
    ]
  },
  {
    title: 'Agent 与后端运行时',
    items: [
      { name: 'LangGraph', url: 'https://github.com/langchain-ai/langgraphjs', repo: 'langchain-ai/langgraphjs', tag: 'Agent Runtime', note: '多节点 Agent 编排与流式状态图。' },
      { name: 'Express', url: 'https://github.com/expressjs/express', repo: 'expressjs/express', tag: 'API', note: '后端 HTTP / SSE 服务。' },
      { name: 'better-sqlite3', url: 'https://github.com/WiseLibs/better-sqlite3', repo: 'WiseLibs/better-sqlite3', tag: 'Storage', note: '本地词典、记忆卡与配置存储。' },
      { name: 'js-tiktoken', url: 'https://github.com/dqbd/tiktoken', repo: 'dqbd/tiktoken', tag: 'Tokens', note: '上下文 usage 估算与 token 统计。' },
      { name: 'Ollama JS', url: 'https://github.com/ollama/ollama-js', repo: 'ollama/ollama-js', tag: 'LLM', note: '本地模型 provider 接入。' },
      { name: 'CORS', url: 'https://github.com/expressjs/cors', repo: 'expressjs/cors', tag: 'Middleware', note: '开发环境跨域支持。' }
    ]
  },
  {
    title: '日语处理与学习能力',
    items: [
      { name: 'Kuromoji', url: 'https://github.com/takuyaa/kuromoji.js', repo: 'takuyaa/kuromoji.js', tag: 'Japanese NLP', note: '日语分词、动词类型识别和读音处理。' },
      { name: 'ts-fsrs', url: 'https://github.com/open-spaced-repetition/ts-fsrs', repo: 'open-spaced-repetition/ts-fsrs', tag: 'Memory', note: '记忆调度参数设计的主要参考。' },
      { name: 'deer-flow', url: 'https://github.com/bytedance/deer-flow', repo: 'bytedance/deer-flow', tag: 'Agent Architecture', note: 'subagent、suggestions、usage 和上下文管理的重要参考。' },
      { name: 'cc-switch', url: 'https://github.com/farion1231/cc-switch', repo: 'farion1231/cc-switch', tag: 'LLM Switch', note: '多 provider 切换面板的产品思路参考。' }
    ]
  }
];
</script>

<style scoped>
.credits-page {
  display: grid;
  gap: 20px;
}

.credits-hero {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  min-height: 150px;
}

.credits-eyebrow {
  margin: 0 0 6px;
  color: var(--primary);
  font-size: 0.78rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.credits-hero h2 {
  margin: 0;
  font-size: 1.85rem;
  line-height: 1.08;
}

.credits-copy {
  max-width: 720px;
  margin: 10px 0 0;
  color: var(--text-muted);
  font-size: 0.98rem;
  line-height: 1.7;
}

.credits-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 18px;
}

.credits-card {
  display: grid;
  gap: 16px;
}

.credits-card--notes {
  gap: 18px;
}

.credits-card-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}

.credits-card-header h3 {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 800;
}

.credits-card-header span {
  color: var(--text-muted);
  font-size: 0.82rem;
  font-weight: 700;
}

.credits-list {
  display: grid;
  gap: 10px;
}

.credits-item {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
  padding: 14px 16px;
  border: 1px solid var(--surface-border);
  border-radius: 16px;
  background: color-mix(in srgb, var(--surface) 88%, transparent);
  color: inherit;
  text-decoration: none;
  transition: border-color 0.25s var(--ease-out),
    transform 0.28s var(--ease-spring), background 0.25s var(--ease-out),
    box-shadow 0.25s var(--ease-out);
}

.credits-item:hover {
  border-color: color-mix(in srgb, var(--primary) 32%, var(--surface-border));
  background: var(--field-bg);
  transform: translateY(-1px);
  box-shadow: 0 14px 26px rgba(24, 35, 31, 0.06);
}

.credits-item-main {
  min-width: 0;
}

.credits-item-main strong {
  display: block;
  margin: 0 0 4px;
  font-size: 0.98rem;
}

.credits-item-main p {
  margin: 0;
  color: var(--text-muted);
  font-size: 0.9rem;
  line-height: 1.55;
}

.credits-item-tag {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  min-height: 26px;
  padding: 0 10px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--primary) 10%, var(--field-bg));
  color: var(--primary);
  font-size: 0.76rem;
  font-weight: 800;
  white-space: nowrap;
}

.credits-notes {
  display: grid;
  gap: 12px;
}

.credits-note {
  padding: 16px 18px;
  border: 1px solid var(--surface-border);
  border-radius: 16px;
  background: color-mix(in srgb, var(--surface) 84%, transparent);
}

.credits-note strong {
  display: block;
  margin: 0 0 6px;
  font-size: 0.96rem;
}

.credits-note p {
  margin: 0;
  color: var(--text-muted);
  font-size: 0.92rem;
  line-height: 1.65;
}
</style>
