<template>
  <div class="dojo-wrapper">
      <!-- 显式 duration：页签在后台时 CSS 动画被浏览器暂停，animationend 永不触发，
           out-in 模式会卡死在 leave 态；定时器兜底保证状态切换始终完成 -->
      <transition name="card-fade" mode="out-in" :duration="260">
        <!-- 准备界面 -->
        <div v-if="dojoState === 'start'" class="card dojo-card dojo-start" key="start">
          <Icon name="brain" class="icon-brain-large" />
          <h2>动词变形道场</h2>
          <div class="dojo-scene-grid">
            <button
              v-for="scene in sceneOptions"
              :key="scene.id"
              class="scene-card"
              :class="{ active: selectedSceneId === scene.id, 'is-locked': scene.locked }"
              @click="selectDojoScene(scene.id)"
            >
              <span class="scene-card-title">
                <Icon :name="scene.locked ? 'lock' : sceneIcon(scene)" class="scene-card-icon" />
                {{ scene.name }}
              </span>
              <span class="scene-card-desc">{{ scene.description }}</span>
              <span class="scene-card-meta">{{ scene.meta }}</span>
              <span v-if="scene.preview" class="scene-card-preview">{{ scene.preview }}</span>
            </button>
          </div>

          <p v-if="dojoError" class="dojo-error-msg">{{ dojoError }}</p>

          <div v-if="paywall.visible" class="paywall-card" role="dialog" aria-label="解锁 N1 专项练习">
            <div class="paywall-head">
              <strong>解锁 N1 专项练习</strong>
              <button type="button" class="paywall-close" aria-label="关闭" @click="closePaywall">
                <Icon name="x" />
              </button>
            </div>
            <template v-if="paywall.order">
              <div class="paywall-body">
                <p class="paywall-subject">{{ paywall.order.subject }}</p>
                <p class="paywall-amount">
                  <template v-if="paywall.order.provider === 'okx'">
                    {{ paywall.order.amount }} {{ paywall.order.currency }}
                  </template>
                  <template v-else>¥{{ paywall.order.amount }}</template>
                </p>
                <p class="paywall-meta">订单号 {{ paywall.order.outTradeNo }}</p>

                <!-- OKX 链上充值：复制地址，付款后提交 TxID，后端只读核验到账 -->
                <template v-if="paywall.order.provider === 'okx'">
                  <p class="paywall-network">{{ paywall.order.chain }}</p>
                  <img
                    class="paywall-qr-img"
                    :src="paywall.order.qrDataUrl"
                    :alt="`${paywall.order.chain} 充值地址二维码`"
                    width="200"
                    height="200"
                  />
                  <div class="paywall-address">
                    <code>{{ paywall.order.depositAddress }}</code>
                    <button
                      type="button"
                      class="paywall-icon-btn"
                      :title="paywall.copied ? '已复制' : '复制充值地址'"
                      :aria-label="paywall.copied ? '已复制' : '复制充值地址'"
                      @click="copyOkxAddress"
                    >
                      <Icon :name="paywall.copied ? 'check' : 'copy'" />
                    </button>
                  </div>
                  <p v-if="paywall.order.depositTag" class="paywall-meta">
                    Memo / Tag：{{ paywall.order.depositTag }}
                  </p>
                  <p class="paywall-hint">{{ paywall.order.cashierHint }}</p>
                  <form class="paywall-tx-form" @submit.prevent="submitOkxTxId">
                    <input
                      v-model.trim="paywall.txId"
                      type="text"
                      autocomplete="off"
                      placeholder="付款后粘贴 TxID / 交易哈希"
                      aria-label="OKX 充值交易 TxID"
                    />
                    <button
                      type="submit"
                      class="search-btn paywall-pay-btn"
                      :disabled="paywall.paying || !paywall.txId"
                    >
                      <Icon :name="paywall.paying ? 'hourglass' : 'check'" />
                      {{ paywall.paying ? '核验中…' : '提交并核验' }}
                    </button>
                  </form>
                  <p v-if="paywall.polling" class="paywall-hint paywall-polling">
                    <Icon name="hourglass" />
                    {{ paywall.order.verificationStatus || '正在等待 OKX 确认到账…' }}
                  </p>
                </template>

                <!-- 电脑网站支付：跳收银台，无需 App -->
                <template v-else-if="paywall.order.payUrl">
                  <button type="button" class="search-btn paywall-pay-btn" @click="goToAlipayCashier">
                    前往支付宝收银台付款
                  </button>
                  <p class="paywall-hint">{{ paywall.order.cashierHint }}</p>
                  <p v-if="paywall.polling" class="paywall-hint paywall-polling">
                    <Icon name="hourglass" />
                    正在等待支付结果，付款完成后自动解锁…
                  </p>
                </template>

                <!-- 当面付：扫码 -->
                <template v-else-if="paywall.order.qrDataUrl">
                  <img class="paywall-qr-img" :src="paywall.order.qrDataUrl" alt="支付宝收款二维码" width="200" height="200" />
                  <p class="paywall-hint">{{ paywall.order.cashierHint }}</p>
                  <p v-if="paywall.polling" class="paywall-hint paywall-polling">
                    <Icon name="hourglass" />
                    正在等待支付结果，付款完成后自动解锁…
                  </p>
                </template>

                <!-- mock 演示 -->
                <template v-else>
                  <div class="paywall-qr" aria-hidden="true">
                    <span class="paywall-qr-mark">支</span>
                    <code>{{ paywall.order.qrContent }}</code>
                  </div>
                  <p class="paywall-hint">{{ paywall.order.cashierHint }}</p>
                  <button
                    type="button"
                    class="search-btn paywall-pay-btn"
                    :disabled="paywall.paying"
                    @click="simulatePaywallPay"
                  >
                    {{ paywall.paying ? '确认中…' : '模拟扫码支付' }}
                  </button>
                </template>
              </div>
            </template>
            <p v-else-if="!paywall.error" class="paywall-hint">正在创建订单…</p>
            <p v-if="paywall.error" class="paywall-error">{{ paywall.error }}</p>
          </div>
          <div class="dojo-profile-panel" v-if="practiceProfile.totalAttempts > 0">
            <div class="dojo-profile-header">
              <h3>学习画像</h3>
              <span class="profile-badge">最近 {{ practiceProfile.totalAttempts }} 次练习</span>
            </div>
            <p class="profile-recommendation profile-recommendation--hero">{{ userProfile.summary }}</p>
            <div class="profile-tag-list">
              <span class="profile-tag">记忆 {{ userProfile.reviewLoad.total }}</span>
              <span class="profile-tag">待复习 {{ userProfile.reviewLoad.due }}</span>
              <span class="profile-tag">准确率 {{ userProfile.recentAccuracy }}%</span>
              <span v-if="userProfile.strongestScene" class="profile-tag">熟悉场景 {{ userProfile.strongestScene.name }}</span>
            </div>
            <div class="dojo-profile-stats">
              <div class="profile-stat">
                <strong>{{ practiceProfile.accuracy }}%</strong>
                <span>综合正确率</span>
              </div>
              <div class="profile-stat">
                <strong>{{ practiceProfile.todayAttempts }}</strong>
                <span>今日练习</span>
              </div>
              <div class="profile-stat">
                <strong>{{ practiceProfile.avgDuration }}s</strong>
                <span>平均答题</span>
              </div>
            </div>
            <p class="profile-recommendation">{{ practiceProfile.recommendation }}</p>
            <div class="profile-subsection" v-if="userProfile.recommendations.length > 0">
              <span class="profile-subtitle">长期建议</span>
              <div class="profile-tag-list">
                <span v-for="item in userProfile.recommendations" :key="item" class="profile-tag">
                  {{ item }}
                </span>
              </div>
            </div>
            <div class="profile-subsection" v-if="practiceProfile.weakestForms.length > 0">
              <span class="profile-subtitle">薄弱变形</span>
              <div class="profile-tag-list">
                <span v-for="item in practiceProfile.weakestForms" :key="item.key" class="profile-tag">
                  {{ item.label }} {{ item.accuracy }}%
                </span>
              </div>
            </div>
            <div class="profile-subsection" v-if="practiceProfile.sceneStats.length > 0">
              <span class="profile-subtitle">场景掌握度</span>
              <div class="scene-progress-list">
                <div v-for="item in practiceProfile.sceneStats" :key="item.id" class="scene-progress-row">
                  <span>{{ item.name }}</span>
                  <strong>{{ item.accuracy }}%</strong>
                </div>
              </div>
            </div>
            <div class="profile-subsection" v-if="practiceProfile.wrongBook.length > 0">
              <span class="profile-subtitle">错题本</span>
              <div class="wrong-book-list">
                <div v-for="item in practiceProfile.wrongBook" :key="`${item.verb}-${item.formKey}`" class="wrong-book-item">
                  <div class="wrong-book-main">
                    <strong>{{ item.verb }}</strong>
                    <span>{{ item.formLabel }}</span>
                    <span class="wrong-book-scene">{{ item.sceneName }}</span>
                  </div>
                  <div class="wrong-book-meta">
                    <span>正确：{{ item.correctAnswer }}</span>
                    <span>最近写成：{{ item.latestUserAnswer || '未记录' }}</span>
                    <span>累计错 {{ item.wrongCount }} 次</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- 游戏界面 -->
        <div v-else-if="dojoState === 'playing'" class="card dojo-card dojo-playing" key="playing">
          <div class="dojo-header">
            <span class="dojo-progress">进度: {{ dojoCurrentIndex + 1 }} / {{ dojoQuestions.length }}</span>
            <span class="dojo-scene-pill">{{ activeDojoSceneName }}</span>
            <span class="dojo-score">得分: <strong>{{ dojoScore }}</strong></span>
          </div>

          <div class="dojo-question">
            <div class="dojo-verb">
              <span class="dojo-kanji">{{ currentQuestion.verb }}</span>
              <span class="dojo-romaji" v-if="currentQuestion.romaji">{{ currentQuestion.romaji }}</span>
              <span class="dojo-meaning">{{ currentQuestion.meaning }}</span>
            </div>
            <div class="dojo-prompt">
              请写出它的 <strong>{{ currentQuestion.formLabel }}</strong>
            </div>
          </div>

          <div class="dojo-coach-line">
            <span class="dojo-coach-badge">Dojo Coach</span>
            <span>{{ dojoCoachBusy ? '正在思考…' : '可给提示、判题、讲解' }}</span>
          </div>

          <div class="dojo-input-area">
            <div class="dojo-input-wrapper">
              <input
                v-model="dojoInput"
                class="dojo-input"
                :class="{
                  'input-correct': dojoFeedback?.isCorrect,
                  'input-error': dojoFeedback && !dojoFeedback.isCorrect
                }"
                type="text"
                placeholder="输入你的变形答案"
                :disabled="!!dojoFeedback"
                @keyup.enter="submitDojoAnswer"
              >
              <button
                v-if="dojoInput"
                class="dojo-clear-btn"
                @click="dojoInput = ''"
                aria-label="清空答案"
              >
                <Icon name="x" class="icon-x" />
              </button>
            </div>
            <button class="agent-chip agent-chip--with-icon" :disabled="dojoCoachBusy || !!dojoFeedback" @click="requestDojoHint">
              <Icon name="sparkles" />
              提示
            </button>
            <button class="search-btn" :disabled="dojoCoachBusy || !dojoInput.trim() || !!dojoFeedback" @click="submitDojoAnswer">
              <Icon name="check" />
              提交
            </button>
          </div>

          <div v-if="dojoCoachHint && !dojoFeedback" class="dojo-coach-hint">
            {{ dojoCoachHint }}
          </div>

          <div class="dojo-action-row">
            <button v-if="dojoFeedback" class="search-btn btn-next" @click="nextDojoQuestion">
              <Icon name="arrow-right" />
              {{ dojoCurrentIndex < dojoQuestions.length - 1 ? '下一题' : '查看成绩' }}
            </button>
          </div>

          <div v-if="dojoFeedback" class="dojo-feedback" :class="dojoFeedback.isCorrect ? 'feedback-correct' : 'feedback-error'">
            <div v-if="dojoFeedback.isCorrect" class="feedback-msg">
              <Icon name="check" class="icon-check" /> 完全正确！
            </div>
            <div v-else class="feedback-msg">
              <Icon name="error" class="icon-error" /> 错误。正确答案是: <strong>{{ dojoFeedback.correctAnswer }}</strong>
            </div>
            <p v-if="dojoFeedback.explanation" class="dojo-feedback-copy">{{ dojoFeedback.explanation }}</p>
          </div>
        </div>

        <!-- 结算界面 -->
        <div v-else-if="dojoState === 'end'" class="card dojo-card dojo-end" key="end">
          <h2>挑战结束！</h2>
          <p class="dojo-end-scene">{{ activeDojoSceneName }}</p>
          <div class="final-score">
            <span class="score-number">{{ dojoScore }}</span> / {{ dojoQuestions.length }}
          </div>
          <p class="score-eval">
            <Icon :name="scoreIcon" class="score-eval-icon" />
            {{ scoreCopy }}
          </p>
          <button class="search-btn btn-dojo-start" @click="startDojo">
            <Icon name="dojo" />
            再来一局
          </button>
        </div>
      </transition>
    </div>
</template>

<script setup>
import { computed, onUnmounted } from 'vue';
import Icon from './Icon.vue';
import { useDojo } from '../composables/useDojo';

// 练习道场 + 付费解锁 + 学习画像：状态与逻辑见 composables/useDojo（单例，跨组件共享）
const {
  dojoState, dojoQuestions, dojoCurrentIndex, dojoScore, dojoFeedback,
  dojoCoachBusy, dojoCoachHint, dojoInput, dojoError, selectedSceneId,
  currentQuestion, sceneOptions, activeDojoSceneName,
  paywall, practiceProfile, userProfile,
  startDojo, selectDojoScene, submitDojoAnswer, requestDojoHint, nextDojoQuestion,
  closePaywall, goToAlipayCashier, copyOkxAddress, submitOkxTxId, simulatePaywallPay,
  stopPaywallPolling
} = useDojo();

onUnmounted(() => {
  stopPaywallPolling();
});

const sceneIcon = (scene) => {
  if (scene.id === 'all') return 'sparkles';
  if (scene.id === 'n1') return 'star';
  if (/食|飲|買|店|餐|饭|咖啡|料理/.test(scene.name || scene.description || '')) return 'chat';
  if (/旅|駅|道|移動|交通/.test(scene.name || scene.description || '')) return 'arrow-right';
  return 'dojo';
};

const scoreIcon = computed(() => {
  if (dojoScore.value === dojoQuestions.value.length) return 'trophy';
  if (dojoScore.value >= 8) return 'star';
  if (dojoScore.value >= 5) return 'flame';
  return 'book';
});

const scoreCopy = computed(() => {
  if (dojoScore.value === dojoQuestions.value.length) return '完美！你是动词大师';
  if (dojoScore.value >= 8) return '非常棒！只有一点点小瑕疵';
  if (dojoScore.value >= 5) return '不错，继续加油';
  return '看来还需要多加练习哦';
});
</script>

<style scoped>
.dojo-wrapper {
  max-width: 760px;
  margin: 0 auto 40px;
}

.dojo-card {
  text-align: center;
  padding: 34px 28px;
}

.icon-brain-large {
  width: 56px;
  height: 56px;
  color: var(--primary);
  margin-bottom: 10px;
}

.dojo-start h2 {
  font-size: clamp(2rem, 4.5vw, 2.6rem);
  font-weight: 700;
  letter-spacing: 0.04em;
  margin-bottom: 14px;
  color: var(--text-primary);
}

.dojo-start p {
  color: var(--text-muted);
  line-height: 1.6;
  margin-bottom: 30px;
}

.dojo-scene-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 20px;
  text-align: left;
}

.scene-card {
  border: 1px solid var(--surface-border);
  background: var(--field-bg);
  border-radius: var(--radius-md);
  padding: 15px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 6px;
  transition: all 0.2s ease;
  color: inherit;
}

.scene-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 14px 26px rgba(24, 35, 31, 0.1);
  border-color: var(--primary);
}

.scene-card.is-locked {
  border-style: dashed;
  opacity: 0.85;
}

/* === 付费解锁卡片（A2A 支付 demo）=== */
.paywall-card {
  margin-top: 14px;
  padding: 16px;
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-md);
  background: var(--glass-noise), var(--panel-bg);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  box-shadow: var(--shadow-soft), var(--glass-highlight);
  display: grid;
  gap: 10px;
  text-align: left;
}

.paywall-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.paywall-close {
  border: 0;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  padding: 5px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.paywall-close .icon {
  width: 16px;
  height: 16px;
}

.paywall-body { display: grid; gap: 4px; }
.paywall-subject { margin: 0; color: var(--text-secondary); }

.paywall-qr-img {
  display: block;
  width: 200px;
  height: 200px;
  margin: 8px auto;
  border-radius: 8px;
  background: #fff;
  padding: 6px;
}

.paywall-polling {
  color: var(--primary);
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.paywall-polling .icon {
  width: 14px;
  height: 14px;
}

.paywall-amount {
  margin: 0;
  font-size: 1.7rem;
  font-weight: 800;
  color: var(--primary);
}

.paywall-meta {
  margin: 0;
  font-size: 0.72rem;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}

.paywall-network {
  margin: 4px 0 0;
  font-size: 0.78rem;
  font-weight: 700;
  color: var(--text-secondary);
}

.paywall-address {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 34px;
  align-items: center;
  gap: 8px;
  padding: 9px 10px;
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-sm);
  background: var(--field-bg);
}

.paywall-address code {
  min-width: 0;
  overflow-wrap: anywhere;
  font-size: 0.72rem;
  color: var(--text-secondary);
}

.paywall-icon-btn {
  width: 34px;
  height: 34px;
  border: 1px solid var(--surface-border);
  border-radius: 6px;
  background: var(--panel-bg);
  color: var(--text-secondary);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.paywall-tx-form {
  display: grid;
  gap: 8px;
  margin-top: 6px;
}

.paywall-tx-form input {
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-sm);
  background: var(--field-bg);
  color: var(--text-primary);
  padding: 10px 12px;
  font: inherit;
}

.paywall-qr {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 6px;
  padding: 10px;
  border: 1px dashed var(--surface-border);
  border-radius: var(--radius-sm);
  background: var(--field-bg);
}

.paywall-qr-mark {
  width: 36px;
  height: 36px;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  background: #1677ff;
  color: #fff;
  font-weight: 800;
}

.paywall-qr code {
  font-size: 0.72rem;
  color: var(--text-muted);
  word-break: break-all;
}

.paywall-hint {
  margin: 0;
  font-size: 0.76rem;
  color: var(--text-muted);
}

.paywall-error {
  margin: 0;
  font-size: 0.8rem;
  color: var(--danger);
}

.dojo-error-msg {
  margin: 10px 0 0;
  font-size: 0.88rem;
  color: var(--danger);
}

.paywall-pay-btn { justify-self: start; }

.scene-card.active {
  border-color: var(--primary);
  background: var(--primary-soft);
  box-shadow: var(--focus-ring);
}

.scene-card-title {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 1rem;
  font-weight: 700;
  color: var(--text-primary);
}

.scene-card-icon {
  width: 16px;
  height: 16px;
  color: var(--primary);
  flex: 0 0 auto;
}

.scene-card-desc {
  font-size: 0.88rem;
  color: var(--text-secondary);
  line-height: 1.5;
}

.scene-card-meta,
.scene-card-preview {
  font-size: 0.8rem;
  color: var(--text-muted);
}

.dojo-profile-panel {
  margin: 0 auto 24px;
  padding: 18px;
  border-radius: var(--radius-md);
  background: var(--panel-bg);
  border: 1px solid var(--surface-border);
  text-align: left;
}

.dojo-profile-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}

.dojo-profile-header h3 {
  margin: 0;
}

.profile-badge {
  font-size: 0.78rem;
  color: var(--primary);
  background: var(--primary-soft);
  padding: 4px 10px;
  border-radius: 999px;
}

.dojo-profile-stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  margin-bottom: 14px;
}

.profile-stat {
  background: var(--field-bg);
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-sm);
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.profile-stat strong {
  font-size: 1.25rem;
  color: var(--text-primary);
}

.profile-stat span {
  font-size: 0.82rem;
  color: var(--text-muted);
}

.score-eval {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.score-eval-icon {
  width: 18px;
  height: 18px;
  color: var(--primary);
}

.profile-recommendation {
  margin: 0 0 14px;
  color: var(--text-secondary);
}

.profile-subsection + .profile-subsection {
  margin-top: 12px;
}

.profile-subtitle {
  display: inline-block;
  margin-bottom: 8px;
  font-size: 0.84rem;
  font-weight: 700;
  color: var(--text-primary);
}

.profile-tag-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.profile-tag {
  background: var(--field-bg);
  border: 1px solid var(--surface-border);
  border-radius: 999px;
  padding: 4px 10px;
  font-size: 0.8rem;
  color: var(--text-secondary);
}

.scene-progress-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.scene-progress-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 12px;
  background: var(--field-bg);
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-sm);
  font-size: 0.88rem;
}

.wrong-book-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.wrong-book-item {
  background: var(--field-bg);
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-sm);
  padding: 12px;
}

.wrong-book-main {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 6px;
}

.wrong-book-main strong {
  color: var(--text-primary);
}

.wrong-book-main span {
  font-size: 0.82rem;
  color: var(--text-secondary);
}

.wrong-book-scene {
  color: var(--primary) !important;
}

.wrong-book-meta {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 0.8rem;
  color: var(--text-muted);
}

.btn-dojo-start {
  padding: 12px 32px;
  font-size: 1.1em;
  border-radius: var(--radius-md);
}

.dojo-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 24px;
  padding-bottom: 16px;
  border-bottom: 2px dashed var(--surface-border);
  color: var(--text-muted);
  font-weight: 600;
}

.dojo-scene-pill {
  padding: 4px 10px;
  background: var(--primary-soft);
  color: var(--primary);
  border-radius: 999px;
  font-size: 0.82rem;
}

.dojo-score strong {
  color: var(--primary);
  font-size: 1.2em;
}

.dojo-question {
  margin-bottom: 32px;
}

.dojo-verb {
  margin-bottom: 16px;
}

.dojo-kanji {
  display: block;
  font-size: 3em;
  font-weight: 800;
  color: var(--text-primary);
  line-height: 1.2;
}

.dojo-romaji {
  display: block;
  font-size: 1.2em;
  color: var(--text-muted);
  font-family: monospace;
  margin-bottom: 8px;
}

.dojo-meaning {
  display: block;
  font-size: 1.1em;
  color: var(--text-muted);
}

.dojo-prompt {
  font-size: 1.2em;
  color: var(--text-secondary);
}

.dojo-prompt strong {
  color: var(--primary);
  padding: 2px 8px;
  background: var(--primary-soft);
  border-radius: 6px;
  margin: 0 4px;
}

.dojo-coach-line {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 18px 0 10px;
  color: var(--text-muted);
  font-size: 0.84rem;
}

.dojo-coach-badge {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  padding: 0 8px;
  border: 1px solid var(--surface-border);
  border-radius: 999px;
  background: var(--panel-bg);
  color: var(--text-secondary);
  font-weight: 700;
}

.dojo-input-area {
  display: flex;
  gap: 12px;
  margin-bottom: 24px;
  justify-content: center;
}

.dojo-input-wrapper {
  position: relative;
  display: flex;
  align-items: center;
}

.dojo-input {
  border: 2px solid var(--surface-border);
  border-radius: var(--radius-md);
  padding: 12px 36px 12px 16px; /* Added right padding for the clear button */
  font-size: 1.2em;
  text-align: center;
  transition: all 0.3s;
  background: var(--field-bg);
  color: var(--text-primary);
  width: 100%;
}

.dojo-clear-btn {
  position: absolute;
  right: 10px;
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  padding: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  transition: all 0.2s;
}

.dojo-clear-btn:hover {
  color: var(--text-primary);
  background: var(--primary-soft);
}

.dojo-coach-hint {
  margin: -8px 0 18px;
  padding: 10px 12px;
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-sm);
  background: var(--panel-bg);
  color: var(--text-secondary);
  font-size: 0.88rem;
  line-height: 1.5;
}

.icon-x {
  width: 16px;
  height: 16px;
}

.dojo-input:focus {
  border-color: var(--primary);
  box-shadow: var(--focus-ring);
}

.input-correct {
  border-color: var(--success) !important;
  background: rgba(34, 197, 94, 0.12) !important;
  color: var(--success);
}

.input-error {
  border-color: var(--danger) !important;
  background: rgba(254, 226, 226, 0.16) !important;
  color: var(--danger);
  text-decoration: line-through;
}

.btn-next {
  background: var(--text-primary);
}
.btn-next:hover {
  background: var(--primary-hover);
}

.dojo-feedback {
  padding: 16px;
  border-radius: var(--radius-md);
  font-weight: 600;
  font-size: 1.1em;
  animation: slideUp 0.3s ease;
}

.feedback-correct {
  background: rgba(34, 197, 94, 0.12);
  color: var(--success);
  border: 1px solid #bbf7d0;
}

.feedback-error {
  background: rgba(254, 226, 226, 0.16);
  color: var(--danger);
  border: 1px solid #fecaca;
}

.feedback-msg {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.dojo-feedback-copy {
  margin: 10px 0 0;
  font-size: 0.92rem;
  line-height: 1.55;
  font-weight: 500;
}

.dojo-end h2 {
  font-size: 2.5em;
  color: var(--text-primary);
  margin-bottom: 20px;
}

.dojo-end-scene {
  margin-top: -8px;
  margin-bottom: 18px;
  color: var(--text-muted);
}

.final-score {
  font-size: 1.5em;
  color: var(--text-muted);
  margin-bottom: 20px;
}

.score-number {
  font-size: 3em;
  font-weight: 800;
  color: var(--primary);
}

.score-eval {
  font-size: 1.2em;
  color: var(--text-secondary);
  margin-bottom: 32px;
}

/* === 选择题样式 === */
.dojo-choice-area {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin: 24px 0;
}

.dojo-choice-btn {
  padding: 16px 20px;
  font-size: 1.2rem;
  background: var(--surface);
  border: 2px solid var(--border);
  border-radius: var(--radius-md);
  color: var(--text-primary);
  cursor: pointer;
  transition: all 0.2s ease;
  font-family: inherit;
  outline: none;
}

.dojo-choice-btn:hover:not(:disabled) {
  border-color: var(--primary);
  background: var(--primary-soft);
  transform: translateY(-2px);
}

.dojo-choice-btn:active:not(:disabled) {
  transform: translateY(0);
}

.dojo-choice-btn:disabled {
  cursor: default;
  opacity: 0.7;
}

.choice-selected {
  border-color: var(--primary);
  background: var(--primary-soft);
}

.choice-correct {
  border-color: var(--success) !important;
  background: rgba(34, 197, 94, 0.1) !important;
  color: var(--success);
  font-weight: 600;
  box-shadow: 0 0 0 1px var(--success);
  opacity: 1 !important;
}

.choice-wrong {
  border-color: var(--error) !important;
  background: rgba(239, 68, 68, 0.08) !important;
  color: var(--error);
  opacity: 1 !important;
}

.dojo-action-row {
  display: flex;
  justify-content: center;
  margin-top: 20px;
  min-height: 44px; /* 预留按钮高度避免跳动 */
}

@media (max-width: 768px) {
  .dojo-choice-area {
    grid-template-columns: 1fr;
  }
}

/* 卡片淡入过渡 + 关键帧：道场 transition 自带一份，保证组件样式独立 */
.card-fade-enter-active {
  animation: cardIn 0.5s var(--ease-spring) both;
}

.card-fade-leave-active {
  animation: cardIn 0.22s var(--ease-out) reverse both;
}

@keyframes cardIn {
  from {
    opacity: 0;
    transform: translateY(16px) scale(0.98);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

@keyframes slideUp {
  from {
    opacity: 0;
    transform: translateY(12px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* 暗色模式覆盖 */
.app-dark .profile-badge,
.app-dark .dojo-scene-pill,
.app-dark .dojo-prompt strong {
  background: var(--primary-soft);
  color: var(--primary-hover);
}

.app-dark .btn-next:hover {
  background: var(--primary-hover);
  color: #102019;
}
</style>
