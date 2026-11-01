(function () {
  const BK = window.BK;

  const BUCKET = { counter: 'counter', kiosk: 'counter', dining: 'counter', autoking: 'autoking', delivery: 'delivery' };
  const TYPE = { counter: 'COUNTER_ORDER', kiosk: 'KIOSK_ORDER', dining: 'DINE_IN_ORDER', autoking: 'AUTO_ORDER', delivery: 'DELIVERY_PICKUP' };

  // Registros de servicio normalizados (serviceRecord). Tiempo simulado = tiempo real × factor configurable por canal.
  // Mostrador, kiosco y sala comparten el cubo "Mostrador"; AutoKing y Delivery son independientes.
  class ServiceKpiSystem {
    constructor(G) {
      this.G = G; this.reset();
      BK.bus.on('production:delivered', (e) => { const o = e.order; if (o && o.channel !== 'autoking') this.record(o.channel, o.serviceSec, false, o.id); });
      BK.bus.on('vehicle:exit', (e) => { const car = e.car; if (car && car.serviceResult && !car.abandoned) this.record('autoking', e.totalDriveTime, false, car.id); });
      BK.bus.on('customer:abandon', (e) => {
        const who = e.guest || e.car;
        if (!who || who.kpiAbandon) return;
        who.kpiAbandon = true;
        this.record(e.channel, 0, true, who.id, e.reason);
      });
    }
    get cfg() { return this.G.cfg.operations.kpi; }
    reset() { this.records = []; this.seq = 0; }
    band(bucket, sec) {
      const c = this.cfg.channels[bucket];
      return sec <= c.green ? 'GREEN' : sec <= c.yellow ? 'YELLOW' : 'RED';
    }
    // El tiempo medido (real × factor) solo clasifica el resultado; lo que se registra es el valor normalizado del tramo.
    record(channel, realSec, abandoned, sourceId, reason) {
      const bucket = BUCKET[channel];
      if (!bucket) return null;
      const c = this.cfg.channels[bucket];
      const measured = Math.max(0, realSec) * c.factor;
      const band = abandoned ? 'ABANDONED' : this.band(bucket, measured);
      const normalizedSeconds = { GREEN: c.green, YELLOW: c.yellow, RED: c.red, ABANDONED: c.abandoned }[band];
      const now = this.G.clock.t;
      const rec = {
        id: 'service-' + String(++this.seq).padStart(3, '0'), sourceId, customerId: sourceId, channel, bucket, serviceType: TYPE[channel] || channel.toUpperCase(),
        outcome: band, band, normalizedSeconds, simSec: normalizedSeconds, measuredSec: abandoned ? null : measured,
        abandoned: !!abandoned, negativeReview: !!abandoned, reason: abandoned ? (reason || null) : null, resolvedAt: now, completedAt: now
      };
      this.records.push(rec);
      BK.bus.emit('kpi:record', rec);
      return rec;
    }
    stats(bucket) {
      const rows = this.records.filter((r) => r.bucket === bucket), served = rows.filter((r) => !r.abandoned);
      const mean = rows.length ? rows.reduce((n, r) => n + r.simSec, 0) / rows.length : null;
      const last = rows.length ? rows[rows.length - 1] : null;
      return {
        bucket, label: this.cfg.channels[bucket].label, last: last ? last.simSec : null, lastBand: last ? last.band : null,
        mean, meanBand: mean === null ? null : this.band(bucket, mean), measured: served.length, abandoned: rows.length - served.length, total: rows.length
      };
    }
    // Puntuación de fin de día por canal (independiente de la puntuación por evento).
    endOfDayScore() {
      const t = this.cfg.endOfDayScore, lines = {};
      let total = 0;
      Object.keys(this.cfg.channels).forEach((b) => {
        const s = this.stats(b);
        const pts = s.mean === null ? 0 : s.meanBand === 'GREEN' ? t.green : s.meanBand === 'YELLOW' ? t.yellow : t.red;
        lines[b] = { ...s, points: pts };
        total += pts;
      });
      return { total, lines };
    }
    snapshot() { return { records: this.records, seq: this.seq }; }
    restore(s) { if (s) { this.records = s.records || []; this.seq = s.seq || 0; } }
  }
  BK.ServiceKpiSystem = ServiceKpiSystem;
})();
