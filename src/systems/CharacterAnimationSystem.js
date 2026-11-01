(function () {
  const BK = window.BK;
  const U = BK.util;
  const SS = 2; // supersampling del sprite
  const CW = 64, CH = 84, OX = 32, OY = 70; // lienzo lógico y origen (pies)
  const FR = 0.55; // compresión de profundidad (cámara elevada)

  const FRAMES = { idle: 4, walk: 8, talk: 4, point: 4, inspect: 4, clean: 8, work: 4, deliver: 4, kiosk: 4, door: 4, reactGood: 4, reactBad: 4, sit: 4, eat: 4 };
  const FPS = { idle: 3, walk: 0, talk: 6, point: 5, inspect: 4, clean: 10, work: 6, deliver: 5, kiosk: 6, door: 5, reactGood: 7, reactBad: 7, sit: 2, eat: 3 };

  const SKINS = ['#f0c8a0', '#e3b08a', '#c68e66', '#9a6a46'];
  const HAIRS = ['#2b1d16', '#4a3022', '#1c1c1c', '#7a5a3a', '#a38a64'];
  const SHIRTS = ['#3a6ea5', '#4c8c5a', '#7b5aa6', '#9aa0a6', '#d9a441', '#2f4858', '#b8566b', '#5aa1a8'];
  const PANTS = ['#2e3a4a', '#5a4a3a', '#1f1f1f', '#3b4d3a', '#4a4f66'];

  const PAL = {
    manager: { shirt: '#dccbb0', shade: '#b8a68c', pants: '#4a3426', pantsShade: '#33231a', cap: '#5e4333', capShade: '#45301f', logo: true, tie: '#5a3f30', belt: '#6a4a34', shoe: '#2a1d16', hair: '#2b1d16', skin: '#f0c8a0', badge: true, short: true },
    employee: { shirt: '#d83b2d', shade: '#a52a20', pants: '#26241f', pantsShade: '#181714', cap: '#5e4333', capShade: '#45301f', logo: true, belt: '#222', shoe: '#1f1a17', hair: '#2b1d16', skin: '#e3b08a', chestLogo: true, short: true },
    rider: { shirt: '#f47a2c', shade: '#c85a18', pants: '#2a2f3a', pantsShade: '#1c2028', helmet: '#262626', helmetShade: '#141414', stripe: '#f47a2c', shoe: '#1a1a1a', hair: '#1c1c1c', skin: '#c68e66', backpack: true, short: false }
  };
  function guestPal(seed) {
    const r = (arr, k) => arr[(seed * 7 + k * 13) % arr.length];
    const shirt = r(SHIRTS, 1);
    return {
      shirt, shade: shade(shirt, 0.78), pants: r(PANTS, 2), pantsShade: shade(r(PANTS, 2), 0.7),
      cap: seed % 4 === 0 ? r(SHIRTS, 5) : null, capShade: '#222', shoe: '#2b2b2b', hair: r(HAIRS, 3), skin: r(SKINS, 4), short: seed % 3 !== 0, guest: true
    };
  }
  function shade(hex, k) {
    const n = parseInt(hex.slice(1), 16);
    const c = (v) => Math.max(0, Math.min(255, Math.round(v * k)));
    return '#' + [c((n >> 16) & 255), c((n >> 8) & 255), c(n & 255)].map((v) => v.toString(16).padStart(2, '0')).join('');
  }
  const palCache = {};
  function getPal(key) {
    if (palCache[key]) return palCache[key];
    let p;
    if (PAL[key]) p = PAL[key]; else if (key.startsWith('guest')) p = guestPal(parseInt(key.slice(5), 10) || 0); else p = PAL.employee;
    palCache[key] = p; return p;
  }

  function pose(anim, fr, n) {
    const ph = fr / n, th = ph * Math.PI * 2, s = Math.sin(th), c = Math.cos(th);
    const P = { bob: 0, lean: 0, legs: [{ a: 0, lift: 0 }, { a: 0, lift: 0 }], arms: [{ a: 0, b: 1.5, h: 23 }, { a: 0, b: 1.5, h: 23 }], prop: null, head: 0, tilt: 0 };
    switch (anim) {
      case 'walk':
        P.legs = [{ a: s * 7.5, lift: 2.4 * Math.max(0, c) }, { a: -s * 7.5, lift: 2.4 * Math.max(0, -c) }];
        P.arms = [{ a: -s * 5.5, b: 1.5, h: 24 }, { a: s * 5.5, b: 1.5, h: 24 }];
        P.bob = 1.1 * (1 - Math.abs(s)); P.lean = 0.6; break;
      case 'idle': P.bob = s * 0.5; P.arms[0].a = s * 0.8; P.arms[1].a = -s * 0.8; break;
      case 'talk': P.arms[0] = { a: 7 + s * 3, b: 4, h: 31 + c * 2 }; P.arms[1] = { a: 2, b: 2, h: 24 }; P.head = s * 0.8; P.bob = s * 0.4; break;
      case 'point': P.arms[0] = { a: 12 + s, b: 2, h: 36 + c }; P.lean = 1; break;
      case 'inspect': P.arms[1] = { a: 8, b: -1, h: 30 }; P.arms[0] = { a: 8 + s * 1.5, b: 3 + c, h: 27 }; P.prop = 'clip'; P.tilt = 1.2; break;
      case 'clean': P.arms[0] = { a: 10, b: 1 + s * 7, h: 22 }; P.arms[1] = { a: 4, b: -2, h: 24 }; P.prop = 'cloth'; P.lean = 2.5; P.bob = -0.8; P.tilt = 1; break;
      case 'work': P.arms[0] = { a: 9 + s * 2, b: 2, h: 27 }; P.arms[1] = { a: 9 - s * 2, b: -2, h: 27 + c }; P.lean = 1; P.tilt = 0.8; break;
      case 'deliver': {
        const e = 8 + Math.min(4, fr * 2);
        P.arms[0] = { a: e, b: 2.5, h: 28 }; P.arms[1] = { a: e, b: -2.5, h: 28 }; P.prop = 'bag'; break;
      }
      case 'kiosk': P.arms[0] = { a: 11 + (c > 0.3 ? 1.5 : 0), b: 2, h: 31 }; P.arms[1] = { a: 3, b: -2, h: 24 }; P.tilt = 0.6; break;
      case 'door': P.arms[0] = { a: 11 + s * 0.5, b: 2, h: 28 }; P.lean = 1.5; break;
      case 'reactGood': P.arms[0] = { a: 2, b: 4, h: 44 + s * 2 }; P.arms[1] = { a: 0, b: -2, h: 23 }; P.bob = Math.abs(s) * 2; break;
      case 'reactBad': P.arms[0] = { a: 2, b: 3, h: 42 }; P.arms[1] = { a: 2, b: -3, h: 42 }; P.head = s * 1.2; break;
      case 'sit': P.arms[0] = { a: 8, b: 3, h: 20 }; P.arms[1] = { a: 8, b: -3, h: 20 }; P.bob = s * 0.3; break;
      case 'eat': P.arms[0] = { a: 5 + (c > 0 ? 3 : 0), b: 2, h: 20 + (c > 0 ? 14 : 0) }; P.arms[1] = { a: 8, b: -3, h: 20 }; break;
      default: break;
    }
    return P;
  }

  function limb(ctx, x1, y1, x2, y2, w, col) {
    ctx.strokeStyle = col; ctx.lineWidth = w; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  }

  function drawFigure(ctx, pal, anim, dir, frame, seated) {
    const n = FRAMES[anim] || 4;
    const P = pose(anim, frame % n, n);
    const f = U.dirVec(dir);
    const r = { x: -f.y, y: f.x };
    const front = f.y; // >0 mira a cámara
    const bob = P.bob - (seated ? 9 : 0);
    const proj = (a, b, h) => {
      const gx = f.x * a + r.x * b, gy = f.y * a + r.y * b;
      return { x: gx + f.x * P.lean * 0.4, y: gy * FR - h - bob * 1 + (h > 12 ? 0 : 0), d: gy };
    };
    const parts = [];

    // sombra
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath(); ctx.ellipse(2, 2, seated ? 9 : 10.5, 4.2, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    const hw = 7.2 + 0 * front;
    const torsoW = 9.5 + 6.5 * Math.abs(front);
    const hipH = 20, shH = 36.5;

    // piernas
    if (!seated) {
      [0, 1].forEach((i) => {
        const side = i === 0 ? 1 : -1;
        const hip = proj(0, side * 3.2, hipH);
        const foot = proj(P.legs[i].a, side * 3.2, P.legs[i].lift);
        parts.push({ d: foot.d - 0.2, draw() {
          limb(ctx, hip.x, hip.y, foot.x, foot.y, 5.4, side * (r.x) >= 0 ? pal.pants : pal.pantsShade);
          ctx.fillStyle = pal.shoe;
          ctx.beginPath(); ctx.ellipse(foot.x + f.x * 1.8, foot.y + f.y * 1 - 0.4, 3.9, 2.5, 0, 0, Math.PI * 2); ctx.fill();
        } });
      });
    }

    // torso
    const tb = proj(0, 0, seated ? hipH - 1 : hipH - 1), tt = proj(0, 0, shH);
    parts.push({ d: 0, draw() {
      const x0 = tb.x, yb = tb.y, yt = tt.y;
      const wB = torsoW * 0.92, wT = torsoW;
      ctx.beginPath();
      ctx.moveTo(x0 - wB / 2, yb); ctx.lineTo(x0 + wB / 2, yb);
      ctx.quadraticCurveTo(x0 + wT / 2 + 1, (yb + yt) / 2, x0 + wT / 2, yt + 2);
      ctx.quadraticCurveTo(x0, yt - 2.2, x0 - wT / 2, yt + 2);
      ctx.quadraticCurveTo(x0 - wT / 2 - 1, (yb + yt) / 2, x0 - wB / 2, yb);
      ctx.closePath();
      const g = ctx.createLinearGradient(x0 - wT / 2, 0, x0 + wT / 2, 0);
      g.addColorStop(0, pal.shirt); g.addColorStop(1, pal.shade);
      ctx.fillStyle = g; ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 0.7; ctx.stroke();
      // cinturón
      ctx.fillStyle = pal.belt || pal.pants;
      ctx.fillRect(x0 - wB / 2, yb - 2.4, wB, 2.4);
      if (front > 0.25) {
        if (pal.tie) { ctx.fillStyle = pal.tie; ctx.beginPath(); ctx.moveTo(x0 - 1.4 + f.x * 3, yt + 3); ctx.lineTo(x0 + 1.4 + f.x * 3, yt + 3); ctx.lineTo(x0 + 1.8 + f.x * 3, yb - 3); ctx.lineTo(x0 + f.x * 3, yb - 1); ctx.lineTo(x0 - 1.8 + f.x * 3, yb - 3); ctx.closePath(); ctx.fill(); }
        if (pal.badge) { ctx.fillStyle = '#f2d27a'; ctx.fillRect(x0 - wT / 2 + 2 + f.x * 2, yt + 5, 3.6, 1.8); }
        if (pal.logo && pal.tie) { ctx.fillStyle = '#f47a2c'; ctx.beginPath(); ctx.ellipse(x0 + wT / 2 - 3 + f.x * 2, yt + 6.5, 1.8, 1.5, 0, 0, Math.PI * 2); ctx.fill(); }
        if (pal.chestLogo) { ctx.fillStyle = '#f47a2c'; ctx.beginPath(); ctx.ellipse(x0 + wT / 2 - 3.2 + f.x * 2, yt + 6.5, 2, 1.7, 0, 0, Math.PI * 2); ctx.fill(); }
      }
      if (pal.backpack && front < -0.2) {
        ctx.fillStyle = '#e8661a'; ctx.strokeStyle = '#7a3208'; ctx.lineWidth = 0.8;
        ctx.fillRect(x0 - 7, yt + 1, 14, 13); ctx.strokeRect(x0 - 7, yt + 1, 14, 13);
        ctx.fillStyle = '#f9c9a0'; ctx.fillRect(x0 - 5, yt + 4, 10, 1.4);
      }
    } });

    // mochila lateral (repartidor) vista de perfil/delante
    if (pal.backpack && front >= -0.2) {
      const bp = proj(-5.5, 0, 31);
      parts.push({ d: bp.d - 2, draw() { ctx.fillStyle = '#c85a18'; ctx.fillRect(bp.x - 6, bp.y - 6, 12, 13); } });
    }

    // brazos
    [0, 1].forEach((i) => {
      const side = i === 0 ? 1 : -1;
      const A = P.arms[i];
      const sh = proj(0, side * (hw - 1.2), shH - 1.5);
      const hand = proj(A.a, side * (hw - 1.2) + A.b * 0.6, A.h);
      const hx = hand.x, hy = hand.y;
      const mid = { x: sh.x + (hx - sh.x) * 0.42, y: sh.y + (hy - sh.y) * 0.42 };
      parts.push({ d: hand.d + 0.1, draw() {
        const sleeveCol = pal.short ? pal.shirt : pal.shirt;
        limb(ctx, sh.x, sh.y, pal.short ? mid.x : hx, pal.short ? mid.y : hy, 5.2, sleeveCol);
        if (pal.short) limb(ctx, mid.x, mid.y, hx, hy, 3.7, pal.skin);
        ctx.fillStyle = pal.skin; ctx.beginPath(); ctx.arc(hx, hy, 2.2, 0, Math.PI * 2); ctx.fill();
        if (P.prop === 'clip' && i === 1) {
          ctx.fillStyle = '#7b5a3a'; ctx.fillRect(hx - 4, hy - 8, 8, 10);
          ctx.fillStyle = '#f5efe3'; ctx.fillRect(hx - 3, hy - 6.6, 6, 7.4);
        }
        if (P.prop === 'cloth' && i === 0) { ctx.fillStyle = '#9ec7e0'; ctx.beginPath(); ctx.ellipse(hx, hy, 4, 2.6, 0.3, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = '#4f7f9b'; ctx.lineWidth = 0.6; ctx.stroke(); }
        if (P.prop === 'bag' && i === 0) {
          ctx.fillStyle = '#f2e2c4'; ctx.strokeStyle = '#9a7a4a'; ctx.lineWidth = 0.7;
          ctx.fillRect(hx - 8, hy - 7, 11, 11); ctx.strokeRect(hx - 8, hy - 7, 11, 11);
          ctx.fillStyle = '#f47a2c'; ctx.fillRect(hx - 6, hy - 4, 7, 3);
        }
      } });
    });

    // cabeza
    const hc = proj(0, 0, 43.5 - (seated ? 0 : 0));
    hc.y += P.tilt * 0.8; hc.x += P.head;
    parts.push({ d: 0.05, draw() {
      const R = 6.9;
      const hx = hc.x, hy = hc.y;
      // cuello
      ctx.fillStyle = pal.skin; ctx.fillRect(hx - 2.4, hy + 4, 4.8, 4);
      const g2 = (a, b) => ({ x: hx + f.x * a + r.x * b, y: hy - 2.2 + (f.y * a + r.y * b) * FR });
      const drawBrim = (col) => {
        const L = g2(3, -5.6), Rr = g2(3, 5.6), T = g2(10.5, 0), T1 = g2(9, -4), T2 = g2(9, 4);
        ctx.fillStyle = col;
        ctx.beginPath(); ctx.moveTo(L.x, L.y); ctx.lineTo(T1.x, T1.y); ctx.lineTo(T.x, T.y); ctx.lineTo(T2.x, T2.y); ctx.lineTo(Rr.x, Rr.y); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 0.6; ctx.stroke();
      };
      const hasCap = !!pal.cap, hasHelm = !!pal.helmet;
      // pelo trasero
      if (!hasHelm) { ctx.fillStyle = pal.hair; ctx.beginPath(); ctx.arc(hx - f.x * 0.9, hy + 0.6 - f.y * 0.4, R + 0.4, 0, Math.PI * 2); ctx.fill(); }
      if (hasCap && front < 0) drawBrim(pal.capShade);
      // cara
      if (!hasHelm || front > -0.3) {
        const g = ctx.createRadialGradient(hx - 2, hy - 2, 1, hx, hy, R + 1);
        g.addColorStop(0, pal.skin); g.addColorStop(1, shade(pal.skin, 0.84));
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(hx, hy + 0.5, R, 0, Math.PI * 2); ctx.fill();
        if (front < -0.1) { ctx.fillStyle = pal.hair; ctx.beginPath(); ctx.arc(hx, hy + 0.5, R, 0, Math.PI * 2); ctx.fill(); }
      } else { ctx.fillStyle = pal.helmet; ctx.beginPath(); ctx.arc(hx, hy + 0.5, R, 0, Math.PI * 2); ctx.fill(); }
      // orejas
      if (Math.abs(f.x) < 0.8) { ctx.fillStyle = shade(pal.skin, 0.92); ctx.beginPath(); ctx.arc(hx - 6.8, hy + 1.5, 1.6, 0, 7); ctx.arc(hx + 6.8, hy + 1.5, 1.6, 0, 7); ctx.fill(); }
      // rostro
      if (front > 0.15 && !(hasHelm && front < 0.3)) {
        const ex = f.x * 3.2, ey = hy + 1.2 + (f.y - 1) * 0.4;
        ctx.fillStyle = '#2a1b14';
        if (Math.abs(f.x) < 0.9) { ctx.beginPath(); ctx.arc(hx + ex - 2.4, ey, 0.95, 0, 7); ctx.arc(hx + ex + 2.4, ey, 0.95, 0, 7); ctx.fill(); }
        else { ctx.beginPath(); ctx.arc(hx + ex + (f.x > 0 ? 1 : -1), ey, 0.95, 0, 7); ctx.fill(); }
        ctx.strokeStyle = '#7a3b2a'; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.arc(hx + ex * 0.8, ey + 3.2, 1.7, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();
        ctx.strokeStyle = '#2a1b14'; ctx.lineWidth = 0.9; ctx.beginPath(); ctx.moveTo(hx + ex - 3.6, ey - 2); ctx.lineTo(hx + ex - 1.2, ey - 2.2); ctx.moveTo(hx + ex + 1.2, ey - 2.2); ctx.lineTo(hx + ex + 3.6, ey - 2); ctx.stroke();
      }
      // gorra
      if (hasCap) {
        ctx.fillStyle = pal.cap;
        ctx.beginPath(); ctx.ellipse(hx, hy - 1.6, R + 0.8, R - 0.8, 0, Math.PI, Math.PI * 2); ctx.lineTo(hx + R + 0.8, hy - 0.6); ctx.quadraticCurveTo(hx, hy + (front > 0 ? -0.2 : 1.5), hx - R - 0.8, hy - 0.6); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 0.6; ctx.stroke();
        if (front > 0.2 && pal.logo) { ctx.fillStyle = '#f47a2c'; ctx.beginPath(); ctx.ellipse(hx + f.x * 2.5, hy - 3.4, 2.3, 1.8, 0, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#d83b2d'; ctx.fillRect(hx + f.x * 2.5 - 1.3, hy - 3.8, 2.6, 0.8); }
        if (front >= 0) drawBrim(pal.capShade);
      }
      if (hasHelm) {
        ctx.fillStyle = pal.helmet;
        ctx.beginPath(); ctx.ellipse(hx, hy - 0.4, R + 1.3, R + 0.9, 0, Math.PI, Math.PI * 2); ctx.lineTo(hx + R + 1.3, hy + 2.4); ctx.quadraticCurveTo(hx, hy + 4.2, hx - R - 1.3, hy + 2.4); ctx.closePath(); ctx.fill();
        ctx.fillStyle = pal.stripe; ctx.fillRect(hx - 1.1, hy - R - 1.2, 2.2, R * 0.9);
        if (front > 0.1) { ctx.fillStyle = 'rgba(40,55,70,0.9)'; ctx.beginPath(); ctx.ellipse(hx + f.x * 2, hy + 1.6, 5.6, 2.8, 0, 0, Math.PI * 2); ctx.fill(); }
        ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.arc(hx - 2, hy - 3, 3.5, 3.7, 4.6); ctx.stroke();
      }
      if (!hasCap && !hasHelm) {
        ctx.fillStyle = pal.hair;
        ctx.beginPath(); ctx.ellipse(hx, hy - 2.4, R + 0.3, R - 1.6, 0, Math.PI, Math.PI * 2); ctx.fill();
        if (front < 0.4) { ctx.beginPath(); ctx.arc(hx, hy - 0.8, R + 0.2, Math.PI * 0.95, Math.PI * 2.05); ctx.fill(); }
      }
    } });

    parts.sort((a, b) => a.d - b.d);
    parts.forEach((p) => p.draw());
  }

  const cache = new Map();
  function sprite(palKey, anim, dir, frame, seated) {
    const k = palKey + '|' + anim + '|' + dir + '|' + frame + (seated ? 's' : '');
    let c = cache.get(k);
    if (c) return c;
    c = document.createElement('canvas');
    c.width = CW * SS; c.height = CH * SS;
    const ctx = c.getContext('2d');
    ctx.scale(SS, SS);
    ctx.translate(OX, OY);
    drawFigure(ctx, getPal(palKey), anim, dir, frame, seated);
    cache.set(k, c);
    return c;
  }

  class CharacterAnimationSystem {
    static frames(anim) { return FRAMES[anim] || 4; }
    static fps(anim) { return FPS[anim] || 4; }
    // Frame actual para un personaje (walk depende de la distancia recorrida para evitar deslizamiento de pies)
    static frameOf(ch) {
      const n = FRAMES[ch.anim] || 4;
      if (ch.anim === 'walk') return Math.floor(((ch.walkPhase / 62) % 1) * n) % n;
      if (BK.settings && BK.settings.reduceMotion && (ch.anim === 'idle' || ch.anim === 'sit')) return 0;
      return Math.floor(ch.animT * (FPS[ch.anim] || 4)) % n;
    }
    static draw(ctx, ch, scale = 1, alpha = 1) {
      const anim = FRAMES[ch.anim] ? ch.anim : 'idle';
      const s = sprite(ch.pal, anim, ch.dir, CharacterAnimationSystem.frameOf(ch), ch.seated);
      if (alpha < 1) ctx.globalAlpha = alpha;
      ctx.drawImage(s, ch.x - OX * scale, ch.y - OY * scale, CW * scale, CH * scale);
      if (alpha < 1) ctx.globalAlpha = 1;
    }
    static preload() {
      ['manager', 'employee'].forEach((p) => {
        for (let d = 0; d < 8; d++) { for (let f = 0; f < 8; f++) sprite(p, 'walk', d, f); sprite(p, 'idle', d, 0); }
      });
    }
  }
  BK.CharacterAnimationSystem = CharacterAnimationSystem;
  BK.sprites = { sprite, getPal, CW, CH, OX, OY, FRAMES };

  // Coche (vista cenital elevada), pre-renderizado por color
  const carCache = new Map();
  BK.carSprite = function (color, len, wid) {
    const k = color + len + wid;
    if (carCache.has(k)) return carCache.get(k);
    const S2 = 2, pad = 10;
    const c = document.createElement('canvas');
    c.width = (len + pad * 2) * S2; c.height = (wid + pad * 2) * S2;
    const x = c.getContext('2d');
    x.scale(S2, S2); x.translate(pad + len / 2, pad + wid / 2);
    x.fillStyle = 'rgba(0,0,0,0.30)';
    x.beginPath(); x.ellipse(2, 4, len / 2 + 2, wid / 2 + 2, 0, 0, Math.PI * 2); x.fill();
    const rr = (px, py, w, h, r) => { x.beginPath(); x.moveTo(px + r, py); x.arcTo(px + w, py, px + w, py + h, r); x.arcTo(px + w, py + h, px, py + h, r); x.arcTo(px, py + h, px, py, r); x.arcTo(px, py, px + w, py, r); x.closePath(); };
    const g = x.createLinearGradient(0, -wid / 2, 0, wid / 2);
    g.addColorStop(0, shade(color, 1.25)); g.addColorStop(0.5, color); g.addColorStop(1, shade(color, 0.6));
    x.fillStyle = g; rr(-len / 2, -wid / 2, len, wid, 11); x.fill();
    x.strokeStyle = 'rgba(0,0,0,0.5)'; x.lineWidth = 1; x.stroke();
    // cristales y techo
    x.fillStyle = '#1d2630'; rr(len * 0.08, -wid * 0.38, len * 0.2, wid * 0.76, 4); x.fill();
    rr(-len * 0.36, -wid * 0.36, len * 0.14, wid * 0.72, 4); x.fill();
    const roof = x.createLinearGradient(0, -wid / 2, 0, wid / 2);
    roof.addColorStop(0, shade(color, 1.12)); roof.addColorStop(1, shade(color, 0.75));
    x.fillStyle = roof; rr(-len * 0.22, -wid * 0.36, len * 0.3, wid * 0.72, 5); x.fill();
    x.strokeStyle = 'rgba(0,0,0,0.35)'; x.stroke();
    x.fillStyle = 'rgba(255,255,255,0.18)'; rr(len * 0.30, -wid * 0.3, len * 0.18, wid * 0.14, 3); x.fill();
    // faros / pilotos
    x.fillStyle = '#fff3c4'; x.fillRect(len / 2 - 4, -wid / 2 + 3, 3.4, 5); x.fillRect(len / 2 - 4, wid / 2 - 8, 3.4, 5);
    x.fillStyle = '#c0261c'; x.fillRect(-len / 2 + 0.6, -wid / 2 + 3, 2.6, 5); x.fillRect(-len / 2 + 0.6, wid / 2 - 8, 2.6, 5);
    const o = { canvas: c, pad, S2 };
    carCache.set(k, o);
    return o;
  };
})();
