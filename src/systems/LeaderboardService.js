(function () {
  const BK = window.BK;
  // Solo clave pública (publishable). RLS en Supabase: únicamente SELECT e INSERT para anon.
  const SUPABASE_URL = 'https://khjvlaldeeswuknzizwj.supabase.co';
  const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_sw3tVGS9cu4C-dMc0Fn6uw_2Wr2cO_G';
  const ENDPOINT = SUPABASE_URL + '/rest/v1/leaderboard';
  const TIMEOUT_MS = 8000;

  async function request(url, options) {
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), TIMEOUT_MS) : null;
    try {
      const res = await fetch(url, {
        method: options.method,
        body: options.body,
        headers: Object.assign({ apikey: SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' }, options.headers),
        signal: ctrl ? ctrl.signal : undefined
      });
      if (!res.ok) throw new Error('Supabase ' + res.status + ' ' + (await res.text().catch(() => '')));
      return res;
    } finally { if (timer) clearTimeout(timer); }
  }

  const LeaderboardService = {
    cleanName(name) { return String(name || '').replace(/\s+/g, ' ').trim().slice(0, 14) || 'Encargado'; },
    // TOP 10 global ordenado por score descendente (a igualdad, el más antiguo primero).
    // Columna opcional `avatar` ("marca:género", p. ej. "popeyes:f"). Si la tabla aún no la tiene, se
    // consulta e inserta sin ella (y se recuerda para no repetir el intento fallido en cada petición).
    hasAvatar: true,
    async top(limit) {
      const q = (cols) => ENDPOINT + '?select=' + cols + '&order=score.desc,created_at.asc&limit=' + (limit || 10);
      let rows;
      if (this.hasAvatar) {
        try { rows = await (await request(q('player_name,score,created_at,avatar'), { method: 'GET' })).json(); }
        catch (e) { this.hasAvatar = false; console.warn('[Leaderboard] Sin columna avatar; añádela para guardar el avatar del récord.'); }
      }
      if (!rows) rows = await (await request(q('player_name,score,created_at'), { method: 'GET' })).json();
      return (Array.isArray(rows) ? rows : []).map((r) => ({ name: r.player_name, score: r.score, date: r.created_at, avatar: r.avatar || null }));
    },
    // created_at lo genera la base de datos.
    async insert(name, score, avatar) {
      const post = (body) => request(ENDPOINT, { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(body) });
      if (avatar && this.hasAvatar) {
        try { await post({ player_name: name, score, avatar }); return; }
        catch (e) { this.hasAvatar = false; console.warn('[Leaderboard] Guardado sin avatar:', e.message); }
      }
      await post({ player_name: name, score });
    }
  };
  BK.LeaderboardService = LeaderboardService;
})();
