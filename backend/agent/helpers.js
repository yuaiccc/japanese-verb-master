/**
 * Agent 辅助函数集合 —— 从 server.js 抽离。
 *
 * 包含：记忆候选、降级回答、难度解析、例句生成、句法标注、
 * 交互练习、线程摘要、追问建议、Agent Memory 抽取等纯逻辑函数。
 * 所有函数逻辑与原 server.js 保持一致，仅移动位置。
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as wanakana from 'wanakana';
import {
  callLlmText,
  getLlmProvider,
  getDefaultLlmModel,
  estimateChatTokens,
  getModelContextWindow,
  buildAgentRunTitle
} from '../llm/provider.js';
import { extractJapaneseTerms } from '../learningSubagents.js';
import { AGENT_MEMORY_TYPES, getMemorySettings } from '../db.js';
import { conjugate } from '../conjugationEngine.js';
import { getTokenizer } from '../tokenizer.js';
import { getSceneIdsForVerb, getVerbsForScene } from '../sceneData.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 读取动词库（buildVerbSimilarWords 依赖）
const commonVerbs = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'common-verbs.json'), 'utf8'));

export const formLabelMap = {
  negative: '否定式',
  polite: '礼貌式',
  teForm: 'て形',
  taForm: '过去式',
  potential: '可能形',
  passive: '被动形',
  causative: '使役形',
  imperative: '命令形',
  volitional: '意向形'
};

function getDateKey(value) {
  const date = new Date(value);
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

// 自动检测动词类型
export function detectVerbType(verb) {
  if (!getTokenizer()) throw new Error('Tokenizer not ready');

  // 处理罗马音输入，将其转换为平假名
  const hiraganaVerb = wanakana.toHiragana(verb);

  // 特殊情况硬编码：カ变动词（来る / くる）
  if (hiraganaVerb === 'くる' || hiraganaVerb === '来る') {
    return 'KURU';
  }

  const tokens = getTokenizer().tokenize(hiraganaVerb);
  if (tokens.length === 0) return null;

  // 对于像 勉強する 这样的词，动词部分在最后
  let verbToken = tokens.slice().reverse().find(t => t.pos === '動詞');

  // 如果没有找到动词，说明输入的词并不是一个有效的动词
  if (!verbToken) return null;

  // 严格匹配：确保输入的整个词就是一个动词，或者是以动词结尾的复合词（如勉強する）
  // 避免像 "tebe" 这种无意义的词被拆分成助词，或者被错误地当作动词的一部分
  // 检查提取出的动词原形（basic_form）是否能和输入的词（或其后缀）对得上
  // 因为像 `tabe` 提取出来 basic_form 是 `たべる`，如果输入只有 `tabe` 就不完整
  // 如果是复合动词如 `勉強する`，verbToken.surface_form 会是 `する`
  if (!hiraganaVerb.endsWith(verbToken.surface_form)) {
     return null;
  }
  // 还需要检查提取出的动词是否是一个完整的字典形（基本形）
  if (verbToken.conjugated_form && verbToken.conjugated_form !== '基本形') {
      return null;
  }

  const cType = verbToken.conjugated_type;
  if (cType.includes('一段')) return 'ICHIDAN';
  if (cType.includes('五段')) return 'GODAN';
  if (cType.includes('サ変')) return 'SURU';
  if (cType.includes('カ変')) return 'KURU';

  return null;
}

export function buildPracticeProfile(records) {
  const todayKey = getDateKey(new Date());
  const profile = {
    totalAttempts: records.length,
    accuracy: 0,
    todayAttempts: 0,
    avgDuration: 0,
    weakestForms: [],
    sceneStats: [],
    wrongBook: [],
    recommendation: '先完成一轮挑战，系统会开始生成你的长期学习画像。'
  };

  if (records.length === 0) {
    return profile;
  }

  const totalCorrect = records.filter(record => record.isCorrect).length;
  const totalDuration = records.reduce((sum, record) => sum + (record.durationMs || 0), 0);
  const formStats = new Map();
  const sceneStats = new Map();
  const wrongBookMap = new Map();

  profile.accuracy = Math.round((totalCorrect / records.length) * 100);
  profile.todayAttempts = records.filter(record => getDateKey(record.answeredAt) === todayKey).length;
  profile.avgDuration = Math.max(1, Math.round(totalDuration / records.length / 1000));

  for (const record of records) {
    if (!formStats.has(record.formKey)) {
      formStats.set(record.formKey, {
        key: record.formKey,
        label: formLabelMap[record.formKey] || record.formKey,
        attempts: 0,
        correct: 0
      });
    }
    if (!sceneStats.has(record.sceneId)) {
      sceneStats.set(record.sceneId, {
        id: record.sceneId,
        name: record.sceneName || '随机混合',
        attempts: 0,
        correct: 0
      });
    }

    formStats.get(record.formKey).attempts += 1;
    sceneStats.get(record.sceneId).attempts += 1;

    if (record.isCorrect) {
      formStats.get(record.formKey).correct += 1;
      sceneStats.get(record.sceneId).correct += 1;
    } else {
      const wrongKey = `${record.verb}::${record.formKey}`;
      if (!wrongBookMap.has(wrongKey)) {
        wrongBookMap.set(wrongKey, {
          verb: record.verb,
          formKey: record.formKey,
          formLabel: formLabelMap[record.formKey] || record.formKey,
          sceneId: record.sceneId,
          sceneName: record.sceneName || '随机混合',
          correctAnswer: record.correctAnswer,
          latestUserAnswer: record.userAnswer,
          wrongCount: 0,
          lastAnsweredAt: record.answeredAt
        });
      }
      const wrongItem = wrongBookMap.get(wrongKey);
      wrongItem.wrongCount += 1;
      if (new Date(record.answeredAt) >= new Date(wrongItem.lastAnsweredAt)) {
        wrongItem.latestUserAnswer = record.userAnswer;
        wrongItem.correctAnswer = record.correctAnswer;
        wrongItem.lastAnsweredAt = record.answeredAt;
      }
    }
  }

  profile.weakestForms = Array.from(formStats.values())
    .map(item => ({ ...item, accuracy: Math.round((item.correct / item.attempts) * 100) }))
    .sort((a, b) => a.accuracy - b.accuracy || b.attempts - a.attempts)
    .slice(0, 3);

  profile.sceneStats = Array.from(sceneStats.values())
    .map(item => ({ ...item, accuracy: Math.round((item.correct / item.attempts) * 100) }))
    .sort((a, b) => a.accuracy - b.accuracy || b.attempts - a.attempts)
    .slice(0, 5);

  profile.wrongBook = Array.from(wrongBookMap.values())
    .sort((a, b) => b.wrongCount - a.wrongCount || new Date(b.lastAnsweredAt) - new Date(a.lastAnsweredAt))
    .slice(0, 8);

  const weakestScene = profile.sceneStats[0];
  const weakestForm = profile.weakestForms[0];
  if (weakestScene && weakestForm) {
    profile.recommendation = `建议先练「${weakestScene.name}」场景，并重点巩固${weakestForm.label}。错题本里优先复习最近常错项。`;
  } else if (weakestForm) {
    profile.recommendation = `建议先专项训练${weakestForm.label}，并复习错题本里的高频错误。`;
  }

  return profile;
}

export function buildVerbSimilarWords(lookup, limit = 8) {
  const sceneIds = getSceneIdsForVerb(lookup.word);
  const sameScene = sceneIds.flatMap(id => getVerbsForScene(commonVerbs, id));
  const source = sameScene.length > 0 ? sameScene : commonVerbs;
  const sameType = [];
  const others = [];

  for (const item of source) {
    if (item.kanji === lookup.word || item.kana === lookup.reading) continue;
    const reasonParts = [];
    if (sceneIds.some(id => getSceneIdsForVerb(item.kanji).includes(id))) {
      reasonParts.push('同场景高频动词');
    }
    if (lookup.reading && item.kana?.[0] === lookup.reading[0]) {
      reasonParts.push('读音接近');
    }

    const entry = {
      kanji: item.kanji,
      kana: item.kana,
      romaji: item.romaji,
      meaning: item.meaning,
      wordType: 'verb',
      reason: reasonParts.slice(0, 2).join('、') || '适合作为动词扩展'
    };

    try {
      const type = getTokenizer() ? detectVerbType(item.kana) : '';
      if (type === lookup.verbType) {
        sameType.push({ ...entry, reason: `${entry.reason}、同类活用` });
      } else {
        others.push(entry);
      }
    } catch (e) {
      others.push(entry);
    }
  }

  const seen = new Set();
  return [...sameType, ...others].filter(item => {
    if (seen.has(item.kanji)) return false;
    seen.add(item.kanji);
    return true;
  }).slice(0, limit);
}

export function memoryCandidatesFromToolResult(toolName, result) {
  if (!result || result.error) return [];
  if (toolName === 'lookup_word') {
    const item = result.source === 'local' ? result : result.result;
    if (!item) return [];
    const word = item.kanji || item.word || '';
    if (!word) return [];
    const meaning = item.meaning || item.meanings?.[0]?.definitions || '';
    return [{
      word,
      reading: item.kana || item.reading || '',
      meaning,
      wordType: item.wordType || 'other',
      source: 'agent-lookup'
    }];
  }
  if (toolName === 'recommend_similar' && Array.isArray(result)) {
    return result.slice(0, 6).map(item => ({
      word: item.kanji || item.word || '',
      reading: item.kana || item.reading || '',
      meaning: item.meaning || '',
      wordType: item.wordType || 'other',
      source: 'agent-similar'
    })).filter(item => item.word);
  }
  return [];
}

export function dedupeMemoryCandidates(candidates = []) {
  const seen = new Set();
  return candidates.filter(item => {
    const key = `${item.word}-${item.reading}`;
    if (!item.word || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 8);
}

export function buildFallbackTutorAnswer(message, toolCalls = []) {
  const lookupSummaries = toolCalls
    .filter(call => call.name === 'lookup_word')
    .map(call => {
      const word = call.arguments?.word || '目标词';
      return `- **${word}**：${call.result || '未找到明确词典结果。'}`;
    })
    .join('\n');
  const usedTools = toolCalls.map(call => `\`${call.name}\``).join('、') || '本地规则';

  return `## 核心结论
这次问题是：${message}

Researcher 已调用 ${usedTools} 收集资料。DeepSeek 流式生成暂时超时，所以先给出稳定版学习摘要。

## 工具结果
${lookupSummaries || '- 已执行外部检索和记忆状态检查，等待模型恢复后可生成更完整解释。'}

## 下一步练习
1. 把目标词各造一个日语例句。
2. 标出普通说法、敬语说法和不能用于自己的表达。
3. 把容易混淆的词加入记忆卡片，明天复习。`;
}

export function extractFirstJsonObject(text = '') {
  const trimmed = String(text || '').trim();
  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = fencedMatch ? fencedMatch[1].trim() : trimmed;
  const firstBrace = candidate.indexOf('{');
  const lastBrace = candidate.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) return null;
  const jsonSlice = candidate.slice(firstBrace, lastBrace + 1);
  try {
    return JSON.parse(jsonSlice);
  } catch {
    return null;
  }
}

export function normalizeJlptLevel(raw = '') {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const text = String(value || '').trim().toUpperCase();
  const match = text.match(/N[1-5]/);
  return match ? match[0] : '';
}

export function resolveDifficultyLevel({
  requested = 'auto',
  lookup = null,
  memoryCandidates = []
} = {}) {
  const normalizedRequested = String(requested || 'auto').trim();
  if (normalizedRequested && normalizedRequested !== 'auto') {
    const explicit = normalizeJlptLevel(normalizedRequested);
    return explicit || 'N3';
  }

  const lookupLevel = normalizeJlptLevel(lookup?.jlpt);
  if (lookupLevel) return lookupLevel;

  for (const item of memoryCandidates) {
    const candidateLevel = normalizeJlptLevel(item?.jlpt);
    if (candidateLevel) return candidateLevel;
  }

  return 'N3';
}

export function buildDifficultyInstruction(level = 'N3') {
  const instructions = {
    N5: '使用最基础、最短的句式，优先日常词汇，避免从句、被动、使役、敬语嵌套。',
    N4: '保持句式简单自然，可加入少量常见补语，但避免明显超纲表达。',
    N3: '允许常见复合句和场景表达，保持清楚易懂，不要过度书面化。',
    N2: '可以使用更自然的书面/会话表达，允许适度复杂句，但仍需便于学习者拆解。',
    N1: '可以使用更成熟自然的复杂表达、书面感和语气变化，但要保持例句可分析。'
  };
  return instructions[level] || instructions.N3;
}

export function normalizeAgentExamples(items = []) {
  return items
    .filter(item => item && (item.japanese || item.kana || item.chinese))
    .map(item => ({
      japanese: String(item.japanese || '').trim(),
      kana: String(item.kana || '').trim(),
      chinese: String(item.chinese || '').trim(),
      components: Array.isArray(item.components)
        ? item.components
          .map(part => ({
            label: String(part?.label || '').trim(),
            text: String(part?.text || '').trim()
          }))
          .filter(part => part.label && part.text)
        : []
    }))
    .filter(item => item.japanese && item.chinese)
    .map(item => ({
      ...item,
      components: item.components.length > 0 ? item.components : annotateSentenceComponents(item.japanese)
    }))
    .slice(0, 3);
}

export function buildFallbackAgentExamples({ message, memoryCandidates = [], difficultyLevel = 'N3' }) {
  const source = memoryCandidates.length > 0
    ? memoryCandidates
    : extractJapaneseTerms(message).slice(0, 3).map(word => ({ word, reading: '' }));

  const examples = source.slice(0, 3).map((item, index) => {
    const word = item.word || 'この表現';
    const reading = item.reading || word;
    const templatesByDifficulty = {
      N5: [
        {
          japanese: `わたしは ${word} を つかいます。`,
          kana: `わたしは ${reading} を つかいます。`,
          chinese: `我会使用“${word}”。`
        },
        {
          japanese: `きょう ${word} を れんしゅうします。`,
          kana: `きょう ${reading} を れんしゅうします。`,
          chinese: `今天我来练习“${word}”。`
        }
      ],
      N4: [
        {
          japanese: `会話では「${word}」をよく使います。`,
          kana: `かいわでは「${reading}」をよくつかいます。`,
          chinese: `在会话里经常会用到“${word}”。`
        },
        {
          japanese: `授業で「${word}」を使って文を作りました。`,
          kana: `じゅぎょうで「${reading}」をつかってぶんをつくりました。`,
          chinese: `上课时我用“${word}”造了句子。`
        }
      ],
      N3: [
        {
          japanese: `会話では「${word}」のほうが自然に聞こえることがあります。`,
          kana: `かいわでは「${reading}」のほうがしぜんにきこえることがあります。`,
          chinese: `在会话里，“${word}”有时听起来会更自然。`
        },
        {
          japanese: `授業のあとで、「${word}」を使って短い文を作ってみました。`,
          kana: `じゅぎょうのあとで、「${reading}」をつかってみじかいぶんをつくってみました。`,
          chinese: `课后我试着用“${word}”造了一个短句。`
        },
        {
          japanese: `この場面では「${word}」と似た表現の違いも意識すると覚えやすいです。`,
          kana: `このばめんでは「${reading}」とにたひょうげんのちがいもいしきするとおぼえやすいです。`,
          chinese: `在这个场景里，顺便注意“${word}”和近义表达的区别会更容易记住。`
        }
      ]
    };
    const templates = templatesByDifficulty[difficultyLevel] || templatesByDifficulty.N3;
    const fallbackTemplates = [
      {
        japanese: `この場面では「${word}」を自然に使えると表現の幅が広がります。`,
        kana: `このばめんでは「${reading}」をしぜんにつかえるとひょうげんのはばがひろがります。`,
        chinese: `在这个场景里能自然使用“${word}”，表达会更丰富。`
      },
      {
        japanese: `「${word}」を使って自分の例文を一つ作ると覚えやすいです。`,
        kana: `「${reading}」をつかってじぶんのれいぶんをひとつつくるとおぼえやすいです。`,
        chinese: `自己用“${word}”造一个句子会更容易记住。`
      }
    ];
    return [...templates, ...fallbackTemplates][index % [...templates, ...fallbackTemplates].length];
  });

  return normalizeAgentExamples(examples);
}

export function pickPracticeForm(message = '') {
  const formCandidates = [
    { key: 'teForm', label: formLabelMap.teForm, tests: [/て形/, /て-form/i] },
    { key: 'taForm', label: formLabelMap.taForm, tests: [/过去式/, /た形/, /past/i] },
    { key: 'negative', label: formLabelMap.negative, tests: [/否定/, /ない形/, /negative/i] },
    { key: 'polite', label: formLabelMap.polite, tests: [/礼貌/, /ます形/, /polite/i] },
    { key: 'potential', label: formLabelMap.potential, tests: [/可能/, /can\b/i] },
    { key: 'passive', label: formLabelMap.passive, tests: [/被动/] },
    { key: 'causative', label: formLabelMap.causative, tests: [/使役/] },
    { key: 'imperative', label: formLabelMap.imperative, tests: [/命令/] },
    { key: 'volitional', label: formLabelMap.volitional, tests: [/意向/] }
  ];
  const matched = formCandidates.find(item => item.tests.some(test => test.test(message)));
  return matched || { key: 'teForm', label: formLabelMap.teForm };
}

export function inferMarkedRole(text = '', marker = '') {
  const trimmed = String(text || '').trim();
  if (!trimmed || !marker) return '补足';
  const timePattern = /(今日|きょう|明日|あした|昨日|きのう|今朝|けさ|今晩|こんばん|毎日|まいにち|毎週|毎月|毎年|週末|しゅうまつ|朝|昼|夜|時|分|月|年|曜日)$/;
  const locationPattern = /(学校|がっこう|会社|かいしゃ|店|みせ|コンビニ|駅|えき|家|いえ|うち|教室|きょうしつ|部屋|へや|日本|にほん|東京|とうきょう|レストラン|スーパー)$/;

  switch (marker) {
    case 'は':
      return '主题';
    case 'も':
      return '追加主题';
    case 'が':
      return '主语';
    case 'を':
      return '宾语';
    case 'へ':
      return '方向';
    case 'と':
      return '对象/并列';
    case 'から':
      return '起点/原因';
    case 'まで':
      return '终点';
    case 'より':
      return '比较基准';
    case 'に':
      if (timePattern.test(trimmed)) return '时间';
      if (locationPattern.test(trimmed)) return '地点';
      return '补语';
    case 'で':
      if (locationPattern.test(trimmed)) return '地点/方式';
      return '方式/场所';
    default:
      return '补足';
  }
}

export function inferPredicateStart(tokens = []) {
  for (let index = tokens.length - 1; index >= 0; index -= 1) {
    const token = tokens[index];
    const pos = token?.pos || '';
    const surface = token?.surface_form || '';
    if (['動詞', '形容詞', '助動詞'].includes(pos)) {
      let start = index;
      while (start > 0) {
        const previousPos = tokens[start - 1]?.pos || '';
        if (!['動詞', '形容詞', '助動詞'].includes(previousPos)) break;
        start -= 1;
      }
      return start;
    }
    if (surface && ['です', 'だ', 'でした', 'ます', 'ません', 'ください'].includes(surface)) {
      let start = Math.max(0, index - 1);
      while (start > 0) {
        const previousPos = tokens[start - 1]?.pos || '';
        if (!['動詞', '形容詞', '助動詞'].includes(previousPos)) break;
        start -= 1;
      }
      return start;
    }
  }
  return -1;
}

export function annotateSentenceComponents(sentence = '') {
  if (!getTokenizer() || !sentence) return [];

  try {
    const tokens = getTokenizer().tokenize(sentence).filter(token => token?.surface_form);
    if (tokens.length === 0) return [];

    const predicateStart = inferPredicateStart(tokens);
    const components = [];
    const appendComponent = (label, text) => {
      const normalizedText = String(text || '').trim();
      if (!label || !normalizedText) return;
      const previous = components.at(-1);
      if (previous && previous.label === label) {
        previous.text = `${previous.text}${normalizedText}`;
        return;
      }
      components.push({ label, text: normalizedText });
    };

    const boundary = predicateStart >= 0 ? predicateStart : tokens.length;
    let buffer = [];

    for (let index = 0; index < boundary; index += 1) {
      const token = tokens[index];
      buffer.push(token);
      if (token.pos === '助詞' && ['は', 'も', 'が', 'を', 'に', 'へ', 'で', 'と', 'から', 'まで', 'より'].includes(token.surface_form)) {
        const phraseTokens = buffer.slice(0, -1);
        const phrase = phraseTokens.map(item => item.surface_form).join('');
        const marker = token.surface_form;
        appendComponent(inferMarkedRole(phrase, marker), `${phrase}${marker}`);
        buffer = [];
      }
    }

    if (buffer.length > 0) {
      appendComponent('补足', buffer.map(item => item.surface_form).join(''));
    }

    if (predicateStart >= 0) {
      appendComponent('谓语', tokens.slice(predicateStart).map(item => item.surface_form).join(''));
    }

    return components.slice(0, 6);
  } catch (error) {
    return [];
  }
}

export function shouldOfferInteractivePractice({ message = '', context = {}, memoryCandidates = [] }) {
  const lowered = String(message || '').toLowerCase();
  if (/readme|github|repo|sse|langgraph|api|prompt|system prompt|架构|bug|样式|前端|后端|页面|模型|provider|llm|deepseek|openai|tavily/.test(lowered)) {
    return false;
  }
  if (context.lookup?.wordType === 'verb') return true;
  if (memoryCandidates.some(item => item.wordType === 'verb' || detectVerbType(item.reading || item.word || ''))) return true;
  if ((context.intent?.terms || []).some(term => detectVerbType(term))) return true;
  return extractJapaneseTerms(message).some(term => detectVerbType(term));
}

export function buildInteractivePractice({ message = '', intent = {}, context = {}, memoryCandidates = [] }) {
  if (!shouldOfferInteractivePractice({ message, context: { ...context, intent }, memoryCandidates })) return null;

  const sourceLookup = context.lookup?.wordType === 'verb' ? context.lookup : null;
  const candidateWord = sourceLookup?.dictionaryForm
    || sourceLookup?.parsedAs
    || sourceLookup?.word
    || memoryCandidates.find(item => detectVerbType(item.reading || item.word))?.reading
    || intent.terms?.find(term => detectVerbType(term))
    || null;

  if (!candidateWord) return null;

  const normalizedVerb = wanakana.toHiragana(candidateWord);
  const verbType = detectVerbType(normalizedVerb);
  if (!verbType) return null;

  try {
    const conjugation = conjugate(normalizedVerb, verbType);
    const form = pickPracticeForm(message);
    const answer = conjugation[form.key];
    if (!answer) return null;
    const difficultyLevel = resolveDifficultyLevel({
      requested: context.exampleDifficulty || getMemorySettings().exampleDifficulty,
      lookup: sourceLookup,
      memoryCandidates
    });
    const options = buildPracticeOptions(conjugation, form.key, answer, difficultyLevel);
    const displayVerb = sourceLookup?.dictionaryForm || sourceLookup?.word || sourceLookup?.parsedAs || candidateWord;
    return {
      mode: 'agent_practice',
      prompt: `「${displayVerb}」的 ${form.label} 是哪一个？`,
      question: {
        verb: displayVerb,
        reading: sourceLookup?.reading || normalizedVerb,
        meaning: sourceLookup?.meaning || context.lookup?.meaning || '',
        romaji: sourceLookup?.romaji || '',
        verbType,
        wordType: 'verb',
        formKey: form.key,
        formLabel: form.label,
        answer,
        options,
        difficultyLevel,
        jlpt: normalizeJlptLevel(sourceLookup?.jlpt),
        sceneId: 'agent-practice',
        sceneName: 'Agent 练习'
      }
    };
  } catch (error) {
    return null;
  }
}

export function buildFallbackFollowUpQuestions({ intent = {}, context = {}, memoryCandidates = [] }) {
  const focusWord = context.lookup?.dictionaryForm || context.lookup?.word || memoryCandidates[0]?.word || '这个表达';

  if (intent?.wantsExamples) {
    return [
      `把这些例句改成更礼貌的说法`,
      `再给我3个更口语的${focusWord}场景`,
      `把这些例句改成填空练习`
    ];
  }

  if (intent?.wantsPractice) {
    return [
      `为什么这题要这样变形`,
      `再给我一个类似难度的练习`,
      `顺便比较一下相关变形区别`
    ];
  }

  return [
    `再给我3个${focusWord}的场景例句`,
    `把${focusWord}和相近表达做个对比`,
    `基于${focusWord}给我出一道小练习`
  ];
}

export function stripMarkdownCodeFence(text = '') {
  const stripped = String(text || '').trim();
  if (!stripped.startsWith('```')) return stripped;
  const lines = stripped.split('\n');
  if (lines.length >= 3 && lines[0].startsWith('```') && lines.at(-1)?.startsWith('```')) {
    return lines.slice(1, -1).join('\n').trim();
  }
  return stripped;
}

export function parseJsonStringList(text = '') {
  const candidate = stripMarkdownCodeFence(text);
  const arrayStart = candidate.indexOf('[');
  const arrayEnd = candidate.lastIndexOf(']');
  if (arrayStart === -1 || arrayEnd === -1 || arrayEnd <= arrayStart) return null;
  try {
    const parsed = JSON.parse(candidate.slice(arrayStart, arrayEnd + 1));
    if (!Array.isArray(parsed)) return null;
    return parsed
      .map(item => String(item || '').trim())
      .filter(Boolean);
  } catch (error) {
    return null;
  }
}

export function formatSuggestionConversation(conversation = []) {
  return conversation
    .map((item) => {
      const role = item?.role === 'assistant' ? 'Assistant' : 'User';
      return `${role}: ${String(item?.content || '').trim()}`;
    })
    .filter(Boolean)
    .join('\n')
    .trim();
}

export function compactConversationTurns(conversation = [], keepTail = 4) {
  const safeConversation = Array.isArray(conversation) ? conversation : [];
  const normalized = safeConversation
    .map((item) => ({
      role: item?.role === 'assistant' ? 'assistant' : 'user',
      content: String(item?.content || '').trim()
    }))
    .filter(item => item.content)
    .map(item => ({ ...item, content: item.content.slice(0, 320) }));

  if (normalized.length <= keepTail) {
    return {
      recentConversation: normalized,
      olderConversationDigest: '',
      compactedTurnCount: 0
    };
  }

  const older = normalized.slice(0, -keepTail);
  const recentConversation = normalized.slice(-keepTail);
  const olderConversationDigest = older
    .map(item => `${item.role === 'assistant' ? 'Assistant' : 'User'}: ${item.content}`)
    .join('\n')
    .slice(0, 1600);

  return {
    recentConversation,
    olderConversationDigest,
    compactedTurnCount: older.length
  };
}

export function isCompactFocusWord(word = '') {
  const value = String(word || '').trim();
  if (!value) return false;
  if (value.length < 2) return false;
  if (!/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー]/u.test(value)) return false;
  const denied = new Set(['がる', 'する']);
  return !denied.has(value);
}

export function normalizeThreadTopic(topic = '') {
  return String(topic || '')
    .replace(/\s+/g, '')
    .replace(/[.…]{2,}$/g, '')
    .trim();
}

export async function buildThreadSummary(userStore, { userId, currentRunId = '', threadId = '', limit = 10 } = {}) {
  const runs = (await userStore.listAgentRuns({ userId, threadId, limit: limit + 2 }))
    .filter(run => run.runId !== currentRunId)
    .filter(run => ['completed', 'cancelled', 'failed'].includes(run.status))
    .slice(0, limit);

  const seenTopics = new Set();
  const topics = runs
    .map(run => run.title || buildAgentRunTitle(run.question || ''))
    .filter(Boolean)
    .filter((topic) => {
      const normalized = normalizeThreadTopic(topic);
      if (!normalized || seenTopics.has(normalized)) return false;
      seenTopics.add(normalized);
      return true;
    })
    .slice(0, 8);

  const focusWords = [...new Set(runs.flatMap(run => run.metadata?.compactEntry?.focusWords || []))]
    .filter(isCompactFocusWord)
    .slice(0, 12);

  const practiceFocuses = runs
    .map(run => run.metadata?.compactEntry?.practiceFocus || '')
    .filter(Boolean)
    .filter((item, index, source) => source.indexOf(item) === index)
    .slice(0, 6);

  const seenSummaryTitles = new Set();
  const latestSummaries = runs
    .map(run => {
      const summary = String(run.metadata?.compactEntry?.summary || run.summary || '').trim();
      if (!summary) return '';
      const title = run.title || buildAgentRunTitle(run.question || '');
      const normalizedTitle = normalizeThreadTopic(title);
      if (!normalizedTitle || seenSummaryTitles.has(normalizedTitle)) return '';
      seenSummaryTitles.add(normalizedTitle);
      return `${title}：${summary}`.slice(0, 140);
    })
    .filter(Boolean)
    .slice(0, 5);

  return {
    runCount: runs.length,
    topics,
    focusWords,
    practiceFocuses,
    latestSummaries,
    digest: latestSummaries.join('\n').slice(0, 900)
  };
}

export function buildRunCompactEntry({ message = '', intent = {}, context = {}, finalState = {} }) {
  const focusWords = [
    context.lookup?.word,
    ...(Array.isArray(finalState.memoryCandidates) ? finalState.memoryCandidates.map(item => item.word) : [])
  ]
    .map(item => String(item || '').trim())
    .filter(isCompactFocusWord)
    .filter((item, index, source) => source.indexOf(item) === index)
    .slice(0, 6);

  const exampleHighlights = Array.isArray(finalState.structuredExamples)
    ? finalState.structuredExamples
      .map(item => String(item?.japanese || '').trim())
      .filter(Boolean)
      .slice(0, 2)
    : [];

  return {
    title: buildAgentRunTitle(message),
    intentType: intent?.type || 'lookup',
    focusWords,
    practiceFocus: finalState.interactivePractice?.question?.formLabel || '',
    summary: String(finalState.finalAnswer || '').replace(/\s+/g, ' ').trim().slice(0, 320),
    exampleHighlights
  };
}

export async function buildPersistedCompactSummary(userStore, { userId, currentRunId = '', threadId = '', conversation = [], model = '' } = {}) {
  const threadSummary = await buildThreadSummary(userStore, { userId, currentRunId, threadId, limit: 8 });
  const conversationCompact = compactConversationTurns(conversation, 4);
  const rawConversation = Array.isArray(conversation) ? conversation : [];
  const rawConversationTokens = estimateChatTokens(
    rawConversation.map(item => ({
      role: item?.role || 'user',
      content: String(item?.content || '').slice(0, 600)
    })),
    model || getDefaultLlmModel()
  );
  const threadDigestTokens = estimateChatTokens([
    {
      role: 'system',
      content: `${threadSummary.digest}\n${threadSummary.focusWords.join('、')}\n${threadSummary.practiceFocuses.join('、')}`
    }
  ], model || getDefaultLlmModel());
  const contextWindow = getModelContextWindow(model || getDefaultLlmModel());
  const estimatedRatio = contextWindow > 0 ? (rawConversationTokens + threadDigestTokens) / contextWindow : 0;

  let mode = 'none';
  if (rawConversation.length > 10 || estimatedRatio >= 0.35) {
    mode = 'aggressive';
  } else if (rawConversation.length > 6 || estimatedRatio >= 0.18 || threadSummary.runCount >= 4) {
    mode = 'standard';
  } else if (rawConversation.length > 4 || estimatedRatio >= 0.08 || threadSummary.runCount >= 2) {
    mode = 'light';
  }

  const applied = mode !== 'none';
  const recentConversation = !applied
    ? rawConversation
      .slice(-6)
      .map(item => ({
        role: item?.role === 'assistant' ? 'assistant' : 'user',
        content: String(item?.content || '').trim().slice(0, 320)
      }))
      .filter(item => item.content)
    : conversationCompact.recentConversation;

  const persistedRunCount = mode === 'none'
    ? 0
    : mode === 'light'
      ? Math.min(2, threadSummary.runCount)
      : mode === 'standard'
        ? Math.min(5, threadSummary.runCount)
        : threadSummary.runCount;

  const focusWords = threadSummary.focusWords.slice(
    0,
    mode === 'aggressive' ? 10 : mode === 'standard' ? 8 : 5
  );
  const recentTopics = threadSummary.topics.slice(
    0,
    mode === 'aggressive' ? 6 : mode === 'standard' ? 5 : 3
  );
  const practiceFocuses = threadSummary.practiceFocuses.slice(
    0,
    mode === 'aggressive' ? 5 : 3
  );
  const historicalDigest = applied
    ? threadSummary.latestSummaries
      .slice(0, mode === 'aggressive' ? 5 : mode === 'standard' ? 4 : 2)
      .join('\n')
    : '';

  return {
    applied,
    mode,
    estimatedRatio: Number(estimatedRatio.toFixed(4)),
    estimatedInputTokens: rawConversationTokens + threadDigestTokens,
    recentConversation,
    olderConversationDigest: applied ? conversationCompact.olderConversationDigest : '',
    compactedTurnCount: applied ? conversationCompact.compactedTurnCount : 0,
    persistedRunCount,
    recentTopics,
    focusWords,
    practiceFocuses,
    historicalDigest: historicalDigest.slice(0, 900),
    threadSummary
  };
}

export async function generateFollowUpQuestions({ message = '', finalAnswer = '', intent = {}, context = {}, memoryCandidates = [] }) {
  const fallback = buildFallbackFollowUpQuestions({ intent, context, memoryCandidates });
  const conversation = Array.isArray(context.conversation) ? context.conversation.slice(-6) : [];
  const conversationText = formatSuggestionConversation([
    ...conversation,
    { role: 'user', content: message },
    { role: 'assistant', content: finalAnswer }
  ]);

  if (getLlmProvider() === 'ollama') {
    return fallback;
  }

  try {
    const text = await callLlmText({
      messages: [
        {
          role: 'system',
          content: [
            '你是日语学习产品里的追问建议器。',
            '请基于最近完整对话，生成 EXACTLY 3 个用户下一步最可能继续问的问题。',
            '要求：',
            '- 必须和刚刚这轮具体内容强相关，不能泛泛而谈',
            '- 必须使用和用户相同的语言',
            '- 每条尽量简短自然，不超过 40 个汉字',
            '- 三条问题的方向要有差异，例如例句/对比/练习/误用/场景',
            '- 不要编号，不要 markdown，不要解释',
            '- 输出必须是 JSON 数组，例如 ["问题1","问题2","问题3"]'
          ].join('\n')
        },
        {
          role: 'user',
          content: [
            'Conversation Context:',
            conversationText || `User: ${message}\nAssistant: ${finalAnswer.slice(0, 1200)}`,
            '',
            `Intent: ${intent?.type || 'lookup'}`,
            `Lookup Focus: ${JSON.stringify(context.lookup || null)}`,
            `Memory Candidates: ${JSON.stringify(memoryCandidates.slice(0, 4))}`,
            '',
            'Generate 3 follow-up questions.'
          ].join('\n')
        }
      ],
      model: getDefaultLlmModel(),
      temperature: 0.7,
      maxTokens: 220
    });

    const items = parseJsonStringList(text) || [];
    const normalized = [...new Set(items
      .map(item => String(item || '').replace(/\s+/g, ' ').trim())
      .filter(Boolean)
    )].slice(0, 3);

    return normalized.length === 3 ? normalized : fallback;
  } catch (error) {
    return fallback;
  }
}

// Agent Memory 抽取（写路径）：run 结束时判断本轮有没有值得长期记的用户信息。
// 借鉴 mem0 的"抽原子事实"：只抽稳定的目标/偏好/事实/长期任务，不抽一次性问答内容。
// 返回 [{ type, mkey, value }]；ollama 或异常时返回 []（不阻塞主流程）。
export async function extractAgentMemoryCandidates({ message = '', finalAnswer = '' }) {
  if (getLlmProvider() === 'ollama' || !message.trim()) return [];
  try {
    const text = await callLlmText({
      messages: [
        {
          role: 'system',
          content: [
            '你是日语学习产品的「长期记忆抽取器」。从这一轮对话里抽取**关于用户本人、值得跨会话长期记住**的信息。',
            '只抽稳定信息，分四类（type）：',
            '- goal：学习目标（如"备考 N2"、"想练商务日语"）',
            '- preference：偏好（如"例句要商务场景"、"解释要简短"、"先给假名"）',
            '- fact：关于用户的事实（如"母语中文"、"在日企做开发"）',
            '- task：正在推进的长期任务（如"系统过一遍 N2 语法点"）',
            '严格要求：',
            '- 只抽用户**明确表达或强暗示**的，不要臆测、不要把一次性的查词问题当记忆',
            '- 每条给一个稳定的英文 snake_case 归一化键 mkey（如 jlpt_target / example_style / native_lang），同类信息复用同一 mkey',
            '- value 用简短中文陈述句',
            '- 没有值得记的就返回空数组',
            '- 只输出 JSON 数组：[{"type":"goal","mkey":"jlpt_target","value":"备考 N2"}]'
          ].join('\n')
        },
        {
          role: 'user',
          content: `User: ${String(message).slice(0, 800)}\nAssistant: ${String(finalAnswer).slice(0, 800)}\n\n抽取长期记忆条目（JSON 数组，没有则 []）。`
        }
      ],
      model: getDefaultLlmModel(),
      temperature: 0.2,
      maxTokens: 320,
      responseFormat: { type: 'json_object' }
    });

    let parsed = [];
    try {
      const obj = JSON.parse(text);
      parsed = Array.isArray(obj) ? obj : (Array.isArray(obj.items) ? obj.items : (Array.isArray(obj.memories) ? obj.memories : []));
    } catch (e) {
      parsed = [];
    }
    return parsed
      .filter(item => item && AGENT_MEMORY_TYPES.includes(String(item.type)) && item.mkey && item.value)
      .map(item => ({
        type: String(item.type),
        mkey: String(item.mkey).trim().toLowerCase().slice(0, 60),
        value: String(item.value).replace(/\s+/g, ' ').trim().slice(0, 280)
      }))
      .slice(0, 6);
  } catch (error) {
    return [];
  }
}

// 用同一动词的其他活用形作为干扰项——并根据难度控制"迷惑程度"。
export function buildPracticeOptions(conjugation, answerKey, answer, difficultyLevel = 'N3') {
  const distractorPools = {
    N5: ['taForm', 'negative', 'polite', 'teForm'],
    N4: ['taForm', 'negative', 'polite', 'potential', 'teForm'],
    N3: ['taForm', 'negative', 'polite', 'potential', 'passive', 'teForm'],
    N2: ['taForm', 'negative', 'polite', 'potential', 'passive', 'causative', 'volitional', 'teForm'],
    N1: ['taForm', 'negative', 'polite', 'potential', 'passive', 'causative', 'volitional', 'imperative', 'teForm']
  };
  const distractorKeys = distractorPools[difficultyLevel] || distractorPools.N3;
  const seen = new Set([answer]);
  const distractors = [];
  for (const key of distractorKeys) {
    if (key === answerKey) continue;
    const value = conjugation[key];
    if (value && !seen.has(value)) {
      seen.add(value);
      distractors.push(value);
    }
    if (distractors.length >= 3) break;
  }
  const options = [answer, ...distractors];
  // Fisher–Yates 洗牌，避免正确答案总在首位。
  for (let i = options.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [options[i], options[j]] = [options[j], options[i]];
  }
  return options;
}

export async function generateStructuredAgentExamples({ message, finalAnswer, toolCalls, memoryCandidates = [], context = {} }) {
  const memorySettings = getMemorySettings();
  const exampleDifficulty = resolveDifficultyLevel({
    requested: memorySettings.exampleDifficulty || 'auto',
    lookup: context.lookup || null,
    memoryCandidates
  });
  const prompt = `你是日语学习应用里的 Example Composer。
请根据用户问题、Agent 最终回答、以及工具结果，输出 2 到 3 条适合学习者复习的例句。

要求：
1. 只输出 JSON，不要输出任何额外说明。
2. JSON 结构固定为：
{
  "examples": [
    { "japanese": "日文原句", "kana": "平假名注音", "chinese": "中文翻译" }
  ]
}
3. 例句必须自然、日常、和当前问题高度相关。
4. kana 必须是完整平假名，不要留空。
5. chinese 要简洁、准确。
6. 例句难度设定：严格按 JLPT ${exampleDifficulty} 学习者可理解的难度来写，避免明显超纲表达。
7. 难度控制说明：${buildDifficultyInstruction(exampleDifficulty)}`;

  const text = await callLlmText({
    messages: [
      { role: 'system', content: prompt },
      {
        role: 'user',
        content: JSON.stringify({
          message,
          finalAnswer,
          toolCalls: toolCalls.map(call => ({
            name: call.name,
            arguments: call.arguments,
            result: call.result
          })),
          exampleDifficulty
        })
      }
    ],
    model: getDefaultLlmModel(),
    temperature: 0.2,
    maxTokens: 420,
    responseFormat: getLlmProvider() === 'ollama' ? undefined : { type: 'json_object' }
  });

  const parsed = extractFirstJsonObject(text);
  const normalized = normalizeAgentExamples(parsed?.examples || []);
  return normalized.length > 0
    ? normalized
    : buildFallbackAgentExamples({ message, memoryCandidates, difficultyLevel: exampleDifficulty });
}
