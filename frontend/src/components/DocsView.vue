<template>
  <div class="doc-wrapper">
      <section class="doc-section">
        <div class="card doc-card">
          <div class="doc-header">
            <h2 class="doc-title">
              <span class="title-with-icon">
                <Icon name="book" class="icon-book" />
                动词分类指南与活用形式说明
              </span>
            </h2>
          </div>
          
          <div class="doc-content">
            <div class="guide-group">
              <h3>
                <span class="title-with-icon">
                  <Icon name="brain" class="icon-brain" />
                  动词分类指南
                </span>
              </h3>
              <ul class="guide-list">
                <li class="guide-item">
                  <strong>五段动词 (Group 1)</strong>
                  <p>词尾为 う段 假名的动词（不包括 える/いる）。<br>
                  <em>例：飲む (nomu)、書く (kaku)、話す (hanasu)</em></p>
                </li>
                <li class="guide-item">
                  <strong>一段动词 (Group 2)</strong>
                  <p>词尾为 る，且前一个假名在 い段 或 え段 上。<br>
                  <em>例：食べる (taberu)、見る (miru)</em></p>
                </li>
                <li class="guide-item">
                  <strong>サ变动词 (Group 3)</strong>
                  <p>以「する」结尾的动词。<br>
                  <em>例：勉強する (benkyousuru)</em></p>
                </li>
                <li class="guide-item">
                  <strong>カ变动词 (Group 3)</strong>
                  <p>只有「来る」(kuru) 一个词。</p>
                </li>
              </ul>
            </div>

            <div class="guide-group mt-4">
              <h3>📝 活用形式说明</h3>
              <ul class="guide-list">
                <li class="guide-item">
                  <strong>否定式 (ない形)</strong>
                  <p>表示否定、不去做某事。</p>
                </li>
                <li class="guide-item">
                  <strong>礼貌式 (ます形)</strong>
                  <p>对长辈或不熟悉的人使用的礼貌表达。</p>
                </li>
                <li class="guide-item">
                  <strong>て形</strong>
                  <p>用于连接句子、表示请求或正在进行的状态。</p>
                </li>
                <li class="guide-item">
                  <strong>过去式 (た形)</strong>
                  <p>表示已经发生过的动作。</p>
                </li>
                <li class="guide-item">
                  <strong>可能形</strong>
                  <p>表示有能力做到某事（能...、会...）。</p>
                </li>
                <li class="guide-item">
                  <strong>被动形</strong>
                  <p>表示受到某种动作的影响。</p>
                </li>
                <li class="guide-item">
                  <strong>使役形</strong>
                  <p>表示让某人做某事（让...、使...）。</p>
                </li>
                <li class="guide-item">
                  <strong>命令形</strong>
                  <p>强烈的命令语气（去做！）。</p>
                </li>
                <li class="guide-item">
                  <strong>意向形</strong>
                  <p>表示提议、决心或意志（我们...吧）。</p>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>
    </div>
</template>

<script setup>
import Icon from './Icon.vue';
// 纯静态文档：动词分类指南 + 活用形式说明（无响应式状态）
</script>

<style scoped>
.doc-wrapper {
  margin: 0 auto 40px;
}

.doc-card {
  padding: 0;
  overflow: hidden;
}

.doc-header {
  padding: 18px 24px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  cursor: pointer;
  background-color: var(--surface-soft);
  transition: background-color 0.2s, border-color 0.2s;
}

.doc-header:hover {
  background-color: var(--panel-bg);
}

.doc-title {
  margin: 0;
  font-size: 1.15rem;
  color: var(--text-primary);
  font-weight: 700;
}

.doc-content {
  padding: 20px 24px;
  border-top: 1px solid var(--surface-border);
}

.guide-group h3 {
  margin-top: 0;
  margin-bottom: 14px;
  color: var(--text-primary);
  font-size: 1.05rem;
}

.guide-list {
  list-style: none;
  padding: 0;
}

.guide-item {
  padding: var(--space-3) var(--space-4);
  background: var(--panel-bg);
  border-radius: var(--radius-sm);
  border-left: 4px solid var(--primary);
  margin-bottom: 10px;
}

.guide-item:last-child {
  margin-bottom: 0;
}

.guide-item strong {
  color: var(--text-primary);
}

.guide-item p {
  color: var(--text-muted);
  font-size: 0.92em;
  line-height: 1.5;
  margin: 4px 0 0;
}
</style>
