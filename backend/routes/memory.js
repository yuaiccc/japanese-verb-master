// 记忆卡片路由：从 server.js 抽离，逻辑保持不变。
// 所有依赖通过 registerMemoryRoutes(app, deps) 的 deps 参数注入。

import { DEFAULT_USER_ID } from '../auth.js';

export function registerMemoryRoutes(app, deps) {
  const {
    userStore,
    getMemorySettings,
    saveMemorySettings,
    buildStoreReviewQueue,
    buildDailyQuota,
    agentHelpers,
    generateDojoAgentCopy,
    normalizeDojoAnswer,
    buildDojoAnswerVariants,
    getKnowledgeEmbeddingSettings,
    saveKnowledgeEmbeddingSettings,
    knowledgeReindexQueue,
    db
  } = deps;

  // 把一次交互练习的结果反馈到长期记忆（间隔复习）系统。
  // 这是核心闭环：Agent 出的题 -> 用户作答 -> 结果驱动 SRS 调度，错题缩短间隔、对题拉长间隔。
  async function recordAgentPracticeToMemory({ question, userAnswer, isCorrect, hintUsed }, userId = DEFAULT_USER_ID) {
    // 答对且没用提示 = good；答对但用了提示 = hard；答错 = forgot。
    const grade = !isCorrect ? 'forgot' : hintUsed ? 'hard' : 'good';

    await userStore.insertPracticeRecord({
      verb: question.verb,
      formKey: question.formKey,
      sceneId: question.sceneId || 'agent-practice',
      sceneName: question.sceneName || 'Agent 练习',
      userAnswer,
      correctAnswer: question.answer,
      isCorrect,
      durationMs: 0,
      answeredAt: new Date().toISOString()
    }, userId);

    let card = await userStore.getMemoryCardByWord(question.verb, userId);
    let created = false;
    if (!card) {
      // 练过的词若尚未进入记忆库，自动建卡，让它纳入复习队列。
      await userStore.upsertMemoryCard({
        word: question.verb,
        reading: question.reading || '',
        meaning: question.meaning || '',
        wordType: question.wordType || 'verb',
        verbType: question.verbType || '',
        sample: '',
        source: 'agent-practice'
      }, userId);
      card = await userStore.getMemoryCardByWord(question.verb, userId);
      created = true;
    }

    let updatedCard = null;
    if (card) {
      updatedCard = await userStore.reviewMemoryCard(card.id, grade, getMemorySettings(), userId);
    }

    return {
      grade,
      created,
      card: updatedCard || card,
      cards: await userStore.listMemoryCards(500, userId),
      profile: agentHelpers.buildPracticeProfile(await userStore.listPracticeRecords(2000, userId))
    };
  }

  app.post('/api/dojo-agent-turn', async (req, res) => {
    try {
      const {
        question = {},
        userAnswer = '',
        action = 'check',
        hintUsed = false,
        recordToMemory = false
      } = req.body || {};
      if (!question.answer || !question.verb || !question.formKey) {
        return res.status(400).json({ error: 'Missing required dojo question fields.' });
      }

      if (action === 'hint') {
        const hint = await generateDojoAgentCopy({ mode: 'hint', question });
        return res.json({
          role: 'dojo-coach',
          action: 'hint',
          hint
        });
      }

      const normalizedUser = normalizeDojoAnswer(userAnswer);
      const isCorrect = buildDojoAnswerVariants(question).has(normalizedUser);
      const explanation = await generateDojoAgentCopy({
        mode: 'check',
        question,
        userAnswer,
        isCorrect
      });

      let memory = null;
      if (recordToMemory) {
        try {
          memory = await recordAgentPracticeToMemory({ question, userAnswer, isCorrect, hintUsed }, req.userId);
        } catch (memoryError) {
          console.error('Failed to record agent practice to memory:', memoryError);
        }
      }

      return res.json({
        role: 'dojo-coach',
        action: 'check',
        isCorrect,
        correctAnswer: question.answer,
        explanation,
        memory
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to run dojo coach.' });
    }
  });

  // 记忆卡片 API：间隔复习队列
  app.get('/api/memory-cards', async (req, res) => {
    try {
      res.json(await userStore.listMemoryCards(500, req.userId));
    } catch (error) {
      res.status(500).json({ error: 'Failed to load memory cards.' });
    }
  });

  app.post('/api/memory-cards', async (req, res) => {
    try {
      const card = req.body || {};
      if (!card.word) {
        return res.status(400).json({ error: 'Missing required field: word.' });
      }
      await userStore.upsertMemoryCard(card, req.userId);
      res.status(201).json(await userStore.listMemoryCards(500, req.userId));
    } catch (error) {
      res.status(500).json({ error: 'Failed to save memory card.' });
    }
  });

  app.delete('/api/memory-cards/:id', async (req, res) => {
    try {
      const removed = await userStore.deleteMemoryCard(req.params.id, req.userId);
      if (!removed) {
        return res.status(404).json({ error: 'Memory card not found.' });
      }
      res.json(await userStore.listMemoryCards(500, req.userId));
    } catch (error) {
      res.status(500).json({ error: 'Failed to delete memory card.' });
    }
  });

  // 限流后的当日复习队列 + 配额（newCardsPerDay / reviewLimitPerDay 在此生效）
  app.get('/api/memory-review-queue', async (req, res) => {
    try {
      res.json(await buildStoreReviewQueue(userStore, req.userId, getMemorySettings()));
    } catch (error) {
      res.status(500).json({ error: 'Failed to build review queue.' });
    }
  });

  app.post('/api/memory-cards/:id/review', async (req, res) => {
    try {
      const { grade } = req.body || {};
      if (!['forgot', 'hard', 'good'].includes(grade)) {
        return res.status(400).json({ error: 'Invalid review grade.' });
      }
      const settings = getMemorySettings();
      const updated = await userStore.reviewMemoryCard(req.params.id, grade, settings, req.userId);
      if (!updated) {
        return res.status(404).json({ error: 'Memory card not found.' });
      }
      const stats = await userStore.getDailyReviewStats(req.userId);
      res.json({
        updated,
        cards: await userStore.listMemoryCards(500, req.userId),
        quota: buildDailyQuota(stats, settings)
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to review memory card.' });
    }
  });

  app.get('/api/memory-settings', (req, res) => {
    res.json(getMemorySettings());
  });

  app.post('/api/memory-settings', (req, res) => {
    try {
      res.json(saveMemorySettings(req.body || {}));
    } catch (error) {
      res.status(500).json({ error: 'Failed to save memory settings.' });
    }
  });

  app.get('/api/knowledge/embedding-settings', (req, res) => {
    const { apiKey, ...rest } = getKnowledgeEmbeddingSettings(db);
    res.json({ ...rest, apiKeySet: !!apiKey });
  });
  app.post('/api/knowledge/embedding-settings', (req, res) => {
    const saved = saveKnowledgeEmbeddingSettings(db, req.body || {});
    knowledgeReindexQueue.schedule();
    const { apiKey, ...rest } = saved;
    res.json({ ...rest, apiKeySet: !!apiKey });
  });
}
