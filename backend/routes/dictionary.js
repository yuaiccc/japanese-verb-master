// 词典路由：从 server.js 抽离，逻辑保持不变。
// 所有依赖通过 registerDictionaryRoutes(app, deps) 的 deps 参数注入。

import express from 'express';
import * as wanakana from 'wanakana';

export function registerDictionaryRoutes(app, deps) {
  const {
    agentHelpers,
    conjugate,
    findWord,
    searchWords,
    bulkInsert,
    searchJisho,
    lookupWordJisho,
    translateMeaningsToChinese,
    generateFuriganaHtml,
    pipeLlmStreamToSse,
    getRuntimeLlmSettings,
    getDefaultLlmModel,
    getTokenizer,
    commonVerbs,
    sceneCatalog,
    userStore,
    buildUserProfile,
    shuffleArray,
    getVerbsForScene,
    getSceneById,
    getSceneIdsForVerb,
    ollama,
    getLlmProvider
  } = deps;

  // Furigana API: 用 kuromoji 为日文文本生成 ruby HTML
  app.post('/api/furigana', express.json(), (req, res) => {
    const { texts } = req.body; // 支持批量: string[]
    if (!texts || !Array.isArray(texts)) {
      return res.status(400).json({ error: 'texts array required' });
    }
    if (!getTokenizer()) {
      return res.status(503).json({ error: 'Tokenizer not ready' });
    }
    const results = texts.map(t => generateFuriganaHtml(t));
    res.json({ results });
  });

  // 获取可用模型
  app.get('/api/ai-models', async (req, res) => {
    if (getLlmProvider() !== 'ollama') {
      const model = getDefaultLlmModel();
      return res.json([...new Set([model, 'deepseek-v4-flash', 'gpt-4o-mini', 'claude-3-5-sonnet-20241022'].filter(Boolean))]);
    }
    try {
      const response = await ollama.list();
      res.json(response.models.map(m => m.name));
    } catch (error) {
      console.error('Failed to fetch models:', error);
      res.status(500).json({ error: 'Failed to fetch models' });
    }
  });

  // 场景列表 API
  app.get('/api/scenes', (req, res) => {
    res.json(sceneCatalog);
  });

  // 练习画像 API
  app.get('/api/practice-profile', async (req, res) => {
    try {
      const records = await userStore.listPracticeRecords(2000, req.userId);
      res.json(agentHelpers.buildPracticeProfile(records));
    } catch (error) {
      res.status(500).json({ error: 'Failed to build practice profile.' });
    }
  });

  app.get('/api/user-profile', async (req, res) => {
    try {
      const records = await userStore.listPracticeRecords(2000, req.userId);
      const practiceProfile = agentHelpers.buildPracticeProfile(records);
      const memoryCards = await userStore.listMemoryCards(500, req.userId);
      res.json(buildUserProfile({ memoryCards, practiceProfile }));
    } catch (error) {
      res.status(500).json({ error: 'Failed to build user profile.' });
    }
  });

  // 练习记录写入 API
  app.post('/api/practice-records', async (req, res) => {
    try {
      const {
        verb,
        formKey,
        sceneId,
        sceneName,
        userAnswer,
        correctAnswer,
        isCorrect,
        durationMs,
        answeredAt
      } = req.body || {};

      if (!verb || !formKey || typeof isCorrect !== 'boolean') {
        return res.status(400).json({ error: 'Missing required practice record fields.' });
      }

      await userStore.insertPracticeRecord({
        verb,
        formKey,
        sceneId,
        sceneName,
        userAnswer,
        correctAnswer,
        isCorrect,
        durationMs,
        answeredAt
      }, req.userId);

      const records = await userStore.listPracticeRecords(2000, req.userId);
      res.status(201).json(agentHelpers.buildPracticeProfile(records));
    } catch (error) {
      res.status(500).json({ error: 'Failed to save practice record.' });
    }
  });

  // AI 词汇解析 API（动词校验 + 非动词解析）
  app.post('/api/ai-explain', async (req, res) => {
    try {
      const { verb, model, conjugationResult, wordType, wordInfo } = req.body;
      if (!verb) {
        return res.status(400).json({ error: 'Missing required parameter: verb' });
      }
      if (!getRuntimeLlmSettings({ includeSecret: true }).apiKey) {
        return res.status(400).json({
          error: '尚未配置 LLM API Key。请到设置面板填入你自己的 OpenAI 兼容 API Key 以获得 AI 解析。',
          code: 'no_llm_key'
        });
      }
      const selectedModel = model || getDefaultLlmModel();

      let prompt;

      if (wordType && wordType !== 'verb') {
        // 非动词 prompt：查词解析 + 例句 + 助记
        const wordTypeNames = {
          'noun': '名词', 'i-adjective': 'い形容词',
          'na-adjective': 'な形容词', 'adverb': '副词'
        };
        const typeName = wordTypeNames[wordType] || wordType;
        const meaningsStr = wordInfo?.meanings
          ? wordInfo.meanings.map((m, i) => `${i + 1}. [${m.pos}] ${m.definitions}`).join('\n')
          : '';

        prompt = `你是一个专业的日语教师。请详细解析日语单词「${verb}」。

单词信息：
- 词性：${typeName}
- 读音：${wordInfo?.reading || ''}
${meaningsStr ? '- 释义：\n' + meaningsStr : ''}

【重要】你的回答必须严格按以下格式：

1. 回答开头必须直接是一个 JSON 代码块（\`\`\`json 开始），不要有任何前置文字。
2. JSON 结构如下（只有 examples，不需要 verification）：
\`\`\`json
{
  "examples": [
    { "japanese": "日文例句", "kana": "平假名注音", "chinese": "中文翻译" },
    { "japanese": "...", "kana": "...", "chinese": "..." },
    { "japanese": "...", "kana": "...", "chinese": "..." }
  ]
}
\`\`\`

3. JSON 代码块闭合后，请用中文输出一段详细解析（支持 Markdown），包括：
   - 词义详解（不同语境下的含义）
   - 常用搭配和惯用表达
   - 联想记忆法或词源拆解
   - 易混淆词对比
   - 文化小知识（如有）`;
      } else {
        // 动词 prompt：活用校验 + 例句 + 助记
        const conjugationForAi = {
          dictionaryForm: conjugationResult.dictionaryForm,
          verbType: conjugationResult.verbType,
          negative: conjugationResult.negative,
          polite: conjugationResult.polite,
          teForm: conjugationResult.teForm,
          taForm: conjugationResult.taForm,
          potential: conjugationResult.potential,
          passive: conjugationResult.passive,
          causative: conjugationResult.causative,
          imperative: conjugationResult.imperative,
          volitional: conjugationResult.volitional
        };

        prompt = `你是一个严谨的日语语言学专家。请校对以下动词 "${verb}" 的活用变形结果，并提供例句和词义解析。

程序生成的活用结果：
${JSON.stringify(conjugationForAi, null, 2)}

【重要】你的回答必须严格按以下格式，不得有任何偏差：

1. 回答的开头必须直接是一个 JSON 代码块（\`\`\`json 开始），不要有任何前置文字。
2. JSON 中 "verification" 必须是第一个键，"examples" 必须是第二个键。严禁调换顺序。
3. verification 逐项校对这 9 种变形：negative, polite, teForm, taForm, potential, passive, causative, imperative, volitional。正确则 isCorrect=true, correction=""；错误则 isCorrect=false 并给出正确日文。汉字/假名写法不同不算错。
4. examples 提供 2 个日常例句，含 japanese（日文原文）、kana（平假名注音）、chinese（中文翻译）。

严格遵循此 JSON 结构（verification 在前，examples 在后）：
\`\`\`json
{
  "verification": {
    "negative": { "isCorrect": true, "correction": "" },
    "polite": { "isCorrect": true, "correction": "" },
    "teForm": { "isCorrect": true, "correction": "" },
    "taForm": { "isCorrect": true, "correction": "" },
    "potential": { "isCorrect": true, "correction": "" },
    "passive": { "isCorrect": true, "correction": "" },
    "causative": { "isCorrect": true, "correction": "" },
    "imperative": { "isCorrect": true, "correction": "" },
    "volitional": { "isCorrect": true, "correction": "" }
  },
  "examples": [
    { "japanese": "...", "kana": "...", "chinese": "..." },
    { "japanese": "...", "kana": "...", "chinese": "..." }
  ]
}
\`\`\`

5. JSON 代码块闭合后，请用中文输出一段「助记」内容（支持 Markdown），帮助学习者记忆这个动词。可以包括：词源或字形拆解、联想记忆法、易混淆词对比、文化小知识等。不要重复列举上面已有的变形结果。
6. 动词类型请使用中国通用术语：五段动词、一段动词、サ变动词、カ变动词，不要用 Godan、Ichidan 等英文。`;
      }

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      await pipeLlmStreamToSse({
        res,
        model: selectedModel,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.35,
        maxTokens: 2200
      });
      res.end();
    } catch (error) {
      console.error('LLM API Error:', error);
      if (!res.headersSent) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
      }
      res.write(`data: ${JSON.stringify({ error: 'AI 服务暂不可用，请检查 DeepSeek API Key 或本地 Ollama 服务。' })}\n\n`);
      res.end();
    }
  });

  // 词汇联想补全 API（双轨：local 秒回 + remote 补充）
  app.get('/api/suggest', async (req, res) => {
    try {
      const { q, remote } = req.query;
      if (!q || q.trim() === '') {
        return res.json([]);
      }

      const query = q.toLowerCase().trim();
      // 用 wanakana 转假名，支持用户输入罗马音匹配假名
      const queryHira = wanakana.isRomaji(query) ? wanakana.toHiragana(query) : '';

      // 1. SQLite 本地词库快速匹配（索引加速，毫秒级）
      let localSuggestions = searchWords(query, 8);
      // 补充罗马音转假名匹配
      if (queryHira && localSuggestions.length < 8) {
        const hiraSuggestions = searchWords(queryHira, 8);
        const seen = new Set(localSuggestions.map(w => w.kanji + w.kana));
        for (const s of hiraSuggestions) {
          if (!seen.has(s.kanji + s.kana)) {
            localSuggestions.push(s);
            seen.add(s.kanji + s.kana);
          }
        }
        localSuggestions = localSuggestions.slice(0, 8);
      }

      // 如果不是 remote 请求，直接返回本地结果（秒回）
      if (!remote) {
        return res.json(localSuggestions.slice(0, 8));
      }

      // remote=1: 查询 Jisho API 补充远程结果
      let jishoSuggestions = [];
      try {
        jishoSuggestions = await Promise.race([
          searchJisho(query, false),
          new Promise(resolve => setTimeout(() => resolve([]), 5000))
        ]);
      } catch(e) {
        console.error('Jisho API fetch failed', e);
      }

      // 合并去重（本地优先）
      const seen = new Set(localSuggestions.map(w => w.kanji + w.kana));
      const remoteOnly = [];
      for (const item of jishoSuggestions) {
        const key = item.kanji + item.kana;
        if (!seen.has(key)) {
          seen.add(key);
          remoteOnly.push(item);
        }
      }

      // 将远程新词缓存到 SQLite（异步，不阻塞响应）
      if (remoteOnly.length > 0) {
        try {
          bulkInsert(remoteOnly.map(item => ({
            kanji: item.kanji,
            kana: item.kana,
            romaji: item.romaji,
            meaning: item.meaning || '',
            wordType: item.wordType || 'other',
            jlpt: '',
            isCommon: 0
          })));
        } catch (e) {
          // 忽略缓存失败
        }
      }

      res.json([...localSuggestions, ...remoteOnly].slice(0, 12));
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Failed to fetch suggestions' });
    }
  });

  // 词汇查询 API（动词走活用流程，其他词走查词流程）
  app.get('/api/conjugate', async (req, res) => {
    try {
      let { verb, type } = req.query;

      if (!verb) {
        return res.status(400).json({
          error: 'Missing required parameter: verb'
        });
      }

      // 处理罗马音，转换成平假名
      const processedVerb = wanakana.toHiragana(verb);

      // 如果前端没有传 type，就用 kuromoji 自动推断
      if (!type) {
        if (!getTokenizer()) {
          return res.status(503).json({ error: 'Dictionary is initializing, please try again later.' });
        }
        type = agentHelpers.detectVerbType(processedVerb);

        // 非动词：优先查 SQLite 本地词库（毫秒级）
        if (!type) {
          const localWord = findWord(verb) || findWord(processedVerb);
          if (localWord && localWord.wordType !== 'verb' && localWord.wordType !== 'other') {
            return res.json({
              wordType: localWord.wordType,
              word: localWord.kanji,
              reading: localWord.kana,
              romaji: localWord.romaji,
              meanings: [{
                pos: localWord.wordType,
                definitions: localWord.meaning
              }],
              jlpt: localWord.jlpt || '',
              isCommon: !!localWord.isCommon,
              originalInput: verb,
              parsedAs: processedVerb
            });
          }

          // 本地未命中，回退到 Jisho 查词
          try {
            const wordInfo = await lookupWordJisho(verb);
            if (wordInfo && wordInfo.wordType !== 'other') {
              if (wordInfo.wordType === 'verb') {
                return res.status(400).json({
                  error: `"${verb}" 似乎是动词，但无法解析其原形。请输入动词的辞书形（原形），如「食べる」而非「食べた」。`
                });
              }
              // 翻译英文释义为中文
              wordInfo.meanings = await translateMeaningsToChinese(wordInfo.meanings);
              // 缓存到 SQLite，下次秒回
              try {
                bulkInsert([{
                  kanji: wordInfo.word,
                  kana: wordInfo.reading,
                  romaji: wordInfo.romaji,
                  meaning: wordInfo.meanings.map(m => m.definitions).join('; '),
                  wordType: wordInfo.wordType,
                  jlpt: wordInfo.jlpt || '',
                  isCommon: wordInfo.isCommon ? 1 : 0
                }]);
              } catch(e) { /* ignore cache error */ }
              return res.json({
                ...wordInfo,
                originalInput: verb,
                parsedAs: processedVerb
              });
            }
          } catch (e) {
            console.error('Word lookup failed:', e);
          }
          return res.status(400).json({
            error: `无法识别 "${verb}" (解析为 "${processedVerb}")。请确保输入正确的日语单词。`
          });
        }
      }

      const result = conjugate(processedVerb, type);

      // 从 SQLite 本地词库查找中文释义（优先），fallback 到旧 JSON
      const dictForm = result.dictionaryForm;
      const dbWord = findWord(dictForm) || findWord(processedVerb);
      const matchedVerb = dbWord || commonVerbs.find(v =>
        v.kanji === dictForm || v.kana === dictForm || v.kanji === processedVerb || v.kana === processedVerb
      );
      const meaning = dbWord ? dbWord.meaning : (matchedVerb ? matchedVerb.meaning : '');
      const reading = dbWord ? dbWord.kana : (matchedVerb ? matchedVerb.kana : '');

      res.json({
        wordType: 'verb',
        ...result,
        meaning,
        reading,
        originalInput: verb,
        parsedAs: processedVerb
      });
    } catch (error) {
      res.status(400).json({
        error: error.message
      });
    }
  });

  // 获取支持的动词类型
  app.get('/api/verb-types', (req, res) => {
    res.json({
      types: [
        {
          id: 'GODAN',
          name: '五段动词 (Group 1)',
          description: 'Verbs ending in う, く, ぐ, す, つ, ぬ, ふ, ぶ, む, る'
        },
        {
          id: 'ICHIDAN',
          name: '一段动词 (Group 2)',
          description: 'Verbs ending in える or いる'
        },
        {
          id: 'SURU',
          name: 'サ变动词 (Group 3)',
          description: 'Verbs ending in する'
        },
        {
          id: 'KURU',
          name: 'カ变动词 (Group 3)',
          description: 'Verbs ending in 来る'
        }
      ]
    });
  });

  // Dojo (动词变形道场) 题库 API
  app.get('/api/dojo-quiz', async (req, res) => {
    try {
      const limit = parseInt(req.query.limit) || 10;
      const sceneId = typeof req.query.scene === 'string' ? req.query.scene.trim() : '';
      // N1 专项：付费解锁的高阶变形包，不属于普通场景词表
      const isN1Pack = sceneId === 'n1';
      const selectedScene = sceneId && !isN1Pack ? getSceneById(sceneId) : null;
      if (!getTokenizer()) {
        return res.status(503).json({ error: 'Dictionary is initializing, please try again later.' });
      }
      if (sceneId && !isN1Pack && !selectedScene) {
        return res.status(400).json({ error: 'Invalid scene id.' });
      }
      if (isN1Pack && !(await userStore.hasEntitlement('n1-pack', req.userId))) {
        // 与支付宝「AI 收」同款语义：资源对未付费访问回 402
        return res.status(402).json({ error: 'Payment required', sku: 'n1-pack' });
      }

      const forms = isN1Pack
        ? [
            { key: 'causativePassive', label: '使役被动形' },
            { key: 'causative', label: '使役形' },
            { key: 'passive', label: '被动形' },
            { key: 'volitional', label: '意向形' },
            { key: 'imperative', label: '命令形' }
          ]
        : [
            { key: 'negative', label: '否定式 (ない形)' },
            { key: 'polite', label: '礼貌式 (ます形)' },
            { key: 'teForm', label: 'て形' },
            { key: 'taForm', label: '过去式 (た形)' },
            { key: 'potential', label: '可能形' },
            { key: 'passive', label: '被动形' },
            { key: 'causative', label: '使役形' },
            { key: 'imperative', label: '命令形' },
            { key: 'volitional', label: '意向形' }
          ];

      const sourceVerbs = selectedScene ? getVerbsForScene(commonVerbs, selectedScene.id) : commonVerbs;
      if (sourceVerbs.length === 0) {
        return res.status(400).json({ error: 'No verbs available for the selected scene.' });
      }

      const questions = [];
      const usedVerbs = new Set();

      // 从词库中随机抽取
      while (questions.length < limit && usedVerbs.size < sourceVerbs.length) {
        const randomIndex = Math.floor(Math.random() * sourceVerbs.length);
        const verbObj = sourceVerbs[randomIndex];

        if (usedVerbs.has(verbObj.kanji)) continue;
        usedVerbs.add(verbObj.kanji);

        // 解析动词类型
        const type = agentHelpers.detectVerbType(verbObj.kana);
        if (!type) continue;

        try {
          // 生成所有变形
          const result = conjugate(verbObj.kana, type);

          // 随机挑一个考点
          const formObj = forms[Math.floor(Math.random() * forms.length)];
          const answerKana = result[formObj.key];

          if (!answerKana) continue;

          const options = new Set([answerKana]);
          const shuffledSourceVerbs = shuffleArray(sourceVerbs);

          for (const candidateVerb of shuffledSourceVerbs) {
            if (options.size >= 4) break;
            if (candidateVerb.kanji === verbObj.kanji) continue;

            try {
              const candidateType = agentHelpers.detectVerbType(candidateVerb.kana);
              if (!candidateType) continue;
              const candidateResult = conjugate(candidateVerb.kana, candidateType);
              const distractor = candidateResult[formObj.key];
              if (distractor) {
                options.add(distractor);
              }
            } catch (e) {
              // ignore invalid distractor candidate
            }
          }

          if (options.size < 4) {
            for (const fallbackForm of forms) {
              if (options.size >= 4) break;
              const fallbackAnswer = result[fallbackForm.key];
              if (fallbackAnswer) {
                options.add(fallbackAnswer);
              }
            }
          }

          questions.push({
            verb: verbObj.kanji,
            kana: verbObj.kana,
            romaji: verbObj.romaji,
            meaning: verbObj.meaning,
            sceneId: isN1Pack ? 'n1' : (selectedScene?.id || getSceneIdsForVerb(verbObj.kanji)[0] || ''),
            sceneName: isN1Pack ? 'N1 专项' : (selectedScene?.name || getSceneById(getSceneIdsForVerb(verbObj.kanji)[0])?.name || ''),
            formKey: formObj.key,
            formLabel: formObj.label,
            answer: answerKana,
            options: shuffleArray(Array.from(options)).slice(0, 4)
          });
        } catch (e) {
          // 忽略解析失败的动词
        }
      }

      res.json(questions);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
}
