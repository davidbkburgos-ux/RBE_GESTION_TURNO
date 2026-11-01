(function () {
  const BK = window.BK;

  class BottleneckDetector {
    constructor(G) {
      this.G = G; this.items = []; this.signature = ''; this.shortageEvents = new Set();
      BK.bus.on('event:failed', ({ ev }) => { if (ev.type === 'productShortage' && ev.targetEntity) this.shortageEvents.delete(ev.targetEntity.productId); });
      BK.bus.on('event:dismissed', (ev) => { if (ev.type === 'productShortage' && ev.targetEntity) this.shortageEvents.delete(ev.targetEntity.productId); });
    }
    reset() { this.items = []; this.signature = ''; this.shortageEvents.clear(); }
    update() {
      const G = this.G;
      const reasons = [];
      if (['OPEN', 'CLOSING'].includes(G.restaurantState)) this.updateShortageEvents();
      const cap = (key) => G.employees.capacity(key);
      if (!cap('kitchen')) reasons.push({ id: 'NO_KITCHEN_CAPACITY', label: 'Sin cobertura de cocina', severity: 'critical' });
      if (!cap('fries')) reasons.push({ id: 'NO_FRIES_CAPACITY', label: 'Sin producción de patatas', severity: 'critical' });
      if (!cap('assembly')) reasons.push({ id: 'NO_ASSEMBLY_CAPACITY', label: 'Sin montaje / expedición', severity: 'critical' });
      if (!cap('counter')) reasons.push({ id: 'COUNTER_OVERLOAD', label: 'Mostrador sin cobertura', severity: 'critical' });
      if (!cap('autoking')) reasons.push({ id: 'DRIVE_THRU_OVERLOAD', label: 'AutoKing sin cobertura', severity: 'critical' });
      if (!cap('delivery')) reasons.push({ id: 'DELIVERY_OVERLOAD', label: 'Delivery sin cobertura', severity: 'critical' });
      for (const [id, stock] of Object.entries(G.production.stock)) {
        const cfg = G.cfg.operations.products[id];
        if (stock <= cfg.minimumStock) reasons.push({ id: 'PRODUCT_SHORTAGE:' + id, label: cfg.label + (stock <= 0 ? ' agotado' : ' bajo'), severity: stock <= 0 ? 'critical' : 'warning', product: id });
      }
      const orders = G.production.orders.filter((o) => o.status !== 'delivered');
      const blocked = orders.filter((o) => o.status === 'blocked');
      if (blocked.length) reasons.push({ id: 'PRODUCT_SHORTAGE', label: blocked.length + ' pedido(s) bloqueados por producto', severity: 'critical' });
      if (orders.length >= 8) reasons.push({ id: 'ORDER_BACKLOG', label: orders.length + ' pedidos en cola', severity: 'critical' });
      if (G.vehicles.count >= 3) reasons.push({ id: 'DRIVE_THRU_QUEUE', label: G.vehicles.count + ' coches en AutoKing', severity: 'warning' });
      const dirty = G.customers.tables.filter((t) => t.state === 'dirty').length;
      if (dirty >= 3) reasons.push({ id: 'DIRTY_DINING_ROOM', label: dirty + ' mesas sucias', severity: 'warning' });

      const signature = reasons.map((r) => r.id).sort().join('|');
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
