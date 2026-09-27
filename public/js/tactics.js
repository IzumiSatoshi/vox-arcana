import * as THREE from 'three';

// Decisions use current visible spells and terrain, never a future cast or RNG.
// The caller still has to chant, pay mana, aim and move through normal physics.
export function planTactics(brain, foe) {
  const c = brain.c, g = brain.g;
  if (!foe || !c.alive || brain.tactical === false) return {};
  const active = g.spells.active || [];
  const enemySpells = active.filter(s => s.caster === foe && !s.done);
  for (const s of enemySpells) if (s.t < 0.3) brain.lastThreatShape = s.spec.shape;
  const prison = active.find(s => !s.broken && s.trapped?.has(c) && s.t < s.life);
  if (prison) {
    const dir = c.pos.clone().sub(foe.pos).setY(0).normalize();
    if (c.mana >= 30) return { cast: { shape: 'blink', element: 'arcane', point: c.eye(new THREE.Vector3()).addScaledVector(dir, 16) }, urgent: true };
    if (prison.core?.alive) return { aim: prison.core.center(), wish: new THREE.Vector3(), saveMana: true };
  }
  // Step out of an announced cage before it closes, without waiting for speech.
  const forming = enemySpells.find(s => s.spec.shape === 'prison' && !s.closed && s.center.distanceTo(c.pos) < s.R + 1);
  if (forming) {
    const out = c.pos.clone().sub(forming.center).setY(0);
    if (out.lengthSq() < 0.01) out.subVectors(c.pos, foe.pos).setY(0);
    return { wish: out.normalize(), dash: out.clone().normalize() };
  }
  const barrier = active.find(s => s.caster === c && s.spec.shape === 'barrier' && !s.endT && !s.done && s.t < s.life);
  const drone = (g.spells.structures || []).filter(s => s.alive && s.owner === foe && s.kind === 'funnel').sort((a, b) => a.pos.distanceTo(c.pos) - b.pos.distanceTo(c.pos))[0];
  const enemyBarrier = enemySpells.find(s => ['wall', 'barrier'].includes(s.spec.shape) && !s.endT && s.t < s.life);
  if (enemyBarrier) {
    // Walk around the nearest edge rather than repeatedly shooting the pane.
    const side = enemyBarrier.sideV, center = enemyBarrier.center;
    const edgeA = center.clone().addScaledVector(side, enemyBarrier.W / 2 + 3);
    const edgeB = center.clone().addScaledVector(side, -enemyBarrier.W / 2 - 3);
    const edge = edgeA.distanceTo(c.pos) < edgeB.distanceTo(c.pos) ? edgeA : edgeB;
    return { wish: edge.sub(c.pos).setY(0).normalize(), cast: c.mana > 70 ? { shape: 'meteor', element: 'earth' } : null, saveMana: c.mana < 35 };
  }
  if (barrier) {
    const home = barrier.center.clone().addScaledVector(barrier.center.clone().sub(foe.pos).setY(0).normalize(), 3);
    home.y = c.pos.y;
    const wish = home.sub(c.pos).setY(0);
    if (wish.length() < 0.5) wish.set(0, 0, 0); else wish.normalize();
    return { wish, aim: drone?.pos.distanceTo(c.pos) < 28 ? drone.center() : null, saveMana: !!drone || c.mana < 35 };
  }
  const lock = enemySpells.find(s => s.spec.shape === 'chain' && s.lock === c && s.t < s.windup);
  if (lock) {
    const covers = [...(g.world.obstacles || []).map(o => ({ x: o.x, z: o.z, r: o.r })), ...(g.world.boxes || []).map(b => ({ x: b.x, z: b.z, r: Math.max(b.hx, b.hz) }))];
    const candidates = covers.map(o => {
      const p = new THREE.Vector3(o.x, c.pos.y, o.z);
      return p.addScaledVector(p.clone().sub(foe.pos).setY(0).normalize(), o.r + 1.2);
    }).filter(p => p.distanceTo(c.pos) < 10).sort((a, b) => a.distanceTo(c.pos) - b.distanceTo(c.pos));
    if (candidates.length) return { wish: candidates[0].sub(c.pos).setY(0).normalize() };
  }
  const needsGuard = brain.tactical === 'guard' || ['chain', 'funnels', 'beam'].includes(brain.lastThreatShape);
  if (needsGuard && c.mana >= 65) return { cast: { shape: 'barrier', element: 'arcane' } };
  if (drone && drone.pos.distanceTo(c.pos) < 28) return { aim: drone.center(), saveMana: true };
  return { saveMana: c.mana < 35 };
}
