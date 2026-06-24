import { test } from 'node:test';
import assert from 'node:assert/strict';
import { conjugate } from '../conjugationEngine';

test('使役被动形：一段动词 〜させられる', () => {
  assert.equal(conjugate('たべる', 'ICHIDAN').causativePassive, 'たべさせられる');
});

test('使役被动形：五段动词口语短缩 〜される', () => {
  assert.equal(conjugate('のむ', 'GODAN').causativePassive, 'のまされる');
  assert.equal(conjugate('かく', 'GODAN').causativePassive, 'かかされる');
});

test('使役被动形：す结尾五段无短缩形 〜させられる', () => {
  assert.equal(conjugate('はなす', 'GODAN').causativePassive, 'はなさせられる');
});

test('使役被动形：サ变・カ变', () => {
  assert.equal(conjugate('べんきょうする', 'SURU').causativePassive, 'べんきょうさせられる');
  assert.equal(conjugate('くる', 'KURU').causativePassive, 'こさせられる');
  assert.equal(conjugate('来る', 'KURU').causativePassive, '来させられる');
});

test('既有变形不受影响', () => {
  const r = conjugate('のむ', 'GODAN');
  assert.equal(r.passive, 'のまれる');
  assert.equal(r.causative, 'のませる');
  assert.equal(r.teForm, 'のんで');
});
