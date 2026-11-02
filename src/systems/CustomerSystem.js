(function () {
  const BK = window.BK;
  const U = BK.util;

  BK.CUSTOMER_STATE_LABEL = {
    BEING_SERVED: 'Cliente: está siendo atendido.', WAITING: 'Cliente: espera su turno.', WAITING_FOR_ORDER: 'Cliente: espera su pedido.',
    ORDER_READY: 'Cliente: pedido listo.', SEATED: 'Cliente: sentado en la sala.', NEEDS_HELP: 'Cliente: necesita ayuda.',
    LEAVING: 'Cliente: se marcha.', WAIT_FOR_TABLE: 'Cliente: espera una mesa limpia.', TABLE_COMPLAINT: 'Cliente: se queja, no hay mesa limpia.'
  };
  BK.CUSTOMER_STATE_ICON = {
    BEING_SERVED: '💬', WAITING: '⏳', WAITING_FOR_ORDER: '🧾', ORDER_READY: '✅', SEATED: '🍔', NEEDS_HELP: '❗', LEAVING: '👋', WAIT_FOR_TABLE: '🪑', TABLE_COMPLAINT: '😠'
  };

  // Clientes: mostrador, kiosco, recogida, comensales (mesa sucia), ambiente y repartidores.
  class CustomerSystem {
    constructor(G) {
      this.G = G;
      const M = G.map;
      this.guests = [];
      this.seed = 1;
      this.spawn = { x: M.points.guestSpawn[0], y: M.points.guestSpawn[1] };
      this.exit = { x: M.points.guestExit[0], y: M.points.guestExit[1] };
      this.tables = M.tables.map((t) => ({
        id: t.id, top: t.top, cx: (t.top[0] + t.top[2]) / 2, cy: (t.top[1] + t.top[3]) / 2,
        seats: t.seats.map((s) => ({ x: s[0], y: s[1], face: BK.DIR[s[2]], taken: false })), state: 'clean', reserved: false, dirtyAt: 0
      }));
      this.slots = M.points.counterSlots.map((p) => ({ x: p[0], y: p[1], busy: false }));
      this.kiosks = [
        { id: 'kiosk1', x: M.points.kiosk1[0], y: M.points.kiosk1[1], busy: false },
        { id: 'kiosk2', x: M.points.kiosk2[0], y: M.points.kiosk2[1], busy: false }
      ];
      this.pickup = { x: M.points.pickup[0], y: M.points.pickup[1], busy: false };
      this.pickSpots = (M.spots && M.spots.pickSpots || [[814, 484], [814, 520], [814, 556], [814, 592], [814, 628]]).map((p) => ({ x: p[0], y: p[1], busy: false }));
      this.S = M.spots || {};
      this.counterX = this.S.counterX || 668;
      this.deliveryAt = this.S.delivery || { x: 1316, y: 560 };
      this.deliveryFace = this.S.deliveryFace !== undefined ? BK.DIR[this.S.deliveryFace] : BK.DIR.E;
      this.riderFace = this.S.riderFace !== undefined ? BK.DIR[this.S.riderFace] : BK.DIR.W;
      this.riderSpots = [
        { x: M.points.riderWait[0], y: M.points.riderWait[1], busy: false },
        { x: M.points.riderWait2[0], y: M.points.riderWait2[1], busy: false }
      ];
      this.ambientT = 3;
      this.waitSpots = (M.points.tableWaitSpots || []).map((p) => ({ x: p[0], y: p[1], busy: false }));
      this.sweepT = 0;
      this.restroom = { uses: 0, cooldown: 0, ev: null };
      BK.bus.on('customer:abandon', (e) => this.postReview(e.reason || 'WAIT_' + String(e.channel || 'counter').toUpperCase()));
      BK.bus.on('ambient:activity', ({ type, entity }) => {
        if (type === 'CUSTOMER_LEAVE' && entity && entity.role !== 'rider' && !entity.abandoned) this.restroom.uses++;
      });
      BK.bus.on('production:delivered', ({ order }) => {
        const guest = this.guests.find((g) => g.id === order.sourceId && g.ambientOrder);
        if (guest) guest.orderReady = true;
      });
      BK.bus.on('event:resolved', (e) => this.onEnd(e.ev, 'ok'));
      BK.bus.on('event:failed', (e) => this.onEnd(e.ev, 'fail'));
      BK.bus.on('event:dismissed', (ev) => this.onEnd(ev, 'dismiss'));
    }

    newGuest(role, pal) {
      const g = new BK.Character({
        id: 'G' + this.seed, kind: role === 'rider' ? 'rider' : 'guest', pal: pal || 'guest' + this.seed,
        x: this.spawn.x + U.rnd(-14, 14), y: this.spawn.y + U.rnd(-4, 4), speed: this.G.cfg.npc.guestSpeed * U.rnd(0.92, 1.08)
      });
      this.seed++;
      g.role = role; g.dir = 0; g.animT = U.rnd(0, 2);
      this.guests.push(g);
      return g;
    }
    // Los destinos usan reserva: busy = reservado por un cliente vivo. Un barrido libera reservas huérfanas.
    walk(g, pt, cb) {
      const r = this.G.nav.findPath('guest', g, pt);
      if (!r.reachable) return false;
      g.dest = pt; g.destCb = cb || null; g.stallT = 0;
      g.setPath(r.path, () => { g.dest = null; g.destCb = null; if (cb) cb(); });
      return true;
    }
    // NAVIGATION_RECOVERY: un cliente atascado no cuenta como abandono del jugador.
    recoverNavigation(g) {
      const max = this.G.cfg.operations.navigation.maxRecoveries;
      g.navRecoveries = (g.navRecoveries || 0) + 1;
      BK.bus.emit('ambient:activity', { type: 'NAVIGATION_RECOVERY', entity: g });
      const d = g.dest, cb = g.destCb;
      if (!d) return false;
      if (g.navRecoveries < max && this.walk(g, d, cb)) return true;
      if (g.navRecoveries <= max) { g.stop(); g.x = d.x; g.y = d.y; g.dest = null; g.destCb = null; if (cb) cb(); return true; }
      return false;
    }
    dropSilently(g) { this.free(g); if (g.ev) this.G.events.dismiss(g.ev); g.dead = true; }
    checkStall(g, dt) {
      if (!g.moving || (!g.dest && !g.leaving)) { g.stallT = 0; return; }
      if (Math.hypot(g.x - (g.sx || 0), g.y - (g.sy || 0)) > 2) { g.sx = g.x; g.sy = g.y; g.stallT = 0; return; }
      g.stallT = (g.stallT || 0) + dt;
      if (g.stallT < this.G.cfg.operations.navigation.stallSec) return;
      g.stallT = 0;
      if (g.leaving) { g.dead = true; return; }
      if (!this.recoverNavigation(g)) this.dropSilently(g);
    }
    sweepReservations() {
      const live = this.guests.filter((g) => !g.dead);
      const owned = (pred) => live.some(pred);
      this.slots.forEach((s) => { if (s.busy && !owned((g) => g.slot === s)) s.busy = false; });
      this.kiosks.forEach((k) => { if (k.busy && !owned((g) => g.kiosk === k)) k.busy = false; });
      this.riderSpots.forEach((s) => { if (s.busy && !owned((g) => g.spot === s)) s.busy = false; });
      this.waitSpots.forEach((s) => { if (s.busy && !owned((g) => g.waitSpot === s)) s.busy = false; });
      this.pickSpots.forEach((s) => { if (s.busy && !owned((g) => g.pickSpot === s)) s.busy = false; });
      if (this.pickup.busy && !owned((g) => g.isPickup)) this.pickup.busy = false;
      live.forEach((g) => { if (!g.leaving && !g.collecting) { if (g.slot) g.slot.busy = true; if (g.kiosk) g.kiosk.busy = true; if (g.spot) g.spot.busy = true; } });
    }
    // Estado visible del cliente (icono sobre el personaje).
    stateOf(g) {
      if (g.dead) return null;
      if (g.leaving) return 'LEAVING';
      if (g.waitTable) return g.waitTable.complained ? 'TABLE_COMPLAINT' : 'WAIT_FOR_TABLE';
      if (g.seated) return 'SEATED';
      if (g.orderReady && g.ambientOrder) return 'ORDER_READY';
      const ev = g.ev;
      if (ev && this.G.events.isLive(ev)) {
        if (ev.state === 'inProgress') return 'BEING_SERVED';
        if (this.G.events.isWaiting(ev) || ev.state === 'appearing') return 'NEEDS_HELP';
      }
      if (g.ambientStage === 'ordering') return 'BEING_SERVED';
      if (g.ambientStage === 'waiting') return 'WAITING_FOR_ORDER';
      if (g.dest || g.moving) return 'WAITING';
      return 'WAITING';
    }
    postReview(reason) {
      const G = this.G, cfg = G.cfg.operations.reviews;
      const bank = cfg.bank[reason] || cfg.bank.WAIT_COUNTER;
      G.scoring.m.negativeReviews = (G.scoring.m.negativeReviews || 0) + 1;
      if (cfg.penalty) G.scoring.add(cfg.penalty, 'Reseña negativa', null, 'reputation');
      BK.bus.emit('incident:negative-review', { rating: 1, reason, text: U.pick(bank), fromAbandon: true });
    }
    tableAt(wx, wy, pad) {
      return this.tables.find((t) => t.state === 'dirty' && wx >= t.top[0] - pad && wx <= t.top[2] + pad && wy >= t.top[1] - pad && wy <= t.top[3] + pad) || null;
    }
    // Una mesa sucia siempre se puede atender, tenga o no un evento ya generado.
    attendTable(t) {
      const G = this.G;
      let ev = G.events.list.find((e) => e.type === 'dirtyTable' && e.targetEntity === t && G.events.isLive(e));
      if (!ev) { t.reserved = false; t.failedAt = 0; ev = this.spawn_dirtyTable(t); }
      if (!ev) return false;
      if (ev.state === 'appearing') { ev.state = 'pending'; BK.bus.emit('event:pending', ev); }
      return G.player.attend(ev);
    }
    leave(g, fast) {
      if (g.leaving) return;
      g.leaving = true; g.seated = false; g.idleAnim = 'idle';
      if ((g.ambientOrder || g.ambient) && !g.leftLogged) {
        g.leftLogged = true;
        BK.bus.emit('ambient:activity', { type: g.role === 'rider' ? 'RIDER_EXIT' : 'CUSTOMER_LEAVE', entity: g });
      }
      if (fast) g.speed *= 1.25;
      const to = g.role === 'rider' ? { x: this.G.map.points.riderSpawn[0], y: this.G.map.points.riderSpawn[1] } : this.exit;
      if (!this.walk(g, to, () => { g.dead = true; })) g.dead = true;
    }
    // Tras pedir en el kiosco, el cliente libera el kiosco y espera su pedido en la zona de mostrador.
    goToPickup(g) {
      const spot = this.pickSpots.find((s) => !s.busy);
      if (!spot) return;
      const k = g.kiosk;
      spot.busy = true; g.pickSpot = spot;
      if (!this.walk(g, spot, () => { g.dir = BK.DIR.W; g.idleAnim = 'idle'; })) { spot.busy = false; g.pickSpot = null; return; }
      if (k) { k.busy = false; g.kiosk = null; }
    }
    free(g) {
      if (g.pickSpot) { g.pickSpot.busy = false; g.pickSpot = null; }
      if (g.slot) g.slot.busy = false;
      if (g.kiosk) g.kiosk.busy = false;
      if (g.isPickup) this.pickup.busy = false;
      if (g.spot) g.spot.busy = false;
      if (g.waitSpot) { g.waitSpot.busy = false; g.waitSpot = null; }
    }

    // ----- disponibilidad -----
    cleanTable() {
      const c = this.tables.filter((t) => t.state === 'clean' && !t.reserved && !t.seats.some((s) => s.taken));
      return c.length ? c : null;
    }
    dirtyTables() { return this.tables.filter((t) => t.state === 'dirty' && !t.reserved); }
    // La mesa sucia solo genera evento cuando la sala se bloquea: sin mesa limpia o con demasiadas sucias.
    hallBlocked() {
      const dirty = this.tables.filter((t) => t.state === 'dirty').length;
      if (!dirty) return false;
      const ratio = this.G.cfg.operations.tableWait.eventDirtyRatio;
      return !this.cleanTable() || dirty >= Math.ceil(this.tables.length * ratio);
    }
    canSpawn(type, force) {
      if (!['OPEN', 'CLOSING'].includes(this.G.restaurantState)) return false;
      switch (type) {
        case 'counter': return this.slots.some((s) => !s.busy);
        case 'kiosk': return this.kiosks.some((k) => !k.busy);
        case 'pendingOrder': return !this.pickup.busy;
        case 'dirtyTable': return this.dirtyTables().length > 0 && (!!force || this.hallBlocked());
        case 'delivery': return this.riderSpots.some((s) => !s.busy);
        case 'vehicle': return this.G.vehicles.canSpawn();
      }
      return false;
    }
    spawnEvent(type, force) {
      if (!this.canSpawn(type, force)) return null;
      if (type === 'vehicle') return this.G.vehicles.spawn();
      return this['spawn_' + type]();
    }
    spawnAmbientArrival(channel) {
      if (!['OPEN', 'CLOSING'].includes(this.G.restaurantState)) return null;
      if (channel === 'dining') {
        const tables = this.cleanTable();
        if (!tables) return this.spawnTableWaiter();
        const guest = this.newGuest('ambientDiner');
        guest.ambientOrder = true;
        this.sitAmbient(guest, U.pick(tables), U.rnd(22, 42));
        if (guest.dead) return null;
        BK.bus.emit('ambient:activity', { type: 'CUSTOMER_ENTER', channel, entity: guest });
        return guest;
      }
      const options = channel === 'counter' ? this.slots.filter((s) => !s.busy) :
        channel === 'kiosk' ? this.kiosks.filter((s) => !s.busy) :
          channel === 'delivery' ? this.riderSpots.filter((s) => !s.busy) : [];
      if (!options.length) return null;
      const destination = U.pick(options);
      destination.busy = true;
      const guest = this.newGuest(channel === 'delivery' ? 'rider' : 'ambientCustomer', channel === 'delivery' ? 'rider' : undefined);
      guest.ambientOrder = true;
      guest.ambientChannel = channel;
      guest.slot = channel === 'counter' ? destination : null;
      guest.kiosk = channel === 'kiosk' ? destination : null;
      guest.spot = channel === 'delivery' ? destination : null;
      if (channel === 'delivery') {
        guest.x = this.G.map.points.riderSpawn[0];
        guest.y = this.G.map.points.riderSpawn[1];
      }
      BK.bus.emit('ambient:activity', { type: channel === 'delivery' ? 'RIDER_ENTER' : 'CUSTOMER_ENTER', channel, entity: guest });
      const reachable = this.walk(guest, destination, () => {
        guest.idleAnim = channel === 'kiosk' ? 'kiosk' : 'idle';
        guest.ambientStage = 'ordering';
        guest.orderWait = guest.orderTotal = channel === 'kiosk' ? U.rnd(4, 6) : U.rnd(1, 2.5);
      });
      if (!reachable) {
        this.free(guest);
        guest.dead = true;
        return null;
      }
      return guest;
    }
    spawnComplaint() {
      if (this.G.events.active().some((e) => e.type === 'complaint')) return null;
      const g = this.newGuest('complaint');
      const spot = this.S.complaint || { x: 790, y: 520 };
      g.x = this.spawn.x; g.y = this.spawn.y;
      g.idleAnim = 'talk';
      const ev = this.G.events.schedule('complaint');
      g.ev = ev; ev.targetEntity = g;
      const approach = this.G.nav.approachPoint('staff', spot, this.G.player.char, 34);
      if (!this.walk(g, spot, () => {
        this.G.events.activate(ev, { location: spot, interact: approach, face: BK.DIR.W, target: g, lift: 62 });
      })) this.abort(g, ev);
      return ev;
    }

    // ----- eventos -----
    spawn_counter() {
      const slot = U.pick(this.slots.filter((s) => !s.busy));
      const g = this.newGuest('counter'); g.slot = slot; slot.busy = true;
      const ev = this.G.events.schedule('counter'); g.ev = ev; ev.targetEntity = g;
      ev.eta = 8;
      const ok = this.walk(g, slot, () => {
        g.dir = BK.DIR.W; g.idleAnim = 'idle';
        this.G.events.activate(ev, { location: { x: slot.x, y: slot.y }, interact: { x: this.counterX, y: slot.y }, face: BK.DIR.E, target: g, lift: 62 });
      });
      if (!ok) this.abort(g, ev);
      return ev;
    }
    spawn_kiosk() {
      const k = U.pick(this.kiosks.filter((s) => !s.busy));
      const g = this.newGuest('kiosk'); g.kiosk = k; k.busy = true;
      const ev = this.G.events.schedule('kiosk'); g.ev = ev; ev.targetEntity = g; ev.eta = 9;
      const ok = this.walk(g, k, () => {
        g.dir = BK.DIR.S; g.idleAnim = 'kiosk';
        const from = this.G.player.char;
        const ap = this.G.nav.approachPoint('staff', g, from, 34);
        this.G.events.activate(ev, { location: { x: g.x, y: g.y }, interact: ap, face: 0, target: g, lift: 62 });
      });
      if (!ok) this.abort(g, ev);
      return ev;
    }
    spawn_pendingOrder() {
      const g = this.newGuest('pickup'); g.isPickup = true; this.pickup.busy = true;
      const ev = this.G.events.schedule('pendingOrder'); g.ev = ev; ev.targetEntity = g; ev.eta = 8;
      const ok = this.walk(g, this.pickup, () => {
        g.dir = BK.DIR.W;
        this.G.events.activate(ev, { location: { x: this.pickup.x, y: this.pickup.y }, interact: { x: this.counterX, y: this.S.pendingOrder ? this.S.pendingOrder.y : 664 }, face: BK.DIR.E, target: g, lift: 62 });
      });
      if (!ok) this.abort(g, ev);
      return ev;
    }
    spawn_dirtyTable(tbl) {
      const t = tbl || U.pick(this.dirtyTables());
      if (!t) return null;
      t.reserved = true;
      const ev = this.G.events.schedule('dirtyTable'); ev.targetEntity = t;
      const point = { x: t.cx, y: t.cy };
      const interact = this.G.nav.approachPoint('staff', point, this.G.player.char, 34);
      this.G.events.activate(ev, { location: point, interact, face: 0, target: t, lift: 34 });
      return ev;
    }
    spawn_delivery() {
      const spot = this.riderSpots.find((s) => !s.busy);
      spot.busy = true;
      const g = this.newGuest('rider', 'rider');
      g.spot = spot; g.x = this.G.map.points.riderSpawn[0]; g.y = this.G.map.points.riderSpawn[1];
      const ev = this.G.events.schedule('delivery'); g.ev = ev; ev.targetEntity = g; ev.eta = 6;
      const ok = this.walk(g, spot, () => {
        g.dir = this.riderFace;
        this.G.events.activate(ev, { location: { x: g.x, y: g.y }, interact: this.deliveryAt, face: this.deliveryFace, target: g, lift: 62 });
      });
      if (!ok) this.abort(g, ev);
      return ev;
    }
    // WAIT_FOR_TABLE: solo si hay mesas sucias (consecuencia de una decisión del encargado), nunca por mala suerte.
    spawnTableWaiter() {
      const cfg = this.G.cfg.operations.tableWait;
      if (!this.tables.some((t) => t.state === 'dirty')) return null;
      if (this.guests.filter((g) => g.waitTable).length >= cfg.maxWaiting) return null;
      const spot = this.waitSpots.find((s) => !s.busy);
      if (!spot) return null;
      spot.busy = true;
      const g = this.newGuest('ambientDiner');
      g.ambientOrder = true; g.ambientChannel = 'dining'; g.waitSpot = spot;
      g.waitTable = { t0: this.G.time, complained: false, arrived: false };
      const ok = this.walk(g, spot, () => { g.dir = BK.DIR.S; g.waitTable.arrived = true; });
      if (!ok) { spot.busy = false; g.dead = true; return null; }
      BK.bus.emit('ambient:activity', { type: 'CUSTOMER_ENTER', channel: 'dining', entity: g });
      return g;
    }
    updateTableWaiter(g) {
      const G = this.G, cfg = G.cfg.operations.tableWait, w = g.waitTable;
      const tabs = this.cleanTable();
      if (tabs && w.arrived) {
        g.waitTable = null; g.patience = 0; this.free(g);
        this.sitAmbient(g, U.pick(tabs), U.rnd(22, 42));
        return;
      }
      const scale = G.difficulty.timerScale, el = G.time - w.t0;
      g.patience = Math.min(1, el / (cfg.leaveSec * scale));
      if (!w.complained && el >= cfg.complaintSec * scale) {
        w.complained = true;
        G.scoring.add(cfg.complaintPenalty, 'Cliente sin mesa limpia', { x: g.x, y: g.y }, 'customer');
        BK.bus.emit('customer:tableComplaint', { guest: g });
      }
      if (g.patience >= 1) { g.waitTable = null; this.abandon(g, 'NO_TABLE'); }
    }
    abort(g, ev) {
      this.free(g); g.dead = true;
      if (ev) this.G.events.dismiss(ev);
    }

    onEnd(ev, how) {
      const tgt = ev && ev.targetEntity;
      if (!tgt) return;
      if (tgt instanceof BK.Vehicle) return;
      if (ev.type === 'restroom') {
        const cfg = this.G.cfg.operations.restroom;
        this.restroom.ev = null;
        this.restroom.cooldown = cfg.cooldownSec;
        if (how === 'ok') this.restroom.uses = 0;
        else if (how === 'fail') this.restroom.uses = cfg.failUsesRetained;
        return;
      }
      if (ev.type === 'productShortage') return;
      if (ev.type === 'dirtyTable') {
        const t = tgt;
        if (how === 'ok') { t.state = 'clean'; t.reserved = false; t.failedAt = 0; }
        else if (how === 'fail') { t.reserved = false; t.failedAt = this.G.time; }
        else t.reserved = false;
        return;
      }
      const g = tgt;
      if (g.ambientOrder && g.order) {
        g.ev = null;
        if (how === 'ok') this.G.production.deliver(g.order);
        return;
      }
      if (how === 'ok') {
        g.playAction('reactGood', 1.1, () => {
          this.free(g);
          const tables = this.G.state === 'playing' && g.role === 'counter' && Math.random() < 0.4 ? this.cleanTable() : null;
          if (tables) this.sitAmbient(g, U.pick(tables), 12); else this.leave(g);
        });
      } else if (how === 'fail') {
        this.free(g);
        g.playAction('reactBad', 1.0, () => this.leave(g, true));
      } else { this.free(g); this.leave(g); }
    }

    sitAmbient(g, table, eatSec) {
      const seat = table.seats.find((s) => !s.taken);
      if (!seat) { this.leave(g); return; }
      seat.taken = true; table.reserved = true; g.seat = seat; g.table = table; g.ambient = true;
      const ok = this.walk(g, seat, () => {
        g.x = seat.x; g.y = seat.y; g.dir = seat.face; g.seated = true; g.idleAnim = 'eat';
        g.eatLeft = eatSec;
        g.ambient = true;
        table.reserved = false;
        table.state = 'occupied';
        BK.bus.emit('ambient:activity', { type: 'CUSTOMER_SIT', entity: g, table });
      });
      if (!ok) { seat.taken = false; table.reserved = false; this.leave(g); }
    }

    ambientTarget() {
      const c = this.G.clock, p = c.phase;
      const [a, b] = p.ambientGuests || [0, 0];
      return Math.round(U.lerp(a, b, c.phaseProgress(p)));
    }

    tickPatience(g, dt) {
      const G = this.G, P = G.cfg.operations.patience, ch = g.ambientChannel;
      // Comprobaciones previas: nunca se abandona por un fallo de posición o de reserva.
      const d = g.slot || g.kiosk || g.spot || g.pickSpot;
      if (d && !g.leaving) {
        d.busy = true;
        if (Math.hypot(g.x - d.x, g.y - d.y) > 40 && !g.dest) { g.patience = Math.min(g.patience || 0, 0.4); g.dest = d; if (!this.recoverNavigation(g)) this.dropSilently(g); return; }
      }
      const max = P.maxSec[ch] * G.difficulty.timerScale;
      const queued = G.production.orders.filter((o) => o.channel === ch && o.status !== 'delivered').length;
      g.patience = (g.patience || 0) + dt * (1 + P.queueAcceleration * Math.max(0, queued - 1)) / max;
      if (g.patience >= 1) this.abandon(g);
    }
    abandon(g, reason) {
      const G = this.G, P = G.cfg.operations.patience;
      if (g.abandoned) return;
      g.collecting = true; g.abandoned = true;
      if (g.ev) G.events.dismiss(g.ev);
      G.production.cancel(g.order);
      this.free(g);
      G.scoring.add(P.abandonPenalty, 'Un cliente se marcha sin ser atendido', { x: g.x, y: g.y }, 'customer');
      G.scoring.m.abandoned = (G.scoring.m.abandoned || 0) + 1;
      G.scoring.breakCombo();
      BK.bus.emit('ambient:activity', { type: 'CUSTOMER_ABANDON', channel: g.ambientChannel, entity: g });
      BK.bus.emit('customer:abandon', { channel: g.ambientChannel, guest: g, reason });
      g.playAction('reactBad', 1.0, () => this.leave(g, true));
    }
    updateRestroom(dt) {
      const G = this.G, R = this.restroom, cfg = G.cfg.operations.restroom;
      if (!['OPEN', 'CLOSING'].includes(G.restaurantState) || G.state !== 'playing') return;
      if (R.cooldown > 0) R.cooldown -= dt;
      if (R.ev || R.cooldown > 0 || R.uses < cfg.usesPerCleaning) return;
      const p = G.map.points.checkRestroom;
      const location = { x: p[0], y: p[1] };
      const interact = G.nav.approachPoint('staff', location, G.player.char, 34);
      const ev = G.events.schedule('restroom');
      G.events.activate(ev, { location, interact, face: 0, target: { restroom: true }, lift: 44 });
      R.ev = ev;
    }

    update(dt) {
      const G = this.G;
      for (const g of this.guests) {
        g.update(dt);
        if (!g.dead) this.checkStall(g, dt);
        if (g.waitTable && !g.leaving) { this.updateTableWaiter(g); continue; }
        if (g.ambientOrder && !g.leaving) {
          if ((g.ambientStage === 'ordering' || g.ambientStage === 'waiting') && !g.collecting) this.tickPatience(g, dt);
          if (g.leaving) continue;
          // Pedido de rider listo pero sin nadie en delivery: el encargado puede entregarlo él.
          if (g.role === 'rider' && !g.ev && !g.collecting && g.order && g.order.status === 'awaiting-channel' && !g.moving) {
            const ev = G.events.schedule('delivery'); g.ev = ev; ev.targetEntity = g; ev.eta = 0;
            G.events.activate(ev, { location: { x: g.x, y: g.y },             interact: this.deliveryAt, face: this.deliveryFace, target: g, lift: 62 });
          }
          if (g.ambientStage === 'ordering') {
            g.orderWait -= dt;
            if (g.orderWait <= 0) {
              g.ambientStage = 'waiting';
              g.order = G.production.enqueue(g.ambientChannel, g);
              BK.bus.emit('ambient:activity', { type: 'CUSTOMER_ORDER', channel: g.ambientChannel, entity: g });
              if (g.ambientChannel === 'kiosk') this.goToPickup(g);
            }
          } else if (g.orderReady && !g.collecting) {
            g.collecting = true;
            BK.bus.emit('ambient:activity', { type: 'CUSTOMER_ORDER_READY', channel: g.ambientChannel, entity: g });
            if (g.role === 'rider') {
              this.free(g);
              this.leave(g, true);
            } else {
              this.free(g);
              const tables = this.cleanTable();
              if (tables && Math.random() < 0.4) this.sitAmbient(g, U.pick(tables), U.rnd(18, 30));
              else this.leave(g);
            }
          }
        }
        if (g.seated && g.eatLeft !== undefined) {
          g.eatLeft -= dt;
          if (g.eatLeft <= 0) {
            g.eatLeft = undefined; g.seated = false; g.idleAnim = 'idle';
            if (g.seat) g.seat.taken = false;
            if (g.table && (g.role === 'diner' || g.ambient)) {
              g.table.state = 'dirty'; g.table.dirtyAt = G.time;
              BK.bus.emit('ambient:activity', { type: 'TABLE_DIRTY', entity: g, table: g.table });
            }
            if (g.role === 'diner') {
              const ap = G.nav.approachPoint('staff', { x: g.table.cx, y: g.table.cy }, G.player.char, 34);
              G.events.activate(g.ev, { location: { x: g.table.cx, y: g.table.cy }, interact: ap, face: 0, target: g.table, lift: 34 });
              g.ev = null;
            }
            this.leave(g);
          }
        }
      }
      this.guests = this.guests.filter((g) => !g.dead);
      this.sweepT += dt;
      if (this.sweepT >= 2) { this.sweepT = 0; this.sweepReservations(); }
      this.updateRestroom(dt);

      // mesas desatendidas tras un fallo: el equipo las limpia pasado un tiempo
      for (const t of this.tables) {
        if (t.state === 'dirty' && t.reserved && t.failedAt && G.time - t.failedAt > 22) { t.state = 'clean'; t.reserved = false; t.failedAt = 0; }
      }

      // clientes de ambiente
      if (['OPEN', 'CLOSING'].includes(G.restaurantState) && G.state === 'playing') {
        this.ambientT -= dt;
        const n = this.guests.filter((g) => g.ambient).length;
        if (this.ambientT <= 0) {
          this.ambientT = U.rnd(3, 7);
          const tabs = this.cleanTable();
          if (n < this.ambientTarget() && tabs) {
            const g = this.newGuest('ambient');
            this.sitAmbient(g, U.pick(tabs), U.rnd(25, 55));
            BK.bus.emit('ambient:activity', { type: 'CUSTOMER_ENTER', channel: 'dining', entity: g });
            if (g.dead) this.guests = this.guests.filter((x) => x !== g);
          }
        }
      }
    }
    clear() {
      this.guests = [];
      this.restroom = { uses: 0, cooldown: 0, ev: null };
      this.tables.forEach((t) => { t.state = 'clean'; t.reserved = false; t.waiting = 0; t.seats.forEach((s) => (s.taken = false)); });
      this.slots.forEach((s) => (s.busy = false)); this.kiosks.forEach((k) => (k.busy = false));
      this.pickup.busy = false; this.pickSpots.forEach((s) => (s.busy = false)); this.riderSpots.forEach((s) => (s.busy = false)); this.waitSpots.forEach((s) => (s.busy = false));
    }
  }
  BK.CustomerSystem = CustomerSystem;
})();
