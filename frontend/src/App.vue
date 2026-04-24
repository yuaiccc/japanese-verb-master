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
          
          <div class="form-group position-relative">
            <label for="verb">动词原形</label>
            <input
              id="verb"
              v-model="form.verb"
              type="text"
              placeholder="例如：飲む、食べる、nomu、taberu"
              @keyup.enter="conjugate"
              @input="error = ''"
              @focus="showSuggestions = true"
              @blur="hideSuggestionsWithDelay"
              autocomplete="off"
            >
            <!-- 自动补全下拉框 -->
            <ul v-if="showSuggestions && suggestions.length > 0" class="suggestions-list">
              <li 
                v-for="(item, index) in suggestions" 
                :key="index"
                @mousedown.prevent="selectSuggestion(item)"
              >
                <span class="suggestion-kanji">{{ item.kanji }}</span>
                <span class="suggestion-kana">{{ item.kana }}</span>
                <span class="suggestion-romaji">{{ item.romaji }}</span>
                <span class="suggestion-meaning">{{ item.meaning }}</span>
              </li>
            </ul>
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
        
        <!-- AI 解释区域 -->
        <div v-if="result || loadingAi || aiError" class="card result-card">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
            <h3 style="margin-bottom: 0;">✨ AI 深度解析与例句</h3>
            <div style="display: flex; gap: 10px; align-items: center;">
              <select v-model="selectedModel" class="model-select" v-if="availableModels.length > 0">
                <option v-for="m in availableModels" :key="m" :value="m">{{ m }}</option>
              </select>
              <button v-if="(!loadingAi && result) || aiRawExplanation" @click="fetchAiExplanation" class="btn-secondary" :disabled="loadingAi">
                {{ aiRawExplanation ? '重新生成' : '获取解析' }}
              </button>
            </div>
          </div>
          
          <div v-if="loadingAi && !aiRawExplanation" class="ai-loading">
            <div class="spinner"></div>
            <p>Ollama 正在思考中，请稍候...</p>
          </div>
          
          <div v-else-if="aiError && !aiRawExplanation" class="error-message">
            {{ aiError }}
            <button @click="fetchAiExplanation" style="margin-left: 10px; background: none; border: none; text-decoration: underline; color: inherit; cursor: pointer;">重试</button>
          </div>
          
          <div v-if="aiRawExplanation" class="ai-content markdown-body" v-html="aiExplanation"></div>
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
import { ref, watch, onMounted, computed } from 'vue';
import axios from 'axios';
import { marked } from 'marked';

const form = ref({
  verb: ''
});

const result = ref(null);
const aiRawExplanation = ref('');
const loading = ref(false);
const loadingAi = ref(false);
const error = ref('');
const aiError = ref('');
const showSuggestions = ref(false);
const suggestions = ref([]);
const availableModels = ref([]);
const selectedModel = ref('');
let suggestTimeout = null;

const aiExplanation = computed(() => {
  return aiRawExplanation.value ? marked(aiRawExplanation.value) : '';
});

onMounted(async () => {
  try {
    const res = await axios.get('/api/ai-models');
    availableModels.value = res.data;
    if (res.data.length > 0) {
      selectedModel.value = res.data.includes('qwen2.5:7b') ? 'qwen2.5:7b' : res.data[0];
    }
  } catch(e) {
    console.error('获取模型列表失败', e);
  }
});

const verbTypeMap = {
  GODAN: '五段动词',
  ICHIDAN: '一段动词',
  SURU: 'サ变动词',
  KURU: 'カ变动词'
};

// 监听输入，从后端获取联想补全
watch(() => form.value.verb, (newVal) => {
  if (suggestTimeout) clearTimeout(suggestTimeout);
  
  if (!newVal || newVal.trim() === '') {
    suggestions.value = [];
    return;
  }

  // 防抖，避免每次击键都发请求
  suggestTimeout = setTimeout(async () => {
    try {
      const response = await axios.get('/api/suggest', {
        params: { q: newVal }
      });
      suggestions.value = response.data;
    } catch (err) {
      console.error('获取联想失败', err);
      suggestions.value = [];
    }
  }, 200);
});

const selectSuggestion = (item) => {
  form.value.verb = item.kanji;
  showSuggestions.value = false;
  conjugate();
};

const hideSuggestionsWithDelay = () => {
  setTimeout(() => {
    showSuggestions.value = false;
  }, 200);
};

const conjugate = async () => {
  error.value = '';
  result.value = null;
  aiExplanation.value = null;
  aiError.value = '';

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
    
    // 自动触发 AI 解析
    fetchAiExplanation();
  } catch (err) {
    error.value = err.response?.data?.error || '请求失败，请检查输入';
  } finally {
    loading.value = false;
  }
};

const fetchAiExplanation = async () => {
  if (!result.value?.dictionaryForm) return;
  
  loadingAi.value = true;
  aiError.value = '';
  aiRawExplanation.value = '';
  
  try {
    const response = await fetch(`/api/ai-explain?verb=${encodeURIComponent(result.value.dictionaryForm)}&model=${encodeURIComponent(selectedModel.value || 'qwen2.5:7b')}`);
    
    if (!response.ok) {
      throw new Error('网络请求失败');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    
    loadingAi.value = false; // 流式请求开始接收，停止显示 loading spinner

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      buffer += decoder.decode(value, { stream: true });
      
      let eventEndIndex;
      while ((eventEndIndex = buffer.indexOf('\n\n')) >= 0) {
        const eventStr = buffer.slice(0, eventEndIndex);
        buffer = buffer.slice(eventEndIndex + 2);
        
        if (eventStr.startsWith('data: ')) {
          const dataStr = eventStr.slice(6);
          if (dataStr === '[DONE]') {
            break;
          }
          try {
            const data = JSON.parse(dataStr);
            if (data.error) {
              aiError.value = data.error;
            } else if (data.content) {
              aiRawExplanation.value += data.content;
            }
          } catch (e) {
            console.error('JSON Parse Error', e);
          }
        }
      }
    }
  } catch (err) {
    aiError.value = err.message || 'AI 解析请求失败';
  } finally {
    loadingAi.value = false;
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

.position-relative {
  position: relative;
}

.suggestions-list {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  background: white;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  margin-top: 4px;
  padding: 0;
  list-style: none;
  box-shadow: 0 4px 12px rgba(0,0,0,0.1);
  z-index: 10;
  max-height: 250px;
  overflow-y: auto;
}

.suggestions-list li {
  padding: 10px 15px;
  cursor: pointer;
  display: flex;
  align-items: center;
  border-bottom: 1px solid #f5f5f5;
  transition: background-color 0.2s;
}

.suggestions-list li:last-child {
  border-bottom: none;
}

.suggestions-list li:hover {
  background-color: #f8f9fa;
}

.suggestion-kanji {
  font-weight: 600;
  font-size: 1.1em;
  color: #333;
  min-width: 60px;
}

.suggestion-kana {
  color: #667eea;
  font-size: 0.9em;
  margin-left: 10px;
  min-width: 80px;
}

.suggestion-romaji {
  color: #999;
  font-size: 0.85em;
  margin-left: 10px;
  font-family: monospace;
}

.suggestion-meaning {
  color: #666;
  font-size: 0.85em;
  margin-left: auto;
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

/* AI 解释区域样式 */
.ai-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 15px;
  padding: 30px;
  color: #666;
}

.spinner {
  width: 24px;
  height: 24px;
  border: 3px solid #e0e0e0;
  border-top-color: #667eea;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.ai-content {
  background: #fdfdfd;
  padding: 20px;
  border-radius: 8px;
  border: 1px solid #eee;
  line-height: 1.6;
  color: #333;
}

.btn-secondary {
  padding: 6px 12px;
  background: #f0f0f0;
  color: #333;
  border: 1px solid #ddd;
  border-radius: 6px;
  font-size: 0.9em;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-secondary:hover {
  background: #e4e4e4;
}

.model-select {
  padding: 6px 12px;
  border: 1px solid #ddd;
  border-radius: 6px;
  background-color: white;
  font-size: 0.9em;
  color: #333;
  outline: none;
  cursor: pointer;
}

.model-select:focus {
  border-color: #667eea;
}

/* 简单的 markdown 样式补充 */
.markdown-body h1, .markdown-body h2, .markdown-body h3, .markdown-body h4 {
  margin-top: 10px;
  margin-bottom: 10px;
  color: #2c3e50;
}
.markdown-body p {
  margin-bottom: 10px;
}
.markdown-body ul, .markdown-body ol {
  padding-left: 20px;
  margin-bottom: 10px;
}
</style>
