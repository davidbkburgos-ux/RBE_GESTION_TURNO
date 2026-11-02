(function () {
  const BK = window.BK;
  const U = BK.util;
  const G = (BK.game = { state: 'boot', restaurantState: 'PRE_SHIFT', paused: false, uiPause: false, time: 0, debug: { logs: [] } });

  async function boot() {
    await BK.loadData();
    const d = BK.data;
    G.cfg = d.config; G.map = d.map; G.ev = d.events; G.openingData = d.opening; G.audioManifest = d.audioManifest;
    G.save = new BK.SaveSystem(G.cfg.meta.saveKey);
    if (G.save.settings.difficulty === 'easy' || G.save.settings.difficulty === 'normal') G.save.setSetting('difficulty', 'weekday');
    if (G.save.settings.difficulty === 'hard') G.save.setSetting('difficulty', 'weekend');
    BK.settings = G.save.settings;
    const S = G.save.settings;
    Object.defineProperty(G, 'difficulty', { get: () => G.cfg.difficulty.levels[G.save.settings.difficulty] || G.cfg.difficulty.levels[G.cfg.difficulty.default] });

    G.clock = new BK.GameClock(G.cfg);
    G.clock.setScale(S.timeScale || G.cfg.day.timeScale);
    G.nav = new BK.NavigationSystem(G.map);
    G.scoring = new BK.ScoringSystem(G);
    G.priority = new BK.ChannelPrioritySystem(G);
    G.employees = new BK.EmployeeSystem(G);
    G.staffing = new BK.StaffingSystem(G);
    G.production = new BK.ProductionSystem(G);
    G.prep = new BK.PreparationSystem(G);
    G.kpi = new BK.ServiceKpiSystem(G);
    G.events = new BK.EventSystem(G);
    G.questions = new BK.ZoneAwareQuestionGenerator(d.questions, G);
    G.opening = new BK.OpeningRoutineSystem(G);
    G.customers = new BK.CustomerSystem(G);
    G.vehicles = new BK.VehicleSystem(G);
    G.arrivals = new BK.ArrivalDirector(G);
    G.bottlenecks = new BK.BottleneckDetector(G);
    G.incidents = new BK.OperationalIncidentSystem(G);
    G.autonomy = new BK.AutonomySystem(G);
    G.director = new BK.EventDirector(G);
    G.manager = { coveringPosition: null, status: 'SUPERVISING' };
    G.player = new BK.PlayerController(G);
    G.interaction = new BK.InteractionSystem(G);
    G.lighting = new BK.LightingSystem(G);
    G.audio = new BK.AudioManager(G);
    G.renderer = new BK.Renderer(G, document.getElementById('game'));
    G.ui = new BK.UIManager(G);
    G.briefing = new BK.BriefingSystem(G);
    G.truckDelivery = new BK.TruckDeliverySystem(G);

    BK.bus.on('event:resolved', (e) => G.priority.onResult(e.ev, e.result));
    BK.bus.on('event:failed', (e) => G.priority.onResult(e.ev, 'failed'));
    BK.bus.on('opening:opened', (e) => {
      G.restaurantState = 'OPEN';
      BK.bus.emit('restaurant:opened', { time: G.clock.t, late: e.late });
    });
    BK.bus.on('clock:minute', (e) => {
      if (G.restaurantState === 'OPEN' && e.t >= G.clock.close - 60) G.restaurantState = 'CLOSING';
    });
    BK.bus.on('clock:end', () => {
      G.restaurantState = 'CLOSED';
      if (G.state === 'playing') G.endGame();
    });

    document.body.classList.toggle('reduce-motion', !!S.reduceMotion);
    const params = new URLSearchParams(location.search);
    G.renderer.debug = params.has('debug');
    G.debugSimulation = params.has('debugSimulation')
      ? params.get('debugSimulation') === 'true'
      : G.cfg.debugSimulation === true;
    G.debug.log = (kind, detail) => {
      if (!G.debugSimulation) return;
      G.debug.logs.push('[' + G.clock.label + '] ' + kind + (detail ? ' ' + detail : ''));
      if (G.debug.logs.length > 100) G.debug.logs.shift();
    };
    G.debug.startTruckDelivery = () => G.truckDelivery.forceStart();
    const eventNames = {
      counter: 'COUNTER_CUSTOMER', kiosk: 'KIOSK_HELP', dirtyTable: 'DIRTY_TABLE',
      vehicle: 'DRIVE_THRU_PICKUP', delivery: 'DELIVERY_PICKUP', productShortage: 'PRODUCT_SHORTAGE',
      complaint: 'CUSTOMER_COMPLAINT', pendingOrder: 'PENDING_ORDER', restroom: 'RESTROOM_CLEANING'
    };
    BK.bus.on('arrival:created', ({ channel }) => {
      const logKind = channel === 'autoking' ? 'VehicleSpawn' : channel === 'delivery' ? 'RiderSpawn' : 'CustomerSpawn';
      const logName = channel === 'autoking' ? 'DRIVE_THRU' : channel.toUpperCase();
      G.debug.log(logKind, logName);
    });
    BK.bus.on('event:scheduled', (ev) => G.debug.log('EventCreated', eventNames[ev.type] || ev.type.toUpperCase()));
    BK.bus.on('ambient:activity', ({ type, channel }) => {
      if (['CUSTOMER_ENTER', 'CUSTOMER_ORDER', 'CUSTOMER_ORDER_READY', 'CUSTOMER_SIT', 'CUSTOMER_LEAVE', 'VEHICLE_ENTER', 'VEHICLE_QUEUE', 'VEHICLE_EXIT', 'RIDER_ENTER', 'RIDER_EXIT', 'TABLE_DIRTY'].includes(type)) {
        G.debug.log(type, channel ? channel.toUpperCase() : '');
      }
    });
    const coarse = window.matchMedia && matchMedia('(pointer: coarse)').matches;
    const follow = S.follow === null ? coarse && window.innerWidth < 1000 : S.follow;
    G.renderer.setFollow(follow);

    G.renderer.bindInput(onTap);
    bindKeys();
    window.addEventListener('resize', () => G.renderer.resize());
    if (window.ResizeObserver) new ResizeObserver(() => G.renderer.resize()).observe(document.getElementById('stage'));
    document.addEventListener('pointerdown', () => G.audio.unlock(), { once: true });
    document.addEventListener('visibilitychange', () => { if (document.hidden && G.state === 'playing') G.setPaused(true); });

    G.state = 'menu';
    G.ui.showStart();
    last = performance.now();
    requestAnimationFrame(frame);
    document.body.classList.add('ready');
  }

  // ---------- control de partida ----------
  G.resetWorld = function () {
    G.restaurantState = 'PREPARATION';
    G.clock.set(G.clock.start);
    G.scoring.reset(); G.priority.reset(); G.events.clear(); G.customers.clear(); G.vehicles.clear();
    G.director.reset(); G.opening.reset(); G.employees.configure(G.roster); G.staffing.reset(); G.production.reset(); G.prep.reset(); G.kpi.reset();
    G.arrivals.reset(G.seed); G.bottlenecks.reset(); G.incidents.reset(); G.autonomy.reset(); G.manager.coveringPosition = null; G.manager.status = 'SUPERVISING'; G.audio.apply();
    G.briefing.reset(); G.truckDelivery.reset();
    G.player.reset(330, 520);
    G.ui.clearTransient(); G.ui.closeModal();
    G.time = 0; G.paused = false; G.uiPause = false; G.saveT = 0;
    G.renderer.cam.x = 768; G.renderer.cam.y = 512;
  };
  G.newGame = function (roster, seed) {
    if (roster) G.roster = roster.map((r) => ({ shift: r.shift, position: r.position }));
    G.seed = seed || (Date.now() >>> 0);
    G.applyDayProfile(G.seed);
    G.resetWorld();
    G.ui.hideTitleLogo();
    G.state = 'playing';
    G.restaurantState = 'PREPARATION';
    G.save.clearRun();
    if (!G.noTutorial) G.ui.startTutorial();
    else G.ui.toast('Completa las revisiones y abre la puerta antes de las 12:00.', 'info', 4500);
  };
  G.applyDayProfile = function (seed) {
    G.dayProfile = BK.ArrivalDirector.dayProfile(G.cfg, G.save.settings.difficulty, seed);
    return G.dayProfile;
  };
  G.resumeGame = function (run) {
    if (run.seed) { G.seed = run.seed; G.applyDayProfile(run.seed); }
    G.resetWorld();
    G.ui.hideTitleLogo();
    G.clock.set(run.t); G.time = run.time || 0;
    G.scoring.restore(run.scoring); G.opening.restore(run.opening);
    G.briefing.restore(run.briefing);
    if (G.opening.isOpen) {
      G.restaurantState = G.clock.t >= G.clock.close - 60 ? 'CLOSING' : 'OPEN';
      BK.bus.emit('restaurant:opened', { time: G.clock.t, late: G.opening.lateMinutes, resumed: true });
    } else G.restaurantState = G.opening.checksDone ? 'PREPARATION' : 'OPENING_CHECKS';
    G.director.spawned = run.spawned || 0;
    if (run.production) G.production.restore(run.production);
    G.prep.restore(run.prep); G.kpi.restore(run.kpi);
    if (run.incidents) G.incidents.restore(run.incidents);
    if (run.roster) { G.roster = run.roster; G.employees.configure(G.roster); }
    G.staffing.reset(); if (run.staffing) G.staffing.restore(run.staffing);
    if (run.pos) G.player.reset(run.pos.x, run.pos.y);
    G.state = 'playing';
    G.truckDelivery.restore(run.truckDelivery);
    G.ui.toast('Turno recuperado.', 'info', 2500);
  };
  G.toMenu = function () { G.state = 'menu'; G.resetWorld(); G.ui.showStart(); };
  G.closures = [];
  // Cierre voluntario del local: detiene y vacía todo el estado del turno sin recargar la página.
  G.endCurrentDay = function (opts) {
    const o = Object.assign({ reason: 'MANUAL_STORE_CLOSURE', saveResult: false }, opts || {});
    if (o.saveResult) { G.endGame(); return; }
    G.state = 'menu'; G.paused = false; G.uiPause = false;          // detiene reloj y todos los directores (step solo avanza en 'playing')
    G.ui.tutorialStep = 0;
    G.audio.silenceContextual();
    G.save.clearRun();                                              // sin guardar resultado ni reanudación
    G.resetWorld();                                                 // eventos, colas, NPC, vehículos, riders, producción, dotación, posiciones, KPI, score
    G.roster = null;
    G.closures.push({ reason: o.reason, at: Date.now() });
    G.ui.showStart();
    BK.bus.emit('day:closed', { reason: o.reason });
  };
  // Instantánea de objetos vivos para comprobar que un reinicio no deja restos.
  G.liveSnapshot = function () {
    return {
      listeners: Object.values(BK.bus.h).reduce((n, a) => n + a.length, 0),
      guests: G.customers.guests.length, cars: G.vehicles.cars.length, events: G.events.list.length,
      orders: G.production.orders.length, bubbles: G.ui.bubbles.length, toasts: G.ui.el.toasts.children.length,
      modals: G.ui.el.modalRoot.children.length, jobs: G.autonomy.jobs.length,
      queued: G.customers.guests.filter((g) => g.path && g.path.length).length
    };
  };
  G.endGame = function () {
    G.state = 'ended';
    G.events.dismissAll();
    G.production.settleWaste();
    const sc = G.scoring, best = G.save.state.best;
    const res = { score: sc.score, m: JSON.parse(JSON.stringify(sc.m)), newBest: best === null || sc.score > best };
    G.save.finish({ score: sc.score, excellent: sc.m.excellent, acceptable: sc.m.acceptable, failed: sc.m.failed, lateMin: sc.m.lateMin, bestStreak: sc.m.bestStreak, difficulty: G.save.settings.difficulty });
    G.audio.play('hour');
    G.ui.showSummary(res);
  };
  G.setPaused = function (p) {
    if (G.state !== 'playing') return;
    G.paused = p;
    if (p) G.ui.showPause(); else if (G.ui.modalOpen) G.ui.closeModal();
  };
  G.togglePause = function () { G.setPaused(!G.paused); };
  G.toggleMute = function () { G.audio.unlock(); G.audio.setMuted(!G.audio.muted); G.ui.caption(G.audio.muted ? 'Sonido silenciado (los avisos se muestran en pantalla)' : 'Sonido activado'); };
  G.setReduceMotion = function (v) { G.save.setSetting('reduceMotion', v); document.body.classList.toggle('reduce-motion', v); if (v) G.renderer.cam.zoom = G.renderer.zoomTarget; };
  G.setFollow = function (v) { G.renderer.setFollow(v); G.save.setSetting('follow', v); };
  G.setManagerGender = function (g) {
    g = g === 'f' ? 'f' : 'm';
    G.save.setSetting('managerGender', g);
    if (G.player && G.player.char) G.player.char.pal = g === 'f' ? 'managerF' : 'manager';
  };
  G.setDifficulty = function (k) {
    if (!G.cfg.difficultyProfiles[k]) throw new Error('Dificultad no configurada: ' + k);
    G.save.setSetting('difficulty', k);
  };
  G.setTimeScale = function (v) { G.clock.setScale(v); G.save.setSetting('timeScale', v); };

  // ---------- entrada ----------
  function onTap(sx, sy) {
    if (G.state !== 'playing' || G.paused || (G.uiPause && !G.ui.tutorialStep)) return;
    G.audio.unlock();
    const R = G.renderer;
    const station = R.stationAt(sx, sy);
    if (station) { G.ui.reassign.close(); G.player.coverPosition(station.id); return; }
    for (const h of R.hits.slice().reverse()) {
      if (Math.hypot(h.x - sx, h.y - sy) <= h.r) { G.ui.reassign.close(); G.player.attend(h.ev); return; }
    }
    const tag = R.tagAt(sx, sy);
    if (tag) { G.ui.reassign.open(tag.emp); return; }
    if (G.ui.reassign.isOpen) { G.ui.reassign.close(); return; }
    const w = R.toWorld(sx, sy);
    const box = G.truckDelivery.boxAt(w.x, w.y);
    if (box) { G.truckDelivery.managerCarry(box); return; }
    for (const b of R.badges) {
      if (Math.hypot(b.x - sx, b.y - sy) <= b.r) { G.interaction.activate(b.it); return; }
    }
    const npc = G.customers.guests.find((g) => !g.dead && Math.abs(g.x - w.x) < 16 && w.y > g.y - 56 && w.y < g.y + 8);
    if (npc) {
      const live = npc.ev && G.events.isLive(npc.ev);
      if (live) { G.player.attend(npc.ev); return; }
      const lbl = BK.CUSTOMER_STATE_LABEL[G.customers.stateOf(npc)];
      if (lbl) { G.ui.toast(lbl, 'info', 1500); return; }
    }
    const tbl = G.customers.tableAt(w.x, w.y, 18);
    if (tbl) { G.customers.attendTable(tbl); return; }
    const it = G.interaction.hit(w.x, w.y, R.scale);
    if (it) { G.interaction.activate(it); return; }
    const fs = R.freeStationAt(w.x, w.y);
    if (fs) { G.player.coverPosition(fs.id); return; }
    const pp = G.map.points.productPrep;
    if (pp && Math.abs(pp[0] - w.x) <= 26 && Math.abs(pp[1] - w.y) <= 20) { G.player.goPrep(); return; }
    G.player.moveTo(w.x, w.y);
  }
  function bindKeys() {
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const tag = (e.target && e.target.tagName) || '';
      const k = e.key;
      if (k === 'Escape') { if (G.ui.escape()) e.preventDefault(); return; }
      if (k === 'Tab') {
        if (tag === 'INPUT' || tag === 'SELECT') return;
        if (G.state === 'playing' && !G.ui.modalOpen) { G.ui.toggleOperations(); e.preventDefault(); }
        return;
      }
      if (tag === 'INPUT' || tag === 'SELECT') return;
      if (G.state !== 'playing') return;
      if (k === 'p' || k === 'P') { G.togglePause(); e.preventDefault(); return; }
      if (k === 'm' || k === 'M') { G.toggleMute(); return; }
      if (G.paused || G.ui.modalOpen) return;
      if (['1', '2', '3'].includes(k)) {
        const i = parseInt(k, 10) - 1;
        if (G.ui.q && G.ui.q.options && !G.ui.q.el.querySelector('.fb')) { G.ui.q.answer(i); e.preventDefault(); }
        else if (G.ui.prioEl) { const ch = Object.keys(G.ev.channels)[i]; G.priority.choose(ch); e.preventDefault(); }
        return;
      }
      if (k === 'e' || k === 'E') { G.audio.unlock(); if (!G.interaction.attendMostUrgent()) G.ui.toast('No hay eventos pendientes.', 'info', 1400); return; }
      if (k === '+' || k === '=') { G.renderer.zoomBy(1.25); return; }
      if (k === '-' || k === '_') { G.renderer.zoomBy(0.8); return; }
      if (k === 'g' || k === 'G') { if (new URLSearchParams(location.search).has('debug')) G.renderer.debug = !G.renderer.debug; return; }
      const dirs = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0], w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0] };
      const dv = dirs[k] || dirs[(k || '').toLowerCase()];
      if (dv && tag !== 'BUTTON') {
        const p = G.player.char;
        G.audio.unlock();
        G.player.moveTo(p.x + dv[0] * 80, p.y + dv[1] * 80);
        e.preventDefault();
      }
    });
  }

  // ---------- bucle ----------
  let last = 0;
  function step(dt) {
    if (G.state === 'playing' && !G.paused && !G.uiPause) {
      G.time += dt;
      G.clock.update(dt);
      if (G.state !== 'playing') return;
      G.events.update(dt);
      G.priority.update(dt);
      G.employees.update(dt);
      G.customers.update(dt);
      G.vehicles.update(dt);
      G.autonomy.update(dt);
      G.arrivals.update(dt);
      G.production.update(dt);
      G.prep.update(dt);
      G.briefing.update(dt);
      G.truckDelivery.update(dt);
      G.bottlenecks.update();
      G.incidents.update(dt);
      G.director.update(dt);
      G.player.update(dt);
      if (G.player.char.moving) G.audio.step(G.time);
      G.saveT += dt;
      if (G.saveT > 5) {
        G.saveT = 0;
        G.save.saveRun({ t: G.clock.t, time: G.time, scoring: G.scoring.snapshot(), opening: G.opening.snapshot(), briefing: G.briefing.snapshot(), truckDelivery: G.truckDelivery.snapshot(), spawned: G.director.spawned, pos: { x: G.player.char.x, y: G.player.char.y }, production: G.production.snapshot(), prep: G.prep.snapshot(), kpi: G.kpi.snapshot(), incidents: G.incidents.snapshot(), staffing: G.staffing.snapshot(), roster: G.roster, seed: G.seed });
      }
    } else if (G.state === 'playing' && G.ui.tutorialStep && !G.paused && !G.ui.modalOpen) {
      G.player.update(dt);
      if (G.player.char.moving) G.audio.step(G.time);
    } else if (G.state === 'menu') {
      G.employees.update(dt);
    }
  }
  G.debug.deterministicSimulationTest = function () {
    if (!G.debugSimulation) throw new Error('El test requiere el modo debugSimulation.');
    if (G.state === 'playing') throw new Error('Ejecuta el test desde el menú para no interrumpir una partida.');
    const originalDifficulty = G.save.settings.difficulty;
    const originalRandom = Math.random;
    const difficulties = ['weekday', 'weekend', 'specialHoliday'];
    const results = [];
    try {
      for (let index = 0; index < difficulties.length; index++) {
        let rng = (0xBEEF + index * 0x9E3779B9) >>> 0;
        Math.random = () => {
          rng = (1664525 * rng + 1013904223) >>> 0;
          return rng / 4294967296;
        };
        G.save.setSetting('difficulty', difficulties[index]);
        G.roster = null;
        G.seed = 0xBEEF + index;
        G.resetWorld();
        G.state = 'playing';
        const scheduled = {};
        const arrivals = {};
        const offEvent = BK.bus.on('event:scheduled', (ev) => { scheduled[ev.type] = (scheduled[ev.type] || 0) + 1; });
        const offArrival = BK.bus.on('arrival:created', (a) => { arrivals[a.channel] = (arrivals[a.channel] || 0) + 1; });
        try {
          G.clock.set(G.clock.open);
          G.opening.tasks.forEach((task) => { task.done = true; task.correct = true; });
          G.opening.openDoor();
          for (let i = 0; i < 500; i++) step(0.1);
        } finally {
          offEvent();
          offArrival();
        }
        const channelTotals = G.arrivals.arrivals;
        const totalArrivals = Object.values(channelTotals).reduce((sum, count) => sum + count, 0);
        const activeChannels = Object.values(channelTotals).filter((count) => count > 0).length;
        const result = {
          difficulty: difficulties[index], from: '12:00', to: '13:00', arrivals: { ...channelTotals },
          scheduled, totalArrivals, activeChannels, eventDirectorState: G.director.state, playerEvents: G.director.spawned,
          cars: channelTotals.autoking || 0, riders: channelTotals.delivery || 0,
          customers: (channelTotals.counter || 0) + (channelTotals.kiosk || 0),
          dirtyTables: scheduled.dirtyTable || 0
        };
        if (totalArrivals === 0 || activeChannels === 0 || result.playerEvents === 0) {
          throw new Error('Fallo de simulación ' + difficulties[index] + ': ' + JSON.stringify(result));
        }
        results.push(result);
      }
    } finally {
      Math.random = originalRandom;
      G.save.setSetting('difficulty', originalDifficulty);
      G.state = 'menu';
      G.restaurantState = 'PRE_SHIFT';
      G.resetWorld();
      G.state = 'menu';
      G.ui.showStart();
    }
    return results;
  };
  G.debug.restartLeakTest = function (cycles) {
    if (!G.debugSimulation) throw new Error('El test requiere el modo debugSimulation.');
    if (G.state === 'playing') throw new Error('Ejecuta el test desde el menú.');
    const n = cycles || 6,     rows = [], tut = G.noTutorial;
        G.noTutorial = true;
    G.toMenu();
    const baseline = G.liveSnapshot();
    for (let i = 0; i < n; i++) {
      G.newGame(null, 0x1000 + i);
      G.opening.tasks.forEach((t) => { t.done = true; t.correct = true; });
      G.clock.set(G.clock.open); G.opening.openDoor();
      for (let k = 0; k < 600; k++) step(0.1);
      const during = G.liveSnapshot();
      G.endCurrentDay({ reason: 'MANUAL_STORE_CLOSURE', saveResult: false });
      const after = G.liveSnapshot();
      rows.push({ cycle: i + 1, during, after, clean: JSON.stringify(after) === JSON.stringify(baseline) && G.state === 'menu' && G.clock.t === G.clock.start && G.scoring.score === 0 });
    }
    G.noTutorial = tut;
    return { baseline, rows, ok: rows.every((r) => r.clean) };
  };
  function frame(ts) {
    const dt = Math.min(0.1, (ts - last) / 1000);
    last = ts;
    try {
      step(dt);
      G.renderer.update(dt);
      G.renderer.draw();
      G.audio.update(dt);
      G.ui.update(dt);
    } catch (err) { console.error(err); }
    requestAnimationFrame(frame);
  }

  // ---------- utilidades de prueba (consola) ----------
  G.debug.step = step;
  G.debug.skipTo = (hm) => { const t = U.parseHM(hm, G.clock.start); G.clock.set(t); };
  G.debug.spawn = (type) => {
    if (!G.debugSimulation) throw new Error('Los spawns de depuración requieren ?debugSimulation=true y debugSimulation habilitado en config.');
    return G.customers.spawnEvent(type, true);
  };
  G.debug.completeChecks = () => { G.opening.tasks.filter((t) => t.questionPool).forEach((t) => { t.done = true; t.correct = true; }); };
  G.debug.teleport = (x, y) => G.player.reset(x, y);
  G.debug.absence = () => G.incidents.forceAbsence(G.employees.list.find((e) => e.available && !e.absent && !e.hired));
  // Fija la cámara en una mesa (sucia si no hay) para capturas.
  G.debug.focusTable = () => {
    let t = G.customers.tables.find((x) => x.state === 'dirty');
    if (!t) { t = G.customers.tables[0]; t.state = 'dirty'; }
    G.renderer.setFollow(false);
    G.renderer.cam.x = (t.top[0] + t.top[2]) / 2; G.renderer.cam.y = (t.top[1] + t.top[3]) / 2;
    G.renderer.scale = Math.max(G.renderer.scale, 1.4);
    return t;
  };
  // Jugador automático: atiende el evento vivo más urgente y limpia mesas. Devuelve un resumen.
  G.debug.autoplay = (seed) => {
    G.noTutorial = true; G.toMenu(); G.newGame(null, seed || 3);
    G.opening.tasks.forEach((t) => { t.done = true; t.correct = true; });
    G.clock.set(G.clock.open); G.opening.openDoor(); step(0.1);
    let guard = 0;
    while (!G.clock.ended && guard++ < 200000) {
      step(0.5);
      if (G.ui.priorityOpen) G.priority.choose(Object.keys(G.ev.channels)[0]);
      if (G.ui.q) { const o = G.ui.q.el && G.ui.q.el.querySelector('.opt'); if (o) o.click(); }
      if (G.player.busy || G.player.pending) continue;
      const live = G.events.active().filter((e) => G.events.isLive(e)).sort((a, b) => (a.expiresAt || 1e9) - (b.expiresAt || 1e9))[0];
      if (live) { G.player.attend(live); continue; }
      if (G.production.needsPrep() && G.clock.t >= 700) G.player.goPrep();
    }
    return { score: G.scoring.score, abandoned: G.scoring.m.abandoned, tablesCleaned: G.scoring.m.tablesCleaned, state: G.state };
  };

  boot().catch((err) => {
    console.error(err);
    const d = document.createElement('pre'); d.style.cssText = 'color:#fff;background:#900;padding:12px;margin:0;position:fixed;inset:0;z-index:99;overflow:auto';
    d.textContent = 'Error al iniciar: ' + err.message + '\n' + (err.stack || '');
    document.body.appendChild(d);
  });
})();
