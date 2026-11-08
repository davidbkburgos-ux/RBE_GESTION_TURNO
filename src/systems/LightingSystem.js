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
    // plates = true cuando el plano trae capas propias de día y de noche (assets/manifest.json): la imagen ya
    // contiene la luz, así que el velo diurno se suaviza y el oscurecimiento nocturno solo se aplica FUERA del
    // edificio — dentro el restaurante sigue iluminado y el equipo y los clientes se ven con claridad.
    draw(ctx, W, H, plates) {
      const s = this.state(this.G.clock.t), rgba = (c, k = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${(c[3] * k).toFixed(3)})`;
      const kScreen = plates ? 0.25 : 1, kLamp = plates ? 0.45 : 1;
      ctx.save();
      if (s.screen[3] * kScreen > 0.003) { ctx.globalCompositeOperation = 'screen'; ctx.fillStyle = rgba(s.screen, kScreen); ctx.fillRect(0, 0, W, H); }
      if (s.multiply[3] > 0.003) {
        ctx.globalCompositeOperation = 'multiply';
        if (plates) {
          ctx.save();
          ctx.beginPath(); ctx.rect(0, 0, W, H);
          (this.G.map.indoor || LightingSystem.INDOOR).forEach((r) => ctx.rect(r[0], r[1], r[2] - r[0], r[3] - r[1]));
          ctx.clip('evenodd');
          ctx.fillStyle = rgba(s.multiply, 0.6); ctx.fillRect(0, 0, W, H);
          ctx.restore();
          ctx.globalCompositeOperation = 'multiply';
        } else { ctx.fillStyle = rgba(s.multiply); ctx.fillRect(0, 0, W, H); }
      }
      if (s.lamps > 0.08) {
        ctx.globalCompositeOperation = 'screen';
        // Degradados cacheados por intensidad cuantizada (1/32): no se crean objetos nuevos en cada frame.
        const q = Math.round(s.lamps * kLamp * 32) / 32, lights = this.G.map.lights;
        if (this.gradQ !== q || this.gradLights !== lights) {
          this.gradQ = q; this.gradLights = lights;
          this.grads = lights.map((l) => {
            const g = ctx.createRadialGradient(l.x, l.y, 2, l.x, l.y, l.r * 1.25);
            g.addColorStop(0, `rgba(255,214,150,${(0.5 * q).toFixed(3)})`);
            g.addColorStop(0.5, `rgba(255,170,90,${(0.18 * q).toFixed(3)})`);
            g.addColorStop(1, 'rgba(255,150,60,0)');
            return g;
          });
        }
        lights.forEach((l, i) => { ctx.fillStyle = this.grads[i]; ctx.fillRect(l.x - l.r * 1.3, l.y - l.r * 1.3, l.r * 2.6, l.r * 2.6); });
      }
      ctx.restore();
    }
  }
  // Huella interior por defecto (plano BK); Popeyes la define en brands.json -> map.indoor
  LightingSystem.INDOOR = [[168, 296, 1348, 792], [1148, 204, 1338, 296]];
  BK.LightingSystem = LightingSystem;
})();
