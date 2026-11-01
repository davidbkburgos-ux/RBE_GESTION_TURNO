(function () {
  const BK = window.BK;
  const U = BK.util;

  // Ciclo día/noche: overlays screen/multiply interpolados por hora + luces locales.
  class LightingSystem {
    constructor(G) {
      this.G = G;
      const start = G.clock.start;
      this.keys = G.cfg.lighting.keys.map((k) => ({ t: U.parseHM(k.t, start), screen: k.screen, multiply: k.multiply, lamps: k.lamps }));
    }
    state(t) {
      const ks = this.keys;
      if (t <= ks[0].t) return ks[0];
      if (t >= ks[ks.length - 1].t) return ks[ks.length - 1];
      let i = 1;
      while (ks[i].t < t) i++;
      const a = ks[i - 1], b = ks[i], f = (t - a.t) / (b.t - a.t);
      const mix = (x, y) => x.map((v, j) => U.lerp(v, y[j], f));
      return { screen: mix(a.screen, b.screen), multiply: mix(a.multiply, b.multiply), lamps: U.lerp(a.lamps, b.lamps, f) };
    }
    get nightness() { return this.state(this.G.clock.t).lamps; }
    draw(ctx, W, H) {
      const s = this.state(this.G.clock.t), rgba = (c) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${c[3].toFixed(3)})`;
      ctx.save();
      if (s.screen[3] > 0.003) { ctx.globalCompositeOperation = 'screen'; ctx.fillStyle = rgba(s.screen); ctx.fillRect(0, 0, W, H); }
      if (s.multiply[3] > 0.003) { ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = rgba(s.multiply); ctx.fillRect(0, 0, W, H); }
      if (s.lamps > 0.08) {
        ctx.globalCompositeOperation = 'screen';
        for (const l of this.G.map.lights) {
          const g = ctx.createRadialGradient(l.x, l.y, 2, l.x, l.y, l.r * 1.25);
          g.addColorStop(0, `rgba(255,214,150,${(0.5 * s.lamps).toFixed(3)})`);
          g.addColorStop(0.5, `rgba(255,170,90,${(0.18 * s.lamps).toFixed(3)})`);
          g.addColorStop(1, 'rgba(255,150,60,0)');
          ctx.fillStyle = g; ctx.fillRect(l.x - l.r * 1.3, l.y - l.r * 1.3, l.r * 2.6, l.r * 2.6);
        }
      }
      ctx.restore();
    }
  }
  BK.LightingSystem = LightingSystem;
})();
