import {
  buildExampleDesignerContext,
  buildMemoryManagerContext,
  buildPlannerContext,
  buildPracticeCoachContext
} from './subagentContexts.js';

export const agentQueueTemplate = [
  { id: 'planner', label: 'Planner', description: '拆解学习任务和路由' },
  { id: 'researcher', label: 'Researcher', description: '调用词典、搜索和相似词工具' },
  { id: 'example_designer', label: 'Example Coach', description: '把场景需求转成例句/练习 brief' },
  { id: 'practice_coach', label: 'Practice Coach', description: '根据画像和错题上下文设计练习' },
  { id: 'tutor', label: 'Tutor', description: '组织解释、例句和练习建议' },
  { id: 'memory_manager', label: 'Memory Manager', description: '读取记忆队列并更新复习上下文' }
];

const agentQueueMap = Object.fromEntries(agentQueueTemplate.map(item => [item.id, item]));

export function getAgentQueue(intent = {}) {
  const specialistId = intent?.wantsExamples ? 'example_designer' : intent?.wantsPractice ? 'practice_coach' : null;
  const orderedIds = ['planner', 'researcher', ...(specialistId ? [specialistId] : []), 'tutor', 'memory_manager'];
  return orderedIds.map(id => agentQueueMap[id]).filter(Boolean);
}

export function extractJapaneseTerms(text = '') {
  const matches = text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー]{2,}/gu) || [];
  const stopWords = new Set(['什么区别', '有什么区别', '请简短回答', '请回答', '区别']);
  return [...new Set(matches)]
    .map(item => item.trim())
    .filter(item => item && !stopWords.has(item))
    .slice(0, 4);
}

function extractLookupTargets(text = '') {
  const kanaAnchored = text.match(/[\p{Script=Han}]{0,4}[\p{Script=Hiragana}\p{Script=Katakana}ー]+[\p{Script=Han}]{0,2}/gu) || [];
  const quoted = [...text.matchAll(/[「『"'“”]([^「『」』"'“”]+)[」』"'“”]/g)].map(match => match[1]);
  const stopWords = new Set([
    '给我', '一个', '一些', '例句', '场景', '填空', '练习', '题目', '测验', '专项',
    '怎么说', '怎么表达', '什么区别', '有什么区别', '请简短回答', '请回答', '区别'
  ]);

  return [...new Set([...kanaAnchored, ...quoted])]
    .map(item => String(item || '').trim())
    .map(item => item
      .replace(/^(请给我|给我|帮我|请|来个|来一些|我想要|我想看)+/, '')
      .replace(/^(一个|一些|几个|三句|三個)+/, '')
      .replace(/((的)?(例句|场景|填空|练习|题目|测验|专项).*)$/g, '')
      .trim())
    .map((item) => {
      if (!/[\p{Script=Hiragana}\p{Script=Katakana}ー]/u.test(item)) return item;
      const chars = [...item];
      const firstKanaIndex = chars.findIndex(char => /[\p{Script=Hiragana}\p{Script=Katakana}ー]/u.test(char));
      const lastKanaIndex = chars.reduce((last, char, index) => (
        /[\p{Script=Hiragana}\p{Script=Katakana}ー]/u.test(char) ? index : last
      ), -1);
      const leadingKanji = firstKanaIndex > 0 && /[\p{Script=Han}]/u.test(chars[firstKanaIndex - 1])
        ? chars[firstKanaIndex - 1]
        : '';
      return `${leadingKanji}${chars.slice(firstKanaIndex, lastKanaIndex + 1).join('')}`;
    })
    .filter(item => item && !stopWords.has(item))
    .slice(0, 4);
}

export function detectLearningIntent(message = '') {
  const text = String(message || '').trim();
  const terms = extractJapaneseTerms(text);
  const wantsExamples = /例句|场景|对话|便利店|餐厅|公司|学校|怎么说|怎么表达/.test(text);
  const wantsPractice = /练习|填空|测验|题目|专项/.test(text);
  const wantsComparison = /区别|差别|对比|敬语|误用/.test(text);

  return {
    type: wantsPractice ? 'practice' : wantsExamples ? 'scene_examples' : wantsComparison ? 'comparison' : 'lookup',
    wantsExamples,
    wantsPractice,
    wantsComparison,
    terms,
    rawMessage: text
  };
}

export function selectSpecialistSubagent(intent = {}) {
  if (intent?.wantsExamples) return 'example_designer';
  if (intent?.wantsPractice) return 'practice_coach';
  return null;
}

export const learningSubagentRegistry = {
  planner: {
    label: 'Planner',
    allowedTools: [],
    buildBrief: ({ intent }) => buildPlannerContext(intent)
  },
  researcher: {
    label: 'Researcher',
    allowedTools: ['external_search', 'lookup_word', 'recommend_similar', 'memory_status'],
    buildBrief: ({ intent, plannerNote, userContent }) => ({
      system: [
        '你是 Researcher。只负责收集事实，不负责给最终长答案。',
        '你只能使用分配给你的工具范围。',
        intent.wantsExamples
          ? '这是场景例句任务。不要把中文功能词误当成查词目标，优先收集场景、语气、角色关系信息。'
          : intent.wantsPractice
            ? '这是练习设计任务。优先收集正确形式、常错点、练习所需事实。'
            : '这是查词/对比类任务。优先确认词义、用法、敬语差异和相关例句线索。',
        '如果涉及复习安排，可读取 memory_status。'
      ].join('\n'),
      user: `${userContent}\n\nPlanner 路由说明：${JSON.stringify(plannerNote, null, 2)}`
    }),
    planTools: ({ intent, message }) => {
      const lookupTargets = extractLookupTargets(message);
      const terms = lookupTargets.length > 0 ? lookupTargets : (intent?.terms || extractJapaneseTerms(message));
      const shouldLookupWords = !intent?.wantsExamples || terms.some(term => /[\p{Script=Hiragana}\p{Script=Katakana}ー]/u.test(term));
      return [
        ...(shouldLookupWords ? terms.slice(0, 3).map(word => ({ name: 'lookup_word', arguments: { word } })) : []),
        { name: 'external_search', arguments: { query: message } },
        ...(shouldLookupWords && terms[0] ? [{ name: 'recommend_similar', arguments: { word: terms[0] } }] : []),
        { name: 'memory_status', arguments: {} }
      ];
    }
  },
  example_designer: {
    label: 'Example Coach',
    allowedTools: [],
    buildBrief: ({ message, intent }) => buildExampleDesignerContext(message, intent)
  },
  practice_coach: {
    label: 'Practice Coach',
    allowedTools: [],
    buildBrief: ({ message, context }) => buildPracticeCoachContext(message, context)
  },
  tutor: {
    label: 'Tutor',
    allowedTools: [],
    buildBrief: ({ message, intent, plannerNote, subagentContexts }) => ([
      '你是 Tutor，负责把前面子链路收集的上下文转成最终回答。',
      '输出适合日语学习者阅读的 Markdown。',
      '必须包含：核心结论、结构化说明、误用提醒、下一步练习。',
      '不要向用户暴露 Planner、Researcher、Example Coach、Practice Coach 这些内部角色名，直接给出完成后的学习内容。',
      intent?.wantsExamples
        ? '这是场景例句请求，请直接满足场景表达任务，不要纠缠查词失败。'
        : intent?.wantsPractice
          ? '这是练习请求，请直接产出可执行的练习安排或练习内容。'
          : '这是查词/对比/解释请求，请优先基于查到的事实回答。',
      `Planner 路由：${JSON.stringify(plannerNote, null, 2)}`,
      subagentContexts?.example_designer ? `Example Coach brief：${JSON.stringify(subagentContexts.example_designer, null, 2)}` : '',
      subagentContexts?.practice_coach ? `Practice Coach brief：${JSON.stringify(subagentContexts.practice_coach, null, 2)}` : '',
      `最终要回答的问题：${message}`
    ].filter(Boolean).join('\n'))
  },
  memory_manager: {
    label: 'Memory Manager',
    allowedTools: ['memory_status'],
    buildBrief: ({ context }) => buildMemoryManagerContext(context)
  }
};

export function pickScopedTools(allowedTools = [], plannedTools = []) {
  if (!allowedTools || allowedTools.length === 0) return [];
  const allowed = new Set(allowedTools);
  return plannedTools.filter(tool => allowed.has(tool.name));
}
