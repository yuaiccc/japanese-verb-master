interface SceneConfig {
  id: string;
  name: string;
  description: string;
  verbKanji: string[];
}

interface CommonVerb {
  kanji: string;
  kana: string;
  meaning: string;
}

interface SceneCatalogEntry {
  id: string;
  name: string;
  description: string;
  verbCount: number;
  featuredVerbs: { kanji: string; kana: string; meaning: string }[];
}

const sceneConfigs: SceneConfig[] = [
  {
    id: 'daily',
    name: '日常生活',
    description: '围绕起床、吃饭、出门、购物等高频表达练习动词。',
    verbKanji: ['起きる', '寝る', '食べる', '飲む', '買う', '洗う', '着る', '脱ぐ', '座る', '立つ', '出す', '入れる']
  },
  {
    id: 'restaurant',
    name: '餐厅点餐',
    description: '点餐、等待、支付与服务沟通中常见的动词。',
    verbKanji: ['食べる', '飲む', '頼む', '払う', '待つ', '座る', '選ぶ', '呼ぶ', '使う', 'もらう', '出す', '入れる']
  },
  {
    id: 'school',
    name: '学校学习',
    description: '上课、做题、提问、记忆和复习相关的核心动词。',
    verbKanji: ['勉強する', '読む', '書く', '聞く', '答える', '質問する', '習う', '教える', '覚える', '忘れる', '見る', '知る']
  },
  {
    id: 'travel',
    name: '旅行出行',
    description: '围绕乘车、问路、赶时间与移动场景进行专项训练。',
    verbKanji: ['行く', '来る', '帰る', '乗る', '降りる', '歩く', '走る', '待つ', '急ぐ', '間に合う', '探す', '会う']
  },
  {
    id: 'work',
    name: '职场沟通',
    description: '会议、协作、汇报、交付和工作推进中的常见动词。',
    verbKanji: ['働く', '会う', '話す', '聞く', '書く', '読む', '作る', '使う', '頼む', '返す', '直す', '手伝う']
  }
];

const sceneVerbMap = new Map<string, Set<string>>(
  sceneConfigs.map(scene => [scene.id, new Set(scene.verbKanji)])
);

const verbSceneMap = new Map<string, string[]>();

for (const scene of sceneConfigs) {
  for (const kanji of scene.verbKanji) {
    if (!verbSceneMap.has(kanji)) {
      verbSceneMap.set(kanji, []);
    }
    verbSceneMap.get(kanji)!.push(scene.id);
  }
}

function getSceneCatalog(commonVerbs: CommonVerb[]): SceneCatalogEntry[] {
  return sceneConfigs.map(scene => {
    const verbs = commonVerbs.filter(verb => sceneVerbMap.get(scene.id)?.has(verb.kanji));
    return {
      id: scene.id,
      name: scene.name,
      description: scene.description,
      verbCount: verbs.length,
      featuredVerbs: verbs.slice(0, 4).map(verb => ({
        kanji: verb.kanji,
        kana: verb.kana,
        meaning: verb.meaning
      }))
    };
  });
}

function getVerbsForScene(commonVerbs: CommonVerb[], sceneId: string): CommonVerb[] {
  const allowedVerbs = sceneVerbMap.get(sceneId);
  if (!allowedVerbs) return [];
  return commonVerbs.filter(verb => allowedVerbs.has(verb.kanji));
}

function getSceneIdsForVerb(kanji: string): string[] {
  return verbSceneMap.get(kanji) || [];
}

function getSceneById(sceneId: string): SceneConfig | null {
  return sceneConfigs.find(scene => scene.id === sceneId) || null;
}

export {
  getSceneById,
  getSceneCatalog,
  getSceneIdsForVerb,
  getVerbsForScene
};
