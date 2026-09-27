import { ApiRateLimit } from './api-rate-limit.js';
import { ELEMENTS, SHAPES, TRAITS, SCORES } from './spell-ontology.js';
import { SpellCache, spellCacheVersion } from './spell-cache.js';
import { createP2PSignaling } from './p2p-signaling.js';

export function createApiHandler({ hosted = false, localModel = { status: () => ({ phase: 'disabled' }) }, config: localConfig = {}, apiKey, spellCache } = {}) {
  const config = {
    url: process.env.JEV_URL || localConfig.url || 'https://api.typesafe.ai/v1/systemone',
    model: process.env.JEV_MODEL || localConfig.model || 'jev-latest',
    timeoutMs: localConfig.timeoutMs || 6000,
  };
  const API_KEY = process.env.JEV_API_KEY?.trim() || process.env.TYPESAFE_API_KEY?.trim() || apiKey;
  // Selection belongs to the server, never to the request body. Preserve defaults
  // for existing installs; an explicit choice never falls back to another biller.
  const endpoint = process.env.JEV_ENDPOINT ?? localConfig.endpoint ?? (hosted ? 'gateway' : API_KEY ? 'direct' : 'gateway');
  const direct = endpoint === 'direct';
  const validEndpoint = ['direct', 'gateway'].includes(endpoint);
  const model = direct ? config.model : 'typesafe-ai/jev';
  // At runtime Vercel delivers OIDC through the request context, not the environment.
  const gatewayAvailable = (hosted && !!process.env.VERCEL) || !!process.env.AI_GATEWAY_API_KEY || !!process.env.VERCEL_OIDC_TOKEN;
  const jevState = { keyLoaded: validEndpoint && (direct ? !!API_KEY : gatewayAvailable), lastOk: null, lastLatency: null, calls: 0 };
  function failure(errorCode, retryable = false) {
    const messages = {
      invalid_endpoint: 'The server endpoint setting must be direct or gateway.',
      missing_credentials: 'The selected provider has no server credentials configured.',
      authentication_failed: 'The selected provider rejected the server credentials. The site owner must check them.',
      access_denied: 'The selected provider denied access. The site owner must check provider permissions.',
      billing_error: 'The selected provider requires payment or additional credits.',
      upstream_rate_limit: 'The selected provider rate limit was reached. Please wait before trying again.',
      upstream_unavailable: 'The selected provider is temporarily unavailable. Please try again shortly.',
      upstream_rejected: 'The selected provider rejected the spell request. The site owner must check the API configuration.',
      invalid_response: 'The selected provider returned an invalid response. Please try again shortly.',
      timeout: 'The selected provider took too long to respond. Please try again.',
      provider_network_error: 'The server could not reach the selected provider. Please try again.',
      service_error: 'Spell interpretation failed. Please try again shortly.',
    };
    return { ok: false, endpoint: validEndpoint ? endpoint : null, error: messages[errorCode], errorCode, retryable };
  }

  // ---------------------------------------------------------------- spell ontology
  function buildQuestions() {
    const q = {
      element: { type: 'choice', instructions: 'Primary element of the spell being cast.', criteria: ELEMENTS },
      element2: {
        type: 'choice',
        instructions: 'Secondary element fused into the spell, if the incantation clearly mixes two elements. Otherwise none.',
        criteria: { none: 'Only one element is involved.', ...ELEMENTS },
      },
      shape: { type: 'choice', instructions: 'The form the spell takes.', criteria: SHAPES },
      is_spell: {
        type: 'noul',
        instructions: 'Is this text an attempt to cast a spell or attack (as opposed to random chatter)?',
        criteria: { true: 'It names or describes magic, an attack, an element, or a spell.', false: 'It is unrelated talk with no magic intent.' },
      },
      homing: {
        type: 'noul',
        instructions: 'Should the spell seek and track the enemy?',
        criteria: { true: 'Words like seeking, homing, chasing, hunting, guided, never miss.', false: 'Fired straight or placed.' },
      },
    };
    for (const [k, v] of Object.entries(SCORES)) q[k] = { type: 'score', instructions: v.instructions, criteria: v.levels };
    for (const [k, v] of Object.entries(TRAITS)) q[k] = { type: 'choice', instructions: v.instructions, criteria: v.criteria };
    return q;
  }
  const QUESTIONS = buildQuestions();

  // ---------------------------------------------------------------- answer normalisation
  const num = (x) => (typeof x === 'number' && isFinite(x) ? x : null);
  function scoreTo01(ans, levels) {
    if (!ans) return null;
    const n = levels.length;
    const probs = ans.probabilities;
    if (probs && typeof probs === 'object') {
      const entries = Object.entries(probs).filter(([, p]) => num(p) !== null);
      if (entries.length) {
        const keys = entries.map(([k]) => k);
        const allNumeric = keys.every((k) => /^-?\d+(\.\d+)?$/.test(k));
        const base = allNumeric ? Math.min(...keys.map(Number)) : 0;
        let s = 0, t = 0;
        for (const [k, p] of entries) {
          let idx = levels.indexOf(k);
          if (idx < 0 && ans.legend && ans.legend[k] !== undefined) idx = levels.indexOf(ans.legend[k]);
          if (idx < 0 && allNumeric) idx = Number(k) - (base === 1 ? 1 : 0);
          if (idx < 0 || idx >= n) continue;
          s += idx * p; t += p;
        }
        if (t > 0) return Math.max(0, Math.min(1, s / t / (n - 1)));
      }
    }
    const sc = ans.score;
    if (typeof sc === 'string') {
      const i = levels.indexOf(sc);
      if (i >= 0) return i / (n - 1);
    }
    if (num(sc) !== null) {
      if (sc > 0 && sc < 1 && !Number.isInteger(sc)) return sc;
      if (sc >= n) return 1;
      // a legend usually tells us whether levels are 0- or 1-based; otherwise guess 1-based when score==n
      let base = 0;
      if (ans.legend && typeof ans.legend === 'object') {
        const lk = Object.keys(ans.legend).map(Number).filter((x) => !isNaN(x));
        if (lk.length) base = Math.min(...lk);
      }
      return Math.max(0, Math.min(1, (sc - base) / (n - 1)));
    }
    return null;
  }
  function noulTo01(ans) {
    if (!ans) return null;
    if (num(ans.noul) !== null) return ans.noul;
    if (typeof ans.noul === 'boolean') return ans.noul ? 1 : 0;
    if (ans.probabilities && num(ans.probabilities.true) !== null) return ans.probabilities.true;
    return null;
  }
  function choiceOf(ans, allowed) {
    if (!ans) return { value: null, conf: 0 };
    let value = ans.choice ?? ans.value ?? null;
    let conf = num(ans.confidence) ?? 0.5;
    if ((!value || !allowed.includes(value)) && ans.probabilities) {
      const best = Object.entries(ans.probabilities).sort((a, b) => b[1] - a[1])[0];
      if (best) { value = best[0]; conf = best[1]; }
    }
    if (!allowed.includes(value)) value = null;
    return { value, conf };
  }

  function normalise(answers) {
    const el = choiceOf(answers.element, Object.keys(ELEMENTS));
    const el2 = choiceOf(answers.element2, ['none', ...Object.keys(ELEMENTS)]);
    const sh = choiceOf(answers.shape, Object.keys(SHAPES));
    const p = {
      element: el.value, elementConf: el.conf,
      element2: el2.value && el2.value !== 'none' && el2.value !== el.value && el2.conf > 0.3 ? el2.value : null,
      shape: sh.value, shapeConf: sh.conf,
      isSpell: noulTo01(answers.is_spell),
      homing: noulTo01(answers.homing),
    };
    for (const [k, v] of Object.entries(SCORES)) p[k] = scoreTo01(answers[k], v.levels);
    for (const [k, v] of Object.entries(TRAITS)) { const c = choiceOf(answers[k], Object.keys(v.criteria)); p[k] = c.value; p[k + 'Conf'] = c.conf; }
    return p;
  }

  // ---------------------------------------------------------------- Jev call
  const cache = spellCache || new SpellCache({ version: spellCacheVersion({ endpoint, model, questions: QUESTIONS, url: config.url }) });
  const p2p = createP2PSignaling(cache, { hosted });
  const limits = new ApiRateLimit(cache, hosted);
  async function askJev(text, language = 'en-US') {
    return cache.resolve(text, language, () => interpretJev(text, language));
  }
  async function interpretJev(text, language) {
    const state = [
      `Incantation spoken by a mage during a magic duel (voice recognition language: ${language}): "${text}"`,
      `Determine spell strength and characteristics solely from the meaning of the incantation.`,
    ].join('\n');
    let token = direct ? API_KEY : (hosted && process.env.VERCEL ? null : process.env.AI_GATEWAY_API_KEY?.trim() || process.env.VERCEL_OIDC_TOKEN?.trim());
    if (!direct && !token && process.env.VERCEL) {
      try {
        const { getVercelOidcToken } = await import('@vercel/oidc');
        token = await getVercelOidcToken();
      } catch { throw Object.assign(new Error('Gateway authentication failed'), { errorCode: 'authentication_failed' }); }
    }
    if (!token) throw Object.assign(new Error('Missing credentials'), { errorCode: 'missing_credentials' });
    const t0 = performance.now();
    const res = await fetch(direct ? config.url : 'https://ai-gateway.vercel.sh/typesafe/v1/systemone', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, state, questions: QUESTIONS }),
      signal: AbortSignal.timeout(config.timeoutMs),
    });
    const latency = Math.round(performance.now() - t0);
    const bodyText = await res.text();
    // Provider error bodies may contain credentials or request text. Never log
    // or return them; classify only by status and locally generated error codes.
    if (!res.ok) throw Object.assign(new Error('Provider request failed'), { upstreamStatus: res.status });
    let json;
    try { json = JSON.parse(bodyText); } catch { throw Object.assign(new Error('Invalid response'), { errorCode: 'invalid_response' }); }
    const answers = json?.answers || json?.decisions || json?.output;
    if (!answers || typeof answers !== 'object' || Array.isArray(answers)) throw Object.assign(new Error('Invalid response'), { errorCode: 'invalid_response' });
    const params = normalise(answers);
    const out = { params, endpoint, model: json.model || model, latency, raw: json };
    if (process.env.JEV_DEBUG) console.log(JSON.stringify(answers, null, 1));
    return out;
  }

  function readBody(req, limit = 32 * 1024) {
    return new Promise((resolve, reject) => {
      let size = 0; const chunks = [];
      req.on('data', (c) => { size += c.length; if (size > limit) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      req.on('error', reject);
    });
  }
  function sendJson(res, code, obj) {
    res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(obj));
  }


    return async function handleApi(req, res) {
      const url = new URL(req.url, 'http://localhost');
      if (req.method === 'POST' && req.headers.origin) {
        try { if (new URL(req.headers.origin).host !== req.headers.host) return sendJson(res, 403, { ok: false, error: 'origin not allowed' }); }
        catch { return sendJson(res, 403, { ok: false, error: 'origin not allowed' }); }
      }
    if (url.pathname === '/api/status') {
      const publicJevState = { keyLoaded: jevState.keyLoaded, lastOk: jevState.lastOk, lastLatency: jevState.lastLatency };
      const problem = !validEndpoint ? failure('invalid_endpoint') : !jevState.keyLoaded ? failure('missing_credentials') : null;
      return sendJson(res, 200, { jev: { ...publicJevState, endpoint: validEndpoint ? endpoint : null, model, ...(problem && { errorCode: problem.errorCode, error: problem.error }) }, cache: cache.status(), local: localModel.status(), capabilities: { localModel: !hosted } });
    }
    if (url.pathname === '/api/p2p') {
      if (req.method === 'GET') return sendJson(res, 200, { ok: true, ...p2p.status() });
      if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'POST required.' });
      try {
        const body = req.body && typeof req.body === 'object' ? req.body : JSON.parse(typeof req.body === 'string' ? req.body : await readBody(req));
        if (!body || Array.isArray(body) || JSON.stringify(body).length > 32768) return sendJson(res, 400, { ok: false, error: 'Invalid room request.' });
        await limits.check(req, '/api/p2p', body.action);
        return sendJson(res, 200, { ok: true, ...await p2p.act(body) });
      } catch (error) { return sendJson(res, error.status || 503, { ok: false, error: error.status ? error.message : 'Room service unavailable. Please retry.' }); }
    }
    if (url.pathname === '/api/spell-cache' && req.method === 'GET') {
      try { await limits.check(req, '/api/spell-cache'); } catch (e) { return sendJson(res, e.status, { ok:false, error:e.message }); }
      let language;
      try {
        const requested = url.searchParams.get('language') || 'en-US';
        if (requested.length > 35) throw new Error('invalid language');
        language = Intl.getCanonicalLocales(requested)[0];
        if (!/^[a-z]{2,3}(?:-|$)/i.test(language)) throw new Error('invalid language');
      } catch { return sendJson(res, 400, { ok: false, error: 'invalid recognition language' }); }
      return sendJson(res, 200, { ok: true, ...await cache.top(language) });
    }
    if (url.pathname === '/api/local/load' && req.method === 'POST') {
      if (hosted) return sendJson(res, 503, { ok: false, error: 'Local MiniLM requires the local server.' });
      try { await localModel.load(); return sendJson(res, 200, { ok: true, ...localModel.status() }); }
      catch (e) { return sendJson(res, 503, { ok: false, error: e.message }); }
    }
    if (url.pathname === '/api/spell' && req.method === 'POST') {
      let body;
      try { body = req.body && typeof req.body === 'object' ? req.body : JSON.parse(typeof req.body === 'string' ? req.body : await readBody(req));
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('bad json'); } catch { return sendJson(res, 400, { ok: false, error: 'bad json' }); }
      if (JSON.stringify(body).length > 32768) return sendJson(res, 413, { ok: false, error: 'request too large' });
      if (typeof body.text !== 'string' || body.text.length > 600) return sendJson(res, 400, { ok: false, error: 'expected text of at most 600 characters' });
      for (const key of ['chantSeconds', 'loudness']) {
        if (body[key] !== undefined && (typeof body[key] !== 'number' || !Number.isFinite(body[key]))) return sendJson(res, 400, { ok: false, error: 'invalid cast metadata' });
      }
      const text = body.text.trim();
      if (!text) return sendJson(res, 400, { ok: false, error: 'empty incantation' });
      let language;
      try {
        if (typeof body.language !== 'string' && body.language !== undefined) throw new Error('invalid language');
        const requested = (body.language || 'en-US').trim();
        if (!requested || requested.length > 35) throw new Error('invalid language');
        language = Intl.getCanonicalLocales(requested)[0];
        if (!/^[a-z]{2,3}(?:-|$)/i.test(language)) throw new Error('invalid language');
      } catch { return sendJson(res, 400, { ok: false, error: 'invalid recognition language' }); }
      const provider = body.provider || 'jev';
      if (!['jev', 'local'].includes(provider)) return sendJson(res, 400, { ok: false, error: 'unknown spell provider' });
      if (provider === 'local') {
        if (hosted) return sendJson(res, 503, { ok: false, error: 'Local MiniLM requires the local server.' });
        try { return sendJson(res, 200, { ok: true, ...await localModel.interpret(text) }); }
        catch (e) { return sendJson(res, 503, { ok: false, error: e.message }); }
      }
      if (!validEndpoint) return sendJson(res, 200, failure('invalid_endpoint'));
      if (!jevState.keyLoaded) return sendJson(res, 200, failure('missing_credentials'));
      try { await limits.check(req, '/api/spell'); } catch (e) { return sendJson(res, e.status, { ok:false, error:e.message }); }
      jevState.calls++;
      try {
        const r = await askJev(text, language);
        jevState.lastOk = Date.now(); jevState.lastLatency = r.latency;
        const p = r.params;
        console.log(`[jev ${r.cached ? 'cache' : r.latency + 'ms'}] ${p.element}/${p.element2 || '-'} ${p.shape} pow=${p.power?.toFixed(2)} tier=${p.tier?.toFixed(2)}`);
        return sendJson(res, 200, { ok: true, ...r });
      } catch (e) {
        const errorCode = e.errorCode || (e.upstreamStatus === 401 ? 'authentication_failed'
          : e.upstreamStatus === 403 ? 'access_denied'
          : e.upstreamStatus === 402 ? 'billing_error'
          : e.upstreamStatus === 429 ? 'upstream_rate_limit'
          : e.upstreamStatus >= 500 ? 'upstream_unavailable'
          : e.upstreamStatus === 408 || e.name === 'TimeoutError' || e.name === 'AbortError' ? 'timeout'
          : e.upstreamStatus ? 'upstream_rejected'
          : e instanceof TypeError ? 'provider_network_error' : 'service_error');
        const retryable = ['upstream_rate_limit', 'upstream_unavailable', 'timeout', 'provider_network_error', 'invalid_response'].includes(errorCode);
        console.warn('[jev error]', endpoint, errorCode);
        return sendJson(res, 200, failure(errorCode, retryable));
      }
    }
      return sendJson(res, 404, { ok: false, error: 'API route not found' });
    };
}
