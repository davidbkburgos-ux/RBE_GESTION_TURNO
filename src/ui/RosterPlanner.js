(function () {
  const BK = window.BK;
  const LOW_STAFF = 4;
  const CRITICAL = ['grill', 'chef', 'fries', 'assembly', 'counter'];

  // Posicionamiento en dos fases: 1) reparto comida / cena, 2) puestos del turno de comida.
  class RosterPlanner {
    constructor(ui) { this.ui = ui; this.G = ui.G; this.timer = null; this.lastPress = 0; }
    open() {
      const G = this.G;
      G.restaurantState = 'POSITIONING';
      G.seedInput = Date.now() >>> 0;
      this.applySeed(G.seedInput);
      this.step = 1; this.counts = {}; this.selected = null; this.moving = null; this.review = false;
      this.stationIds = Object.keys(G.cfg.operations.stationInfo).filter((id) => G.cfg.operations.stationInfo[id].recommended > 0);
      const rosterOrder = G.cfg.operations.rosterOrder;
      if (rosterOrder) this.stationIds.sort((a, b) => (rosterOrder.indexOf(a) + 1 || 99) - (rosterOrder.indexOf(b) + 1 || 99));
      this.stationIds.forEach((id) => (this.counts[id] = 0));
      this.body = this.ui.h('div', { class: 'roster-plan rp' });
      this.ui.modal({ title: '👥 Posicionamiento del día', body: this.body, buttons: [], closable: false, cls: 'wide rp-modal' });
      this.render();
    }
    // Evita dobles pulsaciones accidentales y da respuesta háptica si el navegador lo permite.
    press(fn, shared) {
      let last = 0;
      return () => {
        const now = performance.now();
        if (shared ? now - this.lastPress < 160 : now - last < 250) return;
        last = now; if (shared) this.lastPress = now;
        if (navigator.vibrate) { try { navigator.vibrate(12); } catch (e) { /* sin permiso */ } }
        fn();
      };
    }
    assigned() { return Object.values(this.counts).reduce((a, b) => a + b, 0); }
    uncovered() { return this.stationIds.filter((id) => this.counts[id] === 0); }
    highlight(id) {
      const R = this.G.renderer;
      R.coverageHighlight = id; clearTimeout(this.timer);
      if (id) this.timer = setTimeout(() => { if (R.coverageHighlight === id) R.coverageHighlight = null; }, 4000);
    }
    cleanup() { clearTimeout(this.timer); this.G.renderer.coverageHighlight = null; }
    stepper(value, onMinus, onPlus, minusOff, plusOff, label) {
      const h = this.ui.h;
      return h('div', { class: 'rp-step' },
        h('button', { type: 'button', class: 'rp-btn', 'aria-label': 'Menos ' + label, disabled: minusOff, onclick: this.press(onMinus, true) }, '−'),
        h('output', { 'aria-live': 'polite', 'aria-label': label }, String(value)),
        h('button', { type: 'button', class: 'rp-btn', 'aria-label': 'Más ' + label, disabled: plusOff, onclick: this.press(onPlus, true) }, '+'));
    }
    render() { this.step === 1 ? this.renderSplit() : this.renderStations(); }
    // Previsión por hora (12:00–01:00) con el mismo modelo de llegadas que la simulación; el perfil del día (plantilla, carga, reparto) sale de la semilla.
    applySeed(seed) {
      const G = this.G, p = G.applyDayProfile(seed);
      let a = (Number(seed) || 1) >>> 0;
      const rnd = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
      const raw = BK.ArrivalDirector.hourlyForecast(G.cfg, p).map((v) => v * (0.9 + rnd() * 0.2));
      const counts = raw.map((v) => Math.round(v));
      const meal = counts.slice(0, 7).reduce((x, y) => x + y, 0), total = counts.reduce((x, y) => x + y, 0);
      this.profile = p; this.total = p.staff; this.meal = p.mealShift;
      this.forecast = { counts, meal, dinner: total - meal, total };
    }
    chartSvg(f) {
      const NS = 'http://www.w3.org/2000/svg', W = 320, H = 118, px = 10, top = 8, base = 98;
      const el = (tag, attrs, ...kids) => { const e = document.createElementNS(NS, tag); Object.entries(attrs || {}).forEach(([k, v]) => { if (k === 'text') e.textContent = v; else e.setAttribute(k, v); }); kids.forEach((c) => e.appendChild(c)); return e; };
      const max = Math.max(...f.counts), n = f.counts.length, step = (W - 2 * px) / (n - 1);
      const pts = f.counts.map((v, i) => [px + i * step, base - (v / max) * (base - top)]);
      let d = 'M' + pts[0][0] + ',' + pts[0][1];
      for (let i = 0; i < n - 1; i++) {
        const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(n - 1, i + 2)];
        const c1 = [p1[0] + (p2[0] - p0[0]) / 6, Math.min(base, p1[1] + (p2[1] - p0[1]) / 6)], c2 = [p2[0] - (p3[0] - p1[0]) / 6, Math.min(base, p2[1] - (p3[1] - p1[1]) / 6)];
        d += ' C' + c1.join(',') + ' ' + c2.join(',') + ' ' + p2.join(',');
      }
      const area = d + ' L' + pts[n - 1][0] + ',' + base + ' L' + pts[0][0] + ',' + base + ' Z';
      const split = px + 7 * step;
      const grid = [0.25, 0.5, 0.75, 1].map((k) => el('line', { x1: px, x2: W - px, y1: base - k * (base - top), y2: base - k * (base - top), stroke: '#cdbb9f', 'stroke-width': 0.6 }));
      const labels = [12, 14, 16, 18, 20, 22, 24].map((h) => el('text', { x: px + (h - 12) * step, y: H - 6, 'text-anchor': h === 12 ? 'start' : h === 24 ? 'end' : 'middle', 'font-size': 9, fill: '#5a4033', text: String(h % 24).padStart(2, '0') + ':00' }));
      const clip = (id, x, w) => el('clipPath', { id }, el('rect', { x, y: 0, width: w, height: H }));
      return el('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'rp-svg', role: 'img', 'aria-label': 'Clientes previstos: comida ' + f.meal + ', cena ' + f.dinner },
        el('defs', {}, clip('rpClipL', 0, split), clip('rpClipD', split, W - split)),
        ...grid,
        el('path', { d: area, fill: '#e3a52b', 'fill-opacity': 0.55, 'clip-path': 'url(#rpClipL)' }),
        el('path', { d, fill: 'none', stroke: '#b9791a', 'stroke-width': 2, 'clip-path': 'url(#rpClipL)' }),
        el('path', { d: area, fill: '#d2543a', 'fill-opacity': 0.55, 'clip-path': 'url(#rpClipD)' }),
        el('path', { d, fill: 'none', stroke: '#9c2f1b', 'stroke-width': 2, 'clip-path': 'url(#rpClipD)' }),
        el('line', { x1: split, x2: split, y1: top, y2: base, stroke: '#3b2a21', 'stroke-width': 1, 'stroke-dasharray': '3 3' }),
        el('line', { x1: px, x2: W - px, y1: base, y2: base, stroke: '#3b2a21', 'stroke-width': 1 }),
        ...labels);
    }
    forecastBox() {
      const h = this.ui.h, f = this.forecast, dinner = this.total - this.meal;
      const pct = (v) => Math.round((100 * v) / f.total);
      const per = (c, s) => (s > 0 ? '≈ ' + Math.round(c / s) + ' clientes por empleado' : 'sin personal');
      return [
        h('div', { class: 'rp-chart-title' }, 'Clientes previstos hoy: ', h('b', {}, String(f.total))),
        this.chartSvg(f),
        h('div', { class: 'rp-chips' },
          h('div', { class: 'rp-chip meal' }, h('b', {}, 'COMIDA · ' + f.meal + ' (' + pct(f.meal) + '%)'), h('small', {},           '12:00–19:00 · ' + per(f.meal, this.meal))),
                    h('div', { class: 'rp-chip dinner' }, h('b', {}, 'CENA · ' + f.dinner + ' (' + pct(f.dinner) + '%)'), h('small', {}, '19:00–01:00 · ' + per(f.dinner, dinner))))
      ];
    }
    updateForecast() { if (this.chartBox && this.chartBox.isConnected) this.chartBox.replaceChildren(...this.forecastBox()); }
    rainBox() {
      const h = this.ui.h, c = this.profile.rain.chance, lvl = c < 25 ? 'Baja' : c < 55 ? 'Media' : c < 80 ? 'Alta' : 'Muy alta';
      const bar = h('div', { class: 'rp-rainbar', role: 'img', 'aria-label': 'Probabilidad de lluvia ' + c + '%' }, h('i', { style: 'width:' + c + '%' }));
      return h('div', { class: 'rp-rain' + (c >= 55 ? ' wet' : '') },
        h('div', { class: 'rp-rain-head' }, h('span', {}, c >= 25 ? '🌧️' : '⛅'), h('b', {}, 'Probabilidad de lluvia: ' + c + '% · ' + lvl)),
        bar,
        h('small', {}, 'Si llueve: menos clientes en mostrador y kiosco, más en ' + BK.autoName + ' y delivery.'));
    }
    renderSplit() {
      const h = this.ui.h, dinner = this.total - this.meal, ok = this.meal + dinner === this.total;
      const warn = [];
      if (this.meal < LOW_STAFF) warn.push('Comida tendrá una dotación reducida.');
      if (dinner < LOW_STAFF) warn.push('Cena tendrá una dotación reducida.');
      const seed = h('input', { id: 'seedInput', type: 'number', min: 1, value: this.G.seedInput, 'aria-label':       'Semilla de partida', onchange: (e) => { this.G.seedInput = Number(e.target.value) || 1; this.applySeed(this.G.seedInput); this.renderSplit(); } });
      this.chartBox = h('div', { class: 'rp-chart' }, ...this.forecastBox());
            const lv = this.profile.loadLevel, load = lv < 0.34 ? 'Ligera' : lv < 0.67 ? 'Media' : 'Alta';
            this.body.replaceChildren(
              h('p', { class: 'lead' }, 'Paso 1 de 2 · Divide la plantilla entre turnos.'),
              this.chartBox,
              this.rainBox(),
              h('p', { class: 'rp-total' }, 'Empleados disponibles: ', h('b', {}, String(this.total)), ' · Carga del día: ', h('b', {}, load)),
        h('div', { class: 'rp-card' }, h('b', {}, 'COMIDA'), this.stepper(this.meal, () => { this.meal--; this.renderSplit(); }, () => { this.meal++; this.renderSplit(); }, this.meal <= 0, this.meal >= this.total, 'comida')),
        h('div', { class: 'rp-card' }, h('b', {}, 'CENA'), this.stepper(dinner, () => { this.meal++; this.renderSplit(); }, () => { this.meal--; this.renderSplit(); }, dinner <= 0, dinner >= this.total, 'cena')),
        h('p', { class: 'rp-sum ' + (ok ? 'ok' : 'bad') }, 'Asignados: ' + (this.meal + dinner) + ' / ' + this.total),
        ...warn.map((w) => h('p', { class: 'rp-warn', role: 'status' }, '⚠ ' + w + ' Puedes continuar bajo tu responsabilidad.')),
        h('details', { class: 'rp-seed', open: true }, h('summary', {}, 'Semilla del día (opciones avanzadas)'), h('label', {}, 'Semilla reproducible ', seed)),
        h('div', { class: 'actions' },
          h('button', { type: 'button', class: 'btn', onclick: () => { this.cleanup(); this.ui.showStart(); } }, 'Volver'),
          h('button', { type: 'button', class: 'btn primary', disabled: !ok || this.meal < 1, onclick: this.press(() => { this.step = 2; this.render(); }) }, 'CONTINUAR')));
    }
    suggest() {
      const order = this.G.cfg.operations.positioningOrder.filter((id) => this.stationIds.includes(id));
      this.stationIds.forEach((id) => (this.counts[id] = 0));
      let left = this.meal;
      for (const id of order) { if (left <= 0) break; this.counts[id]++; left--; }
      for (let i = 0; left > 0 && i < 40; i++, left--) this.counts[order[i % order.length]]++;
    }
    employeeNames(id) {
      let n = 0; const out = [];
      for (const sid of this.stationIds) { for (let k = 0; k < this.counts[sid]; k++) { n++; if (sid === id) out.push('Equipo ' + String(n).padStart(2, '0')); } }
      return out;
    }
    renderStations() {
      const h = this.ui.h, info = this.G.cfg.operations.stationInfo;
      const free = this.meal - this.assigned(), missing = this.uncovered();
      const cards = this.stationIds.map((id) => {
        const s = info[id], n = this.counts[id], sel = this.selected === id;
        const head = h('button', { type: 'button', class: 'rp-head', 'aria-expanded': String(sel), onclick: () => { this.selected = sel ? null : id; this.highlight(this.selected); this.renderStations(); } },
          h('span', { class: 'ic' }, s.icon), h('b', {}, s.name), h('em', { class: n >= s.recommended ? 'ok' : n === 0 ? 'bad' : 'warn' }, n + ' / ' + s.recommended));
        const kids = [head, h('p', { class: 'fn' }, s.fn),
          h('div', { class: 'rp-row' }, this.stepper(n, () => { this.counts[id]--; this.renderStations(); }, () => { this.counts[id]++; this.renderStations(); }, n <= 0, free <= 0, s.name))];
        if (this.moving && this.moving !== id) kids.push(h('button', { type: 'button', class: 'btn small', onclick: this.press(() => { this.counts[this.moving]--; this.counts[id]++; this.moving = null; this.renderStations(); }) }, 'Mover aquí'));
        if (sel) {
          const names = this.employeeNames(id);
          kids.push(h('div', { class: 'rp-detail' },
            h('p', {}, h('b', {}, 'Si queda vacío: '), s.effect),
            h('p', {}, h('b', {}, 'Empleados asignados: '), names.length ? names.join(', ') : 'ninguno'),
            h('div', { class: 'rp-actions' },
              h('button', { type: 'button', class: 'btn small', disabled: n <= 0, onclick: this.press(() => { this.moving = this.moving === id ? null : id; this.renderStations(); }) }, this.moving === id ? 'ELIGE DESTINO…' : 'MOVER EMPLEADO'),
              h('button', { type: 'button', class: 'btn small', disabled: n <= 0, onclick: this.press(() => { this.counts[id]--; this.renderStations(); }) }, 'QUITAR EMPLEADO'),
              h('button', { type: 'button', class: 'btn small', onclick: () => { this.selected = null; this.highlight(null); this.renderStations(); } }, 'CERRAR'))));
        }
        return h('div', { class: 'rp-station ' + (sel ? 'sel ' : '') + (n === 0 ? 'none' : n < s.recommended ? 'low' : 'ok') }, ...kids);
      });
      const readiness = missing.length
        ? h('div', { class: 'rp-ready bad', role: 'status' }, h('b', {}, '⚠ Sin cubrir: '), missing.map((id) => info[id].name).join(', '),
          h('small', {}, ' · Puedes continuar, pero dependerán del encargado o de una reasignación posterior.'))
        : h('div', { class: 'rp-ready ok', role: 'status' }, h('b', {}, '✔ COBERTURA COMPLETA'));
      this.body.replaceChildren(
        h('p', { class: 'lead' }, 'Paso 2 de 2 · POSICIONA EL TURNO DE COMIDA'),
        h('div', { class: 'rp-top' },
          h('p', { class: 'rp-sum' }, 'Sin puesto fijo (Apoyo): ' + free + ' · Cena: ' + (this.total - this.meal) + ' (se posiciona al cambio de turno)'),
          h('button', { type: 'button', class: 'btn small', onclick: this.press(() => { this.suggest(); this.renderStations(); }) }, 'SUGERIR REPARTO')),
        readiness,
        h('div', { class: 'rp-list' }, ...cards),
        h('div', { class: 'actions' },
          h('button', { type: 'button', class: 'btn', onclick: () => { this.cleanup(); this.step = 1; this.render(); } }, '← Reparto'),
          missing.length ? h('button', { type: 'button', class: 'btn', onclick: () => { const el = this.body.querySelector('.rp-station.none'); if (el) el.scrollIntoView({ block: 'center' }); } }, 'REVISAR POSICIONES') : '',
          h('button', { type: 'button', class: 'btn primary', onclick: this.press(() => this.start()) }, 'COMENZAR EL DÍA · 09:00')));
    }
    buildRoster() {
      const order = this.G.cfg.operations.positioningOrder;
      const roster = [];
      this.stationIds.forEach((id) => { for (let k = 0; k < this.counts[id]; k++) roster.push({ shift: 'meal', position: id }); });
      while (roster.length < this.meal) roster.push({ shift: 'meal', position: 'support' });
      const dinnerOrder = order.filter((id) => this.stationIds.includes(id));
      for (let i = 0; i < this.total - this.meal; i++) roster.push({ shift: 'dinner', position: dinnerOrder[i % dinnerOrder.length] });
      return roster;
    }
    start() {
      const G = this.G, roster = this.buildRoster(), seed = Number(this.G.seedInput) || (Date.now() >>> 0);
      this.cleanup();
      G.positioningPlan = { meal: this.meal, dinner: this.total - this.meal, uncovered: this.uncovered() };
      this.ui.closeModal();
      G.newGame(roster, seed);
    }
  }
  BK.RosterPlanner = RosterPlanner;
})();
