<template>
      <div v-if="modal.open" class="auth-modal-overlay" @click.self="$emit('close')">
        <div class="auth-modal card" role="dialog" aria-label="登录或注册">
          <div class="auth-modal__head">
            <strong>{{ modal.mode === 'register' ? '注册新账号' : '登录' }}</strong>
            <button type="button" class="auth-modal__close" aria-label="关闭" @click="$emit('close')">
              <Icon name="x" />
            </button>
          </div>
          <form class="auth-modal__form" @submit.prevent="$emit('submit')">
            <input
              v-model="modal.username"
              class="auth-input"
              type="text"
              autocomplete="username"
              placeholder="用户名（2-32 字符）"
              :disabled="modal.loading"
            />
            <input
              v-model="modal.password"
              class="auth-input"
              type="password"
              :autocomplete="modal.mode === 'register' ? 'new-password' : 'current-password'"
              placeholder="密码（至少 6 位）"
              :disabled="modal.loading"
            />
            <TurnstileWidget
              v-if="modal.mode === 'register' && siteKey"
              :site-key="siteKey"
              @token="$emit('captcha-token', $event)"
              @error="$emit('captcha-error')"
            />
            <p v-if="modal.error" class="auth-error">{{ modal.error }}</p>
            <button
              type="submit"
              class="search-btn auth-submit"
              :disabled="modal.loading || (modal.mode === 'register' && siteKey && !captchaToken)"
            >
              <span v-if="modal.loading" class="auth-spinner" aria-hidden="true"></span>
              <Icon v-else :name="modal.mode === 'register' ? 'plus' : 'login'" />
              {{ modal.loading ? '处理中…' : (modal.mode === 'register' ? '注册并登录' : '登录') }}
            </button>
          </form>
          <p class="auth-switch">
            <template v-if="modal.mode === 'login'">
              还没有账号？<button type="button" class="auth-link" @click="$emit('mode-change', 'register')">去注册</button>
            </template>
            <template v-else>
              已有账号？<button type="button" class="auth-link" @click="$emit('mode-change', 'login')">去登录</button>
            </template>
          </p>
        </div>
      </div>
</template>

<script setup lang="ts">
import Icon from './Icon.vue';
import TurnstileWidget from './TurnstileWidget.vue';

// 登录 / 注册弹窗（纯展示）：状态由父级 authModal 传入，提交/关闭通过事件回传
defineProps({
  modal: { type: Object, required: true },
  siteKey: { type: String, default: '' },
  captchaToken: { type: String, default: '' }
});
defineEmits(['submit', 'close', 'mode-change', 'captcha-token', 'captcha-error']);
</script>

<style scoped>
.auth-modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: color-mix(in srgb, var(--text-primary) 32%, transparent);
  backdrop-filter: blur(4px);
}

.auth-modal {
  width: 100%;
  max-width: 360px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.auth-modal__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 1.05rem;
}

.auth-modal__close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  cursor: pointer;
  color: var(--text-muted);
  padding: 5px;
}

.auth-modal__close .icon {
  width: 16px;
  height: 16px;
}

.auth-modal__form {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.auth-input {
  width: 100%;
  min-height: 42px;
  padding: 0 14px;
  border: 1px solid var(--surface-border);
  border-radius: 12px;
  background: var(--field-bg);
  color: var(--text-primary);
  font-size: 0.95rem;
}

.auth-input:focus {
  outline: none;
  border-color: var(--primary);
}

.auth-submit {
  width: 100%;
  margin-top: 2px;
}

.auth-submit .icon {
  width: 16px;
  height: 16px;
}

.auth-spinner {
  width: 14px;
  height: 14px;
  border: 2px solid rgba(255, 255, 255, 0.4);
  border-top-color: #fff;
  border-radius: 50%;
  animation: auth-spin 0.8s linear infinite;
}

@keyframes auth-spin {
  to { transform: rotate(360deg); }
}

.auth-error {
  margin: 0;
  color: #d9534f;
  font-size: 0.85rem;
}

.auth-switch {
  margin: 0;
  font-size: 0.85rem;
  color: var(--text-muted);
  text-align: center;
}

.auth-link {
  border: none;
  background: transparent;
  color: var(--primary);
  font-weight: 700;
  cursor: pointer;
  padding: 0 2px;
}

</style>
