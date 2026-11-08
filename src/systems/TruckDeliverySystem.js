(function () {
  const BK = window.BK;
  const U = BK.util;
  const BK_BOX_POSITIONS = [
    { x: 118, y: 506 }, { x: 142, y: 506 },
    { x: 118, y: 530 }, { x: 142, y: 530 },
    { x: 118, y: 554 }, { x: 142, y: 554 }
  ];

  class TruckDeliverySystem {
    constructor(G) {
      this.G = G;
      const S = G.map.spots || {};
      this.boxPositions = S.boxes || BK_BOX_POSITIONS;
      this.cam = S.truckCam || { x: 300, y: 560 };
      this.lane = new BK.Lane(G.map.vehicleLane.path);
      // Parada del camión de proveedor frente a la puerta trasera/de servicio (stops.truck); sin ella, el punto de pedido
      const stop = G.map.vehicleLane.stops.truck || G.map.vehicleLane.stops.order;
      this.stopS = this.lane.project(stop.x, stop.y);
      this.dropPoint = { x: G.map.points.productPrep[0], y: G.map.points.productPrep[1] };
      this.reset();
    }

    reset() {
      if (this.cameraRestore) this.restoreCamera();
      const start = this.G.clock.start, end = Math.min(start + 60, this.G.clock.open);
      this.selected = Math.random() < 0.5;
      this.triggerAt = start + Math.floor(Math.random() * Math.max(1, end - start - 7));
      this.state = this.selected ? 'scheduled' : 'skipped';
      this.s = 0;
      this.truck = null;
      this.boxes = [];
      this.expectedCount = null;
      this.assignedEmployee = null;
      this.employeePrevious = null;
      this.managerCarrying = false;
      this.outcome = null;
      this.cameraRestore = null;
      this.deferred = false;
    }

    get active() { return ['arriving', 'awaiting-assignment', 'unloading', 'decision', 'leaving'].includes(this.state); }
    get transferredCount() { return this.boxes.filter((box) => box.status === 'delivered').length; }
    get availableEmployees() {
      return this.G.employees.list.filter((employee) =>
        employee.available && !employee.absent && employee.status === 'WORKING' &&
        employee.position && !employee.override && !employee.moving &&
        ['work', 'there'].includes(employee.mode)
      );
    }

    update(dt) {
      const G = this.G;
      if (G.state !== 'playing') return;
      if (this.state === 'scheduled') {
        const end = Math.min(G.clock.start + 60, G.clock.open);
        const cur = G.opening && G.opening.current;
        const briefing = (G.briefing && G.briefing.active) || !!(cur && cur.task && cur.task.minigame);
        // El camión espera a que termine el briefing o el minijuego en curso para no solapar avisos
        if (briefing && (this.deferred || G.clock.t >= this.triggerAt)) { this.deferred = true; return; }
        if (this.deferred) { this.deferred = false; this.startArrival(); return; }
        if (G.clock.t >= this.triggerAt && G.clock.t < end) this.startArrival();
        else if (G.clock.t >= end) this.state = 'skipped';
        return;
      }
      if (this.state === 'arriving') {
        this.s = Math.min(this.stopS, this.s + 230 * dt);
        this.positionTruck();
        if (this.s >= this.stopS) this.arrive();
      } else if (this.state === 'leaving') {
        this.s = Math.min(this.stopS + 260, this.s + 230 * dt);
        this.positionTruck();
        if (this.s >= this.stopS + 260) {
          this.state = 'done';
          this.restoreCamera();
        }
      }
    }

    startArrival() {
      if (!['scheduled', 'skipped'].includes(this.state)) return false;
      this.selected = true;
      this.state = 'arriving';
      this.s = 0;
      this.positionTruck();
      BK.bus.emit('truck:arriving', {});
      return true;
    }

    forceStart() {
      const G = this.G, start = G.clock.start, end = Math.min(start + 60, G.clock.open);
      if (G.clock.t < start || G.clock.t >= end) {
        G.ui.toast('La descarga de Conway solo puede probarse entre las 09:00 y las 10:00.', 'warn', 3200);
        return false;
      }
      if (!this.startArrival()) {
        G.ui.toast('La descarga ya ha comenzado o este turno ya la completó.', 'info', 2600);
        return false;
      }
      return true;
    }

    positionTruck() {
      const p = this.lane.at(this.s);
      this.truck = { x: p.x, y: p.y, angle: p.ang };
    }

    arrive() {
      this.state = 'awaiting-assignment';
      const actual = U.rndi(4, 6);
      this.expectedCount = Math.random() < 0.25
        ? actual + U.pick([-1, 1])
        : actual;
      this.boxes = this.boxPositions.slice(0, actual).map((position, index) => ({
        id: 'CONWAY-' + (index + 1), x: position.x, y: position.y, status: 'waiting', holder: null
      }));
      this.focusCamera();
      BK.bus.emit('truck:ready', { boxes: actual, expected: this.expectedCount });
    }

    focusCamera() {
      const renderer = this.G.renderer;
      if (!this.cameraRestore) this.cameraRestore = {
        x: renderer.cam.x, y: renderer.cam.y, zoom: renderer.cam.zoom, zoomTarget: renderer.zoomTarget, follow: renderer.follow,
        tasksCollapsed: this.G.ui.el.tasksPanel.classList.contains('collapsed')
      };
      renderer.follow = false;
      renderer.zoomTarget = 2.5; renderer.cam.zoom = 2.5;
      renderer.cam.x = this.cam.x; renderer.cam.y = this.cam.y;
      renderer.clampCam();
      this.G.ui.el.tasksPanel.classList.add('collapsed');
      this.G.ui.el.bTasks.setAttribute('aria-expanded', 'false');
    }

    restoreCamera() {
      if (!this.cameraRestore) return;
      const renderer = this.G.renderer, previous = this.cameraRestore;
      renderer.cam.x = previous.x; renderer.cam.y = previous.y;
      renderer.cam.zoom = previous.zoom; renderer.zoomTarget = previous.zoomTarget;
      renderer.follow = previous.follow;
      renderer.clampCam();
      renderer.G.ui.el.tasksPanel.classList.toggle('collapsed', previous.tasksCollapsed);
      renderer.G.ui.el.bTasks.setAttribute('aria-expanded', String(!previous.tasksCollapsed));
      this.cameraRestore = null;
    }

    assignEmployee(id) {
      if (this.state !== 'awaiting-assignment') return false;
      const employee = this.availableEmployees.find((candidate) => candidate.id === id);
      if (!employee) {
        this.G.ui.toast('Ese empleado ya no está disponible para la descarga.', 'warn', 2600);
        return false;
      }
      this.assignedEmployee = employee;
      this.employeePrevious = {
        mode: employee.mode, task: employee.task, idleAnim: employee.idleAnim, dir: employee.dir, timer: employee.timer
      };
      employee.stop();
      employee.status = 'TRUCK_DELIVERY';
      employee.mode = 'truck';
      employee.task = 'Descargando camión Conway';
      employee.idleAnim = 'idle';
      this.state = 'unloading';
      this.employeeCarryNext(employee);
      return true;
    }

    assignManager() {
      if (this.state !== 'awaiting-assignment') return false;
      this.state = 'unloading';
      return true;
    }

    boxAt(x, y) {
      if (this.state !== 'unloading') return null;
      return this.boxes.find((box) => box.status === 'waiting' && Math.abs(box.x - x) <= 17 && Math.abs(box.y - y) <= 17) || null;
    }

    carriedBy(character) {
      return this.boxes.find((box) => box.status === 'carried' &&
        (box.holder === 'manager' ? character === this.G.player.char : box.holder === character)) || null;
    }

    managerCarry(box) {
      const G = this.G, player = G.player;
      if (!box || box.status !== 'waiting' || this.state !== 'unloading') return false;
      if (player.busy || this.managerCarrying) {
        BK.bus.emit('player:busy', {});
        return false;
      }
      player.leaveCover();
      player.clearPending();
      player.locked = true;
      this.managerCarrying = true;
      box.status = 'reserved';
      box.holder = 'manager';
      const fail = () => {
        box.status = 'waiting'; box.holder = null;
        this.managerCarrying = false; player.locked = false; player.pending = null;
        player.marker = null;
        G.ui.toast('No se puede acceder a la caja desde aquí.', 'warn', 2200);
      };
      const pickUp = () => {
        player.pending = null; player.marker = null;
        box.status = 'carried';
        player.char.faceTo(this.dropPoint);
        player.char.playAction('deliver', 0.35, () => {
          if (!player.walkThen(this.dropPoint, () => {
            player.pending = null; player.marker = null;
            player.char.playAction('deliver', 0.55, () => {
              this.completeBox(box);
              this.managerCarrying = false;
              player.locked = false;
              player.char.idleAnim = 'idle';
            });
          })) fail();
        });
      };
      if (!G.nav.findPath('staff', player.char, box).reachable || !G.nav.findPath('staff', box, this.dropPoint).reachable) {
        fail();
      } else if (!player.walkThen(box, pickUp)) fail();
      return true;
    }

    employeeCarryNext(employee) {
      if (this.state !== 'unloading' || employee !== this.assignedEmployee) return;
      const box = this.boxes.find((candidate) => candidate.status === 'waiting');
      if (!box) {
        this.returnEmployee(employee);
        return;
      }
      box.status = 'reserved';
      box.holder = employee;
      const to = (point, callback) => {
        const route = this.G.nav.findPath('staff', employee, point);
        if (!route.reachable) {
          box.status = 'waiting'; box.holder = null;
          this.G.ui.toast('No se puede completar la ruta de descarga de Conway.', 'warn', 3200);
          this.returnEmployee(employee);
          return false;
        }
        employee.setPath(route.path, callback);
        return true;
      };
      to(box, () => {
        if (this.state !== 'unloading') return;
        box.status = 'carried';
        employee.faceTo(this.dropPoint);
        employee.playAction('deliver', 0.35, () => {
          to(this.dropPoint, () => employee.playAction('deliver', 0.55, () => {
            this.completeBox(box);
            this.employeeCarryNext(employee);
          }));
        });
      });
    }

    returnEmployee(employee) {
      if (!employee || employee !== this.assignedEmployee) return;
      const previous = this.employeePrevious || {};
      const home = employee.home || { x: employee.x, y: employee.y };
      const route = this.G.nav.findPath('staff', employee, home);
      const restore = () => {
        employee.status = 'WORKING';
        employee.position = employee.position || employee.station;
        employee.targetPosition = null;
        employee.mode = previous.mode === 'there' ? 'there' : 'work';
        employee.task = previous.task;
        employee.idleAnim = previous.idleAnim;
        employee.dir = employee.homeDir !== undefined ? employee.homeDir : previous.dir;
        employee.timer = previous.timer > 0 ? previous.timer : 3;
        this.assignedEmployee = null;
        this.employeePrevious = null;
      };
      if (route.reachable) employee.setPath(route.path, restore);
      else {
        this.G.ui.toast('El empleado no ha podido volver a su puesto tras la descarga.', 'warn', 3200);
        restore();
      }
    }

    completeBox(box) {
      if (box.status === 'delivered') return;
      const holder = box.holder;
      box.status = 'delivered';
      box.holder = null;
      BK.bus.emit('truck:box-delivered', { count: this.transferredCount, total: this.boxes.length });
      if (this.transferredCount === this.boxes.length) {
        this.state = 'decision';
        if (holder && holder !== 'manager') this.returnEmployee(holder);
        BK.bus.emit('truck:manifest', { expected: this.expectedCount, delivered: this.transferredCount });
      }
    }

    resolveManifest(choice) {
      if (this.state !== 'decision') return false;
      const matches = this.expectedCount === this.transferredCount;
      const correct = (choice === 'sign' && matches) || (choice === 'credit' && !matches);
      const points = correct ? 50 : -50;
      this.outcome = { choice, correct, points, expected: this.expectedCount, delivered: this.transferredCount };
      this.G.scoring.add(points, correct ? 'Albarán de Conway revisado correctamente' : 'Revisión incorrecta del albarán de Conway', this.truck, 'opening');
      this.state = 'leaving';
      BK.bus.emit('truck:resolved', this.outcome);
      return true;
    }

    snapshot() {
      return {
        selected: this.selected, triggerAt: this.triggerAt, state: this.state, s: this.s,
        expectedCount: this.expectedCount, boxes: this.boxes.map((box) => box.status === 'delivered' ? 'delivered' : 'waiting'),
        assignedEmployeeId: this.assignedEmployee && this.assignedEmployee.id,
        outcome: this.outcome
      };
    }

    restore(saved) {
      if (!saved) return;
      this.selected = !!saved.selected;
      this.triggerAt = saved.triggerAt;
      this.state = saved.state;
      this.s = saved.s || 0;
      this.expectedCount = saved.expectedCount;
      this.outcome = saved.outcome || null;
      if (this.active) this.positionTruck();
      if (saved.boxes && saved.boxes.length) {
        this.boxes = this.boxPositions.slice(0, saved.boxes.length).map((position, index) => ({
          id: 'CONWAY-' + (index + 1), x: position.x, y: position.y,
          status: saved.boxes[index] === 'delivered' ? 'delivered' : 'waiting', holder: null
        }));
      }
      if (this.active) this.focusCamera();
      if (this.state === 'unloading' && saved.assignedEmployeeId) {
        this.state = 'awaiting-assignment';
        if (!this.assignEmployee(saved.assignedEmployeeId)) {
          this.state = 'awaiting-assignment';
          BK.bus.emit('truck:ready', { boxes: this.boxes.length, expected: this.expectedCount });
        }
      } else if (this.state === 'awaiting-assignment') {
        BK.bus.emit('truck:ready', { boxes: this.boxes.length, expected: this.expectedCount });
      } else if (this.state === 'decision') {
        BK.bus.emit('truck:manifest', { expected: this.expectedCount, delivered: this.transferredCount });
      }
    }
  }
  BK.TruckDeliverySystem = TruckDeliverySystem;
})();
