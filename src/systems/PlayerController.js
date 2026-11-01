(function () {
  const BK = window.BK;
  const U = BK.util;

  // Controla al único avatar (encargado): point-and-click, "ir e interactuar", acciones y reacciones.
  class PlayerController {
    constructor(G) {
      this.G = G;
      const s = G.map.player || { x: 330, y: 520 };
      this.char = new BK.Character({ id: 'MGR', kind: 'manager', pal: 'manager', x: s.x, y: s.y, speed: G.cfg.player.speed, dir: 2, scale: G.cfg.player.scale });
      this.pending = null;
      this.marker = null;
      this.locked = false;
      BK.bus.on('event:failed', (e) => this.onEventGone(e.ev));
      BK.bus.on('event:dismissed', (ev) => this.onEventGone(ev));
    }
    get busy() { return !!this.char.action || this.locked; }
    onEventGone(ev) {
      if (this.pending && this.pending.ev === ev) { this.pending = null; if (!this.char.action) this.char.stop(); this.marker = null; }
      if (this.char.action && this.char.action.ev === ev) { /* la acción termina sola */ }
    }
    clearPending() {
      if (this.pending && this.pending.ev) this.G.events.release(this.pending.ev);
      this.pending = null;
    }
    reset(x, y) {
      this.char.x = x; this.char.y = y; this.char.stop(); this.char.cancelAction();
      this.pending = null; this.marker = null; this.locked = false;
      this.G.manager.coveringPosition = null; this.G.manager.status = 'SUPERVISING';
    }

    leaveCover() {
      const manager = this.G.manager;
      if (!manager.coveringPosition && manager.status === 'SUPERVISING') return false;
      const position = manager.coveringPosition;
      manager.coveringPosition = null;
      manager.status = 'SUPERVISING';
      BK.bus.emit('manager:left-position', { position });
      return true;
    }

    coverPosition(positionId) {
      const G = this.G, station = G.cfg.operations.stations[positionId];
      if (this.busy || !station || station.category === 'support') return false;
      const destination = { x: station.pos[0], y: station.pos[1] };
      const route = G.nav.findPath('staff', this.char, destination);
      if (!route.reachable) { BK.bus.emit('player:blocked', destination); return false; }
      this.leaveCover();
      G.manager.status = 'MOVING_TO_POSITION';
      this.char.idleAnim = 'idle';
      this.char.setPath(route.path, () => {
        G.manager.coveringPosition = positionId;
        G.manager.status = 'WORKING_POSITION';
        this.char.dir = BK.DIR.S;
        this.char.idleAnim = 'work';
        BK.bus.emit('manager:positioned', { position: positionId, category: station.category });
      });
      this.marker = { x: destination.x, y: destination.y, t: 0, bad: false, target: true };
      return true;
    }

    moveTo(x, y) {
      if (this.busy) return false;
      const nav = this.G.nav;
      const from = this.char;
      const direct = nav.isWalkable('staff', x, y);
      const near = nav.nearestWalkable('staff', x, y, 40);
      if (!direct && (!near || U.dist(near, { x, y }) > 30)) {
        BK.bus.emit('player:blocked', { x, y });
        this.marker = { x, y, t: 0, bad: true };
        return false;
      }
      this.clearPending();
      const r = nav.findPath('staff', from, near && !direct ? near : { x, y });
      if (!r.reachable) { BK.bus.emit('player:blocked', { x, y }); this.marker = { x, y, t: 0, bad: true }; return false; }
      this.leaveCover();
      this.char.setPath(r.path);
      this.marker = { x: r.dest ? r.dest.x : x, y: r.dest ? r.dest.y : y, t: 0, bad: false };
      BK.bus.emit('player:move', { x, y });
      return true;
    }

    walkThen(pt, cb) {
      const r = this.G.nav.findPath('staff', this.char, pt);
      if (!r.reachable) { BK.bus.emit('player:blocked', pt); this.pending = null; return false; }
      this.char.setPath(r.path, cb);
      this.marker = { x: pt.x, y: pt.y, t: 0, bad: false, target: true };
      return true;
    }

    attend(ev) {
      const G = this.G;
      if (!G.events.isWaiting(ev)) return false;
      if (this.busy) { BK.bus.emit('player:busy', {}); return false; }
      this.leaveCover();
      this.clearPending();
      this.pending = { ev };
      G.events.acknowledge(ev);
      G.events.setMoving(ev);
      const ok = this.walkThen(ev.interact, () => {
        this.pending = null; this.marker = null;
        if (!G.events.isWaiting(ev) && ev.state !== 'playerMoving') return;
        this.char.faceTo(ev.location || ev.interact);
        G.events.begin(ev);
        if (ev.type === 'complaint') {
          this.locked = true;
          this.char.playAction('talk', 0.6);
          G.incidents.startComplaint(ev);
          return;
        }
        const dur = ev.actionSec / G.priority.speed(ev.channel);
        BK.bus.emit('player:action', { ev });
        this.char.playAction(ev.action, dur, () => {
          if (ev.type === 'productShortage') G.production.beginRestock(ev.targetEntity.productId);
          G.events.complete(ev);
          this.char.playAction(ev.quality === 'excellent' ? 'reactGood' : 'idle', ev.quality === 'excellent' ? 0.9 : 0.2);
        });
        this.char.action.ev = ev;
      });
      if (!ok) G.events.release(ev);
      return ok;
    }

    goTask(task) {
      const G = this.G;
      if (this.busy) { BK.bus.emit('player:busy', {}); return false; }
      this.leaveCover();
      this.clearPending();
      const p = G.map.points[task.point];
      if (task.checklist && G.opening.checklistClosed) return false;
      if (task.csl && (!G.opening.cslActive || G.opening.cslClosed)) return false;
      this.pending = { task };
      return this.walkThen({ x: p[0], y: p[1] }, () => {
        this.pending = null; this.marker = null;
        if (task.action === 'door') {
          if (!G.opening.tryOpenDoor()) return;
          this.char.playAction('door', 1.5, () => {
            G.opening.openDoor();
            this.char.playAction('reactGood', 1.0);
          });
        } else {
          this.char.dir = task.zone === 'hall' ? BK.DIR.S : this.char.dir;
          const action = task.action === 'clean' ? 'clean' : 'inspect';
          this.char.playAction(action, task.action === 'clean' ? 1.8 : 1.3, () => {
            if (task.action === 'restock') G.production.beginRestock(task.productId);
            else G.opening.arrive(task);
          });
        }
      });
    }

    // Preparación de producto del tramo en la cámara de congelado; se puede repetir cuando se quiera.
    goPrep() {
      const G = this.G;
      if (G.state !== 'playing') return false;
      if (this.busy) { BK.bus.emit('player:busy', {}); return false; }
      this.leaveCover();
      this.clearPending();
      const p = G.map.points.productPrep;
      this.pending = { prep: true };
      return this.walkThen({ x: p[0], y: p[1] }, () => {
        this.pending = null; this.marker = null;
        this.char.dir = BK.DIR.W !== undefined ? BK.DIR.W : this.char.dir;
        BK.bus.emit('production:prep-start', {});
        this.char.playAction('inspect', G.cfg.operations.stockPrep.durationSec, () => {
          G.production.managerPrepare();
          this.char.playAction('reactGood', 0.8);
        });
        if (this.char.action) this.char.action.prep = true;
      });
    }

    reaction(ok) { if (!this.char.action) this.char.playAction(ok ? 'reactGood' : 'reactBad', 1.0); }

    update(dt) {
      this.char.update(dt);
      if (this.marker) { this.marker.t += dt; if (this.marker.t > 1.4 && !this.marker.target) this.marker = null; }
      if (this.marker && this.marker.target && !this.char.moving && !this.char.action) this.marker = null;
    }
  }
  BK.PlayerController = PlayerController;
})();
