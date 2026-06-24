import { ref, computed } from 'vue';
import axios from 'axios';

// 模块级单例状态：练习道场 + 付费解锁 + 学习画像。
// 设计为单例，是因为 userProfile / entitlements / loadXxx 不仅 DojoView 用，
// App.vue 的认证、首屏 bootstrap、Agent 记忆回写也会读写同一份状态。
const dojoState = ref<string>('start'); // 'start' | 'playing' | 'end'
const dojoQuestions = ref<any[]>([]);
const dojoCurrentIndex = ref<number>(0);
const dojoScore = ref<number>(0);
const dojoFeedback = ref<any>(null); // { isCorrect, correctAnswer, explanation }
const dojoLoading = ref<boolean>(false);
const dojoQuestionStartedAt = ref<number>(0);
const dojoSelectedOption = ref<string>('');
const dojoInput = ref<string>('');
const dojoCoachBusy = ref<boolean>(false);
const dojoCoachHint = ref<string>('');
const dojoError = ref<string>('');
const scenes = ref<any[]>([]);
const selectedSceneId = ref<string>('all');

const practiceProfile = ref<any>({
  totalAttempts: 0,
  accuracy: 0,
  todayAttempts: 0,
  avgDuration: 0,
  weakestForms: [],
  sceneStats: [],
  wrongBook: [],
  recommendation: '先完成一轮挑战，系统会开始生成你的长期学习画像。'
});

const userProfile = ref<any>({
  summary: '还在建立你的长期学习画像。',
  learningStyle: 'exploring',
  focusWordType: 'verb',
  reviewLoad: { total: 0, due: 0, mastered: 0 },
  weakestForm: null,
  strongestScene: null,
  recentAccuracy: 0,
  recommendations: []
});

// === 付费解锁（A2A 支付 demo：应用开单，确认权在用户）===
const entitlements = ref<Record<string, any>>({});
const paywall = ref<any>({
  visible: false,
  order: null,
  paying: false,
  error: '',
  polling: false,
  txId: '',
  copied: false
});
let paywallPollTimer: ReturnType<typeof setInterval> | null = null;

const currentQuestion = computed(() => dojoQuestions.value[dojoCurrentIndex.value] || {});

const sceneOptions = computed(() => {
  const sceneCards = scenes.value.map((scene: any) => ({
    ...scene,
    meta: `${scene.verbCount} 个核心动词`,
    preview: scene.featuredVerbs?.map((verb: any) => verb.kanji).join(' / ')
  }));

  return [
    {
      id: 'all',
      name: '随机混合',
      description: '跨场景综合训练，适合热身和复习。',
      meta: `${sceneCards.length} 个场景`,
      preview: '综合抽题'
    },
    ...sceneCards,
    {
      id: 'n1',
      name: 'N1 专项',
      description: '使役被动・使役・被动等高阶变形集训。',
      meta: entitlements.value['n1-pack'] ? '已解锁' : '支付解锁',
      preview: '飲まされる / 食べさせられる',
      locked: !entitlements.value['n1-pack']
    }
  ];
});

const selectedSceneName = computed(() =>
  sceneOptions.value.find((scene: any) => scene.id === selectedSceneId.value)?.name || '随机混合'
);

const activeDojoSceneName = computed(() =>
  currentQuestion.value.sceneName || selectedSceneName.value
);

const loadEntitlements = async (): Promise<void> => {
  try {
    const res = await axios.get('/api/entitlements');
    entitlements.value = res.data.entitlements || {};
  } catch (e) {
    console.error('加载解锁状态失败', e);
  }
};

const loadUserProfile = async (): Promise<void> => {
  try {
    const res = await axios.get('/api/user-profile');
    userProfile.value = res.data;
  } catch (e) {
    console.error('加载用户画像失败', e);
  }
};

const stopPaywallPolling = (): void => {
  if (paywallPollTimer) {
    clearInterval(paywallPollTimer);
    paywallPollTimer = null;
  }
  if (paywall.value) paywall.value.polling = false;
};

const closePaywall = (): void => {
  stopPaywallPolling();
  paywall.value = {
    visible: false,
    order: null,
    paying: false,
    error: '',
    polling: false,
    txId: '',
    copied: false
  };
};

const finishUnlock = async (): Promise<void> => {
  stopPaywallPolling();
  await loadEntitlements();
  closePaywall();
  selectedSceneId.value = 'n1';
  await startDojo();
};

// 真实支付：支付宝付款后直接轮询；OKX 提交 TxID 后轮询到账状态。
const startPaywallPolling = (outTradeNo: string): void => {
  stopPaywallPolling();
  paywall.value.polling = true;
  paywallPollTimer = setInterval(async () => {
    try {
      const poll = await axios.get(`/api/payments/orders/${outTradeNo}`);
      if (poll.data.status === 'TRADE_SUCCESS') {
        await finishUnlock();
      }
    } catch (e) {
      // 轮询期间的瞬时错误忽略，继续下次
    }
  }, 3000);
};

const openPaywall = async (): Promise<void> => {
  stopPaywallPolling();
  paywall.value = {
    visible: true,
    order: null,
    paying: false,
    error: '',
    polling: false,
    txId: '',
    copied: false
  };
  try {
    const res = await axios.post('/api/payments/orders', { sku: 'n1-pack' });
    paywall.value.order = res.data;
    // 真实支付宝：开始轮询到账；mock 等用户点「模拟支付」
    if (res.data.provider === 'alipay') {
      startPaywallPolling(res.data.outTradeNo);
    }
  } catch (e: any) {
    if (e.response?.status === 409) {
      // 已解锁（多标签页等场景），直接刷新状态
      await loadEntitlements();
      paywall.value.visible = false;
      return;
    }
    paywall.value.error = e.response?.data?.error || '创建订单失败，请稍后再试。';
  }
};

const goToAlipayCashier = (): void => {
  const url = paywall.value.order?.payUrl;
  if (url) window.open(url, '_blank', 'noopener');
};

const copyOkxAddress = async (): Promise<void> => {
  const address = paywall.value.order?.depositAddress;
  if (!address) return;
  try {
    await navigator.clipboard.writeText(address);
    paywall.value.copied = true;
    setTimeout(() => {
      if (paywall.value) paywall.value.copied = false;
    }, 1600);
  } catch {
    paywall.value.error = '复制失败，请手动选择充值地址。';
  }
};

const submitOkxTxId = async (): Promise<void> => {
  const order = paywall.value.order;
  const txId = paywall.value.txId.trim();
  if (!order || !txId || paywall.value.paying) return;
  paywall.value.paying = true;
  paywall.value.error = '';
  try {
    const res = await axios.post(`/api/payments/orders/${order.outTradeNo}/txid`, { txId });
    paywall.value.order = { ...order, ...res.data };
    if (res.data.status === 'TRADE_SUCCESS') {
      await finishUnlock();
      return;
    }
    startPaywallPolling(order.outTradeNo);
  } catch (e: any) {
    paywall.value.error = e.response?.data?.error || 'TxID 验证失败，请检查后重试。';
  } finally {
    paywall.value.paying = false;
  }
};

// mock：模拟「用户在支付宝 App 扫码 + 密码确认」
const simulatePaywallPay = async (): Promise<void> => {
  const order = paywall.value.order;
  if (!order || paywall.value.paying) return;
  paywall.value.paying = true;
  paywall.value.error = '';
  try {
    await axios.post(`/api/payments/orders/${order.outTradeNo}/simulate-confirm`);
    const poll = await axios.get(`/api/payments/orders/${order.outTradeNo}`);
    if (poll.data.status === 'TRADE_SUCCESS') {
      await finishUnlock();
    } else {
      paywall.value.error = '支付未完成，请重试。';
    }
  } catch (e: any) {
    paywall.value.error = e.response?.data?.error || '支付确认失败。';
  } finally {
    paywall.value.paying = false;
  }
};

const recordPractice = async ({ question, userAnswer, isCorrect, durationMs }: {
  question: any;
  userAnswer: string;
  isCorrect: boolean;
  durationMs: number;
}): Promise<void> => {
  try {
    const res = await axios.post('/api/practice-records', {
      verb: question.verb,
      formKey: question.formKey,
      sceneId: question.sceneId || 'all',
      sceneName: question.sceneName || '随机混合',
      userAnswer,
      correctAnswer: question.answer,
      isCorrect,
      durationMs,
      answeredAt: new Date().toISOString()
    });
    practiceProfile.value = {
      weakestForms: [],
      sceneStats: [],
      wrongBook: [],
      recommendation: null,
      ...practiceProfile.value,
      ...res.data,
    };
    await loadUserProfile();
  } catch (e) {
    console.error('保存练习记录失败', e);
  }
};

const startDojo = async (): Promise<void> => {
  dojoLoading.value = true;
  dojoError.value = '';
  try {
    const params: Record<string, any> = { limit: 10 };
    if (selectedSceneId.value !== 'all') {
      params.scene = selectedSceneId.value;
    }
    const res = await axios.get('/api/dojo-quiz', { params });
    dojoQuestions.value = res.data;
    if (dojoQuestions.value.length === 0) throw new Error('题库为空');

    dojoCurrentIndex.value = 0;
    dojoScore.value = 0;
    dojoState.value = 'playing';
    dojoSelectedOption.value = '';
    dojoInput.value = '';
    dojoCoachHint.value = '';
    dojoFeedback.value = null;
    dojoQuestionStartedAt.value = Date.now();
  } catch (err: any) {
    if (err.response?.status === 402) {
      // 付费内容未解锁 → 打开支付卡片（服务端是最终守门人，前端锁只是引导）
      await openPaywall();
    } else {
      dojoError.value = '加载题库失败，请稍后再试。';
      console.error(err);
    }
  } finally {
    dojoLoading.value = false;
  }
};

const selectDojoScene = async (sceneId: string): Promise<void> => {
  if (dojoLoading.value) return;
  const scene = sceneOptions.value.find((item: any) => item.id === sceneId);
  if (scene?.locked) {
    await openPaywall();
    return;
  }
  selectedSceneId.value = sceneId;
  await startDojo();
};

const submitDojoAnswer = async (): Promise<void> => {
  if (dojoFeedback.value || !dojoInput.value.trim()) return;
  const q = currentQuestion.value;
  const answer = dojoInput.value.trim();
  const durationMs = dojoQuestionStartedAt.value ? Date.now() - dojoQuestionStartedAt.value : 0;
  dojoCoachBusy.value = true;
  try {
    const { data } = await axios.post('/api/dojo-agent-turn', {
      question: q,
      userAnswer: answer,
      action: 'check'
    });
    const isCorrect = !!data.isCorrect;
    if (isCorrect) dojoScore.value++;
    await recordPractice({ question: q, userAnswer: answer, isCorrect, durationMs });
    dojoFeedback.value = {
      isCorrect,
      correctAnswer: data.correctAnswer || q.answer,
      explanation: data.explanation || ''
    };
  } catch (e) {
    console.error('Dojo Coach 判题失败', e);
  } finally {
    dojoCoachBusy.value = false;
  }
};

const requestDojoHint = async (): Promise<void> => {
  if (dojoFeedback.value) return;
  dojoCoachBusy.value = true;
  try {
    const { data } = await axios.post('/api/dojo-agent-turn', {
      question: currentQuestion.value,
      action: 'hint'
    });
    dojoCoachHint.value = data.hint || '';
  } catch (e) {
    console.error('Dojo Coach 提示失败', e);
  } finally {
    dojoCoachBusy.value = false;
  }
};

const nextDojoQuestion = (): void => {
  if (dojoCurrentIndex.value < dojoQuestions.value.length - 1) {
    dojoCurrentIndex.value++;
    dojoSelectedOption.value = '';
    dojoInput.value = '';
    dojoCoachHint.value = '';
    dojoFeedback.value = null;
    dojoQuestionStartedAt.value = Date.now();
  } else {
    dojoState.value = 'end';
  }
};

// 首屏 bootstrap：并行拉取场景 / 练习画像 / 长期画像 / 解锁状态。
const loadDojoBootstrap = async (): Promise<void> => {
  const [scenesResult, profileResult, userProfileResult] = await Promise.allSettled([
    axios.get('/api/scenes'),
    axios.get('/api/practice-profile'),
    axios.get('/api/user-profile')
  ]);
  if (scenesResult.status === 'fulfilled') scenes.value = scenesResult.value.data;
  else console.error('获取场景列表失败', scenesResult.reason);
  if (profileResult.status === 'fulfilled') practiceProfile.value = profileResult.value.data;
  else console.error('获取学习画像失败', profileResult.reason);
  if (userProfileResult.status === 'fulfilled') userProfile.value = userProfileResult.value.data;
  else console.error('获取长期画像失败', userProfileResult.reason);
  loadEntitlements();
};

export function useDojo() {
  return {
    // 状态
    dojoState, dojoQuestions, dojoCurrentIndex, dojoScore, dojoFeedback,
    dojoLoading, dojoInput, dojoCoachBusy, dojoCoachHint, dojoError,
    scenes, selectedSceneId, practiceProfile, userProfile, entitlements, paywall,
    // 计算属性
    currentQuestion, sceneOptions, selectedSceneName, activeDojoSceneName,
    // 道场流程
    startDojo, selectDojoScene, submitDojoAnswer, requestDojoHint, nextDojoQuestion,
    // 付费
    openPaywall, closePaywall, goToAlipayCashier, copyOkxAddress,
    submitOkxTxId, simulatePaywallPay, stopPaywallPolling,
    // 数据加载（认证 / 首屏 / Agent 跨域复用）
    loadEntitlements, loadUserProfile, recordPractice, loadDojoBootstrap
  };
}
