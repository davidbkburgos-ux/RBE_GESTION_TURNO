(function () {
  const BK = window.BK, U = BK.util;
  const INTERIOR = { x0: 168, x1: 1348, y0: 296, y1: 792 };
  const BUS_NAMES = ['ambience', 'weather', 'kitchen', 'customers', 'vehicles', 'ui', 'events'];
  const inside = (p) => p.x > INTERIOR.x0 && p.x < INTERIOR.x1 && p.y > INTERIOR.y0 && p.y < INTERIOR.y1;
  const inRect = (p, r) => p.x >= r[0] && p.x <= r[2] && p.y >= r[1] && p.y <= r[3];

  // Gestor de audio: buses, presupuesto de voces, limitadores, espacialización, ducking y clima.
  // Los demás sistemas solo llaman a play(nombre) o emit({event, x, y}); nunca crean sonidos directamente.
  class AudioManager extends BK.AudioSystem {
    constructor(G) {
      super(G);
      this.M = G.audioManifest;
      this.voices = []; this.fam = {}; this.lastVariant = {}; this.recent = []; this.dropped = {}; this.warnings = [];
      this.busMode = {}; this.rain = 0; this.zone = 'exterior'; this.lastWarn = -99; this.nextKitchenSound = 0;
      this.lastPos = null; this.acc = 0; this.dbgEl = null; this.dbgT = 0;
      this.hookEvents();
    }
    get settings() { return this.G.save.settings; }
    get reduce() { return !!this.settings.reduceStimuli; }
    hookEvents() {
      const G = this.G;
      BK.bus.on('ambient:activity', ({ type, entity }) => {
        if (G.state !== 'playing' || !this.ctx || !entity) return;
        const at = { x: entity.x, y: entity.y };
        if (type === 'CUSTOMER_ENTER') this.emit({ event: 'customerEnter', ...at });
        else if (type === 'CUSTOMER_SIT') this.emit({ event: 'customerSit', ...at });
        else if (type === 'CUSTOMER_LEAVE') this.emit({ event: 'customerLeave', ...at });
        else if (type === 'CUSTOMER_ORDER_READY') this.emit({ event: 'tray', ...at });
        else if (type === 'RIDER_ENTER') this.emit({ event: 'deliveryArrival', ...at });
        else if (type === 'VEHICLE_ENTER') this.emit({ event: 'vehicleEnter', ...at });
      });
      BK.bus.on('event:begin', () => { if (G.state === 'playing') this.emit({ event: 'attendStart' }); });
      BK.bus.on('incident:negative-review', () => this.emit({ event: 'negativeReview' }));
      if (typeof document !== 'undefined') {
        document.addEventListener('click', (e) => { if (e.target.closest && e.target.closest('button')) this.emit({ event: 'uiTap', caption: false }); }, true);
      }
      if (/audioDebug=1/.test(location.search)) setTimeout(() => this.debug(true), 0);
    }

    // ---------- Buses ----------
    startAmbient() {
      this.initBuses();
      super.startAmbient();
      this.createAmbientLayer('rainWin', 2600, 0, 'bandpass');
      this.createAmbientLayer('rainHeavy', 1800, 0, 'lowpass');
    }
    createAmbientLayer(id, frequency, volume, type) {
      const source = this.ctx.createBufferSource(), filter = this.ctx.createBiquadFilter(), gain = this.ctx.createGain();
      source.buffer = this.noise; source.loop = true; filter.type = type; filter.frequency.value = frequency;
      gain.gain.value = volume; source.connect(filter); filter.connect(gain);
      gain.connect(id.startsWith('rain') ? this.buses.weather : this.ambientBus); source.start();
      this.ambientLayers[id] = { gain, filter, base: volume };
    }
    initBuses() {
      const c = this.ctx;
      this.duck = c.createGain();
      this.ambientBus.disconnect(); this.ambientBus.connect(this.duck); this.duck.connect(this.master);
      this.buses = { ambience: this.ambientBus };
      BUS_NAMES.forEach((n) => {
        if (n === 'ambience') return;
        const g = c.createGain();
        g.connect(n === 'weather' ? this.ambientBus : this.effectsBus);
        this.buses[n] = g;
      });
      const len = Math.floor(c.sampleRate * 0.45), ir = c.createBuffer(2, len, c.sampleRate);
      for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3); }
      this.reverbSend = c.createGain(); this.reverbSend.gain.value = 0;
      const conv = c.createConvolver(); conv.buffer = ir;
      this.effectsBus.connect(this.reverbSend); this.reverbSend.connect(conv); conv.connect(this.master);
      this.apply();
    }
    apply() {
      super.apply();
      if (!this.buses) return;
      const now = this.ctx.currentTime, S = this.settings, solo = BUS_NAMES.find((n) => this.busMode[n] === 'solo');
      BUS_NAMES.forEach((n) => {
        if (n === 'ambience') return;
        let v = this.M.buses[n].volume;
        if (n === 'events') v *= S.alertsVolume === undefined ? 1 : S.alertsVolume;
        if (n === 'ui') v *= S.uiVolume === undefined ? 1 : S.uiVolume;
        if (this.busMode[n] === 'mute' || (solo && solo !== n)) v = 0;
        this.buses[n].gain.setTargetAtTime(v, now, 0.05);
      });
    }
    setAlertsVolume(v) { this.G.save.setSetting('alertsVolume', v); this.apply(); }
    setUiVolume(v) { this.G.save.setSetting('uiVolume', v); this.apply(); }
    setReduceStimuli(v) { this.G.save.setSetting('reduceStimuli', v); }
    setSoundCaptions(v) { this.G.save.setSetting('soundCaptions', v); }

    // ---------- Síntesis con ruteo espacial ----------
    resolveBus(b) { return (typeof b === 'string' ? this.buses[b] : b) || (this.curBus && this.buses[this.curBus]) || this.effectsBus; }
    route(g, bus) {
      const c = this.ctx, dest = this.resolveBus(bus), sp = this.curSpatial;
      if (!sp) { g.connect(dest); return; }
      let out = g;
      if (sp.lp) { const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = sp.lp; g.connect(f); out = f; }
      const gg = c.createGain(); gg.gain.value = sp.gain; out.connect(gg);
      if (c.createStereoPanner) { const p = c.createStereoPanner(); p.pan.value = sp.pan; gg.connect(p); p.connect(dest); } else gg.connect(dest);
    }
    tone(freq, dur, type = 'sine', vol = 0.25, delay = 0, to, bus) {
      const c = this.ctx, o = c.createOscillator(), g = c.createGain(), t = c.currentTime + delay + (this.curDelay || 0);
      const p = this.curPitch || 1;
      o.type = type; o.frequency.setValueAtTime(freq * p, t);
      if (to) o.frequency.exponentialRampToValueAtTime(to * p, t + dur);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); this.route(g, bus); o.start(t); o.stop(t + dur + 0.05);
    }
    swish(dur, vol, freq, bus) {
      const c = this.ctx, s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain(), t = c.currentTime + (this.curDelay || 0);
      s.buffer = this.noise; f.type = 'bandpass'; f.frequency.value = (freq || 1800) * (this.curPitch || 1);
      g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      s.connect(f); f.connect(g); this.route(g, bus); s.start(t); s.stop(t + dur);
    }
    recipe(name, v, g, def) {
      switch (name) {
        case 'twoTone': this.tone(v.a, 0.14, 'sine', g); this.tone(v.b, 0.2, 'sine', g * 0.9, 0.13); break;
        case 'bell': this.tone(v.f, 0.5, 'triangle', g); this.tone(v.f * 1.335, 0.4, 'sine', g * 0.5, 0.02); break;
        case 'kioskBeep': this.tone(v.a, 0.08, 'square', g); this.tone(v.b, 0.1, 'square', g, 0.1); break;
        case 'glide': this.tone(v.f, def.dur, 'triangle', g, 0, v.to); break;
        case 'glideSaw': this.tone(v.f, def.dur, 'sawtooth', g, 0, v.to); break;
        case 'complaint': this.tone(v.a, 0.12, 'sine', g); this.tone(v.b, 0.22, 'sine', g * 0.8, 0.12); break;
        case 'swish': this.swish(v.d || def.dur, g, v.f); break;
        case 'arpUp': v.n.forEach((f, i) => this.tone(f, i === v.n.length - 1 ? 0.25 : 0.12, v.type || 'sine', g, i * (v.type ? 0.15 : 0.1))); break;
        case 'tick': this.tone(v.f, 0.06, 'triangle', g); break;
        case 'fryerBeeps': for (let i = 0; i < 4; i++) this.tone(v.f, 0.07, 'square', g, i * (0.07 + v.gap)); break;
        case 'drivePoint': this.tone(v.a, 0.22, 'sine', g); this.tone(v.b, 0.4, 'sine', g, 0.24); this.tone(v.a * 2, 0.3, 'triangle', g * 0.25, 0.24); break;
        case 'engine': this.tone(v.f, def.dur, 'triangle', g, 0, v.to); if (v.wet) this.swish(def.dur, g * 0.7, 1800); break;
        case 'scooter': this.tone(v.f, 0.5, 'sawtooth', g * 0.6, 0, v.to); this.tone(1400, 0.08, 'square', g * 0.5, 0.55); this.tone(1750, 0.08, 'square', g * 0.5, 0.7); break;
        case 'thud': this.tone(v.f, 0.12, 'sine', g, 0, v.f * 0.6); this.swish(0.05, g * 0.5, 600); break;
        case 'clank': this.tone(v.f, 0.1, 'triangle', g); this.tone(v.f * 1.52, 0.07, 'triangle', g * 0.6, 0.015); break;
        case 'step': { const s = this.M.surfaces[v.surface] || this.M.surfaces.tile; this.swish(s.d, g, s.f); break; }
        default: break;
      }
    }

    // ---------- Núcleo: emit con presupuesto, limitadores, espacialización y ducking ----------
    drop(why) { this.dropped[why] = (this.dropped[why] || 0) + 1; return false; }
    spatialFor(def, o) {
      const P = this.G.player.char, S = this.M.spatial, src = { x: o.x, y: o.y };
      const d = U.dist(P, src), max = def.maxDistance || 1000;
      if (d > max) return null;
      let gain = d <= S.nearPx ? 1 : d <= S.farPx ? 1 - (1 - S.farGain) * (d - S.nearPx) / (S.farPx - S.nearPx) : S.farGain * (1 - (d - S.farPx) / Math.max(1, max - S.farPx));
      const key = (p) => (!inside(p) ? 'out' : inRect(p, this.G.map.zones.find((z) => z.id === 'kitchen').rect) ? 'kitchen' : inRect(p, this.G.map.zones.find((z) => z.id === 'restrooms').rect) ? 'wc' : 'front');
      const kl = key(P), ks = key(src);
      let lp = 0;
      if (kl !== ks) {
        if (kl === 'out' || ks === 'out') { gain *= S.occludedGain; lp = S.occludedLowpass; } else { gain *= 0.8; lp = 3000; }
      }
      return { gain: Math.max(0, gain), pan: U.clamp((src.x - P.x) / S.panRangePx, -1, 1) * S.maxPan, lp, d };
    }
    emit(o) {
      const id = o.event, def = this.M && this.M.sounds[id];
      if (!def) return false;
      if (o.caption !== false && def.caption && this.settings.soundCaptions !== false) BK.bus.emit('audio:caption', { name: id, text: def.caption });
      if (!this.ctx || !this.buses || this.muted || !this.effectsEnabled) return false;
      const B = this.M.budget, prio = def.priority || 0, now = this.ctx.currentTime, crit = prio >= 3;
      if (this.reduce && def.decorative) return this.drop('reduced');
      if (def.probability && Math.random() > def.probability) return false;
      if (this.busMode[def.bus] === 'mute') return this.drop('busMuted');
      this.voices = this.voices.filter((v) => v.end > now);
      const n = this.voices.length;
      if (n >= B.warnAt && now - this.lastWarn > 5) { this.lastWarn = now; this.warnings.push({ t: this.G.clock ? this.G.clock.t : 0, voices: n }); if (this.warnings.length > 20) this.warnings.shift(); console.warn('AUDIO_DENSITY_WARNING', n + '/' + B.maxVoices); }
      if (!crit) {
        if (n >= B.maxVoices) return this.drop('budget');
        if (def.decorative && n >= B.dropDecorativeAt) return this.drop('decorative');
        if (this.voices.filter((v) => v.bus === def.bus).length >= this.M.buses[def.bus].maxVoices) return this.drop('busFull');
      }
      const fam = this.M.families[def.family], st = this.fam[def.family] || (this.fam[def.family] = { next: 0, times: [] });
      let delay = 0;
      if (fam) {
        if (fam.maxConcurrent && !crit && this.voices.filter((v) => v.family === def.family).length >= fam.maxConcurrent) return this.drop('familyConcurrent');
        if (fam.window) { st.times = st.times.filter((t) => t > now - fam.window); if (st.times.length >= fam.maxPerWindow && !crit) return this.drop('familyWindow'); }
        if (now < st.next) {
          if (fam.stagger) { delay = st.next - now; if (delay > 1.5 && !crit) return this.drop('staggerFull'); }
          else if (!crit) return this.drop('minInterval');
        }
        st.next = now + delay + (fam.minInterval || 0);
        st.times.push(now);
      }
      let sp = null;
      if (def.spatial && o.x != null) { sp = this.spatialFor(def, o); if (!sp) return this.drop('range'); }
      const pool = (def.wetVariants && this.rain > 0.2) ? def.wetVariants : def.variants;
      let vi = Math.floor(Math.random() * pool.length);
      if (pool.length > 1 && vi === this.lastVariant[id]) vi = (vi + 1) % pool.length;
      this.lastVariant[id] = vi;
      const variant = o.surface ? { ...pool[vi], surface: o.surface } : pool[vi];
      const rp = def.randomPitch || 0;
      this.curPitch = 1 + (Math.random() * 2 - 1) * rp; this.curDelay = delay; this.curBus = def.bus; this.curSpatial = sp;
      const g = def.gain * (sp ? 1 : 1);
      try { this.recipe(def.recipe, variant, g, def); } finally { this.curSpatial = null; this.curDelay = 0; this.curBus = null; this.curPitch = 1; }
      const entry = { id, bus: def.bus, family: def.family, end: now + delay + def.dur, prio };
      this.voices.push(entry);
      this.recent.push({ id, bus: def.bus, db: Math.round(20 * Math.log10(Math.max(0.0001, g * (sp ? sp.gain : 1)))) });
      if (this.recent.length > 12) this.recent.shift();
      if (def.duck) this.duckNow(delay);
      return true;
    }
    duckNow(delay) {
      const d = this.M.ducking, t = this.ctx.currentTime + (delay || 0), g = this.duck.gain;
      g.cancelScheduledValues(t);
      g.setTargetAtTime(Math.pow(10, -d.amountDb / 20), t, d.attack);
      g.setTargetAtTime(1, t + d.hold, d.release / 3);
    }
    play(name, showCaption = true) { return this.emit({ event: name, caption: showCaption }); }

    // ---------- Pasos: por distancia recorrida y superficie ----------
    surfaceAt(p) {
      if (inside(p)) return 'tile';
      if (p.y < INTERIOR.y0 || (p.x > INTERIOR.x1 && p.y < 440)) return 'paving';
      return 'asphalt';
    }
    step() {
      const p = this.G.player && this.G.player.char;
      if (!p || this.G.state !== 'playing') return;
      if (!this.lastPos) { this.lastPos = { x: p.x, y: p.y }; return; }
      const d = U.dist(p, this.lastPos);
      this.lastPos = { x: p.x, y: p.y };
      if (d > 120) { this.acc = 0; return; }
      this.acc += d;
      if (this.acc >= 38) { this.acc = 0; this.emit({ event: 'step', surface: this.surfaceAt(p), caption: false }); }
    }

    // ---------- Ambiente, clima y evolución horaria ----------
    zoneAt(p) {
      const zs = this.G.map.zones;
      if (inside(p)) {
        for (const id of ['kitchen', 'restrooms', 'counter', 'kiosks', 'hall']) { const z = zs.find((q) => q.id === id); if (z && inRect(p, z.rect)) return id; }
        return 'hall';
      }
      for (const id of ['delivery', 'terrace', 'autoking']) { const z = zs.find((q) => q.id === id); if (z && inRect(p, z.rect)) return id; }
      return 'exterior';
    }
    update() {
      if (!this.ctx || !this.buses || !this.G.player) return;
      const G = this.G, P = G.player.char, c = this.ctx, now = c.currentTime, L = this.ambientLayers, S = this.M.spatial;
      const playing = G.state === 'playing';
      const rain = playing ? BK.ArrivalDirector.rainLevel(G.cfg, G.dayProfile, G.clock.t) : 0;
      this.rain = rain; this.zone = this.zoneAt(P);
      const ins = inside(P), reduce = this.reduce ? 0.5 : 1;
      const set = (id, v, tau) => L[id].gain.gain.setTargetAtTime(v, now, tau || 0.6);
      const phase = !playing ? 0.6 : G.clock.t < 660 ? 0.45 : G.clock.t < G.clock.open ? 0.75 : 1;
      this.phase = phase;

      // Clima: cuatro capas con crossfade; la intensidad modula volumen, brillo y densidad.
      const dEdge = Math.min(Math.abs(P.y - INTERIOR.y0), Math.abs(P.x - INTERIOR.x0), Math.abs(P.x - INTERIOR.x1));
      const glass = ins ? U.clamp(1 - dEdge / 170, 0, 1) : 0;
      L.rain.filter.frequency.setTargetAtTime(2600 + 2200 * rain, now, 0.8);
      set('rain', 0.16 * rain * (ins ? 0.22 : 1));
      set('rainLow', 0.12 * rain * (ins ? 1 : 0.35));
      set('rainWin', rain * (ins ? 0.015 + 0.07 * glass : 0.01));
      set('rainHeavy', 0.13 * rain * rain * (ins ? 0.3 : 1));

      // Cocina: la densidad real de pedidos mueve la saturación, no el volumen global.
      const kPoint = { x: 470, y: 650 };
      const near = U.clamp(1 - U.dist(P, kPoint) / 600, 0, 1);
      const orders = G.production && G.production.orders ? G.production.orders.filter((o) => o.status !== 'delivered').length : 0;
      const density = U.clamp(orders / 8, 0, 1);
      this.density = density;
      const kitchenLive = playing && G.clock.t >= 660;
      set('sizzle', kitchenLive ? (0.006 + 0.034 * near * (0.35 + 0.65 * density)) * reduce : 0, 0.5);
      if (kitchenLive && now > this.nextKitchenSound) {
        this.nextKitchenSound = now + (this.reduce ? 6 : 3.2 - 2.2 * density) + Math.random() * 3;
        const at = { x: 430 + Math.random() * 160, y: 620 + Math.random() * 60 };
        this.emit({ event: Math.random() < 0.55 ? 'metal' : 'sizzleHit', ...at, caption: false });
      }

      // Sala (ocupación), cola del AutoKing y room tone según fase del día.
      const guests = G.customers ? G.customers.guests.filter((g) => !g.dead && inside(g)).length : 0;
      const occ = U.clamp(guests / 24, 0, 1), cars = G.vehicles ? G.vehicles.cars.length : 0;
      L.restaurant.base = 0.018 * phase;
      L.dining.base = playing && G.opening.isOpen ? (0.004 + 0.03 * occ) * reduce : 0;
      L.driveThru.base = playing && G.opening.isOpen ? 0.003 + 0.012 * Math.min(cars, 6) / 6 : 0;
      L.kitchen.base = kitchenLive ? 0.004 * phase : 0;
      L.delivery.base = 0;
      set('restaurant', L.restaurant.base, 1.2);
      const prox = (pt) => U.clamp(1 - U.dist(P, pt) / 420, 0, 1);
      const pts = { kitchen: kPoint, dining: { x: 1010, y: 560 }, driveThru: { x: 100, y: 650 }, delivery: { x: 1360, y: 560 } };
      Object.entries(pts).forEach(([id, pt]) => {
        const k = id === 'kitchen' ? 0.025 : id === 'delivery' ? 0.012 : 0.018;
        set(id, L[id].base + (playing && (id === 'dining' ? L.dining.base > 0 : id === 'kitchen' ? kitchenLive : G.opening.isOpen) ? k * prox(pt) * reduce : 0), 0.35);
      });

      // Reverb muy ligera por zona del oyente.
      this.reverbSend.gain.setTargetAtTime(this.M.reverb[this.zone] || 0, now, 0.4);
      void S;
      if (this.dbgEl) this.refreshDebug(now);
    }
    silenceContextual() {
      if (!this.ctx) return;
      const now = this.ctx.currentTime;
      Object.values(this.ambientLayers).forEach((l) => l.gain.gain.setTargetAtTime(l.base || 0, now, 0.05));
    }

    // ---------- Depuración (solo ?audioDebug=1 o G.audio.debug(true)) ----------
    stats() {
      const now = this.ctx ? this.ctx.currentTime : 0, act = this.voices.filter((v) => v.end > now);
      const perBus = {}; act.forEach((v) => { perBus[v.bus] = (perBus[v.bus] || 0) + 1; });
      const P = this.G.player && this.G.player.char;
      return { voices: act.length, max: this.M.budget.maxVoices, perBus, dropped: { ...this.dropped }, zone: this.zone, rain: +(this.rain || 0).toFixed(2), density: +(this.density || 0).toFixed(2), phase: this.phase, listener: P ? { x: Math.round(P.x), y: Math.round(P.y) } : null, warnings: this.warnings.length, recent: this.recent.slice(-6), modes: { ...this.busMode } };
    }
    debug(on) {
      if (!on) { if (this.dbgEl) { this.dbgEl.remove(); this.dbgEl = null; } return; }
      if (this.dbgEl) return;
      const el = document.createElement('div');
      el.setAttribute('data-audio-debug', '1');
      el.style.cssText = 'position:fixed;left:6px;bottom:6px;z-index:99999;background:rgba(0,0,0,.78);color:#9f9;font:11px monospace;padding:6px 8px;border-radius:6px;max-width:260px;white-space:pre-wrap';
      el.addEventListener('click', (e) => {
        const b = e.target.getAttribute && e.target.getAttribute('data-bus');
        if (!b) return;
        const m = this.busMode[b]; this.busMode[b] = !m ? 'mute' : m === 'mute' ? 'solo' : undefined; this.apply();
      });
      document.body.appendChild(el); this.dbgEl = el;
    }
    refreshDebug(now) {
      if (now - this.dbgT < 0.3) return;
      this.dbgT = now;
      const s = this.stats();
      const buses = BUS_NAMES.map((n) => '<span data-bus="' + n + '" style="cursor:pointer;margin-right:4px;color:' + (s.modes[n] === 'mute' ? '#f66' : s.modes[n] === 'solo' ? '#ff6' : '#9f9') + '">' + n + (s.modes[n] ? '[' + s.modes[n] + ']' : '') + ':' + (s.perBus[n] || 0) + '</span>').join('');
      this.dbgEl.innerHTML = 'master ' + (this.muted ? 'mute' : this.volume.toFixed(2)) + ' · voces ' + s.voices + '/' + s.max + '<br>zona ' + s.zone + ' · lluvia ' + s.rain + ' · cocina ' + s.density + '<br>listener ' + (s.listener ? s.listener.x + ',' + s.listener.y : '-') + ' · avisos ' + s.warnings + '<br>' + buses + '<br>' + s.recent.map((r) => r.id + ' ' + r.db + 'dB').join(' | ');
    }
  }
  BK.AudioManager = AudioManager;
})();
