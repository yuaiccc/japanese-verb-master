export function buildPlannerContext(intent = {}) {
  return {
    intentType: intent.type,
    summary: 'Planner 只负责路由，不负责生成具体学习内容。',
    specialist: intent.wantsExamples
      ? 'example_designer'
      : intent.wantsPractice
        ? 'practice_coach'
        : 'researcher_only',
    handoff: intent.wantsExamples
      ? '后续会把请求拆给 Scene Example 子链路处理。'
      : intent.wantsPractice
        ? '后续会把请求拆给 Practice Coach 子链路处理。'
        : '后续会把请求拆给查词/对比子链路处理。'
  };
}

export function buildExampleDesignerContext(message = '', intent = {}) {
  if (!intent?.wantsExamples) return null;
  const quantityMatch = message.match(/([0-9]+|三|四|五|六|七|八|九|十)(个|句)?/);
  return {
    mode: 'scene_examples',
    originalRequest: message,
    requestedCount: quantityMatch?.[1] || '3',
    sceneHint: /便利店/.test(message)
      ? '便利店'
      : /餐厅/.test(message)
        ? '餐厅'
        : /公司/.test(message)
          ? '公司'
          : /学校/.test(message)
            ? '学校'
            : '通用日常场景',
    outputGoal: '生成贴近真实场景的例句或短对话',
    constraints: [
      '不要查“给我”“帮我”这类中文功能词',
      '优先补足场景、角色关系、语气层次'
    ]
  };
}

export function buildPracticeCoachContext(message = '', context = {}) {
  return {
    mode: 'practice',
    originalRequest: message,
    userProfileSummary: context?.userProfile?.summary || '暂无',
    weakestForms: context?.userProfile?.weakestForms || [],
    targetSkill: /填空/.test(message) ? 'fill_blank' : /测验|题目/.test(message) ? 'quiz' : 'guided_practice',
    coachingGoal: '请后续 Tutor 给出更适合当前用户阶段的练习任务，而不是泛泛建议。'
  };
}

export function buildMemoryManagerContext(context = {}) {
  return {
    memoryStats: context?.memoryStats || null,
    userProfile: context?.userProfile || null
  };
}

export function formatPlannerNote(plannerNote = {}) {
  return [
    plannerNote.intentType ? `当前任务类型：${plannerNote.intentType}` : '',
    plannerNote.summary || '',
    plannerNote.handoff || ''
  ].filter(Boolean).join('\n');
}

export function formatSpecialistNote(specialistId, brief = {}) {
  if (specialistId === 'example_designer') {
    return `已整理场景 brief：${brief.sceneHint} / ${brief.requestedCount} 条 / ${brief.outputGoal}`;
  }
  if (specialistId === 'practice_coach') {
    return `已结合学习画像整理练习 brief：${brief.targetSkill} / 画像摘要 ${brief.userProfileSummary}`;
  }
  return '';
}

export function serializeSpecialistBrief(label, brief = {}) {
  return `${label} brief:\n${JSON.stringify(brief, null, 2)}`;
}
