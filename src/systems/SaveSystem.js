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
      this.board = []; this.boardError = false;
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
      delete this.state.playerName;
    }
    finish(metrics) {
      this.state.lastMetrics = metrics;
      if (this.state.best === null || metrics.score > this.state.best) this.state.best = metrics.score;
      this.state.run = null;
      this.save();
    }

    // ---------- clasificación global (Supabase); localStorage no guarda ranking ----------
    get leaderboard() { return this.board; }
    // Descarga el TOP 10 global. Si falla, registra el error y deja el último ranking conocido.
    async refreshLeaderboard() {
      try {
        this.board = await BK.LeaderboardService.top(10);
        this.boardError = false;
      } catch (e) {
        console.error('[Leaderboard] No se pudo consultar la clasificación:', e);
        this.boardError = true;
      }
      return this.board;
    }
    // ¿Entraría esta puntuación en el TOP 10 global? Falso si la clasificación no está disponible.
    async qualifies(score) {
      const lb = await this.refreshLeaderboard();
      if (this.boardError) return false;
      return lb.length < 10 || Math.round(score) > lb[lb.length - 1].score;
    }
    // Inserta la puntuación y devuelve su posición (1-10), 0 si no entra o null si no se pudo guardar.
    async addScore(name, score) {
      const clean = BK.LeaderboardService.cleanName(name), value = Math.round(score);
      this.state.playerName = clean;
      this.save();
      try {
        await BK.LeaderboardService.insert(clean, value);
      } catch (e) {
        console.error('[Leaderboard] No se pudo guardar la puntuación:', e);
        return null;
      }
      const lb = await this.refreshLeaderboard();
      let rank = -1;
      lb.forEach((e, i) => { if (e.name === clean && e.score === value && (rank < 0 || e.date >= lb[rank].date)) rank = i; });
      return rank >= 0 ? rank + 1 : 0;
    }
  }  BK.SaveSystem = SaveSystem;
})();
