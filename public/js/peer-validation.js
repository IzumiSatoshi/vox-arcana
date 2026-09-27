import { ELEMENT_KEYS, SHAPE_KEYS } from './elements.js';
import { buildJevSpec, boltSpec } from './spellbook.js';
import { TRAIT_VALUES, readWinsToWin } from './generated/p2p-protocol.js';

const bad = () => { throw new Error('Invalid peer message'); };
const object = v => { if (!v || typeof v !== 'object' || Array.isArray(v)) bad(); return v; };
const str = (v, max = 600) => { if (typeof v !== 'string' || v.length > max) bad(); return v; };
const num = (v, max = 1000000, min = -max) => { if (!Number.isFinite(v) || v < min || v > max) bad(); return v; };
const list = (v, max) => { if (!Array.isArray(v) || v.length > max) bad(); return v; };
const choice = (v, values) => { if (!values.includes(v)) bad(); return v; };
const element = v => choice(v, ELEMENT_KEYS);
const vector = v => { if (list(v, 3).length !== 3) bad(); v.forEach(x => num(x, 10000)); };
const id = v => str(v, 64);

// Validate before dispatch, including nested diagnostic data. Reject prototype
// keys, deeply nested JSON, and non-finite numbers even in ignored fields.
export function checkPeerTree(value) {
  let nodes = 0;
  const visit = (v, depth) => {
    if (++nodes > 6000 || depth > 12) bad();
    if (typeof v === 'number') num(v, 1e12);
    else if (typeof v === 'string') str(v, 12000);
    else if (v && typeof v === 'object') {
      if (Array.isArray(v)) list(v, 256);
      for (const [key, child] of Object.entries(v)) {
        if (['__proto__', 'prototype', 'constructor'].includes(key)) bad();
        visit(child, depth + 1);
      }
    } else if (v != null && typeof v !== 'boolean') bad();
  };
  visit(value, 0); object(value); str(value.type, 32); return value;
}

function params(value) {
  object(value); const out = {};
  for (const key of ['element', 'element2']) if (value[key] != null) out[key] = element(value[key]);
  if (value.shape != null) out.shape = choice(value.shape, SHAPE_KEYS);
  for (const key of ['power','tier','isSpell','speed','size','temperature','weight','sharpness','count','duration','chaos','homing','height','width','density','luminosity']) {
    if (value[key] != null) out[key] = num(value[key], 1, 0);
  }
  for (const [key, values] of Object.entries(TRAIT_VALUES)) if (value[key] != null) out[key] = choice(value[key], values);
  return out;
}
function result(value) {
  object(value); if (typeof value.ok !== 'boolean') bad();
  if (!value.ok) return { ok:false, error: str(value.error || 'Spell interpretation failed.', 600), retryable: value.retryable === true };
  const out = { ok:true, params:params(value.params), cached:value.cached === true, provider:'jev' };
  for (const key of ['latency','rtt']) if (value[key] != null) out[key] = num(value[key], 60000, 0);
  for (const key of ['cacheVersion','model','endpoint']) if (value[key] != null) out[key] = str(value[key], 200);
  if (value.raw != null) out.raw = object(value.raw);
  return out;
}
export function safePeerSpec(value) {
  object(value); const text = str(value.text);
  if (value.basic === true) return boltSpec(element(value.element));
  // Ignore host-supplied names, cost, magnitude, seed, damage and effect counts.
  // Derive them locally from bounded Jev parameters before HTML or WebGL sees them.
  return buildJevSpec(text, result({ ...value, ok:true, params:params(value) }));
}
function player(p) {
  object(p); id(p.id); str(p.name, 24); vector(p.pos); vector(p.vel);
  num(p.yaw); num(p.pitch, 1.6);
  for (const key of ['hp','maxHp','mana','maxMana','stamina','shield','shieldTime','frozen','stun','defDown','mud','weaken','curse','haste','flying','cloak']) if (p[key] != null) num(p[key], 10000);
  for (const key of ['alive','grounded','chanting','channeling']) if (p[key] != null && typeof p[key] !== 'boolean') bad();
  if (p.chantText != null) str(p.chantText);
  if (p.shieldEl != null) element(p.shieldEl);
  if (p.aura != null) { object(p.aura); element(p.aura.el); num(p.aura.t, 10000); }
  if (p.enh != null) for (const [el, entry] of Object.entries(object(p.enh))) { element(el); object(entry); num(entry.t, 10000); num(entry.p, 1, 0); if (entry.dur != null) num(entry.dur, 10000); }
  for (const d of list(p.dots || [], 32)) { object(d); element(d.el); for (const k of ['t','dps','acc']) num(d[k], 10000); }
}
const phases = ['waiting','connecting','starting','countdown','playing','between','finished'];
export function validateHostMessage(m) {
  checkPeerTree(m);
  switch (m.type) {
    case 'room': {
      const room = object(m.room); room.winsToWin = readWinsToWin(room.winsToWin); str(room.code,12); if (!/^[A-F0-9]{12}$/.test(room.code)) bad();
      choice(room.phase, phases); str(room.region,100); choice(room.interpreter,['jev']);
      if (typeof room.public !== 'boolean' || (room.relayOnly != null && typeof room.relayOnly !== 'boolean')) bad();
      for (const p of list(room.players,2)) { object(p); id(p.id); str(p.name,24); if (typeof p.ready !== 'boolean') bad(); }
      break;
    }
    case 'round': case 'state': {
      id(m.matchId); num(m.round,10000,0);
      if (list(m.players,2).length !== 2) bad(); m.players.forEach(player);
      if (new Set(m.players.map(p=>p.id)).size !== 2) bad();
      if (list(m.score,2).length !== 2) bad(); m.score.forEach(n=>num(n,10000,0));
      if (m.type === 'state') {
        num(m.time,100000,0); choice(m.phase,phases); num(m.countdown,10000,0);
        for (const box of list(m.boxes || [],128)) { object(box); for (const k of ['x','y','z','hx','hy','hz','yaw','cos','sin']) num(box[k],10000); }
      }
      break;
    }
    case 'cast': id(m.caster); player(m.player); m.spec = safePeerSpec(m.spec); break;
    case 'hit': id(m.target); if (m.source != null) id(m.source); num(m.damage,10000); vector(m.pos); if (m.element != null) element(m.element); if (m.reaction != null) { object(m.reaction); str(m.reaction.name,64); if (!/^#[a-f0-9]{3,8}$/i.test(m.reaction.color)) bad(); } break;
    case 'spellResult': num(m.requestId,Number.MAX_SAFE_INTEGER,0); m.result = result(m.result); break;
    case 'interpretation': str(m.text); m.result = result(m.result); break;
    case 'castError': case 'matchError': str(m.error,600); break;
    case 'jevCalls': num(m.calls,1e9,0); break;
    case 'result': if (m.winner !== null) choice(m.winner,[0,1]); if (list(m.score,2).length !== 2) bad(); m.score.forEach(n=>num(n,10000,0)); if (typeof m.finished !== 'boolean') bad(); break;
    default: bad();
  }
  return m;
}
