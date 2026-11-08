(function () {
  const BK = window.BK;
  const QUESTIONS = [
    {
      question: 'Un cliente comenta que lleva demasiado tiempo esperando. ¿Cuál es la mejor respuesta?',
      correct: 'Escucharle, disculparse, comprobar el pedido y darle una estimación realista.',
      options: ['Pedirle que espere sin comprobar qué ocurre.', 'Prometer un tiempo al azar y volver a caja.']
    },
    {
      question: 'En hora punta, ¿cómo mantenemos un buen tiempo de servicio sin descuidar al cliente?',
      correct: 'Coordinar los puestos, respetar el orden de los pedidos y avisar si hay una demora.',
      options: ['Preparar primero los pedidos más sencillos, aunque hayan llegado después.', 'Acelerar omitiendo las comprobaciones del pedido.']
    },
    {
      question: 'Un cliente recibe un pedido incompleto. ¿Qué hacemos?',
      correct: 'Disculparnos, completar el pedido cuanto antes y confirmar que ya está correcto.',
      options: ['Decirle que vuelva a pedirlo desde el principio.', 'Explicarle que probablemente el error fue suyo.']
    }
  ];
  class BriefingSystem {
    constructor(G) {
      this.G = G;
      this.meetingPoint = (G.map.spots && G.map.spots.meeting) || { x: 836, y: 644 };
      this.reset();
      BK.bus.on('opening:opened', () => this.cancel(true));
    }
    reset() {
      this.state = 'idle';
      this.completed = false;
      this.speedBonus = 0;
      this.questionIndex = 0;
      this.wrongAnswers = 0;
      this.questions = [];
      this.team = [];
      this.pendingArrivals = 0;
      this.indicatorElapsed = 0;
      this.spinElapsed = 0;
      this.spinTargetAngle = -90; this.spinSweeps = 3;
      this.odds = null;
      this.rouletteSegments = [];
      this.result = null;
    }
    get available() {
      const G = this.G;
      return G.state === 'playing' && !G.opening.doorOpen && G.clock.t < G.clock.open &&
        !this.completed && this.state === 'idle' && !(G.truckDelivery && G.truckDelivery.active);
    }
    get active() { return !['idle', 'done'].includes(this.state); }
    get point() { return this.meetingPoint; }
    get indicatorPosition() {
      const difficultySpeed = { weekday: 1, weekend: 1.3, specialHoliday: 1.65 }[this.G.save.settings.difficulty] || 1;
      return (Math.sin(this.indicatorElapsed * 2.2 * difficultySpeed * this.speedFactor) + 1) / 2;
    }
    // Cada respuesta fallada estrecha la zona verde y acelera el indicador
    get greenHalf() { return [0.1, 0.065, 0.04, 0.025][Math.min(3, this.wrongAnswers)]; }
    get speedFactor() { return 1 + 0.18 * Math.min(3, this.wrongAnswers); }
    get zoneEdges() { return [0.2, 0.5 - this.greenHalf, 0.5 + this.greenHalf, 0.8]; }
    zoneAt(position) {
      const e = this.zoneEdges;
      return position < e[0] || position > e[3] ? 'red' : position < e[1] || position > e[2] ? 'yellow' : 'green';
    }
    // La ruleta es un semicírculo: la aguja barre de extremo a extremo (-90° izquierda, +90° derecha)
    // como un péndulo que se frena, sin salir nunca de la mitad visible, y se detiene en el resultado.
    get needleAngle() {
      const progress = Math.min(1, this.spinElapsed / 2.6);
      const eased = 1 - Math.pow(1 - progress, 3);
      const travel = eased * (360 * this.spinSweeps + this.spinTargetAngle + 90);
      const m = travel % 360, pos = m <= 180 ? m : 360 - m;
      return -90 + pos;
    }

    start() {
      const G = this.G;
      if (!this.available) return false;
      if (G.player.busy) { BK.bus.emit('player:busy', {}); return false; }
      this.state = 'gathering';
      if (!G.player.goBriefing(() => this.gatherTeam())) {
        this.state = 'idle';
        return false;
      }
      return true;
    }

    formation(count) {
      const rows = this.G.map.spots && this.G.map.spots.formationRows;
      if (rows) {
        const mp = this.meetingPoint, list = [];
        rows.ys.forEach((y) => { for (let x = rows.x0; x <= rows.x1; x += rows.step) if (Math.hypot(x - mp.x, y - mp.y) > 26) list.push({ x, y }); });
        list.sort((a, b) => Math.abs(a.x - mp.x) - Math.abs(b.x - mp.x) || a.y - b.y);
        return Array.from({ length: count }, (_, i) => list[i % list.length]);
      }
      if (count === 1) return [{ x: this.meetingPoint.x - 90, y: this.meetingPoint.y }];
      const arc = (this.G.map.spots && this.G.map.spots.formationArc) || { rx: 96, ry: 64 };
      return Array.from({ length: count }, (_, i) => {
        const angle = -Math.PI / 2 + Math.PI * i / (count - 1);
        return {
          x: this.meetingPoint.x - arc.rx * Math.cos(angle),
          y: this.meetingPoint.y + arc.ry * Math.sin(angle)
        };
      });
    }

    gatherTeam() {
      if (this.state !== 'gathering') return;
      const G = this.G;
      const team = G.employees.list.filter((employee) => employee.available && !employee.absent);
      if (!team.length) {
        this.state = 'questions';
        this.showQuestion();
        return;
      }
      const positions = this.formation(team.length);
      const routes = team.map((employee, i) => G.nav.findPath('staff', employee, positions[i]));
      if (routes.some((route) => !route.reachable)) {
        this.cancel(true);
        G.ui.toast('No se puede reunir al equipo desde aquí.', 'warn', 2600);
        return;
      }
      this.team = team.map((employee) => ({
        employee,
        status: employee.status,
        mode: employee.mode,
        timer: employee.timer,
        idleAnim: employee.idleAnim,
        task: employee.task,
        dir: employee.dir
      }));
      this.pendingArrivals = team.length;
      team.forEach((employee, i) => {
        const target = positions[i], route = routes[i];
        employee.status = 'BRIEFING';
        employee.mode = 'briefing';
        employee.task = 'Reunión de equipo';
        employee.idleAnim = 'idle';
        employee.setPath(route.path, () => {
          if (this.state !== 'gathering') return;
          employee.faceTo(this.meetingPoint);
          employee.idleAnim = 'idle';
          this.pendingArrivals--;
          if (this.pendingArrivals === 0) this.beginQuestions();
        });
        if (!route.path.length) {
          employee.x = target.x;
          employee.y = target.y;
        }
      });
    }

    beginQuestions() {
      if (this.state !== 'gathering') return;
      this.state = 'questions';
      this.questionIndex = 0;
      this.wrongAnswers = 0;
      this.questions = BK.util.shuffle(QUESTIONS).map((question) => {
        const options = BK.util.shuffle([question.correct].concat(question.options));
        return Object.assign({}, question, { options, correctIndex: options.indexOf(question.correct) });
      });
      this.showQuestion();
    }

    showQuestion() {
      if (this.state !== 'questions') return;
      this.G.ui.showBriefingQuestion(this.questions[this.questionIndex], this.questionIndex, this.questions.length);
    }

    answer(index) {
      if (this.state !== 'questions') return;
      const G = this.G, question = this.questions[this.questionIndex];
      if (!question || index < 0 || index >= question.options.length) return;
      const correct = index === question.correctIndex;
      if (!correct) this.wrongAnswers++;
      G.ui.closeQuestion(true);
      G.audio.play(correct ? 'ok' : 'error');
      this.questionIndex++;
      if (this.questionIndex < this.questions.length) this.showQuestion();
      else {
        this.state = 'minigame';
        this.indicatorElapsed = 0;
        this.showMinigame();
      }
    }

    showMinigame() { this.G.ui.showBriefingMinigame(); }

    finishMinigame() {
      if (this.state !== 'minigame') return;
      const position = this.indicatorPosition;
      const zone = this.zoneAt(position);
      const base = zone === 'green' ? { 5: 27, 10: 32, 15: 41 }
        : zone === 'yellow' ? { 5: 30, 10: 40, 15: 30 }
          : { 5: 41, 10: 32, 15: 27 };
      // Los fallos también desplazan 3 puntos por error del 15 % al 5 %: acertar el verde no garantiza el premio
      const shift = 3 * Math.min(3, this.wrongAnswers);
      this.odds = { 5: base[5] + shift, 10: base[10], 15: base[15] - shift };
      const values = [5, 10, 15, 5, 10, 15, 5, 10, 15, 5, 10, 15];
      let segmentStart = 0;
      this.rouletteSegments = values.map((value) => {
        const segment = { value, start: segmentStart, weight: this.odds[value] / 4 };
        segmentStart += segment.weight;
        return segment;
      });
      const roll = Math.random() * 100;
      let total = 0, reward = 15;
      for (const value of [5, 10, 15]) {
        total += this.odds[value];
        if (roll < total) { reward = value; break; }
      }
      const choices = this.rouletteSegments.filter((segment) => segment.value === reward);
      const chosen = choices[Math.floor(Math.random() * choices.length)];
      const angleInHalfCircle = chosen.start + Math.random() * chosen.weight;
      this.result = { zone, reward };
      this.spinTargetAngle = -90 + angleInHalfCircle * 1.8; // ángulo final dentro del semicírculo
      this.spinSweeps = 3; // idas y vueltas completas antes de frenar
      this.spinElapsed = 0;
      this.state = 'roulette';
      this.G.ui.showBriefingRoulette();
    }

    update(dt) {
      if (this.state === 'minigame') this.indicatorElapsed += dt;
      if (this.state === 'roulette') {
        this.spinElapsed += dt;
        if (this.spinElapsed >= 2.6) this.complete();
      }
    }

    complete() {
      if (this.state !== 'roulette' || !this.result) return;
      this.completed = true;
      this.speedBonus = this.result.reward;
      this.state = 'done';
      this.restoreTeam();
      this.G.player.locked = false;
      this.G.ui.showBriefingResult(this.speedBonus);
      BK.bus.emit('briefing:complete', { bonus: this.speedBonus, zone: this.result.zone });
    }

    restoreTeam() {
      const G = this.G;
      this.team.forEach((saved) => {
        const employee = saved.employee;
        if (!G.employees.list.includes(employee)) return;
        const restore = () => {
          employee.status = saved.status;
          employee.mode = saved.mode;
          employee.timer = saved.timer;
          employee.idleAnim = saved.idleAnim;
          employee.task = saved.task;
          employee.dir = saved.dir;
        };
        employee.stop();
        const home = employee.home || { x: employee.x, y: employee.y };
        const route = G.nav.findPath('staff', employee, home);
        if (!route.reachable) {
          employee.x = home.x; employee.y = home.y;
          restore();
          return;
        }
        employee.status = 'BRIEFING';
        employee.setPath(route.path, restore);
        if (!route.path.length) { employee.x = home.x; employee.y = home.y; }
      });
      this.team = [];
      this.pendingArrivals = 0;
    }

    cancel(quiet) {
      if (!this.active) return;
      const G = this.G;
      if (G.ui && G.ui.q && G.ui.q.kind && G.ui.q.kind.startsWith('briefing-')) G.ui.closeQuestion(true);
      if (G.player) {
        G.player.char.stop();
        G.player.pending = null;
        G.player.marker = null;
        G.player.locked = false;
      }
      this.restoreTeam();
      this.state = 'idle';
      this.questions = [];
      this.result = null;
      if (!quiet) G.ui.toast('Briefing cancelado. El equipo vuelve a sus puestos.', 'info', 2400);
    }

    snapshot() { return { completed: this.completed, speedBonus: this.speedBonus }; }
    restore(snapshot) {
      this.reset();
      if (!snapshot) return;
      this.completed = !!snapshot.completed;
      this.speedBonus = this.completed ? Math.max(0, Math.min(15, Number(snapshot.speedBonus) || 0)) : 0;
      if (this.completed) this.state = 'done';
    }
  }

  BK.BriefingSystem = BriefingSystem;
})();
