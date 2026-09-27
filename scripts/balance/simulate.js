import * as THREE from 'three';
import { Combatant, interruptBotOnDamage } from '../../public/js/combat.js';
import { MageModel } from '../../public/js/characters.js';
import { BotBrain } from '../../public/js/bot.js';
import { SpellSystem } from '../../public/js/spells.js';
import '../../public/js/spells-extra.js';
import { World } from '../../public/js/world.js';
import { stepBody } from '../../public/js/movement.js';
import { TIME } from '../../public/js/shaders.js';
import { mulberry32 } from '../../public/js/util.js';
import { configureBrain, validateProfile } from './profiles.js';
import { effectiveManaCost } from '../../public/js/mana.js';
import { SimClock, installEnvironment, makeFX, makeAudio } from './environment.js';

export const DEFAULTS = { seed: 12345, seconds: 120, hz: 60, arena: 'terrain', power: 0.5, tier: 0.5, chantSeconds: 2, distance: 32 };
export function validateOptions(options) {
  for (const key of ['seconds', 'hz', 'distance']) if (!Number.isFinite(options[key]) || options[key] <= 0) throw new Error(`${key} must be positive`);
  if (options.hz < 20 || options.hz > 240) throw new Error('hz must be between 20 and 240');
  if (!Number.isSafeInteger(options.seed) || options.seed < 0 || options.seed > 0xffffffff) throw new Error('seed must be a uint32');
  for (const key of ['power', 'tier']) if (!Number.isFinite(options[key]) || options[key] < 0 || options[key] > 1) throw new Error(`${key} must be in [0, 1]`);
  if (!Number.isFinite(options.chantSeconds) || options.chantSeconds < 0) throw new Error('chantSeconds must be nonnegative');
  if (!['terrain', 'flat', 'cover'].includes(options.arena)) throw new Error('arena must be terrain, flat or cover');
  if (options.distance > 180) throw new Error('distance must be at most 180');
}

export function simulateMatch(left, right, input = {}) {
  const options = { ...DEFAULTS, ...input };
  validateOptions(options); validateProfile(left); validateProfile(right);
  const clock = new SimClock();
  const restore = installEnvironment(clock, mulberry32(options.seed));
  const oldTime = TIME.value;
  const events = [], casts = {}, damageByElement = {}, damageByShape = {}, reactions = {};
  let game;
  const inc = (obj, key, n = 1) => { obj[key] = (obj[key] || 0) + n; };
  const stats = [left, right].map(profile => ({ profile, casts: 0, basicCasts: 0, manaSpent: 0, hpDamage: 0,
    shieldAbsorbed: 0, healing: 0, structureDamage: 0, structuresDestroyed: 0, ccSeconds: 0, lowManaSeconds: 0, chantSeconds: 0, interruptedChants: 0, unaffordableCasts: 0 }));
  const sideOf = c => c ? (c.owner || c).side : undefined;
  const event = e => { if (options.trace) events.push({ t: +((clock.now / 1000).toFixed(4)), ...e }); };
  try {
    // Reuse terrain/raycast/body/construct collision methods without building scenery.
    const world = Object.assign(Object.create(World.prototype), { boxes: [], obstacles: [], gusts: [] });
    if (options.arena !== 'terrain') world.heightAt = () => 0;
    if (options.arena === 'cover') world.obstacles = [-6, 6].map(x => ({ x, z: 0, r: 2, y0: 0, h: 5 }));
    game = { mode: 'duel', settings: { botJev: false, lang: 'en' }, jevOnline: false,
      scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), world,
      combatants: [], bots: [], audio: makeAudio(), fx: makeFX(THREE), stepBody,
      onBotChant: () => false,
      onStructureDamage(target, dmg, hit) {
        const side = sideOf(hit.src);
        if (side !== undefined) { stats[side].structureDamage += dmg; if (!target.alive) stats[side].structuresDestroyed++; }
        event({ type: 'structure-hit', source: side, kind: target.kind, damage: dmg, destroyed: !target.alive });
      },
      onDamage(target, res, pos, el, hit) {
        target.lastHit = clock.now;
        const side = sideOf(hit.src);
        // Exclude decoy targets, self-damage and shield damage from effective HP damage.
        const raw = res.dmg - res.absorbed;
        const hpLost = Math.max(0, Math.min(raw, target.hp + raw));
        if (side !== undefined && side !== sideOf(target) && !target.decoy) {
          stats[side].hpDamage += hpLost;
          stats[side].shieldAbsorbed += res.absorbed;
          inc(damageByElement, el || 'untyped', hpLost);
          inc(damageByShape, hit.shape || (hit.dot ? 'damage-over-time' : 'secondary'), hpLost);
        }
        if (res.reaction) inc(reactions, res.reaction.name);
        event({ type: 'hit', source: side, target: sideOf(target), decoy: !!target.decoy,
          element: el, shape: hit.shape, hpDamage: hpLost, absorbed: res.absorbed, reaction: res.reaction?.name });
        interruptBotOnDamage(target, res);
      },
      onDeath(target, source) { target.alive = false; target.hp = 0; event({ type: 'death', target: sideOf(target), source: sideOf(source), decoy: !!target.decoy }); },
      makeCombatant(config) {
        const c = new Combatant(config);
        c.model = new MageModel();
        this.scene.add(c.model.root);
        c.castOrigin = () => c.model.handWorld(c._ho || (c._ho = new THREE.Vector3()));
        const heal = c.heal.bind(c);
        c.heal = n => { const before = c.hp; heal(n); const side = sideOf(c); if (side !== undefined && !c.decoy) stats[side].healing += c.hp - before; };
        this.combatants.push(c); return c;
      },
      removeCombatant(c) {
        const i = this.combatants.indexOf(c); if (i >= 0) this.combatants.splice(i, 1);
        this.scene.remove(c.model.root); c.model.root.traverse(m => m.geometry?.dispose());
      },
    };
    game.spells = new SpellSystem(game);
    const cast = game.spells.cast.bind(game.spells);
    game.spells.cast = (spec, caster) => {
      const side = sideOf(caster);
      if (side !== undefined && !caster.decoy) {
        stats[side].casts++; if (spec.basic) stats[side].basicCasts++;
        inc(casts, `${spec.basic ? 'bolt' : spec.shape}:${spec.element}`);
        event({ type: 'cast', side, shape: spec.shape, element: spec.element, basic: !!spec.basic, mana: caster.mana, cost: effectiveManaCost(caster, spec) });
      }
      return cast(spec, caster);
    };
    const angle = options.angle ?? mulberry32(options.seed ^ 0x9e3779b9)() * Math.PI * 2;
    for (const [side, profile] of [left, right].entries()) {
      const c = game.makeCombatant({ id: `bot-${side}`, name: profile }); c.side = side;
      const a = angle + side * Math.PI;
      c.pos.set(Math.cos(a) * options.distance / 2, 0, Math.sin(a) * options.distance / 2);
      c.pos.y = world.heightAt(c.pos.x, c.pos.z); c.grounded = true;
      c.model.root.position.copy(c.pos);
      c.brain = new BotBrain(game, c, profile.startsWith('native:') ? profile.split(':')[1] : 'normal');
      configureBrain(c.brain, profile, { ...options, seed: (options.seed + side * 7919) >>> 0 });
      const cancel = c.brain.cancelChant.bind(c.brain);
      c.brain.cancelChant = () => { if (c.brain.chant && c.alive) stats[side].interruptedChants++; cancel(); };
      const updateChant = c.brain.updateChant.bind(c.brain);
      c.brain.updateChant = (...args) => {
        const ch = c.brain.chant, count = stats[side].casts;
        updateChant(...args);
        if (ch && !c.brain.chant && c.canAct() && stats[side].casts === count) stats[side].unaffordableCasts++;
      };
      game.bots.push(c);
    }
    for (const c of game.bots) c.brain.aimPoint.copy(game.bots[1 - c.side].center());
    const dt = 1 / options.hz, steps = Math.ceil(options.seconds * options.hz);
    for (let frame = 0; frame < steps && game.bots.every(c => c.alive); frame++) {
      const step = Math.min(dt, options.seconds - clock.now / 1000);
      clock.advance(step * 1000); TIME.value = clock.now / 1000;
      for (const c of game.bots) {
        const s = stats[c.side];
        if (!c.canAct() && c.alive) s.ccSeconds += step;
        if (c.mana < 8) s.lowManaSeconds += step;
        if (c.chanting) s.chantSeconds += step;
        const out = c.brain.update(step);
        if (out.dash && c.stamina > 30) { c.stamina -= 30; c.vel.addScaledVector(out.dash, 15); }
        if (c.alive) game.stepBody(c, step, out.wish, out.speed || 6, out.jump, false);
        c.updateStatus(step, game);
      }
      // Animation transforms determine the actual staff/chant-orb cast origin.
      for (const c of game.combatants) {
        c.model.root.position.copy(c.pos); c.model.root.rotation.y = c.yaw;
        if (c.hitFlash > 0) c.hitFlash = Math.max(0, c.hitFlash - step * 5);
        c.model.update(step, { hit: c.hitFlash || 0, speed: Math.hypot(c.vel.x, c.vel.z),
          chanting: c.chanting, pitch: c.pitch, frozen: c.frozen > 0, shield: c.shield, shieldEl: c.shieldEl, aura: c.aura?.el });
      }
      game.spells.update(step); game.fx.update(step);
      for (const c of game.combatants) for (const n of [c.hp, c.mana, c.shield, c.pos.x, c.pos.y, c.pos.z]) if (!Number.isFinite(n)) throw new Error('Non-finite combat state');
    }
    const alive = game.bots.map(c => c.alive);
    const winner = alive[0] === alive[1] ? null : alive[0] ? 0 : 1;
    return { options, profiles: [left, right], winner, outcome: winner !== null ? 'kill' : alive[0] ? 'timeout' : 'double-ko',
      duration: clock.now / 1000, stats: stats.map((s, i) => ({ ...s, manaSpent: game.bots[i].manaSpent || 0, hp: game.bots[i].hp, mana: game.bots[i].mana })),
      casts, damageByElement, damageByShape, reactions, ...(options.trace ? { events } : {}) };
  } finally {
    try { game?.spells?.clear(); game?.fx?.clear(); game?.scene.clear(); }
    finally { clock.timers.clear(); TIME.value = oldTime; restore(); }
  }
}
