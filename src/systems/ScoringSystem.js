(function () {
  const BK = window.BK;

  // Puntuación, combo y métricas del turno. Todos los valores salen de config.score.
  class ScoringSystem {
    constructor(G) { this.G = G; this.reset(); }
    get c() { return this.G.cfg.score; }
    reset() {
      this.score = 0;
      this.streak = 0;
      this.categories = { opening: 0, service: 0, team: 0, customer: 0, operational: 0, csl: 0, preparation: 0, reputation: 0, staffing: 0, waste: 0 };
      this.m = { excellent: 0, acceptable: 0, failed: 0, checksOk: 0, checksWrong: 0, checksMissed: 0, negativeReviews: 0, lateMin: 0, bestStreak: 0, priorityChanges: 0, priorityEffective: 0, tablesCleaned: 0, respTotal: 0, respN: 0, byChannel: {}, byType: {}, openedAt: null };
    }
    get multiplier() {
      const c = this.c;
      if (this.streak < c.comboStartsAt) return 1;
      return Math.min(c.comboMax, 1 + c.comboStep * (this.streak - c.comboStartsAt + 1));
    }
    add(pts, reason, pos, category) {
      this.score += pts;
      const key = category || 'operational';
      this.categories[key] = (this.categories[key] || 0) + pts;
      BK.bus.emit('score:change', { score: this.score, delta: pts, reason, pos, category: key });
    }
    breakCombo() {
      if (this.streak > 0) BK.bus.emit('combo:break', { streak: this.streak });
      this.streak = 0;
      BK.bus.emit('combo:change', { streak: 0, mult: 1 });
    }
    openingCheck(correct, pos) {
      if (correct) { this.m.checksOk++; this.add(this.c.openingCheckCorrect, 'Revisión correcta', pos, 'opening'); }
      else { this.m.checksWrong++; this.add(this.c.openingCheckWrong, 'Revisión incorrecta', pos, 'opening'); this.breakCombo(); }
    }
    cslCheck(correct, pos) {
      this.m.cslOk = this.m.cslOk || 0; this.m.cslWrong = this.m.cslWrong || 0;
      if (correct) { this.m.cslOk++; this.add(this.c.cslCheckCorrect, 'Revisión CSL correcta', pos, 'csl'); }
      else { this.m.cslWrong++; this.add(this.c.cslCheckWrong, 'Revisión CSL incorrecta', pos, 'csl'); this.breakCombo(); }
    }
    eventResult(ev, result) {
      const c = this.c, ov = (this.G.ev.types[ev.type] || {}).scoreOverride || {};
      const m = this.m;
      m[result]++;
      (m.byChannel[ev.channel] = m.byChannel[ev.channel] || { excellent: 0, acceptable: 0, failed: 0 })[result]++;
      (m.byType[ev.type] = m.byType[ev.type] || { excellent: 0, acceptable: 0, failed: 0 })[result]++;
      if (result !== 'failed' && ev.responseTime != null) { m.respTotal += ev.responseTime; m.respN++; }
      let pts = ov[result] !== undefined ? ov[result] : c[result];
      if (result === 'excellent') {
        this.streak++;
        m.bestStreak = Math.max(m.bestStreak, this.streak);
        pts = Math.round(pts * this.multiplier);
      } else if (result === 'failed') {
        this.breakCombo();
      }
      if (ev.type === 'dirtyTable' && result !== 'failed') m.tablesCleaned++;
      BK.bus.emit('combo:change', { streak: this.streak, mult: this.multiplier });
      this.add(pts, result, ev.location, ev.type === 'complaint' ? 'customer' : 'service');
      return pts;
    }
    snapshot() { return { score: this.score, streak: this.streak, m: this.m, categories: this.categories }; }
    restore(s) { if (!s) return; this.score = s.score; this.streak = s.streak; Object.assign(this.m, s.m); if (s.categories) Object.assign(this.categories, s.categories); }
  }
  BK.ScoringSystem = ScoringSystem;
})();
