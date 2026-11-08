(function () {
  const BK = window.BK;
  const U = BK.util;
  const MW = 1536, MH = 1024;
  // Marcas disponibles: plano de fondo (el de Burger King sale de map.json).
  BK.BRAND_MAPS = { bk: 'assets/map/plano_limpio.png', popeyes: 'assets/map/plano_popeyes.png' };
  // Huella del edificio (sin solapes, para la máscara even-odd de la lluvia).
  const INDOOR = [[168, 296, 1348, 792], [1148, 204, 1338, 296]];

  const FACE = { excellent: '😀', acceptable: '😐', failed: '😠' };
  const FACE_ICON = { excellent: 'face_happy', acceptable: 'face_neutral', failed: 'face_annoyed' };
  // Estados del cliente -> icono ilustrado (assets/ui/icons); el emoji queda solo como respaldo.
  const STATE_ICON = { BEING_SERVED: 'talking', WAITING: 'waiting', WAITING_FOR_ORDER: 'receipt', ORDER_READY: 'ready', SEATED: 'burger', NEEDS_HELP: 'alert', LEAVING: 'leaving', WAIT_FOR_TABLE: 'chair', TABLE_COMPLAINT: 'face_annoyed' };

  // Icono ilustrado centrado en (x, y); si no está cargado, el emoji de respaldo.
  function drawIcon(ctx, name, x, y, size, emoji) {
    const img = BK.SpriteLoader && BK.SpriteLoader.icon(name);
    if (img) { ctx.drawImage(img, Math.round(x - size / 2), Math.round(y - size / 2), size, size); return; }
    if (!emoji) return;
    ctx.save(); ctx.font = Math.round(size * 0.8) + 'px "Segoe UI Emoji", system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(emoji, x, y); ctx.restore();
  }
  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, h / 2, w / 2);
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  // Barra de progreso común a todo el juego (limpieza, Auto, kiosco, recogida, preparación, eventos):
  // cápsula oscura con borde claro, relleno redondeado con brillo superior.
  const BAR = { good: '#5fc46a', warn: '#f2b72b', bad: '#e5483b', info: '#4fa3e0', brand: '#f47a2c' };
  function drawBar(ctx, x, y, w, h, f, color) {
    f = Math.max(0, Math.min(1, f));
    ctx.save();
    roundRect(ctx, x - 1.5, y - 1.5, w + 3, h + 3, (h + 3) / 2);
    ctx.fillStyle = 'rgba(24,16,11,0.88)'; ctx.fill();
    ctx.strokeStyle = 'rgba(255,243,212,0.55)'; ctx.lineWidth = 1; ctx.stroke();
    if (f > 0.001) {
      const fw = Math.max(h, w * f);
      roundRect(ctx, x, y, fw, h, h / 2); ctx.fillStyle = color; ctx.fill();
      roundRect(ctx, x + 1, y + 0.5, fw - 2, h * 0.4, h * 0.2); ctx.fillStyle = 'rgba(255,255,255,0.32)'; ctx.fill();
    }
    ctx.restore();
  }
  BK.drawBar = drawBar; BK.BAR = BAR; BK.drawIcon = drawIcon;
  // Emoji de los datos (eventos, tareas) -> icono ilustrado equivalente.
  const EMOJI_ICON = { '🛎️': 'bell', '🛎': 'bell', '🚗': 'car', '🛵': 'scooter', '🧹': 'broom', '📦': 'box', '🔧': 'wrench', '🚪': 'door',
    '🌡️': 'thermo', '🌡': 'thermo', '⏱️': 'stopwatch', '⏱': 'stopwatch', '🍟': 'fries', '🍗': 'chicken', '👨‍🍳': 'chef', '🤝': 'handshake',
    '🔥': 'flame', '🥪': 'sandwich', '⭐': 'star', '★': 'star', '🍔': 'burger', '📋': 'checklist', '😠': 'face_annoyed', '🖥️': 'kiosk', '🧾': 'receipt', '⏳': 'waiting', '💬': 'talking', '❗': 'alert', '✅': 'ready', '👋': 'leaving', '🪑': 'chair', '🗣️': 'briefing' };
  // Dibuja el icono ilustrado de un emoji si existe; si no, el propio emoji.
  function drawEmoji(ctx, emoji, x, y, size) { drawIcon(ctx, EMOJI_ICON[emoji] || '', x, y, size, emoji); }
  BK.EMOJI_ICON = EMOJI_ICON;

  function shapePath(ctx, shape, x, y, r) {
    ctx.beginPath();
    if (shape === 'circle') ctx.arc(x, y, r, 0, Math.PI * 2);
    else if (shape === 'square') { const k = r * 0.9; ctx.rect(x - k, y - k, k * 2, k * 2); }
    else if (shape === 'diamond') { ctx.moveTo(x, y - r * 1.15); ctx.lineTo(x + r * 1.15, y); ctx.lineTo(x, y + r * 1.15); ctx.lineTo(x - r * 1.15, y); ctx.closePath(); }
    else if (shape === 'triangle') { ctx.moveTo(x, y - r * 1.2); ctx.lineTo(x + r * 1.2, y + r * 0.85); ctx.lineTo(x - r * 1.2, y + r * 0.85); ctx.closePath(); }
  }

  // Render Canvas 2D: plano como escenario semi-isométrico, entidades ordenadas en profundidad, iluminación e indicadores.
  class Renderer {
    constructor(G, canvas) {
      this.G = G; this.cv = canvas; this.ctx = canvas.getContext('2d');
      this.img = new Image(); this.imgReady = false;
      this.imgs = {};
      this.setBrand(G.save && G.save.settings ? G.save.settings.brand : 'bk');
      this.cam = { x: MW / 2, y: MH / 2, zoom: 1 };
      this.zoomTarget = 1;
      this.W = 800; this.H = 600; this.dpr = 1;
      this.hits = []; this.badges = [];
      this.floaters = [];
      this.coverageHighlight = null;
      this.selectedEmployeeId = null;
      this.debug = false;
      this.follow = false;
      BK.bus.on('score:change', (e) => {
        if (!e.delta) return;
        const p = e.pos ? { x: e.pos.x !== undefined ? e.pos.x : e.pos[0], y: e.pos.y !== undefined ? e.pos.y : e.pos[1] } : { x: G.player.char.x, y: G.player.char.y };
        this.floaters.push({ x: p.x, y: p.y - 70, text: (e.delta > 0 ? '+' : '') + e.delta, good: e.delta > 0, t: 0 });
      });
      this.resize();
    }
    // Cambia el plano de fondo según la marca. Con assets/manifest.json usa dos capas (día y noche) que se
    // funden según la hora; sin manifest, el plano único de BK.BRAND_MAPS. Las imágenes se cargan una vez.
    setBrand(brand) {
      const maps = BK.BRAND_MAPS, key = maps[brand] ? brand : 'bk';
      const M = this.G.manifest, mb = M && M.brands && M.brands[key];
      this.brandKey = key; this.brandInfo = mb || null;
      const load = (src) => {
        let im = this.imgs[src];
        if (!im) {
          im = this.imgs[src] = new Image(); im.ready = false;
          im.onload = () => { im.ready = true; if (this.img === im) this.imgReady = true; this.bgKey = null; this.dirty = true; };
          im.src = src;
        }
        return im;
      };
      this.img = load(mb && mb.maps ? mb.maps.day : key === 'bk' ? this.G.map.meta.image : maps[key]);
      this.imgReady = this.img.ready;
      this.night = mb && mb.maps && mb.maps.night ? load(mb.maps.night) : null;
      this.bgKey = null; this.dirty = true;
    }
    // Fondo pre-compuesto (plano día + capa noche + rótulos del carril) en un canvas en memoria, ya escalado a
    // los píxeles físicos de pantalla. Solo se regenera al cambiar marca, zoom/tamaño o el tramo de noche
    // (1/48); el resto de frames el plano se vuelca 1:1 sin reescalar ni componer.
    // Devuelve { canvas, k } donde k = píxeles de buffer por unidad de mundo, o null si aún no hay imagen.
    bgLayer(s) {
      if (!this.imgReady) return null;
      const night = this.nightReady ? Math.round(this.nightAmount() * 48) / 48 : 0;
      let k = s * this.dpr;
      if (MW * k * MH * k > 16e6) k = Math.sqrt(16e6 / (MW * MH)); // tope de memoria del buffer (~64 MB)
      const bw = Math.round(MW * k), bh = Math.round(MH * k);
      const key = this.brandKey + '|' + bw + 'x' + bh + '|' + night;
      if (key === this.bgKey) return this.bg;
      // Durante la animación de zoom no se regenera en cada frame: se reutiliza el buffer previo reescalado.
      if (this.bg && this.cam.zoom !== this.zoomTarget) return this.bg;
      const c = this.bgCanvas || (this.bgCanvas = document.createElement('canvas'));
      if (c.width !== bw || c.height !== bh) { c.width = bw; c.height = bh; }
      const x = c.getContext('2d');
      x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, bw, bh);
      x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
      x.setTransform(bw / MW, 0, 0, bh / MH, 0, 0);
      x.drawImage(this.img, 0, 0, MW, MH);
      if (night > 0.004) { x.globalAlpha = night; x.drawImage(this.night, 0, 0, MW, MH); x.globalAlpha = 1; }
      this.drawLane(x);
      this.bgKey = key; this.bg = { canvas: c, k: bw / MW };
      return this.bg;
    }
    get nightReady() { return !!(this.night && this.night.ready); }
    // 0 = pleno día, 1 = noche cerrada. Sigue las claves de iluminación de config.json.
    nightAmount() {
      const L = this.G.lighting;
      if (!L || !this.G.clock) return 0;
      return U.clamp((L.state(this.G.clock.t).lamps - 0.12) / 0.75, 0, 1);
    }
    // Rótulo y flechas pintados en el carril del Auto (texto nítido en lugar de marcas quemadas en el plano).
    drawLane(ctx) {
      const lane = this.G.map.vehicleLane, b = this.brandInfo;
      if (!lane || !b || !b.lane) return;
      const pts = lane.path, L = b.lane;
      ctx.save();
      ctx.fillStyle = 'rgba(236,232,222,0.5)';
      let acc = 60;
      for (let i = 1; i < pts.length; i++) {
        const [x1, y1] = pts[i - 1], [x2, y2] = pts[i];
        const len = Math.hypot(x2 - x1, y2 - y1), ang = Math.atan2(y2 - y1, x2 - x1);
        while (acc < len) {
          const x = x1 + Math.cos(ang) * acc, y = y1 + Math.sin(ang) * acc;
          if (x > 10 && x < MW - 10 && y > 10 && y < MH - 10 && Math.hypot(x - L.x, y - L.y) > 130) {
            ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
            ctx.beginPath(); ctx.moveTo(9, 0); ctx.lineTo(-5, -7); ctx.lineTo(-2, 0); ctx.lineTo(-5, 7); ctx.closePath(); ctx.fill();
            ctx.restore();
          }
          acc += 150;
        }
        acc -= len;
      }
      ctx.translate(L.x, L.y); if (L.ang) ctx.rotate(L.ang);
      ctx.font = '800 ' + (L.size || 21) + 'px system-ui, "Segoe UI", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(236,232,222,0.6)';
      ctx.fillText(L.label, 0, 0);
      ctx.restore();
    }
    // Props del plano de la marca que entran en el orden de profundidad (tótem de pedido del Auto).
    propList() {
      const b = this.brandInfo, out = [];
      if (!b || !b.props || !BK.SpriteLoader) return out;
      for (const p of b.props) {
        const img = BK.SpriteLoader.image(p.src);
        if (img) out.push({ y: p.y, prop: p, img });
      }
      return out;
    }
    drawProp(ctx, it) {
      const p = it.prop, x = p.x - p.w * p.anchor[0], y = p.y - p.h * p.anchor[1];
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      ctx.beginPath(); ctx.ellipse(p.x + 3, p.y - 1, p.w * 0.55, 4.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.drawImage(it.img, x, y, p.w, p.h);
    }
    // Brillo nocturno de paneles iluminados (después de la iluminación global para que no se oscurezca).
    drawPropGlow(ctx, night) {
      const b = this.brandInfo;
      if (!b || !b.props || night < 0.05) return;
      ctx.save(); ctx.globalCompositeOperation = 'screen';
      for (const p of b.props) {
        if (!p.glow) continue;
        const g = ctx.createRadialGradient(p.glow.x, p.glow.y, 1, p.glow.x, p.glow.y, p.glow.r);
        g.addColorStop(0, 'rgba(255,240,205,' + (0.55 * night).toFixed(3) + ')');
        g.addColorStop(1, 'rgba(255,200,140,0)');
        ctx.fillStyle = g; ctx.fillRect(p.glow.x - p.glow.r, p.glow.y - p.glow.r, p.glow.r * 2, p.glow.r * 2);
      }
      ctx.restore();
    }
    resize() {
      const r = this.cv.parentElement.getBoundingClientRect();
      const W = Math.max(200, Math.round(r.width)), H = Math.max(150, Math.round(r.height));
      // Retina: un dpr de 2-3 multiplica x4-x9 los píxeles por frame sin ganancia visible en este estilo.
      // Calidad gráfica (Ajustes): «nítida» usa la densidad real de la pantalla hasta 2×; «rendimiento» la limita a 1,5×.
      const perf = BK.settings && BK.settings.gfxQuality === 'performance';
      const dpr = Math.min(window.devicePixelRatio || 1, perf ? 1.5 : 2);
      if (W === this.W && H === this.H && dpr === this.dpr && this.cv.width) return;
      this.W = W; this.H = H; this.dpr = dpr; this.dirty = true;
      this.cv.width = Math.round(W * dpr); this.cv.height = Math.round(H * dpr);
      this.cv.style.width = W + 'px'; this.cv.style.height = H + 'px';
      this.clampCam();
      if (this.imgReady && this.G.state) this.draw();
    }
    get base() { return Math.min(this.W / MW, this.H / MH); }
    get scale() { return this.base * this.cam.zoom; }
    toWorld(sx, sy) { const s = this.scale; return { x: (sx - this.W / 2) / s + this.cam.x, y: (sy - this.H / 2) / s + this.cam.y }; }
    toScreen(wx, wy) { const s = this.scale; return { x: (wx - this.cam.x) * s + this.W / 2, y: (wy - this.cam.y) * s + this.H / 2 }; }
    clampCam() {
      const s = this.scale, hw = this.W / 2 / s, hh = this.H / 2 / s;
      this.cam.x = MW * s <= this.W ? MW / 2 : U.clamp(this.cam.x, hw, MW - hw);
      this.cam.y = MH * s <= this.H ? MH / 2 : U.clamp(this.cam.y, hh, MH - hh);
    }
    setZoom(z) {
      const c = this.G.cfg.camera;
      this.zoomTarget = U.clamp(z, c.minZoom, c.maxZoom);
      if (BK.settings && BK.settings.reduceMotion) { this.cam.zoom = this.zoomTarget; this.clampCam(); }
      this.dirty = true;
    }
    zoomBy(f) { this.setZoom(this.zoomTarget * f); }
    pan(dx, dy) { this.cam.x -= dx / this.scale; this.cam.y -= dy / this.scale; this.clampCam(); this.dirty = true; }
    // true mientras el zoom se anima (el bucle debe seguir pintando aunque la escena esté congelada)
    get animating() { return this.cam.zoom !== this.zoomTarget; }
    setFollow(on) {
      this.follow = on;
      this.setZoom(on ? this.G.cfg.camera.mobileFollowZoom : 1);
    }
    update(dt) {
      const k = 1 - Math.pow(0.0005, dt);
      this.cam.zoom += (this.zoomTarget - this.cam.zoom) * (BK.settings && BK.settings.reduceMotion ? 1 : k);
      if (Math.abs(this.cam.zoom - this.zoomTarget) < 0.001) this.cam.zoom = this.zoomTarget;
      if (this.follow || this.cam.zoom > 1.01 && this.follow) {
        const p = this.G.player.char;
        let tx = p.x, ty = p.y;
        const pe = this.G.player.pending && this.G.player.pending.ev;
        if (pe && pe.interact) { tx = p.x + (pe.interact.x - p.x) * 0.35; ty = p.y + (pe.interact.y - p.y) * 0.35; }
        const f = BK.settings && BK.settings.reduceMotion ? 1 : this.G.cfg.camera.followLerp;
        this.cam.x += (tx - this.cam.x) * f; this.cam.y += (ty - this.cam.y) * f;
      }
      this.clampCam();
      this.floaters.forEach((f) => (f.t += dt));
      this.floaters = this.floaters.filter((f) => f.t < 1.8);
    }

    draw() {
      const G = this.G, ctx = this.ctx, s = this.scale, now = performance.now() / 1000;
      const rm = BK.settings && BK.settings.reduceMotion;
      this.dirty = false;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.fillStyle = '#17100c'; ctx.fillRect(0, 0, this.W, this.H);
      const bg = this.bgLayer(s);
      if (!bg) return;
      // Origen del mundo en píxeles físicos, entero: el plano pre-escalado se vuelca 1:1 y nítido.
      const ox = Math.round((this.W / 2 - this.cam.x * s) * this.dpr), oy = Math.round((this.H / 2 - this.cam.y * s) * this.dpr);
      const ws = s * this.dpr, bk = ws / bg.k;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      if (Math.abs(bk - 1) < 1e-6) ctx.drawImage(bg.canvas, ox, oy);
      else if (this.cam.zoom !== this.zoomTarget) {
        // animando el zoom: se pinta desde la imagen de origen (alta resolución) para no ver el plano estirado
        ctx.setTransform(ws, 0, 0, ws, ox, oy); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(this.img, 0, 0, MW, MH);
        const nq = this.nightReady ? Math.round(this.nightAmount() * 48) / 48 : 0;
        if (nq > 0.004) { ctx.globalAlpha = nq; ctx.drawImage(this.night, 0, 0, MW, MH); ctx.globalAlpha = 1; }
        this.drawLane(ctx);
      } else { ctx.imageSmoothingEnabled = true; ctx.drawImage(bg.canvas, ox, oy, Math.round(bg.canvas.width * bk), Math.round(bg.canvas.height * bk)); }
      ctx.setTransform(ws, 0, 0, ws, ox, oy);
      const night = this.nightReady ? this.nightAmount() : 0;

      this.drawTables(ctx);
      this.drawBag(ctx);
      this.drawPoints(ctx, now, rm);
      this.drawCoverageHighlight(ctx, now, rm);
      if (this.debug) this.drawDebug(ctx);
      this.drawBriefingFormation(ctx, now, rm);

      // vehículos (suelo) y luego personajes por profundidad
      G.vehicles.cars.forEach((c) => {
        const cs = BK.SpriteLoader && BK.SpriteLoader.car(c.id);
        ctx.save(); ctx.translate(c.x, c.y); ctx.rotate(c.ang);
        if (cs) {
          // sprite cenital de Summer Engine: mismo largo de gameplay, ancho según la proporción del modelo
          const L = c.len, Wd = L * cs.c.wid / cs.c.len;
          ctx.fillStyle = 'rgba(0,0,0,0.28)'; roundRect(ctx, -L / 2 + 3, -Wd / 2 + 4, L - 2, Wd - 2, Wd * 0.3); ctx.fill();
          ctx.drawImage(cs.img, -L / 2, -Wd / 2, L, Wd);
        } else if (!(BK.SpriteLoader && BK.SpriteLoader.manifest && BK.SpriteLoader.manifest.vehicles)) {
          const sp = BK.carSprite(c.color, c.len, c.wid, c.body, c.acc);
          ctx.drawImage(sp.canvas, -(c.len / 2 + sp.pad), -(c.wid / 2 + sp.pad), c.len + sp.pad * 2, c.wid + sp.pad * 2);
        }
        ctx.restore();
        const b = G.vehicles.bar(c);
        if (b) {
          const w = 46, h = 6, x = c.x - w / 2, y = c.y - 40;
          drawBar(ctx, x, y, w, h, Math.min(1, b.f), b.f <= 1 ? BAR.good : b.f <= 1.5 ? BAR.warn : BAR.bad);
          ctx.save();
          ctx.font = 'bold 9px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(24,16,11,0.9)';
          ctx.strokeText(b.label, c.x, y - 4); ctx.fillStyle = '#fff'; ctx.fillText(b.label, c.x, y - 4);
          ctx.restore();
        }
      });
      this.drawTruckDelivery(ctx);
      this.drawKitchenLife(ctx, now, rm);
      const chars = [G.player.char].concat(G.employees.list, G.customers.guests, this.propList());
      chars.sort((a, b) => a.y - b.y);
      const sc = (BK.CHAR_SCALE || 1);
      chars.forEach((c) => {
        if (c.prop) { this.drawProp(ctx, c); return; }
        const k = sc * (c.scale || 1);
        ctx.fillStyle = 'rgba(0,0,0,0.26)';
        if (c.alpha !== undefined && c.alpha < 0.05) return;
        ctx.beginPath(); ctx.ellipse(c.x, c.y + 1, 11 * k, 4.5 * k, 0, 0, Math.PI * 2); ctx.fill();
        if (c === G.player.char) {
          ctx.strokeStyle = 'rgba(244,122,44,0.95)'; ctx.lineWidth = 2.2;
          ctx.beginPath(); ctx.ellipse(c.x, c.y + 1, 15 * k, 6.5 * k, 0, 0, Math.PI * 2); ctx.stroke();
        }
        if (c.id === this.selectedEmployeeId) {
          ctx.strokeStyle = 'rgba(255,210,122,0.95)'; ctx.lineWidth = 3;
          ctx.beginPath(); ctx.ellipse(c.x, c.y - 2, 18 * k, 8 * k, 0, 0, Math.PI * 2); ctx.stroke();
        }
        BK.CharacterAnimationSystem.draw(ctx, c, k, c.alpha);
        const carriedBox = G.truckDelivery && G.truckDelivery.carriedBy(c);
        if (carriedBox) this.drawCarton(ctx, c.x + 5, c.y - 22, 0.9);
      });

      this.drawPatience(ctx);
      this.drawRain(ctx, now, rm);
      G.lighting.draw(ctx, MW, MH, this.nightReady);
      this.drawPropGlow(ctx, night);
      ctx.restore();

      this.drawIndicators(ctx, now, rm);
      this.drawOverlays(ctx);
      this.drawFloaters(ctx);
    }

    // Etiquetas de puesto sobre empleados y barras de progreso de preparación (espacio de pantalla, texto nítido).
    drawOverlays(ctx) {
      const G = this.G, info = G.cfg.operations.stationInfo, k = Math.max(0.75, Math.min(1.25, this.scale * 1.1));
      this.tagHits = [];
      const rr = (x, y, w, h, r) => { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); };
      ctx.save(); ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
      if (G.state === 'playing') {
        this.drawStationGuidance(ctx, performance.now() / 1000, BK.settings && BK.settings.reduceMotion);
        const showTags = !G.ui.el.operationsPanel.hidden;
        G.employees.list.forEach((c) => {
          // empleado base cubriendo el puesto vecino: marca discreta con el icono del puesto
          if (!c.expert && c.extraPosition && c.available && !c.absent && c.alpha >= 0.5) {
            const p = this.toScreen(c.x, c.y - (showTags ? 108 : 86)), ex = info[c.extraPosition];
            ctx.font = 'bold ' + Math.round(11 * k) + 'px system-ui, sans-serif'; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(24,16,11,0.9)';
            const t = '↔ ' + (ex ? ex.icon + ' ' + ex.tag : 'APOYO');
            ctx.strokeText(t, p.x, p.y); ctx.fillStyle = '#9fe3ff'; ctx.fillText(t, p.x, p.y);
            return;
          }
          if (!c.expert || !c.available || c.absent || c.alpha < 0.5) return;
          const p = this.toScreen(c.x, c.y - (showTags ? 108 : 86));
          ctx.font = Math.round(15 * k) + 'px system-ui, sans-serif'; ctx.fillStyle = '#ffd24a';
          ctx.shadowColor = 'rgba(0,0,0,0.7)'; ctx.shadowBlur = 4;
          const ex = c.extraPosition && info[c.extraPosition];
          ctx.fillText(ex ? '★ +' + ex.icon : '★', p.x, p.y); ctx.shadowBlur = 0;
        });
        G.employees.list.forEach((c) => {
          if (!showTags) return;
          if (!c.available || c.absent || c.alpha < 0.5) return;
          const moving = c.status === 'MOVING' || c.targetPosition;
          const pos = moving ? c.targetPosition : c.position;
          const inf = info[pos];
          if (!inf) return;
          const p = this.toScreen(c.x, c.y - 88), sel = c.id === this.selectedEmployeeId;
          const text = moving ? 'EN TRASLADO' : inf.tag, fs = Math.round(10.5 * k);
          ctx.font = 'bold ' + fs + 'px system-ui, sans-serif';
          const w = ctx.measureText(text).width + 14 * k + fs, h = 17 * k;
          ctx.fillStyle = sel ? 'rgba(255,210,122,0.98)' : moving ? 'rgba(244,122,44,0.95)' : 'rgba(30,20,14,0.88)';
          rr(p.x - w / 2, p.y - h / 2, w, h, h / 2); ctx.fill();
          ctx.strokeStyle = 'rgba(255,243,212,0.9)'; ctx.lineWidth = 1.2; ctx.stroke();
          ctx.fillStyle = sel || moving ? '#2a1c14' : '#fff3d4';
          ctx.fillText((c.expert ? '★ ' : '') + (moving ? '🚶 ' : inf.icon + ' ') + text, p.x, p.y + 0.5);
          this.tagHits.push({ x: p.x, y: p.y, w: Math.max(w, 44), h: Math.max(h, 30), emp: c });
        });
        G.prep.bars().forEach((b) => {
          const p = this.toScreen(b.x, b.y), w = 118 * k, h = 15 * k;
          ctx.fillStyle = 'rgba(20,12,8,0.86)'; rr(p.x - w / 2, p.y - h / 2 - 7 * k, w, h + 13 * k, 7 * k); ctx.fill();
          ctx.font = 'bold ' + Math.round(9.5 * k) + 'px system-ui, sans-serif'; ctx.fillStyle = '#fff3d4';
          ctx.fillText(b.icon + ' ' + b.text + (b.manager ? ' · TÚ' : ''), p.x, p.y - 4 * k);
          const bw = w - 14 * k, bx = p.x - bw / 2, by = p.y + 3 * k;
          drawBar(ctx, bx, by, bw, 5 * k, b.f, b.manager ? BAR.brand : BAR.good);
          ctx.font = 'bold ' + Math.round(8 * k) + 'px system-ui, sans-serif'; ctx.fillStyle = '#fff3d4';
          ctx.textAlign = 'right'; ctx.fillText(Math.round(b.f * 100) + ' %', p.x + w / 2 - 4 * k, p.y - 4 * k); ctx.textAlign = 'center';
        });
        const pa = G.player.char.action;
        if (pa && pa.prep && pa.dur > 0) {
          const f = Math.min(1, pa.t / pa.dur), left = Math.max(0, Math.ceil(pa.dur - pa.t));
          const p = this.toScreen(G.player.char.x, G.player.char.y - 100), w = 132 * k, h = 15 * k;
          ctx.fillStyle = 'rgba(20,12,8,0.9)'; rr(p.x - w / 2, p.y - h / 2 - 7 * k, w, h + 13 * k, 7 * k); ctx.fill();
          ctx.font = 'bold ' + Math.round(9.5 * k) + 'px system-ui, sans-serif'; ctx.fillStyle = '#fff3d4';
          ctx.fillText('📦 Preparando producto', p.x, p.y - 4 * k);
          const bw = w - 14 * k, bx = p.x - bw / 2, by = p.y + 3 * k;
          drawBar(ctx, bx, by, bw, 5 * k, f, BAR.brand);
          ctx.font = 'bold ' + Math.round(8 * k) + 'px system-ui, sans-serif'; ctx.fillStyle = '#fff3d4';
          ctx.textAlign = 'right'; ctx.fillText(left + ' s', p.x + w / 2 - 4 * k, p.y - 4 * k); ctx.textAlign = 'center';
        }
      }
      ctx.restore();
    }
    tagAt(sx, sy) {
      return (this.tagHits || []).find((t) => Math.abs(t.x - sx) <= t.w / 2 && Math.abs(t.y - sy) <= t.h / 2) || null;
    }

    // Impaciencia de clientes y coches en cola: emoji y barra que pasan de ámbar a rojo.
    drawPatience(ctx) {
      const G = this.G;
      const items = G.customers.guests.filter((g) => g.patience > 0.3 && !g.leaving && !g.collecting)
        .map((g) => ({ x: g.x, y: g.y - 62, f: g.patience }))
        .concat(G.vehicles.cars.filter((c) => c.patience > 0.3 && c.state !== 'leaving').map((c) => ({ x: c.x, y: c.y - 34, f: c.patience })));
      items.forEach((it) => {
        const f = Math.min(1, it.f), w = 30;
        drawBar(ctx, it.x - w / 2, it.y, w, 5, 1 - f, f < 0.6 ? BAR.warn : f < 0.85 ? '#f08a2a' : BAR.bad);
        drawIcon(ctx, f < 0.6 ? 'face_neutral' : f < 0.85 ? 'face_annoyed' : 'face_furious', it.x, it.y - 11, 18, f < 0.6 ? '😐' : f < 0.85 ? '😠' : '🤬');
      });
      G.customers.guests.forEach((g) => {
        if (g.dead || g.leaving || g.ambientStage !== 'ordering' || g.ambientChannel !== 'kiosk' || !g.orderTotal) return;
        const f = Math.max(0, Math.min(1, 1 - g.orderWait / g.orderTotal)), w = 30;
        drawBar(ctx, g.x - w / 2, g.y - 62, w, 5, f, BAR.info);
        drawIcon(ctx, 'kiosk', g.x, g.y - 73, 18, '🖥️');
      });
      // icono de estado: solo para clientes con un estado informativo (no repite la barra de impaciencia)
      G.customers.guests.forEach((g) => {
        if (g.dead || g.patience > 0.3) return;
        const st = G.customers.stateOf(g), ic = BK.CUSTOMER_STATE_ICON[st];
        if (!ic || st === 'WAITING' || st === 'SEATED') return;
        drawIcon(ctx, STATE_ICON[st], g.x, g.y - 58, 17, ic);
      });
    }

    // Lluvia: solo en el exterior (el edificio se recorta con una máscara even-odd); el interior no cambia.
    drawRain(ctx, now, rm) {
      const G = this.G;
      if (G.state !== 'playing') return;
      const level = BK.ArrivalDirector.rainLevel(G.cfg, G.dayProfile, G.clock.t);
      if (level <= 0.01) return;
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, MW, MH);
      (G.map.indoor || INDOOR).forEach((r) => ctx.rect(r[0], r[1], r[2] - r[0], r[3] - r[1]));
      ctx.clip('evenodd');
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = 'rgba(150,165,195,' + (0.62 * level).toFixed(3) + ')';
      ctx.fillRect(0, 0, MW, MH);
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = 'rgba(70,95,135,' + (0.16 * level).toFixed(3) + ')';
      ctx.fillRect(0, 0, MW, MH);
      const n = Math.round(520 * level), fall = rm ? 0 : now, hash = (i, k) => { const v = Math.sin(i * 127.1 + k * 311.7) * 43758.5453; return v - Math.floor(v); };
      const slant = 0.22, speed = 780;
      ctx.strokeStyle = 'rgba(205,222,245,' + (0.5 * Math.min(1, level + 0.2)).toFixed(3) + ')';
      ctx.lineWidth = 1.3; ctx.lineCap = 'round';
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const len = 16 + hash(i, 3) * 14, sp = speed * (0.85 + hash(i, 4) * 0.3);
        const span = MH + 60, y = ((hash(i, 2) * span + fall * sp) % span) - 30;
        const x = (hash(i, 1) * (MW + 300) - y * slant) - 0;
        ctx.moveTo(x, y); ctx.lineTo(x - len * slant, y + len);
      }
      ctx.stroke();
      ctx.strokeStyle = 'rgba(215,230,250,0.35)'; ctx.lineWidth = 1;
      for (let i = 0; i < Math.round(70 * level); i++) {
        const ph = ((fall * 0.9 + hash(i, 7) * 3) % 1.4) / 1.4, x = hash(i, 5) * MW, y = 40 + hash(i, 6) * (MH - 80);
        ctx.globalAlpha = 1 - ph; ctx.beginPath(); ctx.ellipse(x, y, 3 + ph * 11, (3 + ph * 11) * 0.4, 0, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.restore();
    }

    drawCoverageHighlight(ctx, now, reduceMotion) {
      const G = this.G;
      const positions = new Set([this.coverageHighlight, G.manager.coveringPosition].filter(Boolean));
      for (const position of positions) {
        const station = G.cfg.operations.stations[position];
        if (!station) continue;
        const supporting = G.manager.coveringPosition === position;
        const [x, y] = station.pos, pulse = reduceMotion ? 0 : Math.sin(now * 3) * 2;
        ctx.save();
        ctx.fillStyle = supporting ? 'rgba(244,122,44,0.2)' : 'rgba(255,210,122,0.18)';
        ctx.strokeStyle = supporting ? 'rgba(244,122,44,0.92)' : 'rgba(255,210,122,0.88)';
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.ellipse(x, y + 6, 32 + pulse, 15 + pulse * 0.3, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        if (supporting) {
          ctx.font = 'bold 12px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
          ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(35,24,17,0.9)'; ctx.strokeText(this.G.roleWord(true) + ' APOYANDO', x, y - 18);
          ctx.fillStyle = '#fff3d4'; ctx.fillText(this.G.roleWord(true) + ' APOYANDO', x, y - 18);
        }
        ctx.restore();
      }
    }

    drawTables(ctx) {
      for (const t of this.G.customers.tables) {
        if (t.state !== 'dirty') continue;
        const [x1, y1, x2, y2] = t.top, w = x2 - x1, h = y2 - y1;
        ctx.save();
        const tray = BK.SpriteLoader && BK.SpriteLoader.prop('bandejaSucia');
        if (tray && tray.img) {
          // bandeja ilustrada con restos, ajustada a la mesa
          const k = Math.min((w * 0.8) / tray.p.w, (h * 0.85) / tray.p.h, 1.2), tw = tray.p.w * k, th = tray.p.h * k;
          ctx.drawImage(tray.img, (x1 + x2) / 2 - tw / 2, (y1 + y2) / 2 - th / 2, tw, th);
        } else {
          ctx.fillStyle = 'rgba(90,55,25,0.28)'; ctx.fillRect(x1, y1, w, h);
          [[0.3, 0.3], [0.7, 0.62], [0.35, 0.78]].forEach(([fx, fy], i) => {
            const px = x1 + w * fx, py = y1 + h * Math.min(0.85, fy);
            ctx.fillStyle = '#efe6d4'; ctx.beginPath(); ctx.ellipse(px, py, 5.5, 3.6, 0, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = i === 1 ? '#d83b2d' : '#8b5a2b'; ctx.beginPath(); ctx.ellipse(px + 0.5, py, 2.6, 1.7, 0, 0, Math.PI * 2); ctx.fill();
          });
        }
        const a = this.G.player.char.action;
        const cleaning = a && a.dur > 0 && this.G.events.list.some((e) => e.type === 'dirtyTable' && e.state === 'inProgress' && e.targetEntity === t);
        if (cleaning) {
          const f = Math.min(1, a.t / a.dur), bw = 40, bx = (x1 + x2) / 2 - bw / 2, by = y1 - 12;
          drawBar(ctx, bx, by, bw, 6, f, BAR.good);
          ctx.font = 'bold 9px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
          ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(24,16,11,0.9)'; ctx.strokeText('LIMPIANDO', (x1 + x2) / 2, by - 3);
          ctx.fillStyle = '#fff3d4'; ctx.fillText('LIMPIANDO', (x1 + x2) / 2, by - 3);
        }
        ctx.restore();
      }
    }
    drawBag(ctx) {
      const ev = this.G.events.list.find((e) => e.type === 'pendingOrder' && this.G.events.isLive(e));
      if (!ev) return;
      const x = 706, y = 650;
      ctx.save();
      ctx.fillStyle = '#b98a54'; ctx.fillRect(x - 7, y - 10, 14, 16);
      ctx.fillStyle = '#d4a86a'; ctx.fillRect(x - 7, y - 10, 14, 4);
      ctx.fillStyle = '#d83b2d'; ctx.fillRect(x - 3, y - 4, 6, 5);
      ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 0.8; ctx.strokeRect(x - 7, y - 10, 14, 16);
      ctx.restore();
    }
    // Vida de cocina y entrega: bolsas listas en expedición, bolsa que pasa de la ventana al coche y vapor
    // sobre freidora y parrilla. Todo se calcula a partir del reloj (sin crear objetos por frame).
    drawKitchenLife(ctx, now, rm) {
      const G = this.G, SL = BK.SpriteLoader;
      if (!SL || G.state !== 'playing') return;
      const bag = SL.prop('bolsa'), st = G.map.stations || {};
      if (bag && bag.img) {
        const exp = (G.map.spots && G.map.spots.pendingOrder) || (st.expedition && { x: st.expedition.pos[0], y: st.expedition.pos[1] });
        if (exp) {
          let n = 0;
          for (const o of G.production.orders) if ((o.status === 'ready' || o.status === 'awaiting-channel') && o.channel !== 'autoking' && o.channel !== 'dining') n++;
          for (let i = 0; i < Math.min(4, n); i++) ctx.drawImage(bag.img, exp.x + 14 + (i % 2) * 11, exp.y - 24 - Math.floor(i / 2) * 9 + (i % 2) * 3, bag.p.w, bag.p.h);
        }
        const win = (G.map.spots && G.map.spots.vehicle) || { x: 650, y: 762 };
        for (const c of G.vehicles.cars) {
          if (c.state !== 'leaving' || c.serviceResult !== 'resolved' || !(c.dwellLeft > 0) || !c.dwell) continue;
          const k = Math.min(1, 1 - c.dwellLeft / c.dwell), e = k * k * (3 - 2 * k);
          const bx = win.x + (c.x - win.x) * e, by = win.y + (c.y - win.y) * e - Math.sin(Math.PI * e) * 14;
          ctx.drawImage(bag.img, bx - bag.p.w / 2, by - bag.p.h, bag.p.w, bag.p.h);
        }
      }
      const vap = SL.prop('vapor');
      if (!vap || !vap.img || rm || G.clock.t < 660) return;
      const src = ['fryer', 'grill', 'fries', 'chef'].map((k) => st[k]).filter(Boolean);
      ctx.save();
      src.forEach((s, j) => {
        for (let i = 0; i < 3; i++) {
          const ph = ((now * 0.45 + i / 3 + j * 0.37) % 1), a = Math.sin(Math.PI * ph) * 0.45;
          const x = s.pos[0] + Math.sin(now * 1.3 + i * 2.1 + j) * 5 + (i - 1) * 6, y = s.pos[1] - 28 - ph * 34, k = 0.6 + ph * 0.7;
          ctx.globalAlpha = a; ctx.drawImage(vap.img, x - vap.p.w * k / 2, y - vap.p.h * k / 2, vap.p.w * k, vap.p.h * k);
        }
      });
      ctx.restore();
    }
    drawCarton(ctx, x, y, scale = 1) {
      const box = BK.SpriteLoader && BK.SpriteLoader.prop('caja');
      if (box && box.img) {
        const w = box.p.w * scale, h = box.p.h * scale;
        ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.ellipse(x + 1, y + h * 0.42, w * 0.5, h * 0.18, 0, 0, Math.PI * 2); ctx.fill();
        ctx.drawImage(box.img, x - w / 2, y - h / 2, w, h);
        return;
      }
      ctx.save();
      ctx.translate(x, y); ctx.scale(scale, scale);
      ctx.fillStyle = '#8b5a32'; ctx.fillRect(-9, -7, 18, 14);
      ctx.fillStyle = '#b9824b'; ctx.fillRect(-8, -6, 16, 4);
      ctx.fillStyle = '#d4a36a'; ctx.fillRect(-1, -6, 2, 13);
      ctx.strokeStyle = '#51351f'; ctx.lineWidth = 1; ctx.strokeRect(-9, -7, 18, 14);
      ctx.restore();
    }
    drawTruckDelivery(ctx) {
      const delivery = this.G.truckDelivery;
      if (!delivery || !delivery.active || !delivery.truck) return;
      const truck = delivery.truck;
      const ts = BK.SpriteLoader && BK.SpriteLoader.truck();
      if (ts) {
        // camión frigorífico de Conway (sprite cenital): claramente mayor que un turismo, puertas traseras hacia -x
        const L = ts.t.len, Wd = ts.t.wid;
        ctx.save(); ctx.translate(truck.x, truck.y); ctx.rotate(truck.angle);
        ctx.fillStyle = 'rgba(0,0,0,0.3)'; roundRect(ctx, -L / 2 + 4, -Wd / 2 + 5, L - 2, Wd - 2, 6); ctx.fill();
        ctx.drawImage(ts.img, -L / 2, -Wd / 2, L, Wd);
        ctx.restore();
      } else {
      ctx.save();
      ctx.translate(truck.x, truck.y); ctx.rotate(truck.angle); ctx.scale(1.3, 1.3);
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      ctx.beginPath(); ctx.ellipse(0, 3, 43, 21, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#26211d';
      [[-27, -17], [-27, 17], [29, -17], [29, 17]].forEach(([x, y]) => {
        ctx.beginPath(); ctx.ellipse(x, y, 7, 4, 0, 0, Math.PI * 2); ctx.fill();
      });
      ctx.fillStyle = '#f5f5f2'; ctx.strokeStyle = '#4d4842'; ctx.lineWidth = 1.5;
      ctx.fillRect(-40, -15, 49, 30); ctx.strokeRect(-40, -15, 49, 30);
      ctx.fillRect(9, -16, 24, 32); ctx.strokeRect(9, -16, 24, 32);
      ctx.fillStyle = '#a8d1dc'; ctx.fillRect(22, -11, 8, 22);
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(-2, -13); ctx.lineTo(-2, 13); ctx.stroke();
      ctx.font = 'bold 7px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = '#37332e'; ctx.fillText('CONWAY', -21, 1);
      ctx.fillStyle = '#f7f0db';
      ctx.fillRect(31, -10, 4, 6); ctx.fillRect(31, 4, 4, 6);
      if (delivery.boxes.some((b) => b.status !== 'delivered' && b.status !== 'carried')) {
        ctx.fillStyle = '#c99158'; ctx.strokeStyle = '#51351f'; ctx.lineWidth = 1;
        [[-38, -12], [-38, -2], [-38, 8], [-29, -7], [-29, 3]].forEach(([x, y]) => {
          ctx.fillRect(x, y, 8, 8); ctx.strokeRect(x, y, 8, 8);
        });
      }
      ctx.restore();
      }
      delivery.boxes.forEach((box) => {
        if (box.status === 'delivered' || box.status === 'carried') return;
        this.drawCarton(ctx, box.x, box.y);
      });
      if (delivery.boxes.length && delivery.state !== 'arriving' && delivery.state !== 'leaving') {
        ctx.save();
        ctx.font = 'bold 11px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
        const label = 'CONWAY · DESCARGA ' + delivery.transferredCount + '/' + delivery.boxes.length;
        ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(35,24,17,0.9)'; ctx.strokeText(label, truck.x + 210, truck.y - 85);
        ctx.fillStyle = '#fff3d4'; ctx.fillText(label, truck.x + 210, truck.y - 85);
        ctx.restore();
      }
    }
    drawPoints(ctx, now, rm) {
      const G = this.G;
      // marcador de destino del avatar
      const m = G.player.marker;
      if (m) {
        const a = m.bad ? 1 - m.t / 1.4 : 1;
        ctx.save(); ctx.globalAlpha = U.clamp(a, 0, 1);
        ctx.strokeStyle = m.bad ? '#ff5a4a' : '#ffd9a8'; ctx.lineWidth = 2.4;
        const r = 9 + (rm ? 0 : Math.sin(now * 6) * 1.5);
        ctx.beginPath(); ctx.ellipse(m.x, m.y, r, r * 0.55, 0, 0, Math.PI * 2); ctx.stroke();
        if (m.bad) { ctx.beginPath(); ctx.moveTo(m.x - 6, m.y - 6); ctx.lineTo(m.x + 6, m.y + 6); ctx.moveTo(m.x + 6, m.y - 6); ctx.lineTo(m.x - 6, m.y + 6); ctx.stroke(); }
        ctx.restore();
      }
      // aros de los puntos de apertura
      if (G.state !== 'playing') return;
      this.drawFreeStations(ctx, now, rm);
      this.drawPrepPoint(ctx, now, rm);
      G.interaction.items().forEach((it) => {
        if (it.done) return;
        const pulse = rm ? 0 : (Math.sin(now * 3.2) + 1) * 0.5;
        ctx.save();
        ctx.strokeStyle = it.locked ? 'rgba(200,200,200,0.6)' : 'rgba(255,190,90,0.95)'; ctx.lineWidth = 2.6;
        ctx.setLineDash(it.locked ? [5, 4] : []);
        ctx.fillStyle = it.locked ? 'rgba(150,150,150,0.12)' : 'rgba(255,170,60,' + (0.12 + pulse * 0.12) + ')';
        const r = 17 + pulse * 3;
        ctx.beginPath(); ctx.ellipse(it.x, it.y + 2, r, r * 0.58, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.restore();
      });
    }
    stationGuidance() {
      const G = this.G, ops = G.cfg.operations;
      return ops.positioningOrder.filter((id) => {
        const st = ops.stations[id], inf = ops.stationInfo[id];
        return st && inf && st.category !== 'support' && inf.recommended > 0;
      }).map((id) => {
        const st = ops.stations[id], inf = ops.stationInfo[id];
        const hotspot = G.bottlenecks.items.find((item) => item.station === id);
        return hotspot ? { id, x: st.pos[0], y: st.pos[1], hotspot } : null;
      }).filter(Boolean);
    }
    drawStationGuidance(ctx, now, rm) {
      const G = this.G;
      this.stationHits = [];
      if (G.ui.el.operationsPanel.hidden) return;
      const guidance = this.stationGuidance(), pulse = rm ? 0 : (Math.sin(now * 3) + 1) * 0.5;
      guidance.forEach((station) => {
        const p = this.toScreen(station.x, station.y);
        if (p.x < -80 || p.x > this.W + 80 || p.y < -50 || p.y > this.H + 50) return;
        const hot = station.hotspot, critical = hot.severity === 'critical';
        ctx.save();
        ctx.lineWidth = 3;
        ctx.strokeStyle = critical ? '#ff4b3e' : '#ffc247';
        ctx.fillStyle = critical ? 'rgba(229,72,59,' + (0.2 + pulse * 0.18) + ')' : 'rgba(242,183,43,' + (0.16 + pulse * 0.16) + ')';
        const r = 18 + pulse * 3;
        ctx.beginPath(); ctx.ellipse(p.x, p.y, r, r * 0.64, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.restore();
        this.stationHits.push({ id: station.id, x: p.x, y: p.y, r: 24 });
      });
    }
    stationAt(sx, sy) {
      const hits = this.stationHits || [];
      return hits.filter((s) => Math.hypot(s.x - sx, s.y - sy) <= s.r)
        .sort((a, b) => Math.hypot(a.x - sx, a.y - sy) - Math.hypot(b.x - sx, b.y - sy))[0] || null;
    }
    freeStations() {
      const G = this.G, ops = G.cfg.operations, staffed = new Set();
      G.employees.list.forEach((c) => { if (c.available && !c.absent && c.position) staffed.add(c.position); });
      return ops.positioningOrder.filter((id) => {
        const st = ops.stations[id];
        return st && st.category !== 'support' && !staffed.has(id) && G.manager.coveringPosition !== id;
      }).map((id) => ({ id, x: ops.stations[id].pos[0], y: ops.stations[id].pos[1] }));
    }
    drawFreeStations(ctx, now, rm) {
      this.freeHits = this.freeStations();
      const pulse = rm ? 0 : (Math.sin(now * 2.4) + 1) * 0.5;
      this.freeHits.forEach((f) => {
        ctx.save();
        ctx.fillStyle = 'rgba(8,6,5,' + (0.5 + pulse * 0.12) + ')';
        ctx.strokeStyle = 'rgba(255,255,255,0.28)'; ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.ellipse(f.x, f.y + 2, 15, 6.8, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.restore();
      });
    }
    freeStationAt(wx, wy) {
      return (this.freeHits || []).find((f) => Math.abs(f.x - wx) <= 22 && Math.abs(f.y + 2 - wy) <= 16) || null;
    }
    drawPrepPoint(ctx, now, rm) {
      const pulse = rm ? 0 : (Math.sin(now * 2.4) + 1) * 0.5;
      const pp = this.G.map.points.productPrep;
      if (pp) {
        const need = this.G.production.needsPrep();
        ctx.save();
        ctx.strokeStyle = need ? 'rgba(255,190,90,0.95)' : 'rgba(150,215,255,0.7)'; ctx.lineWidth = 2.2;
        ctx.fillStyle = need ? 'rgba(255,170,60,' + (0.14 + pulse * 0.14) + ')' : 'rgba(120,190,255,0.12)';
        const r = 16 + (need ? pulse * 3 : 0);
        ctx.beginPath(); ctx.ellipse(pp[0], pp[1] + 2, r, r * 0.58, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.font = 'bold 10px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#fff';
        ctx.shadowColor = 'rgba(0,0,0,0.8)'; ctx.shadowBlur = 3;
        ctx.fillText('📦 PREPARAR', pp[0], pp[1] - 14);
        ctx.restore();
      }
    }
    drawBriefingFormation(ctx, now, rm) {
      const G = this.G, briefing = G.briefing;
      if (!briefing || !briefing.active || !briefing.team.length) return;
      const p = briefing.point, pulse = rm ? 0 : Math.sin(now * 3) * 2;
      ctx.save();
      ctx.strokeStyle = 'rgba(255,210,122,0.65)';
      ctx.fillStyle = 'rgba(255,210,122,0.08)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(p.x - 48, p.y, 74 + pulse, 58 + pulse * 0.4, 0, -Math.PI / 2, Math.PI / 2);
      ctx.stroke();
      ctx.fill();
      ctx.restore();
    }
    drawDebug(ctx) {
      if (!this.dbgCanvas) {
        const nav = this.G.nav, c = document.createElement('canvas');
        c.width = MW; c.height = MH;
        const x = c.getContext('2d'), cell = nav.cell;
        for (let cy = 0; cy < nav.H; cy++) for (let cx = 0; cx < nav.W; cx++) {
          const i = cy * nav.W + cx;
          if (nav.obst[i]) { x.fillStyle = 'rgba(255,0,0,0.35)'; x.fillRect(cx * cell, cy * cell, cell, cell); }
          else if (nav.masks.staff[i]) { x.fillStyle = 'rgba(0,255,100,0.28)'; x.fillRect(cx * cell, cy * cell, cell, cell); }
          else if (nav.raw.staff[i]) { x.fillStyle = 'rgba(255,255,0,0.22)'; x.fillRect(cx * cell, cy * cell, cell, cell); }
        }
        this.dbgCanvas = c;
      }
      ctx.drawImage(this.dbgCanvas, 0, 0);
      const zones = this.G.map.orderDestinations || {};
      ctx.save(); ctx.lineWidth = 2; ctx.font = 'bold 13px system-ui, sans-serif'; ctx.textBaseline = 'top';
      Object.entries(zones).forEach(([id, z], i) => {
        if (!z.rect) return;
        const [x1, y1, x2, y2] = z.rect, hue = (i * 67) % 360;
        ctx.strokeStyle = 'hsl(' + hue + ',90%,60%)'; ctx.fillStyle = 'hsla(' + hue + ',90%,60%,0.14)';
        ctx.fillRect(x1, y1, x2 - x1, y2 - y1); ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
        ctx.fillStyle = '#fff'; ctx.fillText(id, x1 + 4, y1 + 4);
      });
      ctx.restore();
      const pc = this.G.player.char;
      if (pc.path.length) { ctx.strokeStyle = '#0ff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(pc.x, pc.y); pc.path.slice(pc.pi).forEach((p) => ctx.lineTo(p.x, p.y)); ctx.stroke(); }
    }

    drawIndicators(ctx, now, rm) {
      const G = this.G, E = G.events, T = G.cfg.timing;
      this.hits = []; this.badges = [];
      ctx.save();
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      // insignias de puntos de apertura
      if (G.state === 'playing') {
        G.interaction.items().forEach((it) => {
          if (it.done) return;
          const p = this.toScreen(it.x, it.y), y = p.y - 40;
          const bob = rm ? 0 : Math.sin(now * 3 + it.x) * 2;
          ctx.fillStyle = it.locked ? '#777' : it.kind === 'briefing' ? '#2fbf62' : '#f47a2c'; ctx.strokeStyle = '#fff6e8'; ctx.lineWidth = 2;
          shapePath(ctx, 'square', p.x, y + bob, 15);
          ctx.fill(); ctx.stroke();
          ctx.font = '17px system-ui, "Segoe UI Emoji", sans-serif'; ctx.fillStyle = '#fff';
          if (it.kind === 'briefing') drawIcon(ctx, 'briefing', p.x, y + bob, 24, '🗣️');
          else drawEmoji(ctx, it.task.action === 'door' ? '🚪' : it.task.icon || '📋', p.x, y + bob, 24);
          if (it.kind === 'briefing') {
            ctx.fillStyle = 'rgba(20,75,43,0.94)';
            ctx.fillRect(p.x - 29, y + bob - 27, 58, 12);
            ctx.font = 'bold 8px system-ui, sans-serif'; ctx.fillStyle = '#fff';
            ctx.fillText('BRIEFING', p.x, y + bob - 21);
          }
          this.badges.push({ x: p.x, y: y + bob, r: 24, it });
        });
      }
      // eventos
      for (const e of E.list) {
        if (!e.location) continue;
        const loc = e.location, wx = loc.x !== undefined ? loc.x : loc[0], wy = loc.y !== undefined ? loc.y : loc[1];
        const p = this.toScreen(wx, wy);
        const off = Math.max(e.lift * this.scale, 40);
        const live = E.isLive(e);
        if (live) {
          let sc = 1;
          if (e.state === 'appearing' && !rm) { const k = U.clamp(e.appearT / T.appearSec, 0, 1); sc = 0.3 + 0.7 * (1 + Math.sin(k * Math.PI * 1.5) * 0.25) * k + 0.2 * k; }
          const f = E.fraction(e);
          const col = f < T.excellentUntil ? '#2fbf62' : f < 0.75 ? '#f2b72b' : '#e5483b';
          const bob = rm ? 0 : Math.sin(now * 5 + wx) * (f > 0.75 ? 3 : 1.2);
          const cx = p.x, cy = p.y - off + bob, r = 16 * sc;
          // sombra y burbuja
          ctx.save();
          ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = 6;
          ctx.fillStyle = '#fff8ec';
          shapePath(ctx, e.visualIndicator.shape, cx, cy, r + 2); ctx.fill();
          ctx.restore();
          ctx.fillStyle = col; ctx.strokeStyle = '#3b2a21'; ctx.lineWidth = 2;
          shapePath(ctx, e.visualIndicator.shape, cx, cy, r); ctx.fill(); ctx.stroke();
          if (e.state === 'playerMoving' || e.state === 'acknowledged') {
            ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.setLineDash([4, 3]);
            shapePath(ctx, e.visualIndicator.shape, cx, cy, r + 6); ctx.stroke(); ctx.setLineDash([]);
          }
          // icono ilustrado: alerta (!) o en curso (…), sobre la forma de color del canal
          drawIcon(ctx, e.state === 'inProgress' ? 'talking' : 'alert', cx, cy, Math.round(26 * sc));
          if (!(BK.SpriteLoader && BK.SpriteLoader.icon('alert'))) {
            ctx.fillStyle = f >= 0.75 ? '#fff' : '#1f1f1f';
            ctx.font = 'bold ' + Math.round(20 * sc) + 'px system-ui, sans-serif';
            ctx.fillText(e.state === 'inProgress' ? '…' : '!', cx, cy + 1);
          }
          // icono pequeño del tipo
          ctx.font = '13px "Segoe UI Emoji", system-ui, sans-serif';
          ctx.fillStyle = '#fff'; ctx.strokeStyle = '#3b2a21'; ctx.lineWidth = 1;
          drawEmoji(ctx, e.visualIndicator.icon, cx + r + 6, cy - r + 2, 18);
          // barra de tiempo
          if (e.state !== 'inProgress') {
            const bw = 46, bh = 7, bx = cx - bw / 2, by = cy + r + 6;
            drawBar(ctx, bx, by, bw, bh, 1 - f, col);
            ctx.fillStyle = '#fff'; ctx.font = 'bold 10px system-ui, sans-serif';
            ctx.fillText(Math.ceil(E.remainingSec(e)) + 's', cx, by + bh + 9);
          }
          this.hits.push({ ev: e, x: cx, y: cy, r: Math.max(24, r + 8) });
        } else if (e.result && e.resultT <= T.resultIconSec) {
          const k = e.resultT / T.resultIconSec, a = k > 0.75 ? 1 - (k - 0.75) / 0.25 : 1;
          const shape = G.ev.results[e.result].shape, color = G.ev.results[e.result].color;
          const cx = p.x, cy = p.y - off - (rm ? 0 : k * 16), r = 17;
          ctx.save(); ctx.globalAlpha = a;
          ctx.fillStyle = color; ctx.strokeStyle = '#2a1d16'; ctx.lineWidth = 2.2;
          shapePath(ctx, shape, cx, cy, r); ctx.fill(); ctx.stroke();
          ctx.font = '20px "Segoe UI Emoji", system-ui, sans-serif'; ctx.fillStyle = '#000';
          if (e.result === 'excellent' && !rm && k < 0.6) {
            for (let i = 0; i < 6; i++) { const ang = i / 6 * Math.PI * 2 + 0.3, d = 14 + k * 46; drawIcon(ctx, 'star', cx + Math.cos(ang) * d, cy + Math.sin(ang) * d, 13 * (1 - k)); }
          }
          if (BK.SpriteLoader && BK.SpriteLoader.icon(FACE_ICON[e.result])) drawIcon(ctx, FACE_ICON[e.result], cx, cy, 30);
          else ctx.fillText(FACE[e.result], cx, cy + (e.result === 'failed' ? 4 : 1));
          if (e.points) {
            ctx.font = 'bold 13px system-ui, sans-serif'; ctx.lineWidth = 3; ctx.strokeStyle = '#2a1d16';
            const txt = (e.points > 0 ? '+' : '') + e.points;
            ctx.strokeText(txt, cx, cy + r + 13); ctx.fillStyle = e.points > 0 ? '#9ff0b6' : '#ff9d92'; ctx.fillText(txt, cx, cy + r + 13);
          }
          ctx.restore();
        }
      }
      ctx.restore();
    }
    drawFloaters(ctx) {
      ctx.save(); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      this.floaters.forEach((f) => {
        const p = this.toScreen(f.x, f.y), a = 1 - f.t / 1.8;
        ctx.globalAlpha = Math.max(0, a); ctx.font = 'bold 20px system-ui, sans-serif'; ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(30,18,12,0.9)';
        const y = p.y - f.t * 28;
        ctx.strokeText(f.text, p.x, y); ctx.fillStyle = f.good ? '#9ff0b6' : '#ff9d92'; ctx.fillText(f.text, p.x, y);
      });
      ctx.restore();
    }

    bindInput(onTap) {
      const cv = this.cv, ptrs = new Map();
      let moved = false, startT = 0, pinch = null, startPos = null;
      const rel = (e) => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
      cv.addEventListener('pointerdown', (e) => {
        cv.setPointerCapture(e.pointerId);
        ptrs.set(e.pointerId, rel(e));
        if (ptrs.size === 1) { moved = false; startT = performance.now(); startPos = rel(e); }
        if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), z: this.zoomTarget }; moved = true; }
      });
      cv.addEventListener('pointermove', (e) => {
        if (!ptrs.has(e.pointerId)) return;
        const p = rel(e), prev = ptrs.get(e.pointerId);
        ptrs.set(e.pointerId, p);
        if (ptrs.size === 2 && pinch) {
          const [a, b] = [...ptrs.values()];
          this.setZoom(pinch.z * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.d));
          this.cam.zoom = this.zoomTarget; this.clampCam();
          return;
        }
        if (startPos && Math.hypot(p.x - startPos.x, p.y - startPos.y) > 10) moved = true;
        if (moved && ptrs.size === 1 && !this.follow && this.cam.zoom > 1.01) this.pan(p.x - prev.x, p.y - prev.y);
      });
      const up = (e) => {
        if (!ptrs.has(e.pointerId)) return;
        const p = ptrs.get(e.pointerId);
        ptrs.delete(e.pointerId);
        if (ptrs.size < 2) pinch = null;
        if (!moved && e.type === 'pointerup' && performance.now() - startT < 700) onTap(p.x, p.y);
      };
      cv.addEventListener('pointerup', up);
      cv.addEventListener('pointercancel', up);
      cv.addEventListener('wheel', (e) => { e.preventDefault(); this.zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15); }, { passive: false });
      cv.addEventListener('contextmenu', (e) => e.preventDefault());
      ['gesturestart', 'gesturechange'].forEach((n) => cv.addEventListener(n, (e) => e.preventDefault()));
    }
  }
  BK.Renderer = Renderer;
})();
