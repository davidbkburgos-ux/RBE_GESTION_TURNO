(function () {
  const BK = window.BK;
  const U = BK.util;

  // Vehículos del AutoKing: cola en un único carril; altavoz -> ventana 1 -> ventana 2 -> salida. Empieza vacío.
  class VehicleSystem {
    constructor(G) {
      this.G = G;
      this.lane = new BK.Lane(G.map.vehicleLane.path);
      const st = G.map.vehicleLane.stops;
      this.stopS = {};
      Object.keys(st).forEach((k) => { this.stopS[k] = this.lane.project(st[k].x, st[k].y); });
      this.cars = [];
      this.seq = 0;
      this.records = [];
      this.len = G.cfg.npc.vehicleLength;
      this.wid = Math.round(this.len * 0.5);
      this.gap = G.cfg.npc.vehicleGap;
      this.colors = ['#8c2f2f', '#2f4f7a', '#d4d4d4', '#3a3a3a', '#4c6b43', '#c9a227', '#6a3f7a', '#a8571f', '#e8e8e8', '#1f6f8b', '#b3262e', '#5b6770'];
      BK.bus.on('event:failed', (e) => this.onDone(e.ev, false));
      BK.bus.on('event:resolved', (e) => this.onDone(e.ev, true));
      BK.bus.on('event:dismissed', (ev) => this.onDone(ev, null));
    }
    get ORDER_DWELL_SEC() { return 5.6; }
    get count() { return this.cars.length; }
    // Barra de progreso del punto activo del coche: pedido o recogida (0..1.5+; >1 = fuera de objetivo).
    bar(car) {
      const T = this.G.cfg.operations.vehicleKpi.phaseTargetSec;
      if (car.state === 'leaving' || car.abandoned) return null;
      if (car.orderDoneAt === null) return { phase: 'order', label: 'PEDIDO', f: (this.G.time - car.arrival) / T.order };
      return { phase: 'pickup', label: 'RECOGIDA', f: (this.G.time - car.orderDoneAt) / T.pickup };
    }
    canSpawn() {
      if (this.cars.length >= 5) return false;
      const last = this.cars.reduce((m, c) => (c.s < m ? c.s : m), 1e9);
      return this.cars.length === 0 || last > this.len + this.gap + 30;
    }
    spawn() {
      if (!this.canSpawn()) return null;
      const car = new BK.Vehicle('V' + (++this.seq), U.pick(this.colors), this.len, this.wid);
      // Aspecto cosmético derivado del id (no consume el RNG de la simulación)
      const hv = Math.imul(this.seq * 2654435761 >>> 0, 2246822519) >>> 0;
      car.body = BK.CAR_BODIES[(hv >>> 8) % BK.CAR_BODIES.length];
      car.acc = BK.CAR_ACCS[(hv >>> 16) % BK.CAR_ACCS.length];
      car.stop = 'order'; car.state = 'driving'; car.s = 0;
      car.arrival = this.G.time;
      car.phaseTimes = { arrival: car.arrival, orderStart: null, orderEnd: null, pickupStart: null, exit: null };
      car.orderDoneAt = null; car.orderSec = null; car.pickupSec = null;
      car.queueWait = 0; car.orderWait = 0; car.pickupWait = 0;
      car.blockedSec = 0; car.productReady = false; car.eventCreated = false;
      const p = this.lane.at(0); car.x = p.x; car.y = p.y; car.ang = p.ang;
      this.G.production.enqueue('autoking', car);
      this.cars.push(car);
      BK.bus.emit('ambient:activity', { type: 'VEHICLE_ENTER', entity: car });
      return car;
    }
    activatePickup(car, p) {
      if (car.eventCreated || !car.productReady || this.G.employees.capacity('autoking') < 1) return;
      const ev = this.G.events.schedule('vehicle');
      ev.targetEntity = car;
      car.ev = ev;
      this.G.events.activate(ev, { location: { x: p.x, y: p.y }, interact: (this.G.map.spots && this.G.map.spots.vehicle) || { x: 650, y: 762 }, face: BK.DIR.S, target: car, lift: 34 });
      car.state = 'waitingService';
      car.eventCreated = true;
      car.phaseTimes.pickupStart = this.G.time;
      BK.bus.emit('vehicle:window2', { car });
      BK.bus.emit('ambient:activity', { type: 'VEHICLE_QUEUE', entity: car });
    }
    onDone(ev, ok) {
      const car = ev && ev.targetEntity;
      if (!car || !(car instanceof BK.Vehicle)) return;
      car.released = true; car.hazard = ok === false;
      car.dwell = ok ? 0.8 : 0.4;
      car.serviceResult = ok ? 'resolved' : 'failed';
      if (car.state !== 'leaving') { car.state = 'leaving'; car.dwellLeft = car.dwell; }
    }
    tickPatience(car, dt, queued) {
      const G = this.G, P = G.cfg.operations.patience;
      car.patience = (car.patience || 0) + dt * (1 + P.queueAcceleration * Math.max(0, queued - 1)) / (P.maxSec.autoking * G.difficulty.timerScale);
      if (car.patience < 1) return;
      car.abandoned = true; car.released = true; car.hazard = true;
      G.production.cancel(G.production.orders.find((o) => o.channel === 'autoking' && o.sourceId === car.id));
      G.scoring.add(P.autokingAbandonPenalty, 'Un coche abandona el ' + BK.autoName + ' sin ser atendido', { x: car.x, y: car.y }, 'customer');
      G.scoring.m.abandoned = (G.scoring.m.abandoned || 0) + 1;
      G.scoring.breakCombo();
      car.state = 'leaving'; car.dwellLeft = 0.4;
      BK.bus.emit('ambient:activity', { type: 'VEHICLE_ABANDON', channel: 'autoking', entity: car });
      BK.bus.emit('customer:abandon', { channel: 'autoking', car });
    }
    update(dt) {
      const G = this.G, sp = G.cfg.npc.vehicleSpeed;
      const cars = this.cars.slice().sort((a, b) => b.s - a.s);
      cars.forEach((car, i) => {
        const leader = cars[i - 1];
        if (car.state !== 'leaving' && car.state !== 'waitingService') this.tickPatience(car, dt, cars.length);
        let target = car.state === 'leaving' ? this.lane.length : this.stopS[car.stop];
        if (car.state === 'leaving' && car.dwellLeft > 0) { car.dwellLeft -= dt; target = car.s; }
        if (car.state === 'waitingProduct' || car.state === 'waitingService') {
          target = car.s;
          if (car.state === 'waitingProduct') {
            car.pickupWait += dt;
            this.activatePickup(car, this.lane.at(car.s));
          } else car.pickupWait += dt;
        }
        if (car.state === 'dwell') {
          target = car.s;
          if (G.employees.capacity('autoking') > 0) car.timer += dt;
          else car.orderWait += dt;
        }
        const maxS = leader ? leader.s - (this.len + this.gap) : 1e9;
        const desired = Math.min(target, maxS);
        const room = desired - car.s;
        const serviceBlocked = car.state === 'dwell' || car.state === 'waitingProduct' || car.state === 'waitingService' || (car.state === 'leaving' && car.dwellLeft > 0);
        const v = !serviceBlocked && room > 0.4 ? Math.min(sp, room * 3 + 6) : 0;
        car.speed = v;
        car.s += Math.min(v * dt, Math.max(0, room));
        if (leader && maxS <= target + 0.4 && room <= 0.4 && !serviceBlocked) {
          car.blockedSec += dt;
          if (car.blockedSec > 2) car.queueWait += dt;
        } else car.blockedSec = 0;
        const p = this.lane.at(car.s);
        car.x = p.x; car.y = p.y; car.ang = p.ang;

        if (car.state === 'driving' && Math.abs(car.s - target) < 6) {
          if (car.stop === 'pickup') {
            car.state = 'waitingProduct'; car.phaseTimes.pickupStart = G.time;
            this.activatePickup(car, p);
          } else {
            car.state = 'dwell'; car.timer = 0;
            car.phaseTimes.orderStart = G.time;
            BK.bus.emit('vehicle:stop', { car, stop: car.stop });
          }
        } else if (car.state === 'dwell' && car.stop === 'order') {
          if (G.employees.capacity('autoking') > 0 && car.timer >= this.ORDER_DWELL_SEC) {
            car.phaseTimes.orderEnd = car.orderDoneAt = G.time;
            car.orderSec = car.orderDoneAt - car.arrival;
            car.state = 'driving'; car.stop = 'pickup';
          }
        }
        if (car.s >= this.lane.length - 1) {
          car.dead = true; car.phaseTimes.exit = G.time;
          if (car.ev && G.events.isLive(car.ev)) G.events.dismiss(car.ev);
          if (car.orderDoneAt !== null) car.pickupSec = Math.max(0, G.time - car.orderDoneAt);
          // El tiempo de servicio es el promedio de las dos barras: pedido y recogida.
          const totalDriveTime = car.orderSec !== null && car.pickupSec !== null ? (car.orderSec + car.pickupSec) / 2 : Math.max(0, G.time - car.arrival);
          if (car.serviceResult) this.records.push({ serviceSec: totalDriveTime, orderSec: car.orderSec, pickupSec: car.pickupSec, completedAt: G.clock.t, queueWait: car.queueWait, orderWait: car.orderWait, pickupWait: car.pickupWait });
          BK.bus.emit('vehicle:exit', { car, totalDriveTime });
          BK.bus.emit('ambient:activity', { type: 'VEHICLE_EXIT', entity: car });
        }
      });
      this.cars = this.cars.filter((c) => !c.dead);
    }
    kpi() {
      const cfg = this.G.cfg.operations.vehicleKpi;
      const recent = this.records.filter((r) => this.G.clock.t - r.completedAt <= cfg.rollingWindowGameMinutes);
      const mean = (a) => a.length ? a.reduce((n, r) => n + r.serviceSec, 0) / a.length : null;
      return {
        last: this.records.length ? this.records[this.records.length - 1].serviceSec : null,
        rolling: mean(recent), day: mean(this.records), completed: this.records.length,
        target: cfg.targetSec, warning: cfg.warningSec, critical: cfg.criticalSec,
        queued: this.cars.length, blocked: this.cars.filter((c) => c.state === 'waitingProduct' || c.state === 'waitingService').length,
        definition: cfg.definition
      };
    }
    clear() { this.cars = []; this.records = []; this.seq = 0; }
  }
  BK.VehicleSystem = VehicleSystem;
})();
