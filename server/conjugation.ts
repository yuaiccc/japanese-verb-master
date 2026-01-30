// 动词类型
export type VerbType = 'GODAN' | 'ICHIDAN' | 'SURU' | 'KURU';

// 活用结果
export interface ConjugationResult {
  dictionaryForm: string;
  verbType: VerbType;
  negative: string;
  polite: string;
  teForm: string;
  taForm: string;
  potential: string;
  passive: string;
  causative: string;
  imperative: string;
  volitional: string;
}

// 动词类型信息
export interface VerbTypeInfo {
  id: VerbType;
  name: string;
  nameJa: string;
  description: string;
  endings: string[];
  examples: string[];
}

// 示例动词
export interface ExampleVerb {
  verb: string;
  type: VerbType;
  meaning: string;
  romaji: string;
}

// 动词类型列表
export const verbTypes: VerbTypeInfo[] = [
  {
    id: 'GODAN',
    name: '五段动词 (Group 1)',
    nameJa: '五段動詞',
    description: '词尾为う段假名的动词，活用时词尾会在五十音图的五个段之间变化',
    endings: ['う', 'く', 'ぐ', 'す', 'つ', 'ぬ', 'ぶ', 'む', 'る'],
    examples: ['飲む', '書く', '話す', '走る', '買う']
  },
  {
    id: 'ICHIDAN',
    name: '一段动词 (Group 2)',
    nameJa: '一段動詞',
    description: '词尾为「る」，且「る」前面是「い段」或「え段」假名的动词',
    endings: ['いる', 'える'],
    examples: ['食べる', '見る', '寝る', '起きる', '教える']
  },
  {
    id: 'SURU',
    name: 'サ变动词 (Group 3)',
    nameJa: 'サ行変格活用',
    description: '以「する」结尾的动词，通常是名词+する的形式',
    endings: ['する'],
    examples: ['勉強する', '仕事する', '運動する', '旅行する', '料理する']
  },
  {
    id: 'KURU',
    name: 'カ变动词 (Group 3)',
    nameJa: 'カ行変格活用',
    description: '只有「来る」一个动词，是不规则动词',
    endings: ['来る'],
    examples: ['来る', '持って来る', '連れて来る']
  }
];

// 示例动词库
export const exampleVerbs: ExampleVerb[] = [
  { verb: '飲む', type: 'GODAN', meaning: '喝', romaji: 'nomu' },
  { verb: '書く', type: 'GODAN', meaning: '写', romaji: 'kaku' },
  { verb: '話す', type: 'GODAN', meaning: '说', romaji: 'hanasu' },
  { verb: '買う', type: 'GODAN', meaning: '买', romaji: 'kau' },
  { verb: '走る', type: 'GODAN', meaning: '跑', romaji: 'hashiru' },
  { verb: '泳ぐ', type: 'GODAN', meaning: '游泳', romaji: 'oyogu' },
  { verb: '待つ', type: 'GODAN', meaning: '等待', romaji: 'matsu' },
  { verb: '死ぬ', type: 'GODAN', meaning: '死', romaji: 'shinu' },
  { verb: '遊ぶ', type: 'GODAN', meaning: '玩', romaji: 'asobu' },
  { verb: '読む', type: 'GODAN', meaning: '读', romaji: 'yomu' },
  { verb: '行く', type: 'GODAN', meaning: '去', romaji: 'iku' },
  { verb: '食べる', type: 'ICHIDAN', meaning: '吃', romaji: 'taberu' },
  { verb: '見る', type: 'ICHIDAN', meaning: '看', romaji: 'miru' },
  { verb: '寝る', type: 'ICHIDAN', meaning: '睡觉', romaji: 'neru' },
  { verb: '起きる', type: 'ICHIDAN', meaning: '起床', romaji: 'okiru' },
  { verb: '教える', type: 'ICHIDAN', meaning: '教', romaji: 'oshieru' },
  { verb: '勉強する', type: 'SURU', meaning: '学习', romaji: 'benkyou suru' },
  { verb: '仕事する', type: 'SURU', meaning: '工作', romaji: 'shigoto suru' },
  { verb: '運動する', type: 'SURU', meaning: '运动', romaji: 'undou suru' },
  { verb: '来る', type: 'KURU', meaning: '来', romaji: 'kuru' },
];

// 五段动词活用
function conjugateGodan(dictionaryForm: string): ConjugationResult {
  const stem = dictionaryForm.slice(0, -1);
  const lastChar = dictionaryForm[dictionaryForm.length - 1];

  const charMap: Record<string, Record<string, string>> = {
    'う': { a: 'わ', i: 'い', e: 'え', o: 'お' },
    'く': { a: 'か', i: 'き', e: 'け', o: 'こ' },
    'ぐ': { a: 'が', i: 'ぎ', e: 'げ', o: 'ご' },
    'す': { a: 'さ', i: 'し', e: 'せ', o: 'そ' },
    'つ': { a: 'た', i: 'ち', e: 'て', o: 'と' },
    'ぬ': { a: 'な', i: 'に', e: 'ね', o: 'の' },
    'ふ': { a: 'は', i: 'ひ', e: 'へ', o: 'ほ' },
    'ぶ': { a: 'ば', i: 'び', e: 'べ', o: 'ぼ' },
    'む': { a: 'ま', i: 'み', e: 'め', o: 'も' },
    'る': { a: 'ら', i: 'り', e: 'れ', o: 'ろ' }
  };

  const map = charMap[lastChar] || { a: '', i: '', e: '', o: '' };

  // て形/た形特殊规则
  let teForm: string, taForm: string;
  if (dictionaryForm === '行く') {
    teForm = stem + 'って';
    taForm = stem + 'った';
  } else {
    const teSuffixMap: Record<string, { te: string; ta: string }> = {
      'う': { te: 'って', ta: 'った' },
      'つ': { te: 'って', ta: 'った' },
      'る': { te: 'って', ta: 'った' },
      'む': { te: 'んで', ta: 'んだ' },
      'ぶ': { te: 'んで', ta: 'んだ' },
      'ぬ': { te: 'んで', ta: 'んだ' },
      'く': { te: 'いて', ta: 'いた' },
      'ぐ': { te: 'いで', ta: 'いだ' },
      'す': { te: 'して', ta: 'した' }
    };
    const suffix = teSuffixMap[lastChar] || { te: '', ta: '' };
    teForm = stem + suffix.te;
    taForm = stem + suffix.ta;
  }

  return {
    dictionaryForm,
    verbType: 'GODAN',
    negative: stem + map.a + 'ない',
    polite: stem + map.i + 'ます',
    teForm,
    taForm,
    potential: stem + map.e + 'る',
    passive: stem + map.a + 'れる',
    causative: stem + map.a + 'せる',
    imperative: stem + map.e,
    volitional: stem + map.o + 'う'
  };
}

// 一段动词活用
function conjugateIchidan(dictionaryForm: string): ConjugationResult {
  const stem = dictionaryForm.slice(0, -1);

  return {
    dictionaryForm,
    verbType: 'ICHIDAN',
    negative: stem + 'ない',
    polite: stem + 'ます',
    teForm: stem + 'て',
    taForm: stem + 'た',
    potential: stem + 'られる',
    passive: stem + 'られる',
    causative: stem + 'させる',
    imperative: stem + 'ろ',
    volitional: stem + 'よう'
  };
}

// サ变动词活用
function conjugateSuru(dictionaryForm: string): ConjugationResult {
  const prefix = dictionaryForm.slice(0, -2);

  return {
    dictionaryForm,
    verbType: 'SURU',
    negative: prefix + 'しない',
    polite: prefix + 'します',
    teForm: prefix + 'して',
    taForm: prefix + 'した',
    potential: prefix + 'できる',
    passive: prefix + 'される',
    causative: prefix + 'させる',
    imperative: prefix + 'しろ',
    volitional: prefix + 'しよう'
  };
}

// カ变动词活用
function conjugateKuru(dictionaryForm: string): ConjugationResult {
  const prefix = dictionaryForm.slice(0, -2);

  return {
    dictionaryForm,
    verbType: 'KURU',
    negative: prefix + 'こない',
    polite: prefix + 'きます',
    teForm: prefix + 'きて',
    taForm: prefix + 'きた',
    potential: prefix + 'こられる',
    passive: prefix + 'こられる',
    causative: prefix + 'こさせる',
    imperative: prefix + 'こい',
    volitional: prefix + 'こよう'
  };
}

// 主活用函数
export function conjugate(dictionaryForm: string, verbType: VerbType): ConjugationResult {
  switch (verbType) {
    case 'GODAN':
      return conjugateGodan(dictionaryForm);
    case 'ICHIDAN':
      return conjugateIchidan(dictionaryForm);
    case 'SURU':
      return conjugateSuru(dictionaryForm);
    case 'KURU':
      return conjugateKuru(dictionaryForm);
    default:
      throw new Error(`Unknown verb type: ${verbType}`);
  }
}
