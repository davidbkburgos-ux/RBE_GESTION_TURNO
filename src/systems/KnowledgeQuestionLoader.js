(function () {
  const BK = window.BK;
  const ZONE_ALIASES = {
    HOTPRODUCTION: 'KITCHEN', KITCHEN: 'KITCHEN', COLDROOMS: 'COLD_ROOMS', STORAGE: 'STORAGE',
    HALL: 'DINING', DINING: 'DINING', RESTROOMS: 'RESTROOMS', EXTERIOR: 'EXTERIOR',
    COUNTER: 'COUNTER', KIOSKS: 'KIOSKS', AUTOKING: 'AUTO_KING', DELIVERY: 'DELIVERY'
  };
  const TOPICS_BY_ZONE = {
    KITCHEN: ['FOOD_SAFETY', 'TEMPERATURES', 'EQUIPMENT'],
    COLD_ROOMS: ['STOCK', 'CONSERVATION', 'ROTATION'],
    STORAGE: ['STOCK', 'CONSERVATION', 'ROTATION'],
    DINING: ['CLEANING', 'CUSTOMER_EXPERIENCE', 'SERVICE'],
    RESTROOMS: ['CLEANING', 'SUPPLIES', 'HYGIENE'],
    EXTERIOR: ['EXTERIOR', 'CUSTOMER_TRAFFIC'],
    COUNTER: ['SERVICE', 'CUSTOMER_EXPERIENCE', 'SERVICE_SPEED'],
    KIOSKS: ['SERVICE', 'CUSTOMER_EXPERIENCE'],
    AUTO_KING: ['DRIVE_THRU', 'SERVICE_SPEED', 'SERVICE'],
    DELIVERY: ['DELIVERY', 'SERVICE']
  };

  class ZoneAwareQuestionGenerator {
    constructor(data, game) {
      this.game = game;
      this.pools = data.pools || {};
      this.questions = Object.values(this.pools).flat();
      this.used = {};
      this.recent = {};
      const invalid = this.questions.find((q) =>
        !q.id || !Array.isArray(q.zones) || !q.zones.length ||
        !Array.isArray(q.topics) || !Array.isArray(q.taskTypes) ||
        !q.sourceId || typeof q.correct !== 'string' || !Array.isArray(q.distractors));
      if (invalid) throw new Error('Pregunta sin metadatos de zona/tarea/fuente: ' + (invalid.id || 'sin id'));
    }

    normalizeZone(zoneId) {
      const normalized = String(zoneId || '').replace(/[^a-z]/gi, '').toUpperCase();
      return ZONE_ALIASES[normalized] || normalized;
    }

    generateQuestion({ zone, interactionId, taskType = 'CSL', action = '', restaurantState, gameTime, questionsAlreadySeen = [], onlyTopics = null }) {
      const zoneId = this.normalizeZone(zone);
      if (!zoneId) throw new Error('ZoneAwareQuestionGenerator requiere zoneId.');
      let candidates = this.questions.filter((q) => q.zones.includes(zoneId));
      // Tareas temáticas (p. ej. factores críticos): solo preguntas de los temas indicados.
      if (onlyTopics && onlyTopics.length) candidates = this.questions.filter((q) => q.topics.some((t) => onlyTopics.includes(t)));
      if (!candidates.length) return null;
      if (action === 'clean') candidates = candidates.filter((q) => q.topics.includes('CLEANING'));
      if (!candidates.length) return null;
      const key = zoneId + ':' + taskType;
      const used = this.used[key] || [];
      const recent = this.recent[key] || [];
      let eligible = candidates.filter((q) => q.taskTypes.includes(taskType));
      if (!eligible.length) return null;
      // Las preguntas ya falladas en esta revisión nunca se repiten mientras exista otra alternativa.
      const banned = new Set(questionsAlreadySeen || []);
      const fresh = eligible.filter((q) => !banned.has(q.id));
      if (fresh.length) eligible = fresh;
      let unseen = eligible.filter((q) => !used.includes(q.id));
      if (!unseen.length) {
        // Banco agotado: se reinicia el ciclo conservando la última pregunta para no repetirla seguida.
        this.used[key] = [];
        unseen = eligible.filter((q) => !recent.slice(-1).includes(q.id));
      }
      if (unseen.length) eligible = unseen;
      const preferredTopics = new Set(TOPICS_BY_ZONE[zoneId] || []);
      if (action === 'clean') preferredTopics.add('CLEANING');
      const weighted = eligible.map((q) => {
        const topicMatch = q.topics.some((topic) => preferredTopics.has(topic));
        const difficulty = this.game && this.game.save ? this.game.save.settings.difficulty : null;
        const difficultyMatch = q.difficulty === 'ANY' || q.difficulty === difficulty;
        const freshness = recent.includes(q.id) ? 0.1 : 3;
        const weight = 10 * 8 * (topicMatch ? 2 : 1) * (difficultyMatch ? 1.5 : 1) * freshness;
        return { question: q, weight };
      });
      const total = weighted.reduce((sum, item) => sum + item.weight, 0);
      let pick = BK.util.rnd(0, total);
      let selected = weighted[weighted.length - 1].question;
      for (const item of weighted) {
        pick -= item.weight;
        if (pick <= 0) { selected = item.question; break; }
      }
      this.used[key] = [...used, selected.id];
      this.recent[key] = [...recent.filter((id) => id !== selected.id), selected.id].slice(-3);
      const options = BK.util.shuffle([
        { text: selected.correct, correct: true },
        ...selected.distractors.map((text) => ({ text, correct: false }))
      ]);
      return {
        id: selected.id, zones: selected.zones, topics: selected.topics, taskTypes: selected.taskTypes,
        sourceId: selected.sourceId, interactionId, zoneId, taskType, action, restaurantState, gameTime,
        correctAnswer: selected.correct, topic: selected.topics[0], question: selected.question,
        options, correctIndex: options.findIndex((option) => option.correct),
        explanation: selected.explanation, difficulty: selected.difficulty
      };
    }

    next(poolId) {
      const pool = this.pools[poolId];
      if (!pool || !pool.length) return null;
      const selected = BK.util.pick(pool);
      return this.generateQuestion({
        zone: selected.zones[0], taskType: selected.taskTypes[0], interactionId: selected.id
      });
    }

    forTask(task) {
      const question = this.generateQuestion({
        zone: task.zone,
        interactionId: task.id,
        taskType: task.taskType || 'OPENING',
        action: task.action,
        restaurantState: this.game && this.game.restaurantState,
        gameTime: this.game && this.game.clock.t,
        questionsAlreadySeen: task.questionsAlreadySeen || [],
        onlyTopics: task.onlyTopics || null
      });
      if (!question) throw new Error('No hay pregunta documental para ' + task.id + ' en la zona ' + task.zone + '.');
      return question;
    }
  }

  BK.ZoneAwareQuestionGenerator = ZoneAwareQuestionGenerator;
  BK.KnowledgeQuestionLoader = ZoneAwareQuestionGenerator;
  BK.KnowledgeQuestionGenerator = ZoneAwareQuestionGenerator;
})();
