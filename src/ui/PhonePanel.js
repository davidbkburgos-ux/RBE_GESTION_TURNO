(function () {
  const BK = window.BK;
  const TABS = [['sum', 'Resumen', '📊'], ['team', 'Equipo', '👥'], ['pos', 'Puestos', '📍'], ['chan', 'Canales', '🛎️'], ['prod', 'Stock', '📦'], ['speed', 'Tiempos', '⏱️'], ['vac', 'Vacantes', '➕']];
  const STATUS = { WORKING: 'Trabajando', MOVING: 'EN TRASLADO', IDLE: 'Libre', OFF_SHIFT: 'Fuera de turno' };

  // Consulta operativa rápida: panel lateral tipo teléfono, sin pausar y con el mapa visible.
  class PhonePanel {
    constructor(ui) { this.ui = ui; this.G = ui.G; this.tab = 'sum'; }
    fmt(s) { return s === null || s === undefined ? '—' : this.ui.formatDuration(s); }
    stations() {
      const G = this.G, info = G.cfg.operations.stationInfo;
      return Object.keys(info).filter((id) => info[id].recommended > 0).map((id) => {
        const cov = G.employees.stationCoverage(id), rec = info[id].recommended;
        return { id, info: info[id], cov, rec, state: cov === 0 ? 'none' : cov < rec ? 'low' : 'ok' };
      });
    }
    summary() {
      const G = this.G, st = this.stations();
      const covered = st.filter((s) => s.cov >= s.rec).length;
      const orders = G.production.orders.filter((o) => o.status !== 'delivered');
      return {
        st, covered, total: st.length, bottlenecks: G.bottlenecks.items.length, prep: Math.round(G.prep.progress),
        orders: orders.length, events: G.events.active().length,
        counter: G.kpi.stats('counter'), auto: G.kpi.stats('autoking'), delivery: G.kpi.stats('delivery')
      };
    }
    compact() {
      const s = this.summary();
      const ln = (x) => (x.last === null ? '—' : this.fmt(x.last));
      return 'Cob ' + s.covered + '/' + s.total + ' · Cuellos ' + s.bottlenecks + ' · Prep ' + s.prep + '%' + (this.G.staffing.alert ? ' · ⚠ Vacante' : '');
    }
    compactDetail() {
      const s = this.summary(), ln = (x) => (x.last === null ? '—' : this.fmt(x.last));
      return ['Mostrador ' + ln(s.counter), 'Auto ' + ln(s.auto), 'Delivery ' + ln(s.delivery)].join(' · ');
    }
    bar(pct, cls) {
      const h = this.ui.h;
      return h('div', { class: 'ph-bar ' + (cls || '') }, h('i', { style: 'width:' + Math.max(0, Math.min(100, pct)) + '%' }));
    }
    render() {
      const ui = this.ui, h = ui.h, G = this.G, panel = ui.el.operationsPanel;
      if (panel.hidden) return;
      // Cabecera y pestañas persisten entre refrescos para no perder clics; solo se rehace el cuerpo.
      if (!panel.querySelector('.ph-head')) {
        panel.classList.add('phone');
        const head = h('div', { class: 'ph-head' },
          h('span', { class: 'ph-clock' }, G.clock.label), h('b', {}, 'OPERACIÓN'),
          h('button', { type: 'button', class: 'ph-close', 'aria-label': 'Cerrar panel', onpointerup: () => ui.toggleOperations(false), onclick: () => ui.toggleOperations(false) }, '✕'));
        const tabs = h('div', { class: 'ph-tabs', role: 'tablist' }, ...TABS.map(([id, label, icon]) =>
          h('button', { type: 'button', role: 'tab', 'data-tab': id, class: 'ph-tab', 'aria-label': label, onclick: () => { this.tab = id; this.render(); } },
            h('span', { 'aria-hidden': 'true' }, icon), label)));
        panel.replaceChildren(h('div', { class: 'ph-notch', 'aria-hidden': 'true' }), head, h('div', { class: 'ph-body' }), tabs);
        panel.addEventListener('pointerdown', () => { this.pressed = true; });
        const up = () => { this.pressed = false; };
        panel.addEventListener('pointerup', up); panel.addEventListener('pointercancel', up); panel.addEventListener('pointerleave', up);
      }
      panel.querySelector('.ph-clock').textContent = G.clock.label;
      panel.querySelectorAll('.ph-tab').forEach((b) => { const on = b.dataset.tab === this.tab; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); b.classList.toggle('alert', b.dataset.tab === 'vac' && G.staffing.alert); });
      // Con un dedo o el ratón pulsado no se rehace el cuerpo: evita perder el clic.
      if (this.pressed) return;
      const keep = panel.querySelector('.ph-body');
      const scroll = keep.scrollTop;
      const body = h('div', { class: 'ph-body' }, this['tab_' + this.tab]());
      keep.replaceWith(body);
      body.scrollTop = scroll;
    }
    sec(title, ...kids) { return this.ui.h('section', { class: 'ph-sec' }, this.ui.h('h3', {}, title), ...kids); }
    row(a, b, cls, valCls) { return this.ui.h('div', { class: 'ph-row ' + (cls || '') }, this.ui.h('span', {}, a), this.ui.h('b', valCls ? { class: valCls } : {}, b)); }
    bandCls(band) { return band ? 'band-' + band.toLowerCase() : ''; }
    tab_sum() {
      const h = this.ui.h, s = this.summary(), G = this.G;
      const bn = G.bottlenecks.items.slice()
        .sort((a, b) => (b.count || 0) - (a.count || 0) || Number(b.severity === 'critical') - Number(a.severity === 'critical'))
        .map((b) => {
          const cls = 'ph-row ' + (b.severity === 'critical' ? 'bad' : 'warn');
          return b.station
            ? h('button', { type: 'button', class: cls + ' ph-alert', 'aria-label': 'Apoyar en ' + G.cfg.operations.stations[b.station].label + ': ' + b.label, onclick: () => { if (!G.ui.tutorialStep) G.player.coverPosition(b.station); } },
              h('span', {}, '⚠ ' + b.label), h('b', {}, 'IR ›'))
            : h('div', { class: cls }, h('span', {}, '⚠ ' + b.label));
        });
      return [
        this.sec('Cobertura', this.row('Posiciones cubiertas', s.covered + ' / ' + s.total), this.bar(s.total ? (100 * s.covered) / s.total : 0)),
        this.sec('Cuellos de botella', ...(bn.length ? bn : [h('div', { class: 'ph-row ok' }, h('span', {}, 'Sin cuellos detectados'))])),
        this.sec('Preparación', this.row('Preparación general', s.prep + ' %'), this.bar(s.prep, 'prep')),
        this.sec('Actividad', this.row('Pedidos activos', String(s.orders)), this.row('Eventos activos', String(s.events))),
        this.sec('Velocidad', this.row('Mostrador', this.fmt(s.counter.last), '', this.bandCls(s.counter.lastBand)), this.row(BK.autoName, this.fmt(s.auto.last), '', this.bandCls(s.auto.lastBand)), this.row('Delivery · entrega', this.fmt(s.delivery.last), '', this.bandCls(s.delivery.lastBand)))
      ];
    }
    tab_team() {
      const h = this.ui.h, G = this.G, info = G.cfg.operations.stationInfo;
      const rows = G.employees.list.filter((c) => c.available && !c.absent && c.status !== 'OFF_SHIFT').map((c) => {
        const pos = c.position || c.targetPosition, inf = info[pos];
        const moving = c.status === 'MOVING';
        return h('button', { type: 'button', class: 'ph-emp', onclick: () => { G.ui.selectEmployee ? G.ui.selectEmployee(c.id) : null; } },
          h('b', {}, (c.expert ? '⭐ ' : '') + c.displayId),
          h('span', {}, (inf ? inf.icon + ' ' + inf.name : 'Sin puesto')),
          h('em', { class: moving ? 'mv' : '' }, moving ? 'EN TRASLADO' : (STATUS[c.status] || c.status || '')));
      });
      return [this.sec('Empleados del turno', ...(rows.length ? rows : [h('p', {}, 'Nadie en turno.')]))];
    }
    tab_vac() {
      const h = this.ui.h, G = this.G, S = G.staffing, opts = S.cfg.options, info = G.cfg.operations.stationInfo;
      const absent = S.absences();
      const out = [];
      out.push(this.sec('Estado de la plantilla',
        this.row('Puntos disponibles', String(G.scoring.score) + ' pts'),
        this.row('Bajas hoy', String(absent.length), absent.length ? 'warn' : ''),
        this.row('Vacantes abiertas', String(S.openVacancies), S.openVacancies ? 'bad' : 'ok'),
        this.row('Refuerzos extra posibles', String(S.extraLeft))));
      if (absent.length) out.push(this.sec('Bajas', ...absent.map((c) => h('div', { class: 'ph-row warn' }, h('span', {}, '⚠ ' + c.displayId), h('b', {}, 'No se presentó')))));
      if (this.pending && !S.canHire(this.pending).ok) this.pending = null;
      const crit = S.criticalPosition(), critName = info[crit] ? info[crit].icon + ' ' + info[crit].name : '';
      const card = (kind) => {
        const o = opts[kind], chk = S.canHire(kind), asking = this.pending === kind;
        const star = kind === 'expert' ? '⭐ ' : '';
        const perk = kind === 'expert' ? 'Trabaja un 50 % más rápido y cubre una segunda posición cuando la suya está libre.' : 'Cubre el puesto más crítico.';
        const btns = asking
          ? [h('button', { type: 'button', class: 'ph-btn go', onclick: () => { S.hire(kind); this.pending = null; this.render(); } }, 'Confirmar · −' + o.cost + ' pts'),
            h('button', { type: 'button', class: 'ph-btn', onclick: () => { this.pending = null; this.render(); } }, 'Cancelar')]
          : [h('button', { type: 'button', class: 'ph-btn', disabled: !chk.ok, onclick: () => { this.pending = kind; this.render(); } }, chk.ok ? 'Contratar · ' + o.cost + ' pts' : chk.reason)];
        return h('div', { class: 'ph-card' + (kind === 'expert' ? ' expert' : '') },
          h('div', { class: 'ph-card-h' }, h('b', {}, star + o.label), h('span', {}, o.cost + ' pts')),
          h('p', {}, perk + ' Llega por la puerta de empleados' + (S.openVacancies ? ' y cubre la baja sin generar más clientes.' : ' y atrae más clientes.')),
          h('div', { class: 'ph-btns' }, ...btns));
      };
      out.push(this.sec('Cubrir vacante', h('p', { class: 'ph-note' }, 'Irá a: ' + critName), card('standard'), card('expert'),
        h('p', { class: 'ph-note' }, S.openVacancies ? 'Cubrir una baja no aumenta la demanda; un refuerzo extra sí.' : 'Contratar atrae más clientes. Quedarte con el equipo actual no cuesta puntos.'),
        S.openVacancies ? h('button', { type: 'button', class: 'ph-btn', onclick: () => { S.keepTeam(); this.render(); } }, 'Seguir con el equipo actual') : ''));
      return out;
    }
    tab_pos() {
      const h = this.ui.h;
      return [this.sec('Posiciones', ...this.stations().map((s) => h('div', { class: 'ph-pos ' + s.state },
        h('span', {}, (s.info.icon + ' ' + s.info.name)), h('b', {}, s.cov + ' / ' + s.rec),
        h('em', {}, s.state === 'none' ? 'Sin cobertura' : s.state === 'low' ? 'Baja cobertura' : 'Cubierta'))))];
    }
    tab_chan() {
      const G = this.G, s = this.summary(), h = this.ui.h, cap = (k) => G.employees.capacity(k);
      const q = G.production.orders.filter((o) => o.status !== 'delivered');
      const n = (ch) => q.filter((o) => o.channel === ch).length;
      const line = (name, key, orders, extra) => this.row(name, (cap(key) ? 'Cubierto' : 'Sin cobertura') + ' · ' + orders + ' ped.' + (extra || ''), cap(key) ? 'ok' : 'bad');
      return [this.sec('Canales',
        line('Mostrador', 'counter', n('counter') + n('kiosk')),
        line(BK.autoName, 'autoking', n('autoking'), ' · ' + G.vehicles.count + ' coches'),
        line('Delivery', 'delivery', n('delivery')),
        line('Sala', 'hall', n('dining'), ' · ' + G.customers.tables.filter((t) => t.state === 'dirty').length + ' sucias'))];
    }
    tab_prod() {
      const G = this.G, h = this.ui.h, P = G.cfg.operations.products;
      const stock = Object.entries(G.production.stock).map(([id, v]) => this.row(P[id].label, String(Math.round(v)), v <= P[id].minimumStock ? 'warn' : ''));
      const waiting = G.production.orders.filter((o) => o.status === 'blocked').length;
      const tr = G.production.prepTarget(), batch = G.production.batchFor(tr), runs = G.production.prepRuns[tr.id] || 0;
      const early = tr.id !== G.production.tramo().id;
      const reserveRows = G.cfg.operations.stockPrep.products.map((id) => this.row(P[id].label, String(G.production.reserve[id] || 0) + ' uds.'));
      return [
        this.sec('Preparación', this.row('Producto preparado', Math.round(G.prep.progress) + ' %'), this.bar(G.prep.progress, 'prep')),
        this.sec('Cámara de congelado · ' + tr.label + (early ? ' (se acerca)' : '') + (tr.peak ? ' · PUNTA' : ' · VALLE'),
          this.row('Tanda recomendada', '+' + batch.MAIN_PRODUCT + ' uds. (≈60 % de los clientes)'),
          this.row('Desperdicio (COGS)', (G.production.wasteHeld || 0) + ' uds. · ' + (G.production.wasteCost || 0).toFixed(2).replace('.', ',') + ' €', (G.production.wasteHeld || 0) > 0 ? 'warn' : 'ok'),
          this.row('Preparaciones hechas', String(runs), runs ? 'ok' : 'warn'),
          ...reserveRows,
          h('div', { class: 'ph-btns' }, h('button', { type: 'button', class: 'ph-btn go', onclick: () => G.player.goPrep() }, 'Preparar producto')),
          h('p', { class: 'ph-note' }, 'Si preparas de más, el sobrante penaliza al final del turno.')),
        this.sec('Stock', ...stock),
        this.sec('Pedidos esperando producto', this.row('Bloqueados', String(waiting), waiting ? 'bad' : ''))
      ];
    }
    tab_speed() {
      const G = this.G, h = this.ui.h;
      const blk = (b) => {
        const s = G.kpi.stats(b);
        return this.sec(s.label,
          this.row('Último', this.fmt(s.last), '', this.bandCls(s.lastBand)), this.row('Media del día', this.fmt(s.mean), '', this.bandCls(s.meanBand)),
          this.row('Servicios medidos', String(s.measured) + (s.abandoned ? ' (+' + s.abandoned + ' abandonos)' : '')));
      };
      return [blk('counter'), blk('autoking'), blk('delivery')];
    }
  }
  BK.PhonePanel = PhonePanel;
})();
