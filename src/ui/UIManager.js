(function () {
  const BK = window.BK;
  const U = BK.util;

  const $ = (id) => document.getElementById(id);
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => {
      if (v === false || v === null || v === undefined) return;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    });
    kids.flat().forEach((c) => { if (c !== null && c !== undefined && c !== false) el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return el;
  }
  const fmtMin = (m) => { m = Math.max(0, Math.ceil(m)); return m >= 60 ? Math.floor(m / 60) + ' h ' + (m % 60 ? (m % 60) + ' min' : '') : m + ' min'; };

  // HUD, bocadillos, paneles, diálogos y accesibilidad (HTML/CSS sobre el canvas)
  class UIManager {
    constructor(G) {
      this.G = G;
      this.bubbles = [];
      this.modalStack = [];
      this.chipEls = new Map();
      this.chipT = 0;
      this.capT = 0;
      this.opsRefresh = 0;
      this.debugRefresh = 0;
      this.reviewT = 0;
      this.selectedEmployee = null;
      this.selectedCoverage = null;
      this.q = null;
      this.prioEl = null;
      this.el = {};
      ['hud', 'hClock', 'hPhase', 'hScore', 'hCombo', 'hEvents', 'hPrio', 'hTasks', 'pScore', 'pPrio', 'pClock', 'tasksPanel', 'operationsPanel', 'timelinePanel', 'chips', 'bubbles', 'toasts', 'caption', 'reviewCard', 'debugPanel', 'debugStats', 'debugLog', 'debugTestSummary', 'modalRoot', 'stage', 'bSound', 'bPause', 'bFollow', 'bTasks', 'tutorial', 'rotate'].forEach((i) => (this.el[i] = $(i)));
      this.h = h;
      this.phone = new BK.PhonePanel(this);
      this.roster = new BK.RosterPlanner(this);
      this.reassign = new BK.ReassignMenu(this);
      this.bind();
      this.listen();
    }

    bind() {
      const G = this.G, E = this.el;
      $('bPause').onclick = () => G.togglePause();
      $('bSound').onclick = () => G.toggleMute();
      $('bHelp').onclick = () => this.showHelp();
      $('bSettings').onclick = () => this.showSettings();
      $('bTeam').onclick = () => this.showTeam();
      $('bOps').onclick = () => this.toggleOperations();
      $('bZoomIn').onclick = () => G.renderer.zoomBy(1.25);
      $('bZoomOut').onclick = () => G.renderer.zoomBy(0.8);
      $('bFollow').onclick = () => G.setFollow(!G.renderer.follow);
      $('bDebugTest').onclick = () => {
        try {
          this.renderSimulationTest(G.debug.deterministicSimulationTest());
          this.toast('SIMULATION TEST superado en las tres dificultades.', 'good', 3500);
        } catch (error) {
          E.debugTestSummary.textContent = 'SIMULATION TEST · FALLO\n' + error.message;
          this.toast('SIMULATION TEST fallido. Consulta el panel de diagnóstico.', 'bad', 5000);
        }
      };
      E.debugPanel.querySelectorAll('[data-debug-spawn]').forEach((button) => {
        button.addEventListener('click', () => {
          if (!G.debugSimulation) return;
          const type = button.dataset.debugSpawn;
          if (G.restaurantState !== 'OPEN') { this.toast('Abre el restaurante antes de probar eventos.', 'warn'); return; }
          if (type === 'complaint') G.customers.spawnComplaint();
          else if (type === 'dirtyTable') {
            const table = G.customers.tables.find((t) => !t.reserved);
            if (table) { table.state = 'dirty'; G.debug.spawn(type); }
          } else if (type === 'productShortage') {
            G.production.stock.MAIN_PRODUCT = 0;
            G.bottlenecks.update();
          } else G.debug.spawn(type);
        });
      });
      $('bTasks').onclick = () => { this.panelAuto = false; E.tasksPanel.classList.toggle('collapsed'); $('bTasks').setAttribute('aria-expanded', String(!E.tasksPanel.classList.contains('collapsed'))); };
      $('bMore').onclick = () => { const o = E.hud.classList.toggle('open'); $('bMore').setAttribute('aria-expanded', String(o)); };
      E.pPrio.onclick = () => this.openPriorityManual();
      $('rotateOk').onclick = () => E.rotate.classList.add('dismissed');
    }

    listen() {
      const G = this.G, bus = BK.bus;
      bus.on('audio:caption', (c) => this.caption(c.text));
      bus.on('player:blocked', () => this.toast('No se puede acceder desde aquí.', 'warn', 1800));
      bus.on('player:busy', () => this.toast('Termina la acción en curso.', 'info', 1400));
      bus.on('opening:locked', () => this.toast(G.openingData.texts.doorLocked, 'warn', 2800));
      bus.on('opening:repeat', () => this.toast(G.openingData.texts.repeat, 'info', 2200));
      bus.on('opening:question', (e) => this.showQuestion(e));
      bus.on('opening:confirmRequired', (e) => this.showOpeningConfirmation(e.readiness));
      bus.on('opening:penalty', (e) => {
        const reasons = [];
        if (e.incorrect) reasons.push(e.incorrect + ' comprobación(es) incorrecta(s)');
        if (e.omitted) reasons.push(e.omitted + ' omitida(s)');
        if (e.pending) reasons.push(e.pending + ' pendiente(s)');
        if (e.critical) reasons.push(e.critical + ' fallo(s) crítico(s)');
        if (e.lateMinutes) reasons.push(e.lateMinutes + ' min de retraso');
        this.toast('OPENING SCORE ' + e.openingScore + ' · aplicado ahora ' + e.penalty + ' · ' + (reasons.join(', ') || 'preparación correcta'), e.penalty < 0 ? 'warn' : 'good', 5200);
      });
      bus.on('opening:allReviewed', () => this.toast(G.openingData.texts.allReviewed, 'good', 4200));
      bus.on('csl:start', () => { G.audio.play('bell', false); this.toast('📋 Recorrido CSL: revisa cocina, mostrador, sala, baños, AutoKing y exteriores.', 'info', 5200); });
      bus.on('csl:complete', () => this.toast('Recorrido CSL completado.', 'good', 3600));
      bus.on('csl:end', (e) => { if (e.omitted.length) this.toast('Recorrido CSL cerrado: ' + e.omitted.length + ' revisión(es) omitida(s). ' + e.penalty + ' pts cada una.', 'warn', 5200); });
      bus.on('opening:opened', (e) => {
        G.audio.play('open');
        this.toast(e.onTime ? G.openingData.texts.doorOpenedOnTime : G.openingData.texts.doorOpenedLate.replace('{m}', e.late), e.onTime ? 'good' : 'warn', 4200);
      });
      bus.on('opening:late', (e) => { G.audio.play('error'); this.toast(G.openingData.texts.lateWarning.replace('{pts}', e.pts), 'bad', 3200); this.el.pClock.classList.add('flash'); setTimeout(() => this.el.pClock.classList.remove('flash'), 1600); });
      bus.on('opening:checklistEnd', (e) => {
        if (this.q && G.opening.current === null) this.closeQuestion(true);
        this.toast('Checklist cerrado: ' + e.tasks.length + ' tarea(s) omitida(s). El turno continúa.', 'warn', G.cfg.operations.messageTtl.important * 1000);
      });
      bus.on('opening:checklistClosed', () => this.toast('El checklist de preparación terminó a las 11:15.', 'warn', G.cfg.operations.messageTtl.minor * 1000));
      bus.on('event:appearing', (e) => {
        const T = G.ev.types[e.type];
        G.audio.play(e.type === 'complaint' ? 'complaint' : e.type === 'pendingOrder' ? 'bell' : e.type === 'kiosk' ? 'kiosk' : e.type === 'vehicle' ? 'car' : 'alert');
        this.noteBubble(T.bubbleStart, e, 'info', G.cfg.operations.messageTtl.minor);
      });
      bus.on('ambient:activity', ({ type }) => {
        if (type === 'CUSTOMER_ORDER_READY') G.audio.play('bell', false);
      });
      bus.on('production:delivered', () => G.audio.play('kpi', false));
      bus.on('production:fryer-alert', (e) => G.audio.play(e.level === 'red' ? 'fryerRed' : 'fryerYellow'));
      bus.on('vehicle:stop', (e) => { if (e.stop === 'order') G.audio.play('autokingOrder'); });
      bus.on('customer:abandon', (e) => {
        G.audio.play('error', false);
        this.toast(e.channel === 'autoking' ? '🚗 Un coche se marcha del AutoKing sin ser atendido.' : '😠 Un cliente se marcha sin ser atendido.', 'bad', 2200);
      });
      bus.on('event:resolved', (r) => {
        const T = G.ev.types[r.ev.type];
        G.audio.play(r.ev.type === 'dirtyTable' || r.ev.type === 'restroom' ? 'clean' : 'ok');
        this.noteBubble((r.ev.auto ? '👥 ' : r.result === 'excellent' ? '😀 ' : '😐 ') + T.bubbleOk, r.ev, r.ev.auto || r.result !== 'excellent' ? 'mid' : 'good', G.cfg.operations.messageTtl.resolution);
      });
      bus.on('event:failed', (r) => {
        const T = G.ev.types[r.ev.type];
        G.audio.play('error');
        this.noteBubble('😠 ' + T.bubbleFail, r.ev, 'bad', G.cfg.operations.messageTtl.resolution);
      });
      bus.on('incident:absence', (e) => this.toast('⚠️ ' + e.text, 'warn', 9000));
      bus.on('staffing:hired', (e) => this.toast(e.text, 'good', 4000));
      bus.on('incident:complaint-question', (e) => this.showComplaintQuestion(e));
      bus.on('incident:negative-review', (d) => this.showNegativeReview(d));
      bus.on('customer:tableComplaint', () => this.toast('Un cliente se queja: no hay mesa limpia.', 'warn', 2400));
      bus.on('production:low', (e) => this.toast('Stock bajo: ' + e.label + ' (' + e.stock + ').', 'warn', G.cfg.operations.messageTtl.minor * 1000));
      bus.on('production:opening-risk', (e) => this.toast('La preparación incompleta aumenta el consumo de ' + G.cfg.operations.products[e.id].label + '.', 'warn', 3000));
      bus.on('production:restocking', (e) => this.toast('Preparando lote de ' + G.cfg.operations.products[e.id].label + '.', 'info', G.cfg.operations.messageTtl.minor * 1000));
      bus.on('production:restocked', (e) => this.toast('Stock repuesto: ' + G.cfg.operations.products[e.id].label + ' (' + e.stock + ').', 'good', G.cfg.operations.messageTtl.resolution * 1000));
      bus.on('production:restock-blocked', (e) => this.toast(e.reason, 'warn', G.cfg.operations.messageTtl.important * 1000));
      bus.on('production:prep-needed', (e) => this.toast('📦 Tramo de ' + e.tramo.label + ': prepara producto en la cámara de congelado.', 'warn', 6000));
      bus.on('production:prepared', (e) => this.toast('📦 Producto preparado para ' + e.tramo.label + ': +' + e.batch.MAIN_PRODUCT + ' uds. disponibles para reponer.', 'good', 3500));
      bus.on('employees:critical', (e) => this.toast('⚠ Posición crítica sin cobertura: ' + e.label + '.', 'warn', G.cfg.operations.messageTtl.important * 1000));
      bus.on('manager:positioned', ({ position }) => this.toast('ENCARGADO APOYANDO · ' + G.cfg.operations.stations[position].label, 'info', 2200));
      bus.on('manager:left-position', () => this.toast('El encargado deja el puesto para atender el restaurante.', 'warn', 2200));
      bus.on('employees:shift-warning', (e) => this.toast('Cambio de turno: entra el equipo de cena (' + e.active + ' activos).', 'info', G.cfg.operations.messageTtl.important * 1000));
      bus.on('bottleneck:change', () => { if (!this.el.operationsPanel.hidden) this.renderOperations(); });
      bus.on('priority:offer', () => { this.showPriority(true); });
      bus.on('priority:closed', () => this.closePriority());
      bus.on('priority:chosen', (e) => { this.closePriority(); this.toast('Prioridad: ' + G.ev.channels[e.channel].label + '. Los pedidos de ese canal pasan primero en producción.', 'good', 3200); G.audio.play('ok'); });
      bus.on('priority:cooling', () => this.toast(G.openingData.texts.coolingDown, 'warn', 2000));
      bus.on('priority:ended', (e) => this.toast(e.effective ? 'Prioridad efectiva: +' + e.pts : 'Fin de la prioridad. El equipo vuelve a sus puestos.', e.effective ? 'good' : 'info', 3000));
      bus.on('combo:break', () => this.toast('Combo roto', 'warn', 1400));
      bus.on('clock:hour', () => { if (G.state === 'playing') G.audio.play('hour'); });
      bus.on('simulation:stall', (e) => {
        this.toast('SIMULATION_STALL_DETECTED · ' + e.at + ' · llegada esperada > 0, sin actividad visible.', 'bad', 6000);
      });
    }

    // ---------- HUD ----------
    update(dt) {
      const G = this.G, E = this.el, c = G.clock, sc = G.scoring;
      if (this.tutorialStep) this.tutorialTick();
      E.hClock.textContent = c.label;
      const ph = c.phase;
      E.hPhase.textContent = ph.icon + ' ' + ph.label;
      E.hScore.textContent = sc.score;
      E.pScore.classList.toggle('neg', sc.score < 0);
      const mult = sc.multiplier;
      E.hCombo.hidden = sc.streak < G.cfg.score.comboStartsAt;
      E.hCombo.textContent = '🔥 x' + mult.toFixed(1);
      const act = G.events.active().length;
      E.hEvents.textContent = act;
      const pr = G.priority;
      E.hPrio.textContent = pr.channel ? G.ev.channels[pr.channel].icon + ' ' + G.ev.channels[pr.channel].label + ' · ' + Math.ceil(pr.left) + 's' : pr.cooldown > 0 ? 'En espera ' + Math.ceil(pr.cooldown) + 's' : 'Sin prioridad';
      const op = G.opening;
      const csl = op.cslActive;
      const checklist = csl ? op.cslTasks : op.tasks.filter((t) => t.checklist);
      const tdone = checklist.filter((t) => t.done && !t.skipped).length;
      E.hTasks.textContent = (csl ? 'CSL ' : '') + tdone + '/' + checklist.length;
      this.updateTasks();
      this.updateBubbles(dt);
      this.chipT -= dt;
      if (this.chipT <= 0) { this.chipT = 0.2; this.updateChips(); }
      if (this.capT > 0) { this.capT -= dt; if (this.capT <= 0) E.caption.classList.remove('show'); }
      this.opsRefresh -= dt;
      if (this.opsRefresh <= 0) {
        this.opsRefresh = 1;
        if (G.state === 'playing') this.updateOpsCompact();
        if (!E.operationsPanel.hidden) this.renderOperations();
      }
      if (!E.reviewCard.hidden) {
        this.reviewT -= dt;
        if (this.reviewT <= 0) { E.reviewCard.hidden = true; E.reviewCard.innerHTML = ''; }
      }
      E.bSound.textContent = G.audio.muted ? '🔇' : '🔊';
      E.bSound.setAttribute('aria-pressed', String(G.audio.muted));
      E.bPause.textContent = G.paused ? '▶' : '⏸';
      E.bPause.setAttribute('aria-label', G.paused ? 'Reanudar' : 'Pausar');
      E.bFollow.setAttribute('aria-pressed', String(G.renderer.follow));
      E.debugPanel.hidden = !G.debugSimulation;
      this.debugRefresh -= dt;
      if (G.debugSimulation && this.debugRefresh <= 0) { this.debugRefresh = 0.35; this.updateDebugPanel(); }
    }
    updateDebugPanel() {
      const G = this.G, cfg = G.cfg.difficultyProfiles[G.save.settings.difficulty];
      const rates = Object.keys(G.arrivals.timers).map((channel) => {
        const interval = G.arrivals.interval(channel);
        return channel.toUpperCase() + '=' + (Number.isFinite(interval) ? (3600 / interval).toFixed(1) + '/h' : '0/h');
      }).join(' · ');
      const next = Object.entries(G.arrivals.timers).sort((a, b) => a[1] - b[1])[0];
      const orderCount = (channel) => G.production.orders.filter((order) => order.channel === channel && order.status !== 'delivered').length;
      const riders = G.customers.guests.filter((guest) => guest.role === 'rider' && !guest.leaving).length;
      this.el.debugStats.textContent = [
        'CLOCK: ' + G.clock.label,
        'OPEN STATE: ' + G.restaurantState,
        'ARRIVAL RATE: ' + rates,
        'NEXT SPAWN: ' + (next ? next[0].toUpperCase() + ' · ' + Math.max(0, next[1]).toFixed(1) + 's' : '—'),
        'ACTIVE CUSTOMERS: ' + G.customers.guests.filter((guest) => !guest.dead).length,
        'ACTIVE EVENTS: ' + G.events.active().length,
        'QUEUE COUNTER: ' + (orderCount('counter') + orderCount('kiosk')),
        'QUEUE AUTO: ' + G.vehicles.count,
        'QUEUE DELIVERY: ' + orderCount('delivery') + ' · riders ' + riders,
        'EVENT DIRECTOR STATE: ' + G.director.state + ' · cap ' + cfg.maxConcurrent,
        'WATCHDOG: ' + (G.arrivals.stalled ? 'SIMULATION_STALL_DETECTED' : 'OK')
      ].join('\n');
      this.el.debugLog.replaceChildren(...G.debug.logs.slice(-8).map((line) => h('li', { text: line })));
    }
    renderSimulationTest(results) {
      const rows = ['SIMULATION TEST'];
      const difficultyNames = {
        weekday: 'NORMAL_ENTRESEMANA', weekend: 'DIFICIL_FIN_DE_SEMANA',
        specialHoliday: 'EXPERTO_FESTIVO_ESPECIAL'
      };
      results.forEach((result) => {
        const a = result.arrivals, e = result.scheduled;
        rows.push(
          (difficultyNames[result.difficulty] || result.difficulty.toUpperCase()) + ' · ' + result.from + '–' + result.to,
          'Mostrador: clientes generados ' + (a.counter || 0) + ' · eventos ' + (e.counter || 0),
          'Kiosco: clientes generados ' + (a.kiosk || 0) + ' · incidencias ' + (e.kiosk || 0),
          'AutoKing: vehículos generados ' + (a.autoking || 0) + ' · recogidas ' + (e.vehicle || 0),
          'Delivery: repartidores generados ' + (a.delivery || 0) + ' · eventos ' + (e.delivery || 0),
          'Sala: ocupaciones ' + (a.dining || 0) + ' · mesas sucias ' + (e.dirtyTable || 0),
          'Llegadas totales ' + result.totalArrivals + ' · director ' + result.playerEvents + ' eventos'
        );
      });
      this.el.debugTestSummary.textContent = rows.join('\n');
    }
    showOpeningConfirmation(readiness) {
      const G = this.G;
      const body = h('div', {},
        h('p', { class: 'lead', text: '⚠ La apertura presenta incidencias pendientes. Abrir ahora afectará la puntuación del turno.' }),
        h('p', { class: 'sub', text: 'Preparación correcta: ' + readiness.readiness + '% · incorrectas: ' + readiness.incorrectTasks.length + ' · omitidas: ' + readiness.omittedTasks.length + ' · pendientes: ' + readiness.pendingTasks.length + ' · fallos críticos: ' + readiness.criticalFailures.length }),
        h('p', { class: 'sub', text: 'No se mostrarán respuestas correctas. Las penalizaciones ya aplicadas durante las revisiones no volverán a contarse.' }));
      this.modal({
        title: '⚠ Confirmar apertura', body, pause: true,
        buttons: [
          { label: 'REVISAR', onClick: () => {
            const task = readiness.incorrectTasks.find((item) => !item.done && (!item.checklist || !G.opening.checklistClosed)) || readiness.pendingTasks.find((item) => !item.checklist || !G.opening.checklistClosed);
            if (task) G.player.goTask(task);
            else this.toast('No quedan tareas revisables en el checklist cerrado.', 'info', 2800);
          } },
          { label: 'ABRIR DE TODOS MODOS', primary: true, onClick: () => {
            if (G.opening.confirmOpenAnyway()) G.player.goTask(G.opening.task('open-door'));
          } },
          { label: 'Cancelar' }
        ]
      });
    }
    updateTasks() {
      const G = this.G, P = this.el.tasksPanel, op = G.opening;
      const csl = op.cslActive;
      const list = op.visibleTasks;
      const closed = csl ? op.cslClosed : op.checklistClosed;
      const key = list.map((t) => (t.done ? 1 : 0) + (t.correct === false ? 'x' : '') + (t.skipped ? 's' : '')).join('') + (op.checksDone ? 'c' : '') + G.state + closed + csl;
      const left = G.clock.open - G.clock.t;
      const cslLeft = op.cslDeadline - G.clock.t;
      const title = csl ? (op.cslClosed ? 'Recorrido CSL cerrado' : 'Tiempo restante: ' + fmtMin(Math.max(0, cslLeft))) : op.isOpen ? 'Restaurante abierto' : left > 0 ? 'Apertura en ' + fmtMin(left) : 'Retraso: ' + fmtMin(-left);
      if (this.tasksKey !== key) {
        this.tasksKey = key;
        P.innerHTML = '';
        P.appendChild(h('h2', { id: 'tasksTitle' }, csl ? '📋 Recorrido CSL · hasta ' + G.cfg.csl.deadline : op.checklistClosed ? '📋 Preparación · checklist cerrado' : '📋 Preparación · hasta 11:15'));
        P.appendChild(h('p', { id: 'tasksSub', class: 'sub' }));
        const ul = h('ul');
        list.forEach((t) => {
          const locked = t.action === 'door' && !op.checksDone;
          const failed = !t.done && t.correct === false;
          const mark = t.skipped ? '⌛' : t.done ? (t.correct === false ? '⚠' : '✔') : failed ? '⚠' : locked ? '🔒' : '○';
          const status = t.skipped ? 'omitida' : t.done ? (t.correct === false ? 'fallida' : 'completada') : failed ? 'fallida, se puede repetir' : locked ? 'bloqueada' : 'pendiente';
          const available = !t.done && (csl ? !op.cslClosed : (!t.checklist || !op.checklistClosed));
          const b = h('button', { class: 'task' + (t.done && !t.skipped && t.correct !== false ? ' done' : '') + (t.skipped || t.correct === false ? ' wrong' : ''), 'aria-label': t.label + ', ' + status, disabled: !available, onclick: () => { if (available && G.state === 'playing') { G.audio.unlock(); G.player.goTask(t); } } }, h('span', { class: 'mk', 'aria-hidden': 'true' }, mark), ' ', t.label, failed ? h('small', { class: 'retry', text: ' · REPETIR' }) : '');
          ul.appendChild(h('li', {}, b));
        });
        P.appendChild(ul);
      }
      // Cierre automático del panel: preparación a las 12:20 (abierto el restaurante) y CSL a las 17:30, salvo que el jugador lo haya gestionado a mano.
      const phase = csl ? 'csl' : 'prep';
      if (this.panelLastT == null || G.clock.t < this.panelLastT - 1) { this.panelPhase = null; P.classList.remove('collapsed'); $('bTasks').setAttribute('aria-expanded', 'true'); }
      this.panelLastT = G.clock.t;
      if (this.panelPhase !== phase) {
        this.panelPhase = phase; this.panelAuto = true;
        if (csl) { P.classList.remove('collapsed'); $('bTasks').setAttribute('aria-expanded', 'true'); }
      }
      const closeAt = csl ? BK.util.parseHM('17:30', G.clock.start) : G.clock.open + 20;
      if (this.panelAuto && G.state === 'playing' && (csl || op.isOpen) && G.clock.t >= closeAt) {
        this.panelAuto = false;
        P.classList.add('collapsed');
        $('bTasks').setAttribute('aria-expanded', 'false');
      }
      const sub = $('tasksSub');
      if (sub) { sub.textContent = csl ? title : op.checklistClosed ? title : title + ' · checklist hasta 11:15'; sub.classList.toggle('late', csl ? !op.cslClosed && cslLeft < 15 : !op.isOpen && left <= 0); }
      P.hidden = G.state !== 'playing';
      P.classList.toggle('done-all', op.isOpen && !csl);
    }
    updateChips() {
      const G = this.G, list = G.events.list.filter((e) => G.events.isLive(e) && e.state !== 'appearing' || e.state === 'appearing');
      const ul = this.el.chips, live = new Set();
      list.filter((e) => G.events.isLive(e)).sort((a, b) => G.events.remainingSec(a) - G.events.remainingSec(b)).forEach((e, i) => {
        live.add(e.id);
        let li = this.chipEls.get(e.id);
        if (!li) {
          const ch = G.ev.channels[e.channel];
          const btn = h('button', { class: 'chip ch-' + e.channel, onclick: () => { G.audio.unlock(); G.player.attend(e); } },
            h('span', { class: 'cshape s-' + ch.shape, 'aria-hidden': 'true' }, e.visualIndicator.icon),
            h('span', { class: 'clabel' }), h('span', { class: 'ctime' }), h('span', { class: 'cbar', 'aria-hidden': 'true' }, h('i')));
          li = h('li', {}, btn);
          this.chipEls.set(e.id, li);
          ul.appendChild(li);
        }
        const btn = li.firstChild, f = G.events.fraction(e), rem = Math.ceil(G.events.remainingSec(e));
        btn.querySelector('.clabel').textContent = e.visualIndicator.label;
        btn.querySelector('.ctime').textContent = e.state === 'inProgress' ? '…' : rem + 's';
        btn.querySelector('.cbar i').style.width = (100 * (1 - f)) + '%';
        btn.setAttribute('aria-label', e.visualIndicator.label + ', quedan ' + rem + ' segundos. Pulsa para atender.');
        btn.classList.toggle('urgent', f > 0.75); btn.classList.toggle('going', e.state === 'playerMoving' || e.state === 'inProgress');
        ul.insertBefore(li, ul.children[i] || null);
      });
      this.chipEls.forEach((li, id) => { if (!live.has(id)) { li.remove(); this.chipEls.delete(id); } });
    }
    toast(text, kind = 'info', ms = 2400) {
      const box = this.el.toasts;
      while (box.children.length > 3) box.firstChild.remove();
      const t = h('div', { class: 'toast ' + kind, text });
      box.appendChild(t);
      setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 400); }, ms);
    }
    caption(text) {
      const c = this.el.caption;
      c.textContent = '🔔 ' + text; c.classList.add('show'); this.capT = 2.6;
    }

    // ---------- bocadillos ----------
    addBubble(b) {
      b.el.classList.add('bubble');
      this.el.bubbles.appendChild(b.el);
      this.bubbles.push(b);
      return b;
    }
    removeBubble(b) {
      b.el.remove();
      this.bubbles = this.bubbles.filter((x) => x !== b);
      if (this.q === b) this.q = null;
      if (this.prioEl === b) this.prioEl = null;
    }
    noteBubble(text, ev, kind, ttl) {
      const old = this.bubbles.filter((b) => b.note);
      if (old.length >= 2) this.removeBubble(old[0]);
      const loc = ev.location;
      const el = h('div', { class: 'note ' + kind, role: 'status', text });
      this.addBubble({ el, note: true, ttl, anchor: () => ({ x: loc.x !== undefined ? loc.x : loc[0], y: (loc.y !== undefined ? loc.y : loc[1]) - (ev.lift || 56) - 30 }), below: false });
    }
    updateBubbles(dt) {
      const R = this.G.renderer, W = R.W, H = R.H;
      const compact = H < 470;
      for (const b of this.bubbles.slice()) {
        if (b.ttl !== undefined) { b.ttl -= dt; if (b.ttl <= 0) { this.removeBubble(b); continue; } }
        const a = b.anchor();
        const p = R.toScreen(a.x, a.y);
        const el = b.el;
        if (b.dock && compact) { el.classList.add('docked'); el.style.left = ''; el.style.top = ''; continue; }
        el.classList.remove('docked');
        const bw = el.offsetWidth, bh = el.offsetHeight;
        let x = p.x - bw / 2, y = p.y - bh - (b.gap || 20);
        if (y < 6) y = p.y + (b.gapBelow || 56);
        x = U.clamp(x, 6, Math.max(6, W - bw - 6)); y = U.clamp(y, 6, Math.max(6, H - bh - 6));
        el.style.left = Math.round(x) + 'px'; el.style.top = Math.round(y) + 'px';
        el.style.setProperty('--tail', Math.round(U.clamp(p.x - x, 14, bw - 14)) + 'px');
      }
    }

    // ---------- pregunta de revisión ----------
    showQuestion(e) {
      const G = this.G, task = e.task, q = e.q;
      this.closeQuestion(true);
      G.player.locked = true;
      G.audio.unlock();
      const done = (idx) => {
        const ok = G.opening.answer(idx);
        G.player.locked = false;
        const btns = box.querySelectorAll('button.opt');
        btns.forEach((bt, i) => {
          bt.disabled = true;
          if (i === q.correctIndex) { bt.classList.add('right'); bt.prepend(h('span', { class: 'mk', 'aria-hidden': 'true' }, '✔ ')); }
          else if (i === idx) { bt.classList.add('wrong'); bt.prepend(h('span', { class: 'mk', 'aria-hidden': 'true' }, '✖ ')); }
        });
        const first = task.attempts === 1;
        const pts = task.csl ? (ok ? G.cfg.score.cslCheckCorrect : G.cfg.score.cslCheckWrong) : (ok ? G.cfg.score.openingCheckCorrect : G.cfg.score.openingCheckWrong);
        G.audio.play(ok ? 'ok' : 'error');
        G.player.reaction(ok);
        const msg = ok ? (first ? '✔ ¡Correcto! +' + pts + ' puntos' : '✔ ¡Corregido! Revisión superada.')
          : '✖ No es correcta' + (first ? ' ' + pts + ' puntos' : '') + '. ' + q.explanation + ' Puedes repetir esta revisión con otra pregunta.';
        this.closeQuestion();
        this.toast(msg, ok ? 'good' : 'bad', ok ? 3200 : 8000);
      };
      const box = h('div', { class: 'qbox', role: 'dialog', 'aria-label': task.prompt },
        h('div', { class: 'qhead' }, h('span', { class: 'qtitle', text: '📋 ' + task.prompt }),
          h('button', { class: 'xbtn', 'aria-label': 'Cerrar pregunta', onclick: () => this.closeQuestion() }, '✕')),
        h('p', { class: 'qtext', text: q.question }),
        q.options.map((o, i) => h('button', { class: 'opt', onclick: () => done(i) }, h('span', { class: 'num', 'aria-hidden': 'true' }, String(i + 1)), h('span', { text: o.text }))));
      this.q = this.addBubble({ el: box, anchor: () => ({ x: G.player.char.x, y: G.player.char.y - 70 }), dock: true, gap: 8, gapBelow: 40, kind: 'question', options: q.options.length, answer: done });
      const first = box.querySelector('.opt'); if (first) first.focus({ preventScroll: true });
    }
    closeQuestion(silent) {
      if (!this.q) return;
      if (!silent && this.q.kind === 'complaint' && !this.q.answered) {
        this.q.onCancel();
        return;
      }
      const wasOpen = this.G.opening.current;
      this.removeBubble(this.q); this.q = null;
      if (wasOpen) this.G.opening.cancelQuestion();
      this.G.player.locked = false;
      void silent;
    }

    // ---------- prioridad ----------
    openPriorityManual(channel) {
      const G = this.G;
      if (G.state !== 'playing' || G.paused) return;
      if (G.priority.channel) { this.toast('Prioridad activa: ' + G.ev.channels[G.priority.channel].label, 'info', 1800); return; }
      if (G.priority.cooldown > 0) { this.toast(G.openingData.texts.coolingDown, 'warn', 1800); return; }
      if (channel) { G.priority.choose(channel); return; }
      G.priority.offered = true; this.showPriority(true);
    }
    showPriority() {
      const G = this.G;
      this.closePriority(true);
      const chs = G.ev.channels;
      const box = h('div', { class: 'qbox prio', role: 'dialog', 'aria-label': 'Prioridad de canal' },
        h('div', { class: 'qhead' }, h('span', { class: 'qtitle', text: '🎯 ' + G.openingData.texts.saturation }),
          h('button', { class: 'xbtn', 'aria-label': 'Cerrar selector de prioridad', onclick: () => G.priority.dismissOffer() }, '✕')),
        h('p', { class: 'qtext sub', text: G.openingData.texts.saturationHint }),
        Object.keys(chs).map((k, i) => {
          const n = G.events.byChannel(k).length;
          return h('button', { class: 'opt ch-' + k, onclick: () => G.priority.choose(k) }, h('span', { class: 'num', 'aria-hidden': 'true' }, String(i + 1)), h('span', { class: 'cshape s-' + chs[k].shape, 'aria-hidden': 'true' }, chs[k].icon), h('span', { text: chs[k].label + (n ? ' (' + n + ' activo' + (n > 1 ? 's' : '') + ')' : '') }));
        }));
      this.prioEl = this.addBubble({ el: box, anchor: () => ({ x: G.player.char.x, y: G.player.char.y - 70 }), dock: true, gap: 8, gapBelow: 40, kind: 'priority' });
    }
    closePriority() { if (this.prioEl) { this.removeBubble(this.prioEl); this.prioEl = null; } }
    get priorityOpen() { return !!this.prioEl; }

    // ---------- modales ----------
    modal(o) {
      const root = this.el.modalRoot, G = this.G;
      const title = h('h2', { id: 'mTitle', text: o.title });
      const box = h('div', { class: 'modal' + (o.cls ? ' ' + o.cls : ''), role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'mTitle' }, title, o.body || '');
      const acts = h('div', { class: 'actions' });
      (o.buttons || []).forEach((b) => acts.appendChild(h('button', { class: 'btn' + (b.primary ? ' primary' : ''), text: b.label, onclick: () => { if (b.close !== false) this.closeModal(); if (b.onClick) b.onClick(); } })));
      box.appendChild(acts);
      const back = h('div', { class: 'backdrop' }, box);
      root.innerHTML = ''; root.appendChild(back);
      this.modalOpts = o;
      G.uiPause = o.pause !== undefined ? o.pause : G.state !== 'playing';
      const f = box.querySelector('button.primary') || box.querySelector('button, input, select');
      if (f) setTimeout(() => f.focus(), 30);
      back.addEventListener('keydown', (e) => {
        if (e.key !== 'Tab') return;
        const f = [...box.querySelectorAll('button:not([disabled]), input, select')];
        if (!f.length) return;
        const i = f.indexOf(document.activeElement);
        if (e.shiftKey && i <= 0) { f[f.length - 1].focus(); e.preventDefault(); }
        else if (!e.shiftKey && i === f.length - 1) { f[0].focus(); e.preventDefault(); }
      });
    }
    get modalOpen() { return this.el.modalRoot.children.length > 0; }
    closeModal() {
      this.el.modalRoot.innerHTML = '';
      const o = this.modalOpts; this.modalOpts = null;
      this.G.uiPause = !!this.tutorialStep;
      if (o && o.onClose) o.onClose();
    }
    escape() {
      if (this.modalOpen) { if (this.modalOpts && this.modalOpts.closable !== false) this.closeModal(); return true; }
      if (this.tutorialStep) { this.endTutorial(); return true; }
      if (this.prioEl) { this.G.priority.dismissOffer(); return true; }
      if (this.q) { this.closeQuestion(); return true; }
      return false;
    }

    showStart() {
      const G = this.G, run = G.save.state.run, best = G.save.state.best, S = G.save.settings;
      if (G.state !== 'playing') G.restaurantState = 'PRE_SHIFT';
      const diffSel = h('select', { id: 'selDiff', 'aria-label': 'Dificultad' }, Object.entries(G.cfg.difficulty.levels).map(([k, v]) => h('option', { value: k, selected: k === S.difficulty, text: v.label })));
      const spdSel = h('select', { id: 'selSpd', 'aria-label': 'Velocidad del reloj' }, G.cfg.day.timeScaleOptions.map((v) => h('option', { value: v, selected: v === (S.timeScale || G.cfg.day.timeScale), text: v + ' min de juego / seg' })));
      const body = h('div', {},
        h('p', { class: 'lead', text: 'Planifica el equipo antes de iniciar el reloj. Después gestiona preparación, producto, producción, colas y atención al cliente hasta la 01:00.' }),
        h('ul', { class: 'legend' }, G.openingData.legend.map((l) => h('li', { text: l }))),
        h('div', { class: 'row' }, h('label', {}, 'Dificultad ', diffSel), h('label', {}, 'Reloj ', spdSel)),
        best !== null ? h('p', { class: 'best', text: '🏆 Mejor puntuación: ' + best }) : '');
      const buttons = [{ label: 'Organizar posicionamiento', primary: true, close: false, onClick: () => { this.applyStartSelects(); this.closeModal(); this.showRosterPlan(); } }];
      if (run) buttons.push({ label: 'Continuar turno (' + BK.util.fmtClock(run.t) + ', ' + run.scoring.score + ' pts)', close: false, onClick: () => { this.applyStartSelects(); this.closeModal(); G.resumeGame(run); } });
      buttons.push({ label: '🏆 Clasificación', close: false, onClick: () => { this.hideTitleLogo(); this.showLeaderboard(() => this.showStart()); } });
      buttons.push({ label: 'Ayuda', close: false, onClick: () => this.showHelp(true) });
      this.modal({ title: '🍔 Turno de Encargado', body, buttons, closable: false, cls: 'wide' });
      this.showTitleLogo();
    }
    showTitleLogo() {
      this.hideTitleLogo();
      const word = (txt, cls) => h('span', { class: 'tl-word ' + cls }, ...[...txt].map((c, i) => h('span', { class: 'tl-ch', style: 'animation-delay:' + (i * 0.12).toFixed(2) + 's', text: c === ' ' ? '\u00A0' : c })));
      this.titleLogo = h('div', { class: 'title-logo', 'aria-hidden': 'true' },
        word('RBE', 'tl-rbe'), word('TURNO DE', 'tl-sub'), word('ENCARGADO', 'tl-main'),
        h('span', { class: 'tl-tag', text: 'Gestiona el turno · prioriza · lidera al equipo' }));
      document.body.appendChild(this.titleLogo);
    }
    hideTitleLogo() { if (this.titleLogo) { this.titleLogo.remove(); this.titleLogo = null; } }
    applyStartSelects() {
      this.hideTitleLogo();
      const d = $('selDiff'), s = $('selSpd');
      if (d) this.G.setDifficulty(d.value);
      if (s) this.G.setTimeScale(parseFloat(s.value));
    }
    showRosterPlan() { this.roster.open(); }
    showHelp(fromStart) {
      const G = this.G;
      const body = h('div', {},
        h('ul', { class: 'legend' }, G.openingData.legend.map((l) => h('li', { text: l }))),
        h('p', { class: 'sub', text: 'Formas: círculo = Mostrador / sala, rombo = AutoKing, cuadrado = Delivery. Caras: 😀 excelente, 😐 aceptable, 😠 fallido (con forma de círculo, cuadrado y triángulo).' }),
        h('p', { class: 'sub', text: 'Pulsa el botón "Prioridad" de la barra superior para elegir canal cuando quieras (tiene enfriamiento).' }));
      const prev = this.modalOpts;
      this.modal({ title: 'Ayuda de controles', body, buttons: [{ label: 'Cerrar', primary: true, onClick: () => { if (fromStart) this.showStart(); else if (G.paused) this.showPause(); } }], onClose: null });
      void prev;
    }
    showSettings() {
      const G = this.G, S = G.save.settings;
      const vol = h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: S.volume, 'aria-label': 'Volumen', oninput: (e) => G.audio.setVolume(parseFloat(e.target.value)) });
      const mute = h('input', { type: 'checkbox', checked: S.muted, onchange: (e) => G.audio.setMuted(e.target.checked) });
      const music = h('input', { type: 'checkbox', checked: false, disabled: true, 'aria-label': 'Música desactivada en esta versión' });
      const ambience = h('input', { type: 'checkbox', checked: G.audio.ambienceEnabled, onchange: (e) => G.audio.setAmbienceEnabled(e.target.checked) });
      const effects = h('input', { type: 'checkbox', checked: G.audio.effectsEnabled, onchange: (e) => G.audio.setEffectsEnabled(e.target.checked) });
      const ambienceVolume = h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: G.audio.ambienceVolume, 'aria-label': 'Volumen ambiente', oninput: (e) => G.audio.setAmbienceVolume(parseFloat(e.target.value)) });
      const effectsVolume = h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: G.audio.effectsVolume, 'aria-label': 'Volumen de efectos', oninput: (e) => G.audio.setEffectsVolume(parseFloat(e.target.value)) });
      const alertsVolume = h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: S.alertsVolume === undefined ? 1 : S.alertsVolume, 'aria-label': 'Volumen de alertas', oninput: (e) => G.audio.setAlertsVolume(parseFloat(e.target.value)) });
      const uiVolume = h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: S.uiVolume === undefined ? 1 : S.uiVolume, 'aria-label': 'Volumen de interfaz', oninput: (e) => G.audio.setUiVolume(parseFloat(e.target.value)) });
      const reduceSound = h('input', { type: 'checkbox', checked: !!S.reduceStimuli, onchange: (e) => G.audio.setReduceStimuli(e.target.checked) });
      const captions = h('input', { type: 'checkbox', checked: S.soundCaptions !== false, onchange: (e) => G.audio.setSoundCaptions(e.target.checked) });
      const rm = h('input', { type: 'checkbox', checked: S.reduceMotion, onchange: (e) => G.setReduceMotion(e.target.checked) });
      const fol = h('input', { type: 'checkbox', checked: G.renderer.follow, onchange: (e) => G.setFollow(e.target.checked) });
      const diff = h('select', { 'aria-label': 'Dificultad', disabled: G.state === 'playing', onchange: (e) => G.setDifficulty(e.target.value) }, Object.entries(G.cfg.difficulty.levels).map(([k, v]) => h('option', { value: k, selected: k === S.difficulty, text: v.label })));
      const spd = h('select', { 'aria-label': 'Velocidad del reloj', onchange: (e) => G.setTimeScale(parseFloat(e.target.value)) }, G.cfg.day.timeScaleOptions.map((v) => h('option', { value: v, selected: Math.abs(v - G.clock.scale) < 0.01, text: v + ' min / seg' })));
      const body = h('div', { class: 'form' },
        h('label', {}, music, ' Música · OFF por defecto (sin pista disponible)'),
        h('label', {}, ambience, ' Ambiente'), h('label', {}, 'Volumen ambiente ', ambienceVolume),
        h('label', {}, effects, ' Efectos'), h('label', {}, 'Volumen efectos ', effectsVolume),
        h('label', {}, 'Volumen alertas ', alertsVolume), h('label', {}, 'Volumen interfaz ', uiVolume),
        h('label', {}, reduceSound, ' Reducir estímulos sonoros (menos ruido decorativo, mantiene los avisos)'),
        h('label', {}, captions, ' Subtítulos de sonido'),
        h('label', {}, 'Volumen general ', vol), h('label', {}, mute, ' Silenciar sonido'),
        h('label', {}, rm, ' Reducir animaciones y movimiento'), h('label', {}, fol, ' Cámara sigue al avatar'),
        h('label', {}, 'Dificultad ', diff), h('label', {}, 'Velocidad del reloj ', spd));
      const back = () => { if (G.state !== 'playing') this.showStart(); else if (G.paused) this.showPause(); };
      this.modal({
        title: 'Ajustes', body, buttons: [
          { label: 'Borrar datos guardados', onClick: () => { G.save.clearAll(); this.toast('Datos locales borrados.', 'info'); back(); } },
          { label: 'Cerrar', primary: true, onClick: () => back() }]
      });
    }
    showTeam() {
      this.toggleOperations(true);
    }
    toggleOperations(open) {
      const panel = this.el.operationsPanel, wasHidden = panel.hidden;
      panel.hidden = open === undefined ? !panel.hidden : !open;
      if (panel.hidden !== wasHidden) this.G.audio.emit({ event: panel.hidden ? 'panelClose' : 'panelOpen', caption: false });
      if (!panel.hidden) this.renderOperations();
      else { this.G.renderer.coverageHighlight = null; this.selectedCoverage = null; }
    }
    renderOperations() { if (this.phone) this.phone.render(); }
    updateOpsCompact() {
      const b = document.getElementById('bOps'), s = b && b.querySelector('span');
      if (!s) return;
      s.textContent = 'Operación · ' + this.phone.compact();
      b.title = this.phone.compactDetail();
    }
    formatDuration(sec) {
      const n = Math.round(sec);
      return String(Math.floor(n / 60)).padStart(2, '0') + ':' + String(n % 60).padStart(2, '0');
    }
    showKpiDetail(channel) {
      const G = this.G, k = G.production.kpi(channel);
      const causes = G.bottlenecks.causesFor(channel);
      const rows = [
        ['Último', k.last === null ? '—' : this.formatDuration(k.last)],
        ['Media última hora', k.rolling === null ? '—' : this.formatDuration(k.rolling)],
        ['Media del día', k.day === null ? '—' : this.formatDuration(k.day)],
        ['Completados', k.completed], ['En cola', k.queued], ['Bloqueados', k.blocked]
      ];
      const body = h('div', {}, h('ul', { class: 'stats' }, rows.map(([a, b]) => h('li', {}, h('span', { text: a }), h('b', { text: String(b) })))),
        h('h3', { text: 'Causas actuales' }),
        causes.length ? h('ul', { class: 'legend' }, causes.map((c) => h('li', { text: '⚠ ' + c }))) : h('p', { text: 'No hay causas activas.' }));
      this.modal({ title: 'Velocidad · ' + channel, body, buttons: [{ label: 'Cerrar', primary: true }] });
    }
    showComplaintQuestion(data) {
      const G = this.G, ev = data.ev, q = data.question;
      this.closeQuestion(true);
      const finish = (idx) => {
        if (this.q && this.q.answered) return;
        const ok = G.incidents.answerComplaint(ev, idx, q.correctIndex);
        G.player.locked = false;
        box.querySelectorAll('.opt').forEach((b, i) => {
          b.disabled = true;
          if (i === q.correctIndex) b.classList.add('right');
          else if (i === idx) b.classList.add('wrong');
        });
        this.q.answered = true;
        this.closeQuestion();
        this.toast(ok ? '✔ Respuesta correcta. Incidencia recuperada.' : '✖ Respuesta incorrecta. Se registra reseña simulada 1/5. ' + q.explanation, ok ? 'good' : 'bad', ok ? 3200 : 7000);
      };
      const box = h('div', { class: 'qbox', role: 'dialog', 'aria-label': 'Gestión de queja' },
        h('div', { class: 'qhead' }, h('span', { class: 'qtitle', text: '❓ Gestión de queja' }),
          h('button', { class: 'xbtn', 'aria-label': 'Cerrar pregunta', onclick: () => this.closeQuestion() }, '✕')),
        h('p', { class: 'qtext', text: q.question }),
        q.options.map((o, i) => h('button', { class: 'opt', onclick: () => finish(i) }, h('span', { class: 'num', text: String(i + 1) }), h('span', { text: o.text }))),
        h('p', { class: 'sub', text: 'La base documental disponible no especifica un protocolo de recuperación de quejas; este punto evalúa el objetivo de experiencia documentado.' }));
      this.q = this.addBubble({ el: box, anchor: () => ({ x: G.player.char.x, y: G.player.char.y - 70 }), dock: true, gap: 8, gapBelow: 40, kind: 'complaint' });
      this.q.onCancel = () => finish((q.correctIndex + 1) % q.options.length);
      box.querySelector('.opt')?.focus({ preventScroll: true });
    }
    showNegativeReview(d) {
      const card = this.el.reviewCard;
      card.innerHTML = '';
      card.hidden = false;
      card.appendChild(h('b', { text: 'RESEÑA RECIBIDA' }));
      card.appendChild(h('div', { class: 'stars', 'aria-label': 'Una estrella de cinco' }, '★☆☆☆☆'));
      card.appendChild(h('strong', { text: '1 / 5 · Reseña negativa (simulada)' }));
      if (d && d.text) card.appendChild(h('em', { text: '“' + d.text + '”' }));
      this.reviewT = d && d.fromAbandon ? this.G.cfg.operations.reviews.cardSec : 4;
    }
    showPause() {
      this.modal({
        title: '⏸ Pausa', cls: 'pause-menu', body: h('p', { class: 'lead', text: 'El reloj está detenido.' }),
        buttons: [
          { label: 'CONTINUAR', primary: true, onClick: () => this.G.setPaused(false) },
          { label: 'AJUSTES', close: false, onClick: () => this.showSettings() },
          { label: 'AYUDA', close: false, onClick: () => this.showHelp(false) },
          { label: 'CERRAR LOCAL Y ABANDONAR EL DÍA', close: false, onClick: () => this.showCloseStore() }],
        closable: true, onClose: () => { if (this.G.paused && !this.modalOpen) this.G.setPaused(false); }
      });
    }
    showCloseStore() {
      const G = this.G;
      this.modal({
        title: 'CERRAR LOCAL', cls: 'confirm-close',
        body: h('div', {}, h('p', { class: 'lead', text: '¿Quieres finalizar el día actual?' }),
          h('p', { class: 'sub', text: 'Se perderá el progreso de este turno y podrás comenzar una nueva experiencia.' })),
        buttons: [
          { label: 'SEGUIR JUGANDO', primary: true, close: false, onClick: () => this.showPause() },
          { label: 'CERRAR LOCAL', close: false, onClick: () => G.endCurrentDay({ reason: 'MANUAL_STORE_CLOSURE', saveResult: false }) }],
        closable: false
      });
    }
    showSummary(s) {
      const G = this.G, m = s.m;
      const rating = G.cfg.summary.ratings.filter((r) => s.score >= r.min).pop();
      const li = (a, b) => h('li', {}, h('span', { text: a }), h('b', { text: String(b) }));
      const avg = m.respN ? (m.respTotal / m.respN).toFixed(1) + ' s' : '—';
      const open = G.opening.openedAtT === null ? 'No se abrió' : m.lateMin > 0 ? 'Con ' + m.lateMin + ' min de retraso' : 'A tiempo';
      const kpi = G.kpi.endOfDayScore();
      const bandTxt = { GREEN: 'Verde', YELLOW: 'Ámbar', RED: 'Rojo' };
      const labelOf = { counter: 'Mostrador', autoking: 'AutoKing', delivery: 'DELIVERY · TIEMPO DE ENTREGA' };
      const channelKpis = Object.keys(kpi.lines).map((b) => {
        const l = kpi.lines[b];
        return li('Media ' + (labelOf[b] || l.label), l.mean === null ? '—' : this.formatDuration(l.mean) + ' · ' + bandTxt[l.meanBand] + ' (' + (l.points > 0 ? '+' : '') + l.points + ')');
      });
      const total = s.score + kpi.total;
      const board = h('div', { class: 'lb-save' });
      const renderSave = () => {
        board.innerHTML = '';
        if (saved) { board.appendChild(h('p', { class: 'best', text: saved > 0 ? '🏅 Guardado en el puesto ' + saved + ' de la clasificación.' : 'Tu puntuación no entra en el TOP 10.' })); return; }
        if (!G.save.qualifies(total)) { board.appendChild(h('p', { class: 'sub', text: 'Tu puntuación (' + total + ') no alcanza el TOP 10 actual.' })); return; }
        const input = h('input', { type: 'text', maxlength: '14', placeholder: 'Tu nombre', 'aria-label': 'Nombre para la clasificación', value: G.save.state.playerName || '' });
        const save = () => { saved = G.save.addScore(input.value, total) || -1; s.savedRank = saved; renderSave(); };
        input.addEventListener('keydown', (e) => { if (e.key !== 'Tab') e.stopPropagation(); if (e.key === 'Enter') save(); });
        board.appendChild(h('p', { class: 'lead', text: '🏆 ¡Entras en el TOP 10! Escribe tu nombre:' }));
        board.appendChild(h('div', { class: 'lb-form' }, input, h('button', { class: 'btn primary', type: 'button', text: 'Guardar', onclick: save })));
        setTimeout(() => input.focus(), 60);
      };
      let saved = s.savedRank || 0;
      renderSave();
      const body = h('div', {},
        h('p', { class: 'big' + (s.score < 0 ? ' neg' : ''), text: s.score + ' puntos de eventos' }),
        h('p', { class: 'lead', text: 'Puntuación KPI de fin de día: ' + (kpi.total > 0 ? '+' : '') + kpi.total + ' · Total: ' + total }),
        board,
        h('p', { class: 'lead', text: rating.label + '. ' + rating.note }),
        s.newBest ? h('p', { class: 'best', text: '🏆 ¡Nueva mejor puntuación!' }) : (G.save.state.best !== null ? h('p', { class: 'best', text: 'Mejor puntuación: ' + G.save.state.best }) : ''),
        h('ul', { class: 'stats' },
          li('Apertura', open), li('Revisiones correctas', m.checksOk + ' de ' + G.opening.checks.length),
          li('😀 Excelentes', m.excellent), li('😐 Aceptables', m.acceptable), li('😠 Fallidos', m.failed),
          li('Tiempo medio de respuesta', avg), li('Mesas limpiadas', m.tablesCleaned), li('Mejor combo', m.bestStreak),
          li('Tareas de checklist omitidas', m.checksMissed || 0), li('Reseñas simuladas negativas', m.negativeReviews || 0),
          li('Recorrido CSL tras la comida', (m.cslOk || 0) + ' correctas · ' + (m.cslWrong || 0) + ' incorrectas · ' + (m.cslMissed || 0) + ' omitidas'),
          li('Clientes y coches que se marcharon', m.abandoned || 0), li('Incidencias resueltas por el equipo', m.autoResolved || 0),
          li('Prioridades efectivas', m.priorityEffective + ' de ' + m.priorityChanges), ...channelKpis),
        h('h3', { text: 'Desglose de puntuación' }),
        h('ul', { class: 'stats' }, Object.entries(G.scoring.categories).map(([k, v]) => li(({ opening: 'Apertura', service: 'Servicio', team: 'Equipo', customer: 'Cliente y abandonos', operational: 'Operación', csl: 'CSL', preparation: 'Preparación', reputation: 'Reseñas negativas', staffing: 'Vacantes cubiertas', waste: 'Desperdicio de producto' })[k] || k, v))));
      this.modal({ title: '🌙 ' + G.openingData.texts.gameEnd, body, closable: false, cls: 'wide', buttons: [{ label: 'Jugar de nuevo', primary: true, onClick: () => G.newGame() }, { label: 'Clasificación', close: false, onClick: () => this.showLeaderboard(() => this.showSummary(s)) }, { label: 'Volver al menú', onClick: () => G.toMenu() }] });
    }

    avatarCanvas(w = 64, h2 = 84, k = 1) {
      const c = document.createElement('canvas');
      c.width = w; c.height = h2; c.className = 'lb-avatar';
      const ch = new BK.Character({ id: 'LB', kind: 'manager', pal: 'manager', x: w / 2, y: h2 * 0.84, dir: 0 });
      BK.CharacterAnimationSystem.draw(c.getContext('2d'), ch, k, 1);
      return c;
    }
    showLeaderboard(back) {
      const G = this.G, lb = G.save.leaderboard;
      const fmt = (d) => { try { return new Date(d).toLocaleDateString('es-ES'); } catch (e) { return ''; } };
      const slot = (i, cls) => {
        const e = lb[i];
        return h('div', { class: 'lb-pod ' + cls + (e ? '' : ' empty') },
          h('div', { class: 'lb-medal', text: ['🥇', '🥈', '🥉'][i] }),
          e ? this.avatarCanvas(64, 84, 1.25) : h('div', { class: 'lb-ghost', text: '?' }),
          h('b', { class: 'lb-name', text: e ? e.name : '—' }),
          h('span', { class: 'lb-score', text: e ? String(e.score) : '' }),
          h('div', { class: 'lb-step', text: String(i + 1) }));
      };
      const rest = [];
      for (let i = 3; i < 10; i++) {
        const e = lb[i];
        rest.push(h('li', { class: e ? '' : 'empty' }, h('span', { class: 'lb-pos', text: String(i + 1) }), h('span', { class: 'lb-n', text: e ? e.name : '—' }), h('span', { class: 'lb-d', text: e ? fmt(e.date) : '' }), h('b', { text: e ? String(e.score) : '' })));
      }
      const body = h('div', { class: 'lb' },
        lb.length ? '' : h('p', { class: 'sub', text: 'Aún no hay puntuaciones. Termina un turno para entrar en la clasificación.' }),
        h('div', { class: 'lb-podium' }, slot(1, 'p2'), slot(0, 'p1'), slot(2, 'p3')),
        h('ol', { class: 'lb-list', start: '4' }, ...rest));
      this.modal({ title: '🏆 Clasificación · TOP 10', body, closable: false, cls: 'wide', buttons: [{ label: 'Cerrar', primary: true, onClick: () => { if (back) back(); } }], onClose: null });
    }

    // ---------- tutorial ----------
    startTutorial() {
      this.tutorialStep = 1;
      this.G.uiPause = true;
      this.renderTutorial();
    }
    renderTutorial() {
      const G = this.G, T = G.cfg.tutorial, i = this.tutorialStep - 1, el = this.el.tutorial, st = T[i];
      el.hidden = false; el.innerHTML = '';
      this.tutorialDone = false; this.tutorialAdvanceAt = 0;
      this.tutorialBase = { px: G.player.char.x, py: G.player.char.y };
      if (st.wait !== 'phoneClose') this.reassign.close();
      el.appendChild(h('div', { class: 'tstep', text: 'Tutorial ' + this.tutorialStep + '/' + T.length + (st.wait ? ' · prueba tú mismo' : '') }));
      el.appendChild(h('p', { text: st.text, role: 'status' }));
      const last = this.tutorialStep >= T.length;
      el.appendChild(h('div', { class: 'actions' },
        h('button', { class: 'btn primary', text: last ? 'Empezar' : st.wait ? 'Omitir paso' : 'Siguiente', onclick: () => this.tutorialNext() }),
        h('button', { class: 'btn', text: 'Saltar tutorial', onclick: () => this.endTutorial() })));
      const b = el.querySelector('.primary'); if (b) b.focus();
    }
    tutorialNext() {
      if (this.tutorialStep >= this.G.cfg.tutorial.length) this.endTutorial();
      else { this.tutorialStep++; this.renderTutorial(); }
    }
    // Pasos interactivos: se completan al hacer la acción y avanzan solos tras un instante.
    tutorialTick() {
      const G = this.G, st = G.cfg.tutorial[this.tutorialStep - 1];
      if (!st) return;
      if (this.tutorialDone) { if (performance.now() >= this.tutorialAdvanceAt) this.tutorialNext(); return; }
      if (!st.wait) return;
      const c = G.player.char, b = this.tutorialBase;
      const ok = st.wait === 'move' ? Math.hypot(c.x - b.px, c.y - b.py) > 40
        : st.wait === 'phoneOpen' ? !this.el.operationsPanel.hidden
        : st.wait === 'phoneClose' ? this.el.operationsPanel.hidden
        : st.wait === 'reassign' ? this.reassign.isOpen : false;
      if (!ok) return;
      this.tutorialDone = true; this.tutorialAdvanceAt = performance.now() + 900;
      const p = this.el.tutorial.querySelector('p');
      if (p) p.textContent = '✔ ¡Muy bien! ' + st.text;
    }
    endTutorial() {
      this.tutorialStep = 0; this.el.tutorial.hidden = true; this.el.tutorial.innerHTML = '';
      this.reassign.close(); this.toggleOperations(false);
      this.G.uiPause = this.modalOpen;
    }
    clearTransient() {
      this.bubbles.slice().forEach((b) => this.removeBubble(b));
      this.reassign.bubble = null; this.reassign.emp = null; this.reassign.all = false; this.roster.cleanup();
      this.q = null; this.prioEl = null;
      this.el.chips.innerHTML = ''; this.chipEls.clear();
      this.el.toasts.innerHTML = '';
      this.tasksKey = null;
      this.tutorialStep = 0; this.el.tutorial.hidden = true; this.el.tutorial.innerHTML = '';
      this.el.operationsPanel.hidden = true; this.el.reviewCard.hidden = true;
    }
  }
  BK.UIManager = UIManager;
})();
