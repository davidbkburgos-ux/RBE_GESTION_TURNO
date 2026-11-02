(function () {
  const BK = window.BK;
  const U = BK.util;

  // Puntos de interacción del escenario (revisiones de apertura y puerta) + resolución de toques/clics sobre ellos.
  class InteractionSystem {
    constructor(G) { this.G = G; }
    items() {
      const G = this.G, out = [];
      const list = G.opening.cslActive ? G.opening.cslTasks.filter((t) => !G.opening.cslClosed) : G.opening.tasks;
      list.forEach((t) => {
        const p = G.map.points[t.point];
        const locked = t.action === 'door' && !G.opening.checksDone;
        out.push({ kind: 'task', id: t.id, task: t, x: p[0], y: p[1], done: t.done, locked, label: t.label });
      });
      if (G.briefing && G.briefing.available) {
        out.push({ kind: 'briefing', id: 'opening-briefing', task: { action: 'briefing' }, x: G.briefing.point.x, y: G.briefing.point.y, label: 'Briefing de apertura' });
      }
      return out;
    }
    // Devuelve el interactuable más cercano a un punto del mundo
    hit(wx, wy, scale) {
      const rad = Math.max(30, 26 / scale);
      let best = null, bd = rad;
      for (const it of this.items()) {
        if (it.done) continue;
        const dd = Math.hypot(it.x - wx, it.y - wy);
        if (dd < bd) { bd = dd; best = it; }
      }
      return best;
    }
    activate(it) {
      if (it.kind === 'briefing') return this.G.briefing.start();
      if (it.kind === 'task') return this.G.player.goTask(it.task);
      return false;
    }
    // Atiende el evento más urgente (tecla E)
    attendMostUrgent() {
      const G = this.G;
      const w = G.events.list.filter((e) => G.events.isWaiting(e));
      if (!w.length) return false;
      w.sort((a, b) => G.events.remainingSec(a) - G.events.remainingSec(b));
      return G.player.attend(w[0]);
    }
  }
  BK.InteractionSystem = InteractionSystem;
})();
