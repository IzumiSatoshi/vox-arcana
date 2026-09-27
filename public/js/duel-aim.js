import * as THREE from 'three';

// Same eye ray for authoritative casts and their visual replicas.
export function duelAim(caster, world, combatants) {
  const origin = caster.eye(new THREE.Vector3()), dir = caster.forward(new THREE.Vector3());
  let distance = world.raycast(origin, dir, 90, 0.5).dist;
  for (const other of combatants) {
    if (other === caster || !other.alive || other.owner === caster) continue;
    const center = other.center(), along = center.clone().sub(origin).dot(dir);
    if (along < 0 || along > distance) continue;
    const closest = origin.clone().addScaledVector(dir, along);
    if (Math.hypot(closest.x - center.x, closest.z - center.z) < 0.6 && Math.abs(closest.y - center.y) < 0.95) distance = along;
  }
  return { origin, dir, point: origin.clone().addScaledVector(dir, distance) };
}
