(function () {
  const BK = window.BK;
  const U = BK.util;
  BK.DIR = { S: 0, SE: 1, E: 2, NE: 3, N: 4, NW: 5, W: 6, SW: 7 };

  class Character {
    constructor(o) {
      Object.assign(this, { id: '', kind: 'guest', pal: 'guest0', x: 0, y: 0, speed: 70, dir: 0, anim: 'idle', idleAnim: 'idle', animT: 0, walkPhase: 0, path: [], pi: 0, action: null, seated: false, alpha: 1, onArrive: null, scale: 1 }, o);
    }
    setPath(pts, cb) { this.path = pts || []; this.pi = 0; this.onArrive = cb || null; if (!this.path.length && cb) { const f = cb; this.onArrive = null; f(); } }
    stop() { this.path = []; this.pi = 0; this.onArrive = null; }
    get moving() { return this.pi < this.path.length; }
    face(dx, dy) { if (Math.abs(dx) + Math.abs(dy) > 0.01) this.dir = U.dirIndex(dx, dy); }
    faceTo(p) { this.face(p.x - this.x, p.y - this.y); }
    playAction(anim, dur, cb) {
      this.stop(); this.action = { anim, dur, t: 0, cb }; this.anim = anim; this.animT = 0;
    }
    cancelAction() { this.action = null; this.anim = this.idleAnim; this.animT = 0; }
    update(dt, speedMult = 1) {
      if (this.action) {
        this.action.t += dt; this.animT += dt; this.anim = this.action.anim;
        if (this.action.t >= this.action.dur) {
          const cb = this.action.cb; this.action = null; this.anim = this.idleAnim; this.animT = 0;
          if (cb) cb();
        }
        return;
      }
      if (this.pi < this.path.length) {
        let step = this.speed * speedMult * dt;
        while (step > 0 && this.pi < this.path.length) {
          const t = this.path[this.pi];
          const dx = t.x - this.x, dy = t.y - this.y, d = Math.hypot(dx, dy);
          if (d <= step) { this.x = t.x; this.y = t.y; this.pi++; step -= d; this.walkPhase += d; if (d > 0.01) this.face(dx, dy); }
          else { this.x += (dx / d) * step; this.y += (dy / d) * step; this.walkPhase += step; this.face(dx, dy); step = 0; }
        }
        this.anim = 'walk';
        if (this.pi >= this.path.length) {
          this.path = []; this.pi = 0; this.anim = this.idleAnim; this.animT = 0;
          const cb = this.onArrive; this.onArrive = null; if (cb) cb();
        }
      } else {
        if (this.anim === 'walk') { this.anim = this.idleAnim; this.animT = 0; }
        else if (this.anim !== this.idleAnim) { this.anim = this.idleAnim; }
        this.animT += dt;
      }
    }
  }
  BK.Character = Character;

  class Lane {
    constructor(pts) {
      this.pts = pts.map((p) => ({ x: p[0], y: p[1] }));
      this.cum = [0];
      for (let i = 1; i < this.pts.length; i++) this.cum.push(this.cum[i - 1] + Math.hypot(this.pts[i].x - this.pts[i - 1].x, this.pts[i].y - this.pts[i - 1].y));
      this.length = this.cum[this.cum.length - 1];
    }
    at(s) {
      s = U.clamp(s, 0, this.length);
      let i = 1;
      while (i < this.cum.length - 1 && this.cum[i] < s) i++;
      const a = this.pts[i - 1], b = this.pts[i], seg = this.cum[i] - this.cum[i - 1] || 1;
      const t = (s - this.cum[i - 1]) / seg;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, ang: Math.atan2(b.y - a.y, b.x - a.x) };
    }
    project(x, y) {
      let best = 0, bd = 1e9;
      for (let s = 0; s <= this.length; s += 2) { const p = this.at(s); const d = Math.hypot(p.x - x, p.y - y); if (d < bd) { bd = d; best = s; } }
      return best;
    }
  }
  BK.Lane = Lane;

  class Vehicle {
    constructor(id, color, len, wid) {
      Object.assign(this, { id, color, len, wid, s: 0, x: 0, y: 0, ang: 0, state: 'toSpeaker', timer: 0, release: null, speed: 0, hazard: false });
    }
  }
  BK.Vehicle = Vehicle;
})();
