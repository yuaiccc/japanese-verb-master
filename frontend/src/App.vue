<template>
  <div class="container">
    <header class="header">
      <h1>🇯🇵 Japanese Verb Master</h1>
      <p class="subtitle">精准的日语动词活用在线工具</p>
    </header>

    <main class="main-content">
      <!-- 左侧：工具区 -->
      <section class="tool-section">
        <div class="card">
          <h2>动词活用工具</h2>
          
          <div class="form-group">
            <label for="verb">动词原形</label>
            <input
              id="verb"
              v-model="form.verb"
              type="text"
              placeholder="例如：飲む、食べる、nomu、taberu"
              @keyup.enter="conjugate"
            >
          </div>

          <button @click="conjugate" class="btn-primary">
            {{ loading ? '处理中...' : '活用' }}
          </button>

          <div v-if="error" class="error-message">
            {{ error }}
          </div>
        </div>

        <!-- 结果展示 -->
        <div v-if="result" class="card result-card">
          <h3>活用结果</h3>
          <div class="result-grid">
            <div class="result-item">
              <span class="label">原形 (解析为)</span>
              <span class="value">{{ result.dictionaryForm }}</span>
              <span v-if="result.originalInput !== result.parsedAs" class="example" style="margin-top: 4px; font-size: 0.8em">从罗马音 "{{ result.originalInput }}" 转换</span>
            </div>
            <div class="result-item">
              <span class="label">动词类型</span>
              <span class="value">{{ verbTypeMap[result.verbType] || result.verbType }}</span>
            </div>
            <div class="result-item">
              <span class="label">否定式</span>
              <span class="value">{{ result.negative }}</span>
            </div>
            <div class="result-item">
              <span class="label">礼貌式</span>
              <span class="value">{{ result.polite }}</span>
            </div>
            <div class="result-item">
              <span class="label">て形</span>
              <span class="value">{{ result.teForm }}</span>
            </div>
            <div class="result-item">
              <span class="label">过去式</span>
              <span class="value">{{ result.taForm }}</span>
            </div>
            <div class="result-item">
              <span class="label">可能形</span>
              <span class="value">{{ result.potential }}</span>
            </div>
            <div class="result-item">
              <span class="label">被动形</span>
              <span class="value">{{ result.passive }}</span>
            </div>
            <div class="result-item">
              <span class="label">使役形</span>
              <span class="value">{{ result.causative }}</span>
            </div>
            <div class="result-item">
              <span class="label">命令形</span>
              <span class="value">{{ result.imperative }}</span>
            </div>
            <div class="result-item">
              <span class="label">意向形</span>
              <span class="value">{{ result.volitional }}</span>
            </div>
          </div>
        </div>
      </section>

      <!-- 右侧：文档区 -->
      <section class="doc-section">
        <div class="card">
          <h2>动词分类指南</h2>
          
          <div class="verb-type-guide">
            <div class="guide-item">
              <h4>五段动词 (Godan)</h4>
              <p>动词词尾为：う、く、ぐ、す、つ、ぬ、ふ、ぶ、む、る</p>
              <p class="example">例：飲む、読む、書く、走る</p>
            </div>

            <div class="guide-item">
              <h4>一段动词 (Ichidan)</h4>
              <p>动词词尾为：える、いる</p>
              <p class="example">例：食べる、見る、寝る</p>
            </div>

            <div class="guide-item">
              <h4>サ变动词</h4>
              <p>动词词尾为：する</p>
              <p class="example">例：勉強する、仕事する、愛する</p>
            </div>

            <div class="guide-item">
              <h4>カ变动词</h4>
              <p>动词词尾为：来る</p>
              <p class="example">例：来る、来ない</p>
            </div>
          </div>
        </div>

        <div class="card">
          <h2>活用形式说明</h2>
          <div class="conjugation-guide">
            <div class="guide-item">
              <strong>否定式 (ない形)</strong>
              <p>表示否定含义</p>
            </div>
            <div class="guide-item">
              <strong>礼貌式 (ます形)</strong>
              <p>用于正式、礼貌的表达</p>
            </div>
            <div class="guide-item">
              <strong>て形</strong>
              <p>连接两个动作或表示请求</p>
            </div>
            <div class="guide-item">
              <strong>过去式 (た形)</strong>
              <p>表示过去的动作或状态</p>
            </div>
            <div class="guide-item">
              <strong>可能形</strong>
              <p>表示能力或可能性</p>
            </div>
            <div class="guide-item">
              <strong>被动形</strong>
              <p>表示被动语态</p>
            </div>
            <div class="guide-item">
              <strong>使役形</strong>
              <p>表示使役关系</p>
            </div>
            <div class="guide-item">
              <strong>命令形</strong>
              <p>表示命令或指示</p>
            </div>
            <div class="guide-item">
              <strong>意向形</strong>
              <p>表示意图或推测</p>
            </div>
          </div>
        </div>
      </section>
    </main>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import axios from 'axios';

const form = ref({
  verb: ''
});

const result = ref(null);
const loading = ref(false);
const error = ref('');

const verbTypeMap = {
  GODAN: '五段动词',
  ICHIDAN: '一段动词',
  SURU: 'サ变动词',
  KURU: 'カ变动词'
};

const conjugate = async () => {
  error.value = '';
  result.value = null;

  if (!form.value.verb) {
    error.value = '请输入动词';
    return;
  }

  loading.value = true;
  try {
    const response = await axios.get('/api/conjugate', {
      params: {
        verb: form.value.verb
      }
    });
    result.value = response.data;
  } catch (err) {
    error.value = err.response?.data?.error || '请求失败，请检查输入';
  } finally {
    loading.value = false;
  }
};
</script>

<style scoped>
.container {
  min-height: 100vh;
  padding: 40px 20px;
}

.header {
  text-align: center;
  color: white;
  margin-bottom: 40px;
}

.header h1 {
  font-size: 3em;
  margin-bottom: 10px;
  text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.3);
}

.subtitle {
  font-size: 1.2em;
  opacity: 0.9;
}

.main-content {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 30px;
  margin-bottom: 40px;
}

@media (max-width: 1024px) {
  .main-content {
    grid-template-columns: 1fr;
  }
}

.card {
  background: white;
  border-radius: 12px;
  padding: 30px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);
}

.card h2 {
  color: #667eea;
  margin-bottom: 20px;
  font-size: 1.5em;
}

.card h3 {
  color: #667eea;
  margin-bottom: 15px;
}

.form-group {
  margin-bottom: 20px;
}

.form-group label {
  display: block;
  margin-bottom: 8px;
  color: #333;
  font-weight: 500;
}

.form-group input,
.form-group select {
  width: 100%;
  padding: 12px;
  border: 2px solid #e0e0e0;
  border-radius: 8px;
  font-size: 1em;
  transition: border-color 0.3s;
}

.form-group input:focus,
.form-group select:focus {
  outline: none;
  border-color: #667eea;
}

.btn-primary {
  width: 100%;
  padding: 12px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  border: none;
  border-radius: 8px;
  font-size: 1em;
  font-weight: 600;
  cursor: pointer;
  transition: transform 0.2s, box-shadow 0.2s;
}

.btn-primary:hover {
  transform: translateY(-2px);
  box-shadow: 0 5px 15px rgba(102, 126, 234, 0.4);
}

.btn-primary:active {
  transform: translateY(0);
}

.error-message {
  margin-top: 15px;
  padding: 12px;
  background: #fee;
  color: #c33;
  border-radius: 8px;
  border-left: 4px solid #c33;
}

.result-card {
  margin-top: 20px;
}

.result-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 15px;
}

@media (max-width: 768px) {
  .result-grid {
    grid-template-columns: 1fr;
  }
}

.result-item {
  display: flex;
  flex-direction: column;
  padding: 15px;
  background: #f5f5f5;
  border-radius: 8px;
  border-left: 4px solid #667eea;
}

.result-item .label {
  font-size: 0.9em;
  color: #999;
  margin-bottom: 5px;
}

.result-item .value {
  font-size: 1.3em;
  font-weight: 600;
  color: #333;
}

.verb-type-guide,
.conjugation-guide {
  display: grid;
  grid-template-columns: 1fr;
  gap: 15px;
}

.guide-item {
  padding: 15px;
  background: #f9f9f9;
  border-radius: 8px;
  border-left: 4px solid #667eea;
}

.guide-item h4 {
  color: #667eea;
  margin-bottom: 8px;
}

.guide-item p {
  color: #666;
  font-size: 0.95em;
  line-height: 1.5;
}

.example {
  color: #999;
  font-size: 0.9em;
  margin-top: 5px;
}

.guide-item strong {
  color: #333;
}
</style>
