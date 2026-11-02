(function () {
  const BK = window.BK;
  const U = BK.util;
  const SS = 2; // supersampling del sprite
  const CW = 64, CH = 84, OX = 32, OY = 70; // lienzo lógico y origen (pies)
  const FR = 0.55; // compresión de profundidad (cámara elevada)

  const FRAMES = { idle: 4, walk: 8, talk: 4, point: 4, inspect: 4, clean: 8, work: 4, deliver: 4, kiosk: 4, door: 4, reactGood: 4, reactBad: 4, sit: 4, eat: 4 };
  const FPS = { idle: 3, walk: 0, talk: 6, point: 5, inspect: 4, clean: 10, work: 6, deliver: 5, kiosk: 6, door: 5, reactGood: 7, reactBad: 7, sit: 2, eat: 3 };

  const SKINS = ['#f0c8a0', '#e3b08a', '#c68e66', '#9a6a46'];
  const HAIRS = ['#2b1d16', '#4a3022', '#1c1c1c', '#7a5a3a', '#a38a64', '#8a3b22', '#d8b45a'];
  const SHIRTS = ['#3a6ea5', '#4c8c5a', '#7b5aa6', '#9aa0a6', '#d9a441', '#2f4858', '#b8566b', '#5aa1a8'];
  const PANTS = ['#2e3a4a', '#5a4a3a', '#1f1f1f', '#3b4d3a', '#4a4f66'];
  const SHOES = ['#2b2b2b', '#2b2b2b', '#e8e6e0', '#5a3a26', '#1f2a3a'];
  const TOPS = ['tee', 'tee', 'polo', 'hoodie', 'jacket'];
  const HAIR_M = ['short', 'crew', 'curly', 'sweep', 'bald'];
  const HAIR_F = ['ponytail', 'bun', 'long', 'bob', 'curly'];
  // Variantes modulares acotadas: la caché de sprites no crece con el número de clientes.
  const GUEST_VARIANTS = 48, EMP_VARIANTS = 6;

  const PAL = {
    manager: { shirt: '#dccbb0', shade: '#b8a68c', pants: '#4a3426', pantsShade: '#33231a', cap: '#5e4333', capShade: '#45301f', logo: true, tie: '#5a3f30', belt: '#6a4a34', shoe: '#2a1d16', hair: '#2b1d16', hairStyle: 'short', skin: '#f0c8a0', badge: true, short: true, collar: '#f6efe0', watch: true, hero: true },
    employee: { shirt: '#d83b2d', shade: '#a52a20', pants: '#26241f', pantsShade: '#181714', cap: '#5e4333', capShade: '#45301f', logo: true, belt: '#222', shoe: '#1f1a17', hair: '#2b1d16', hairStyle: 'short', skin: '#e3b08a', chestLogo: true, tag: true, short: true },
    rider: { shirt: '#f47a2c', shade: '#c85a18', pants: '#2a2f3a', pantsShade: '#1c2028', helmet: '#262626', helmetShade: '#141414', stripe: '#f47a2c', shoe: '#1a1a1a', hair: '#1c1c1c', skin: '#c68e66', backpack: true, short: false }
  };
  PAL.managerF = Object.assign({}, PAL.manager, { female: true, hairStyle: 'ponytail', hair: '#3a2418', tie: null, scarf: '#f47a2c', lashes: true, build: 0.97 });
  const EMP_LOOKS = [
    { hairStyle: 'short', hair: '#2b1d16', skin: '#e3b08a' },
    { female: true, hairStyle: 'ponytail', hair: '#4a3022', skin: '#f0c8a0', lashes: true, build: 0.96 },
    { hairStyle: 'crew', hair: '#7a5a3a', skin: '#c68e66', glasses: true, build: 1.05 },
    { female: true, hairStyle: 'bun', hair: '#1c1c1c', skin: '#9a6a46', lashes: true },
    { hairStyle: 'curly', hair: '#1c1c1c', skin: '#9a6a46', build: 0.98 },
    { female: true, hairStyle: 'bob', hair: '#8a3b22', skin: '#e3b08a', lashes: true, build: 0.96 }
  ];
  function employeePal(n) {
    const look = EMP_LOOKS[n % EMP_VARIANTS], k = [1, 0.97, 1.03, 0.99, 1.02, 0.98][n % EMP_VARIANTS];
    const shirt = shade('#d83b2d', k);
    return Object.assign({}, PAL.employee, look, { shirt, shade: shade(shirt, 0.76) });
  }
  function hash32(n) {
    let x = Math.imul(n + 0x9e3779b9, 0x85ebca6b) >>> 0;
    x ^= x >>> 15; x = Math.imul(x, 0xc2b2ae35) >>> 0; x ^= x >>> 13;
    return x >>> 0;
  }
  function guestPal(seed) {
    const H = hash32(seed * 31 + 7);
    const pick = (arr, s) => arr[(H >>> s) % arr.length];
    const female = (H & 1) === 1;
    const shirt = pick(SHIRTS, 1), pants = pick(PANTS, 4), top = pick(TOPS, 7);
    return {
      shirt, shade: shade(shirt, 0.78), pants, pantsShade: shade(pants, 0.7), top, female,
      cap: (H >>> 9) % 4 === 0 ? pick(SHIRTS, 12) : null, capShade: '#222', shoe: pick(SHOES, 14),
      hair: pick(HAIRS, 16), hairStyle: (female ? HAIR_F : HAIR_M)[(H >>> 19) % 5], skin: pick(SKINS, 21),
      short: top === 'tee' || top === 'polo', shorts: top === 'tee' && (H >>> 23) % 5 === 0 && !female,
      glasses: (H >>> 25) % 5 === 0, beard: !female && (H >>> 27) % 6 === 0, bag: (H >>> 28) % 4 === 0,
      scarf: null, lashes: female, build: 0.94 + ((H >>> 5) % 9) / 75, guest: true
    };
  }
  function shade(hex, k) {
    const n = parseInt(hex.slice(1), 16);
    const c = (v) => Math.max(0, Math.min(255, Math.round(v * k)));
    return '#' + [c((n >> 16) & 255), c((n >> 8) & 255), c(n & 255)].map((v) => v.toString(16).padStart(2, '0')).join('');
  }
  // Normaliza la clave de paleta a una variante acotada (guestN, employeeN)
  function palKeyOf(key) {
    if (key.startsWith('guest')) return 'guest' + ((parseInt(key.slice(5), 10) || 0) % GUEST_VARIANTS);
    if (key.startsWith('employee') && key.length > 8) return 'employee' + ((parseInt(key.slice(8), 10) || 0) % EMP_VARIANTS);
    return key;
  }
  // Uniformes de Popeyes (solo si la marca activa lo es): encargado polo azul y caqui, equipo camiseta naranja.
  function brandize(key, p) {
    if (!BK.game || BK.game.brand !== 'popeyes') return p;
    if (key === 'manager' || key === 'managerF') {
      return Object.assign({}, p, { shirt: '#7ec6f3', shade: '#5a9fd0', pants: '#c3ae8a', pantsShade: '#a08c6c', cap: '#4a3b2f', capShade: '#33281f', belt: '#6a4a34', shoe: '#e9e6df', tie: null, collar: '#a6d8f7', chestCol: '#ff7a00', chestLogo: true });
    }
    if (key.startsWith('employee')) {
      return Object.assign({}, p, { shirt: '#f27a12', shade: '#bf5a08', pants: '#2d2a26', pantsShade: '#1c1a17', cap: '#4a3b2f', capShade: '#33281f', chestCol: '#ffffff' });
    }
    return p;
  }
  const palCache = {};
  function getPal(key) {
    key = palKeyOf(key);
    if (palCache[key]) return palCache[key];
    let p;
    if (PAL[key]) p = PAL[key];
    else if (key.startsWith('guest')) p = guestPal(parseInt(key.slice(5), 10) || 0);
    else if (key.startsWith('employee')) p = employeePal(parseInt(key.slice(8), 10) || 0);
    else p = PAL.employee;
    p = brandize(key, p);
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

    const fem = !!pal.female, build = pal.build || 1;
    const hw = (7.2 + 0 * front) * (fem ? 0.94 : 1);
    const torsoW = (9.5 + 6.5 * Math.abs(front)) * build * (fem ? 0.93 : 1);
    const hipH = 20, shH = 36.5;

    // piernas
    if (!seated) {
      [0, 1].forEach((i) => {
        const side = i === 0 ? 1 : -1;
        const hip = proj(0, side * 3.2, hipH);
        const foot = proj(P.legs[i].a, side * 3.2, P.legs[i].lift);
        parts.push({ d: foot.d - 0.2, draw() {
          const col = side * (r.x) >= 0 ? pal.pants : pal.pantsShade;
          const at = (t) => ({ x: hip.x + (foot.x - hip.x) * t, y: hip.y + (foot.y - hip.y) * t });
          limb(ctx, hip.x, hip.y, foot.x, foot.y, 6.5, shade(col, 0.55));
          if (pal.shorts) {
            const kn = at(0.5);
            limb(ctx, kn.x, kn.y, foot.x, foot.y, 5.3, shade(pal.skin, 0.75)); limb(ctx, kn.x, kn.y, foot.x, foot.y, 4.4, pal.skin);
            limb(ctx, hip.x, hip.y, kn.x, kn.y, 5.4, col);
          } else {
            limb(ctx, hip.x, hip.y, foot.x, foot.y, 5.4, col);
            const cu = at(0.8); limb(ctx, cu.x, cu.y, foot.x, foot.y, 5.6, shade(col, 0.78));
          }
          const sx = foot.x + f.x * 1.8, sy = foot.y + f.y - 0.4;
          ctx.fillStyle = shade(pal.shoe, 0.55); ctx.beginPath(); ctx.ellipse(sx, sy + 0.9, 4.1, 2.5, 0, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = pal.shoe; ctx.beginPath(); ctx.ellipse(sx, sy, 3.9, 2.4, 0, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = 'rgba(255,255,255,0.22)'; ctx.beginPath(); ctx.ellipse(sx + f.x * 1.1 - 0.6, sy - 0.8, 1.9, 0.9, 0, 0, Math.PI * 2); ctx.fill();
        } });
      });
    }

    // torso
    const tb = proj(0, 0, seated ? hipH - 1 : hipH - 1), tt = proj(0, 0, shH);
    parts.push({ d: 0, draw() {
      const x0 = tb.x, yb = tb.y, yt = tt.y;
      const wB = torsoW * (fem ? 0.8 : 0.92), wT = torsoW;
      ctx.beginPath();
      ctx.moveTo(x0 - wB / 2, yb); ctx.lineTo(x0 + wB / 2, yb);
      ctx.quadraticCurveTo(x0 + wT / 2 + 1, (yb + yt) / 2, x0 + wT / 2, yt + 2);
      ctx.quadraticCurveTo(x0, yt - 2.2, x0 - wT / 2, yt + 2);
      ctx.quadraticCurveTo(x0 - wT / 2 - 1, (yb + yt) / 2, x0 - wB / 2, yb);
      ctx.closePath();
      const g = ctx.createLinearGradient(x0 - wT / 2, 0, x0 + wT / 2, 0);
      g.addColorStop(0, pal.shirt); g.addColorStop(1, pal.shade);
      ctx.fillStyle = g; ctx.fill();
      ctx.strokeStyle = pal.hero ? 'rgba(255,228,170,0.9)' : 'rgba(0,0,0,0.35)'; ctx.lineWidth = pal.hero ? 0.9 : 0.7; ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.1)'; ctx.fillRect(x0 - wT / 2 + 1.2, yt + 4, 1.6, yb - yt - 8);
      // capucha (parte trasera)
      if (pal.top === 'hoodie' && front < 0.3) { ctx.fillStyle = shade(pal.shirt, 0.82); ctx.beginPath(); ctx.ellipse(x0, yt + 1.2, 5.6, 3.1, 0, 0, Math.PI * 2); ctx.fill(); }
      // cinturón
      ctx.fillStyle = pal.belt || pal.pants;
      ctx.fillRect(x0 - wB / 2, yb - 2.4, wB, 2.4);
      if (pal.hero) { ctx.fillStyle = '#5e4333'; ctx.fillRect(x0 - wT / 2 + 0.4, yt + 1.7, 3.6, 1.8); ctx.fillRect(x0 + wT / 2 - 4, yt + 1.7, 3.6, 1.8); }
      if (front > 0.25) {
        if (pal.belt) { ctx.fillStyle = '#d9c27a'; ctx.fillRect(x0 + f.x * 2 - 1.4, yb - 2.4, 2.8, 2.4); }
        const cx = x0 + f.x * 1.5, col = pal.collar || shade(pal.shirt, 1.22);
        if (pal.top === 'hoodie') {
          ctx.strokeStyle = shade(pal.shirt, 0.7); ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(cx, yt + 1.6, 4.2, 0.1 * Math.PI, 0.9 * Math.PI); ctx.stroke();
          ctx.strokeStyle = '#f2f2f2'; ctx.lineWidth = 0.6; ctx.beginPath(); ctx.moveTo(cx - 1.6, yt + 4.5); ctx.lineTo(cx - 1.8, yt + 8.5); ctx.moveTo(cx + 1.6, yt + 4.5); ctx.lineTo(cx + 1.8, yt + 8.5); ctx.stroke();
        } else if (pal.top === 'jacket') {
          ctx.strokeStyle = shade(pal.shirt, 0.55); ctx.lineWidth = 0.9; ctx.beginPath(); ctx.moveTo(cx, yt + 2); ctx.lineTo(cx, yb - 2); ctx.stroke();
          ctx.fillStyle = shade(pal.shirt, 0.7); ctx.beginPath(); ctx.moveTo(cx - 1, yt); ctx.lineTo(cx - 5, yt + 2); ctx.lineTo(cx - 2, yt + 5); ctx.closePath(); ctx.moveTo(cx + 1, yt); ctx.lineTo(cx + 5, yt + 2); ctx.lineTo(cx + 2, yt + 5); ctx.closePath(); ctx.fill();
        } else if (pal.top === 'tee') {
          ctx.fillStyle = pal.skin; ctx.beginPath(); ctx.ellipse(cx, yt + 1.6, 2.7, 1.5, 0, 0, Math.PI * 2); ctx.fill();
        } else {
          ctx.fillStyle = col; ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 0.4;
          ctx.beginPath(); ctx.moveTo(cx - 1.2, yt + 0.4); ctx.lineTo(cx - 5, yt + 2.2); ctx.lineTo(cx - 2.6, yt + 5.4); ctx.closePath(); ctx.fill(); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(cx + 1.2, yt + 0.4); ctx.lineTo(cx + 5, yt + 2.2); ctx.lineTo(cx + 2.6, yt + 5.4); ctx.closePath(); ctx.fill(); ctx.stroke();
        }
        if (pal.scarf) { ctx.fillStyle = pal.scarf; ctx.beginPath(); ctx.moveTo(cx - 3.2, yt + 1.6); ctx.lineTo(cx + 3.2, yt + 1.6); ctx.lineTo(cx, yt + 7); ctx.closePath(); ctx.fill(); }
        if (pal.tag) { ctx.fillStyle = '#f5efe3'; ctx.fillRect(x0 - wT / 2 + 2 + f.x * 2, yt + 5, 3.4, 1.7); }
        if (pal.bag) { ctx.strokeStyle = '#3b2a22'; ctx.lineWidth = 1.3; ctx.beginPath(); ctx.moveTo(x0 - wT / 2 + 1.5, yt + 2.4); ctx.lineTo(x0 + wB / 2 - 0.5, yb + 1.5); ctx.stroke(); ctx.fillStyle = '#6b4a34'; ctx.fillRect(x0 + wB / 2 - 3, yb - 1, 5, 5.5); }
        if (pal.tie) { ctx.fillStyle = pal.tie; ctx.beginPath(); ctx.moveTo(x0 - 1.4 + f.x * 3, yt + 3); ctx.lineTo(x0 + 1.4 + f.x * 3, yt + 3); ctx.lineTo(x0 + 1.8 + f.x * 3, yb - 3); ctx.lineTo(x0 + f.x * 3, yb - 1); ctx.lineTo(x0 - 1.8 + f.x * 3, yb - 3); ctx.closePath(); ctx.fill(); }
        if (pal.badge) { ctx.fillStyle = '#f2d27a'; ctx.fillRect(x0 - wT / 2 + 2 + f.x * 2, yt + 5, 3.6, 1.8); }
        if (pal.logo && pal.tie) { ctx.fillStyle = '#f47a2c'; ctx.beginPath(); ctx.ellipse(x0 + wT / 2 - 3 + f.x * 2, yt + 6.5, 1.8, 1.5, 0, 0, Math.PI * 2); ctx.fill(); }
        if (pal.chestLogo) { ctx.fillStyle = pal.chestCol || '#f47a2c'; ctx.beginPath(); ctx.ellipse(x0 + wT / 2 - 3.2 + f.x * 2, yt + 6.5, 2, 1.7, 0, 0, Math.PI * 2); ctx.fill(); }
      }
      if (pal.backpack && front < -0.2) {
        ctx.fillStyle = '#e8661a'; ctx.strokeStyle = '#7a3208'; ctx.lineWidth = 0.8;
        ctx.fillRect(x0 - 7, yt + 1, 14, 13); ctx.strokeRect(x0 - 7, yt + 1, 14, 13);
        ctx.fillStyle = '#f9c9a0'; ctx.fillRect(x0 - 5, yt + 4, 10, 1.4);
      }
      if (pal.bag && front < -0.2) { ctx.fillStyle = '#6b4a34'; ctx.strokeStyle = '#3b2a22'; ctx.lineWidth = 0.7; ctx.fillRect(x0 - 4.5, yt + 5, 9, 9); ctx.strokeRect(x0 - 4.5, yt + 5, 9, 9); }
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
        const sl = pal.shirt;
        if (pal.short) {
          limb(ctx, mid.x, mid.y, hx, hy, 4.6, shade(pal.skin, 0.72)); limb(ctx, mid.x, mid.y, hx, hy, 3.6, pal.skin);
          limb(ctx, sh.x, sh.y, mid.x, mid.y, 6.2, shade(sl, 0.6)); limb(ctx, sh.x, sh.y, mid.x, mid.y, 5.2, sl);
          ctx.strokeStyle = shade(sl, 0.72); ctx.lineWidth = 0.8; ctx.beginPath(); ctx.arc(mid.x, mid.y, 2.5, 0, Math.PI * 2); ctx.stroke();
        } else {
          limb(ctx, sh.x, sh.y, hx, hy, 6.2, shade(sl, 0.6)); limb(ctx, sh.x, sh.y, hx, hy, 5.2, sl);
          limb(ctx, sh.x + (hx - sh.x) * 0.8, sh.y + (hy - sh.y) * 0.8, hx, hy, 5.3, shade(sl, 0.7));
        }
        if (pal.watch && pal.short) { ctx.fillStyle = '#f2d27a'; ctx.beginPath(); ctx.arc(mid.x + (hx - mid.x) * 0.72, mid.y + (hy - mid.y) * 0.72, 1.7, 0, Math.PI * 2); ctx.fill(); }
        ctx.fillStyle = pal.skin; ctx.beginPath(); ctx.arc(hx, hy, 2.3, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = shade(pal.skin, 0.7); ctx.lineWidth = 0.5; ctx.stroke();
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
      const hs = pal.hairStyle || 'short';
      const bandCol = pal.logo ? '#d83b2d' : '#e8c24a';
      // pelo y recogidos: capa trasera (antes de la cara) y delantera (cuando miramos de espaldas)
      const hairBack = () => {
        if (hasHelm || hs === 'bald') return;
        ctx.fillStyle = pal.hair;
        ctx.beginPath(); ctx.arc(hx - f.x * 0.9, hy + 0.6 - f.y * 0.4, R + 0.4, 0, Math.PI * 2); ctx.fill();
        if (hs === 'long') { ctx.beginPath(); ctx.ellipse(hx - f.x * 1.2, hy + 5.6, R + 1.3, 7.4, 0, 0, Math.PI * 2); ctx.fill(); }
        else if (hs === 'ponytail') { ctx.beginPath(); ctx.ellipse(hx - f.x * 1.0, hy + 3.6, R + 1.1, 5.4, 0, 0, Math.PI * 2); ctx.fill(); }
        else if (hs === 'bob') { ctx.beginPath(); ctx.ellipse(hx - f.x * 0.8, hy + 3.2, R + 1.5, R + 0.4, 0, 0, Math.PI * 2); ctx.fill(); }
        else if (hs === 'curly') { for (let a = 0; a < 8; a++) { const t = (a / 8) * Math.PI * 2; ctx.beginPath(); ctx.arc(hx + Math.cos(t) * (R - 0.4), hy - 0.4 + Math.sin(t) * (R - 0.8), 2.7, 0, Math.PI * 2); ctx.fill(); } }
      };
      const hairTie = () => {
        if (hasHelm) return;
        if (hs === 'ponytail') {
          const a = g2(-R * 0.9, 0), sway = P.legs[0].a * 0.18;
          // coleta larga y gruesa que cae por la espalda y se ve a ambos lados del cuello
          limb(ctx, a.x, a.y + 0.6, a.x + sway - f.x * 2, a.y + 15, 6, pal.hair);
          limb(ctx, a.x, a.y + 8, a.x + sway * 1.2 - f.x * 2.4, a.y + 17, 3.6, shade(pal.hair, 0.85));
          ctx.fillStyle = bandCol; ctx.beginPath(); ctx.arc(a.x, a.y + 0.8, 2.1, 0, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 0.5; ctx.stroke();
        } else if (hs === 'bun') {
          const a = g2(-R * 0.75, 0), by = hasCap ? a.y + 2.2 : a.y - R + 0.4;
          ctx.fillStyle = pal.hair; ctx.beginPath(); ctx.arc(a.x, by, 3.2, 0, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = shade(pal.hair, 0.6); ctx.lineWidth = 0.6; ctx.stroke();
        }
      };
      hairBack();
      if (front >= 0.1) hairTie();
      if (hasCap && front < 0) drawBrim(pal.capShade);
      // cara
      if (!hasHelm || front > -0.3) {
        const g = ctx.createRadialGradient(hx - 2, hy - 2, 1, hx, hy, R + 1);
        g.addColorStop(0, pal.skin); g.addColorStop(1, shade(pal.skin, 0.84));
        ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(hx, hy + 0.5, R * 0.97, R * 1.02, 0, 0, Math.PI * 2); ctx.fill();
        if (front < -0.1 && hs !== 'bald') { ctx.fillStyle = pal.hair; ctx.beginPath(); ctx.ellipse(hx, hy + 0.5, R * 0.97, R * 1.02, 0, 0, Math.PI * 2); ctx.fill(); }
      } else { ctx.fillStyle = pal.helmet; ctx.beginPath(); ctx.arc(hx, hy + 0.5, R, 0, Math.PI * 2); ctx.fill(); }
      // orejas
      if (Math.abs(f.x) < 0.8 && hs !== 'long' && hs !== 'bob' && hs !== 'curly') { ctx.fillStyle = shade(pal.skin, 0.92); ctx.beginPath(); ctx.arc(hx - 6.8, hy + 1.5, 1.6, 0, 7); ctx.arc(hx + 6.8, hy + 1.5, 1.6, 0, 7); ctx.fill(); }
      // rostro
      if (front > 0.15 && !(hasHelm && front < 0.3)) {
        const ex = f.x * 3.2, ey = hy + 1.2 + (f.y - 1) * 0.4;
        if (pal.beard) { ctx.fillStyle = pal.hair; ctx.beginPath(); ctx.ellipse(hx + ex * 0.5, hy + 3.2, R * 0.8, R * 0.55, 0, 0.05 * Math.PI, 0.95 * Math.PI); ctx.fill(); }
        ctx.fillStyle = '#2a1b14';
        if (Math.abs(f.x) < 0.9) { ctx.beginPath(); ctx.arc(hx + ex - 2.4, ey, 0.95, 0, 7); ctx.arc(hx + ex + 2.4, ey, 0.95, 0, 7); ctx.fill(); }
        else { ctx.beginPath(); ctx.arc(hx + ex + (f.x > 0 ? 1 : -1), ey, 0.95, 0, 7); ctx.fill(); }
        ctx.strokeStyle = '#7a3b2a'; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.arc(hx + ex * 0.8, ey + 3.2, 1.7, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();
        ctx.strokeStyle = '#2a1b14'; ctx.lineWidth = 0.9; ctx.beginPath(); ctx.moveTo(hx + ex - 3.6, ey - 2); ctx.lineTo(hx + ex - 1.2, ey - 2.2); ctx.moveTo(hx + ex + 1.2, ey - 2.2); ctx.lineTo(hx + ex + 3.6, ey - 2); ctx.stroke();
        if (Math.abs(f.x) < 0.9) {
          ctx.fillStyle = 'rgba(214,110,90,0.2)'; ctx.beginPath(); ctx.arc(hx + ex * 0.6 - 3.8, ey + 2.4, 1.6, 0, 7); ctx.arc(hx + ex * 0.6 + 3.8, ey + 2.4, 1.6, 0, 7); ctx.fill();
          ctx.strokeStyle = shade(pal.skin, 0.74); ctx.lineWidth = 0.6; ctx.beginPath(); ctx.moveTo(hx + ex * 0.9, ey + 0.6); ctx.lineTo(hx + ex * 0.9 - 0.7, ey + 2.4); ctx.lineTo(hx + ex * 0.9 + 0.6, ey + 2.4); ctx.stroke();
        }
        if (pal.lashes && Math.abs(f.x) < 0.9) { ctx.strokeStyle = '#2a1b14'; ctx.lineWidth = 0.7; ctx.beginPath(); ctx.moveTo(hx + ex - 3.4, ey - 0.6); ctx.lineTo(hx + ex - 4.1, ey - 1.5); ctx.moveTo(hx + ex + 3.4, ey - 0.6); ctx.lineTo(hx + ex + 4.1, ey - 1.5); ctx.stroke(); }
        if (pal.glasses) {
          ctx.strokeStyle = '#1b1b1b'; ctx.lineWidth = 0.8;
          if (Math.abs(f.x) < 0.9) {
            ctx.beginPath(); ctx.arc(hx + ex - 2.5, ey, 2.2, 0, 7); ctx.stroke();
            ctx.beginPath(); ctx.arc(hx + ex + 2.5, ey, 2.2, 0, 7); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(hx + ex - 0.4, ey); ctx.lineTo(hx + ex + 0.4, ey); ctx.stroke();
          } else { ctx.beginPath(); ctx.arc(hx + ex + (f.x > 0 ? 1 : -1), ey, 2.2, 0, 7); ctx.stroke(); }
        }
      }
      // gorra
      if (hasCap) {
        ctx.fillStyle = pal.cap;
        ctx.beginPath(); ctx.ellipse(hx, hy - 1.6, R + 0.8, R - 0.8, 0, Math.PI, Math.PI * 2); ctx.lineTo(hx + R + 0.8, hy - 0.6); ctx.quadraticCurveTo(hx, hy + (front > 0 ? -0.2 : 1.5), hx - R - 0.8, hy - 0.6); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 0.6; ctx.stroke();
        ctx.fillStyle = pal.capShade; ctx.beginPath(); ctx.arc(hx, hy - 1.6 - (R - 0.8), 1, 0, Math.PI * 2); ctx.fill();
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
      if ((hs === 'long' || hs === 'bob') && !hasHelm && front > -0.3) {
        ctx.fillStyle = pal.hair;
        ctx.beginPath(); ctx.ellipse(hx - R + 0.6, hy + 3.4, 1.9, 4.6, 0, 0, Math.PI * 2); ctx.ellipse(hx + R - 0.6, hy + 3.4, 1.9, 4.6, 0, 0, Math.PI * 2); ctx.fill();
      }
      if (!hasCap && !hasHelm && hs !== 'bald') {
        ctx.fillStyle = pal.hair;
        if (hs === 'curly') { for (let a = 0; a < 6; a++) { const t = Math.PI + (a / 5) * Math.PI; ctx.beginPath(); ctx.arc(hx + Math.cos(t) * (R - 0.2), hy - 0.8 + Math.sin(t) * (R - 0.6), 2.8, 0, Math.PI * 2); ctx.fill(); } }
        const top = hs === 'crew' ? [R - 2.5, -2.9] : [R - 1.6, -2.4];
        ctx.beginPath(); ctx.ellipse(hx, hy + top[1], R + 0.3, top[0], 0, Math.PI, Math.PI * 2); ctx.fill();
        if (hs === 'sweep') { ctx.beginPath(); ctx.ellipse(hx + 2, hy - 4.6, R - 1.4, 2.4, -0.25, 0, Math.PI * 2); ctx.fill(); }
        if (front < 0.4) { ctx.beginPath(); ctx.arc(hx, hy - 0.8, R + 0.2, Math.PI * 0.95, Math.PI * 2.05); ctx.fill(); }
      }
      if (front < 0.1) hairTie();
    } });

    parts.sort((a, b) => a.d - b.d);
    parts.forEach((p) => p.draw());
  }

  const cache = new Map();
  function sprite(palKey, anim, dir, frame, seated) {
    palKey = palKeyOf(palKey);
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
      const sel = BK.game && BK.game.save && BK.game.save.settings.managerGender === 'f' ? 'managerF' : 'manager';
      [sel, 'employee0', 'employee1', 'employee2'].forEach((p) => {
        for (let d = 0; d < 8; d++) { for (let f = 0; f < 8; f++) sprite(p, 'walk', d, f); sprite(p, 'idle', d, 0); }
      });
    }
  }
  BK.CharacterAnimationSystem = CharacterAnimationSystem;
  BK.sprites = { sprite, getPal, CW, CH, OX, OY, FRAMES };

  // Coche (vista cenital elevada), pre-renderizado por color, carrocería y accesorio.
  // Las dimensiones (len x wid) son las del gameplay; la carrocería solo cambia el aspecto interior.
  const carCache = new Map();
  const CAR_LAYOUT = {
    sedan: { ws: 0.30, rf: 0.14, rb: -0.14, rg: -0.28, rad: 11 },
    hatch: { ws: 0.28, rf: 0.14, rb: -0.22, rg: -0.34, rad: 10 },
    suv: { ws: 0.26, rf: 0.12, rb: -0.30, rg: -0.40, rad: 8 },
    pickup: { ws: 0.30, rf: 0.16, rb: -0.02, rg: -0.10, rad: 7 },
    van: { ws: 0.36, rf: 0.24, rb: -0.40, rg: -0.45, rad: 6 }
  };
  BK.CAR_BODIES = ['sedan', 'sedan', 'hatch', 'suv', 'pickup', 'van'];
  BK.CAR_ACCS = ['', '', '', 'rack', 'box', 'stripe', 'taxi'];
  BK.carSprite = function (color, len, wid, body, acc) {
    body = CAR_LAYOUT[body] ? body : 'sedan';
    acc = acc || '';
    if (acc === 'taxi' && body !== 'sedan') acc = '';
    if (acc === 'rack' && (body === 'pickup' || body === 'van')) acc = '';
    if (acc === 'box' && (body === 'pickup' || body === 'van')) acc = '';
    const k = color + '|' + len + '|' + wid + '|' + body + '|' + acc;
    if (carCache.has(k)) return carCache.get(k);
    const S2 = 2, pad = 10, Ly = CAR_LAYOUT[body];
    const c = document.createElement('canvas');
    c.width = (len + pad * 2) * S2; c.height = (wid + pad * 2) * S2;
    const x = c.getContext('2d');
    x.scale(S2, S2); x.translate(pad + len / 2, pad + wid / 2);
    const hl = len / 2, hw = wid / 2, bigWheel = body === 'suv' || body === 'pickup' ? 1.12 : 1;
    const rr = (px, py, w, h, r) => { x.beginPath(); x.moveTo(px + r, py); x.arcTo(px + w, py, px + w, py + h, r); x.arcTo(px + w, py + h, px, py + h, r); x.arcTo(px, py + h, px, py, r); x.arcTo(px, py, px + w, py, r); x.closePath(); };
    const poly = (pts) => { x.beginPath(); pts.forEach((p, i) => (i ? x.lineTo(p[0], p[1]) : x.moveTo(p[0], p[1]))); x.closePath(); };
    const glass = () => { const g = x.createLinearGradient(0, -hw, 0, hw); g.addColorStop(0, '#34485a'); g.addColorStop(0.5, '#16212b'); g.addColorStop(1, '#0d141b'); return g; };

    x.fillStyle = 'rgba(0,0,0,0.30)';
    x.beginPath(); x.ellipse(2, 4, hl + 2, hw + 2, 0, 0, Math.PI * 2); x.fill();

    // ruedas (asoman por los pasos de rueda)
    const wheelXs = body === 'van' ? [0.31, -0.3] : [0.3, -0.29], ww = len * 0.17 * bigWheel, wh = 5;
    wheelXs.forEach((fx) => [-1, 1].forEach((sd) => {
      x.fillStyle = '#14161a'; rr(len * fx - ww / 2, sd * (hw - 0.3) - wh / 2, ww, wh, 1.8); x.fill();
      x.fillStyle = '#a9b0b6'; rr(len * fx - ww * 0.22, sd * (hw + 0.9) - 0.7, ww * 0.44, 1.4, 0.7); x.fill();
    }));

    // carrocería
    const g = x.createLinearGradient(0, -hw, 0, hw);
    g.addColorStop(0, shade(color, 1.25)); g.addColorStop(0.5, color); g.addColorStop(1, shade(color, 0.6));
    x.fillStyle = g; rr(-hl, -hw, len, wid, Ly.rad); x.fill();
    x.strokeStyle = 'rgba(0,0,0,0.5)'; x.lineWidth = 1; x.stroke();
    // pasos de rueda
    x.fillStyle = 'rgba(0,0,0,0.3)';
    wheelXs.forEach((fx) => { rr(len * fx - ww / 2 - 0.6, -hw, ww + 1.2, 3.4, 1.8); x.fill(); rr(len * fx - ww / 2 - 0.6, hw - 3.4, ww + 1.2, 3.4, 1.8); x.fill(); });
    // capó con volumen y línea de panel
    if (body !== 'van') {
      const hg = x.createLinearGradient(len * Ly.ws, 0, hl, 0);
      hg.addColorStop(0, 'rgba(255,255,255,0.20)'); hg.addColorStop(1, 'rgba(255,255,255,0.02)');
      x.fillStyle = hg; rr(len * Ly.ws, -hw * 0.78, hl - len * Ly.ws - 3, wid * 0.78, 5); x.fill();
      x.strokeStyle = 'rgba(0,0,0,0.22)'; x.lineWidth = 0.8; x.stroke();
    }
    // maletero / caja
    if (body === 'pickup') {
      const bg = x.createLinearGradient(0, -hw, 0, hw); bg.addColorStop(0, '#383c41'); bg.addColorStop(1, '#202327');
      x.fillStyle = bg; rr(-hl + 2.5, -hw * 0.82, len * 0.38, wid * 0.82, 3); x.fill();
      x.strokeStyle = 'rgba(255,255,255,0.12)'; x.lineWidth = 0.8;
      for (let i = 1; i < 4; i++) { x.beginPath(); x.moveTo(-hl + 2.5 + i * len * 0.095, -hw * 0.8); x.lineTo(-hl + 2.5 + i * len * 0.095, hw * 0.8); x.stroke(); }
    } else if (body === 'sedan') {
      x.strokeStyle = 'rgba(0,0,0,0.2)'; x.lineWidth = 0.8; rr(-hl + 3, -hw * 0.76, len * Ly.rg + hl - 3 + len * 0.02, wid * 0.76, 4); x.stroke();
    }

    // parabrisas y luneta
    const wg = glass();
    x.fillStyle = wg;
    poly([[len * Ly.ws, -wid * 0.37], [len * Ly.rf, -wid * 0.33], [len * Ly.rf, wid * 0.33], [len * Ly.ws, wid * 0.37]]); x.fill();
    poly([[len * Ly.rb, -wid * 0.33], [len * Ly.rg, -wid * 0.36], [len * Ly.rg, wid * 0.36], [len * Ly.rb, wid * 0.33]]); x.fill();
    x.fillStyle = 'rgba(255,255,255,0.18)';
    poly([[len * (Ly.ws - 0.03), -wid * 0.3], [len * (Ly.ws - 0.07), -wid * 0.3], [len * (Ly.rf + 0.03), wid * 0.05], [len * (Ly.rf + 0.07), wid * 0.05]]); x.fill();
    // techo y ventanillas laterales
    const roof = x.createLinearGradient(0, -hw, 0, hw);
    roof.addColorStop(0, shade(color, 1.14)); roof.addColorStop(1, shade(color, 0.74));
    x.fillStyle = roof; rr(len * Ly.rb, -wid * 0.34, len * (Ly.rf - Ly.rb), wid * 0.68, 5); x.fill();
    x.strokeStyle = 'rgba(0,0,0,0.35)'; x.lineWidth = 1; x.stroke();
    x.fillStyle = wg;
    rr(len * Ly.rb + 2, -wid * 0.42, len * (Ly.rf - Ly.rb) - 4, wid * 0.075, 2); x.fill();
    rr(len * Ly.rb + 2, wid * 0.345, len * (Ly.rf - Ly.rb) - 4, wid * 0.075, 2); x.fill();
    if (body === 'van') {
      x.strokeStyle = 'rgba(0,0,0,0.18)'; x.lineWidth = 0.8;
      for (let i = 1; i < 4; i++) { const px = len * Ly.rb + i * len * (Ly.rf - Ly.rb) / 4; x.beginPath(); x.moveTo(px, -wid * 0.3); x.lineTo(px, wid * 0.3); x.stroke(); }
    }
    x.fillStyle = 'rgba(255,255,255,0.16)'; rr(len * (Ly.rb + 0.04), -wid * 0.28, len * 0.1, wid * 0.12, 3); x.fill();

    // accesorios de techo
    if (acc === 'rack' || body === 'suv') {
      x.strokeStyle = '#25282c'; x.lineWidth = 1.3;
      x.beginPath(); x.moveTo(len * Ly.rb + 3, -wid * 0.27); x.lineTo(len * Ly.rf - 3, -wid * 0.27); x.moveTo(len * Ly.rb + 3, wid * 0.27); x.lineTo(len * Ly.rf - 3, wid * 0.27); x.stroke();
      if (acc === 'rack') { x.lineWidth = 1; [0.25, 0.7].forEach((t) => { const px = len * (Ly.rb + (Ly.rf - Ly.rb) * t); x.beginPath(); x.moveTo(px, -wid * 0.3); x.lineTo(px, wid * 0.3); x.stroke(); }); }
    }
    if (acc === 'box') { x.fillStyle = '#2b2f35'; rr(len * Ly.rb + 3, -wid * 0.24, len * (Ly.rf - Ly.rb) - 6, wid * 0.48, 4); x.fill(); x.fillStyle = 'rgba(255,255,255,0.16)'; rr(len * Ly.rb + 5, -wid * 0.2, len * (Ly.rf - Ly.rb) - 14, wid * 0.1, 2); x.fill(); }
    if (acc === 'taxi') { x.fillStyle = '#f2c230'; rr(len * (Ly.rb + (Ly.rf - Ly.rb) * 0.35), -wid * 0.12, len * 0.07, wid * 0.24, 1.5); x.fill(); x.strokeStyle = 'rgba(0,0,0,0.4)'; x.lineWidth = 0.6; x.stroke(); }
    if (acc === 'stripe') { x.fillStyle = 'rgba(255,255,255,0.5)'; x.fillRect(-hl + 2, -wid * 0.1, len - 4, wid * 0.07); x.fillRect(-hl + 2, wid * 0.03, len - 4, wid * 0.07); }

    // retrovisores
    x.fillStyle = shade(color, 0.8); x.strokeStyle = 'rgba(0,0,0,0.45)'; x.lineWidth = 0.6;
    [-1, 1].forEach((sd) => { rr(len * (Ly.ws - 0.02) - 1.6, sd < 0 ? -hw - 2.3 : hw - 0.4, 3.4, 2.7, 1.1); x.fill(); x.stroke(); });

    // paragolpes, parrilla, faros y pilotos
    x.fillStyle = 'rgba(22,22,22,0.55)';
    rr(hl - 3, -hw + 1.2, 3, wid - 2.4, 1.2); x.fill(); rr(-hl, -hw + 1.2, 3, wid - 2.4, 1.2); x.fill();
    x.fillStyle = '#16181b'; rr(hl - 2.6, -wid * 0.15, 2.2, wid * 0.3, 0.8); x.fill();
    x.fillStyle = 'rgba(255,240,170,0.22)';
    [-1, 1].forEach((sd) => { x.beginPath(); x.ellipse(hl + 1.2, sd * (hw - 5.2), 5.2, 3.4, 0, 0, Math.PI * 2); x.fill(); });
    x.fillStyle = '#fff6cf';
    [-1, 1].forEach((sd) => { rr(hl - 5.2, sd < 0 ? -hw + 2.2 : hw - 8, 4.6, 5.8, 1.6); x.fill(); });
    x.fillStyle = '#c0261c';
    [-1, 1].forEach((sd) => { rr(-hl + 0.4, sd < 0 ? -hw + 2.2 : hw - 8.2, 3.2, 6, 1); x.fill(); });
    x.fillStyle = '#ff7a66';
    [-1, 1].forEach((sd) => { x.fillRect(-hl + 0.9, sd < 0 ? -hw + 3.6 : hw - 6.8, 1.4, 3.2); });
    x.fillStyle = '#f1efe6'; x.fillRect(-hl + 0.2, -2.3, 1.5, 4.6);

    const o = { canvas: c, pad, S2 };
    carCache.set(k, o);
    return o;
  };
})();
