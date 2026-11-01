(function () {
  const BK = window.BK;
  const U = BK.util;

  const LEARN_TYPES = ['counter', 'kiosk', 'dirtyTable', 'vehicle', 'pendingOrder'];

  // Director de eventos: decide qué evento aparece y cuándo según hora, carga, rendimiento y posición del jugador.
  class EventDirector {
    constructor(G) {
      this.G = G;
      this.fails = [];
      this.reset();
      BK.bus.on('event:failed', () => this.fails.push(G.time));
      BK.bus.on('restaurant:opened', () => { this.state = 'OPEN'; });
    }
    reset() { this.spawned = 0; this.timer = 4; this.lastSpawn = -999; this.fails = []; this.lastType = null; this.state = 'PRE_OPEN'; }
    get cfg() { return this.G.cfg.director; }
    get stage() {
      const n = this.spawned, d = this.cfg;
      return n < d.learningEvents ? 1 : n < d.stage2Events ? 2 : n < d.stage3Events ? 3 : 4;
    }
    // Factor de ritmo: se alarga tras fallos recientes y se acorta con rachas de excelentes
    pace() {
      const d = this.cfg, G = this.G;
      this.fails = this.fails.filter((t) => G.time - t < d.recentFailureWindowSec);
      if (this.fails.length >= d.easeOnFailures) return d.easeFactor;
      if (G.scoring.streak >= d.pushOnStreak) return d.pushFactor;
      return 1;
    }
    spot(type) {
      const P = this.G.map.points;
      switch (type) {
        case 'counter': return { x: 668, y: 574 };
        case 'kiosk': return { x: 950, y: 402 };
        case 'pendingOrder': return { x: 668, y: 664 };
        case 'delivery': return { x: 1316, y: 560 };
        case 'vehicle': return { x: 650, y: 762 };
        case 'dirtyTable': {
          const ts = this.G.customers.dirtyTables();
          const from = this.G.player.char;
          let best = null, bd = 1e9;
          ts.forEach((t) => { const d = U.dist(from, { x: t.cx, y: t.cy }); if (d < bd) { bd = d; best = t; } });
          return best ? { x: best.cx, y: best.cy } : { x: 1000, y: 600 };
        }
      }
      return { x: P.mainDoor[0], y: P.mainDoor[1] };
    }
    feasible(type) {
      const G = this.G, T = G.ev.types[type], diff = G.difficulty.timerScale, sp = G.cfg.player.speed;
      const items = G.events.list.filter((e) => e.state === 'scheduled' || G.events.isLive(e)).map((e) => ({
        pos: e.interact || this.spot(e.type), rem: G.events.remainingSec(e) + (e.state === 'scheduled' ? e.eta || 6 : 0), act: e.actionSec
      }));
      items.push({ pos: this.spot(type), rem: T.timerSec * diff + 7, act: T.actionSec });
      items.sort((a, b) => a.rem - b.rem);
      let pos = G.player.char, t = 0;
      const margin = this.stage >= 3 ? 1.0 : this.cfg.feasibilityMargin;
      for (const it of items) {
        t += (U.dist(pos, it.pos) * 1.4) / sp + it.act;
        if (t * margin > it.rem) return false;
        pos = it.pos;
      }
      return true;
    }
    pickType(ph) {
      const G = this.G, st = this.stage;
      const from = G.player.char;
      const cands = [];
      Object.keys(ph.weights).forEach((type) => {
        if (st === 1 && !LEARN_TYPES.includes(type)) return;
        if (!G.customers.canSpawn(type)) return;
        let w = ph.weights[type];
        const ch = G.ev.types[type].channel;
        const inCh = G.events.byChannel(ch).length;
        if (inCh >= 2) w *= 0.5;
        if (st >= 3 && inCh === 0) w *= 1.6;
        if (type === this.lastType) w *= 0.6;
        if (st >= 2) {
          const d = U.dist(from, this.spot(type));
          w *= 1 + (d / 700) * (st - 1) * 0.6;
        }
        cands.push({ type, w });
      });
      while (cands.length) {
        const sum = cands.reduce((s, c) => s + c.w, 0);
        let r = Math.random() * sum, idx = 0;
        for (; idx < cands.length; idx++) { r -= cands[idx].w; if (r <= 0) break; }
        idx = Math.min(idx, cands.length - 1);
        const c = cands.splice(idx, 1)[0];
        if (this.feasible(c.type)) return c.type;
      }
      return null;
    }
    update(dt) {
      const G = this.G;
      if (!['OPEN', 'CLOSING'].includes(G.restaurantState)) { this.state = 'PRE_OPEN'; return; }
      this.state = 'ACTIVE';
      if (G.state !== 'playing') return;
      const ph = G.clock.phase;
      if (!ph.weights || !Object.keys(ph.weights).length) return;
      this.timer -= dt;
      if (this.timer > 0) return;
      const st = this.stage, d = this.cfg, p = G.clock.phaseProgress(ph), diff = G.difficulty;
      let maxA = Math.round(U.lerp(ph.maxActive[0], ph.maxActive[1], p));
      if (st === 1) maxA = 1; else if (st === 2) maxA = Math.min(maxA, 2);
      maxA = Math.min(maxA, G.cfg.difficultyProfiles[G.save.settings.difficulty].maxConcurrent);
      const load = G.events.list.filter((e) => {
        if (e.state !== 'scheduled' && !G.events.isLive(e)) return false;
        return e.type !== 'vehicle' || G.events.isLive(e);
      }).length;
      if (load >= Math.max(1, maxA)) { this.timer = 1.5; return; }
      if (st === 1 && G.time - this.lastSpawn < d.learningSpacingSec) { this.timer = 1; return; }
      if (G.time - this.lastSpawn < d.minGapSec) { this.timer = 1; return; }
      const type = this.spawned === 0 ? 'counter' : this.pickType(ph);
      if (!type) { this.timer = 2.5; return; }
      const ev = G.customers.spawnEvent(type);
      if (!ev) { this.timer = 2; return; }
      this.spawned++; this.lastType = type; this.lastSpawn = G.time;
      if (st >= 3 && Math.random() < 0.3) {
        const ch = U.pick(['counter', 'autoking', 'delivery']);
        G.employees.setBusy(ch, 14);
      }
      const every = U.lerp(ph.spawnEverySec[0], ph.spawnEverySec[1], p) * diff.spawnScale * this.pace();
      this.timer = every * U.rnd(0.8, 1.2);
      BK.bus.emit('director:spawn', { type, stage: st });
    }
  }
  BK.EventDirector = EventDirector;
})();
