// 动词接口
class Verb {
  getDictionaryForm(): string { throw new Error('Not implemented'); }
  getNegative(): string { throw new Error('Not implemented'); }
  getPolite(): string { throw new Error('Not implemented'); }
  getTeForm(): string { throw new Error('Not implemented'); }
  getTaForm(): string { throw new Error('Not implemented'); }
  getPotential(): string { throw new Error('Not implemented'); }
  getPassive(): string { throw new Error('Not implemented'); }
  getCausative(): string { throw new Error('Not implemented'); }
  getImperative(): string { throw new Error('Not implemented'); }
  getVolitional(): string { throw new Error('Not implemented'); }
  getCausativePassive(): string { throw new Error('Not implemented'); }
}

// 五段动词 (Godan)
class GodanVerb extends Verb {
  dictionaryForm: string;
  stem: string;
  lastChar: string;

  constructor(dictionaryForm: string) {
    super();
    this.dictionaryForm = dictionaryForm;
    this.stem = dictionaryForm.slice(0, -1);
    this.lastChar = dictionaryForm[dictionaryForm.length - 1];
  }

  getDictionaryForm(): string { return this.dictionaryForm; }
  getNegative(): string {
    if (this.dictionaryForm === 'ある') return 'ない';
    return this.stem + this.mapLastChar('a') + 'ない';
  }
  getPolite(): string {
    if (['いらっしゃる', 'おっしゃる', 'なさる', 'くださる', 'ござる'].includes(this.dictionaryForm)) {
      return this.stem + 'い' + 'ます';
    }
    return this.stem + this.mapLastChar('i') + 'ます';
  }
  getTeForm(): string { return this.stem + this.getTeTaSuffix(true); }
  getTaForm(): string { return this.stem + this.getTeTaSuffix(false); }
  getPotential(): string { return this.stem + this.mapLastChar('e') + 'る'; }
  getPassive(): string { return this.stem + this.mapLastChar('a') + 'れる'; }
  getCausative(): string { return this.stem + this.mapLastChar('a') + 'せる'; }
  getImperative(): string {
    if (['いらっしゃる', 'おっしゃる', 'なさる', 'くださる'].includes(this.dictionaryForm)) {
      return this.stem + 'い';
    }
    return this.stem + this.mapLastChar('e');
  }
  getVolitional(): string { return this.stem + this.mapLastChar('o') + 'う'; }
  getCausativePassive(): string {
    // す结尾五段无短缩形（話す→話させられる）；其余常用短缩形 〜される（飲む→飲まされる）
    if (this.lastChar === 'す') return this.stem + this.mapLastChar('a') + 'せられる';
    return this.stem + this.mapLastChar('a') + 'される';
  }

  mapLastChar(row: string): string {
    const map: Record<string, Record<string, string>> = {
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
    return map[this.lastChar]?.[row] || '';
  }

  getTeTaSuffix(isTe: boolean): string {
    if (this.dictionaryForm.endsWith('行く') || this.dictionaryForm.endsWith('いく')) {
      return isTe ? 'って' : 'った';
    }
    if (this.dictionaryForm.endsWith('問う') || this.dictionaryForm.endsWith('とう')) {
      return isTe ? 'うて' : 'うた';
    }
    if (this.dictionaryForm.endsWith('請う') || this.dictionaryForm.endsWith('こう')) {
      return isTe ? 'うて' : 'うた';
    }
    const suffixMap: Record<string, { te: string; ta: string }> = {
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
    const suffix = suffixMap[this.lastChar];
    return isTe ? suffix?.te : suffix?.ta;
  }
}

// 一段动词 (Ichidan)
class IchidanVerb extends Verb {
  dictionaryForm: string;
  stem: string;

  constructor(dictionaryForm: string) {
    super();
    this.dictionaryForm = dictionaryForm;
    this.stem = dictionaryForm.slice(0, -1);
  }

  getDictionaryForm(): string { return this.dictionaryForm; }
  getNegative(): string { return this.stem + 'ない'; }
  getPolite(): string { return this.stem + 'ます'; }
  getTeForm(): string { return this.stem + 'て'; }
  getTaForm(): string { return this.stem + 'た'; }
  getPotential(): string { return this.stem + 'られる'; }
  getPassive(): string { return this.stem + 'られる'; }
  getCausative(): string { return this.stem + 'させる'; }
  getImperative(): string {
    if (this.dictionaryForm === 'くれる') return 'くれ';
    return this.stem + 'ろ';
  }
  getVolitional(): string { return this.stem + 'よう'; }
  getCausativePassive(): string { return this.stem + 'させられる'; }
}

// サ变动词 (Suru)
class SuruVerb extends Verb {
  dictionaryForm: string;
  prefix: string;

  constructor(dictionaryForm: string) {
    super();
    this.dictionaryForm = dictionaryForm;
    this.prefix = dictionaryForm.slice(0, -2);
  }

  getDictionaryForm(): string { return this.dictionaryForm; }
  getNegative(): string { return this.prefix + 'しない'; }
  getPolite(): string { return this.prefix + 'します'; }
  getTeForm(): string { return this.prefix + 'して'; }
  getTaForm(): string { return this.prefix + 'した'; }
  getPotential(): string { return this.prefix + 'できる'; }
  getPassive(): string { return this.prefix + 'される'; }
  getCausative(): string { return this.prefix + 'させる'; }
  getImperative(): string { return this.prefix + 'しろ'; }
  getVolitional(): string { return this.prefix + 'しよう'; }
  getCausativePassive(): string { return this.prefix + 'させられる'; }
}

// カ变动词 (Kuru)
class KuruVerb extends Verb {
  dictionaryForm: string;
  hasKanji: boolean;
  prefix: string;

  constructor(dictionaryForm: string) {
    super();
    this.dictionaryForm = dictionaryForm;
    this.hasKanji = dictionaryForm.endsWith('来る');
    if (this.hasKanji) {
      this.prefix = dictionaryForm.slice(0, -2) + '来';
    } else {
      this.prefix = dictionaryForm.slice(0, -2);
    }
  }

  getDictionaryForm(): string { return this.dictionaryForm; }
  getNegative(): string { return this.hasKanji ? this.prefix + 'ない' : this.prefix + 'こない'; }
  getPolite(): string { return this.hasKanji ? this.prefix + 'ます' : this.prefix + 'きます'; }
  getTeForm(): string { return this.hasKanji ? this.prefix + 'て' : this.prefix + 'きて'; }
  getTaForm(): string { return this.hasKanji ? this.prefix + 'た' : this.prefix + 'きた'; }
  getPotential(): string { return this.hasKanji ? this.prefix + 'られる' : this.prefix + 'こられる'; }
  getPassive(): string { return this.hasKanji ? this.prefix + 'られる' : this.prefix + 'こられる'; }
  getCausative(): string { return this.hasKanji ? this.prefix + 'させる' : this.prefix + 'こさせる'; }
  getImperative(): string { return this.hasKanji ? this.prefix + 'い' : this.prefix + 'こい'; }
  getVolitional(): string { return this.hasKanji ? this.prefix + 'よう' : this.prefix + 'こよう'; }
  getCausativePassive(): string { return this.hasKanji ? this.prefix + 'させられる' : this.prefix + 'こさせられる'; }
}

interface ConjugationResult {
  dictionaryForm: string;
  verbType: string;
  negative: string;
  polite: string;
  teForm: string;
  taForm: string;
  potential: string;
  passive: string;
  causative: string;
  imperative: string;
  volitional: string;
  causativePassive: string;
}

// 工厂函数
function createVerb(dictionaryForm: string, verbType: string): Verb {
  switch (verbType) {
    case 'GODAN':
      return new GodanVerb(dictionaryForm);
    case 'ICHIDAN':
      return new IchidanVerb(dictionaryForm);
    case 'SURU':
      return new SuruVerb(dictionaryForm);
    case 'KURU':
      return new KuruVerb(dictionaryForm);
    default:
      throw new Error(`Unknown verb type: ${verbType}`);
  }
}

// 活用引擎
function conjugate(dictionaryForm: string, verbType: string): ConjugationResult {
  const verb = createVerb(dictionaryForm, verbType);
  return {
    dictionaryForm: verb.getDictionaryForm(),
    verbType: verbType,
    negative: verb.getNegative(),
    polite: verb.getPolite(),
    teForm: verb.getTeForm(),
    taForm: verb.getTaForm(),
    potential: verb.getPotential(),
    passive: verb.getPassive(),
    causative: verb.getCausative(),
    imperative: verb.getImperative(),
    volitional: verb.getVolitional(),
    causativePassive: verb.getCausativePassive()
  };
}

export { conjugate };
