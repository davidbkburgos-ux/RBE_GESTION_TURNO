(function () {
  const BK = window.BK;
  const U = BK.util;
  const MW = 1536, MH = 1024;
  // Marcas disponibles: plano de fondo (el de Burger King sale de map.json).
  BK.BRAND_MAPS = { bk: 'assets/map/plano_limpio.png', popeyes: 'assets/map/plano_popeyes.png' };
  // Huella del edificio (sin solapes, para la máscara even-odd de la lluvia).
  const INDOOR = [[168, 296, 1348, 792], [1148, 204, 1338, 296]];

  const FACE = { excellent: '😀', acceptable: '😐', failed: '😠' };

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
    // Cambia el plano de fondo según la marca; las imágenes se cargan una sola vez y se reutilizan.
    setBrand(brand) {
      const maps = BK.BRAND_MAPS, key = maps[brand] ? brand : 'bk';
      let im = this.imgs[key];
      if (!im) {
        im = this.imgs[key] = new Image();
        im.ready = false;
        im.onload = () => { im.ready = true; if (this.img === im) this.imgReady = true; };
        im.src = key === 'bk' ? this.G.map.meta.image : maps[key];
      }
      this.img = im; this.imgReady = im.ready;
    }
    resize() {
      const r = this.cv.parentElement.getBoundingClientRect();
      const W = Math.max(200, Math.round(r.width)), H = Math.max(150, Math.round(r.height));
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (W === this.W && H === this.H && dpr === this.dpr && this.cv.width) return;
      this.W = W; this.H = H; this.dpr = dpr;
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
    }
    zoomBy(f) { this.setZoom(this.zoomTarget * f); }
    pan(dx, dy) { this.cam.x -= dx / this.scale; this.cam.y -= dy / this.scale; this.clampCam(); }
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
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.fillStyle = '#17100c'; ctx.fillRect(0, 0, this.W, this.H);
      if (!this.imgReady) return;
      ctx.save();
      ctx.translate(this.W / 2 - this.cam.x * s, this.H / 2 - this.cam.y * s);
      ctx.scale(s, s);
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(this.img, 0, 0, MW, MH);

      this.drawTables(ctx);
      this.drawBag(ctx);
      this.drawPoints(ctx, now, rm);
      this.drawCoverageHighlight(ctx, now, rm);
      if (this.debug) this.drawDebug(ctx);
      this.drawBriefingFormation(ctx, now, rm);

      // vehículos (suelo) y luego personajes por profundidad
      G.vehicles.cars.forEach((c) => {
        const sp = BK.carSprite(c.color, c.len, c.wid, c.body, c.acc);
        ctx.save(); ctx.translate(c.x, c.y); ctx.rotate(c.ang);
        ctx.drawImage(sp.canvas, -(c.len / 2 + sp.pad), -(c.wid / 2 + sp.pad), c.len + sp.pad * 2, c.wid + sp.pad * 2);
        ctx.restore();
        const b = G.vehicles.bar(c);
        if (b) {
          const w = 46, h = 7, x = c.x - w / 2, y = c.y - 40, f = Math.min(1, b.f);
          ctx.save();
          ctx.fillStyle = 'rgba(20,14,10,0.78)'; ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
          ctx.fillStyle = b.f <= 1 ? '#5fbf5a' : b.f <= 1.5 ? '#e8b23a' : '#d9473a';
          ctx.fillRect(x, y, w * f, h);
          ctx.font = 'bold 9px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#fff';
          ctx.fillText(b.label, c.x, y - 3);
          ctx.restore();
        }
      });
      this.drawTruckDelivery(ctx);
      const chars = [G.player.char].concat(G.employees.list, G.customers.guests);
      chars.sort((a, b) => a.y - b.y);
      const sc = (BK.CHAR_SCALE || 1);
      chars.forEach((c) => {
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
      G.lighting.draw(ctx, MW, MH);
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
          ctx.fillStyle = 'rgba(255,255,255,0.2)'; ctx.fillRect(bx, by, bw, 5 * k);
          ctx.fillStyle = b.manager ? '#f47a2c' : '#8fd18a'; ctx.fillRect(bx, by, bw * b.f, 5 * k);
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
          ctx.fillStyle = 'rgba(255,255,255,0.2)'; ctx.fillRect(bx, by, bw, 5 * k);
          ctx.fillStyle = '#f47a2c'; ctx.fillRect(bx, by, bw * f, 5 * k);
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
        ctx.save();
        ctx.fillStyle = 'rgba(20,12,8,0.75)'; ctx.fillRect(it.x - w / 2 - 1, it.y - 1, w + 2, 7);
        ctx.fillStyle = f < 0.6 ? '#f2c230' : f < 0.85 ? '#f08a2a' : '#e5483b';
        ctx.fillRect(it.x - w / 2, it.y, w * (1 - f), 5);
        ctx.font = '15px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
        ctx.fillText(f < 0.6 ? '😐' : f < 0.85 ? '😠' : '🤬', it.x, it.y - 2);
        ctx.restore();
      });
      G.customers.guests.forEach((g) => {
        if (g.dead || g.leaving || g.ambientStage !== 'ordering' || g.ambientChannel !== 'kiosk' || !g.orderTotal) return;
        const f = Math.max(0, Math.min(1, 1 - g.orderWait / g.orderTotal)), w = 30;
        ctx.save();
        ctx.fillStyle = 'rgba(20,12,8,0.75)'; ctx.fillRect(g.x - w / 2 - 1, g.y - 63, w + 2, 7);
        ctx.fillStyle = '#4fa3e0'; ctx.fillRect(g.x - w / 2, g.y - 62, w * f, 5);
        ctx.font = '13px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
        ctx.fillText('🖥️', g.x, g.y - 65);
        ctx.restore();
      });
      // icono de estado: solo para clientes con un estado informativo (no repite la barra de impaciencia)
      G.customers.guests.forEach((g) => {
        if (g.dead || g.patience > 0.3) return;
        const st = G.customers.stateOf(g), ic = BK.CUSTOMER_STATE_ICON[st];
        if (!ic || st === 'WAITING' || st === 'SEATED') return;
        ctx.save(); ctx.font = '14px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
        ctx.fillText(ic, g.x, g.y - 50); ctx.restore();
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
          ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(35,24,17,0.9)'; ctx.strokeText('ENCARGADO APOYANDO', x, y - 18);
          ctx.fillStyle = '#fff3d4'; ctx.fillText('ENCARGADO APOYANDO', x, y - 18);
        }
        ctx.restore();
      }
    }

    drawTables(ctx) {
      for (const t of this.G.customers.tables) {
        if (t.state !== 'dirty') continue;
        const [x1, y1, x2, y2] = t.top, w = x2 - x1, h = y2 - y1;
        ctx.save();
        ctx.fillStyle = 'rgba(90,55,25,0.28)'; ctx.fillRect(x1, y1, w, h);
        const plates = [[0.3, 0.3], [0.7, 0.62], [0.35, 0.78]];
        plates.forEach(([fx, fy], i) => {
          const px = x1 + w * fx, py = y1 + h * Math.min(0.85, fy);
          ctx.fillStyle = '#efe6d4'; ctx.beginPath(); ctx.ellipse(px, py, 5.5, 3.6, 0, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = i === 1 ? '#d83b2d' : '#8b5a2b'; ctx.beginPath(); ctx.ellipse(px + 0.5, py, 2.6, 1.7, 0, 0, Math.PI * 2); ctx.fill();
        });
        ctx.fillStyle = '#f47a2c'; ctx.fillRect(x1 + w * 0.55, y1 + h * 0.2, 4, 6);
        ctx.fillStyle = '#c9b48a'; ctx.beginPath(); ctx.arc(x1 + w * 0.2, y1 + h * 0.62, 2.4, 0, Math.PI * 2); ctx.fill();
        const a = this.G.player.char.action;
        const cleaning = a && a.dur > 0 && this.G.events.list.some((e) => e.type === 'dirtyTable' && e.state === 'inProgress' && e.targetEntity === t);
        if (cleaning) {
          const f = Math.min(1, a.t / a.dur), bw = 36, bx = (x1 + x2) / 2 - bw / 2, by = y1 - 14;
          ctx.fillStyle = 'rgba(20,12,8,0.8)'; ctx.fillRect(bx - 1, by - 1, bw + 2, 8);
          ctx.fillStyle = '#5fc46a'; ctx.fillRect(bx, by, bw * f, 6);
          ctx.font = 'bold 9px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
          ctx.fillStyle = '#fff3d4'; ctx.fillText('LIMPIANDO', (x1 + x2) / 2, by - 1);
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
    drawCarton(ctx, x, y, scale = 1) {
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
          ctx.fillText(it.kind === 'briefing' ? '🗣️' : it.task.action === 'door' ? '🚪' : it.task.icon || '📋', p.x, y + bob + 1);
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
          ctx.fillStyle = f >= 0.75 ? '#fff' : '#1f1f1f';
          ctx.font = 'bold ' + Math.round(20 * sc) + 'px system-ui, sans-serif';
          ctx.fillText(e.state === 'inProgress' ? '…' : '!', cx, cy + 1);
          // icono pequeño del tipo
          ctx.font = '13px "Segoe UI Emoji", system-ui, sans-serif';
          ctx.fillStyle = '#fff'; ctx.strokeStyle = '#3b2a21'; ctx.lineWidth = 1;
          ctx.fillText(e.visualIndicator.icon, cx + r + 6, cy - r + 2);
          // barra de tiempo
          if (e.state !== 'inProgress') {
            const bw = 46, bh = 7, bx = cx - bw / 2, by = cy + r + 6;
            ctx.fillStyle = 'rgba(30,20,14,0.85)'; ctx.fillRect(bx - 1.5, by - 1.5, bw + 3, bh + 3);
            ctx.fillStyle = col; ctx.fillRect(bx, by, bw * (1 - f), bh);
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
          ctx.fillText(FACE[e.result], cx, cy + (e.result === 'failed' ? 4 : 1));
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
