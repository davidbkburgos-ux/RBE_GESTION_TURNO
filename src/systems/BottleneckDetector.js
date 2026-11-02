(function () {
  const BK = window.BK;

  class BottleneckDetector {
    constructor(G) {
      this.G = G; this.items = []; this.signature = ''; this.shortageEvents = new Set();
      BK.bus.on('event:failed', ({ ev }) => { if (ev.type === 'productShortage' && ev.targetEntity) this.shortageEvents.delete(ev.targetEntity.productId); });
      BK.bus.on('event:dismissed', (ev) => { if (ev.type === 'productShortage' && ev.targetEntity) this.shortageEvents.delete(ev.targetEntity.productId); });
    }
    reset() { this.items = []; this.signature = ''; this.shortageEvents.clear(); }
    stationForProduct(id) {
      if (id === 'MAIN_PRODUCT') return 'grill';
      if (id === 'FRIES') return 'fries';
      return 'assembly';
    }
    stationForChannel(channel) {
      if (channel === 'autoking') return 'autoPay';
      if (channel === 'delivery') return 'delivery';
      if (channel === 'dining') return 'hall';
      return 'assembly';
    }
    update() {
      const G = this.G;
      const reasons = [];
      if (['OPEN', 'CLOSING'].includes(G.restaurantState)) this.updateShortageEvents();
      const cap = (key) => G.employees.capacity(key);
      if (!cap('kitchen')) reasons.push({ id: 'NO_KITCHEN_CAPACITY', label: 'Sin cobertura de cocina', severity: 'critical', station: 'grill' });
      if (!cap('fries')) reasons.push({ id: 'NO_FRIES_CAPACITY', label: 'Sin producción de patatas', severity: 'critical', station: 'fries' });
      if (!cap('assembly')) reasons.push({ id: 'NO_ASSEMBLY_CAPACITY', label: 'Sin montaje / expedición', severity: 'critical', station: 'assembly' });
      if (!cap('counter')) reasons.push({ id: 'COUNTER_OVERLOAD', label: 'Mostrador sin cobertura', severity: 'critical', station: 'counter' });
      if (!cap('autoking')) reasons.push({ id: 'DRIVE_THRU_OVERLOAD', label: 'AutoKing sin cobertura', severity: 'critical', station: 'autoPay' });
      if (!cap('delivery')) reasons.push({ id: 'DELIVERY_OVERLOAD', label: 'Delivery sin cobertura', severity: 'critical', station: 'delivery' });
      const counterWaiting = G.events.active().filter((e) => ['counter', 'kiosk', 'pendingOrder'].includes(e.type) && G.events.isWaiting(e));
      const counterWait = counterWaiting.reduce((max, e) => Math.max(max, e.elapsed / e.timer), 0);
      if (counterWaiting.length >= 2 || counterWait >= 0.4) {
        const label = counterWaiting.length === 1 ? '1 cliente esperando en Mostrador' : counterWaiting.length + ' clientes esperando en Mostrador';
        reasons.push({
          id: 'COUNTER_QUEUE', label,
          severity: counterWaiting.length >= 3 || counterWait >= 0.75 ? 'critical' : 'warning',
          station: 'counter', count: counterWaiting.length
        });
      }
      const vehicleWaiting = G.events.active().filter((e) => e.type === 'vehicle' && G.events.isWaiting(e));
      const vehicleWait = vehicleWaiting.reduce((max, e) => Math.max(max, e.elapsed / e.timer), 0);
      const blockedAutoOrders = G.production.orders.filter((o) => o.channel === 'autoking' && o.status === 'blocked').length;
      if (G.vehicles.count >= 2 || vehicleWait >= 0.4 || blockedAutoOrders) {
        const waitingCars = Math.max(G.vehicles.count, vehicleWaiting.length);
        const queueLabel = waitingCars === 1 ? '1 coche esperando en AutoKing' : waitingCars + ' coches esperando en AutoKing';
        reasons.push({
          id: 'DRIVE_THRU_QUEUE',
          label: blockedAutoOrders ? 'AutoKing detenido por falta de producto' : queueLabel,
          severity: G.vehicles.count >= 4 || vehicleWait >= 0.75 || blockedAutoOrders ? 'critical' : 'warning',
          station: 'autoPay', count: waitingCars
        });
      }
      for (const [id, stock] of Object.entries(G.production.stock)) {
        const cfg = G.cfg.operations.products[id];
        if (stock <= cfg.minimumStock) reasons.push({
          id: 'PRODUCT_SHORTAGE:' + id, label: cfg.label + (stock <= 0 ? ' agotado' : ' bajo'),
          severity: stock <= 0 ? 'critical' : 'warning', product: id, station: this.stationForProduct(id)
        });
      }
      const orders = G.production.orders.filter((o) => o.status !== 'delivered');
      const blocked = orders.filter((o) => o.status === 'blocked');
      if (blocked.length) {
        const byProduct = {};
        blocked.forEach((order) => { byProduct[order.blockedBy] = (byProduct[order.blockedBy] || 0) + 1; });
        const product = Object.keys(byProduct).sort((a, b) => byProduct[b] - byProduct[a])[0];
        reasons.push({
          id: 'PRODUCT_SHORTAGE', label: blocked.length + ' pedido(s) bloqueados por producto',
          severity: 'critical', station: this.stationForProduct(product), count: blocked.length
        });
      }
      if (orders.length >= 8) {
        const byStation = {};
        orders.forEach((order) => {
          const station = this.stationForChannel(order.channel);
          byStation[station] = (byStation[station] || 0) + 1;
        });
        const station = Object.keys(byStation).sort((a, b) => byStation[b] - byStation[a])[0];
        reasons.push({ id: 'ORDER_BACKLOG', label: orders.length + ' pedidos en cola', severity: 'critical', station, count: orders.length });
      }
      const dirty = G.customers.tables.filter((t) => t.state === 'dirty').length;
      if (dirty >= 3) reasons.push({ id: 'DIRTY_DINING_ROOM', label: dirty + ' mesas sucias', severity: 'warning', station: 'hall', count: dirty });

      const signature = reasons.map((r) => [r.id, r.severity, r.count || 0, r.station || '', r.label].join(':')).sort().join('|');
      if (signature !== this.signature) {
        this.signature = signature;
        this.items = reasons;
        BK.bus.emit('bottleneck:change', { items: reasons });
      } else this.items = reasons;
    }
    updateShortageEvents() {
      const G = this.G;
      for (const [id, stock] of Object.entries(G.production.stock)) {
        if (stock > 0) { this.shortageEvents.delete(id); continue; }
        if (this.shortageEvents.has(id)) continue;
        const product = G.cfg.operations.products[id];
        const point = G.map.points[product.station];
        if (!point) throw new Error('No existe punto de reposición para ' + id + ': ' + product.station);
        const location = { x: point[0], y: point[1] };
        const interact = G.nav.approachPoint('staff', location, G.player.char, 34);
        const ev = G.events.schedule('productShortage');
        ev.targetEntity = { productId: id };
        G.events.activate(ev, { location, interact, face: 0, target: ev.targetEntity, lift: 38 });
        this.shortageEvents.add(id);
        BK.bus.emit('operational:shortage', { productId: id, event: ev });
      }
    }
    causesFor(channel) {
      const G = this.G;
      const list = [];
      if (channel === 'autoking' && G.vehicles.count) list.push(G.vehicles.count + ' coches en cola');
      const blocked = G.production.orders.filter((o) => o.channel === channel && o.status === 'blocked').length;
      if (blocked) list.push(blocked + ' pedido(s) bloqueados por falta de producto');
      if (!G.employees.capacity('kitchen')) list.push('sin personal en cocina');
      if (!G.employees.capacity('fries')) list.push('sin personal de patatas');
      if (!G.employees.capacity('assembly')) list.push('sin personal de montaje');
      if (!G.employees.capacity(channel === 'autoking' ? 'autoking' : channel)) list.push('canal sin cobertura');
      return list;
    }
  }
  BK.BottleneckDetector = BottleneckDetector;
})();
