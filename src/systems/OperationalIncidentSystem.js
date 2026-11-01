(function () {
  const BK = window.BK;

  class OperationalIncidentSystem {
    constructor(G) {
      this.G = G;
      this.reset();
      BK.bus.on('event:failed', (e) => {
        this.failed.push(G.time);
        if (e.ev.type !== 'complaint') this.complaintQueued = true;
      });
      BK.bus.on('production:low', (e) => this.record('PRODUCT_SHORTAGE', e.label + ' bajo.'));
      BK.bus.on('production:restocked', (e) => this.record('PRODUCT_RESTOCKED', G.cfg.operations.products[e.id].label + ' repuesto.'));
      BK.bus.on('employees:positioned', (e) => this.record('TEAM_REPOSITION', e.employee.displayId + ' cambia de posición.'));
      BK.bus.on('priority:chosen', (e) => this.record('CHANNEL_PRIORITY', 'Canal priorizado: ' + G.ev.channels[e.channel].label + '.'));
      BK.bus.on('production:delivered', (e) => {
        if (e.order.channel === 'counter' && e.order.id === 'ORD-1') this.record('FIRST_ORDER', 'Primer pedido completado.');
      });
    }
    reset() {
      this.checkT = 0;
      this.absencePlan = this.planAbsences();
      this.failed = [];
      this.complaintQueued = false;
      this.complaintCooldown = 0;
      this.timeline = [];
      this.lastShift = 'meal';
    }
    record(type, text) {
      const row = { type, text, at: this.G.clock.t };
      this.timeline.push(row);
      if (this.timeline.length > 40) this.timeline.shift();
      BK.bus.emit('incident:timeline', row);
    }
    update(dt) {
      const G = this.G;
      if (G.state !== 'playing') return;
      if (this.absencePlan.length) this.tryAbsence();
      if (G.clock.t >= BK.util.parseHM('18:00', G.clock.start) && this.lastShift !== 'dinner') {
        this.lastShift = 'dinner';
        G.employees.activateShift('dinner');
        this.record('SHIFT_CHANGE', 'Cambio de turno: entra el equipo de cena.');
        BK.bus.emit('employees:shift-warning', { shift: 'dinner', active: G.employees.activeCount });
      }
      this.failed = this.failed.filter((t) => G.time - t < 180);
      if (this.complaintQueued && this.complaintCooldown <= 0 && G.opening.isOpen) {
        this.complaintQueued = false;
        const ev = G.customers.spawnComplaint();
        if (ev) {
          this.complaintCooldown = 180;
          this.record('CUSTOMER_COMPLAINT', 'Un cliente solicita atención del encargado.');
        }
      }
      if (this.failed.length >= 2 && this.complaintCooldown <= 0 && G.opening.isOpen) this.complaintQueued = true;
    }
    // Plan de ausencias por semilla: como mucho una baja posible por turno, con probabilidad muy baja.
    planAbsences() {
      const G = this.G, cfg = G.cfg.operations.absence, plan = [];
      if (!cfg.enabled) return plan;
      let a = ((G.seed || 1) ^ 0x9E3779B9) >>> 0;
      const rnd = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
      const chance = cfg.chancePerShift[G.save.settings.difficulty] || 0.04;
      ['meal', 'dinner'].forEach((shift) => {
        const hit = rnd() < chance, delay = cfg.delayMinutes[0] + rnd() * (cfg.delayMinutes[1] - cfg.delayMinutes[0]), pick = rnd();
        if (hit) plan.push({ shift, at: BK.util.parseHM(cfg.shiftStarts[shift], G.clock.start) + delay, pick, done: false });
      });
      return plan;
    }
    tryAbsence() {
      const G = this.G;
      this.absencePlan.forEach((p) => {
        if (p.done || G.clock.t < p.at) return;
        const pool = G.employees.list.filter((e) => e.shift === p.shift && !e.absent && !e.hired);
        if (!pool.length) { p.done = true; return; }
        this.forceAbsence(pool[Math.floor(p.pick * pool.length) % pool.length]);
        p.done = true;
      });
    }
    forceAbsence(employee) {
      const G = this.G;
      if (!employee || employee.absent) return null;
      employee.absent = true;
      employee.available = false;
      employee.status = 'ABSENT';
      employee.alpha = 0;
      if (G.employees.releaseStation) G.employees.releaseStation(employee);
      const text = employee.displayId + ' no se ha presentado al turno. Puedes cubrir la vacante en Operación › Vacantes.';
      this.record('ABSENT_EMPLOYEE', text);
      BK.bus.emit('incident:absence', { employee, shift: employee.shift, text });
      return employee;
    }
    startComplaint(ev) {
      const question = this.G.questions.next('customer-recovery');
      if (!question) throw new Error('No hay conocimiento validado para la pregunta de recuperación de cliente.');
      BK.bus.emit('incident:complaint-question', { ev, question });
    }
    answerComplaint(ev, index, correctIndex) {
      const G = this.G;
      const ok = index === correctIndex;
      if (ok) {
        G.events.complete(ev);
        this.record('COMPLAINT_RESOLVED', 'Queja atendida; cliente recuperado.');
      } else {
        G.events.fail(ev);
        G.scoring.m.negativeReviews = (G.scoring.m.negativeReviews || 0) + 1;
        G.scoring.add(-250, 'Reseña simulada negativa', ev.location);
        this.record('NEGATIVE_REVIEW', 'Reseña simulada: 1/5.');
        BK.bus.emit('incident:negative-review', { rating: 1 });
      }
      return ok;
    }
    snapshot() {
      return {
        checkT: this.checkT, absencePlan: this.absencePlan, failed: this.failed,
        complaintQueued: this.complaintQueued, complaintCooldown: this.complaintCooldown,
        timeline: this.timeline, lastShift: this.lastShift
      };
    }
    restore(s) { if (s) Object.assign(this, s); }
  }
  BK.OperationalIncidentSystem = OperationalIncidentSystem;
})();
