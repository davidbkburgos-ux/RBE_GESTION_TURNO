(function () {
  const BK = window.BK;

  class Heap {
    constructor() { this.a = []; }
    push(n) { const a = this.a; a.push(n); let i = a.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (a[p].f <= a[i].f) break; [a[p], a[i]] = [a[i], a[p]]; i = p; } }
    pop() {
      const a = this.a; const top = a[0]; const last = a.pop();
      if (a.length) { a[0] = last; let i = 0; for (;;) { let l = 2 * i + 1, r = l + 1, m = i; if (l < a.length && a[l].f < a[m].f) m = l; if (r < a.length && a[r].f < a[m].f) m = r; if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m; } }
      return top;
    }
    get size() { return this.a.length; }
  }

  class NavigationSystem {
    constructor(map, clearanceCells = 1.5, brand = 'bk') {
      this.cell = map.nav.cell;
      this.W = Math.ceil(map.meta.width / this.cell);
      this.H = Math.ceil(map.meta.height / this.cell);
      this.map = map;
      this.doorOpen = false;
      const n = this.W * this.H;
      const raw = { staff: new Uint8Array(n), guest: new Uint8Array(n) };
      const obst = new Uint8Array(n);
      this.doorCells = new Uint8Array(n);
      const fill = (arr, r, v) => {
        const x1 = Math.max(0, Math.floor(r[0] / this.cell)), x2 = Math.min(this.W - 1, Math.floor(r[2] / this.cell));
        const y1 = Math.max(0, Math.floor(r[1] / this.cell)), y2 = Math.min(this.H - 1, Math.floor(r[3] / this.cell));
        for (let y = y1; y <= y2; y++) for (let x = x1; x <= x2; x++) arr[y * this.W + x] = v;
      };
      const extra = ((map.brandNav || {})[brand] || {}).walkable || [];
      map.walkable.concat(extra).forEach((w) => {
        fill(raw.staff, w.rect, 1);
        if (['front', 'ext', 'door'].includes(w.area)) fill(raw.guest, w.rect, 1);
        if (w.id === 'entrance') fill(this.doorCells, w.rect, 1);
      });
      map.guestBlock.forEach((r) => fill(raw.guest, r, 0));
      map.obstacles.forEach((o) => fill(obst, o.rect, 1));
      this.obst = obst;
      this.raw = raw;
      this.masks = {};
      ['staff', 'guest'].forEach((k) => {
        const m = new Uint8Array(n);
        for (let i = 0; i < n; i++) m[i] = raw[k][i] && !obst[i] ? 1 : 0;
        const out = new Uint8Array(n);
        const rc = Math.ceil(clearanceCells);
        for (let y = 0; y < this.H; y++) {
          for (let x = 0; x < this.W; x++) {
            const i = y * this.W + x;
            if (!m[i]) continue;
            let ok = 1;
            for (let dy = -rc; dy <= rc && ok; dy++) {
              for (let dx = -rc; dx <= rc; dx++) {
                if (dx * dx + dy * dy > clearanceCells * clearanceCells + 0.01) continue;
                const nx = x + dx, ny = y + dy;
                if (nx < 0 || ny < 0 || nx >= this.W || ny >= this.H || !m[ny * this.W + nx]) { ok = 0; break; }
              }
            }
            out[i] = ok;
          }
        }
        this.masks[k] = out;
      });
      // El hueco de la puerta principal se mantiene transitable con margen (se bloquea dinámicamente)
      this.doorOpen = false;
    }

    setDoorOpen(v) { this.doorOpen = v; }

    walkable(kind, cx, cy) {
      if (cx < 0 || cy < 0 || cx >= this.W || cy >= this.H) return false;
      const i = cy * this.W + cx;
      if (!this.doorOpen && this.doorCells[i]) return false;
      return !!this.masks[kind][i];
    }
    isWalkable(kind, x, y) { return this.walkable(kind, Math.floor(x / this.cell), Math.floor(y / this.cell)); }

    nearestWalkable(kind, x, y, maxR = 80) {
      const cx = Math.floor(x / this.cell), cy = Math.floor(y / this.cell);
      if (this.walkable(kind, cx, cy)) return { x, y, cx, cy };
      const R = Math.ceil(maxR / this.cell);
      let best = null, bd = 1e9;
      for (let r = 1; r <= R; r++) {
        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
            if (this.walkable(kind, cx + dx, cy + dy)) {
              const d = dx * dx + dy * dy;
              if (d < bd) { bd = d; best = { cx: cx + dx, cy: cy + dy }; }
            }
          }
        }
        if (best) break;
      }
      if (!best) return null;
      return { x: (best.cx + 0.5) * this.cell, y: (best.cy + 0.5) * this.cell, cx: best.cx, cy: best.cy };
    }

    los(kind, a, b) {
      const d = Math.hypot(b.x - a.x, b.y - a.y);
      const steps = Math.ceil(d / (this.cell * 0.5));
      for (let i = 0; i <= steps; i++) {
        const t = steps ? i / steps : 0;
        if (!this.isWalkable(kind, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)) return false;
      }
      return true;
    }

    findPath(kind, from, to) {
      const s = this.nearestWalkable(kind, from.x, from.y, 40);
      const g = this.nearestWalkable(kind, to.x, to.y, 60);
      if (!s || !g) return { path: [], reachable: false };
      const W = this.W;
      const start = s.cy * W + s.cx, goal = g.cy * W + g.cx;
      const gScore = new Float32Array(this.W * this.H).fill(1e9);
      const came = new Int32Array(this.W * this.H).fill(-1);
      const closed = new Uint8Array(this.W * this.H);
      const heap = new Heap();
      gScore[start] = 0;
      heap.push({ i: start, f: 0 });
      const gx = g.cx, gy = g.cy;
      const dirs = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.4142], [1, -1, 1.4142], [-1, 1, 1.4142], [-1, -1, 1.4142]];
      let found = false;
      while (heap.size) {
        const cur = heap.pop();
        if (closed[cur.i]) continue;
        closed[cur.i] = 1;
        if (cur.i === goal) { found = true; break; }
        const cx = cur.i % W, cy = (cur.i / W) | 0;
        for (const [dx, dy, c] of dirs) {
          const nx = cx + dx, ny = cy + dy;
          if (!this.walkable(kind, nx, ny)) continue;
          if (dx && dy && (!this.walkable(kind, cx + dx, cy) || !this.walkable(kind, cx, cy + dy))) continue;
          const ni = ny * W + nx;
          if (closed[ni]) continue;
          const ng = gScore[cur.i] + c;
          if (ng < gScore[ni]) {
            gScore[ni] = ng; came[ni] = cur.i;
            const h = Math.max(Math.abs(nx - gx), Math.abs(ny - gy)) + 0.4142 * Math.min(Math.abs(nx - gx), Math.abs(ny - gy));
            heap.push({ i: ni, f: ng + h });
          }
        }
      }
      if (!found) return { path: [], reachable: false };
      const pts = [];
      for (let i = goal; i !== -1; i = came[i]) pts.push({ x: ((i % W) + 0.5) * this.cell, y: (((i / W) | 0) + 0.5) * this.cell });
      pts.reverse();
      // suavizado por línea de visión
      const out = [pts[0]];
      let a = 0;
      while (a < pts.length - 1) {
        let b = pts.length - 1;
        while (b > a + 1 && !this.los(kind, pts[a], pts[b])) b--;
        out.push(pts[b]);
        a = b;
      }
      out.shift();
      if (g.x === to.x && g.y === to.y) { if (out.length) out[out.length - 1] = { x: to.x, y: to.y }; else out.push({ x: to.x, y: to.y }); }
      return { path: out, reachable: true, dest: out.length ? out[out.length - 1] : { x: s.x, y: s.y } };
    }

    pathLength(path, from) {
      let d = 0, p = from;
      for (const q of path) { d += Math.hypot(q.x - p.x, q.y - p.y); p = q; }
      return d;
    }

    // Punto transitable a una distancia natural del objetivo, el más cercano a 'from'
    approachPoint(kind, target, from, dist = 30) {
      let best = null, bd = 1e9;
      for (let k = 0; k < 24; k++) {
        const a = (k / 24) * Math.PI * 2;
        for (const r of [dist, dist + 8, dist + 16]) {
          const x = target.x + Math.cos(a) * r, y = target.y + Math.sin(a) * r;
          if (!this.isWalkable(kind, x, y)) continue;
          const d = Math.hypot(x - from.x, y - from.y) + r * 0.5;
          if (d < bd) { bd = d; best = { x, y }; }
        }
      }
      return best || this.nearestWalkable(kind, target.x, target.y, 90);
    }
  }
  BK.NavigationSystem = NavigationSystem;
})();
