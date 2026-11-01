(function () {
  const BK = window.BK;

  // Vacantes de turno: bajas sin cubrir y refuerzos que el encargado contrata pagando con puntuación.
  class StaffingSystem {
    constructor(G) { this.G = G; this.reset(); }
    get cfg() { return this.G.cfg.operations.vacancies; }
    reset() {
      this.extraUsed = 0;
      this.coveredAbsences = 0;
      this.hires = [];
      this.demandMult = 1;
      this.ack = 0;
    }
    absences() { return this.G.employees.list.filter((c) => c.absent); }
    get openVacancies() { return Math.max(0, this.absences().length - this.coveredAbsences); }
    get extraLeft() { return Math.max(0, this.cfg.maxExtra - this.extraUsed); }
    get slots() { return this.openVacancies + this.extraLeft; }
    get alert() { return this.openVacancies > 0 && this.absences().length > this.ack; }
    keepTeam() { this.ack = this.absences().length; }

    // Puesto más crítico: sin cobertura primero, después por debajo de lo recomendado, y por último el de menor ratio.
    criticalPosition() {
      const G = this.G, E = G.employees, info = G.cfg.operations.stationInfo;
      const order = G.cfg.operations.positioningOrder.filter((id) => info[id] && info[id].recommended > 0);
      const cover = (id) => E.stationCoverage(id) + E.list.filter((c) => c.available && !c.absent && c.targetPosition === id).length;
      let best = null, bestKey = null;
      order.forEach((id, i) => {
        const cov = cover(id), rec = info[id].recommended;
        const key = [cov === 0 ? 0 : 1, cov >= rec ? 1 : 0, cov / rec, i];
        let less = false;
        for (let k = 0; k < key.length; k++) { if (key[k] !== (bestKey || [])[k]) { less = !bestKey || key[k] < bestKey[k]; break; } }
        if (!bestKey || less) { best = id; bestKey = key; }
      });
      return best || order[0];
    }

    canHire(kind) {
      const G = this.G, o = this.cfg.options[kind];
      if (!o) return { ok: false, reason: 'No disponible' };
      if (G.state !== 'playing') return { ok: false, reason: 'No disponible' };
      if (this.slots <= 0) return { ok: false, reason: 'Sin vacantes' };
      if (G.scoring.score < o.cost) return { ok: false, reason: 'Faltan ' + (o.cost - G.scoring.score) + ' pts' };
      return { ok: true, reason: '' };
    }

    hire(kind, silent) {
      const G = this.G, o = this.cfg.options[kind], check = silent ? { ok: true } : this.canHire(kind);
      if (!check.ok) return null;
      const position = this.criticalPosition();
      const c = G.employees.hire(position, { expert: kind === 'expert', speed: o.speed });
      if (!c) return null;
      if (!silent) G.scoring.add(-o.cost, 'Vacante cubierta · ' + o.label, null, 'staffing');
      const covers = !silent && this.openVacancies > 0;
      const isExtra = silent ? !!silent.extra : !covers;
      if (isExtra) { this.extraUsed++; this.demandMult += o.demandBoost; } else this.coveredAbsences++;
      this.hires.push({ kind, position, extra: isExtra });
      if (!silent) {
        const name = G.cfg.operations.stationInfo[position].name;
        G.incidents.record('STAFF_HIRED', o.label + ' incorporado: ' + c.displayId + ' en ' + name + '.');
        BK.bus.emit('staffing:hired', { employee: c, kind, position, cost: o.cost, text: (kind === 'expert' ? '⭐ ' : '') + c.displayId + ' se incorpora a ' + name + '.' });
      }
      return c;
    }

    snapshot() {
      return {
        extraUsed: this.extraUsed, coveredAbsences: this.coveredAbsences, ack: this.ack, hires: this.hires.slice(),
        absent: this.absences().map((c) => c.id)
      };
    }
    restore(s) {
      if (!s) return;
      const G = this.G;
      (s.absent || []).forEach((id) => {
        const c = G.employees.list.find((e) => e.id === id);
        if (c) { c.absent = true; c.available = false; c.status = 'ABSENT'; c.alpha = 0; }
      });
      this.hires = []; this.demandMult = 1; this.extraUsed = 0; this.coveredAbsences = 0;
      (s.hires || []).forEach((h) => { this.hire(h.kind, { extra: h.extra }); });
      this.extraUsed = s.extraUsed || 0; this.coveredAbsences = s.coveredAbsences || 0; this.ack = s.ack || 0;
    }
  }
  BK.StaffingSystem = StaffingSystem;
})();
