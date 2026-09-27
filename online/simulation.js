import * as THREE from 'three';
import { World } from '../public/js/world.js';
import { Combatant } from '../public/js/combat.js';
import { SpellSystem } from '../public/js/spells.js';
import '../public/js/spells-extra.js';
import { stepBody } from '../public/js/movement.js';
import { spendSpellMana } from '../public/js/mana.js';
import { boltSpec } from '../public/js/spellbook.js';
import { TIME } from '../public/js/shaders.js';
import { makeAudio, makeFX } from '../scripts/balance/environment.js';
import { snapshot, readWinsToWin } from './protocol.js';
import { duelAim } from '../public/js/duel-aim.js';

export class DuelSimulation {
  constructor(players, collision, emit, winsToWin = 2) {
    this.winsToWin = readWinsToWin(winsToWin);
    this.emit = emit; this.elapsed = 0; this.round = 0; this.score = [0, 0]; this.phase = 'countdown'; this.until = 3;
    const world = Object.assign(Object.create(World.prototype), collision, { boxes: [], gusts: [] });
    world.index();
    const g = this.game = { mode: 'online', world, scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(),
      combatants: [], bots: [], audio: makeAudio(), fx: makeFX(THREE), stepBody,
      makeCombatant(config) {
        const c = new Combatant(config);
        c.castOrigin = () => c.eye(new THREE.Vector3()).addScaledVector(c.forward(new THREE.Vector3()), 0.65);
        c.getAim = () => duelAim(c, world, this.combatants);
        this.combatants.push(c); return c;
      },
      removeCombatant(c) { this.combatants = this.combatants.filter(other => other !== c); },
      onDamage: (target, result, pos, element, hit) => emit({ type: 'hit', target: target.id, source: hit.src?.id,
        damage: result.dmg, element, pos: pos.toArray(), reaction: result.reaction }),
      onDeath: c => { c.alive = false; c.hp = 0; },
    };
    g.spells = new SpellSystem(g);
    this.players = players.map(p => g.makeCombatant(p));
    this.inputs = players.map(() => ({ seq: 0, x: 0, z: 0 }));
    this.lastInput = [0, 0]; this.boltAt = [0, 0]; this.castAt = [0, 0]; this.lastEl = ['arcane', 'arcane'];
    this.reset();
  }
  reset() {
    const g = this.game;
    g.spells.clear(); g.fx.clear(); g.scene.clear(); g.world.boxes.length = 0;
    g.combatants = [...this.players];
    this.players.forEach((c, side) => {
      c.resetStats(); c.chanting = false; c.channeling = false; c.vel.set(0, 0, 0);
      c.pos.set(0, 0, side ? -26 : 26); c.pos.y = g.world.heightAt(c.pos.x, c.pos.z);
      c.yaw = side ? Math.PI : 0; c.pitch = 0; c.grounded = true;
      this.inputs[side] = { seq: this.inputs[side].seq, x: 0, z: 0, yaw: c.yaw, pitch: 0 };
    });
    this.round++; this.phase = 'countdown'; this.until = this.elapsed + 3;
    this.emit({ type: 'round', round: this.round, score: this.score, players: this.players.map(snapshot) });
  }
  input(side, input) {
    if (input.seq <= this.inputs[side].seq) return;
    this.inputs[side] = input; this.lastInput[side] = this.elapsed;
  }
  dash(side) {
    const c = this.players[side], input = this.inputs[side];
    if (this.phase !== 'playing' || !c.canAct() || c.stamina < 30) return;
    const dir = new THREE.Vector3(input.x, 0, input.z);
    if (!dir.lengthSq()) dir.copy(c.forward(new THREE.Vector3())).setY(0);
    c.stamina -= 30; c.vel.addScaledVector(dir.normalize(), 17); c.vel.y = Math.max(c.vel.y, 2);
  }
  cast(side, spec, basic = false) {
    const c = this.players[side];
    if (this.phase !== 'playing' || !c.canAct()) return false;
    if (basic) {
      if (this.elapsed < this.boltAt[side] || c.chanting) return false;
      spec = boltSpec(this.lastEl[side]);
    } else if (this.elapsed < this.castAt[side]) return false;
    if (!spendSpellMana(c, spec)) { this.emit({ type: 'castError', side, error: 'Not enough mana.' }); return false; }
    if (basic) this.boltAt[side] = this.elapsed + (c.enhP('lightning') !== null ? 0.36 : 0.56);
    else { this.castAt[side] = this.elapsed + 0.6; this.lastEl[side] = spec.element; }
    this.game.spells.cast(spec, c);
    this.emit({ type: 'cast', caster: c.id, spec, player: snapshot(c) });
    return true;
  }
  step(dt) {
    this.elapsed += dt; TIME.value = this.elapsed;
    if (this.phase === 'countdown' && this.elapsed >= this.until) this.phase = 'playing';
    if (this.phase === 'between' && this.elapsed >= this.until) this.reset();
    if (this.phase !== 'playing') return;
    for (const [side, c] of this.players.entries()) {
      const input = this.inputs[side], fresh = this.elapsed - this.lastInput[side] < 0.5;
      c.yaw = input.yaw; c.pitch = input.pitch; c.chanting = c.alive && fresh && !!input.chanting;
      c.chantText = c.chanting ? input.chantText || '' : '';
      const wish = new THREE.Vector3(fresh ? input.x : 0, 0, fresh ? input.z : 0);
      const sprint = fresh && input.sprint && c.stamina > 1 && !c.chanting;
      if (sprint && wish.lengthSq()) c.stamina = Math.max(0, c.stamina - dt * 18);
      if (c.alive) this.game.stepBody(c, dt, wish, (sprint ? 10.5 : 7) * (c.chanting ? 0.6 : 1), fresh && input.jump, fresh && input.jump, fresh && input.descend);
      c.updateStatus(dt, this.game);
    }
    this.game.spells.update(dt); this.game.fx.update(dt);
    if (this.players.some(c => !c.alive)) {
      const winner = this.players[0].alive === this.players[1].alive ? null : this.players[0].alive ? 0 : 1;
      if (winner !== null) this.score[winner]++;
      this.phase = this.score.some(n => n >= this.winsToWin) ? 'finished' : 'between'; this.until = this.elapsed + 4;
      this.emit({ type: 'result', winner, score: this.score, finished: this.phase === 'finished' });
    } else if (this.elapsed > 600) {
      this.phase = 'finished'; this.emit({ type: 'result', winner: null, score: this.score, finished: true, reason: 'Match time limit reached.' });
    }
  }
  state() {
    return { type: 'state', time: this.elapsed, phase: this.phase, countdown: Math.max(0, Math.ceil(this.until - this.elapsed)),
      round: this.round, score: this.score, ack: this.inputs.map(i => i.seq), players: this.players.map(snapshot),
      boxes: this.game.world.boxes.map(b => Object.fromEntries(['x', 'y', 'z', 'hx', 'hy', 'hz', 'yaw', 'cos', 'sin'].map(key => [key, b[key]]))) };
  }
  dispose() { this.game.spells.clear(); this.game.fx.clear(); this.game.scene.clear(); }
}
