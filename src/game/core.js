(function () {
  const BK = (window.BK = window.BK || {});
  BK.sys = {};

  class EventBus {
    constructor() { this.h = {}; }
    on(e, fn) { (this.h[e] = this.h[e] || []).push(fn); return () => this.off(e, fn); }
    off(e, fn) { this.h[e] = (this.h[e] || []).filter((f) => f !== fn); }
    emit(e, p) { (this.h[e] || []).slice().forEach((f) => { try { f(p); } catch (err) { console.error('[bus]', e, err); } }); }
  }
  BK.bus = new EventBus();

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  BK.util = {
    clamp,
    lerp: (a, b, t) => a + (b - a) * t,
    rnd: (a, b) => a + Math.random() * (b - a),
    rndi: (a, b) => Math.floor(a + Math.random() * (b - a + 1)),
    pick: (arr) => arr[Math.floor(Math.random() * arr.length)],
    dist: (a, b) => Math.hypot(a.x - b.x, a.y - b.y),
    shuffle(arr) {
      const a = arr.slice();
      for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
      return a;
    },
    parseHM(str, ref) {
      const [h, m] = str.split(':').map(Number);
      let v = h * 60 + m;
      if (ref !== undefined && v < ref) v += 1440;
      return v;
    },
    fmtClock(min) {
      const m = Math.floor(min) % 1440;
      return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
    },
    dirIndex(dx, dy) {
      const a = Math.atan2(dx, dy);
      return (Math.round(a / (Math.PI / 4)) + 8) % 8;
    },
    dirVec(i) { const a = (i * Math.PI) / 4; return { x: Math.sin(a), y: Math.cos(a) }; },
    inRect(x, y, r) { return x >= r[0] && x <= r[2] && y >= r[1] && y <= r[3]; }
  };

  BK.loadData = async function () {
    const names = ['config', 'map', 'events', 'questions', 'opening', 'audioManifest'];
    const out = {};
    const http = location.protocol.startsWith('http');
    for (const n of names) {
      let d = null;
      if (http) {
        try { const r = await fetch('src/data/' + n + '.json', { cache: 'no-cache' }); if (r.ok) d = await r.json(); } catch (e) { /* usa bundle */ }
      }
      if (!d && window.BK_BUNDLE) d = window.BK_BUNDLE[n];
      if (!d) throw new Error('Datos no disponibles: ' + n);
      out[n] = d;
    }
    BK.data = out;
    return out;
  };
})();
