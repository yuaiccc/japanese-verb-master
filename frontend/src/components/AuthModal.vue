<template>
      <div v-if="modal.open" class="auth-modal-overlay" @click.self="$emit('close')">
        <div class="auth-modal card" role="dialog" aria-label="登录或注册">
          <div class="auth-modal__head">
            <strong>{{ modal.mode === 'register' ? '注册新账号' : '登录' }}</strong>
            <button type="button" class="auth-modal__close" aria-label="关闭" @click="$emit('close')">×</button>
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
            <p v-if="modal.error" class="auth-error">{{ modal.error }}</p>
            <button type="submit" class="search-btn auth-submit" :disabled="modal.loading">
              {{ modal.loading ? '处理中…' : (modal.mode === 'register' ? '注册并登录' : '登录') }}
            </button>
          </form>
          <p class="auth-switch">
            <template v-if="modal.mode === 'login'">
              还没有账号？<button type="button" class="auth-link" @click="modal.mode = 'register'; modal.error = ''">去注册</button>
            </template>
            <template v-else>
              已有账号？<button type="button" class="auth-link" @click="modal.mode = 'login'; modal.error = ''">去登录</button>
            </template>
          </p>
          <p class="auth-note">未登录时数据归属访客账号；登录后记忆卡 / 练习记录 / 解锁权益按账号隔离。</p>
        </div>
      </div>
</template>

<script setup>
// 登录 / 注册弹窗（纯展示）：状态由父级 authModal 传入，提交/关闭通过事件回传
defineProps({ modal: { type: Object, required: true } });
defineEmits(['submit', 'close']);
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
  border: none;
  background: transparent;
  font-size: 1.4rem;
  line-height: 1;
  cursor: pointer;
  color: var(--text-muted);
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

.auth-note {
  margin: 0;
  font-size: 0.78rem;
  line-height: 1.5;
  color: var(--text-muted);
}
</style>
