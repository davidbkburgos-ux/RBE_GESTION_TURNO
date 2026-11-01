(function () {
  const BK = window.BK;

  // Priorización de canales: amplía paciencia y acelera el canal elegido; los demás pierden algo de margen. Con enfriamiento.
  class ChannelPrioritySystem {
    constructor(G) { this.G = G; this.reset(); }
    get c() { return this.G.cfg.priority; }
    reset() {
      this.channel = null; this.left = 0; this.cooldown = 0; this.offered = false; this.offerLeft = 0;
      this.stats = { resolved: 0, failed: 0 };
    }
    patience() { return 1; }
    speed() { return 1; }

    shouldOffer() {
      return !this.channel && this.cooldown <= 0 && !this.offered && this.G.events.active().length >= this.c.panelThresholdActive;
    }
    offer() { this.offered = true; this.offerLeft = this.c.panelAutoCloseSec; BK.bus.emit('priority:offer', {}); }
    dismissOffer() { this.offered = false; this.cooldown = Math.max(this.cooldown, this.c.cooldownSec * 0.4); BK.bus.emit('priority:closed', {}); }

    choose(ch) {
      if (this.channel || this.cooldown > 0) { BK.bus.emit('priority:cooling', {}); return false; }
      this.channel = ch; this.left = this.c.durationSec; this.offered = false;
      this.stats = { resolved: 0, failed: 0 };
      this.G.scoring.m.priorityChanges++;
      BK.bus.emit('priority:chosen', { channel: ch });
      return true;
    }
    end() {
      const ch = this.channel;
      this.channel = null; this.cooldown = this.c.cooldownSec;
      const effective = this.stats.resolved >= 2 && this.stats.failed === 0;
      const pts = effective ? this.G.cfg.score.priorityEffective : this.G.cfg.score.priorityIneffective;
      if (effective) { this.G.scoring.m.priorityEffective++; this.G.scoring.add(pts, 'Prioridad efectiva', null, 'team'); }
      BK.bus.emit('priority:ended', { channel: ch, effective, pts });
    }
    onResult(ev, result) {
      if (!this.channel || ev.channel !== this.channel) return;
      if (result === 'failed') this.stats.failed++; else this.stats.resolved++;
    }
    update(dt) {
      if (this.cooldown > 0 && !this.channel) this.cooldown = Math.max(0, this.cooldown - dt);
      if (this.channel) { this.left -= dt; if (this.left <= 0) this.end(); }
      if (this.offered) { this.offerLeft -= dt; if (this.offerLeft <= 0) this.dismissOffer(); }
      else if (this.shouldOffer()) this.offer();
    }
  }
  BK.ChannelPrioritySystem = ChannelPrioritySystem;
})();
