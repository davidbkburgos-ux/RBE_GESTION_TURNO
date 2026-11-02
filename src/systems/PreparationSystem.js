(function () {
  const BK = window.BK;
  const U = BK.util;

  // Preparación general: arranca a 0 % y solo avanza con trabajo real (empleados en su puesto y encargado ayudando).
  // prepRate = baseRate × dificultad × Σ por estación (peso del puesto × rendimiento decreciente por empleado) × apoyo del encargado.
  class PreparationSystem {
    constructor(G) { this.G = G; this.reset(); BK.bus.on('opening:answered', (e) => { if (e.ok) this.onCheckCorrect(); }); }
    get cfg() { return this.G.cfg.operations.preparation; }
    get info() { return this.G.cfg.operations.stationInfo; }
    reset() {
      this.progress = 0;
      this.stations = {};      // posición -> { cycle, workers, managerHelping, rate }
      this.completed = false;
      this.managerHelping = null;
      this.lastRate = 0;
    }
    get active() {
      const G = this.G;
      return G.state === 'playing' && ['PREPARATION', 'OPENING_CHECKS'].includes(G.restaurantState) && !G.opening.doorOpen && this.progress < 100;
    }
    workers() {
      return this.G.employees.list.filter((c) => c.available && !c.absent && c.status === 'WORKING' && c.position && this.info[c.position] && !c.moving);
    }
    helpingStation() {
      const G = this.G, p = G.player.char;
      if (G.player.char.moving) return null;
      let best = null, bd = 80;
      Object.keys(this.info).forEach((id) => {
        const s = G.cfg.operations.stations[id];
        if (!s || id === 'support') return;
        const d = Math.hypot(s.pos[0] - p.x, s.pos[1] - p.y);
        if (d < bd) { bd = d; best = id; }
      });
      return best;
    }
    // Contribución por estación con rendimientos decrecientes (configurables).
    stationRates() {
      const G = this.G, dr = this.cfg.diminishingReturns, out = {};
      const byStation = {};
      this.workers().forEach((c) => { (byStation[c.position] = byStation[c.position] || []).push(this.info[c.position].prepWeight * G.employees.workSpeedFor(c, c.category)); });
      this.managerHelping = this.helpingStation();
      if (this.managerHelping) (byStation[this.managerHelping] = byStation[this.managerHelping] || []).push(this.info[this.managerHelping].prepWeight * this.cfg.managerSupportModifier);
      const diff = this.cfg.difficultyRate[G.save.settings.difficulty] || 1;
      const base = this.cfg.baseRatePerGameMinute * diff;
      Object.entries(byStation).forEach(([id, ws]) => {
        ws.sort((a, b) => b - a);
        const sum = ws.reduce((n, w, i) => n + w * (dr[Math.min(i, dr.length - 1)]), 0);
        out[id] = { rate: base * sum, workers: ws.length };
      });
      return out;
    }
    update(dt) {
      const G = this.G;
      if (!this.active) { this.stations = {}; this.lastRate = 0; return; }
      const rates = this.stationRates(), gm = dt * G.clock.scale;
      let total = 0;
      Object.keys(this.stations).forEach((id) => { if (!rates[id]) delete this.stations[id]; });
      Object.entries(rates).forEach(([id, r]) => {
        const st = this.stations[id] || (this.stations[id] = { cycle: Math.random() * 0.3 });
        st.rate = r.rate; st.workers = r.workers;
        st.cycle += dt / this.cfg.taskCycleSec;
        if (st.cycle >= 1) st.cycle -= 1;
        total += r.rate;
      });
      this.lastRate = total;
      const before = this.progress;
      this.progress = Math.min(100, this.progress + total * gm);
      if (Math.floor(before / 25) < Math.floor(this.progress / 25) && this.progress < 100) BK.bus.emit('prep:milestone', { progress: Math.floor(this.progress) });
      if (this.progress >= 100 && !this.completed) { this.completed = true; BK.bus.emit('prep:complete', {}); }
    }
    // Un acierto en una revisión de apertura aporta un pequeño avance de preparación.
    onCheckCorrect() {
      if (this.active) this.progress = Math.min(100, this.progress + this.cfg.checkBonusPct);
    }
    // Barras contextuales sobre cada estación en la que se trabaja.
    bars() {
      const G = this.G;
      if (!this.active) return [];
      return Object.entries(this.stations).map(([id, st]) => {
        const s = G.cfg.operations.stations[id], inf = this.info[id];
        return { x: s.pos[0], y: s.pos[1] - 58, icon: inf.icon, text: 'PREPARANDO ' + inf.tag, f: U.clamp(st.cycle, 0, 1), manager: this.managerHelping === id };
      });
    }
    // Penalización o mejora al abrir según el grado de preparación (se suma a la penalización de checklist existente).
    onOpen() {
      const G = this.G, miss = 100 - this.progress;
      const pts = miss > 5 ? -Math.round(miss * this.cfg.openPenaltyPerPct) : this.progress >= 95 ? this.cfg.openBonus : 0;
      G.production.openingExtraStockUseChance = Math.min(0.6, (G.production.openingExtraStockUseChance || 0) + miss / 100 * this.cfg.openStockRisk);
      if (pts) G.scoring.add(pts, pts < 0 ? 'Apertura con preparación incompleta (' + Math.round(this.progress) + ' %)' : 'Preparación completa al abrir', null, 'preparation');
      this.openedWith = Math.round(this.progress);
    }
    snapshot() { return { progress: this.progress }; }
    restore(s) { if (s) this.progress = s.progress || 0; }
  }
  BK.PreparationSystem = PreparationSystem;
})();
