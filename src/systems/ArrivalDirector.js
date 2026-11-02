(function () {
  const BK = window.BK;
  const CHANNELS = ['counter', 'kiosk', 'autoking', 'delivery', 'dining'];
  const BASE_INTERVAL = { counter: 18, kiosk: 26, autoking: 32, delivery: 40, dining: 36 };

  class ArrivalDirector {
    constructor(G) {
      this.G = G;
      this.reset();
      BK.bus.on('restaurant:opened', () => {
        this.openedAt = G.time;
        this.lastActivityAt = G.time;
        this.stalled = false;
        Object.keys(this.timers).forEach((channel) => { this.timers[channel] = Math.min(this.timers[channel], this.nextBetween(2, 6)); });
      });
      BK.bus.on('arrival:created', () => { this.lastActivityAt = G.time; this.stalled = false; });
    }
    reset(seed) {
      this.seed = (seed || Date.now()) >>> 0;
      this.initialSeed = this.seed;
      this.timers = Object.fromEntries(CHANNELS.map((c) => [c, this.nextBetween(2, 6)]));
      this.arrivals = Object.fromEntries(CHANNELS.map((c) => [c, 0]));
      this.openedAt = null;
      this.lastActivityAt = null;
      this.stalled = false;
      this.raining = false;
    }
    random() {
      this.seed = (1664525 * this.seed + 1013904223) >>> 0;
      return this.seed / 4294967296;
    }
    nextBetween(a, b) { return a + this.random() * (b - a); }
    // Perfil del día: plantilla y carga salen de la semilla dentro de los rangos de la dificultad.
    static dayProfile(cfg, diffKey, seed) {
      const base = cfg.difficultyProfiles[diffKey];
      let a = ((Number(seed) || 1) ^ 0x9E3779B9) >>> 0;
      const rnd = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
      const [s0, s1] = base.staffRange, [l0, l1] = base.load;
      const staff = s0 + Math.floor(rnd() * (s1 - s0 + 1));
      const loadK = rnd();
      const load = l0 + loadK * (l1 - l0);
      const lunchShare = 0.36 + rnd() * 0.28;
      // Lluvia: la probabilidad prevista es pública; que llueva o no, y cuándo, sale de la misma semilla.
      const W = cfg.operations.weather;
      const chance = Math.round((0.05 + rnd() * 0.9) * 20) * 5;
      const active = rnd() * 100 < chance;
      const fromStart = rnd() < W.fromStartChance, startRnd = rnd(), durRnd = rnd(), intRnd = rnd();
      const start = fromStart ? 540 : Math.round(W.startRangeMin[0] + startRnd * (W.startRangeMin[1] - W.startRangeMin[0]));
      const end = Math.min(1500, start + Math.round(W.durationRangeMin[0] + durRnd * (W.durationRangeMin[1] - W.durationRangeMin[0])));
      const rain = { chance, active, start, end, intensity: +(W.intensityRange[0] + intRnd * (W.intensityRange[1] - W.intensityRange[0])).toFixed(2) };
      return Object.assign({}, base, {
        staff, mealShift: Math.max(1, Math.min(staff - 1, Math.round(staff / 2))),
        demand: +(staff * load).toFixed(3), loadLevel: loadK, lunchShare, rain
      });
    }
    // Intensidad de lluvia (0–1) a una hora dada (minutos del día), con transición suave al empezar y acabar.
    static rainLevel(cfg, profile, t) {
      const r = profile && profile.rain;
      if (!r || !r.active || t < r.start || t > r.end) return 0;
      const ramp = cfg.operations.weather.rampMin;
      return r.intensity * Math.max(0, Math.min(1, (t - r.start) / ramp, (r.end - t) / ramp));
    }
    // Intervalo medio entre llegadas (segundos de referencia a 1,2 min de juego/seg).
    static baseInterval(cfg, profile, phaseId, progress, channel) {
      const curves = cfg.operations.demandCurves;
      const row = curves[phaseId] || curves.prep;
      const pressure = row[channel] || 0;
      if (!pressure) return Infinity;
      const peak = 1 + (profile.peak - 1) * Math.sin(Math.PI * progress);
      const share = profile.lunchShare === undefined ? 0.5 : profile.lunchShare;
      const mix = ['lunch', 'afternoon'].includes(phaseId) ? 2 * share : ['dinner', 'night'].includes(phaseId) ? 2 * (1 - share) : 1;
      return Math.max(4, BASE_INTERVAL[channel] / (profile.demand * pressure * peak * mix));
    }
    // Llegadas esperadas por hora de juego (12:00–01:00), calculadas con el mismo modelo que la simulación.
    static hourlyForecast(cfg, profile) {
      const hm = (s, end) => { const [h, m] = s.split(':').map(Number); const v = h + m / 60; return end && v <= 6 ? v + 24 : v; };
      const phases = cfg.phases.filter((p) => cfg.operations.demandCurves[p.id]).map((p) => ({ id: p.id, from: hm(p.from), to: hm(p.to, true) }));
      return Array.from({ length: 13 }, (_, i) => {
        const mid = 12 + i + 0.5, ph = phases.find((p) => mid >= p.from && mid < p.to);
        if (!ph) return 0;
        const progress = (mid - ph.from) / (ph.to - ph.from);
        return CHANNELS.reduce((n, c) => { const iv = ArrivalDirector.baseInterval(cfg, profile, ph.id, progress, c); return n + (Number.isFinite(iv) ? 50 / iv : 0); }, 0);
      });
    }
    interval(channel) {
      const G = this.G;
      const phase = G.clock.phase;
      const profile = G.dayProfile || G.cfg.difficultyProfiles[G.save.settings.difficulty];
      const iv = ArrivalDirector.baseInterval(G.cfg, profile, phase.id, G.clock.phaseProgress(phase), channel);
      const rain = BK.ArrivalDirector.rainLevel(G.cfg, profile, G.clock.t);
      const wm = G.cfg.operations.weather.demandMult[channel] || 1;
      const weather = 1 + (wm - 1) * rain;
      return iv * 1.2 / G.clock.scale / (G.staffing ? G.staffing.demandMult : 1) / weather;
    }
    rainLevel() { return BK.ArrivalDirector.rainLevel(this.G.cfg, this.G.dayProfile, this.G.clock.t); }
    tickWeather() {
      const G = this.G, raining = this.rainLevel() > 0.05;
      if (raining === this.raining) return;
      this.raining = raining;
      if (G.state === 'playing') G.ui.toast(raining ? '🌧️ Empieza a llover: menos gente en mostrador y kiosco, más ' + BK.autoName + ' y delivery.' : '🌤️ Deja de llover: la afluencia vuelve a la normalidad.', 'info', 5000);
    }
    update(dt) {
      const G = this.G;
      this.tickWeather();
      if (!['OPEN', 'CLOSING'].includes(G.restaurantState) || G.clock.phase.id === 'prep') return;
      this.checkWatchdog();
      for (const channel of CHANNELS) {
        const interval = this.interval(channel);
        if (!Number.isFinite(interval)) continue;
        this.timers[channel] -= dt;
        if (this.timers[channel] > 0) continue;
        const pending = G.production.orders.filter((o) => o.channel === channel && o.status !== 'delivered').length;
        if (pending < G.cfg.difficultyProfiles[G.save.settings.difficulty].maxConcurrent * 4) {
          if (channel === 'autoking') {
            if (G.vehicles.canSpawn()) {
              const car = G.vehicles.spawn({ source: 'arrival-director' });
              if (car) this.recordArrival(channel, car);
            }
          } else if (channel === 'dining') {
            const guest = G.customers.spawnAmbientArrival(channel);
            if (guest) this.recordArrival(channel, guest);
          } else {
            const guest = G.customers.spawnAmbientArrival(channel);
            if (guest) this.recordArrival(channel, guest);
          }
        }
        this.timers[channel] = this.nextBetween(0.82, 1.18) * interval;
      }
    }
    checkWatchdog() {
      const G = this.G;
      if (!G.debugSimulation) return;
      const expected = CHANNELS.some((channel) => Number.isFinite(this.interval(channel)) && this.interval(channel) > 0);
      if (!expected) { this.lastActivityAt = G.time; this.stalled = false; return; }
      if (this.lastActivityAt === null) this.lastActivityAt = G.time;
      const noWorldActivity = !G.customers.guests.some((guest) => !guest.dead) &&
        G.vehicles.count === 0 && G.events.active().length === 0;
      if (noWorldActivity && G.time - this.lastActivityAt >= G.cfg.operations.simulationWatchdogSec && !this.stalled) {
        this.stalled = true;
        BK.bus.emit('simulation:stall', { at: G.clock.label, arrivalRateExpected: true });
      }
    }
    recordArrival(channel, entity) {
      this.arrivals[channel]++;
      BK.bus.emit('arrival:created', { channel, count: this.arrivals[channel], entity });
    }
  }
  BK.ArrivalDirector = ArrivalDirector;
})();
