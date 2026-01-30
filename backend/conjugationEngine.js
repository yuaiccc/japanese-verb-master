// 动词接口
class Verb {
  getDictionaryForm() { throw new Error('Not implemented'); }
  getNegative() { throw new Error('Not implemented'); }
  getPolite() { throw new Error('Not implemented'); }
  getTeForm() { throw new Error('Not implemented'); }
  getTaForm() { throw new Error('Not implemented'); }
  getPotential() { throw new Error('Not implemented'); }
  getPassive() { throw new Error('Not implemented'); }
  getCausative() { throw new Error('Not implemented'); }
  getImperative() { throw new Error('Not implemented'); }
  getVolitional() { throw new Error('Not implemented'); }
}

// 五段动词 (Godan)
class GodanVerb extends Verb {
  constructor(dictionaryForm) {
    super();
    this.dictionaryForm = dictionaryForm;
    this.stem = dictionaryForm.slice(0, -1);
    this.lastChar = dictionaryForm[dictionaryForm.length - 1];
  }

  getDictionaryForm() { return this.dictionaryForm; }
  getNegative() { return this.stem + this.mapLastChar('a') + 'ない'; }
  getPolite() { return this.stem + this.mapLastChar('i') + 'ます'; }
  getTeForm() { return this.stem + this.getTeTaSuffix(true); }
  getTaForm() { return this.stem + this.getTeTaSuffix(false); }
  getPotential() { return this.stem + this.mapLastChar('e') + 'る'; }
  getPassive() { return this.stem + this.mapLastChar('a') + 'れる'; }
  getCausative() { return this.stem + this.mapLastChar('a') + 'せる'; }
  getImperative() { return this.stem + this.mapLastChar('e'); }
  getVolitional() { return this.stem + this.mapLastChar('o') + 'う'; }

  mapLastChar(row) {
    const map = {
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

  getTeTaSuffix(isTe) {
    if (this.dictionaryForm === '行く') {
      return isTe ? 'って' : 'った';
    }
    const suffixMap = {
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
  constructor(dictionaryForm) {
    super();
    this.dictionaryForm = dictionaryForm;
    this.stem = dictionaryForm.slice(0, -1);
  }

  getDictionaryForm() { return this.dictionaryForm; }
  getNegative() { return this.stem + 'ない'; }
  getPolite() { return this.stem + 'ます'; }
  getTeForm() { return this.stem + 'て'; }
  getTaForm() { return this.stem + 'た'; }
  getPotential() { return this.stem + 'られる'; }
  getPassive() { return this.stem + 'られる'; }
  getCausative() { return this.stem + 'させる'; }
  getImperative() { return this.stem + 'ろ'; }
  getVolitional() { return this.stem + 'よう'; }
}

// サ变动词 (Suru)
class SuruVerb extends Verb {
  constructor(dictionaryForm) {
    super();
    this.dictionaryForm = dictionaryForm;
    this.prefix = dictionaryForm.slice(0, -2);
  }

  getDictionaryForm() { return this.dictionaryForm; }
  getNegative() { return this.prefix + 'しない'; }
  getPolite() { return this.prefix + 'します'; }
  getTeForm() { return this.prefix + 'して'; }
  getTaForm() { return this.prefix + 'した'; }
  getPotential() { return this.prefix + 'できる'; }
  getPassive() { return this.prefix + 'される'; }
  getCausative() { return this.prefix + 'させる'; }
  getImperative() { return this.prefix + 'しろ'; }
  getVolitional() { return this.prefix + 'しよう'; }
}

// カ变动词 (Kuru)
class KuruVerb extends Verb {
  constructor(dictionaryForm) {
    super();
    this.dictionaryForm = dictionaryForm;
    this.prefix = dictionaryForm.slice(0, -2);
  }

  getDictionaryForm() { return this.dictionaryForm; }
  getNegative() { return this.prefix + 'こない'; }
  getPolite() { return this.prefix + 'きます'; }
  getTeForm() { return this.prefix + 'きて'; }
  getTaForm() { return this.prefix + 'きた'; }
  getPotential() { return this.prefix + 'こられる'; }
  getPassive() { return this.prefix + 'こられる'; }
  getCausative() { return this.prefix + 'こさせる'; }
  getImperative() { return this.prefix + 'こい'; }
  getVolitional() { return this.prefix + 'こよう'; }
}

// 工厂函数
function createVerb(dictionaryForm, verbType) {
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
function conjugate(dictionaryForm, verbType) {
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
    volitional: verb.getVolitional()
  };
}

export { conjugate };
