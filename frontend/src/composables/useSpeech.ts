import { ref, onUnmounted } from 'vue';

/**
 * 日语语音播报（Web Speech API）：启动即解析并缓存最佳日语嗓音 + 预热引擎，
 * 文本一出现就预建 utterance，点击朗读时零查找。
 *
 * 返回：
 *  - speak(text)        朗读一段日语文本
 *  - prewarmSpeech(arr) 预缓存一批文本的 utterance
 *  - initTts()          首屏初始化（解析嗓音、注册 voiceschanged、静音预热）
 *  - isSpeaking / ttsVoiceReady 响应式状态
 */
export function useSpeech() {
  let cachedJaVoice: SpeechSynthesisVoice | null = null;
  const ttsVoiceReady = ref<boolean>(false);
  const isSpeaking = ref<boolean>(false);
  const ttsUtteranceCache = new Map<string, SpeechSynthesisUtterance>(); // text -> SpeechSynthesisUtterance

  // 嗓音优选：神经/在线嗓音 > Google > Microsoft/Edge > 其它日语嗓音
  const pickBestJaVoice = (): SpeechSynthesisVoice | null => {
    const voices = window.speechSynthesis?.getVoices() || [];
    const jaVoices = voices.filter(v => v.lang.toLowerCase().startsWith('ja'));
    if (jaVoices.length === 0) return null;
    const score = (v: SpeechSynthesisVoice): number => {
      const name = v.name.toLowerCase();
      let s = 0;
      if (/natural|neural|online/.test(name)) s += 6;
      if (/google/.test(name)) s += 4;
      if (/microsoft|edge/.test(name)) s += 3;
      if (/nanami|keita|sayaka|kyoko|otoya|o-?ren/.test(name)) s += 2;
      if (v.localService === false) s += 1; // 在线嗓音通常更自然
      return s;
    };
    return [...jaVoices].sort((a, b) => score(b) - score(a))[0];
  };

  const buildUtterance = (text: string): SpeechSynthesisUtterance => {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'ja-JP';
    u.rate = 0.9;
    u.pitch = 1;
    if (cachedJaVoice) u.voice = cachedJaVoice;
    return u;
  };

  // 预缓存：文本一出现就提前构建好（嗓音已绑定），点击时零查找
  const prepareSpeech = (text: string): void => {
    if (!text || !window.speechSynthesis || ttsUtteranceCache.has(text)) return;
    // LRU 淘汰：超过 200 条时删除最早的缓存项
    if (ttsUtteranceCache.size >= 200) {
      const firstKey = ttsUtteranceCache.keys().next().value as string;
      ttsUtteranceCache.delete(firstKey);
    }
    ttsUtteranceCache.set(text, buildUtterance(text));
  };

  const prewarmSpeech = (texts: string[] = []): void => {
    texts.filter(Boolean).forEach(prepareSpeech);
  };

  const refreshTtsVoice = (): void => {
    const voice = pickBestJaVoice();
    if (!voice) return;
    cachedJaVoice = voice;
    ttsVoiceReady.value = true;
    // 嗓音就绪后回填已缓存的 utterance
    ttsUtteranceCache.forEach((u) => { u.voice = voice; });
  };

  const initTts = (): void => {
    if (!window.speechSynthesis) return;
    refreshTtsVoice();
    // 嗓音是异步加载的，列表就绪后再解析一次
    window.speechSynthesis.addEventListener?.('voiceschanged', refreshTtsVoice);
    // 静音预热，消除首次合成的引擎冷启动延迟
    try {
      const warm = new SpeechSynthesisUtterance('');
      warm.volume = 0;
      window.speechSynthesis.speak(warm);
    } catch (e) {
      /* 部分浏览器需用户手势，忽略即可 */
    }
  };

  const speak = (text: string): void => {
    if (!text || !window.speechSynthesis) return;
    // 停止上一次朗读
    window.speechSynthesis.cancel();
    const utterance = ttsUtteranceCache.get(text) || buildUtterance(text);
    if (cachedJaVoice && !utterance.voice) utterance.voice = cachedJaVoice;
    utterance.onstart = () => isSpeaking.value = true;
    utterance.onend = () => isSpeaking.value = false;
    utterance.onerror = () => isSpeaking.value = false;
    window.speechSynthesis.speak(utterance);
  };

  onUnmounted(() => {
    window.speechSynthesis?.removeEventListener?.('voiceschanged', refreshTtsVoice);
    window.speechSynthesis?.cancel();
  });

  return { speak, prewarmSpeech, initTts, isSpeaking, ttsVoiceReady };
}
