(function () {
  const BK = window.BK;

  // Rutina de apertura: cinco tareas con checklist y apertura de puerta por separado.
  class OpeningRoutineSystem {
    constructor(G) {
      this.G = G;
      this.reset();
      BK.bus.on('clock:minute', (e) => this.onMinute(e.t));
    }
    reset() {
      this.tasks = this.G.openingData.openingTasks.map((t) => ({ ...t, done: false, correct: null }));
      this.cslTasks = (this.G.openingData.cslTasks || []).map((t) => ({ ...t, csl: true, taskType: 'CSL', done: false, correct: null }));
      this.cslActive = false;
      this.cslClosed = false;
      this.cslStart = BK.util.parseHM(this.G.cfg.csl.start, this.G.clock.start);
      this.cslDeadline = BK.util.parseHM(this.G.cfg.csl.deadline, this.G.clock.start);
      this.doorOpen = false;
      this.openedAtT = null;
      this.lateBlocks = 0;
      this.current = null;
      this.checklistClosed = false;
      this.confirmedOpen = false;
      this.penaltyApplied = false;
      this.checklistDeadline = BK.util.parseHM(this.G.openingData.checklistDeadline || '11:15', this.G.clock.start);
      this.G.nav && this.G.nav.setDoorOpen(false);
    }
    task(id) { return this.tasks.find((t) => t.id === id) || this.cslTasks.find((t) => t.id === id); }
    // Tareas que se muestran en el panel: la rutina de apertura o, en la franja posterior a la comida, el recorrido CSL.
    get visibleTasks() { return this.cslActive ? this.cslTasks : this.tasks; }
    get cslPending() { return this.cslTasks.filter((t) => !t.done); }
    get checks() { return this.tasks.filter((t) => t.questionPool); }
    get checksDone() { return this.checks.every((t) => t.done || t.skipped || t.correct === false); }
    get pending() { return this.tasks.filter((t) => t.required && !t.done); }
    get isOpen() { return this.doorOpen; }
    get lateMinutes() { return this.openedAtT !== null ? Math.max(0, Math.floor(this.openedAtT - this.G.clock.open)) : 0; }
    openingReadiness() {
      const tasks = this.tasks.filter((task) => task.required && task.action !== 'door');
      const incorrectTasks = tasks.filter((task) => task.correct === false && !task.skipped);
      const omittedTasks = tasks.filter((task) => task.skipped);
      const pendingTasks = tasks.filter((task) => !task.done && task.correct !== false);
      const completedTasks = tasks.filter((task) => task.done && !task.skipped && task.correct !== false);
      const criticalFailures = tasks.filter((task) => task.critical && (task.skipped || !task.done || task.correct === false));
      return {
        completedTasks, incorrectTasks, omittedTasks, pendingTasks, criticalFailures,
        readiness: tasks.length ? Math.round((completedTasks.length / tasks.length) * 100) : 100
      };
    }

    calculateOpeningPenalty(readiness = this.openingReadiness()) {
      const cfg = this.G.cfg.operations.openingPenalty;
      if (this.penaltyApplied) return { total: 0, components: {}, readiness, lateMinutes: this.lateMinutes };
      const unpenalizedIncorrect = readiness.incorrectTasks.filter((task) => !task.penaltyApplied).length;
      const unpenalizedOmitted = readiness.omittedTasks.filter((task) => !task.penaltyApplied).length;
      const pending = readiness.pendingTasks.filter((task) => !task.penaltyApplied).length;
      const lateMinutes = Math.max(0, Math.floor(this.G.clock.t - this.G.clock.open));
      const components = {
        incorrect: unpenalizedIncorrect * cfg.incorrectTask,
        omitted: unpenalizedOmitted * cfg.omittedTask,
        pending: pending * cfg.pendingTask,
        critical: readiness.criticalFailures.length * cfg.criticalFailure,
        late: lateMinutes * cfg.latePerMinute
      };
      return {
        total: Object.values(components).reduce((sum, value) => sum + value, 0),
        components, readiness, lateMinutes
      };
    }

    pointOf(t) { return this.G.map.points[t.point]; }

    // El jugador llega a un punto de apertura
    // Estados de una revisión: NOT_STARTED, IN_PROGRESS, FAILED (repetible con pregunta nueva) y PASSED.
    statusOf(t) { return t.skipped ? 'SKIPPED' : t.done && t.correct !== false ? 'PASSED' : t.correct === false ? (t.done ? 'FAILED_FINAL' : 'FAILED') : t.status === 'IN_PROGRESS' ? 'IN_PROGRESS' : 'NOT_STARTED'; }
    arrive(task) {
      const G = this.G;
      if (task.csl) {
        if (!this.cslActive || this.cslClosed) { BK.bus.emit('opening:checklistClosed', { task }); return; }
        if (task.done) { BK.bus.emit('opening:repeat', task); return; }
        const q = G.questions.forTask(task);
        this.current = { task, q }; task.status = 'IN_PROGRESS';
        BK.bus.emit('opening:question', { task, q, anchor: this.pointOf(task) });
        return;
      }
      if (task.questionPool) G.restaurantState = 'OPENING_CHECKS';
      if (task.checklist && (this.checklistClosed || G.clock.t >= this.checklistDeadline)) {
        BK.bus.emit('opening:checklistClosed', { task });
        return;
      }
      if (task.action === 'door') return this.tryOpenDoor();
      if (task.done) { BK.bus.emit('opening:repeat', task); return; }
      const q = G.questions.forTask(task);
      this.current = { task, q }; task.status = 'IN_PROGRESS';
      BK.bus.emit('opening:question', { task, q, anchor: this.pointOf(task) });
    }
    answer(idx) {
      const cur = this.current;
      if (!cur) return null;
      const t = cur.task, ok = idx === cur.q.correctIndex, first = !t.scored;
      t.attempts = (t.attempts || 0) + 1;
      t.correct = ok; t.done = ok; t.status = ok ? 'PASSED' : 'FAILED';
      t.penaltyApplied = true; t.scored = true;
      if (!ok) t.questionsAlreadySeen = [...(t.questionsAlreadySeen || []), cur.q.id];
      this.current = null;
      // La puntuación se aplica solo en el primer intento; corregir después no vuelve a puntuar ni a penalizar.
      if (t.csl) {
        if (first) this.G.scoring.cslCheck(ok, this.pointOf(t));
        BK.bus.emit('opening:answered', { task: t, ok, q: cur.q, idx, retry: !first });
        if (!this.cslPending.length) BK.bus.emit('csl:complete', { tasks: this.cslTasks });
        return ok;
      }
      if (first) this.G.scoring.openingCheck(ok, this.pointOf(t));
      BK.bus.emit('opening:answered', { task: t, ok, q: cur.q, idx, retry: !first });
      if (this.checksDone) {
        this.G.restaurantState = 'PREPARATION';
        BK.bus.emit('opening:allReviewed', {});
      }
      return ok;
    }
    cancelQuestion() {
      if (this.current) this.current.task.status = this.current.task.correct === false ? 'FAILED' : 'NOT_STARTED';
      this.current = null;
    }

    tryOpenDoor() {
      const G = this.G, door = this.task('open-door');
      if (this.doorOpen) { BK.bus.emit('opening:repeat', door); return false; }
      const readiness = this.openingReadiness();
      if (readiness.readiness < 100 && !this.confirmedOpen) {
        BK.bus.emit('opening:confirmRequired', { readiness });
        return false;
      }
      return true;
    }
    confirmOpenAnyway() {
      if (this.doorOpen || this.confirmedOpen) return false;
      this.confirmedOpen = true;
      BK.bus.emit('opening:openConfirmed', { readiness: this.openingReadiness() });
      return true;
    }
    // Se invoca al terminar la animación de abrir puerta
    openDoor() {
      const G = this.G, door = this.task('open-door');
      if (this.doorOpen) return;
      const readiness = this.openingReadiness();
      const penalty = this.calculateOpeningPenalty(readiness);
      G.production.applyOpeningRisk(readiness);
      G.prep.onOpen();
      if (penalty.total) G.scoring.add(penalty.total, 'Penalización por preparación incompleta', this.pointOf(door), 'opening');
      this.penaltyApplied = true;
      this.doorOpen = true; door.done = true;
      this.openedAtT = G.clock.t;
      G.nav.setDoorOpen(true);
      const late = this.lateMinutes;
      G.scoring.m.lateMin = late;
      G.scoring.m.openedAt = G.clock.t;
      if (G.clock.t < G.clock.open) G.scoring.add(G.cfg.score.openBeforeOpening, 'Apertura anticipada', this.pointOf(door), 'opening');
      BK.bus.emit('opening:penalty', {
        penalty: penalty.total, openingScore: G.scoring.categories.opening,
        readiness: readiness.readiness, incorrect: readiness.incorrectTasks.length,
        omitted: readiness.omittedTasks.length, pending: readiness.pendingTasks.length,
        critical: readiness.criticalFailures.length, lateMinutes: penalty.lateMinutes
      });
      BK.bus.emit('opening:opened', { late, onTime: G.clock.t < G.clock.open, readiness: readiness.readiness });
    }
    onMinute(t) {
      const G = this.G, c = G.cfg.score;
      this.onCslMinute(t);
      if (!this.checklistClosed && t >= this.checklistDeadline) {
        this.checklistClosed = true;
        const penalty = G.cfg.operations.checklistMissPenalty;
        this.tasks.filter((task) => task.checklist && !task.done).forEach((task) => {
          task.done = true;
          if (task.correct === false) { task.status = 'FAILED_FINAL'; return; }
          task.skipped = true;
          task.penaltyApplied = true;
          G.scoring.m.checksMissed = (G.scoring.m.checksMissed || 0) + 1;
          G.scoring.add(penalty, 'Tarea de apertura omitida: ' + task.label, this.pointOf(task), 'opening');
          G.scoring.breakCombo();
        });
        if (this.current && this.current.task.checklist) this.current = null;
        G.player.locked = false;
        BK.bus.emit('opening:checklistEnd', { tasks: this.tasks.filter((task) => task.skipped), penalty });
      }
      if (this.doorOpen || t <= G.clock.open || G.state !== 'playing') return;
      const mins = t - G.clock.open;
      if (mins % c.lateBlockMinutes === 0) {
        this.lateBlocks++;
        G.scoring.m.lateMin = mins;
        G.scoring.add(c.lateBlockPenalty, 'Retraso en la apertura', this.pointOf(this.task('open-door')), 'opening');
        BK.bus.emit('opening:late', { minutes: mins, pts: c.lateBlockPenalty });
      }
    }
    // Segundo recorrido CSL, tras el pico de comida: el servicio no se detiene mientras se realiza.
    onCslMinute(t) {
      const G = this.G;
      if (G.state !== 'playing' || !this.doorOpen || this.cslClosed) return;
      if (!this.cslActive && t >= this.cslStart) {
        this.cslActive = true;
        BK.bus.emit('csl:start', { deadline: G.cfg.csl.deadline, tasks: this.cslTasks });
      }
      if (this.cslActive && t >= this.cslDeadline) {
        this.cslClosed = true;
        const miss = G.cfg.csl.missPenalty;
        const omitted = this.cslTasks.filter((task) => !task.done && task.correct !== false);
        this.cslTasks.filter((task) => !task.done && task.correct === false).forEach((task) => { task.done = true; task.status = 'FAILED_FINAL'; });
        omitted.forEach((task) => {
          task.done = true; task.skipped = true; task.penaltyApplied = true;
          G.scoring.m.cslMissed = (G.scoring.m.cslMissed || 0) + 1;
          G.scoring.add(miss, 'Recorrido CSL: tarea omitida', this.pointOf(task), 'csl');
          G.scoring.breakCombo();
        });
        if (this.current && this.current.task.csl) { this.current = null; G.player.locked = false; }
        BK.bus.emit('csl:end', { omitted, penalty: miss });
      }
    }
    snapshot() { return { done: this.tasks.map((t) => [t.id, t.done, t.correct, !!t.skipped, !!t.penaltyApplied, t.attempts || 0, !!t.scored]), csl: this.cslTasks.map((t) => [t.id, t.done, t.correct, !!t.skipped, t.attempts || 0, !!t.scored]), cslActive: this.cslActive, cslClosed: this.cslClosed, doorOpen: this.doorOpen, openedAtT: this.openedAtT, lateBlocks: this.lateBlocks, checklistClosed: this.checklistClosed, confirmedOpen: this.confirmedOpen, penaltyApplied: this.penaltyApplied }; }
    restore(s) {
      if (!s) return;
      (s.csl || []).forEach(([id, d, c, skipped, att, sc]) => { const t = this.cslTasks.find((x) => x.id === id); if (t) { t.done = d; t.correct = c; t.skipped = !!skipped; t.attempts = att || 0; t.scored = !!sc || d; } });
      this.cslActive = !!s.cslActive; this.cslClosed = !!s.cslClosed;
      s.done.forEach(([id, d, c, skipped, penaltyApplied, att, sc]) => { const t = this.task(id); if (t) { t.done = d; t.correct = c; t.skipped = !!skipped; t.penaltyApplied = !!penaltyApplied; t.attempts = att || 0; t.scored = !!sc || d; } });
      this.doorOpen = s.doorOpen; this.openedAtT = s.openedAtT; this.lateBlocks = s.lateBlocks || 0;
      this.checklistClosed = !!s.checklistClosed;
      this.confirmedOpen = !!s.confirmedOpen; this.penaltyApplied = !!s.penaltyApplied;
      if (this.doorOpen) this.G.nav.setDoorOpen(true);
    }
  }
  BK.OpeningRoutineSystem = OpeningRoutineSystem;
})();
