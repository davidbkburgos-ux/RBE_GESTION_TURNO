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
    async top(limit) {
      const url = ENDPOINT + '?select=player_name,score,created_at&order=score.desc,created_at.asc&limit=' + (limit || 10);
      const rows = await (await request(url, { method: 'GET' })).json();
      return (Array.isArray(rows) ? rows : []).map((r) => ({ name: r.player_name, score: r.score, date: r.created_at }));
    },
    // created_at lo genera la base de datos.
    async insert(name, score) {
      await request(ENDPOINT, { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ player_name: name, score }) });
    }
  };
  BK.LeaderboardService = LeaderboardService;
})();
