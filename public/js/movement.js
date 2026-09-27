// Shared body physics for the game and headless balance simulations.
export function stepBody(c, dt, wish, speed, jump, glide, descend = false) {
    const mm = c.moveMult() * (c.haste > 0 ? 1.35 : 1) * (c.channeling ? 0.5 : 1);
    const fly = c.flying > 0, drop = c.dropping;
    if (drop) speed *= 2;
    const k = Math.min(1, (c.grounded || fly ? 11 : drop ? 3.5 : 2.5) * dt);
    c.vel.x += (wish.x * speed * mm * (fly ? 1.3 : 1) - c.vel.x) * k;
    c.vel.z += (wish.z * speed * mm * (fly ? 1.3 : 1) - c.vel.z) * k;
    if (fly) { const vy = jump ? 7 : descend ? -7 : 0; c.vel.y += (vy - c.vel.y) * Math.min(1, dt * 5); if (c.pos.y > 40) c.vel.y = Math.min(c.vel.y, 0); }
    else {
      c.vel.y -= 24 * dt;
      if (drop) c.vel.y = Math.max(c.vel.y, glide ? -7 : -22); // battle royale descent: steer the fall, Space slows it
      else if (glide && c.vel.y < -2.2) c.vel.y = -2.2;
      if (jump && c.grounded && c.canAct()) { c.vel.y = 8.5; c.grounded = false; }
    }
    const prevY = c.pos.y, prevX = c.pos.x, prevZ = c.pos.z;
    c.pos.addScaledVector(c.vel, dt);
    // cliffs: terrain more than a step above the feet blocks the move; slide along the face on whichever axis stays free
    if (!fly) {
      // blocked if the ground ahead is a tall step, or a cliff-steep rise the feet would end up inside (a jump that
      // clears the lip still lands on top)
      const H = (x, z) => this.world.heightAt(x, z), h0 = H(prevX, prevZ), top = Math.max(prevY, c.pos.y) + 0.7;
      const bad = (x, z) => { const h = H(x, z); return h > top || (h - h0 > Math.hypot(x - prevX, z - prevZ) * 1.25 + 0.01 && h > c.pos.y - 0.05); };
      if (bad(c.pos.x, c.pos.z)) {
        if (!bad(c.pos.x, prevZ)) { c.pos.z = prevZ; c.vel.z = 0; }
        else if (!bad(prevX, c.pos.z)) { c.pos.x = prevX; c.vel.x = 0; }
        else { c.pos.x = prevX; c.pos.z = prevZ; c.vel.x = c.vel.z = 0; }
      }
    }
    const gy = this.world.groundAt(c.pos.x, c.pos.z, Math.max(prevY, c.pos.y));
    if (c.pos.y <= gy) { c.pos.y = gy; if (c.vel.y < 0) c.vel.y = 0; c.grounded = true; }
    else c.grounded = c.pos.y - gy < 0.08 && c.vel.y <= 0;
    // cliff faces can't be stood on (or jumped up in hops): slide off them
    if (c.grounded && !fly && c.pos.y - this.world.heightAt(c.pos.x, c.pos.z) < 0.1) {
      const n = this.world.normalAt(c.pos.x, c.pos.z);
      if (n.y < 0.66) { c.vel.x += n.x * 60 * dt; c.vel.z += n.z * 60 * dt; c.grounded = false; }
    }
    // bump the head on the underside of a construct
    for (const b of this.world.boxesAt(c.pos.x, c.pos.z)) if (c.vel.y > 0 && this.world.inBox(b, { x: c.pos.x, y: c.pos.y + 1.8, z: c.pos.z }, 0.2) && prevY + 1.8 <= b.y - b.hy + 0.05) { c.pos.y = b.y - b.hy - 1.81; c.vel.y = 0; }
    this.world.collideBody(c.pos);
    if (c.haste > 0) c.haste -= dt;
  }
