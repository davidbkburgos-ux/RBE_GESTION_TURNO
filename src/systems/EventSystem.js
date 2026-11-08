(function () {
  const BK = window.BK;

  const LIVE = ['appearing', 'pending', 'acknowledged', 'playerMoving', 'inProgress'];
  const WAITING = ['pending', 'acknowledged', 'playerMoving'];

  // Entidades de evento: scheduled -> appearing -> pending -> acknowledged -> playerMoving -> inProgress -> resolved*/failed/dismissed
  class EventSystem {
    constructor(G) { this.G = G; this.list = []; this.seq = 0; }
    get timing() { return this.G.cfg.timing; }

    schedule(type, opts = {}) {
      const G = this.G, T = G.ev.types[type], ch = G.ev.channels[T.channel];
      const timer = T.timerSec * G.difficulty.timerScale * (opts.timerMult || 1);
      const e = {
        id: 'E' + (++this.seq), type, channel: T.channel, location: null, targetEntity: null, state: 'scheduled',
        createdAt: G.clock.t, expiresAt: null, responseTime: null, priority: T.priority,
        scoreValues: Object.assign({ excellent: G.cfg.score.excellent, acceptable: G.cfg.score.acceptable, failed: G.cfg.score.failed }, T.scoreOverride),
        assignedEmployee: null, playerRequired: T.playerRequired,
        visualIndicator: { icon: T.indicatorIcon, shape: ch.shape, label: T.short },
        timer, elapsed: 0, appearT: 0, resultT: 0, interact: null, face: 0, lift: 56, quality: null, result: null, actionSec: T.actionSec, action: T.action
      };
      this.list.push(e);
      BK.bus.emit('event:scheduled', e);
      return e;
    }
    activate(e, o) {
      if (e.state !== 'scheduled') return;
      Object.assign(e, { location: o.location, interact: o.interact, face: o.face || 0, targetEntity: o.target || null, lift: o.lift || 56 });
      e.state = 'appearing';
      e.appearT = 0;
      e.activatedAt = this.G.clock.t;
      e.expiresAt = this.G.clock.t + e.timer * this.G.clock.scale;
      e.assignedEmployee = this.G.employees.assignFor(e.channel);
      BK.bus.emit('event:appearing', e);
    }
    isLive(e) { return LIVE.includes(e.state); }
    isWaiting(e) { return WAITING.includes(e.state); }
    active() { return this.list.filter((e) => LIVE.includes(e.state)); }
    pendingCount() { return this.list.filter((e) => e.state === 'scheduled' || LIVE.includes(e.state)).length; }
    byChannel(ch) { return this.list.filter((e) => (e.state === 'scheduled' || LIVE.includes(e.state)) && e.channel === ch); }
    fraction(e) { return Math.min(1, e.elapsed / e.timer); }
    remainingSec(e) { return Math.max(0, e.timer - e.elapsed); }

    acknowledge(e) {
      if (e.state === 'pending' || e.state === 'appearing') { e.state = 'acknowledged'; BK.bus.emit('event:acknowledged', e); }
    }
    setMoving(e) { if (WAITING.includes(e.state)) { e.state = 'playerMoving'; BK.bus.emit('event:playerMoving', e); } }
    release(e) { if (e.state === 'playerMoving' || e.state === 'acknowledged') e.state = 'pending'; }

    begin(e) {
      const t = this.timing, f = this.fraction(e);
      e.quality = f <= t.excellentUntil ? 'excellent' : 'acceptable';
      e.responseTime = e.elapsed;
      e.state = 'inProgress';
      BK.bus.emit('event:begin', e);
    }
    complete(e) {
      if (e.state !== 'inProgress') return;
      e.state = e.quality === 'excellent' ? 'resolvedExcellent' : 'resolvedAcceptable';
      e.result = e.quality; e.resultT = 0;
      e.points = this.G.scoring.eventResult(e, e.quality);
      BK.bus.emit('event:resolved', { ev: e, result: e.quality });
    }
    // Resolución autónoma por un empleado: no cuenta como excelente ni alimenta el combo del encargado.
    beginAuto(e) {
      if (!WAITING.includes(e.state) && e.state !== 'appearing') return false;
      e.state = 'inProgress'; e.auto = true; e.responseTime = e.elapsed; e.quality = 'acceptable';
      BK.bus.emit('event:begin', e);
      return true;
    }
    completeAuto(e) {
      if (e.state !== 'inProgress' || !e.auto) return;
      const pts = this.G.cfg.operations.autonomy.autoPoints;
      e.state = 'resolvedAcceptable'; e.result = 'acceptable'; e.resultT = 0; e.points = pts;
      this.G.scoring.m.autoResolved = (this.G.scoring.m.autoResolved || 0) + 1;
      this.G.scoring.add(pts, 'Resuelto por el equipo', e.location, 'team');
      BK.bus.emit('event:resolved', { ev: e, result: 'acceptable' });
    }
    fail(e) {
      if (!LIVE.includes(e.state)) return;
      e.state = 'failed'; e.result = 'failed'; e.resultT = 0; e.responseTime = e.elapsed;
      e.points = this.G.scoring.eventResult(e, 'failed');
      BK.bus.emit('event:failed', { ev: e, result: 'failed' });
    }
    dismiss(e) {
      if (e.state === 'dismissed') return;
      e.state = 'dismissed'; e.resultT = 99;
      BK.bus.emit('event:dismissed', e);
    }
    dismissAll() { this.list.forEach((e) => { if (e.state === 'scheduled' || LIVE.includes(e.state)) this.dismiss(e); }); }

    update(dt) {
      const G = this.G, t = this.timing;
      for (const e of this.list) {
        if (e.state === 'appearing') {
          e.appearT += dt;
          if (e.appearT >= t.appearSec) { e.state = 'pending'; BK.bus.emit('event:pending', e); }
        } else if (WAITING.includes(e.state)) {
          e.elapsed += dt / (G.priority.patience(e.channel) * G.employees.busyMult(e.channel));
          if (e.elapsed >= e.timer) this.fail(e);
          // el encargado iba hacia él y cambió de plan: se libera para que el equipo pueda atenderlo
          else if (e.state !== 'pending' && !(G.player && G.player.pending && G.player.pending.ev === e)) {
            e.relT = (e.relT || 0) + dt;
            if (e.relT > 1) { e.state = 'pending'; e.relT = 0; }
          } else e.relT = 0;
        } else if (e.state === 'inProgress') {
          // Vigilante anti-atasco: si nadie está trabajando el evento (acción del encargado interrumpida,
          // empleado reasignado, ventana cerrada), vuelve a pendiente y su temporizador sigue corriendo.
          const P = G.player, act = P && P.char && P.char.action;
          const engaged = e.auto ? !!(G.autonomy && G.autonomy.jobs.some((j) => j.ev === e))
            : (act && act.ev === e) || (e.type === 'complaint' && G.ui && G.ui.q && G.ui.q.kind === 'complaint');
          e.ipT = (e.ipT || 0) + dt;
          e.lostT = engaged ? 0 : (e.lostT || 0) + dt;
          if (e.lostT > 1.5 || e.ipT > 90) {
            e.state = 'pending'; e.auto = false; e.lostT = 0; e.ipT = 0;
            BK.bus.emit('event:released', e);
          }
        } else if (e.state.startsWith('resolved') || e.state === 'failed') {
          e.resultT += dt;
        }
      }
      this.list = this.list.filter((e) => !(e.resultT > t.resultIconSec) && !(e.state === 'dismissed'));
    }
    clear() { this.list = []; }
  }
  BK.EventSystem = EventSystem;
})();
