(function () {
  const BK = window.BK;

  // Cargador de sprites HD-2D descritos en assets/manifest.json.
  // Solo capa visual: lee el estado del personaje (pal, dir, anim, walkPhase, animT) y nunca lo modifica.
  // Si un personaje aún no tiene hoja en el manifest (o la imagen no ha cargado), draw() devuelve false
  // y CharacterAnimationSystem usa su dibujo procedural.

  // dir del juego (0=S, 1=SE, 2=E, 3=NE, 4=N, 5=NW, 6=W, 7=SW) -> 4 direcciones del sprite.
  // Las diagonales usan la vista de perfil: es la que mejor lee el desplazamiento en planta.
  const DIR4 = ['down', 'right', 'right', 'right', 'up', 'left', 'left', 'left'];
  // Acciones del juego -> animación del sprite (con alternativas por orden de preferencia)
  const ANIM = {
    walk: ['walk'], idle: ['idle'],
    work: ['work'], clean: ['work'], inspect: ['work'], kiosk: ['work'], door: ['work'], talk: ['work', 'idle'], point: ['work', 'idle'],
    deliver: ['deliver', 'work'], sit: ['sit', 'idle'], eat: ['sit', 'idle'], reactGood: ['idle'], reactBad: ['idle']
  };
  const WALK_STRIDE = 62; // px recorridos por ciclo completo de caminar (igual que el procedural: sin patinar)

  const SpriteLoader = {
    manifest: null, images: {}, ready: {}, getSettings: () => ({}),

    init(manifest, getSettings) {
      this.manifest = manifest || null;
      if (getSettings) this.getSettings = getSettings;
      if (!this.manifest) return;
      Object.values(this.manifest.characters || {}).forEach((c) => this.load(c.sheet));
      Object.values(this.manifest.props || {}).forEach((p) => this.load(p.src));
      Object.values(this.manifest.icons || {}).forEach((src) => this.load(src));
      const V = this.manifest.vehicles || {};
      (V.cars || []).forEach((c) => this.load(c.src));
      if (V.truck) this.load(V.truck.src);
    },

    failed: {},
    load(src) {
      if (!src || this.images[src]) return this.images[src];
      const img = new Image();
      img.onload = () => { this.ready[src] = true; if (BK.game && BK.game.renderer) BK.game.renderer.dirty = true; };
      img.onerror = () => { this.ready[src] = false; this.failed[src] = true; console.warn('[sprites] no se pudo cargar', src); };
      img.src = src;
      this.images[src] = img;
      return img;
    },
    image(src) { const img = this.load(src); return this.ready[src] ? img : null; },
    // Icono ilustrado por nombre (assets/ui/icons), o null si no existe o aún carga.
    icon(name) { const src = this.manifest && this.manifest.icons && this.manifest.icons[name]; return src ? this.image(src) : null; },
    prop(name) { const p = this.manifest && this.manifest.props && this.manifest.props[name]; return p ? { p, img: this.image(p.src) } : null; },
    // Sprite cenital de un coche: variante estable por id del vehículo.
    car(id) {
      const cars = this.manifest && this.manifest.vehicles && this.manifest.vehicles.cars;
      if (!cars || !cars.length) return null;
      let h = 0; for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) | 0;
      const c = cars[Math.abs(h) % cars.length], img = this.image(c.src);
      return img ? { c, img } : null;
    },
    truck() {
      const t = this.manifest && this.manifest.vehicles && this.manifest.vehicles.truck;
      const img = t && this.image(t.src);
      return img ? { t, img } : null;
    },

    brand() { return (BK.game && BK.game.brand) || (this.getSettings() || {}).brand || 'bk'; },
    // 'm' / 'f' según el ajuste managerGender de la partida
    avatarKey() { return (this.getSettings() || {}).managerGender === 'f' ? 'f' : 'm'; },

    // Qué hoja de personaje corresponde a una paleta del juego, según marca y avatar elegidos.
    // Ids de hoja candidatos para una paleta del juego, en orden de preferencia.
    candidates(ch) {
      const M = this.manifest;
      if (!M || !ch || !ch.pal) return [];
      const P = M.palettes || {}, brand = this.brand();
      if (ch.pal === 'manager' || ch.pal === 'managerF') {
        // uniforme por marca y género del avatar elegido; si falta la hoja de esa marca, la de BK
        return this.avatarField(ch.pal === 'managerF' ? 'f' : 'm', 'character', brand);
      }
      if (ch.pal.startsWith('employee')) {
        // plantilla mixta: [chico, chica] por marca, según el aspecto (female) de la paleta del empleado
        const e = P.employee && (P.employee[brand] || P.employee.bk);
        if (!Array.isArray(e)) return [e];
        const female = !!(BK.sprites && BK.sprites.getPal(ch.pal).female);
        return [e[female ? 1 : 0], e[0]];
      }
      if (ch.pal === 'rider') return [P.rider && P.rider.any];
      if (ch.pal.startsWith('guest')) {
        const pool = (P.guest && P.guest.pool) || [];
        const n = parseInt(ch.pal.slice(5), 10) || 0;
        return pool.length ? [pool[n % pool.length]] : [];
      }
      return [];
    },
    characterFor(ch) {
      const M = this.manifest;
      for (const id of this.candidates(ch)) {
        const c = id && M.characters && M.characters[id];
        if (c && this.ready[c.sheet]) return c;
      }
      return null;
    },
    // Retrato pequeño (cabeza y torso) recortado UNA vez del frame quieto de frente de una hoja; dataURL
    // cacheado por personaje (para tarjetas de la interfaz, nunca en el bucle de dibujo).
    faces: {},
    faceURL(ch) {
      const c = this.characterFor(ch);
      if (!c) return null;
      const key = c.sheet;
      if (this.faces[key]) return this.faces[key];
      const D = c.anims.idle && c.anims.idle.dirs.down;
      if (!D) return null;
      const [cw, chh] = c.cell, top = c.anchor[1] - (c.targetHeight || 112) - 6, s = Math.round(cw * 0.5);
      const cv = document.createElement('canvas'); cv.width = cv.height = 96;
      cv.getContext('2d').drawImage(this.images[key], (cw - s) / 2, D.row * chh + top, s, s, 0, 0, 96, 96);
      return (this.faces[key] = cv.toDataURL('image/png'));
    },
    // true si este personaje tiene hoja en el manifest que aún no ha fallado: mientras carga no se dibuja
    // el peón procedural, para que nadie cambie de estética al aparecer, sentarse o hacer cola.
    expects(ch) {
      const M = this.manifest;
      return this.candidates(ch).some((id) => { const c = id && M.characters && M.characters[id]; return c && !this.failed[c.sheet]; });
    },

    pick(c, anim, dir) {
      const opts = (ANIM[anim] || ['idle']).concat('idle');
      for (const a of opts) {
        const A = c.anims[a];
        if (!A) continue;
        const D = A.dirs[dir] || A.dirs.down;
        if (D) return { name: a, A, D };
      }
      return null;
    },

    frameIndex(ch, name, A, D) {
      const seq = D.seq || null, n = seq ? seq.length : D.frames;
      if (n <= 1) return seq ? seq[0] : 0;
      let i;
      if (name === 'walk') i = Math.floor(((ch.walkPhase / WALK_STRIDE) % 1) * n) % n;
      else if (BK.settings && BK.settings.reduceMotion) i = 0;
      else i = Math.floor((ch.animT || 0) * (A.fps || 4)) % n;
      return seq ? seq[i] : i;
    },

    // Dibuja el personaje con su sprite. Mismo contrato que CharacterAnimationSystem.draw.
    draw(ctx, ch, scale = 1, alpha = 1) {
      const c = this.characterFor(ch);
      if (!c) return false;
      const p = this.pick(c, ch.anim, DIR4[((ch.dir | 0) % 8 + 8) % 8]);
      if (!p) return false;
      const img = this.images[c.sheet];
      const [cw, chh] = c.cell, [ax, ay] = c.anchor, k = 0.5 * scale; // celdas a 2x -> píxeles lógicos
      const col = this.frameIndex(ch, p.name, p.A, p.D);
      if (alpha < 1) ctx.globalAlpha = alpha;
      ctx.drawImage(img, col * cw, p.D.row * chh, cw, chh, ch.x - ax * k, ch.y - ay * k, cw * k, chh * k);
      if (alpha < 1) ctx.globalAlpha = 1;
      return true;
    },

    // Valor de un avatar para una marca, con BK de respaldo: devuelve la lista en orden de preferencia.
    avatarField(avatarKey, field, brand) {
      const M = this.manifest, av = M && M.avatars && M.avatars[avatarKey];
      if (!av || !av[field]) return [];
      const v = av[field];
      if (typeof v === 'string') return [v];
      return [v[brand || this.brand()], v.bk].filter((x, i, a) => x && a.indexOf(x) === i);
    },
    // Asigna a un <img> el retrato del avatar para la marca, pasando al de BK si el de la marca no existe.
    setPortrait(img, avatarKey, brand, onAllFail) {
      const list = this.avatarField(avatarKey, 'portrait', brand);
      let i = 0;
      img.onerror = () => { i++; if (i < list.length) img.src = list[i]; else if (onAllFail) onAllFail(); };
      if (list.length) img.src = list[0]; else if (onAllFail) onAllFail();
    }
  };

  BK.SpriteLoader = SpriteLoader;
})();
