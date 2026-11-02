(function () {
  const BK = window.BK;
  const U = BK.util;

  class ProductionSystem {
    constructor(G) {
      this.G = G;
      this.reset();
    }
    reset() {
      this.nextId = 0;
      this.orders = [];
      this.records = { counter: [], autoking: [], delivery: [], kiosk: [], dining: [] };
      this.stock = Object.fromEntries(Object.entries(this.G.cfg.operations.products).map(([id, p]) => [id, p.initialStock]));
      this.restocking = {};
      this.reserve = {};
      this.notified = {};
      this.prepRuns = {};
      this.preparedTotal = 0;
      this.expectedCache = null;
      this.blockedMsgAt = -999;
      this.wasteSettled = false;
      this.warned = new Set();
      this.friesLevel = null;
      this.openingExtraStockUseChance = 0;
      this.stageSec = Object.assign({ MAIN_PRODUCT: 8, FRIES: 6, DRINKS: 3, SIDES: 4, DESSERTS: 4, ASSEMBLY: 5 }, this.G.cfg.operations.stageSec || {});
    }
    enqueue(channel, source) {
      const needs = (this.G.cfg.operations.orderComponents || ['MAIN_PRODUCT', 'FRIES', 'DRINKS']).slice();
      if (channel === 'delivery') needs.push('SIDES');
      const order = {
        id: 'ORD-' + (++this.nextId), channel, sourceId: source && typeof source === 'object' ? source.id : source, components: needs,
        status: 'queued', stage: 0, stageT: 0, consumed: false,
        serviceStartAt: this.G.time, createdAt: this.G.clock.t, deliveredAt: null
      };
      if (source && typeof source === 'object') source.productionOrderId = order.id;
      this.orders.push(order);
      BK.bus.emit('production:order', { order });
      return order;
    }
    capacity(category) { return this.G.employees.capacity(category); }
    // Trabajo pendiente de una categoría de puesto (pedidos en su fase o listos para entregar por su canal).
    pendingFor(category) {
      return this.orders.filter((o) => {
        if (o.status === 'delivered') return false;
        if (o.stage < o.components.length) return this.stageCategory(o.components[o.stage] || 'ASSEMBLY') === category;
        return this.deliveryCategory(o) === category;
      }).length;
    }
    // Los pedidos de mostrador y kiosco los entrega montaje/expedición.
    deliveryCategory(o) {
      return o.channel === 'counter' || o.channel === 'kiosk' ? 'assembly' : o.channel === 'dining' ? 'hall' : o.channel;
    }
    stageCategory(component) {
      const over = this.G.cfg.operations.stageCategory;
      if (over && over[component]) return over[component];
      if (component === 'MAIN_PRODUCT') return 'kitchen';
      if (component === 'FRIES') return 'fries';
      if (component === 'ASSEMBLY') return 'assembly';
      return 'assembly';
    }
    update(dt) {
      const tr = this.tramo();
      if (this.G.clock.t >= 720 && !this.prepRuns[tr.id] && !this.notified[tr.id]) {
        this.notified[tr.id] = true;
        BK.bus.emit('production:prep-needed', { tramo: tr });
      }
      const products = this.G.cfg.operations.products;
      for (const [id, p] of Object.entries(products)) {
        const stock = this.stock[id];
        if (stock <= p.minimumStock && !this.warned.has(id)) {
          this.warned.add(id);
          BK.bus.emit('production:low', { id, stock, label: p.label });
        }
        if (stock > p.minimumStock) this.warned.delete(id);
      }

      // Patatas: amarillo = stock bajo, rojo = sin patatas. La fritadora avisa en cada cambio a peor.
      const fries = this.stock.FRIES, level = fries <= 0 ? 'red' : fries <= products.FRIES.minimumStock ? 'yellow' : 'ok';
      if (level !== this.friesLevel) {
        const prev = this.friesLevel;
        this.friesLevel = level;
        if (prev !== null && level !== 'ok' && (prev === 'ok' || level === 'red')) BK.bus.emit('production:fryer-alert', { level, stock: fries });
      }

      for (const job of Object.values(this.restocking)) {
        job.left -= dt;
        if (job.left <= 0) {
          this.stock[job.product] += job.amount;
          delete this.restocking[job.product];
          this.warned.delete(job.product);
          BK.bus.emit('production:restocked', { id: job.product, stock: this.stock[job.product] });
        }
      }

      const inProcess = this.orders.filter((o) => o.status !== 'delivered' && o.stage < o.components.length)
        .sort((a, b) => Number(b.channel === this.G.priority.channel) - Number(a.channel === this.G.priority.channel) || a.serviceStartAt - b.serviceStartAt);
      const assigned = new Set();
      for (const category of ['kitchen', 'chef', 'fries', 'assembly']) {
        const cap = this.capacity(category);
        if (!cap) continue;
        const eligible = inProcess.filter((o) => !assigned.has(o.id) && this.stageCategory(o.components[o.stage] || 'ASSEMBLY') === category);
        eligible.slice(0, cap).forEach((o) => {
          assigned.add(o.id);
          const component = o.components[o.stage];
          if (!o.consumed) {
            if (component !== 'ASSEMBLY') {
              const stockKey = component;
              if (this.stock[stockKey] <= 0) {
                o.status = 'blocked';
                o.blockedBy = stockKey;
                if (o.blockedAt == null) o.blockedAt = this.G.time;
                return;
              }
              this.stock[stockKey] -= 1;
              if (stockKey === 'MAIN_PRODUCT' && this.openingExtraStockUseChance > 0 &&
                  this.stock[stockKey] > 0 && Math.random() < this.openingExtraStockUseChance) {
                this.stock[stockKey] -= 1;
                BK.bus.emit('production:opening-risk', { id: stockKey, stock: this.stock[stockKey] });
              }
            }
            o.consumed = true;
            o.blockedBy = null; o.blockedAt = null;
          }
          o.status = 'preparing';
          o.stageT += dt * this.G.employees.speedFactor(category, o.channel);
          const duration = this.stageSec[component] || this.stageSec.ASSEMBLY;
          if (o.stageT >= duration) {
            o.stage++;
            o.stageT = 0;
            o.consumed = false;
            if (o.stage >= o.components.length) { o.stage = o.components.length; o.status = 'ready'; }
          }
        });
      }

      for (const o of this.orders) {
        if (o.status !== 'ready' && o.status !== 'awaiting-channel') continue;
        const category = this.deliveryCategory(o);
        if (this.capacity(category) < 1) { o.status = 'awaiting-channel'; continue; }
        this.deliver(o);
      }
      this.orders = this.orders.filter((o) => o.status !== 'delivered' || this.G.time - o.deliveredAt < 30);
    }
    // Entrega de un pedido listo; también la usa el encargado cuando atiende un canal sin cobertura.
    deliver(o) {
      if (!o || o.status === 'delivered') return;
      {
        o.status = 'delivered';
        o.deliveredAt = this.G.time;
        o.serviceSec = Math.max(0, o.deliveredAt - o.serviceStartAt);
        const row = { serviceSec: o.serviceSec, completedAt: this.G.clock.t, createdAt: o.createdAt, id: o.id };
        if (o.channel !== 'autoking') (this.records[o.channel] || this.records.counter).push(row);
        if (o.channel === 'autoking') {
          const car = this.G.vehicles.cars.find((v) => v.id === o.sourceId);
          if (car) car.productReady = true;
        }
        if (o.channel !== 'autoking') {
          const target = this.G.cfg.operations.serviceKpi;
          const points = o.serviceSec <= target.targetSec ? this.G.cfg.operations.serviceScore.onTarget :
            o.serviceSec > target.criticalSec ? this.G.cfg.operations.serviceScore.criticalDelay : 0;
          if (points) this.G.scoring.add(points, 'Pedido ' + o.id + (points > 0 ? ' en objetivo' : ' con demora crítica'), null, 'service');
        }
        BK.bus.emit('production:delivered', { order: o, row });
      }
    }
    cancel(order) {
      if (!order) return;
      this.orders = this.orders.filter((o) => o !== order);
    }
    beginRestock(id) {
      const p = this.G.cfg.operations.products[id];
      if (!p || this.restocking[id]) return false;
      let amount = p.prepAmount;
      if (this.G.cfg.operations.stockPrep.products.includes(id)) {
        const avail = this.reserve[id] || 0;
        if (avail <= 0) {
          if (this.G.time - this.blockedMsgAt > 25) {
            this.blockedMsgAt = this.G.time;
            BK.bus.emit('production:restock-blocked', { id, reason: 'No queda producto preparado en la cámara. Ve a la cámara de congelado y prepara más.' });
          }
          return false;
        }
        amount = Math.min(amount, avail);
        this.reserve[id] = avail - amount;
      }
      this.restocking[id] = { product: id, amount, left: p.prepTime };
      BK.bus.emit('production:restocking', { id, amount });
      return true;
    }

    // ---------- preparación del encargado en la cámara de congelado ----------
    tramo(t = this.G.clock.t) {
      const list = this.G.cfg.operations.stockPrep.tramos, h = t / 60;
      return list.find((x) => h >= x.from && h < x.to) || (h < list[0].from ? list[0] : list[list.length - 1]);
    }
    expected(tramo) {
      if (!this.expectedCache) {
        const G = this.G, profile = G.dayProfile || G.cfg.difficultyProfiles[G.save.settings.difficulty];
        this.expectedCache = BK.ArrivalDirector.hourlyForecast(G.cfg, profile);
      }
      let n = 0;
      for (let hr = tramo.from; hr < tramo.to; hr++) n += this.expectedCache[hr - 12] || 0;
      return Math.round(n);
    }
    batchFor(tramo) {
      const sp = this.G.cfg.operations.stockPrep, base = Math.ceil(this.expected(tramo) * sp.coverage);
      return Object.fromEntries(sp.products.map((id) => [id, id === 'SIDES' ? Math.max(1, Math.ceil(base * sp.deliveryShare)) : base]));
    }
    needsPrep() {
      const tr = this.tramo();
      return !this.prepRuns[tr.id] && this.G.state === 'playing';
    }
    managerPrepare() {
      const tr = this.tramo(), batch = this.batchFor(tr);
      Object.entries(batch).forEach(([id, n]) => { this.reserve[id] = (this.reserve[id] || 0) + n; });
      const first = !this.prepRuns[tr.id];
      this.prepRuns[tr.id] = (this.prepRuns[tr.id] || 0) + 1;
      this.preparedTotal += batch.MAIN_PRODUCT;
      BK.bus.emit('production:prepared', { tramo: tr, batch, first });
      if (first) this.G.scoring.add(this.G.cfg.operations.stockPrep.firstPrepScore || 8, 'Preparación del tramo: ' + tr.label, null, 'preparation');
      return batch;
    }
    // Producto preparado que no llegó a usarse: penalización en el resumen final.
    wasteUnits() {
      const sp = this.G.cfg.operations.stockPrep;
      return sp.products.reduce((n, id) => n + Math.max(0, Math.floor(this.reserve[id] || 0)), 0);
    }
    settleWaste() {
      if (this.wasteSettled) return 0;
      this.wasteSettled = true;
      const sp = this.G.cfg.operations.stockPrep, units = this.wasteUnits();
      const pts = -Math.min(sp.wastePenaltyCap, Math.round(Math.max(0, units - sp.wasteToleranceUnits) * sp.wastePenaltyPerUnit));
      this.wasteUnitsFinal = units;
      if (pts) this.G.scoring.add(pts, 'Desperdicio de producto preparado', null, 'waste');
      return pts;
    }
    applyOpeningRisk(readiness = this.G.opening.openingReadiness()) {
      const task = this.G.opening.task('opening-product');
      this.openingExtraStockUseChance = task && readiness.completedTasks.includes(task)
        ? 0 : this.G.cfg.operations.openingRisk.extraStockUseChance;
    }
    kpi(channel) {
      const cfg = channel === 'autoking' ? this.G.cfg.operations.vehicleKpi : this.G.cfg.operations.serviceKpi;
      if (channel === 'autoking') return this.G.vehicles.kpi();
      const rows = this.records[channel] || [];
      const recent = rows.filter((r) => this.G.clock.t - r.completedAt <= cfg.rollingWindowGameMinutes);
      const mean = (a) => a.length ? a.reduce((n, r) => n + r.serviceSec, 0) / a.length : null;
      const queue = this.orders.filter((o) => o.channel === channel && o.status !== 'delivered');
      return {
        last: rows.length ? rows[rows.length - 1].serviceSec : null,
        rolling: mean(recent), day: mean(rows), completed: rows.length,
        target: cfg.targetSec, warning: cfg.warningSec, critical: cfg.criticalSec,
        queued: queue.length, blocked: queue.filter((o) => o.status === 'blocked').length,
        definition: cfg.definition
      };
    }
    snapshot() {
      return { nextId: this.nextId, orders: this.orders, records: this.records, stock: this.stock, restocking: this.restocking, reserve: this.reserve, prepRuns: this.prepRuns, preparedTotal: this.preparedTotal, openingExtraStockUseChance: this.openingExtraStockUseChance };
    }
    restore(s) {
      if (!s) return;
      this.nextId = s.nextId || 0; this.orders = s.orders || [];
      this.records = s.records || this.records; this.stock = s.stock || this.stock; this.restocking = s.restocking || {};
      this.openingExtraStockUseChance = s.openingExtraStockUseChance || 0;
      this.reserve = s.reserve || {}; this.prepRuns = s.prepRuns || {}; this.preparedTotal = s.preparedTotal || 0;
    }
  }
  BK.ProductionSystem = ProductionSystem;
})();
