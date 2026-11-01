(function () {
  const BK = window.BK;

  class SaveSystem {
    constructor(key) {
      this.key = key;
      this.state = {
        tutorialDone: false, best: null, lastMetrics: null, run: null,
        settings: {
          volume: 0.6, muted: false, ambienceEnabled: true, effectsEnabled: true,
          ambienceVolume: 0.55, effectsVolume: 0.75, musicEnabled: false,
          reduceMotion: false, difficulty: 'weekday', timeScale: null, follow: null
        }
      };
      this.load();
    }
    load() {
      try {
        const raw = localStorage.getItem(this.key);
        if (raw) {
          const d = JSON.parse(raw);
          this.state = Object.assign(this.state, d, { settings: Object.assign(this.state.settings, d.settings || {}) });
        }
      } catch (e) { /* almacenamiento no disponible */ }
    }
    save() { try { localStorage.setItem(this.key, JSON.stringify(this.state)); } catch (e) { /* ignorar */ } }
    get settings() { return this.state.settings; }
    set(k, v) { this.state[k] = v; this.save(); }
    setSetting(k, v) { this.state.settings[k] = v; this.save(); }
    saveRun(run) { this.state.run = run; this.save(); }
    clearRun() { this.state.run = null; this.save(); }
    clearAll() {
      try { localStorage.removeItem(this.key); } catch (e) { /* ignorar */ }
      this.state.tutorialDone = false; this.state.best = null; this.state.lastMetrics = null; this.state.run = null;
            this.state.leaderboard = [];
          }
          finish(metrics) {
      this.state.lastMetrics = metrics;
      if (this.state.best === null || metrics.score > this.state.best) this.state.best = metrics.score;
      this.state.run = null;
      this.save();
    }
    get leaderboard() { return Array.isArray(this.state.leaderboard) ? this.state.leaderboard : []; }
    // ¿Entraría esta puntuación en el TOP 10?
    qualifies(score) {
      const lb = this.leaderboard;
      return lb.length < 10 || score > lb[lb.length - 1].score;
    }
    // Inserta la puntuación y devuelve su posición (1-10) o 0 si no entra.
    addScore(name, score) {
      const clean = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 14) || 'Encargado';
      const lb = this.leaderboard.slice();
      const entry = { name: clean, score: Math.round(score), date: Date.now() };
      let i = lb.findIndex((e) => entry.score > e.score);
      if (i < 0) i = lb.length;
      lb.splice(i, 0, entry);
      this.state.leaderboard = lb.slice(0, 10);
      this.state.playerName = clean;
      this.save();
      return i < 10 ? i + 1 : 0;
    }
  }
  BK.SaveSystem = SaveSystem;
})();
