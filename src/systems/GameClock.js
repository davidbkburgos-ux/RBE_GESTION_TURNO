(function () {
  const BK = window.BK;

  class GameClock {
    constructor(cfg) {
      const U = BK.util;
      this.cfg = cfg;
      this.start = U.parseHM(cfg.day.start);
      this.open = U.parseHM(cfg.day.open, this.start);
      this.close = U.parseHM(cfg.day.close, this.start);
      this.scale = cfg.day.timeScale;
      this.t = this.start;
      this.lastMin = Math.floor(this.t);
      this.ended = false;
      this.phases = cfg.phases.map((p) => Object.assign({}, p, { fromM: U.parseHM(p.from, this.start), toM: U.parseHM(p.to, this.start) }));
    }
    setScale(s) { this.scale = s; }
    set(t) { this.t = t; this.lastMin = Math.floor(t); this.ended = t >= this.close; }
    update(dt) {
      if (this.ended) return;
      this.t += dt * this.scale;
      const m = Math.floor(this.t);
      while (this.lastMin < m) {
        this.lastMin++;
        BK.bus.emit('clock:minute', { t: this.lastMin });
        if (this.lastMin % 60 === 0) BK.bus.emit('clock:hour', { t: this.lastMin });
      }
      if (this.t >= this.close) { this.t = this.close; this.ended = true; BK.bus.emit('clock:end', {}); }
    }
    get phase() {
      return this.phases.find((p) => this.t >= p.fromM && this.t < p.toM) || this.phases[this.phases.length - 1];
    }
    phaseProgress(p = this.phase) { return BK.util.clamp((this.t - p.fromM) / (p.toM - p.fromM), 0, 1); }
    get label() { return BK.util.fmtClock(this.t); }
  }
  BK.GameClock = GameClock;
})();
