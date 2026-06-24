<template>
  <div ref="container" class="turnstile-widget" data-action="register"></div>
</template>

<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';

const props = defineProps({
  siteKey: { type: String, required: true }
});
const emit = defineEmits(['token', 'error']);
const container = ref(null);
let widgetId = null;

const loadTurnstile = () => new Promise((resolve, reject) => {
  if (window.turnstile) {
    resolve(window.turnstile);
    return;
  }
  const existing = document.querySelector('script[data-jvm-turnstile]');
  if (existing) {
    existing.addEventListener('load', () => resolve(window.turnstile), { once: true });
    existing.addEventListener('error', reject, { once: true });
    return;
  }
  const script = document.createElement('script');
  script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
  script.async = true;
  script.defer = true;
  script.dataset.jvmTurnstile = 'true';
  script.addEventListener('load', () => resolve(window.turnstile), { once: true });
  script.addEventListener('error', reject, { once: true });
  document.head.appendChild(script);
});

const renderWidget = async () => {
  if (!props.siteKey || !container.value) return;
  try {
    const turnstile = await loadTurnstile();
    await nextTick();
    if (!container.value || widgetId !== null) return;
    widgetId = turnstile.render(container.value, {
      sitekey: props.siteKey,
      action: 'register',
      theme: 'auto',
      size: 'flexible',
      callback: token => emit('token', token),
      'expired-callback': () => emit('token', ''),
      'error-callback': () => {
        emit('token', '');
        emit('error');
      }
    });
  } catch {
    emit('error');
  }
};

const removeWidget = () => {
  if (widgetId !== null && window.turnstile) {
    window.turnstile.remove(widgetId);
  }
  widgetId = null;
  emit('token', '');
};

onMounted(renderWidget);
onBeforeUnmount(removeWidget);
watch(() => props.siteKey, () => {
  removeWidget();
  renderWidget();
});
</script>

<style scoped>
.turnstile-widget {
  width: 100%;
  min-height: 65px;
}
</style>
