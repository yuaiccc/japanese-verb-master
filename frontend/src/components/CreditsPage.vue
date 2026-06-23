<template>
  <section class="credits-page">
    <header class="credits-hero">
      <p class="credits-eyebrow">Open Source Credits</p>
      <h2>致谢</h2>
    </header>

    <div class="credits-grid">
      <section class="card credits-card" v-for="group in creditsGroups" :key="group.title">
        <div class="credits-card-header">
          <h3>{{ group.title }}</h3>
          <span class="credits-card-count">{{ group.items.length }}</span>
        </div>
        <ul class="credits-list">
          <li v-for="item in group.items" :key="item.name">
            <a :href="item.url" target="_blank" rel="noreferrer" class="credits-item" :title="item.repo">
              <span class="credits-item-name">{{ item.name }}</span>
              <span class="credits-item-tag">{{ item.tag }}</span>
              <svg class="credits-item-icon" viewBox="0 0 24 24" fill="currentColor" aria-label="GitHub" role="img">
                <path d="M12 2C6.48 2 2 6.6 2 12.26c0 4.53 2.87 8.37 6.84 9.72.5.1.68-.22.68-.49 0-.24-.01-.88-.01-1.72-2.78.62-3.37-1.37-3.37-1.37-.46-1.2-1.12-1.52-1.12-1.52-.91-.64.07-.63.07-.63 1.01.08 1.55 1.07 1.55 1.07.9 1.6 2.36 1.13 2.93.86.09-.67.35-1.13.64-1.39-2.22-.26-4.56-1.15-4.56-5.13 0-1.13.39-2.06 1.03-2.78-.11-.26-.45-1.31.1-2.73 0 0 .84-.28 2.75 1.06A9.2 9.2 0 0 1 12 7.25c.83 0 1.67.12 2.45.36 1.9-1.34 2.74-1.06 2.74-1.06.56 1.42.22 2.47.11 2.73.64.72 1.03 1.65 1.03 2.78 0 3.99-2.34 4.86-4.57 5.12.36.32.69.95.69 1.92 0 1.39-.01 2.5-.01 2.84 0 .27.18.6.69.49A10.28 10.28 0 0 0 22 12.26C22 6.6 17.52 2 12 2Z"/>
              </svg>
            </a>
          </li>
        </ul>
      </section>
    </div>

    <section class="card credits-card credits-card--notes">
      <div class="credits-card-header">
        <h3>上下文压缩参考</h3>
      </div>
      <ul class="credits-notes-list">
        <li><strong>DeerFlow</strong><span>SummarizationMiddleware：token 上限时压缩旧对话</span></li>
        <li><strong>Claude Code</strong><span>auto-compaction + Compact Instructions 控制保留</span></li>
        <li><strong>Hermes Agent</strong><span>多阶段：先告警、再压缩、再放回上下文</span></li>
      </ul>
    </section>
  </section>
</template>

<script setup>
// 开源致谢列表（静态数据；展示只用 name + tag + url，note/repo 字段在 hover/title 中辅助）
const creditsGroups = [
  {
    title: '前端与交互',
    items: [
      { name: 'Vue 3', url: 'https://github.com/vuejs/core', repo: 'vuejs/core', tag: 'UI' },
      { name: 'Vite', url: 'https://github.com/vitejs/vite', repo: 'vitejs/vite', tag: 'Build' },
      { name: 'Axios', url: 'https://github.com/axios/axios', repo: 'axios/axios', tag: 'HTTP' },
      { name: 'Marked', url: 'https://github.com/markedjs/marked', repo: 'markedjs/marked', tag: 'Markdown' },
      { name: 'WanaKana', url: 'https://github.com/WaniKani/WanaKana', repo: 'WaniKani/WanaKana', tag: 'Japanese' }
    ]
  },
  {
    title: 'Agent 与后端运行时',
    items: [
      { name: 'LangGraph', url: 'https://github.com/langchain-ai/langgraphjs', repo: 'langchain-ai/langgraphjs', tag: 'Agent' },
      { name: 'Express', url: 'https://github.com/expressjs/express', repo: 'expressjs/express', tag: 'API' },
      { name: 'better-sqlite3', url: 'https://github.com/WiseLibs/better-sqlite3', repo: 'WiseLibs/better-sqlite3', tag: 'Storage' },
      { name: 'js-tiktoken', url: 'https://github.com/dqbd/tiktoken', repo: 'dqbd/tiktoken', tag: 'Tokens' },
      { name: 'Ollama JS', url: 'https://github.com/ollama/ollama-js', repo: 'ollama/ollama-js', tag: 'LLM' },
      { name: 'CORS', url: 'https://github.com/expressjs/cors', repo: 'expressjs/cors', tag: 'Middleware' }
    ]
  },
  {
    title: '日语处理与学习能力',
    items: [
      { name: 'Kuromoji', url: 'https://github.com/takuyaa/kuromoji.js', repo: 'takuyaa/kuromoji.js', tag: 'NLP' },
      { name: 'ts-fsrs', url: 'https://github.com/open-spaced-repetition/ts-fsrs', repo: 'open-spaced-repetition/ts-fsrs', tag: 'Memory' },
      { name: 'deer-flow', url: 'https://github.com/bytedance/deer-flow', repo: 'bytedance/deer-flow', tag: 'Agent' },
      { name: 'cc-switch', url: 'https://github.com/farion1231/cc-switch', repo: 'farion1231/cc-switch', tag: 'LLM Switch' }
    ]
  }
];
</script>

<style scoped>
.credits-page {
  display: grid;
  gap: 18px;
}

.credits-hero {
  padding: 4px 4px 6px;
}

.credits-eyebrow {
  margin: 0 0 4px;
  color: var(--primary);
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0.32em;
  text-transform: uppercase;
}

.credits-hero h2 {
  margin: 0;
  font-size: 1.7rem;
  line-height: 1.1;
}

.credits-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.credits-card {
  display: grid;
  gap: 12px;
}

.credits-card-header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 10px;
}

.credits-card-header h3 {
  margin: 0;
  font-size: 1rem;
}

.credits-card-count {
  font-size: 0.72rem;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
  background: var(--field-bg);
  border: 1px solid var(--surface-border);
  padding: 2px 8px;
  border-radius: 999px;
}

.credits-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  gap: 6px;
}

.credits-item {
  display: grid;
  grid-template-columns: 1fr auto auto;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  border: 1px solid transparent;
  background: transparent;
  color: var(--text-primary);
  text-decoration: none;
  transition: background 0.15s ease, border-color 0.15s ease, transform 0.15s ease;
}

.credits-item:hover {
  background: var(--field-bg);
  border-color: var(--surface-border);
}

.credits-item-name {
  font-weight: 700;
  font-size: 0.92rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.credits-item-tag {
  font-size: 0.7rem;
  color: var(--text-muted);
  letter-spacing: 0.02em;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--primary-soft);
  color: var(--primary);
  white-space: nowrap;
}

.credits-item-icon {
  width: 16px;
  height: 16px;
  color: var(--text-muted);
  flex-shrink: 0;
}

.credits-item:hover .credits-item-icon {
  color: var(--text-primary);
}

/* 上下文压缩参考：每条一行，去掉冗长说明 */
.credits-card--notes {
  grid-column: 1 / -1;
}

.credits-notes-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  gap: 10px;
}

.credits-notes-list li {
  display: grid;
  grid-template-columns: minmax(110px, max-content) 1fr;
  align-items: baseline;
  gap: 14px;
  padding: 8px 0;
  border-bottom: 1px dashed var(--surface-border);
}

.credits-notes-list li:last-child {
  border-bottom: none;
}

.credits-notes-list strong {
  color: var(--text-primary);
  font-size: 0.92rem;
}

.credits-notes-list span {
  color: var(--text-muted);
  font-size: 0.86rem;
  line-height: 1.6;
}

@media (max-width: 720px) {
  .credits-grid {
    grid-template-columns: 1fr;
  }
}
</style>
