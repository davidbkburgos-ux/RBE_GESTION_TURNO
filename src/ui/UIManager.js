(function () {
  const BK = window.BK;
  const U = BK.util;
  // Sprites de los minijuegos (Summer Engine): se cargan una vez al iniciar y se reutilizan en cada frame.
  const MG_FILES = ['bg_parrilla.jpg', 'patty.png', 'sonda.png', 'bg_bandeja.jpg', 'pechuga.png', 'bg_viscosidad.jpg', 'cronometro.png'];
  const MG = {};
  MG_FILES.forEach((f) => { const im = new Image(); im.src = 'assets/minigames/' + f; MG[f] = im; });
  const mg = (f) => { const im = MG[f]; return im && im.complete && im.naturalWidth ? im : null; };
  // Sonda del termómetro con la punta en (x, y) y el mango en la dirección deg (0 = derecha, 90 = arriba).
  const SONDA = { len: 124, tipY: 0.514, ar: 0.1057 };
  function drawSondaSprite(ctx, x, y, deg) {
    const im = mg('sonda.png'); if (!im) return false;
    const h = SONDA.len * SONDA.ar;
    ctx.save(); ctx.translate(x, y); ctx.rotate(-deg * Math.PI / 180);
    ctx.shadowColor = 'rgba(0,0,0,.45)'; ctx.shadowBlur = 4; ctx.shadowOffsetY = 2;
    ctx.drawImage(im, 0, -h * SONDA.tipY, SONDA.len, h);
    ctx.restore();
    return true;
  }

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
          if (type === 'truckDelivery') { G.truckDelivery.forceStart(); return; }
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
      bus.on('csl:start', () => { G.audio.play('bell', false); this.toast('📋 Recorrido CSL: revisa cocina, mostrador, sala, baños, ' + BK.autoName + ' y exteriores.', 'info', 5200); });
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
      bus.on('truck:ready', () => {
        this.toast('🚚 Conway está listo para su descarga.', 'info', 5200);
        this.showTruckDeliveryAssignment(G.truckDelivery.availableEmployees);
      });
      bus.on('truck:manifest', (e) => this.showTruckManifest(e));
      bus.on('truck:resolved', (e) => this.toast(
        e.correct ? 'Albarán revisado correctamente: +50 puntos. El camión Conway se retira.' : 'Revisión incorrecta del albarán: -50 puntos. El camión Conway se retira.',
        e.correct ? 'good' : 'bad', 5200
      ));
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
        this.toast(e.channel === 'autoking' ? '🚗 Un coche se marcha del ' + BK.autoName + ' sin ser atendido.' : '😠 Un cliente se marcha sin ser atendido.', 'bad', 2200);
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
      bus.on('production:peak-soon', (e) => {
        const t = e.tramo;
        this.toast(t.peak
          ? '⏰ En ' + e.inMin + ' min empieza la PUNTA de ' + t.label + '. Prepara producto (+' + e.batch.MAIN_PRODUCT + ' uds.) y refuerza mostrador y Auto.'
          : '🌙 En ' + e.inMin + ' min llega el VALLE (' + t.label + '). Prepara solo lo justo: lo que sobre caducará.', t.peak ? 'warn' : 'good', 7000);
        G.audio.play(t.peak ? 'alert' : 'hour');
      });
      bus.on('production:expired', (e) => this.toast('🗑️ Caducan ' + e.units + ' uds. de producto preparado (≈' + e.eur.toFixed(2).replace('.', ',') + ' € de COGS).', 'bad', 5000));
      bus.on('production:prepared', (e) => this.toast('📦 Producto preparado para ' + e.tramo.label + ': +' + e.batch.MAIN_PRODUCT + ' uds. disponibles para reponer.', 'good', 3500));
      bus.on('employees:critical', (e) => this.toast('⚠ Posición crítica sin cobertura: ' + e.label + '.', 'warn', G.cfg.operations.messageTtl.important * 1000));
      bus.on('manager:positioned', ({ position }) => {
        const channel = G.employees.managerSupportChannel();
        const label = channel === 'autoking' ? BK.autoName : channel === 'delivery' ? 'Delivery' : channel === 'dining' ? 'Sala' : 'Mostrador / kiosco';
        this.toast(G.roleWord(true) + ' APOYANDO · ' + G.cfg.operations.stations[position].label + ' · +20 % velocidad en ' + label, 'info', 3000);
      });
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
      this.updateBriefingBubble();
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
          BK.autoName + ': vehículos generados ' + (a.autoking || 0) + ' · recogidas ' + (e.vehicle || 0),
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
          const b = h('button', { class: 'task' + (t.done && !t.skipped && t.correct !== false ? ' done' : '') + (t.skipped || t.correct === false ? ' wrong' : ''), 'aria-label': t.label + ', ' + status, disabled: !available, onclick: () => { if (available && G.state === 'playing') { G.audio.unlock(); G.player.goTask(t); } } }, h('span', { class: 'mk', 'aria-hidden': 'true' }, mark), ' ', t.icon ? t.icon + ' ' : '', t.label, failed ? h('small', { class: 'retry', text: ' · REPETIR' }) : '');
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

    updateBriefingBubble() {
      if (!this.q || !this.G.briefing) return;
      if (this.q.kind === 'briefing-minigame') {
        const marker = this.q.el.querySelector('.briefing-marker');
        if (marker) marker.style.left = (this.G.briefing.indicatorPosition * 100) + '%';
      } else if (this.q.kind === 'briefing-roulette') {
        const needle = this.q.el.querySelector('.briefing-needle');
        if (needle) needle.style.transform = 'rotate(' + this.G.briefing.needleAngle + 'deg)';
      }
    }

    showBriefingQuestion(question, index, total) {
      this.closeQuestion(true);
      const G = this.G;
      const box = h('div', { class: 'qbox briefing-q', role: 'dialog', 'aria-label': 'Pregunta de briefing' },
        h('div', { class: 'qhead' },
          h('span', { class: 'qtitle', text: '🗣️ Briefing · Pregunta ' + (index + 1) + '/' + total }),
          h('button', { class: 'xbtn', 'aria-label': 'Cancelar briefing', onclick: () => this.closeQuestion() }, '✕')),
        h('p', { class: 'qtext', text: question.question }),
        question.options.map((option, i) => h('button', { class: 'opt', onclick: () => G.briefing.answer(i) },
          h('span', { class: 'num', 'aria-hidden': 'true' }, String(i + 1)),
          h('span', { text: option }))));
      this.q = this.addBubble({
        el: box,
        anchor: () => ({ x: G.player.char.x, y: G.player.char.y - 70 }),
        dock: true, gap: 8, gapBelow: 40, kind: 'briefing-question', options: question.options.length,
        answer: (choice) => G.briefing.answer(choice)
      });
      const first = box.querySelector('.opt');
      if (first) first.focus({ preventScroll: true });
    }

    showBriefingMinigame() {
      this.closeQuestion(true);
      const G = this.G;
      const gh = G.briefing.greenHalf, w = (v) => 'flex:0 0 ' + (v * 100).toFixed(2) + '%';
      const bar = h('div', { class: 'briefing-zonebar', role: 'img', 'aria-label': 'Rojo en los extremos, amarillo a los lados y verde en el centro' },
        h('span', { class: 'briefing-red', style: w(0.2) }), h('span', { class: 'briefing-yellow', style: w(0.3 - gh) }),
        h('span', { class: 'briefing-green', style: w(gh * 2) }), h('span', { class: 'briefing-yellow', style: w(0.3 - gh) }),
        h('span', { class: 'briefing-red', style: w(0.2) }), h('i', { class: 'briefing-marker', 'aria-hidden': 'true' }));
      // Degradado continuo (no bloques): cada color en el centro de su zona; las zonas de acierto no cambian.
      const pc = (v) => (v * 100).toFixed(2) + '%', yb = 0.3 - gh;
      bar.classList.add('smooth');
      bar.style.background = 'linear-gradient(90deg, #d8463a 0%, #e0503c ' + pc(0.1) + ', #f2c230 ' + pc(0.2 + yb / 2) + ', #3cc46a ' + pc(0.5 - gh * 0.5) +
        ', #3cc46a ' + pc(0.5 + gh * 0.5) + ', #f2c230 ' + pc(0.8 - yb / 2) + ', #e0503c ' + pc(0.9) + ', #d8463a 100%)';
      const box = h('div', { class: 'qbox briefing-q briefing-game', role: 'dialog', 'aria-label': 'Precisión del briefing' },
        h('div', { class: 'qhead' },
          h('span', { class: 'qtitle', text: '🎯 Mide el ritmo del equipo' }),
          h('button', { class: 'xbtn', 'aria-label': 'Cancelar briefing', onclick: () => this.closeQuestion() }, '✕')),
        h('p', { class: 'qtext', text: 'Pulsa «Acabar briefing» cuando el indicador esté en verde para mejorar las opciones de conseguir un 15 %.' }),
        bar,
        h('div', { class: 'briefing-zone-legend', style: 'grid-template-columns:' + [0.2, 0.3 - gh, gh * 2, 0.3 - gh, 0.2].map((v) => 'minmax(0,' + v.toFixed(3) + 'fr)').join(' ') },
          ['5 %', '10 %', '15 %', '10 %', '5 %'].map((label, index) =>
            h('span', { class: 'zone-' + ['red', 'yellow', 'green', 'yellow', 'red'][index], text: label }))),
        h('button', { class: 'btn primary', onclick: () => G.briefing.finishMinigame() }, 'Acabar briefing'));
      this.q = this.addBubble({
        el: box, anchor: () => ({ x: G.player.char.x, y: G.player.char.y - 70 }),
        dock: true, gap: 8, gapBelow: 40, kind: 'briefing-minigame'
      });
    }

    showBriefingRoulette() {
      this.closeQuestion(true);
      const G = this.G, odds = G.briefing.odds;
      const colors = { 5: '#d83b2d', 10: '#f2b72b', 15: '#2fbf62' };
      const stops = [];
      G.briefing.rouletteSegments.forEach((segment) => {
        const start = segment.start * 1.8, end = (segment.start + segment.weight) * 1.8;
        stops.push(colors[segment.value] + ' ' + start + 'deg ' + end + 'deg');
      });
      stops.push('transparent 180deg 360deg');
      const gradient = 'conic-gradient(from 270deg, ' + stops.join(', ') + ')';
      const labels = G.briefing.rouletteSegments.map((segment) => {
        const angle = (270 + (segment.start + segment.weight / 2) * 1.8) * Math.PI / 180;
        const x = 110 + Math.sin(angle) * 68, y = 110 - Math.cos(angle) * 68;
        return h('span', {
          class: 'briefing-wheel-label value-' + segment.value,
          style: 'left:' + x.toFixed(1) + 'px;top:' + y.toFixed(1) + 'px',
          text: segment.value + '%'
        });
      });
      const wheel = h('div', { class: 'briefing-wheel', 'aria-label': 'Ruleta de velocidad' },
        h('div', { class: 'briefing-wheel-disc', style: 'background:' + gradient }),
        ...labels,
        h('i', { class: 'briefing-needle', 'aria-hidden': 'true' }),
        h('i', { class: 'briefing-wheel-hub', 'aria-hidden': 'true' }));
      const box = h('div', { class: 'qbox briefing-q briefing-wheel-box', role: 'dialog', 'aria-label': 'Ruleta de bonus' },
        h('div', { class: 'qhead' }, h('span', { class: 'qtitle', text: '🎡 Bonus de velocidad' })),
        h('p', { class: 'qtext', text: 'La ruleta decide el aumento permanente para el equipo durante este turno.' }),
        wheel,
        h('div', { class: 'briefing-wheel-legend' },
          h('span', { text: '5 % · ' + odds[5] + ' %', style: 'color:#a52a20' }),
          h('span', { text: '10 % · ' + odds[10] + ' %', style: 'color:#8a6100' }),
          h('span', { text: '15 % · ' + odds[15] + ' %', style: 'color:#1b7136' })));
      this.q = this.addBubble({
        el: box, anchor: () => ({ x: G.player.char.x, y: G.player.char.y - 70 }),
        dock: true, gap: 8, gapBelow: 40, kind: 'briefing-roulette'
      });
    }

    showBriefingResult(bonus) {
      this.closeQuestion(true);
      this.toast('🗣️ Briefing completado · +' + bonus + ' % de velocidad para el equipo durante el turno. Se acumula con el apoyo del encargado.', 'good', 6500);
    }

    // ---------- pregunta de revisión ----------
    showQuestion(e) {
      const G = this.G, task = e.task, q = e.q;
      this.closeQuestion(true);
      G.player.locked = true;
      G.audio.unlock();
      if (e.minigame === 'temperature') return this.showTempGame(e);
      if (e.minigame === 'chickenTemp') return this.showChickenTempGame(e);
      if (e.minigame === 'viscosity') return this.showViscosityGame(e);
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
    // ---------- minijuego: toma de temperatura de la carne ----------
    showTempGame(e) {
      const G = this.G, task = e.task, q = e.q;
      const W = 280, H = 190, CX = 140, CY = 100, R = 76;
      const cv = h('canvas', { class: 'temp-cv', width: String(W), height: String(H) });
      const ctx = cv.getContext('2d');
      const hint = h('p', { class: 'qtext temp-hint', text: 'Paso 1 · Pincha la patty en el punto correcto.' });
      const lcd = h('div', { class: 'temp-lcd' }, h('span', { class: 'temp-val', text: '--.-' }), h('span', { class: 'temp-unit', text: '°C' }));
      const optsBox = h('div', { class: 'temp-opts' });
      const box = h('div', { class: 'qbox temp-game', role: 'dialog', 'aria-label': task.prompt },
        h('div', { class: 'qhead' }, h('span', { class: 'qtitle', text: '🌡️ ' + task.prompt }),
          h('button', { class: 'xbtn', 'aria-label': 'Cerrar minijuego', onclick: () => this.closeQuestion() }, '✕')),
        hint, cv, lcd, optsBox);
      lcd.style.display = 'none';
      let step = 'point', mouse = { x: CX, y: CY }, tip = null, ang = 45, goodPoint = false, goodAngle = false, temp = 20, target = 0, tReading = 0, finished = false;
      const inPatty = (x, y) => Math.hypot(x - CX, y - CY) <= R - 6;
      // Rayas de parrilla diagonales: u = (x-CX)+(y-CY); marcas en ±20, ±60, ±100; el hueco central es u≈0.
      const MARKS = [-100, -60, -20, 20, 60, 100];
      const drawPatty = () => {
        ctx.clearRect(0, 0, W, H);
        const bg = mg('bg_parrilla.jpg'), pt = mg('patty.png');
        if (bg) ctx.drawImage(bg, 0, 0, W, H); else { ctx.fillStyle = '#7a8088'; ctx.fillRect(0, 0, W, H); }
        ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.beginPath(); ctx.ellipse(CX + 4, CY + 8, R + 4, R - 2, 0, 0, 7); ctx.fill();
        if (pt) { ctx.save(); ctx.beginPath(); ctx.arc(CX, CY, R, 0, 7); ctx.clip(); ctx.drawImage(pt, CX - R - 2, CY - R - 2, R * 2 + 4, R * 2 + 4); ctx.restore(); }
        else {
          ctx.fillStyle = '#6b3d1e'; ctx.beginPath(); ctx.arc(CX, CY, R, 0, 7); ctx.fill();
          ctx.fillStyle = '#85502a'; ctx.beginPath(); ctx.arc(CX - 6, CY - 6, R - 12, 0, 7); ctx.fill();
        }
        // marcas de parrilla (definen el punto correcto): carbonizadas con borde tostado
        ctx.save(); ctx.beginPath(); ctx.arc(CX, CY, R - 2, 0, 7); ctx.clip(); ctx.lineCap = 'butt';
        MARKS.forEach((u) => {
          ctx.strokeStyle = 'rgba(70,32,10,.55)'; ctx.lineWidth = 11; ctx.beginPath(); ctx.moveTo(CX + u + 200, CY - 200); ctx.lineTo(CX + u - 200, CY + 200); ctx.stroke();
          ctx.strokeStyle = 'rgba(22,10,3,.92)'; ctx.lineWidth = 7; ctx.beginPath(); ctx.moveTo(CX + u + 200, CY - 200); ctx.lineTo(CX + u - 200, CY + 200); ctx.stroke();
        });
        ctx.restore();
        if (!pt) { ctx.strokeStyle = '#3a2008'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(CX, CY, R, 0, 7); ctx.stroke(); }
      };
      const drawProbe = (x, y, deg) => {
        if (drawSondaSprite(ctx, x, y, deg)) { ctx.fillStyle = '#e53935'; ctx.beginPath(); ctx.arc(x, y, 3.2, 0, 7); ctx.fill(); return; }
        const a = deg * Math.PI / 180, len = 92, bx = x + Math.cos(a) * len, by = y - Math.sin(a) * len;
        ctx.lineCap = 'round';
        ctx.strokeStyle = '#d9dde2'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(bx, by); ctx.stroke();
        ctx.strokeStyle = '#23272d'; ctx.lineWidth = 9; ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx + Math.cos(a) * 22, by - Math.sin(a) * 22); ctx.stroke();
        ctx.fillStyle = '#e53935'; ctx.beginPath(); ctx.arc(x, y, 3.2, 0, 7); ctx.fill();
      };
      const drawProtractor = () => {
        ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(tip.x, tip.y, 44, -Math.PI / 2, 0); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(tip.x, tip.y); ctx.lineTo(tip.x + 52, tip.y); ctx.moveTo(tip.x, tip.y); ctx.lineTo(tip.x, tip.y - 52); ctx.stroke();
        for (let d = 15; d < 90; d += 15) { const a = d * Math.PI / 180; ctx.beginPath(); ctx.moveTo(tip.x + Math.cos(a) * 40, tip.y - Math.sin(a) * 40); ctx.lineTo(tip.x + Math.cos(a) * 48, tip.y - Math.sin(a) * 48); ctx.stroke(); }
        ctx.font = '700 11px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = 'rgba(255,255,255,.9)';
        [0, 30, 60, 90].forEach((d) => {
          const a = d * Math.PI / 180, lx = tip.x + Math.cos(a) * 66, ly = tip.y - Math.sin(a) * 66;
          ctx.fillText(d + '°', Math.min(W - 14, lx), Math.max(10, ly));
        });
        ctx.fillStyle = 'rgba(0,0,0,.65)';
        ctx.fillRect(8, H - 30, 52, 22);
        ctx.fillStyle = '#fff'; ctx.font = '800 14px system-ui, sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(Math.round(ang) + '°', 34, H - 19);
      };
      const render = () => {
        drawPatty();
        if (step === 'point') drawProbe(mouse.x, mouse.y, 70);
        else if (step === 'angle') { drawProtractor(); drawProbe(tip.x, tip.y, ang); }
        else drawProbe(tip.x, tip.y, ang);
      };
      const finish = (idx, extra) => {
        if (finished) return; finished = true;
        const ok = G.opening.answer(idx);
        const first = task.attempts === 1;
        const pts = ok ? G.cfg.score.openingCheckCorrect : G.cfg.score.openingCheckWrong;
        G.audio.play(ok ? 'ok' : 'error');
        G.player.reaction(ok);
        this.closeQuestion();
        if (ok) this.toast(extra || ('✔ ¡Correcto! ' + (first ? '+' + pts + ' puntos' : 'Revisión superada.')), 'good', 4200);
        else {
          if (G.metrics) G.metrics.fcFound = (G.metrics.fcFound || 0) + 1;
          this.toast('🚨 1FC encontrado' + (first ? ' · ' + pts + ' puntos' : '') + '. ' + q.explanation + ' Puedes repetir la toma.', 'bad', 8000);
        }
      };
      const showQuestion = () => {
        step = 'question';
        hint.textContent = '❌ No se alcanzan los 68 ºC. ' + q.question;
        optsBox.replaceChildren(...q.options.map((o, i) => h('button', { class: 'opt', onclick: () => finish(i, '✔ Procedimiento correcto: L.A.H.A y ajuste de broiler. Revisión superada.') }, h('span', { class: 'num', 'aria-hidden': 'true' }, String(i + 1)), h('span', { text: o.text }))));
        const b = optsBox.querySelector('button'); if (b) b.focus({ preventScroll: true });
      };
      const startReading = () => {
        step = 'reading';
        cv.style.cursor = 'default';
        lcd.style.display = ''; lcd.className = 'temp-lcd';
        hint.textContent = 'Midiendo temperatura…';
        target = goodPoint && goodAngle ? 69 + Math.random() * 6 : 52 + Math.random() * 12;
        temp = 20; tReading = 0;
      };
      const pos = (ev) => { const r = cv.getBoundingClientRect(); return { x: (ev.clientX - r.left) * W / r.width, y: (ev.clientY - r.top) * H / r.height }; };
      cv.style.cursor = 'none';
      cv.addEventListener('pointermove', (ev) => {
        const p = pos(ev); mouse = p;
        if (step === 'angle') ang = Math.max(0, Math.min(90, Math.atan2(tip.y - p.y, Math.abs(p.x - tip.x)) * 180 / Math.PI));
      });
      cv.addEventListener('pointerdown', (ev) => {
        const p = pos(ev); mouse = p;
        if (step === 'point') {
          if (!inPatty(p.x, p.y)) return;
          tip = { x: p.x, y: p.y };
          const u = (p.x - CX) + (p.y - CY);
          goodPoint = Math.abs(u) <= 9 && Math.hypot(p.x - CX, p.y - CY) <= 32;
          step = 'angle'; ang = 45;
          hint.textContent = 'Paso 2 · Elige el ángulo de inserción y haz clic.';
        } else if (step === 'angle') {
          ang = Math.max(0, Math.min(90, Math.atan2(tip.y - p.y, Math.abs(p.x - tip.x)) * 180 / Math.PI));
          goodAngle = Math.abs(ang - 45) <= 7;
          startReading();
        }
      });
      this.q = this.addBubble({ el: box, anchor: () => ({ x: G.player.char.x, y: G.player.char.y - 70 }), dock: true, gap: 8, gapBelow: 40, kind: 'question', options: 0, answer: () => {} });
      let last = performance.now();
      const tick = (now) => {
        if (!box.isConnected) return;
        const dt = Math.min(0.1, (now - last) / 1000); last = now;
        if (step === 'reading') {
          tReading += dt;
          temp = Math.min(target, temp + (14 + (target - temp) * 0.6) * dt * 2);
          const done = temp >= target - 0.05;
          lcd.querySelector('.temp-val').textContent = temp.toFixed(1);
          if (done) {
            const good = goodPoint && goodAngle;
            lcd.classList.add(good ? 'ok' : 'bad');
            step = 'result';
            hint.textContent = good ? '✔ Temperatura correcta: ' + temp.toFixed(1) + ' ºC (≥ 68 ºC).' : '❌ Temperatura insuficiente: ' + temp.toFixed(1) + ' ºC.';
            setTimeout(() => { if (!box.isConnected) return; if (good) finish(q.correctIndex); else showQuestion(); }, 1300);
          }
        }
        render();
        requestAnimationFrame(tick);
      };
      render();
      requestAnimationFrame(tick);
    }
    // ---------- minijuego (Popeyes): toma de temperatura del pollo ----------
    showChickenTempGame(e) {
      const G = this.G, task = e.task, q = e.q;
      const W = 280, H = 190, CX = 130, CY = 100;
      const cv = h('canvas', { class: 'temp-cv', width: String(W), height: String(H) });
      const ctx = cv.getContext('2d');
      const hint = h('p', { class: 'qtext temp-hint', text: 'Pieza 1 de 2 · Paso 1: pincha la zona con más carne y evita el hueso.' });
      const lcd = h('div', { class: 'temp-lcd' }, h('span', { class: 'temp-val', text: '68.0' }), h('span', { class: 'temp-unit', text: '°C' }));
      const optsBox = h('div', { class: 'temp-opts' });
      const box = h('div', { class: 'qbox temp-game', role: 'dialog', 'aria-label': task.prompt },
        h('div', { class: 'qhead' }, h('span', { class: 'qtitle', text: '🌡️ ' + task.prompt }),
          h('button', { class: 'xbtn', 'aria-label': 'Cerrar minijuego', onclick: () => this.closeQuestion() }, '✕')),
        hint, cv, lcd, optsBox);
      lcd.style.display = 'none';
      // Coordenadas locales de cada pieza: la carne gruesa y el hueso cambian de sitio en la segunda.
      const PIECES = [
        { rot: -0.1, flip: false, meat: [46, 6], bone: [[-62, 16], [-34, -6], [-6, -22], [18, -26]], tone: '#d9922b' },
        { rot: 0.28, flip: true, meat: [40, -12], bone: [[-58, 22], [-30, 28], [0, 36], [28, 40]], tone: '#cf8420' }
      ];
      const FORCE_OK = [48, 78];
      let tipColor = '#e53935', pi = 0, step = 'point', mouse = { x: CX, y: CY }, tip = null, force = 0, onBone = false, onMeat = false, temp = 68, target = 0, finished = false, boneTouched = false;
      const toLocal = (x, y) => {
        const p = PIECES[pi], dx = x - CX, dy = y - CY, c = Math.cos(-p.rot), s = Math.sin(-p.rot);
        let lx = dx * c - dy * s; const ly = dx * s + dy * c;
        if (p.flip) lx = -lx;
        return { x: lx, y: ly };
      };
      const distSeg = (p, a, b) => {
        const vx = b[0] - a[0], vy = b[1] - a[1], t = Math.max(0, Math.min(1, ((p.x - a[0]) * vx + (p.y - a[1]) * vy) / (vx * vx + vy * vy)));
        return Math.hypot(p.x - (a[0] + vx * t), p.y - (a[1] + vy * t));
      };
      const boneDist = (l) => { const b = PIECES[pi].bone; let d = 1e9; for (let i = 0; i < b.length - 1; i++) d = Math.min(d, distSeg(l, b[i], b[i + 1])); return d; };
      const withPiece = (fn) => {
        const p = PIECES[pi];
        ctx.save(); ctx.translate(CX, CY); ctx.rotate(p.rot); ctx.scale(p.flip ? -1 : 1, 1); fn(p); ctx.restore();
      };
      const shape = () => {
        // Pechuga frita: contorno ancho y abombado con borde irregular de rebozado.
        ctx.beginPath();
        for (let i = 0; i <= 72; i++) {
          const a = i / 72 * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
          const n = 1 + 0.02 * Math.sin(a * 7 + 1) + 0.014 * Math.sin(a * 13 + 2) + 0.01 * Math.sin(a * 23);
          const x = (c < 0 ? 76 : 86) * c * n - 4, y = (s < 0 ? 58 : 52) * s * n * (1 - 0.3 * Math.max(0, -c));
          if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
        }
        ctx.closePath();
      };
      const inPiece = (x, y) => { let r = false; withPiece(() => { shape(); r = ctx.isPointInPath(x, y); }); return r; };
      const drawPiece = () => {
        ctx.clearRect(0, 0, W, H);
        const bg = mg('bg_bandeja.jpg'), pc = mg('pechuga.png');
        if (bg) ctx.drawImage(bg, 0, 0, W, H); else { ctx.fillStyle = '#7a8088'; ctx.fillRect(0, 0, W, H); }
        ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.beginPath(); ctx.ellipse(CX + 6, CY + 12, 90, 64, 0, 0, 7); ctx.fill();
        if (pc) {
          // pechuga ilustrada recortada al contorno de juego (que define carne y hueso), con la quilla insinuada
          withPiece((p) => {
            ctx.save(); shape(); ctx.clip();
            ctx.drawImage(pc, -94, -64, 186, 186 * 0.645);
            // hueso de la quilla transparentado (como en rayos X): indica por dónde NO pinchar
            const bonePath = () => { ctx.beginPath(); p.bone.forEach((b, i) => (i ? ctx.lineTo(b[0], b[1]) : ctx.moveTo(b[0], b[1]))); };
            ctx.lineJoin = 'round'; ctx.lineCap = 'round';
            ctx.strokeStyle = 'rgba(90,50,15,.45)'; ctx.lineWidth = 13; bonePath(); ctx.stroke();
            ctx.strokeStyle = 'rgba(255,246,222,.62)'; ctx.lineWidth = 9; bonePath(); ctx.stroke();
            ctx.setLineDash([3, 4]); ctx.strokeStyle = 'rgba(200,170,120,.7)'; ctx.lineWidth = 1.5; bonePath(); ctx.stroke(); ctx.setLineDash([]);
            ctx.fillStyle = '#f1e4c4'; ctx.strokeStyle = '#7a5a2c'; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.ellipse(-70, 14, 12, 8, -0.5, 0, 7); ctx.fill(); ctx.stroke();
            ctx.fillStyle = '#d8c59a'; ctx.beginPath(); ctx.ellipse(-70, 14, 4.5, 3, -0.5, 0, 7); ctx.fill();
            ctx.restore();
            shape(); ctx.strokeStyle = 'rgba(120,58,10,.55)'; ctx.lineWidth = 2; ctx.stroke();
          });
          return;
        }
        withPiece((p) => {
          shape(); ctx.fillStyle = p.tone; ctx.fill();
          ctx.save(); shape(); ctx.clip();
          const g = ctx.createRadialGradient(p.meat[0] - 10, p.meat[1] - 14, 4, p.meat[0], p.meat[1], 80);
          g.addColorStop(0, '#f4c15a'); g.addColorStop(1, 'rgba(160,88,20,0)'); ctx.fillStyle = g; ctx.fillRect(-100, -90, 210, 180);
          // quilla apenas insinuada bajo el rebozado
          ctx.lineJoin = 'round';
          ctx.strokeStyle = 'rgba(255,244,214,.32)'; ctx.lineWidth = 9; ctx.beginPath(); p.bone.forEach((b, i) => (i ? ctx.lineTo(b[0], b[1]) : ctx.moveTo(b[0], b[1]))); ctx.stroke();
          // rebozado crujiente: grumos claros con sombra
          const bumps = [[-44, 4, 6], [-24, -22, 7], [-2, -42, 8], [26, -40, 8], [52, -34, 8], [18, -14, 9], [44, -8, 9], [72, 8, 8], [60, 34, 8], [34, 44, 9], [4, 40, 7], [-22, 30, 7], [-2, 14, 8], [20, 22, 7], [-30, -2, 6], [74, -16, 6]];
          bumps.forEach(([bx, by, br]) => { ctx.fillStyle = 'rgba(250,208,100,.6)'; ctx.beginPath(); ctx.arc(bx, by, br, 0, 7); ctx.fill(); ctx.fillStyle = 'rgba(122,60,10,.38)'; ctx.beginPath(); ctx.arc(bx + 2, by + 3, br * 0.55, 0, 7); ctx.fill(); });
          // extremo del hueso de la quilla visible en la punta de la pechuga
          ctx.fillStyle = '#f1e4c4'; ctx.strokeStyle = '#7a5a2c'; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.ellipse(-70, 14, 12, 8, -0.5, 0, 7); ctx.fill(); ctx.stroke();
          ctx.fillStyle = '#d8c59a'; ctx.beginPath(); ctx.ellipse(-70, 14, 4.5, 3, -0.5, 0, 7); ctx.fill();
          // volumen: sombra inferior
          const sh = ctx.createLinearGradient(0, -20, 0, 58); sh.addColorStop(0, 'rgba(0,0,0,0)'); sh.addColorStop(1, 'rgba(90,40,5,.38)');
          ctx.fillStyle = sh; ctx.fillRect(-100, -20, 210, 90);
          ctx.restore();
          shape(); ctx.strokeStyle = '#8a4a12'; ctx.lineWidth = 3.5; ctx.stroke();
        });
      };
      const drawProbe = (x, y, depth, tipColor) => {
        const a = 60 * Math.PI / 180, ux = Math.cos(a), uy = -Math.sin(a), len = 92, inside = depth * 0.45;
        ctx.lineCap = 'round';
        if (inside > 0) { ctx.strokeStyle = 'rgba(217,221,226,.45)'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(x - ux * inside, y - uy * inside); ctx.lineTo(x, y); ctx.stroke(); }
        if (drawSondaSprite(ctx, x, y, 60)) { ctx.fillStyle = tipColor || '#e53935'; ctx.beginPath(); ctx.arc(x, y, 4, 0, 7); ctx.fill(); ctx.strokeStyle = 'rgba(0,0,0,.55)'; ctx.lineWidth = 1; ctx.stroke(); return; }
        ctx.strokeStyle = '#d9dde2'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + ux * len, y + uy * len); ctx.stroke();
        ctx.strokeStyle = '#23272d'; ctx.lineWidth = 9; ctx.beginPath(); ctx.moveTo(x + ux * len, y + uy * len); ctx.lineTo(x + ux * (len + 22), y + uy * (len + 22)); ctx.stroke();
        ctx.fillStyle = tipColor || '#e53935'; ctx.beginPath(); ctx.arc(x, y, 4, 0, 7); ctx.fill(); ctx.strokeStyle = 'rgba(0,0,0,.55)'; ctx.lineWidth = 1; ctx.stroke();
      };
      // Pista del paso 1: rojo lejos, amarillo cerca, verde sobre la zona de carne correcta.
      const tipHint = (x, y) => {
        if (!inPiece(x, y)) return '#e53935';
        const l = toLocal(x, y), m = PIECES[pi].meat, d = Math.hypot(l.x - m[0], l.y - m[1]);
        if (boneDist(l) <= 11) return d <= 44 ? '#f5c518' : '#e53935';
        return d <= 24 ? '#2ecc5a' : d <= 46 ? '#f5c518' : '#e53935';
      };
      const GX = W - 30, GY = 16, GH = H - 32;
      const drawGauge = () => {
        ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(GX - 6, GY - 6, 28, GH + 12);
        const yOf = (f) => GY + GH - GH * f / 100;
        const gr = ctx.createLinearGradient(0, yOf(0), 0, yOf(100));
        [[0, '#5b7ea8'], [0.3, '#5b9bb8'], [0.48, '#35a860'], [0.63, '#2e9e4f'], [0.78, '#d8b82a'], [0.9, '#d9622b'], [1, '#c4382c']].forEach(([o, c]) => gr.addColorStop(o, c));
        ctx.fillStyle = gr; ctx.fillRect(GX, yOf(100), 16, yOf(0) - yOf(100));
        ctx.strokeStyle = 'rgba(255,255,255,.8)'; ctx.lineWidth = 1.5; ctx.strokeRect(GX, yOf(100), 16, yOf(0) - yOf(100));
        ctx.beginPath(); [FORCE_OK[0], FORCE_OK[1]].forEach((f) => { ctx.moveTo(GX - 3, yOf(f)); ctx.lineTo(GX + 19, yOf(f)); }); ctx.stroke();
        ctx.fillStyle = '#fff'; ctx.fillRect(GX - 5, yOf(force) - 2, 26, 4);
        ctx.font = '700 9px system-ui, sans-serif'; ctx.textAlign = 'right'; ctx.fillStyle = '#fff';
        ctx.fillText('HUESO', GX - 8, yOf(90) + 3); ctx.fillText('IDEAL', GX - 8, yOf(63) + 3); ctx.fillText('POCA', GX - 8, yOf(24) + 3);
        ctx.fillStyle = 'rgba(0,0,0,.65)'; ctx.fillRect(8, H - 30, 62, 22);
        ctx.fillStyle = '#fff'; ctx.font = '800 13px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillText('Fuerza ' + Math.round(force), 39, H - 19);
      };
      const render = () => {
        drawPiece();
        if (step === 'point') drawProbe(mouse.x, mouse.y, 0, tipHint(mouse.x, mouse.y));
        else { if (step === 'force') drawGauge(); drawProbe(tip.x, tip.y, force, tipColor); }
      };
      const finish = (idx, extra) => {
        if (finished) return; finished = true;
        const ok = G.opening.answer(idx);
        const first = task.attempts === 1;
        const pts = ok ? G.cfg.score.openingCheckCorrect : G.cfg.score.openingCheckWrong;
        G.audio.play(ok ? 'ok' : 'error');
        G.player.reaction(ok);
        this.closeQuestion();
        if (ok) this.toast(extra || ('✔ ¡Correcto! ' + (first ? '+' + pts + ' puntos' : 'Revisión superada.')), 'good', 4200);
        else {
          if (G.metrics) G.metrics.fcFound = (G.metrics.fcFound || 0) + 1;
          this.toast('🚨 1FC encontrado' + (first ? ' · ' + pts + ' puntos' : '') + '. ' + q.explanation + ' Puedes repetir la toma.', 'bad', 8000);
        }
      };
      const showQuestion = () => {
        step = 'question'; lcd.style.display = 'none';
        hint.textContent = '❌ Ninguna pieza alcanza los 74 ºC. ¿Qué proceso debes ejecutar?';
        optsBox.replaceChildren(...q.options.map((o, i) => h('button', { class: 'opt', onclick: () => finish(i, '✔ Procedimiento correcto: L.A.H.A y ajuste de freidora. Revisión superada.') }, h('span', { class: 'num', 'aria-hidden': 'true' }, String(i + 1)), h('span', { text: o.text }))));
        const b = optsBox.querySelector('button'); if (b) b.focus({ preventScroll: true });
      };
      const startReading = () => {
        step = 'reading'; cv.style.cursor = 'default';
        lcd.style.display = ''; lcd.className = 'temp-lcd';
        hint.textContent = 'Midiendo temperatura…';
        const good = onMeat && !onBone && force >= FORCE_OK[0] && force <= FORCE_OK[1];
        boneTouched = onBone || force > FORCE_OK[1];
        target = good ? 75.6 + Math.random() * 0.8 : 69 + Math.random() * 4.5;
        temp = 68;
      };
      const forceAt = (p) => Math.max(0, Math.min(100, Math.hypot(p.x - tip.x, p.y - tip.y) / 85 * 100));
      const pos = (ev) => { const r = cv.getBoundingClientRect(); return { x: (ev.clientX - r.left) * W / r.width, y: (ev.clientY - r.top) * H / r.height }; };
      cv.style.cursor = 'none';
      cv.addEventListener('pointermove', (ev) => { const p = pos(ev); mouse = p; if (step === 'force') force = forceAt(p); });
      cv.addEventListener('pointerdown', (ev) => {
        const p = pos(ev); mouse = p;
        if (step === 'point') {
          if (!inPiece(p.x, p.y)) return;
          tip = { x: p.x, y: p.y }; tipColor = tipHint(p.x, p.y);
          const l = toLocal(p.x, p.y);
          onBone = boneDist(l) <= 11;
          onMeat = Math.hypot(l.x - PIECES[pi].meat[0], l.y - PIECES[pi].meat[1]) <= 24;
          step = 'force'; force = 0;
          hint.textContent = 'Pieza ' + (pi + 1) + ' de 2 · Paso 2: arrastra para elegir la fuerza de inserción y haz clic. Si te pasas, tocarás hueso.';
        } else if (step === 'force') {
          force = forceAt(p);
          startReading();
        }
      });
      this.q = this.addBubble({ el: box, anchor: () => ({ x: G.player.char.x, y: G.player.char.y - 70 }), dock: true, gap: 8, gapBelow: 40, kind: 'question', options: 0, answer: () => {} });
      let last = performance.now();
      const tick = (now) => {
        if (!box.isConnected) return;
        const dt = Math.min(0.1, (now - last) / 1000); last = now;
        if (step === 'reading') {
          temp = Math.min(target, temp + (5 + (target - temp) * 0.9) * dt * 2);
          lcd.querySelector('.temp-val').textContent = temp.toFixed(1);
          if (temp >= target - 0.05) {
            const good = target >= 74;
            lcd.classList.add(good ? 'ok' : 'bad');
            step = 'result';
            hint.textContent = good ? '✔ Temperatura correcta: ' + temp.toFixed(1) + ' ºC (≥ 74 ºC).'
              : boneTouched ? '🦴 Has tocado hueso: lectura no válida (' + temp.toFixed(1) + ' ºC).'
                : '❌ Temperatura insuficiente: ' + temp.toFixed(1) + ' ºC. Zona con poca carne o sonda poco insertada.';
            setTimeout(() => {
              if (!box.isConnected) return;
              if (good) return finish(q.correctIndex, '✔ Pollo en ' + temp.toFixed(1) + ' ºC (≥ 74 ºC). Revisión superada.');
              if (pi === 0) {
                pi = 1; step = 'point'; tip = null; force = 0; lcd.style.display = 'none'; cv.style.cursor = 'none';
                hint.textContent = 'No llega a 74 ºC. Toma una segunda pieza · Paso 1: pincha la zona con más carne.';
              } else showQuestion();
            }, 1500);
          }
        }
        render();
        requestAnimationFrame(tick);
      };
      render();
      requestAnimationFrame(tick);
    }
    // ---------- minijuego (Popeyes): medir la viscosidad del mix ----------
    showViscosityGame(e) {
      const G = this.G, task = e.task, q = e.q;
      G.minigamePause = true; // el reloj del turno se detiene mientras dura la medición
      const W = 280, H = 200, CX = 104, TOP = 16, NOZ = 148, TRAY = 188, RB = 44, RN = 5, HB = 78;
      const LO = 7.5, HI = 11.5;
      const fmt = (v) => v.toFixed(2).replace('.', ',');
      const cv = h('canvas', { class: 'temp-cv', width: String(W), height: String(H) });
      const ctx = cv.getContext('2d');
      const call = h('div', { class: 'visc-call ready', text: 'PREPÁRATE' });
      const hint = h('p', { class: 'qtext temp-hint', text: 'Prepárate: el mix empezará a caer en unos segundos.' });
      const lcd = h('div', { class: 'temp-lcd' }, h('span', { class: 'temp-unit', text: '⏱️' }), h('span', { class: 'temp-val', text: '00,00' }), h('span', { class: 'temp-unit', text: 's' }));
      const btn = h('button', { class: 'opt visc-btn', type: 'button' }, h('span', { text: '⏱️ Iniciar cronómetro' }));
      const optsBox = h('div', { class: 'temp-opts' });
      const box = h('div', { class: 'qbox temp-game', role: 'dialog', 'aria-label': task.prompt },
        h('div', { class: 'qhead' }, h('span', { class: 'qtitle', text: '⏱️ ' + task.prompt }),
          h('button', { class: 'xbtn', 'aria-label': 'Cerrar minijuego', onclick: () => this.closeQuestion() }, '✕')),
        call, hint, cv, lcd, btn, optsBox);
      // Tabla de volumen del cacito (cuerpo cilíndrico + cono inferior) para que el nivel baje con forma realista.
      const rAt = (y) => (y <= TOP + HB ? RB : RB + (RN - RB) * (y - (TOP + HB)) / (NOZ - TOP - HB));
      const N = 140, cum = [0];
      for (let i = 1; i <= N; i++) { const y = NOZ - (i - 0.5) * (NOZ - TOP) / N; cum.push(cum[i - 1] + rAt(y) * rAt(y)); }
      const levelY = (frac) => {
        const target = frac * cum[N];
        let i = 1; while (i < N && cum[i] < target) i++;
        const k = (target - cum[i - 1]) / Math.max(1e-6, cum[i] - cum[i - 1]);
        return NOZ - (i - 1 + k) * (NOZ - TOP) / N;
      };
      let D = 0, scale = 1, readyDelay = 0, tm = 0, started = false, stopped = false, tStart = 0, tStop = 0, step = 'run', finished = false, shake = 0, doneAt = 0;
      const newRun = () => {
        D = 3.2 + Math.random() * 1.2;
        const r = Math.random();
        const T = r < 0.88 ? 8.3 + Math.random() * 2.4 : r < 0.95 ? 5.4 + Math.random() * 1.6 : 12.2 + Math.random() * 2.3;
        scale = T / D; // el cronómetro va acelerado respecto al tiempo real
        readyDelay = 1.2 + Math.random() * 1.8;
        tm = 0; started = false; stopped = false; step = 'run';
        btn.firstChild.textContent = '⏱️ Iniciar cronómetro';
      };
      const flowT = () => tm - readyDelay;
      const remaining = () => { const f = flowT(); if (f <= 0) return 1; if (f >= D) return 0; const k = 1 - f / D; return k * k; };
      const watch = () => (started ? ((stopped ? tStop : tm) - tStart) * scale : 0);
      const drawDial = (v) => {
        const cx = 234, cy = 76, r = 34, cw = mg('cronometro.png');
        if (cw) {
          // cronómetro ilustrado: esfera en (0.49, 0.62) del sprite con radio 0.39 del ancho
          const sw = r / 0.39, sh = sw * cw.naturalHeight / cw.naturalWidth;
          ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.4)'; ctx.shadowBlur = 6; ctx.shadowOffsetY = 3;
          ctx.drawImage(cw, cx - sw * 0.4925, cy - sh * 0.621, sw, sh); ctx.restore();
        } else {
          ctx.fillStyle = '#6a7078'; ctx.fillRect(cx - 5, cy - r - 10, 10, 8);
          ctx.fillStyle = '#f4f1ea'; ctx.strokeStyle = '#25282d'; ctx.lineWidth = 4;
          ctx.beginPath(); ctx.arc(cx, cy, r, 0, 7); ctx.fill(); ctx.stroke();
        }
        ctx.strokeStyle = '#25282d'; ctx.lineWidth = 1.5;
        for (let i = 0; i < 15; i++) { const a = i / 15 * Math.PI * 2 - Math.PI / 2, l = i % 5 === 0 ? 8 : 4; ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * (r - 3), cy + Math.sin(a) * (r - 3)); ctx.lineTo(cx + Math.cos(a) * (r - 3 - l), cy + Math.sin(a) * (r - 3 - l)); ctx.stroke(); }
        ctx.fillStyle = '#25282d'; ctx.font = '700 9px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        [[0, 0], [5, 5], [10, 10]].forEach(([s, n]) => { const a = s / 15 * Math.PI * 2 - Math.PI / 2; ctx.fillText(String(n), cx + Math.cos(a) * (r - 16), cy + Math.sin(a) * (r - 16)); });
        const a = (v % 15) / 15 * Math.PI * 2 - Math.PI / 2;
        ctx.strokeStyle = '#d6322a'; ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * (r - 7), cy + Math.sin(a) * (r - 7)); ctx.stroke();
        ctx.fillStyle = '#25282d'; ctx.beginPath(); ctx.arc(cx, cy, 3, 0, 7); ctx.fill();
      };
      const render = (now) => {
        ctx.clearRect(0, 0, W, H);
        const bgv = mg('bg_viscosidad.jpg');
        if (bgv) ctx.drawImage(bgv, 0, 0, W, H); else { ctx.fillStyle = '#7a8088'; ctx.fillRect(0, 0, W, H); }
        const sx = shake > 0 ? Math.sin(now * 0.08) * 3 * shake : 0;
        ctx.save(); ctx.translate(sx, 0);
        const u = remaining(), f = flowT(), flowing = f > 0 && u > 0;
        const drained = 1 - u;
        // bandeja y charco que va creciendo
        ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.beginPath(); ctx.ellipse(CX, TRAY + 6, 66, 7, 0, 0, 7); ctx.fill();
        ctx.fillStyle = '#4a4f57'; ctx.fillRect(CX - 62, TRAY, 124, 7);
        const prx = 9 + 40 * drained, pry = 2 + 5 * drained;
        if (drained > 0.003) {
          const pg = ctx.createRadialGradient(CX - 6, TRAY - pry, 2, CX, TRAY - pry * 0.4, prx);
          pg.addColorStop(0, '#ffe680'); pg.addColorStop(1, '#e0a400');
          ctx.fillStyle = pg; ctx.beginPath(); ctx.ellipse(CX, TRAY - pry * 0.5, prx, pry, 0, 0, 7); ctx.fill();
          ctx.strokeStyle = 'rgba(120,80,0,.45)'; ctx.lineWidth = 1; ctx.stroke();
        }
        // hilo de mix denso: el frente baja despacio, se ensancha arriba y oscila poco
        if (flowing || (f > 0 && f < D + 0.4)) {
          const front = Math.min(TRAY - pry * 0.6, NOZ + 4 + Math.max(0, f) * 95);
          const w = flowing ? 1.4 + 5.6 * Math.sqrt(u) : 1.2;
          const y0 = NOZ + 3, len = Math.max(1, front - y0), L = [], R = [];
          for (let y = y0; y <= front; y += 3) {
            const k = (y - y0) / len, cx = CX + Math.sin(now * 0.0022 + y * 0.05) * 1.4 * k, hw = (w / 2) * (1 - 0.4 * k);
            L.push([cx - hw, y]); R.push([cx + hw, y]);
          }
          if (flowing || f < D) {
            const sg = ctx.createLinearGradient(CX - 4, 0, CX + 4, 0);
            sg.addColorStop(0, '#d89a00'); sg.addColorStop(0.4, '#ffe36b'); sg.addColorStop(1, '#d89a00');
            ctx.fillStyle = sg; ctx.beginPath(); L.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); R.reverse().forEach((p) => ctx.lineTo(p[0], p[1])); ctx.closePath(); ctx.fill();
            if (front < TRAY - pry) { ctx.fillStyle = '#f0b800'; ctx.beginPath(); ctx.arc(CX, front, w * 0.62 + 0.6, 0, 7); ctx.fill(); }
          } else {
            ctx.fillStyle = '#f0b800'; ctx.beginPath(); ctx.ellipse(CX, NOZ + 8, 2.6, 3.6, 0, 0, 7); ctx.fill();
          }
        }
        // cacito: vidrio, mix y cono
        const cupPath = () => { ctx.beginPath(); ctx.moveTo(CX - RB, TOP); ctx.lineTo(CX - RB, TOP + HB); ctx.lineTo(CX - RN, NOZ); ctx.lineTo(CX + RN, NOZ); ctx.lineTo(CX + RB, TOP + HB); ctx.lineTo(CX + RB, TOP); };
        ctx.strokeStyle = '#2b2f36'; ctx.lineWidth = 6; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.arc(CX + RB + 6, TOP + 24, 15, -Math.PI / 2, Math.PI / 2); ctx.stroke();
        ctx.strokeStyle = '#b9c2cc'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(CX + RB + 6, TOP + 24, 15, -Math.PI / 2, Math.PI / 2); ctx.stroke();
        ctx.save(); cupPath(); ctx.closePath(); ctx.fillStyle = 'rgba(235,245,255,.16)'; ctx.fill(); ctx.clip();
        if (u > 0) {
          const ly = levelY(u);
          const lg = ctx.createLinearGradient(CX - RB, 0, CX + RB, 0);
          lg.addColorStop(0, '#d69a00'); lg.addColorStop(0.35, '#ffd83c'); lg.addColorStop(0.7, '#f4bd10'); lg.addColorStop(1, '#c98c00');
          ctx.fillStyle = lg; ctx.fillRect(CX - RB, ly, RB * 2, NOZ - ly + 2);
          const rs = rAt(ly);
          ctx.fillStyle = '#ffec99'; ctx.beginPath(); ctx.ellipse(CX, ly, rs, 3.6, 0, 0, 7); ctx.fill();
          ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.beginPath(); ctx.ellipse(CX - rs * 0.3, ly - 0.5, rs * 0.35, 1.2, 0, 0, 7); ctx.fill();
        }
        ctx.fillStyle = 'rgba(255,255,255,.32)'; ctx.fillRect(CX - RB + 7, TOP + 4, 5, HB - 10);
        ctx.restore();
        ctx.strokeStyle = 'rgba(245,250,255,.95)'; ctx.lineWidth = 3; ctx.lineJoin = 'round'; cupPath(); ctx.stroke();
        ctx.beginPath(); ctx.ellipse(CX, TOP, RB, 5, 0, 0, 7); ctx.stroke();
        ctx.fillStyle = '#2b2f36'; ctx.fillRect(CX - RN - 1.5, NOZ, 2 * RN + 3, 4);
        // tapón que se aparta cuando empieza a caer
        const capX = f > 0 ? CX + f * 220 : CX;
        if (capX < CX + 110) { ctx.fillStyle = '#9aa2ad'; ctx.strokeStyle = '#4b525c'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(capX, NOZ + 8, 6, 0, 7); ctx.fill(); ctx.stroke(); }
        ctx.restore();
        drawDial(watch());
      };
      const showDecision = () => {
        step = 'decide'; btn.style.display = 'none';
        call.className = 'visc-call stop'; call.textContent = 'RESULTADO';
        const v = watch(), ok = v >= LO && v <= HI;
        const opts = [
          { text: 'Viscosidad correcta: seguir con este mix', ok },
          { text: 'Preparar un nuevo mix', ok: !ok },
          { text: 'Repetir la medición con el mismo mix', ok: false }
        ].map((o) => ({ ...o, r: Math.random() })).sort((a, b) => a.r - b.r);
        q.options = opts.map((o) => ({ text: o.text }));
        q.correctIndex = opts.findIndex((o) => o.ok);
        q.explanation = ok ? 'El mix tardó ' + fmt(v) + ' s, dentro de 7,5 – 11,5 s: era correcto.' : 'El mix tardó ' + fmt(v) + ' s, fuera de 7,5 – 11,5 s: había que preparar un nuevo mix.';
        hint.textContent = 'Has medido ' + fmt(v) + ' s. ¿Qué haces?';
        optsBox.replaceChildren(...opts.map((o, i) => h('button', { class: 'opt', onclick: () => finish(i, ok ? '✔ Viscosidad correcta (' + fmt(v) + ' s). Revisión superada.' : '✔ Fuera de rango (' + fmt(v) + ' s): nuevo mix preparado. Revisión superada.') }, h('span', { class: 'num', 'aria-hidden': 'true' }, String(i + 1)), h('span', { text: o.text }))));
        const b = optsBox.querySelector('button'); if (b) b.focus({ preventScroll: true });
      };
      const finish = (idx, extra) => {
        if (finished) return; finished = true;
        const ok = G.opening.answer(idx);
        const first = task.attempts === 1;
        const pts = ok ? G.cfg.score.openingCheckCorrect : G.cfg.score.openingCheckWrong;
        G.audio.play(ok ? 'ok' : 'error');
        G.player.reaction(ok);
        this.closeQuestion();
        if (ok) this.toast(extra || ('✔ ¡Correcto! ' + (first ? '+' + pts + ' puntos' : 'Revisión superada.')), 'good', 4200);
        else {
          if (G.metrics) G.metrics.fcFound = (G.metrics.fcFound || 0) + 1;
          this.toast('🚨 1FC encontrado' + (first ? ' · ' + pts + ' puntos' : '') + '. ' + q.explanation + ' Puedes repetir la medición.', 'bad', 8000);
        }
      };
      const press = () => {
        if (step !== 'run' || stopped) return;
        if (!started) {
          if (flowT() <= 0) { shake = 1; hint.textContent = 'Todavía no cae el mix: espera a «¡MIDE!» para iniciar el cronómetro.'; return; }
          if (remaining() <= 0) return;
          started = true; tStart = tm;
          btn.firstChild.textContent = '■ Parar cronómetro';
          hint.textContent = 'Cuando el cacito se vacíe del todo, pulsa «Parar».';
        } else {
          stopped = true; tStop = tm; step = 'stopped'; doneAt = tm + 0.7;
          btn.disabled = true;
        }
      };
      btn.addEventListener('click', press);
      cv.addEventListener('pointerdown', press);
      newRun();
      this.q = this.addBubble({ el: box, anchor: () => ({ x: G.player.char.x, y: G.player.char.y - 70 }), dock: true, gap: 8, gapBelow: 40, kind: 'question', options: 0, answer: () => {} });
      btn.focus({ preventScroll: true });
      let last = performance.now();
      const tick = (now) => {
        if (!box.isConnected) return;
        const dt = G.paused ? 0 : Math.min(0.1, (now - last) / 1000); last = now;
        if (shake > 0) shake = Math.max(0, shake - dt * 3);
        if (step === 'run' || step === 'stopped') {
          tm += dt;
          const f = flowT();
          if (step === 'run') {
            if (f <= 0) { call.className = 'visc-call ready'; call.textContent = 'PREPÁRATE'; }
            else if (f < D) {
              call.className = 'visc-call go'; call.textContent = '¡MIDE!';
              if (!started) hint.textContent = 'Cuando veas caer el mix, pulsa «Iniciar cronómetro».';
            } else {
              call.className = 'visc-call halt'; call.textContent = '¡PARA!';
              if (!started && f > D + 0.4) { hint.textContent = 'Se vació sin que iniciaras el cronómetro. Nueva toma: prepárate.'; newRun(); }
              else if (started && !stopped && f > D + 3) { stopped = true; tStop = tm; step = 'stopped'; doneAt = tm + 0.7; btn.disabled = true; }
            }
          } else if (tm >= doneAt) showDecision();
          lcd.querySelector('.temp-val').textContent = fmt(watch()).padStart(5, '0');
        }
        render(now);
        requestAnimationFrame(tick);
      };
      render(performance.now());
      requestAnimationFrame(tick);
    }
    closeQuestion(silent) {
      if (!this.q) return;
      if (this.q.kind === 'briefing-roulette' && !silent) return;
      if (!silent && this.q.kind && this.q.kind.startsWith('briefing-')) {
        this.G.briefing.cancel();
        return;
      }
      if (!silent && this.q.kind === 'complaint' && !this.q.answered) {
        this.q.onCancel();
        return;
      }
      const wasOpen = this.G.opening.current;
      this.G.minigamePause = false;
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
    showTruckDeliveryAssignment(employees) {
      const options = employees.map((employee) => h('option', { value: employee.id, text: employee.displayId + ' · ' + employee.role }));
      const select = h('select', { id: 'truckEmployeeSelect', 'aria-label': 'Empleado asignado a la descarga' }, options);
      const body = h('div', {},
        h('p', { class: 'lead', text: 'Hay cajas de Conway en ' + (BK.autoName === 'AutoKing' ? 'el AutoKing' : 'la zona ' + BK.autoName) + '. Asigna a un empleado para llevarlas a la cámara de congelado; también puedes hacer clic en una caja para llevarla tú.' }),
        employees.length ? h('label', {}, 'Empleado asignado ', select) : h('p', { class: 'sub', text: 'No hay empleados disponibles: tendrás que realizar la descarga.' }));
      const buttons = [];
      if (employees.length) buttons.push({
        label: 'Asignar y descargar', primary: true,
        onClick: () => this.G.truckDelivery.assignEmployee(select.value)
      });
      buttons.push({ label: 'Lo haré yo', primary: employees.length === 0, onClick: () => this.G.truckDelivery.assignManager() });
      this.modal({ title: '🚚 Descarga de Conway', body, buttons, closable: false, pause: true });
    }

    showTruckManifest(e) {
      const body = h('div', {},
        h('p', { class: 'lead', text: 'Revisa la mercancía antes de cerrar la descarga.' }),
        h('ul', { class: 'stats' },
          h('li', {}, h('span', { text: 'Cajas según albarán' }), h('b', { text: String(e.expected) })),
          h('li', {}, h('span', { text: 'Cajas transportadas a cámara' }), h('b', { text: String(e.delivered) }))));
      this.modal({
        title: '📋 Albarán de Conway', body, closable: false, pause: true,
        buttons: [
          { label: 'Firmar albarán', primary: true, onClick: () => this.G.truckDelivery.resolveManifest('sign') },
          { label: 'Solicitar abono', onClick: () => this.G.truckDelivery.resolveManifest('credit') }
        ]
      });
    }

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
      if (this.G.briefing && this.G.briefing.active) { this.G.briefing.cancel(); return true; }
      return false;
    }

    // Pantalla de inicio a pantalla completa: fondo de la marca, panel de configuración y retrato del avatar.
    // Sin assets/manifest.json se usa la pantalla clásica.
    showStart() {
      const G = this.G, run = G.save.state.run, best = G.save.state.best, S = G.save.settings, M = G.manifest;
      if (!M || !M.brands || !BK.SpriteLoader) return this.showStartClassic();
      if (G.state !== 'playing') G.restaurantState = 'PRE_SHIFT';
      this.hideTitleLogo();
      const b = M.brands[G.brand] || M.brands.bk, gender = S.managerGender === 'f' ? 'f' : 'm', av = (M.avatars || {})[gender] || {};
      const diffSel = h('select', { id: 'selDiff', 'aria-label': 'Dificultad' }, Object.entries(G.cfg.difficulty.levels).map(([k, v]) => h('option', { value: k, selected: k === S.difficulty, text: v.label })));
      const spdSel = h('select', { id: 'selSpd', 'aria-label': 'Velocidad del reloj' }, G.cfg.day.timeScaleOptions.map((v) => h('option', { value: v, selected: v === (S.timeScale || G.cfg.day.timeScale), text: v + ' min de juego / seg' })));
      const go = (fn) => () => { this.applyStartSelects(); this.closeModal(); fn(); };
      const btn = (label, cls, onclick) => h('button', { type: 'button', class: 'btn ' + cls, onclick }, label);

      // Marca: logotipos oficiales (cambiar de marca recarga el juego con su plano y su operativa)
      const brandRow = h('div', { class: 'pick-row', role: 'radiogroup', 'aria-label': 'Marca' }, ...Object.entries(M.brands).map(([k, mb]) => {
        const on = G.brand === k;
        return h('button', { type: 'button', class: 'pick brand-pick' + (on ? ' on' : ''), role: 'radio', 'aria-checked': String(on), 'aria-label': mb.label, onclick: () => { if (!on) G.setBrand(k); } },
          h('img', { class: 'brand-logo', src: mb.logo, alt: '', draggable: 'false' }), h('span', { class: 'brand-word', text: mb.label }));
      }));
      // Tu encargado: retratos con el uniforme de la marca activa
      const avatarRow = h('div', { class: 'pick-row', role: 'radiogroup', 'aria-label': 'Tu encargado' }, ...Object.entries(M.avatars || {}).map(([g, a]) => {
        const on = gender === g, img = h('img', { class: 'pick-portrait', alt: '' });
        BK.SpriteLoader.setPortrait(img, g, G.brand, () => img.replaceWith(this.avatarCanvas(64, 84, 1.05, g === 'f' ? 'managerF' : 'manager')));
        return h('button', { type: 'button', class: 'pick avatar-pick' + (on ? ' on' : ''), role: 'radio', 'aria-checked': String(on), 'aria-label': a.label,
          onclick: () => { G.setManagerGender(g); this.showStart(); } }, img, h('span', { text: a.label }));
      }));

      const primary = btn('Organizar posicionamiento', 'primary ss-cta', go(() => this.showRosterPlan()));
      const actions = [primary];
      if (run && (run.brand || 'bk') === G.brand) actions.push(btn('Continuar turno · ' + BK.util.fmtClock(run.t) + ' · ' + run.scoring.score + ' pts', 'ss-continue', go(() => G.resumeGame(run))));
      const heroImg = h('img', { class: 'ss-hero-img', alt: av.label || '' });
      BK.SpriteLoader.setPortrait(heroImg, gender, G.brand);

      const panel = h('section', { class: 'ss-panel' },
        h('p', { class: 'ss-kicker' }, 'RBE · Simulador de turno', h('span', { class: 'ss-badge', text: 'versión ' + (G.cfg.meta.version || 'v2.0.0') })),
        h('h1', { id: 'ssTitle', class: 'ss-title' }, 'Escuela de ', h('span', { class: 'ss-role', text: G.roleWord() + 's' })),
        h('p', { class: 'ss-brand-tag', text: b.tagline || '' }),
        h('div', { class: 'identity' },
          h('div', { class: 'pick-group' }, h('b', { class: 'pick-title', text: 'Marca' }), brandRow),
          h('div', { class: 'pick-group' }, h('b', { class: 'pick-title', text: 'Tu encargado' }), avatarRow)),
        h('div', { class: 'ss-config' },
          h('label', {}, h('span', { text: 'Dificultad' }), diffSel),
          h('label', {}, h('span', { text: 'Reloj' }), spdSel)),
        h('div', { class: 'ss-actions' }, ...actions),
        h('div', { class: 'ss-secondary' },
          btn('🏆 Clasificación', 'ghost', () => this.showLeaderboard(() => this.showStart())),
          btn('❔ Ayuda', 'ghost', () => this.showHelp(true)),
          btn('⚙ Ajustes', 'ghost', () => this.showSettings())),
        h('details', { class: 'ss-how' }, h('summary', { text: 'Cómo se juega' }),
          h('p', { text: 'Planifica el equipo antes de iniciar el reloj. Después gestiona preparación, producto, producción, colas y atención al cliente hasta la 01:00.' }),
          h('ul', {}, G.openingData.legend.map((l) => h('li', { text: l })))),
        h('p', { class: 'ss-foot' }, best !== null ? h('span', { class: 'ss-best' }, 'Mejor puntuación ', h('b', { text: String(best) })) : '',
          h('span', { class: 'ss-ver', text: 'Versión ' + (G.cfg.meta.version || '') })));

      // Mini TOP 3 del ranking global con el avatar de cada récord (se rellena al llegar los datos).
      const top3 = h('aside', { class: 'ss-top3', 'aria-label': 'Top 3 de la clasificación' }, h('b', { class: 'ss-top3-t', text: '🏆 Top 3' }), h('span', { class: 'sub', text: 'Cargando…' }));
      const fillTop = (lb) => {
        if (!top3.isConnected && top3.parentNode) return;
        top3.replaceChildren(h('b', { class: 'ss-top3-t', text: '🏆 Top 3' }));
        if (!lb || !lb.length) { top3.appendChild(h('span', { class: 'sub', text: G.save.boardError ? 'Clasificación no disponible' : '¡Sé el primero!' })); return; }
        lb.slice(0, 3).forEach((e, i) => top3.appendChild(h('div', { class: 'ss-top3-row' }, h('span', { class: 'pos', text: String(i + 1) }), this.recordAvatar(e, 'lb-mini'), h('span', { class: 'n', text: e.name }), h('b', { text: String(e.score) }))));
      };
      if (G.save.leaderboard && G.save.leaderboard.length) fillTop(G.save.leaderboard);
      G.save.refreshLeaderboard().then(fillTop).catch(() => fillTop([]));
      const screen = h('div', { class: 'start-screen', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'ssTitle' },
        h('div', { class: 'ss-bg', 'aria-hidden': 'true', style: b.menu ? 'background-image:url("' + b.menu + '")' : '' }),
        h('div', { class: 'ss-shade', 'aria-hidden': 'true' }),
        h('div', { class: 'ss-motes', 'aria-hidden': 'true' }, ...Array.from({ length: 14 }, (_, i) => h('i', { style: 'left:' + ((i * 37) % 100) + '%;animation-delay:' + (-i * 1.7).toFixed(1) + 's;animation-duration:' + (11 + (i * 3) % 8) + 's;--s:' + (0.5 + (i % 4) * 0.25) }))),
        this.menuParade(),
        panel,
        top3,
        h('figure', { class: 'ss-hero' }, heroImg,
          h('figcaption', { class: 'ss-hero-cap' }, h('b', { text: av.label || G.roleWord() }), h('span', { text: 'Turno 10:00 – 01:00 · ' + b.label }))));
      const root = this.el.modalRoot;
      root.innerHTML = ''; root.appendChild(screen);
      this.modalOpts = { closable: false };
      G.uiPause = G.state !== 'playing';
      setTimeout(() => primary.focus(), 30);
    }
    showStartClassic() {
      const G = this.G, run = G.save.state.run, best = G.save.state.best, S = G.save.settings;
      if (G.state !== 'playing') G.restaurantState = 'PRE_SHIFT';
      const diffSel = h('select', { id: 'selDiff', 'aria-label': 'Dificultad' }, Object.entries(G.cfg.difficulty.levels).map(([k, v]) => h('option', { value: k, selected: k === S.difficulty, text: v.label })));
      const spdSel = h('select', { id: 'selSpd', 'aria-label': 'Velocidad del reloj' }, G.cfg.day.timeScaleOptions.map((v) => h('option', { value: v, selected: v === (S.timeScale || G.cfg.day.timeScale), text: v + ' min de juego / seg' })));
      const body = h('div', {},
        h('p', { class: 'lead', text: 'Planifica el equipo antes de iniciar el reloj. Después gestiona preparación, producto, producción, colas y atención al cliente hasta la 01:00.' }),
        h('ul', { class: 'legend' }, G.openingData.legend.map((l) => h('li', { text: l }))),
        h('div', { class: 'row' }, h('label', {}, 'Dificultad ', diffSel), h('label', {}, 'Reloj ', spdSel)),
        this.brandPicker(),
        this.genderPicker(),
        best !== null ? h('p', { class: 'best', text: '🏆 Mejor puntuación: ' + best }) : '');
      const buttons = [{ label: 'Organizar posicionamiento', primary: true, close: false, onClick: () => { this.applyStartSelects(); this.closeModal(); this.showRosterPlan(); } }];
      if (run && (run.brand || 'bk') === G.brand) buttons.push({ label: 'Continuar turno (' + BK.util.fmtClock(run.t) + ', ' + run.scoring.score + ' pts)', close: false, onClick: () => { this.applyStartSelects(); this.closeModal(); G.resumeGame(run); } });
      buttons.push({ label: '🏆 Clasificación', close: false, onClick: () => { this.hideTitleLogo(); this.showLeaderboard(() => this.showStart()); } });
      buttons.push({ label: 'Ayuda', close: false, onClick: () => this.showHelp(true) });
      this.modal({ title: '🍔 Escuela de Encargados', body, buttons, closable: false, cls: 'wide' });
      this.showTitleLogo();
    }
    showTitleLogo() {
      this.hideTitleLogo();
      const word = (txt, cls) => h('span', { class: 'tl-word ' + cls }, ...[...txt].map((c, i) => h('span', { class: 'tl-ch', style: 'animation-delay:' + (i * 0.12).toFixed(2) + 's', text: c === ' ' ? '\u00A0' : c })));
      this.titleLogo = h('div', { class: 'title-logo', 'aria-hidden': 'true' },
        word('RBE', 'tl-rbe'), word('ESCUELA DE', 'tl-sub'), word('ENCARGADOS', 'tl-main'),
        h('span', { class: 'tl-tag', text: 'Gestiona el turno · prioriza · lidera al equipo' }),
        h('span', { class: 'tl-tag tl-ver', text: 'Versión ' + (this.G.cfg.meta.version || '') }));
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
        h('p', { class: 'sub', text: 'Formas: círculo = Mostrador / sala, rombo = ' + BK.autoName + ', cuadrado = Delivery. Caras: 😀 excelente, 😐 aceptable, 😠 fallido (con forma de círculo, cuadrado y triángulo).' }),
        h('p', { class: 'sub', text: 'Pulsa el botón "Prioridad" de la barra superior para elegir canal cuando quieras (tiene enfriamiento).' }));
      const prev = this.modalOpts;
      this.modal({ title: 'Ayuda de controles', body, buttons: [{ label: 'Cerrar', primary: true, onClick: () => { if (fromStart) this.showStart(); else if (G.paused) this.showPause(); } }], onClose: null });
      void prev;
    }
    showSettings() {
      const G = this.G, S = G.save.settings;
      const vol = h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: S.volume, 'aria-label': 'Volumen', oninput: (e) => G.audio.setVolume(parseFloat(e.target.value)) });
      const mute = h('input', { type: 'checkbox', checked: S.muted, onchange: (e) => G.audio.setMuted(e.target.checked) });
      const music = h('input', { type: 'checkbox', checked: S.musicEnabled !== false, onchange: (e) => G.save.setSetting('musicEnabled', e.target.checked) });
      const gfx = h('select', { 'aria-label': 'Calidad gráfica', onchange: (e) => { G.save.setSetting('gfxQuality', e.target.value); G.renderer.resize(); } },
        h('option', { value: 'sharp', selected: S.gfxQuality !== 'performance', text: 'Nítida (recomendada)' }),
        h('option', { value: 'performance', selected: S.gfxQuality === 'performance', text: 'Rendimiento (equipos modestos)' }));
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
        h('label', {}, music, ' Música del local'),
        h('label', {}, 'Calidad gráfica ', gfx),
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
        // retrato del cliente que reclama (su sprite) junto a la pregunta
        (() => {
          const guest = ev && (ev.targetEntity || ev.guest), url = guest && guest.pal && BK.SpriteLoader && BK.SpriteLoader.faceURL(guest);
          return h('div', { class: 'complaint-who' + (url ? '' : ' noface') },
            url ? h('img', { class: 'complaint-face', src: url, alt: 'Cliente que reclama' }) : '',
            h('p', { class: 'qtext', text: q.question }));
        })(),
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
      const labelOf =  { counter: 'Mostrador', autoking: BK.autoName, delivery: 'DELIVERY · TIEMPO DE ENTREGA' };
      const channelKpis = Object.keys(kpi.lines).map((b) => {
        const l = kpi.lines[b];
        const text = l.mean === null ? '—' : this.formatDuration(l.mean) + ' (' + (l.points > 0 ? '+' : '') + l.points + ')';
        const item = li('Media ' + (labelOf[b] || l.label), text);
        if (l.meanBand) item.lastChild.classList.add('band-' + l.meanBand.toLowerCase());
        return item;
      });
      const total = s.score + kpi.total;
      const board = h('div', { class: 'lb-save' });
      const renderSave = async () => {
        board.innerHTML = '';
        if (saved) { board.appendChild(h('p', { class: 'best', text: saved > 0 ? '🏅 Guardado en el puesto ' + saved + ' de la clasificación.' : 'Tu puntuación no entra en el TOP 10.' })); return; }
        board.appendChild(h('p', { class: 'sub', text: 'Comprobando la clasificación…' }));
        const ok = await G.save.qualifies(total);
        if (!board.isConnected) return;
        board.innerHTML = '';
        if (G.save.boardError) { board.appendChild(h('p', { class: 'sub', text: 'Clasificación no disponible ahora mismo. Tu partida se ha jugado con normalidad.' })); return; }
        if (!ok) { board.appendChild(h('p', { class: 'sub', text: 'Tu puntuación (' + total + ') no alcanza el TOP 10 actual.' })); return; }
        const input = h('input', { type: 'text', maxlength: '14', placeholder: 'Tu nombre', 'aria-label': 'Nombre para la clasificación', value: G.save.state.playerName || '' });
        const btn = h('button', { class: 'btn primary', type: 'button', text: 'Guardar' });
        const msg = h('p', { class: 'sub' });
        let busy = false;
        const save = async () => {
          if (busy) return;
          busy = true; btn.disabled = true;
          const rank = await G.save.addScore(input.value, total);
          busy = false; btn.disabled = false;
          if (rank === null) { msg.textContent = 'No se pudo guardar la puntuación. Inténtalo de nuevo.'; return; }
          saved = rank || -1; s.savedRank = saved; renderSave();
        };
        btn.onclick = save;
        input.addEventListener('keydown', (e) => { if (e.key !== 'Tab') e.stopPropagation(); if (e.key === 'Enter') save(); });
        board.appendChild(h('p', { class: 'lead', text: '🏆 ¡Entras en el TOP 10! Escribe tu nombre:' }));
        board.appendChild(h('div', { class: 'lb-form' }, input, btn));
        board.appendChild(msg);
        setTimeout(() => input.focus(), 60);
      };
      let saved = s.savedRank || 0;
      renderSave();
      // ---------- Resumen condensado + valoración de clientes + Plan de Acción SMART ----------
      const P = G.production, cogsEur = P.wasteEuros ? P.wasteEuros() : 0, wasteU = P.wasteUnitsFinal != null ? P.wasteUnitsFinal : (P.wasteUnits ? P.wasteUnits() : 0);
      const events = (m.excellent || 0) + (m.acceptable || 0) + (m.failed || 0);
      const failRate = events ? m.failed / events : 0, excRate = events ? m.excellent / events : 0;
      const bands = Object.values(kpi.lines).map((l) => l.meanBand).filter(Boolean);
      const bandPen = bands.reduce((n, b) => n + (b === 'RED' ? 0.3 : b === 'YELLOW' ? 0.12 : 0), 0);
      const clamp = (v) => Math.max(1, Math.min(5, v));
      // Valoración simulada de clientes: OSAT pesa tiempos y fallos; Google pesa más las reseñas y los abandonos.
      const osat = clamp(5 - 1.4 * failRate - bandPen - 0.06 * (m.abandoned || 0) - 0.2 * (m.negativeReviews || 0) + 0.15 * excRate);
      const google = clamp(4.7 - 0.25 * (m.negativeReviews || 0) - 0.05 * (m.abandoned || 0) - 0.8 * failRate + 0.2 * excRate);
      const stars = (v) => h('span', { class: 'stars', 'aria-label': v.toFixed(1) + ' de 5' }, ...[0, 1, 2, 3, 4].map((i) => h('i', { class: v >= i + 0.75 ? 'on' : v >= i + 0.25 ? 'half' : '' })), h('b', { text: v.toFixed(1).replace('.', ',') }));
      const card = (title, rows, tone) => h('div', { class: 'sum-card ' + (tone || '') }, h('h4', { text: title }), h('ul', {}, ...rows.map(([a, b, cls]) => h('li', {}, h('span', { text: a }), h('b', { class: cls || '', text: String(b) })))));
      const band = (b) => (b ? 'band-' + b.toLowerCase() : '');
      const chRows = Object.keys(kpi.lines).map((k) => { const l = kpi.lines[k]; return [(labelOf[k] || l.label).replace('DELIVERY · TIEMPO DE ENTREGA', 'Delivery'), l.mean === null ? '—' : this.formatDuration(l.mean), band(l.meanBand)]; });
      const tone = (bad, warn) => (bad ? 'bad' : warn ? 'warn' : 'ok');
      const eur = (v) => v.toFixed(2).replace('.', ',') + ' €';
      const sp = G.cfg.operations.stockPrep;

      // Plan de Acción: las dos áreas con más margen de mejora, en formato Qué / Cómo / Quién / Cuándo / KPI.
      const worst = Object.keys(kpi.lines).map((k) => ({ k, l: kpi.lines[k] })).filter((x) => x.l.meanBand && x.l.meanBand !== 'GREEN').sort((a, b) => (b.l.mean || 0) - (a.l.mean || 0))[0];
      const target = G.cfg.operations.serviceKpi.targetSec;
      const cands = [
        { sev: worst ? (worst.l.meanBand === 'RED' ? 3 : 2) + (m.abandoned || 0) * 0.1 : 0, area: 'Tiempo de servicio',
          que: 'Bajar la media de ' + (worst ? (labelOf[worst.k] || worst.l.label).replace('DELIVERY · TIEMPO DE ENTREGA', 'Delivery') : 'servicio') + ' a verde.',
          como: 'Refuerza ese canal 20 min antes de cada punta, cubre tú el puesto si se acumula cola y fija prioridad de canal al llegar a 3 eventos.',
          quien: 'Encargado/a y equipo de ' + (worst ? (labelOf[worst.k] || worst.l.label).replace('DELIVERY · TIEMPO DE ENTREGA', 'Delivery').toLowerCase() : 'frente'), cuando: 'Próximo turno, puntas de comida y cena',
          kpi: 'Media < ' + this.formatDuration(target) + ' (verde)' },
        { sev: wasteU > sp.wasteToleranceUnits ? 1.5 + (wasteU - sp.wasteToleranceUnits) / 10 : 0, area: 'COGS · desperdicio',
          que: 'Reducir el producto preparado que caduca.', como: 'Prepara la tanda recomendada al aviso de punta y solo lo justo en los valles (tarde y cierre); no repitas preparación si queda reserva.',
          quien: 'Encargado/a (cámara de congelado)', cuando: 'Cada cambio de tramo', kpi: '≤ ' + sp.wasteToleranceUnits + ' uds. desperdiciadas (' + eur(cogsEur) + ' hoy)' },
        { sev: (P.shortages || 0) >= 3 ? 1.5 + P.shortages * 0.15 : 0, area: 'Roturas de stock',
          que: 'Que no falte producto en las puntas.', como: 'Prepara en cuanto salte el aviso de punta (20 min antes) y repón al llegar al mínimo, sin esperar al bloqueo.',
          quien: 'Encargado/a y cocina', cuando: 'Antes de las 12:00 y de las 19:00', kpi: '0 pedidos bloqueados por falta de producto (hoy ' + (P.shortages || 0) + ')' },
        { sev: (m.checksMissed || 0) + (m.checksWrong || 0) + (m.lateMin > 0 ? 1.5 : 0), area: 'Apertura',
          que: 'Apertura completa, correcta y a tiempo.', como: 'Sigue el checklist en orden, haz las tomas de temperatura y viscosidad sin prisa y abre la puerta solo con todo revisado.',
          quien: 'Encargado/a', cuando: 'De 9:00 a 11:15', kpi: 'Checklist 100 % y apertura a tiempo' },
        { sev: (m.cslWrong || 0) + (m.cslMissed || 0) * 0.8, area: 'Recorrido CSL',
          que: 'Completar el recorrido CSL tras la comida.', como: 'Bloquea 15 min tras la punta de comida para el recorrido y corrige en el momento lo que encuentres.',
          quien: 'Encargado/a', cuando: 'Tras la punta de comida', kpi: '100 % del recorrido sin incidencias' },
        { sev: (m.negativeReviews || 0) * 1.2 + (m.abandoned || 0) * 0.15, area: 'Experiencia de cliente',
          que: 'Menos abandonos y reseñas negativas.', como: 'Atiende primero a quien lleva más espera, recupera las quejas en el momento y mantén la sala limpia.',
          quien: 'Encargado/a y equipo de sala', cuando: 'Todo el turno', kpi: 'OSAT ≥ 4,5 y 0 reseñas negativas' },
        { sev: failRate > 0.15 ? failRate * 8 : 0, area: 'Eventos fallidos',
          que: 'Que ningún aviso llegue a expirar.', como: 'Delega lo rutinario en el equipo, cubre el puesto que se quede vacío y usa la prioridad de canal en las acumulaciones.',
          quien: 'Encargado/a', cuando: 'Puntas de comida y cena', kpi: '< 10 % de eventos fallidos (hoy ' + Math.round(failRate * 100) + ' %)' }
      ].filter((c) => c.sev > 0).sort((a, b) => b.sev - a.sev).slice(0, 2);
      if (!cands.length) cands.push({ area: 'Mantener el estándar', que: 'Repetir el resultado en una dificultad mayor.', como: 'Mantén la preparación por tramos y el posicionamiento por demanda; prueba Fin de semana o Festivo.', quien: 'Encargado/a', cuando: 'Próxima partida', kpi: 'Todas las medias en verde y OSAT ≥ 4,5' });
      const plan = h('div', { class: 'sum-plan' }, h('h3', { text: '🎯 Plan de acción para el próximo turno' }),
        ...cands.map((c) => h('div', { class: 'smart' },
          h('div', { class: 'smart-h' }, h('b', { text: 'OBJETIVO · ' + c.area.toUpperCase() })),
          h('p', { class: 'smart-que' }, h('b', { text: 'Qué: ' }), c.que),
          h('div', { class: 'smart-grid' },
            h('div', {}, h('small', { text: 'Cómo' }), h('span', { text: c.como })),
            h('div', {}, h('small', { text: 'Quién' }), h('span', { text: c.quien })),
            h('div', {}, h('small', { text: 'Cuándo' }), h('span', { text: c.cuando })),
            h('div', {}, h('small', { text: 'KPI objetivo' }), h('span', { text: c.kpi }))))));

      const cards = h('div', { class: 'sum-cards' },
        card('Servicio', [['Excelentes', m.excellent], ['Aceptables', m.acceptable], ['Fallidos', m.failed, m.failed ? 'band-red' : ''], ['Respuesta media', avg]], tone(failRate > 0.2, failRate > 0.1)),
        card('Tiempos por canal', chRows.length ? chRows : [['Sin datos', '—']], tone(bands.includes('RED'), bands.includes('YELLOW'))),
        card('Clientes', [['Se marcharon', m.abandoned || 0, (m.abandoned || 0) > 3 ? 'band-red' : ''], ['Reseñas negativas', m.negativeReviews || 0, (m.negativeReviews || 0) ? 'band-red' : ''], ['Mesas limpiadas', m.tablesCleaned]], tone((m.negativeReviews || 0) > 1, (m.abandoned || 0) > 2)),
        card('Apertura y CSL', [['Apertura', open], ['Revisiones', m.checksOk + ' / ' + G.opening.checks.length], ['CSL', (m.cslOk || 0) + ' ok · ' + ((m.cslWrong || 0) + (m.cslMissed || 0)) + ' a mejorar']], tone(m.lateMin > 0 || (m.checksMissed || 0) > 1, (m.checksMissed || 0) > 0)),
        card('Equipo', [['Resuelto por el equipo', m.autoResolved || 0], ['Prioridades efectivas', m.priorityEffective + ' / ' + m.priorityChanges], ['Mejor combo', m.bestStreak]], 'ok'),
        card('Producto · COGS', [['Desperdicio', wasteU + ' uds.', wasteU > sp.wasteToleranceUnits ? 'band-red' : ''], ['Coste estimado', eur(cogsEur)], ['Pedidos sin producto', P.shortages || 0, (P.shortages || 0) > 2 ? 'band-red' : '']], tone(wasteU > sp.wasteToleranceUnits * 2 || (P.shortages || 0) > 4, wasteU > sp.wasteToleranceUnits || (P.shortages || 0) > 1)));

      const body = h('div', { class: 'sum' },
        h('div', { class: 'sum-head' },
          h('div', {}, h('p', { class: 'big' + (total < 0 ? ' neg' : ''), text: String(total) }), h('p', { class: 'sub', text: s.score + ' eventos ' + (kpi.total >= 0 ? '+ ' : '− ') + Math.abs(kpi.total) + ' KPI' })),
          h('div', { class: 'sum-rating' }, h('b', { text: rating.label }), h('span', { class: 'sub', text: rating.note }),
            h('div', { class: 'sum-stars' }, h('span', { text: 'OSAT' }), stars(osat)), h('div', { class: 'sum-stars' }, h('span', { text: 'Google' }), stars(google)))),
        s.newBest ? h('p', { class: 'best', text: '🏆 ¡Nueva mejor puntuación!' }) : (G.save.state.best !== null ? h('p', { class: 'best', text: 'Mejor puntuación: ' + G.save.state.best }) : ''),
        board, cards, plan,
        h('details', { class: 'sum-more' }, h('summary', { text: 'Ver todos los indicadores' }),
          h('ul', { class: 'stats' },
            li('Tareas de checklist omitidas', m.checksMissed || 0), li('Recorrido CSL tras la comida', (m.cslOk || 0) + ' correctas · ' + (m.cslWrong || 0) + ' incorrectas · ' + (m.cslMissed || 0) + ' omitidas'),
            ...channelKpis, ...(P.wasteLog || []).map((w) => li('Caducado al cerrar ' + w.tramo, w.units + ' uds. · ' + eur(w.eur)))),
          h('h3', { text: 'Desglose de puntuación' }),
          h('ul', { class: 'stats' }, Object.entries(G.scoring.categories).map(([k, v]) => li(({ opening: 'Apertura', service: 'Servicio', team: 'Equipo', customer: 'Cliente y abandonos', operational: 'Operación', csl: 'CSL', preparation: 'Preparación', reputation: 'Reseñas negativas', staffing: 'Vacantes cubiertas', waste: 'Desperdicio de producto' })[k] || k, v)))));
      s.osat = +osat.toFixed(1); s.google = +google.toFixed(1);
      this.modal({ title: '🌙 ' + G.openingData.texts.gameEnd, body, closable: false, cls: 'wide summary', buttons: [{ label: 'Jugar de nuevo', primary: true, onClick: () => G.newGame() }, { label: 'Clasificación', close: false, onClick: () => this.showLeaderboard(() => this.showSummary(s)) }, { label: 'Volver al menú', onClick: () => G.toMenu() }] });
    }

    avatarCanvas(w = 64, h2 = 84, k = 1, pal) {
      const c = document.createElement('canvas');
      c.width = w; c.height = h2; c.className = 'lb-avatar';
      const ch = new BK.Character({ id: 'LB', kind: 'manager', pal: pal || (this.G.save.settings.managerGender === 'f' ? 'managerF' : 'manager'), x: w / 2, y: h2 * 0.92, dir: 0 });
      BK.CharacterAnimationSystem.draw(c.getContext('2d'), ch, k, 1);
      return c;
    }
    // Retrato del avatar con el que se hizo un récord ("marca:género") con el logo de la marca; sin dato, genérico.
    recordAvatar(e, cls) {
      const M = this.G.manifest, [brand, g] = String(e.avatar || '').split(':');
      const gender = g === 'f' ? 'f' : 'm', b = M && M.brands && M.brands[brand] ? brand : null;
      const label = M && M.avatars && M.avatars[gender] ? M.avatars[gender].label : '';
      const wrap = h('span', { class: cls + (b ? ' brand-' + b : ''), title: b ? label + ' · ' + M.brands[b].label : '' });
      if (!e.avatar || !BK.SpriteLoader || !M) { wrap.textContent = '👤'; return wrap; }
      const img = h('img', { alt: label, draggable: 'false' });
      BK.SpriteLoader.setPortrait(img, gender, b || 'bk', () => { img.replaceWith(document.createTextNode('👤')); });
      wrap.appendChild(img);
      if (b && M.brands[b].logo) wrap.appendChild(h('img', { class: 'lb-brand', src: M.brands[b].logo, alt: M.brands[b].label }));
      return wrap;
    }
    // Desfile del menú: personajes de la marca caminando con su animación real (CSS, sin canvas ni bucle JS).
    menuParade() {
      const G = this.G, M = G.manifest, SL = BK.SpriteLoader;
      const wrap = h('div', { class: 'ss-parade', 'aria-hidden': 'true' });
      if (!M || !SL) return wrap;
      const brand = G.brand, gender = G.save.settings.managerGender === 'f' ? 'f' : 'm';
      const emp = (M.palettes.employee || {})[brand] || [];
      const ids = [].concat(SL.avatarField(gender, 'character', brand).slice(0, 1), emp, (M.palettes.guest || {}).pool || [], [M.palettes.rider && M.palettes.rider.any]).filter((id) => id && M.characters[id]);
      const K = 0.62; // escala del sprite (celda 128x168 a 2x)
      ids.forEach((id, i) => {
        const c = M.characters[id], walk = c.anims.walk && c.anims.walk.dirs.right;
        if (!walk) return;
        const cw = c.cell[0] * K, ch = c.cell[1] * K, cols = 8, left = i % 2 === 1;
        const dur = 16 + (i * 7) % 9, delay = -((i * 5.3) % dur);
        const el = h('i', { class: 'walker' + (left ? ' left' : ''), style:
          'width:' + cw + 'px;height:' + ch + 'px;bottom:' + (6 + (i % 3) * 7) + 'px;' +
          'background-image:url("' + c.sheet + '");background-size:' + (cols * cw) + 'px auto;' +
          'background-position-y:' + (-walk.row * ch) + 'px;--sheet-w:' + (-cols * cw) + 'px;' +
          'animation-duration:' + dur + 's, .8s;animation-delay:' + delay + 's, 0s;z-index:' + (3 - (i % 3)) });
        wrap.appendChild(el);
      });
      return wrap;
    }
    brandPicker() {
      const G = this.G;
      const wrap = h('div', { class: 'row brand-pick', role: 'radiogroup', 'aria-label': 'Marca' });
      const brands = [['bk', 'Burger King', 'assets/brand/bk_logo.webp'], ['popeyes', 'Popeyes', 'assets/brand/popeyes_logo.png']];
      const render = () => {
        wrap.textContent = '';
        wrap.appendChild(h('span', { text: 'Marca ' }));
        brands.forEach(([k, label, logo]) => {
          const on = (G.save.settings.brand || 'bk') === k;
          wrap.appendChild(h('button', {
            type: 'button', class: 'brand-btn' + (on ? ' on' : ''), role: 'radio', 'aria-checked': on ? 'true' : 'false', 'aria-label': label,
            onclick: () => { G.setBrand(k); render(); }
          }, h('img', { src: logo, alt: '', draggable: 'false' })));
        });
      };
      render();
      return wrap;
    }
    genderPicker() {
      const G = this.G;
      const wrap = h('div', { class: 'row gender-pick', role: 'radiogroup', 'aria-label': 'Avatar del encargado' });
      const render = () => {
        wrap.textContent = '';
        wrap.appendChild(h('span', { text: 'Tu encargado ' }));
        [['m', 'Encargado', 'manager'], ['f', 'Encargada', 'managerF']].forEach(([g, label, pal]) => {
          const on = (G.save.settings.managerGender === 'f' ? 'f' : 'm') === g;
          const prev = this.avatarCanvas(64, 84, 1, pal); prev.style.cssText = 'width:48px;height:63px;display:block;margin:0 auto';
          wrap.appendChild(h('button', {
            type: 'button', role: 'radio', 'aria-checked': on ? 'true' : 'false', 'aria-label': label,
            style: 'cursor:pointer;padding:4px 10px;border-radius:10px;border:2px solid ' + (on ? '#f2b72b' : 'rgba(255,255,255,0.25)') + ';background:' + (on ? 'rgba(242,183,43,0.18)' : 'transparent') + ';color:inherit',
            onclick: () => { G.setManagerGender(g); render(); }
          }, prev, h('small', { text: label })));
        });
      };
      render();
      return wrap;
    }
    showLeaderboard(back) {
      const G = this.G;
      const fmt = (d) => { try { return new Date(d).toLocaleDateString('es-ES'); } catch (e) { return ''; } };
      const avatarOf = (e, cls) => this.recordAvatar(e, cls);
      const render = (lb, status) => {
        const slot = (i, cls) => {
          const e = lb[i];
          return h('div', { class: 'lb-pod ' + cls + (e ? '' : ' empty') },
            h('div', { class: 'lb-medal', text: ['🥇', '🥈', '🥉'][i] }),
            e ? avatarOf(e, 'lb-portrait') : h('div', { class: 'lb-ghost', text: '?' }),
            h('b', { class: 'lb-name', text: e ? e.name : '—' }),
            h('span', { class: 'lb-score', text: e ? String(e.score) : '' }),
            h('div', { class: 'lb-step', text: String(i + 1) }));
        };
        const rest = [];
        for (let i = 3; i < 10; i++) {
          const e = lb[i];
          rest.push(h('li', { class: e ? '' : 'empty' }, h('span', { class: 'lb-pos', text: String(i + 1) }), e ? avatarOf(e, 'lb-mini') : h('span', { class: 'lb-mini' }), h('span', { class: 'lb-n', text: e ? e.name : '—' }), h('span', { class: 'lb-d', text: e ? fmt(e.date) : '' }), h('b', { text: e ? String(e.score) : '' })));
        }
        const note = status === 'loading' ? 'Cargando la clasificación…' : status === 'error' ? 'Clasificación no disponible ahora mismo. Inténtalo más tarde.' : lb.length ? '' : 'Aún no hay puntuaciones. Termina un turno para entrar en la clasificación.';
        const body = h('div', { class: 'lb' },
          note ? h('p', { class: 'sub', text: note }) : '',
          h('div', { class: 'lb-podium' }, slot(1, 'p2'), slot(0, 'p1'), slot(2, 'p3')),
          h('ol', { class: 'lb-list', start: '4' }, ...rest));
        this.modal({ title: '🏆 Clasificación · TOP 10', body, closable: false, cls: 'wide', buttons: [{ label: 'Cerrar', primary: true, onClick: () => { if (back) back(); } }], onClose: null });
        return this.modalOpts;
      };
      let current = render(G.save.leaderboard, 'loading');
      G.save.refreshLeaderboard().then((lb) => {
        // Solo redibuja si el jugador sigue viendo esta misma pantalla.
        if (this.modalOpts === current) render(lb, G.save.boardError ? 'error' : 'ok');
      });
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
