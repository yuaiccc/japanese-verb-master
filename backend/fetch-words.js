/**
 * 从 Jisho API 批量抓取 JLPT 词汇并导入 SQLite
 * 用法: node fetch-words.js [--levels n5,n4,n3,n2,n1] [--delay 1500]
 * 默认抓取 N5, N4, N3
 */
import https from 'https';
import * as wanakana from 'wanakana';
import { bulkInsert, getWordCount } from './db.js';

const args = process.argv.slice(2);
const levelArg = args.find(a => a.startsWith('--levels='));
const delayArg = args.find(a => a.startsWith('--delay='));

const levels = levelArg
  ? levelArg.split('=')[1].split(',').map(l => l.trim())
  : ['n5', 'n4', 'n3'];
const DELAY_MS = delayArg ? parseInt(delayArg.split('=')[1]) : 1500;
const MAX_PAGES_PER_LEVEL = 50; // 安全上限，每级最多 50 页 × 20 条 = 1000 词

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function fetchPage(keyword, page) {
  return new Promise((resolve, reject) => {
    const url = `https://jisho.org/api/v1/search/words?keyword=${encodeURIComponent(keyword)}&page=${page}`;
    https.get(url, { timeout: 15000 }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`JSON parse error: ${e.message}`));
        }
      });
    }).on('error', reject)
      .on('timeout', function() { this.destroy(); reject(new Error('Request timeout')); });
  });
}

function parseJishoItem(item) {
  if (!item.japanese || item.japanese.length === 0) return null;

  const japanese = item.japanese[0];
  const kanji = japanese.word || japanese.reading;
  const kana = japanese.reading || kanji;
  if (!kanji || !kana) return null;

  let wordType = 'other';
  const meanings = [];

  for (const sense of (item.senses || [])) {
    const pos = (sense.parts_of_speech || []).join(' ').toLowerCase();
    if (wordType === 'other') {
      if (pos.includes('verb')) wordType = 'verb';
      else if (pos.includes('i-adjective')) wordType = 'i-adjective';
      else if (pos.includes('na-adjective')) wordType = 'na-adjective';
      else if (pos.includes('noun')) wordType = 'noun';
      else if (pos.includes('adverb')) wordType = 'adverb';
      else if (pos.includes('particle')) wordType = 'particle';
      else if (pos.includes('conjunction')) wordType = 'conjunction';
      else if (pos.includes('interjection')) wordType = 'interjection';
      else if (pos.includes('prefix')) wordType = 'prefix';
      else if (pos.includes('suffix')) wordType = 'suffix';
      else if (pos.includes('counter')) wordType = 'counter';
      else if (pos.includes('pronoun')) wordType = 'pronoun';
      else if (pos.includes('expression')) wordType = 'expression';
    }
    const defs = (sense.english_definitions || []).slice(0, 3).join(', ');
    if (defs) meanings.push(defs);
  }

  if (wordType === 'other' && meanings.length === 0) return null;

  const jlptArr = item.jlpt || [];
  const jlpt = jlptArr.length > 0 ? jlptArr[0].replace('jlpt-', '').toUpperCase() : '';

  return {
    kanji,
    kana,
    romaji: wanakana.toRomaji(kana),
    meaning: meanings.slice(0, 2).join('; '),
    wordType: wordType === 'other' ? 'noun' : wordType, // 有 JLPT 标记但无法识别词性的默认归为名词
    jlpt,
    isCommon: item.is_common ? 1 : 0
  };
}

async function fetchLevel(level) {
  const keyword = `#jlpt-${level}`;
  let page = 1;
  let totalFetched = 0;
  const words = [];

  while (page <= MAX_PAGES_PER_LEVEL) {
    process.stdout.write(`  📡 JLPT ${level.toUpperCase()} - 第 ${page} 页... `);

    let result;
    let retries = 0;
    while (retries < 3) {
      try {
        result = await fetchPage(keyword, page);
        break;
      } catch (e) {
        retries++;
        console.log(`⚠️  重试 ${retries}/3: ${e.message}`);
        await sleep(3000);
      }
    }

    if (!result || !result.data || result.data.length === 0) {
      console.log('✅ 无更多数据');
      break;
    }

    let pageCount = 0;
    for (const item of result.data) {
      const word = parseJishoItem(item);
      if (word) {
        words.push(word);
        pageCount++;
      }
    }

    totalFetched += pageCount;
    console.log(`${pageCount} 条 (累计 ${totalFetched})`);

    page++;
    await sleep(DELAY_MS);
  }

  return words;
}

async function main() {
  const beforeCount = getWordCount();
  console.log(`📊 当前数据库: ${beforeCount} 条词汇\n`);
  console.log(`🎯 准备抓取 JLPT 等级: ${levels.map(l => l.toUpperCase()).join(', ')}`);
  console.log(`⏱️  请求间隔: ${DELAY_MS}ms\n`);

  let allWords = [];

  for (const level of levels) {
    console.log(`\n── JLPT ${level.toUpperCase()} ──`);
    const words = await fetchLevel(level);
    allWords = allWords.concat(words);
    console.log(`  📦 ${level.toUpperCase()} 共获取 ${words.length} 条\n`);
  }

  console.log(`\n📥 正在批量导入 ${allWords.length} 条词汇...`);
  
  // 分批导入，每批 200 条
  const BATCH_SIZE = 200;
  for (let i = 0; i < allWords.length; i += BATCH_SIZE) {
    const batch = allWords.slice(i, i + BATCH_SIZE);
    bulkInsert(batch);
    process.stdout.write(`  已导入 ${Math.min(i + BATCH_SIZE, allWords.length)}/${allWords.length}\r`);
  }

  const afterCount = getWordCount();
  console.log(`\n\n✅ 导入完成！`);
  console.log(`   导入前: ${beforeCount} 条`);
  console.log(`   导入后: ${afterCount} 条`);
  console.log(`   新增: ${afterCount - beforeCount} 条（重复词汇已自动跳过）`);
}

main().catch(e => {
  console.error('❌ 抓取失败:', e);
  process.exit(1);
});
