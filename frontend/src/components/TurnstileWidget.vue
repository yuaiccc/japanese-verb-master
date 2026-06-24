<template>
  <div ref="container" class="turnstile-widget" data-action="register"></div>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';

const props = defineProps({
  siteKey: { type: String, required: true }
});
const emit = defineEmits(['token', 'error']);
const container = ref<any>(null);
let widgetId: any = null;

const loadTurnstile = async () => {
  if ((window as any).turnstile) return (window as any).turnstile;

  const loadPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-jvm-turnstile]');
    if (existing) {
      existing.addEventListener('load', () => resolve((window as any).turnstile), { once: true });
      existing.addEventListener('error', reject, { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    script.defer = true;
    script.dataset.jvmTurnstile = 'true';
    script.addEventListener('load', () => resolve((window as any).turnstile), { once: true });
    script.addEventListener('error', reject, { once: true });
    document.head.appendChild(script);
  });

  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Turnstile load timeout')), 10000)
  );
  return Promise.race([loadPromise, timeoutPromise]);
};

let rendering = false;
const renderWidget = async () => {
  if (rendering || widgetId !== null) return;
  if (!props.siteKey || !container.value) return;
  rendering = true;
  try {
    const turnstile = await loadTurnstile();
    await nextTick();
    if (!container.value || widgetId !== null) return;
    widgetId = turnstile.render(container.value, {
      sitekey: props.siteKey,
      action: 'register',
      theme: 'auto',
      size: 'flexible',
      callback: (token: string) => emit('token', token),
      'expired-callback': () => emit('token', ''),
      'error-callback': () => {
        emit('token', '');
        emit('error');
      }
    });
  } catch {
    emit('error');
  } finally {
    rendering = false;
  }
};

const removeWidget = () => {
  if (widgetId !== null && (window as any).turnstile) {
    (window as any).turnstile.remove(widgetId);
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
