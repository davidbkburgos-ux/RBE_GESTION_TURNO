(function () {
  const BK = window.BK;
  const U = BK.util;

  const CHANNEL_OF = { autoPay: 'autoking', delivery: 'delivery' };
  // Puestos vecinos por zona para la cobertura secundaria de los empleados base (orden = cercanía).
  const NEIGHBORS = {
    kitchen: ['fries', 'assembly', 'chef'], chef: ['kitchen', 'assembly'], fries: ['kitchen', 'assembly'], assembly: ['fries', 'kitchen', 'chef'],
    counter: ['delivery', 'autoking'], autoking: ['counter'], delivery: ['counter']
  };
  const WORK_ANIM = { grill: 'work', fryer: 'work', fries: 'work', assembly: 'work', expedition: 'deliver', counter: 'talk', autoPay: 'talk', delivery: 'deliver', hall: 'idle' }; // sala: limpia solo durante la tarea (AutonomySystem)
  const TASK_TXT = {
    grill: 'Preparando hamburguesas', fryer: 'Atendiendo fritos', fries: 'Preparando patatas', assembly: 'Montando y embolsando',
    expedition: 'Entregando pedidos', counter: 'Atendiendo mostrador', autoPay: 'Cobrando en ' + BK.autoName, delivery: 'Preparando delivery', hall: 'Limpiando sala'
  };

  // Empleados operativos (camiseta roja): comportamiento automático, reasignables por prioridad de canal.
  class EmployeeSystem {
    constructor(G) {
      this.G = G;
      Object.assign(TASK_TXT, G.cfg.operations.taskText || {});
      Object.assign(WORK_ANIM, G.cfg.operations.workAnim || {});
      this.init();
    }
    init(roster) {
      const G = this.G;
      this.list = [];
      this.busy = {};
      this.currentShift = 'meal';
      const st = G.cfg.operations.stations;
      const profile = G.dayProfile || G.cfg.difficultyProfiles[G.save.settings.difficulty] || G.cfg.difficultyProfiles[G.cfg.difficulty.default];
      const total = roster ? roster.length : profile.staff;
      const defaults = G.cfg.operations.positioningOrder || Object.keys(st).filter((k) => k !== 'support');
      for (let i = 0; i < total; i++) {
        const shift = i < profile.mealShift ? 'meal' : 'dinner';
        const roleIndex = shift === 'meal' ? i : i - profile.mealShift;
        const assignment = roster && roster[i] || { shift, position: defaults[roleIndex % defaults.length] };
        const k = st[assignment.position] ? assignment.position : defaults[i % defaults.length];
        const s = st[k];
        const onShift = assignment.shift === this.currentShift;
        const c = new BK.Character({
          id: 'EMP' + String(i + 1).padStart(2, '0'), kind: 'employee', pal: 'employee' + i, x: s.pos[0], y: s.pos[1], speed: G.cfg.npc.employeeSpeed,
          dir: BK.DIR.S, idleAnim: WORK_ANIM[k] || 'work', alpha: onShift ? 1 : 0
        });
        Object.assign(c, {
          displayId: 'Equipo ' + String(i + 1).padStart(2, '0'), station: k, position: k, targetPosition: null,
          role: s.label, category: s.category, channel: CHANNEL_OF[k] || (s.category === 'autoking' ? 'autoking' : s.category === 'delivery' ? 'delivery' : 'counter'),
          home: { x: s.pos[0], y: s.pos[1] }, homeDir: BK.DIR.S,
          mode: 'work', timer: U.rnd(2, 8), task: TASK_TXT[k] || s.label, occupancy: 0.3, override: null,
          shift: assignment.shift, available: onShift, absent: false, manualAssignment: true, status: onShift ? 'WORKING' : 'OFF_SHIFT', state: onShift ? 'Trabajando' : 'Fuera de turno'
        });
        c.animT = U.rnd(0, 3);
        this.list.push(c);
      }
    }
    // Refuerzo contratado durante el día: entra por el acceso de empleados y se queda hasta el cierre.
    hire(position, opt) {
      const G = this.G, spec = G.cfg.operations.stations[position];
      if (!spec) return null;
      const door = G.map.zones.find((z) => z.id === 'staffDoor').rect;
      const n = this.list.length + 1;
      const c = new BK.Character({
        id: 'EMP' + String(n).padStart(2, '0'), kind: 'employee', pal: 'employee' + n, x: (door[0] + door[2]) / 2, y: (door[1] + door[3]) / 2,
        speed: G.cfg.npc.employeeSpeed, dir: BK.DIR.E, idleAnim: 'idle', alpha: 1
      });
      Object.assign(c, {
        displayId: 'Equipo ' + String(n).padStart(2, '0'), station: position, position: null, targetPosition: null, role: spec.label, category: spec.category,
        channel: CHANNEL_OF[position] || (spec.category === 'autoking' ? 'autoking' : spec.category === 'delivery' ? 'delivery' : 'counter'),
        home: { x: spec.pos[0], y: spec.pos[1] }, homeDir: BK.DIR.S, mode: 'work', timer: U.rnd(2, 8), task: 'Se incorpora al turno', occupancy: 0.3, override: null,
        shift: 'all', available: true, absent: false, manualAssignment: true, status: 'WORKING', state: 'Se incorpora',
        expert: !!opt.expert, workSpeed: opt.speed || 1, hired: true
      });
      this.list.push(c);
      if (!this.assignPosition(c.id, position, false)) this.assignPosition(c.id, position, true);
      return c;
    }
    // Rendimiento medio de la plantilla de una categoría (expertos > 1) para escalar tiempos de producción.
    supportChannel(channel) {
      if (channel === 'hall' || channel === 'dining') return 'dining';
      if (channel === 'autoking' || channel === 'delivery') return channel;
      return 'counter';
    }
    managerSupportChannel() {
      const G = this.G, manager = G.manager;
      if (!manager || manager.status !== 'WORKING_POSITION' || !manager.coveringPosition) return null;
      const station = G.cfg.operations.stations[manager.coveringPosition];
      if (!station) return null;
      if (manager.coveringPosition === 'autoPay' || station.category === 'autoking') return 'autoking';
      if (station.category === 'delivery') return 'delivery';
      if (station.category === 'hall') return 'dining';
      return 'counter';
    }
    supportMultiplier(channel) {
      const supported = this.managerSupportChannel();
      return supported && this.supportChannel(channel) === supported ? 1.2 : 1;
    }
    briefingMultiplier() {
      const briefing = this.G.briefing;
      return briefing && briefing.completed ? 1 + briefing.speedBonus / 100 : 1;
    }
    workSpeedFor(employee, channel) {
      return (employee.workSpeed || 1) * this.briefingMultiplier() * this.supportMultiplier(channel || employee.category || employee.channel);
    }
    speedFactor(category, channel) {
      const w = this.list.filter((c) => c.available && !c.absent && c.status === 'WORKING' && (c.category === category || c.extraCategory === category));
      const base = w.length ? w.reduce((n, c) => n + (c.workSpeed || 1), 0) / w.length : 1;
      return base * this.briefingMultiplier() * this.supportMultiplier(channel);
    }
    configure(roster) {
      this.init(roster);
      this.list.forEach((c) => {
        if (c.available) this.assignPosition(c.id, c.position, true);
      });
    }
    get activeCount() { return this.list.filter((c) => c.available && !c.absent && c.status !== 'OFF_SHIFT').length; }
    capacity(category) {
      const staff = this.list.filter((c) => c.available && !c.absent && c.status === 'WORKING' && (c.category === category || c.extraCategory === category)).length;
      const manager = this.G.manager;
      const position = manager && this.G.cfg.operations.stations[manager.coveringPosition];
      return staff + (manager && manager.status === 'WORKING_POSITION' && position && position.category === category
        ? this.G.cfg.operations.managerCoverageCapacity || 1 : 0);
    }
    criticalCoverage() {
      return this.criticalCategories().map((category) => ({
        category, count: this.capacity(category)
      }));
    }
    criticalCategories() {
      const list = ['kitchen', 'fries', 'assembly', 'counter', 'autoking', 'delivery'];
      if (this.G.cfg.operations.stations.chef) list.splice(1, 0, 'chef');
      return list;
    }
    assignPosition(id, position, immediate) {
      const c = this.list.find((e) => e.id === id);
      const spec = this.G.cfg.operations.stations[position];
      if (!c || !spec || !c.available || c.absent) return false;
      if (this.G.autonomy) this.G.autonomy.cancelFor(c);
      c.override = null;
      const previous = c.position;
      const previousStatus = c.status;
      const previousCategory = c.category;
      c.position = null;
      c.targetPosition = position;
      c.status = immediate ? 'WORKING' : 'MOVING';
      c.mode = immediate ? 'work' : 'assigned';
      c.idleAnim = 'idle';
      c.task = 'En desplazamiento a ' + spec.label;
      c.category = immediate ? spec.category : c.category;
      c.channel = CHANNEL_OF[position] || (spec.category === 'autoking' ? 'autoking' : spec.category === 'delivery' ? 'delivery' : 'counter');
      const done = () => {
        c.position = position;
        c.targetPosition = null;
        c.category = spec.category;
        c.station = position;
        c.role = spec.label;
        c.home = { x: spec.pos[0], y: spec.pos[1] };
        c.homeDir = BK.DIR.S;
        c.x = spec.pos[0]; c.y = spec.pos[1];
        c.status = 'WORKING'; c.mode = 'work'; c.task = TASK_TXT[position] || spec.label;
        c.idleAnim = WORK_ANIM[position] || 'work';
        c.dir = c.homeDir;
        BK.bus.emit('employees:positioned', { employee: c, from: previous, to: position });
      };
      if (immediate) { c.x = spec.pos[0]; c.y = spec.pos[1]; done(); return true; }
      const route = this.G.nav.findPath('staff', c, { x: spec.pos[0], y: spec.pos[1] });
      if (!route.reachable) {
        c.status = previousStatus; c.targetPosition = null; c.position = previous; c.category = previousCategory;
        BK.bus.emit('employees:unreachable', { employee: c, position });
        return false;
      }
      c.setPath(route.path, done);
      BK.bus.emit('employees:reposition', { employee: c, from: previous, to: position });
      const coverage = this.capacity(spec.category);
      if (previous && this.G.cfg.operations.stations[previous] && coverage === 0) {
        BK.bus.emit('employees:critical', { category: spec.category, label: spec.label });
      }
      return true;
    }
    stationCoverage(id) { return this.list.filter((c) => c.available && !c.absent && c.status === 'WORKING' && c.position === id).length; }
    stationRecommended(id) { const i = this.G.cfg.operations.stationInfo[id]; return i ? i.recommended : 0; }
    uncoveredStations() {
      return Object.keys(this.G.cfg.operations.stationInfo).filter((id) => this.stationRecommended(id) > 0 && this.stationCoverage(id) + (this.list.filter((c) => c.available && c.targetPosition === id).length) === 0);
    }
    // Cambio de puesto iniciado por el jugador; el empleado camina y la cobertura cambia al llegar.
    moveEmployee(id, position) {
      const c = this.list.find((e) => e.id === id);
      if (!c || !c.available || c.position === position) return false;
      const from = c.position || c.targetPosition, G = this.G;
      const ok = this.assignPosition(id, position, false);
      if (ok) {
        const info = G.cfg.operations.stationInfo;
        BK.bus.emit('employees:moved', { employee: c, from, to: position, fromTag: info[from] && info[from].tag, toTag: info[position] && info[position].tag });
      }
      return ok;
    }
    activateShift(shift) {
      this.currentShift = shift;
      for (const c of this.list) {
        c.available = (c.shift === shift || c.shift === 'all') && !c.absent;
        c.alpha = c.available ? 1 : 0;
        if (c.available) {
          c.status = 'WORKING';
          if (c.position) this.assignPosition(c.id, c.position, true);
        } else c.status = c.absent ? 'ABSENT' : 'OFF_SHIFT';
      }
      BK.bus.emit('employees:shift', { shift, active: this.activeCount });
    }
    assignFor(ch) {
      const e = this.list.find((c) => c.channel === ch && !c.override) || this.list[0];
      return e ? e.id : null;
    }
    busyMult(ch) { const b = this.busy[ch]; return b && b > 0 ? this.G.cfg.director.busyPatience || 0.9 : 1; }
    setBusy(ch, sec) { this.busy[ch] = sec; BK.bus.emit('employees:busy', { channel: ch }); }

    walkTo(c, pt, cb) {
      const r = this.G.nav.findPath('staff', c, pt);
      if (!r.reachable) { if (cb) cb(); return false; }
      c.idleAnim = 'idle';
      c.setPath(r.path, cb);
      return true;
    }
    goHome(c) {
      if (c.status === 'MOVING' || c.targetPosition) return;
      c.mode = 'home';
      this.walkTo(c, c.home, () => { c.mode = 'work'; c.timer = U.rnd(4, 9); c.dir = c.homeDir; c.idleAnim = WORK_ANIM[c.station] || 'work'; });
    }
    applyPriority(ch) {
      const map = (ch && this.G.cfg.priority.reassign[ch]) || {};
      this.list.forEach((c) => {
        const t = map[c.station];
        if (t) {
          c.override = { x: t[0], y: t[1] };
          c.mode = 'moved';
          this.walkTo(c, c.override, () => { c.mode = 'support'; c.idleAnim = ch === 'autoking' ? 'talk' : 'deliver'; c.timer = 99; });
          c.task = 'Apoyando ' + this.G.ev.channels[ch].label;
        } else if (c.override) {
          c.override = null; c.task = TASK_TXT[c.station];
          this.goHome(c);
        }
      });
    }
    // Trabajo pendiente de una categoría: producción de su etapa + eventos de cliente de su canal.
    workFor(category) {
      const G = this.G, EV = { counter: ['counter', 'kiosk', 'pendingOrder'], autoking: ['vehicle'], delivery: ['delivery'] }[category];
      const evs = EV ? G.events.list.filter((e) => EV.includes(e.type) && (e.state === 'pending' || e.state === 'appearing')).length : 0;
      return G.production.pendingFor(category) + evs;
    }
    // Cobertura secundaria. El experto cubre cualquier puesto crítico; el empleado base solo el puesto más
    // cercano de su misma zona (cocina: parrilla, patatas/complementos, montaje; frente: mostrador, entregas,
    // Auto), y siempre que el suyo no tenga trabajo. Así nadie se queda parado mientras al lado hay cola.
    updateExperts(dt) {
      this.expertT = (this.expertT || 0) - dt;
      if (this.expertT > 0) return;
      this.expertT = 1;
      const G = this.G, info = G.cfg.operations.stationInfo, stations = G.cfg.operations.stations;
      const CRIT = this.criticalCategories();
      for (const c of this.list) {
        if (!c.available || c.absent || c.status !== 'WORKING' || !c.position || G.state !== 'playing' || c.autoJob || c.override) { c.extraCategory = null; c.extraPosition = null; continue; }
        const ownBusy = this.workFor(c.category) > 0 || G.events.byChannel(c.channel).length > 0;
        if (ownBusy) { c.extraCategory = null; c.extraPosition = null; continue; }
        // Mantiene la segunda posición mientras siga habiendo trabajo en ella; si no, elige la de más urgencia.
        const pool = c.expert ? CRIT : (NEIGHBORS[c.category] || []).filter((cat) => CRIT.includes(cat));
        let best = null, bestScore = 0;
        for (const cat of pool) {
          if (cat === c.category) continue;
          // un empleado base no se suma a una zona que ya tiene a otro ayudando
          if (!c.expert && this.list.some((o) => o !== c && o.extraCategory === cat && !o.expert)) continue;
          const pending = this.workFor(cat);
          const score = (this.capacity(cat) === 0 ? 2 : 0) + Math.min(3, pending) + (c.extraCategory === cat ? 0.5 : 0);
          if (pending > 0 && score > bestScore) { best = cat; bestScore = score; }
        }
        c.extraCategory = best;
        c.extraPosition = best ? Object.keys(stations).find((id) => stations[id].category === best && info[id] && info[id].recommended > 0) || null : null;
      }
    }
    update(dt) {
      const G = this.G;
      this.updateExperts(dt);
      Object.keys(this.busy).forEach((k) => { if (this.busy[k] > 0) this.busy[k] -= dt; });
      for (const c of this.list) {
        c.update(dt);
        if (!c.available || c.absent) { c.alpha = 0; c.status = c.absent ? 'ABSENT' : 'OFF_SHIFT'; c.state = c.absent ? 'Ausente' : 'Fuera de turno'; continue; }
        c.alpha = 1;
        if (c.status === 'BRIEFING') { c.state = 'En briefing'; continue; }
        if (c.status === 'TRUCK_DELIVERY') { c.state = 'Descargando camión Conway'; continue; }
        if (c.status === 'MOVING') {
          c.state = 'En desplazamiento'; c.occupancy = Math.max(0, c.occupancy - dt * 0.2);
          // Si la ruta terminó sin llegar al puesto, se reintenta y, si falla, se coloca directamente.
          if (!c.moving && c.targetPosition) {
            c.moveStall = (c.moveStall || 0) + dt;
            if (c.moveStall > 1.5) {
              const target = c.targetPosition;
              c.moveStall = 0; c.moveRetries = (c.moveRetries || 0) + 1;
              if (c.moveRetries > 2 || !this.assignPosition(c.id, target, false)) { c.moveRetries = 0; this.assignPosition(c.id, target, true); }
            }
          } else c.moveStall = 0;
          continue;
        }
        if (c.override) { c.state = c.mode === 'support' ? 'Apoyando' : 'En desplazamiento'; }
        else if (c.manualAssignment) {
          if (c.mode === 'there') {
            c.timer -= dt;
            if (c.timer <= 0) {
              c.mode = 'work'; c.timer = U.rnd(4, 9);
              c.idleAnim = WORK_ANIM[c.station] || 'work';
            }
          } else if (c.mode === 'work') {
            c.timer -= dt;
            if (c.timer <= 0) {
              const pts = c.category === 'hall' ? G.map.hallPatrol : (G.map.kitchenWander[c.station] || null);
              if (pts) {
                const p = U.pick(pts);
                c.mode = 'wander'; c.state = 'Desplazándose';
                this.walkTo(c, { x: p[0], y: p[1] }, () => {
                  c.idleAnim = c.category === 'hall' ? 'clean' : 'work';
                  c.mode = 'there'; c.timer = U.rnd(3, 7);
                });
              } else c.timer = U.rnd(4, 9);
            }
          }
          c.state = c.mode === 'there' ? 'En tarea' : 'Trabajando';
        }
        else if (c.mode === 'work') {
          c.state = 'Trabajando';
          c.timer -= dt;
          if (c.timer <= 0) {
            const pts = c.station === 'hall' ? G.map.hallPatrol : (G.map.kitchenWander[c.station] || null);
            if (pts) {
              const p = U.pick(pts);
              c.mode = 'wander'; c.state = 'Desplazándose';
              this.walkTo(c, { x: p[0], y: p[1] }, () => {
                c.idleAnim = c.station === 'hall' ? 'clean' : 'work';
                c.mode = 'there'; c.timer = U.rnd(3, 7);
              });
            } else c.timer = U.rnd(4, 9);
          }
        } else if (c.mode === 'there') {
          c.timer -= dt;
          if (c.timer <= 0) this.goHome(c);
        }
        const act = G.events.byChannel(c.channel).length;
        const target = (this.busy[c.channel] > 0 ? 0.95 : 0.25) + Math.min(0.55, act * 0.15) + Math.sin((performance.now() / 4000) + c.id.length + c.x) * 0.05;
        c.occupancy += (U.clamp(target, 0, 1) - c.occupancy) * Math.min(1, dt * 0.8);
      }
    }
  }
  BK.EmployeeSystem = EmployeeSystem;
})();
