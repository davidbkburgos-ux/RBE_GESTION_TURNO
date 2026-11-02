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

  // Fusión profunda: los objetos se combinan, el resto (arrays y valores) se sustituye.
  BK.mergeDeep = function (base, over) {
    Object.keys(over).forEach((k) => {
      const v = over[k];
      if (v === null) delete base[k];
      else if (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) BK.mergeDeep(base[k], v);
      else base[k] = JSON.parse(JSON.stringify(v));
    });
    return base;
  };
  // Aplica el entorno de otra marca sobre los datos base. Con 'bk' no toca nada.
  BK.autoName = 'AutoKing';
  const renameStrings = (node, from, to) => {
    if (Array.isArray(node)) { node.forEach((v, i) => { node[i] = typeof v === 'string' ? v.replace(from, to) : (renameStrings(v, from, to), v); }); return; }
    if (node && typeof node === 'object') Object.keys(node).forEach((k) => { const v = node[k]; if (typeof v === 'string') node[k] = v.replace(from, to); else renameStrings(v, from, to); });
  };
  BK.applyBrand = function (data, brand) {
    const b = brand && brand !== 'bk' && data.brands && data.brands[brand];
    if (!b) return false;
    if (brand === 'popeyes') BK.autoName = 'popAuto';
    if (b.map) Object.keys(b.map).forEach((k) => { data.map[k] = JSON.parse(JSON.stringify(b.map[k])); });
    if (b.config) BK.mergeDeep(data.config, b.config);
    if (b.opening) BK.mergeDeep(data.opening, b.opening);
    if (b.openingTaskOverrides) data.opening.openingTasks.forEach((t) => { if (b.openingTaskOverrides[t.id]) Object.assign(t, b.openingTaskOverrides[t.id]); });
    if (b.openingTasksAdd) b.openingTasksAdd.forEach((a) => {
      const i = data.opening.openingTasks.findIndex((t) => t.id === a.after);
      data.opening.openingTasks.splice(i < 0 ? data.opening.openingTasks.length - 1 : i + 1, 0, JSON.parse(JSON.stringify(a.task)));
    });
    if (b.textReplacements) b.textReplacements.forEach((r) => renameStrings(data.config, new RegExp(r[0], 'g'), r[1]));
    if (brand === 'popeyes') ['config', 'map', 'events', 'questions', 'opening', 'audioManifest'].forEach((n) => renameStrings(data[n], /Auto[Kk]ing/g, 'popAuto'));
    return true;
  };

  BK.loadData = async function () {
    const names = ['config', 'map', 'events', 'questions', 'opening', 'audioManifest', 'brands'];
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
