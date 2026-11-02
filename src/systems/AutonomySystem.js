(function () {
  const BK = window.BK;

  // Los empleados asignados a un puesto atienden solos, por orden de llegada, los eventos de su canal.
  // El encargado solo interviene en lo que no está cubierto, en lo urgente o para mejorar el resultado.
  const CATEGORY_OF = { counter: 'counter', kiosk: 'counter', pendingOrder: 'counter', delivery: 'delivery', vehicle: 'autoking', dirtyTable: 'hall', restroom: 'hall' };
  const JOB_ANIM = { counter: 'talk', autoking: 'talk', delivery: 'deliver', hall: 'clean' };
  const JOB_TEXT = {
    counter: 'Atendiendo a un cliente', kiosk: 'Ayudando en el kiosco', pendingOrder: 'Entregando un pedido', delivery: 'Entregando al repartidor',
    vehicle: 'Entregando en ventana', dirtyTable: 'Limpiando una mesa', restroom: 'Limpiando los baños'
  };

  class AutonomySystem {
    constructor(G) { this.G = G; this.jobs = []; this.restroomReactionSec = 14; }
    get cfg() { return this.G.cfg.operations.autonomy; }
    reset() { this.jobs = []; }

    staffCapacity(category) {
      return this.G.employees.list.filter((c) => c.available && !c.absent && c.status === 'WORKING' && c.category === category && c.position).length;
    }
    idleWorker(category) {
      return this.G.employees.list.find((c) => c.available && !c.absent && c.status === 'WORKING' && c.category === category && c.position && !c.override && !c.autoJob);
    }
    reaction(ev) { return ev.type === 'restroom' ? this.restroomReactionSec : this.cfg.reactionSec; }
    // Al reasignar a un empleado se aborta su tarea automática y se liberan sus reservas.
    cancelFor(c) {
      const job = c.autoJob;
      if (!job) return;
      this.jobs = this.jobs.filter((j) => j !== job);
      c.autoJob = null;
      if (job.table) job.table.reserved = false;
      if (job.ev && job.ev.auto && job.ev.state === 'inProgress') { job.ev.auto = false; job.ev.state = 'pending'; }
      c.idleAnim = 'idle';
    }

    update(dt) {
      const G = this.G;
      if (G.state !== 'playing' || !['OPEN', 'CLOSING'].includes(G.restaurantState)) return;
      this.jobs = this.jobs.filter((job) => !this.advance(job, dt));
      this.autoRestock();
      for (const category of ['counter', 'delivery', 'autoking', 'hall']) {
        const worker = this.idleWorker(category);
        if (!worker) continue;
        const target = this.nextTarget(category);
        if (target) this.start(worker, category, target);
      }
    }

    nextTarget(category) {
      const G = this.G;
      const events = G.events.list
        .filter((e) => CATEGORY_OF[e.type] === category && e.state === 'pending' && !e.auto && e.elapsed >= this.reaction(e))
        .sort((a, b) => a.activatedAt - b.activatedAt || a.id.localeCompare(b.id, undefined, { numeric: true }));
      if (events.length) return { ev: events[0] };
      if (category === 'hall') {
        const wait = this.cfg.idleTableCleanAfterSec;
        const table = G.customers.tables
          .filter((t) => t.state === 'dirty' && !t.reserved && G.time - t.dirtyAt >= wait)
          .sort((a, b) => a.dirtyAt - b.dirtyAt)[0];
        if (table) return { table };
      }
      return null;
    }

    start(worker, category, target) {
      const G = this.G;
      const type = target.ev ? target.ev.type : 'dirtyTable';
      const job = { worker, category, type, ev: target.ev || null, table: target.table || null, phase: 'work', left: this.cfg.workSec[type] || 5, prevAnim: worker.idleAnim };
      worker.autoJob = job; worker.mode = 'auto'; worker.task = JOB_TEXT[type];
      if (job.table) job.table.reserved = true;
      if (category === 'hall') {
        const point = target.ev ? target.ev.interact || target.ev.location : { x: job.table.cx, y: job.table.cy };
        const approach = G.nav.approachPoint('staff', target.ev ? target.ev.location : point, worker, 30);
        job.phase = 'walk';
        const arrived = () => { if (worker.autoJob === job) job.phase = 'arrived'; };
        worker.idleAnim = 'idle';
        if (!G.employees.walkTo(worker, approach || point, arrived)) job.phase = 'arrived';
      } else {
        worker.idleAnim = JOB_ANIM[category];
        if (job.ev && !G.events.beginAuto(job.ev)) { this.finish(job); return; }
      }
      this.jobs.push(job);
      BK.bus.emit('autonomy:start', { employee: worker, type, event: job.ev });
    }

    advance(job, dt) {
      const G = this.G, ev = job.ev;
      if (ev && ev.state === 'failed') { this.finish(job, true); return true; }
      if (ev && ev.state === 'dismissed') { this.finish(job, true); return true; }
      if (job.phase === 'walk') {
        if (ev && ev.state !== 'pending') { this.finish(job, true); return true; }
        return false;
      }
      if (job.phase === 'arrived') {
        job.phase = 'work';
        job.worker.idleAnim = JOB_ANIM[job.category];
        if (ev && !G.events.beginAuto(ev)) { this.finish(job, true); return true; }
        return false;
      }
      job.left -= dt * G.employees.workSpeedFor(job.worker, job.category);
      if (job.left > 0) return false;
      if (ev) G.events.completeAuto(ev);
      else if (job.table) { job.table.state = 'clean'; job.table.reserved = false; job.table.failedAt = 0; BK.bus.emit('autonomy:table', { table: job.table }); }
      this.finish(job);
      return true;
    }

    finish(job, aborted) {
      const worker = job.worker;
      worker.autoJob = null;
      worker.task = 'Trabajando';
      if (job.table && job.table.reserved && aborted) job.table.reserved = false;
      worker.idleAnim = job.prevAnim || 'idle';
      if (job.category === 'hall') this.G.employees.goHome(worker);
      else { worker.mode = 'work'; worker.timer = 4; }
    }

    // Un producto agotado bloquea pedidos: el equipo de la estación inicia el lote tras un margen para que el encargado actúe primero.
    autoRestock() {
      const G = this.G, wait = this.cfg.restockAfterBlockedSec;
      const blocked = G.production.orders.filter((o) => o.status === 'blocked' && o.blockedAt != null && G.time - o.blockedAt >= wait);
      for (const o of blocked) {
        const id = o.blockedBy, product = G.cfg.operations.products[id];
        if (!product || G.production.restocking[id]) continue;
        const category = id === 'MAIN_PRODUCT' ? 'kitchen' : id === 'FRIES' ? 'fries' : 'assembly';
        if (this.staffCapacity(category) < 1) continue;
        if (G.production.beginRestock(id)) BK.bus.emit('autonomy:restock', { id });
      }
      for (const ev of G.events.list) {
        if (ev.type !== 'productShortage' || ev.state !== 'pending' || !ev.targetEntity) continue;
        const id = ev.targetEntity.productId;
        if (G.production.restocking[id] && G.events.beginAuto(ev)) G.events.completeAuto(ev);
      }
    }
  }
  BK.AutonomySystem = AutonomySystem;
})();
