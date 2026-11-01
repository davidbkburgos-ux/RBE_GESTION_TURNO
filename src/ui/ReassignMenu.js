(function () {
  const BK = window.BK;
  // Estaciones cuyo vacío se considera crítico para pedir confirmación al mover.
  const CRITICAL = ['grill', 'fries', 'assembly', 'counter', 'autoPay', 'delivery'];
  const SHORT_LIST = 4;

  // Selector de puesto sobre el empleado: sin cubrir primero, [VER TODOS], confirmación solo si deja un puesto crítico vacío.
  class ReassignMenu {
    constructor(ui) {
      this.ui = ui; this.G = ui.G; this.bubble = null; this.emp = null; this.all = false;
      BK.bus.on('employees:moved', (e) => {
        if (e.fromTag && e.toTag) ui.toast(e.employee.displayId.toUpperCase() + ' ' + e.fromTag + ' → ' + e.toTag, 'info', 2600);
      });
    }
    get isOpen() { return !!this.bubble; }
    incoming(id) { return this.G.employees.list.filter((c) => c.available && c.targetPosition === id).length; }
    ranked(emp) {
      const E = this.G.employees, info = this.G.cfg.operations.stationInfo, cur = emp.targetPosition || emp.position;
      const dist = (id) => { const s = this.G.cfg.operations.stations[id]; return s ? Math.hypot(s.pos[0] - emp.x, s.pos[1] - emp.y) : 1e9; };
      return Object.keys(info).filter((id) => id !== cur && (info[id].recommended > 0 || id === 'support')).map((id) => {
        const cov = E.stationCoverage(id) + this.incoming(id), rec = info[id].recommended;
        return { id, info: info[id], cov, rec, rank: cov === 0 && rec > 0 ? 0 : cov < rec ? 1 : 2, d: dist(id) };
      }).sort((a, b) => a.rank - b.rank || a.d - b.d);
    }
    open(emp) {
      this.close();
      const ui = this.ui, h = ui.h, info = this.G.cfg.operations.stationInfo;
      this.emp = emp; this.G.renderer.selectedEmployeeId = emp.id;
      const cur = emp.targetPosition || emp.position, moving = emp.status === 'MOVING';
      const list = this.ranked(emp), shown = this.all ? list : list.slice(0, SHORT_LIST);
      const el = h('div', { class: 'reassign', role: 'dialog', 'aria-label': 'Cambiar puesto de ' + emp.displayId },
        h('b', { class: 'ra-title' }, emp.displayId.toUpperCase()),
        h('div', { class: 'ra-cur' }, moving ? 'EN TRASLADO → ' : 'Puesto actual: ', h('b', {}, info[cur] ? info[cur].tag : '—')),
        h('div', { class: 'ra-sub' }, 'Cambiar a:'),
        ...shown.map((o) => h('button', { type: 'button', class: 'ra-opt ' + (o.rank === 0 ? 'none' : o.rank === 1 ? 'low' : ''), onclick: () => this.choose(emp, o.id) },
          (o.rank < 2 ? '⚠ ' : '') + o.info.icon + ' ' + o.info.tag)),
        !this.all && list.length > SHORT_LIST ? h('button', { type: 'button', class: 'ra-opt all', onclick: () => { this.all = true; this.open(emp); } }, 'VER TODOS') : '',
        h('button', { type: 'button', class: 'ra-opt close', onclick: () => this.close() }, 'Cerrar'));
      this.bubble = ui.addBubble({ el, anchor: () => ({ x: emp.x, y: emp.y - 100 }), gap: 8, gapBelow: 40 });
    }
    choose(emp, to) {
      const info = this.G.cfg.operations.stationInfo, cur = emp.position;
      const leavesEmpty = cur && CRITICAL.includes(cur) && this.G.employees.stationCoverage(cur) + this.incoming(cur) <= 1 && info[cur].recommended > 0;
      const go = () => { this.G.employees.moveEmployee(emp.id, to); this.close(); };
      if (!leavesEmpty) return go();
      const label = info[cur].name;
      const keep = this.bubble; this.close();
      void keep;
      this.ui.modal({
        title: 'Cambiar de puesto', body: this.ui.h('p', {}, 'Mover ' + emp.displayId + ' dejará ' + label + ' sin cobertura.'),
        buttons: [{ label: 'CANCELAR' }, { label: 'MOVER', primary: true, onClick: () => this.G.employees.moveEmployee(emp.id, to) }]
      });
    }
    close() {
      if (this.bubble) this.ui.removeBubble(this.bubble);
      this.bubble = null; this.emp = null; this.all = false;
      if (this.G.renderer) this.G.renderer.selectedEmployeeId = null;
    }
  }
  BK.ReassignMenu = ReassignMenu;
})();
