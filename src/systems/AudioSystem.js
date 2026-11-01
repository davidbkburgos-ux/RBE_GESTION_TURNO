(function () {
  const BK = window.BK;

  const CAPTIONS = {
    alert: 'Aviso: nuevo evento', bell: 'Campanilla: pedido listo', kiosk: 'Pitido de kiosco', car: 'Llega un coche',
    clean: 'Limpieza', ok: 'Confirmación', error: 'Error', hour: 'Cambio de hora', open: 'Puerta abierta',
    complaint: 'Aviso de queja', kpi: 'Actualización de servicio',
    fryerYellow: 'Fritadora: quedan pocas patatas', fryerRed: 'Fritadora: sin patatas', autokingOrder: 'AutoKing: coche en el punto de pedido'
  };

  // Audio sintetizado con WebAudio. No arranca hasta la primera interacción; siempre emite subtítulo visual.
  class AudioSystem {
    constructor(G) {
      this.G = G; this.ctx = null; this.master = null; this.effectsBus = null; this.ambientBus = null; this.ambientLayers = {};
      this.volume = G.save.settings.volume; this.muted = G.save.settings.muted;
      this.ambienceEnabled = G.save.settings.ambienceEnabled !== false;
      this.effectsEnabled = G.save.settings.effectsEnabled !== false;
      this.ambienceVolume = G.save.settings.ambienceVolume === undefined ? 0.55 : G.save.settings.ambienceVolume;
      this.effectsVolume = G.save.settings.effectsVolume === undefined ? 0.75 : G.save.settings.effectsVolume;
      this.lastStep = 0;
    }
    unlock() {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.connect(this.ctx.destination);
        this.effectsBus = this.ctx.createGain(); this.effectsBus.connect(this.master);
        this.ambientBus = this.ctx.createGain(); this.ambientBus.connect(this.master);
        this.noise = this.makeNoise();
        this.apply();
        this.startAmbient();
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
    }
    makeNoise() {
      const c = this.ctx, b = c.createBuffer(1, c.sampleRate, c.sampleRate), d = b.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      return b;
    }
    apply() {
      if (!this.master) return;
      const now = this.ctx.currentTime;
      this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume, now, 0.06);
      this.effectsBus.gain.setTargetAtTime(this.effectsEnabled ? this.effectsVolume : 0, now, 0.06);
      this.ambientBus.gain.setTargetAtTime(this.ambienceEnabled ? this.ambienceVolume : 0, now, 0.2);
    }
    silenceContextual() {
      if (!this.ctx) return;
      const now = this.ctx.currentTime;
      Object.values(this.ambientLayers).forEach((l) => l.gain.gain.setTargetAtTime(l.base, now, 0.05));
    }
    setVolume(v) { this.volume = v; this.G.save.setSetting('volume', v); this.apply(); }
    setMuted(m) { this.muted = m; this.G.save.setSetting('muted', m); this.apply(); }
    setAmbienceEnabled(enabled) { this.ambienceEnabled = enabled; this.G.save.setSetting('ambienceEnabled', enabled); this.apply(); }
    setEffectsEnabled(enabled) { this.effectsEnabled = enabled; this.G.save.setSetting('effectsEnabled', enabled); this.apply(); }
    setAmbienceVolume(value) { this.ambienceVolume = value; this.G.save.setSetting('ambienceVolume', value); this.apply(); }
    setEffectsVolume(value) { this.effectsVolume = value; this.G.save.setSetting('effectsVolume', value); this.apply(); }
    createAmbientLayer(id, frequency, volume, type) {
      const source = this.ctx.createBufferSource(), filter = this.ctx.createBiquadFilter(), gain = this.ctx.createGain();
      source.buffer = this.noise; source.loop = true; filter.type = type; filter.frequency.value = frequency;
      gain.gain.value = volume; source.connect(filter); filter.connect(gain); gain.connect(this.ambientBus); source.start();
      this.ambientLayers[id] = { gain, base: volume };
    }
    startAmbient() {
      this.createAmbientLayer('restaurant', 360, 0.018, 'lowpass');
      this.createAmbientLayer('kitchen', 1450, 0, 'bandpass');
      this.createAmbientLayer('dining', 900, 0, 'lowpass');
      this.createAmbientLayer('driveThru', 520, 0, 'lowpass');
      this.createAmbientLayer('delivery', 1200, 0, 'bandpass');
      this.createAmbientLayer('rain', 4200, 0, 'highpass');
      this.createAmbientLayer('rainLow', 1100, 0, 'lowpass');
      this.createAmbientLayer('sizzle', 5200, 0, 'bandpass');
      this.nextKitchenSound = 0;
    }
    update() {
      if (!this.ctx || !this.G.player) return;
      const player = this.G.player.char, G = this.G, now = this.ctx.currentTime;
      const playing = G.state === 'playing';
      const rain = playing ? BK.ArrivalDirector.rainLevel(G.cfg, G.dayProfile, G.clock.t) : 0;
      const inside = player.x > 168 && player.x < 1348 && player.y > 296 && player.y < 792;
      const rainGain = rain * (inside ? 0.4 : 1);
      this.ambientLayers.rain.gain.gain.setTargetAtTime(0.16 * rainGain, now, 0.6);
      this.ambientLayers.rainLow.gain.gain.setTargetAtTime(0.12 * rainGain, now, 0.6);
      const kitchenPoint = { x: 470, y: 650 };
      const kitchenNear = BK.util.clamp(1 - BK.util.dist(player, kitchenPoint) / 600, 0, 1);
      this.ambientLayers.sizzle.gain.gain.setTargetAtTime(playing ? 0.012 + 0.03 * kitchenNear : 0, now, 0.5);
      if (playing && now > this.nextKitchenSound) {
        this.nextKitchenSound = now + 1.8 + Math.random() * 4.5;
        const v = (0.35 + 0.65 * kitchenNear) * 0.07;
        if (Math.random() < 0.55) this.tone(2400 + Math.random() * 1800, 0.06, 'triangle', v, 0, undefined, this.ambientBus);
        else this.swish(0.35 + Math.random() * 0.3, v * 1.4, 3500 + Math.random() * 1500, this.ambientBus);
      }
      const proximity = (point) => BK.util.clamp(1 - BK.util.dist(player, point) / 420, 0, 1);
      const locations = {
        kitchen: { x: 470, y: 650 }, dining: { x: 1010, y: 560 },
        driveThru: { x: 100, y: 650 }, delivery: { x: 1360, y: 560 }
      };
      Object.entries(locations).forEach(([id, point]) => {
        const layer = this.ambientLayers[id];
        if (layer) layer.gain.gain.setTargetAtTime(layer.base + (id === 'kitchen' ? 0.025 : 0.018) * proximity(point), this.ctx.currentTime, 0.35);
      });
    }
    tone(freq, dur, type = 'sine', vol = 0.25, delay = 0, to, bus) {
      const c = this.ctx, o = c.createOscillator(), g = c.createGain(), t = c.currentTime + delay;
      o.type = type; o.frequency.setValueAtTime(freq, t);
      if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(bus || this.effectsBus); o.start(t); o.stop(t + dur + 0.05);
    }
    swish(dur, vol, freq, bus) {
      const c = this.ctx, s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain(), t = c.currentTime;
      s.buffer = this.noise; f.type = 'bandpass'; f.frequency.value = freq || 1800; g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      s.connect(f); f.connect(g); g.connect(bus || this.effectsBus); s.start(t); s.stop(t + dur);
    }
    fryerBeeps(freq, gap) {
      for (let i = 0; i < 4; i++) this.tone(freq, 0.07, 'square', 0.09, i * (0.07 + gap));
    }
    play(name, showCaption = true) {
      if (showCaption && CAPTIONS[name]) BK.bus.emit('audio:caption', { name, text: CAPTIONS[name] });
      if (!this.ctx || this.muted || !this.effectsEnabled) return;
      switch (name) {
        case 'alert': this.tone(880, 0.14, 'sine', 0.22); this.tone(1175, 0.2, 'sine', 0.2, 0.13); break;
        case 'bell': this.tone(1568, 0.5, 'triangle', 0.2); this.tone(2093, 0.4, 'sine', 0.1, 0.02); break;
        case 'kiosk': this.tone(660, 0.08, 'square', 0.08); this.tone(880, 0.1, 'square', 0.08, 0.1); break;
        case 'car': this.tone(150, 0.7, 'triangle', 0.14, 0, 90); break;
        case 'clean': this.swish(0.45, 0.25, 2400); break;
        case 'ok': this.tone(523, 0.12, 'sine', 0.2); this.tone(659, 0.12, 'sine', 0.2, 0.1); this.tone(784, 0.22, 'sine', 0.2, 0.2); break;
        case 'error': this.tone(220, 0.35, 'sawtooth', 0.14, 0, 130); break;
        case 'hour': this.tone(660, 0.5, 'sine', 0.12); this.tone(990, 0.6, 'sine', 0.1, 0.18); break;
        case 'open': this.tone(392, 0.2, 'triangle', 0.2); this.tone(523, 0.2, 'triangle', 0.2, 0.15); this.tone(659, 0.4, 'triangle', 0.2, 0.3); break;
        case 'complaint': this.tone(440, 0.12, 'sine', 0.12); this.tone(330, 0.22, 'sine', 0.1, 0.12); break;
        case 'kpi': this.tone(740, 0.08, 'triangle', 0.08); break;
        case 'fryerYellow': this.fryerBeeps(1750, 0.1); break;
        case 'fryerRed': this.fryerBeeps(2250, 0.14); break;
        case 'autokingOrder': this.tone(988, 0.22, 'sine', 0.2); this.tone(784, 0.4, 'sine', 0.2, 0.24); this.tone(1976, 0.3, 'triangle', 0.05, 0.24); break;
        case 'step': this.swish(0.05, 0.05, 500); break;
      }
    }
    step(now) { if (now - this.lastStep > 0.32) { this.lastStep = now; this.play('step'); } }
  }
  BK.AudioSystem = AudioSystem;
})();
