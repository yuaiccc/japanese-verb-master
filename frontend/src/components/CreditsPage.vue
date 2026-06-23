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
            <a :href="item.url" target="_blank" rel="noreferrer" class="credits-item" :title="repoTitle(item)">
              <span class="credits-item-name">{{ item.name }}</span>
              <span class="credits-item-tag">{{ item.tag }}</span>
              <img
                v-if="item.icon"
                class="credits-item-brand"
                :class="{ 'credits-item-brand--invert': item.invertDark }"
                :src="brandIconUrl(item.icon)"
                :alt="`${item.name} icon`"
                width="18"
                height="18"
                loading="lazy"
              >
              <Icon v-else name="github" class="credits-item-icon" />
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
import Icon from './Icon.vue';

// 开源致谢列表。icon 用 simpleicons.org CDN（自动品牌色 SVG）；
// 无品牌 icon 的项目（NLP/工具类）回落到 GitHub 图标。
const creditsGroups = [
  {
    title: '前端与交互',
    items: [
      { name: 'Vue 3', url: 'https://github.com/vuejs/core', tag: 'UI', icon: 'vuedotjs' },
      { name: 'Vite', url: 'https://github.com/vitejs/vite', tag: 'Build', icon: 'vite' },
      { name: 'Axios', url: 'https://github.com/axios/axios', tag: 'HTTP', icon: 'axios' },
      { name: 'Marked', url: 'https://github.com/markedjs/marked', tag: 'Markdown', icon: 'markdown' },
      { name: 'WanaKana', url: 'https://github.com/WaniKani/WanaKana', tag: 'Japanese' }
    ]
  },
  {
    title: 'Agent 与后端运行时',
    items: [
      { name: 'LangGraph', url: 'https://github.com/langchain-ai/langgraphjs', tag: 'Agent', icon: 'langchain', invertDark: true },
      { name: 'Express', url: 'https://github.com/expressjs/express', tag: 'API', icon: 'express', invertDark: true },
      { name: 'better-sqlite3', url: 'https://github.com/WiseLibs/better-sqlite3', tag: 'Storage', icon: 'sqlite' },
      { name: 'js-tiktoken', url: 'https://github.com/dqbd/tiktoken', tag: 'Tokens', icon: 'openai', invertDark: true },
      { name: 'Ollama JS', url: 'https://github.com/ollama/ollama-js', tag: 'LLM', icon: 'ollama', invertDark: true },
      { name: 'CORS', url: 'https://github.com/expressjs/cors', tag: 'Middleware' }
    ]
  },
  {
    title: '日语处理与学习能力',
    items: [
      { name: 'Kuromoji', url: 'https://github.com/takuyaa/kuromoji.js', tag: 'NLP' },
      { name: 'ts-fsrs', url: 'https://github.com/open-spaced-repetition/ts-fsrs', tag: 'Memory' },
      { name: 'deer-flow', url: 'https://github.com/bytedance/deer-flow', tag: 'Agent', icon: 'bytedance' },
      { name: 'cc-switch', url: 'https://github.com/farion1231/cc-switch', tag: 'LLM Switch' }
    ]
  }
];

const brandIconUrl = (slug) => `https://cdn.simpleicons.org/${slug}`;

const repoTitle = (item) => {
  if (item.repo) return item.repo;
  try {
    const url = new URL(item.url);
    return url.hostname === 'github.com'
      ? url.pathname.replace(/^\/+/, '')
      : item.url;
  } catch {
    return item.url;
  }
};
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

.credits-item-icon,
.credits-item-brand {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}

.credits-item-icon {
  color: var(--text-muted);
}

.credits-item-brand {
  display: block;
  object-fit: contain;
}

.credits-item:hover .credits-item-icon {
  color: var(--text-primary);
}

:global(.app-dark) .credits-item-brand--invert {
  filter: invert(1);
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
