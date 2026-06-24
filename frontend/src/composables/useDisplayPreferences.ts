import { ref, watch } from 'vue';

const readBooleanPreference = (key: string, fallback: boolean = false): boolean => {
  try {
    const saved = localStorage.getItem(key);
    if (saved === null) return fallback;
    return saved === 'true';
  } catch (e) {
    return fallback;
  }
};

const saveBooleanPreference = (key: string, value: boolean): void => {
  try {
    localStorage.setItem(key, String(value));
  } catch (e) {
    // Ignore storage failures in private browsing or restricted environments.
  }
};

/**
 * 深色模式 / 无障碍模式偏好：持久化到 localStorage，并同步到 <html> 的 data-* 上供 CSS 使用。
 * 返回的 darkMode / accessibilityMode 可直接在模板中双向绑定。
 */
export function useDisplayPreferences() {
  const darkMode = ref<boolean>(false);
  const accessibilityMode = ref<boolean>(false);

  const applyDisplayPreferences = (): void => {
    document.documentElement.dataset.theme = darkMode.value ? 'dark' : 'light';
    document.documentElement.dataset.accessibility = accessibilityMode.value ? 'on' : 'off';
  };

  watch(darkMode, (value: boolean) => {
    saveBooleanPreference('jvmDarkMode', value);
    applyDisplayPreferences();
  });

  watch(accessibilityMode, (value: boolean) => {
    saveBooleanPreference('jvmAccessibilityMode', value);
    applyDisplayPreferences();
  });

  // 首屏初始化：未显式设置时回退到系统 prefers-color-scheme。
  const initDisplayPreferences = (): void => {
    const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches || false;
    darkMode.value = readBooleanPreference('jvmDarkMode', prefersDark);
    accessibilityMode.value = readBooleanPreference('jvmAccessibilityMode', false);
    applyDisplayPreferences();
  };

  return { darkMode, accessibilityMode, initDisplayPreferences };
}
