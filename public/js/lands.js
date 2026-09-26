// The outer island (battle royale): named landmarks beyond the arena's rim hills. Everything here is built from a small
// kit of boxes in a local frame: each visible block goes into the world's statics (merged per material at load) and, when
// it should block bodies and spells, into the world's static solids (walkable on top, see World.groundAt). Builders also
// leave loot spots (chests and item pedestals) for the battle royale, with door waypoints so bots can walk in.
import * as THREE from 'three';
import { stoneMaterial, toon, tintGeo, gemMaterial, crystalSpire, bannerCloth, SITES, SEA_Y, ISLAND_R, onRoad, siteAt } from './world.js';
import { stoneBlock, boulder } from './style.js';
import { NOISE, TIME } from './shaders.js';
import { mulberry32, TAU, clamp, fbm } from './util.js';

let rng = mulberry32(2024);
const pickR = (a) => a[Math.floor(rng() * a.length)];
const rr = (a, b) => a + rng() * (b - a);

// Clay shingles: rows follow world height (so they run level along every roof slope), staggered tiles with their own tint,
// dark overlap shadows under each row and a few mossy tiles.
function roofMaterial(color) {
  const m = new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, vertexColors: true });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = 'varying vec3 vRP; varying vec3 vRN;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vRP=(modelMatrix*vec4(transformed,1.0)).xyz; vRN=normalize(mat3(modelMatrix)*objectNormal);');
    sh.fragmentShader = 'varying vec3 vRP; varying vec3 vRN;\n' + NOISE + sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      vec3 N=normalize(vRN);
      if(N.y>0.25){
        vec2 hz=normalize(N.xz+1e-5); float along=dot(vRP.xz,vec2(-hz.y,hz.x));
        float rowF=vRP.y*3.2, row=floor(rowF), f=fract(rowF);
        float u=along*2.4+row*0.5, tile=floor(u), fu=fract(u);
        float th=fract(sin(dot(vec2(tile,row),vec2(12.9898,78.233)))*43758.5453);
        vec3 c=diffuseColor.rgb*(0.82+th*0.3);
        c*=mix(0.55,1.0,smoothstep(0.0,0.22,f));                         // overlap shadow at the bottom edge of each row
        c*=mix(0.7,1.0,smoothstep(0.0,0.06,min(fu,1.0-fu)));               // gaps between tiles
        c=mix(c,c*1.12+0.03,smoothstep(0.75,1.0,f));                        // sunlit lip
        float mo=smoothstep(0.55,0.8,snoise(vRP*0.35)+th*0.3);
        c=mix(c,vec3(0.32,0.42,0.18),mo*0.55);
        diffuseColor.rgb=c;
      }`);
  };
  m.customProgramCacheKey = () => 'roof';
  return m;
}

let M = null;
function mats() {
  if (M) return M;
  M = {
    wall: stoneMaterial(0xd2c6ab, { moss: 0.55, joint: 0.62, brick: 1.25, grime: 0.9 }),
    wallDark: stoneMaterial(0xa99c84, { moss: 0.75, joint: 0.55, brick: 1.05 }),
    rough: stoneMaterial(0xb8ac94, { moss: 1, grime: 0.8 }),
    plaster: stoneMaterial(0xf0e4c8, { moss: 0.1, grime: 0.7 }),
    timber: stoneMaterial(0x6a472b, { moss: 0.05, grime: 0.1 }),
    plank: stoneMaterial(0x93704a, { moss: 0.1, grime: 0.15 }),
    sand: stoneMaterial(0xd8c49a, { moss: 0.3, grime: 0.4 }),
    glass: toon(0x2c3f5c, { emissive: 0x0a1428 }),
    gold: toon(0xd9b25a, { emissive: 0x3a2a00 }),
    iron: toon(0x3d4148),
    hay: toon(0xd8b454),
    cloths: [toon(0xb8343c), toon(0x2f5fa8), toon(0xe0b040), toon(0x3a8a4a), toon(0xe8e0d0)],
    roofs: [roofMaterial(0xb04e36), roofMaterial(0x46689a), roofMaterial(0x7c5a3c), roofMaterial(0x587a44), roofMaterial(0x8a3a3a)],
    slate: roofMaterial(0x5a6474),
  };
  return M;
}

// a local frame: position (x, z), ground height y, heading yaw (local +z is "front")
class Frame {
  constructor(W, x, y, z, yaw = 0) { Object.assign(this, { W, x, y, z, yaw, c: Math.cos(yaw), s: Math.sin(yaw) }); }
  at(lx, lz) { return [this.x + lx * this.c + lz * this.s, this.z - lx * this.s + lz * this.c]; }
  put(geo, mat, lx, y, lz, ry = 0, rx = 0, rz = 0) {
    const [x, z] = this.at(lx, lz), m = new THREE.Mesh(geo, mat);
    m.position.set(x, this.y + y, z); m.rotation.order = 'YXZ'; m.rotation.set(rx, this.yaw + ry, rz);
    this.W.statics.add(m); return m;
  }
  // a box standing on local height ly (its base); solid unless o.solid === false. o.block: chipped stone block
  box(lx, ly, lz, w, h, d, mat, o = {}) {
    const geo = o.block ? stoneBlock(w, h, d, rng, { chip: o.chip ?? 0.05, seg: Math.max(w, h, d) > 1.6 ? 2 : 1 }) : new THREE.BoxGeometry(w, h, d);
    tintGeo(geo, rng, o.tint ?? 0.08);
    const m = this.put(geo, mat, lx, ly + h / 2, lz, o.ry || 0, o.rx || 0, o.rz || 0);
    if (o.solid !== false && !o.rx && !o.rz) { const [x, z] = this.at(lx, lz); this.W.addSolid(x, this.y + ly, z, w, h, d, this.yaw + (o.ry || 0)); }
    return m;
  }
  solid(lx, ly, lz, w, h, d, ry = 0) { const [x, z] = this.at(lx, lz); this.W.addSolid(x, this.y + ly, z, w, h, d, this.yaw + ry); }
  obst(lx, lz, r, h, ly = 0) { const [x, z] = this.at(lx, lz); this.W.obstacles.push({ x, z, r, y0: this.y + ly, h }); }
  // a chest (or an item pedestal) for the battle royale; `via` = local waypoints a bot walks through to reach it
  loot(lx, ly, lz, tier, via = [], kind = 'chest', ry = 0) {
    const [x, z] = this.at(lx, lz);
    this.W.lootSpots.push({ x, y: this.y + ly, z, yaw: this.yaw + ry, tier, kind, via: via.map(([a, b]) => { const [wx, wz] = this.at(a, b); return new THREE.Vector3(wx, 0, wz); }) });
  }
  sub(lx, ly, lz, ry = 0) { const [x, z] = this.at(lx, lz); return new Frame(this.W, x, this.y + ly, z, this.yaw + ry); }
}

// gable roof over a w (local x) × d (local z) footprint, eaves at `ey`, ridge `rise` higher, running along x
function roof(F, lx, lz, w, d, ey, rise, mat, o = {}) {
  const K = mats(), ov = o.ov ?? 0.5, run = d / 2, hd = run + ov, ang = Math.atan2(rise, run), L = hd / Math.cos(ang), th = 0.22;
  for (const s of [-1, 1]) {
    const g = new THREE.BoxGeometry(w + ov * 1.2, th, L); tintGeo(g, rng, 0.1);
    F.put(g, mat, lx, ey + rise - (hd / 2) * Math.tan(ang) + (th / 2) / Math.cos(ang), lz + s * hd / 2, 0, s * ang, 0);
  }
  // gable ends (plaster triangles) and the ridge beam
  const shp = new THREE.Shape([new THREE.Vector2(-run, 0), new THREE.Vector2(run, 0), new THREE.Vector2(0, rise)]);
  const gg = new THREE.ExtrudeGeometry(shp, { depth: 0.3, bevelEnabled: false }); gg.translate(0, 0, -0.15); gg.rotateY(Math.PI / 2); tintGeo(gg, rng, 0.06);
  for (const s of [-1, 1]) F.put(gg.clone(), o.gable || K.plaster, lx + s * (w / 2 - 0.17), ey, lz);
  F.box(lx, ey + rise - 0.05, lz, w + ov * 1.3, 0.26, 0.3, K.timber, { solid: false });
  if (o.solid !== false) { // three stepped blocks approximate the gable for bodies and spells
    for (let k = 0; k < 3; k++) {
      const [x, z] = F.at(lx, lz), dd = d * (1 - k / 3), top = ey + rise * (k * 2 + 1) / 6;
      F.W.addSolid(x, F.y + ey + (k ? rise * (k * 2 - 1) / 6 : 0), z, w, top - (ey + (k ? rise * (k * 2 - 1) / 6 : 0)), dd, F.yaw);
    }
  }
  if (o.chimney) F.box(lx + o.chimney * w * 0.3, ey + rise * 0.2, lz - d * 0.18, 0.9, rise * 0.95 + 0.9, 0.9, K.wallDark, { solid: false });
}

// straight run of solid stair blocks from local (lx, lz) heading (dx, dz), climbing y0 → y1
function stairs(F, lx, lz, dx, dz, width, y0, y1, mat, run = 0.55) {
  const n = Math.ceil((y1 - y0) / 0.3), rise = (y1 - y0) / n;
  for (let k = 0; k < n; k++) F.box(lx + dx * (k + 0.5) * run, y0, lz + dz * (k + 0.5) * run, dx ? run : width, rise * (k + 1), dx ? width : run, mat, { tint: 0.05 });
  return n * run;
}

// merlons along a local segment (x0,z0) → (x1,z1) at height y
function merlons(F, x0, z0, x1, z1, y, mat, gap = 1.9, size = [1.0, 1.1, 0.7]) {
  const L = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.floor(L / gap)), along = Math.abs(x1 - x0) > Math.abs(z1 - z0);
  for (let k = 0; k < n; k++) {
    const t = (k + 0.5) / n;
    F.box(x0 + (x1 - x0) * t, y, z0 + (z1 - z0) * t, along ? size[0] : size[2], size[1], along ? size[2] : size[0], mat, { block: true, chip: 0.08 });
  }
}

function banner(F, lx, lz, ly, color, h = 6.2, ry = 0) {
  const K = mats(), [x, z] = F.at(lx, lz), y = F.y + ly;
  F.box(lx, ly, lz, 0.18, h, 0.18, K.timber, { solid: false });
  F.box(lx, ly + h - 0.42, lz, 1.7, 0.1, 0.1, K.timber, { solid: false, ry: ry + Math.PI / 2 });
  const g = new THREE.PlaneGeometry(1.3, 2.6, 6, 12); g.translate(0, -1.3, 0);
  const c = new THREE.Mesh(g, bannerCloth(color)); c.position.set(x, y + h - 0.38, z); c.rotation.y = F.yaw + ry; c.castShadow = true; c.userData.noAO = true;
  F.W.scene.add(c);
  F.obst(lx, lz, 0.2, h, ly);
}

// ------------------------------------------------------------------ buildings
// A timber-framed cottage on a stone plinth: plastered walls, a door (front, local +z) left ajar, windows, gable roof.
// ruined: roofless, broken wall tops, fallen blocks.
function house(F, w, d, o = {}) {
  const K = mats(), eh = o.eh ?? 3.3, fy = 0.35, t = 0.34, dw = 1.5, ruined = !!o.ruined, wm = o.wall || K.plaster;
  F.box(0, -1.2, 0, w + 0.5, 1.2 + fy, d + 0.5, K.wallDark, { tint: 0.05 });
  const seg = (lx, lz, len, alongX, y0, h) => {
    if (!ruined) return F.box(lx, y0, lz, alongX ? len : t, h, alongX ? t : len, wm);
    const n = Math.max(1, Math.round(len / 1.4)), l = len / n;
    for (let k = 0; k < n; k++) {
      if (rng() < 0.18) continue;
      const u = -len / 2 + l * (k + 0.5), hh = y0 < fy + 0.1 ? Math.max(0.6, h * rr(0.25, 1)) : h * rr(0.3, 1);
      F.box(lx + (alongX ? u : 0), y0, lz + (alongX ? 0 : u), alongX ? l + 0.02 : t, hh, alongX ? t : l + 0.02, K.rough, { tint: 0.12 });
    }
  };
  seg(0, -d / 2 + t / 2, w, true, fy, eh);
  for (const s of [-1, 1]) seg(s * (w / 2 - t / 2), 0, d - 2 * t, false, fy, eh);
  const side = (w - dw) / 2;
  for (const s of [-1, 1]) seg(s * (dw / 2 + side / 2), d / 2 - t / 2, side, true, fy, eh);
  if (!ruined) F.box(0, fy + 2.5, d / 2 - t / 2, dw, eh - 2.5, t, wm);
  if (!ruined) {
    // timber frame: corner posts, sill and top rails, braces on the long walls
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) F.box(sx * (w / 2 - 0.1), fy, sz * (d / 2 - 0.1), 0.3, eh, 0.3, K.timber, { solid: false });
    for (const sz of [-1, 1]) for (const y of [fy + 0.05, fy + eh * 0.52, fy + eh - 0.25]) {
      if (sz > 0 && y < fy + 2.6) { for (const s of [-1, 1]) F.box(s * (dw / 2 + side / 2), y, sz * (d / 2 + 0.02), side, 0.22, 0.14, K.timber, { solid: false }); }
      else F.box(0, y, sz * (d / 2 + 0.02), w, 0.22, 0.14, K.timber, { solid: false });
    }
    for (const sx of [-1, 1]) for (const y of [fy + 0.05, fy + eh * 0.52, fy + eh - 0.25]) F.box(sx * (w / 2 + 0.02), y, 0, 0.14, 0.22, d, K.timber, { solid: false });
    for (const s of [-1, 1]) F.box(s * (dw / 2 + 0.1), fy, d / 2 + 0.02, 0.22, 2.6, 0.16, K.timber, { solid: false });
    const br = Math.atan2(eh * 0.48, 1.3);
    for (const sx of [-1, 1]) F.box(sx * (w / 2 - 0.9), fy + eh * 0.52 - 0.1, -d / 2 - 0.02, 0.16, Math.hypot(eh * 0.48, 1.3), 0.12, K.timber, { solid: false, rz: sx * (Math.PI / 2 - br) * 0.6 });
    // windows: dark panes with a timber surround and a sill
    const win = (lx, lz, alongX) => {
      F.box(lx, fy + 1.1, lz, alongX ? 0.95 : t + 0.08, 1.05, alongX ? t + 0.08 : 0.95, K.glass, { solid: false });
      F.box(lx, fy + 1.0, lz, alongX ? 1.25 : t + 0.22, 0.12, alongX ? t + 0.22 : 1.25, K.timber, { solid: false });
      F.box(lx, fy + 1.05, lz, alongX ? 0.1 : t + 0.12, 1.1, alongX ? t + 0.12 : 0.1, K.timber, { solid: false });
    };
    for (let k = -1; k <= 1; k += 2) if (w > 5.5) win(k * w * 0.26, -d / 2 + t / 2, true);
    for (const s of [-1, 1]) win(s * (w / 2 - t / 2), 0, false);
    // the door, swung open into the room
    const leaf = F.box(-dw / 2 + 0.05, fy, d / 2 - t - 0.62, 0.1, 2.45, 1.35, K.plank, { solid: false }); leaf.rotation.y += 0.25;
    roof(F, 0, 0, w, d, fy + eh, Math.min(3, d * 0.42), o.roof || pickR(K.roofs), { chimney: o.chimney ?? (rng() < 0.6 ? 1 : 0) });
    // inside: a table and a barrel
    F.box(-w / 2 + 1.3, fy, 0.2, 1.3, 0.8, 0.8, K.plank);
    F.obst(w / 2 - 0.8, d / 2 - 1.1, 0.4, 1, fy); F.put(new THREE.CylinderGeometry(0.4, 0.36, 1, 10), K.plank, w / 2 - 0.8, fy + 0.5, d / 2 - 1.1);
  } else {
    for (let k = 0; k < 7; k++) { const x = rr(-w, w) * 0.7, z = rr(-d, d) * 0.7, s = rr(0.3, 0.7); F.put(tintGeo(stoneBlock(s * 1.6, s * 0.7, s, rng, { chip: 0.14, seg: 1 }), rng, 0.12), K.rough, x, fy + s * 0.3, z, rr(0, TAU), rr(-0.3, 0.3), rr(-0.3, 0.3)); }
  }
  if (o.loot !== false) F.loot(w / 2 - 0.95, fy, -d / 2 + 0.9, o.loot || 'chest', [[0, d / 2 + 2.4], [0, d / 2 - 1.2]]);
}

// two storeys: stairs along the back wall to an upper hall (the village's town hall, the farm's barn loft)
function hall(F, w, d, o = {}) {
  const K = mats(), eh = 3.6, fy = 0.35, t = 0.4, dw = 1.8, wm = o.wall || K.plaster;
  F.box(0, -1.2, 0, w + 0.6, 1.2 + fy, d + 0.6, K.wallDark);
  const H = eh * 2 + 0.3;
  F.box(0, fy, -d / 2 + t / 2, w, H, t, wm);
  for (const s of [-1, 1]) F.box(s * (w / 2 - t / 2), fy, 0, t, H, d - 2 * t, wm);
  const side = (w - dw) / 2;
  for (const s of [-1, 1]) F.box(s * (dw / 2 + side / 2), fy, d / 2 - t / 2, side, H, t, wm);
  F.box(0, fy + 2.8, d / 2 - t / 2, dw, H - 2.8, t, wm);
  // upper floor with an opening over the stairs
  const fl = fy + eh, iz0 = -d / 2 + t, sw = 1.3, sx0 = w / 2 - t - 0.2;
  const run = stairs(F, sx0, iz0 + sw / 2, -1, 0, sw, fy, fl + 0.3, K.plank);
  F.box(0, fl, (iz0 + sw + d / 2 - t) / 2, w - 2 * t, 0.3, d / 2 - t - (iz0 + sw), K.plank);
  F.box((-w / 2 + t + sx0 - run - 0.3) / 2, fl, iz0 + sw / 2, sx0 - run - 0.3 + w / 2 - t, 0.3, sw, K.plank);
  // timber trim, windows on both floors
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) F.box(sx * (w / 2 - 0.1), fy, sz * (d / 2 - 0.1), 0.34, H, 0.34, K.timber, { solid: false });
  for (const sz of [-1, 1]) F.box(0, fl, sz * (d / 2 + 0.03), w, 0.3, 0.14, K.timber, { solid: false });
  for (const sx of [-1, 1]) F.box(sx * (w / 2 + 0.03), fl, 0, 0.14, 0.3, d, K.timber, { solid: false });
  for (const y of [fy + 1.1, fl + 1.2]) for (let k = -1; k <= 1; k++) {
    if (y < fl && k === 0) continue;
    F.box(k * w * 0.3, y, d / 2 - t / 2, 1.0, 1.25, t + 0.08, K.glass, { solid: false });
    F.box(k * w * 0.3, y - 0.1, d / 2 - t / 2, 1.3, 0.12, t + 0.24, K.timber, { solid: false });
  }
  for (const s of [-1, 1]) for (const y of [fy + 1.1, fl + 1.2]) F.box(s * (w / 2 - t / 2), y, 0, t + 0.08, 1.25, 1.0, K.glass, { solid: false });
  roof(F, 0, 0, w, d, fy + H, Math.min(3.6, d * 0.42), o.roof || pickR(K.roofs), { chimney: 1 });
  F.loot(-w / 2 + 1.1, fl + 0.3, d / 2 - 1.2, o.upper || 'iron', [[0, d / 2 + 2.4], [0, d / 2 - 1.4], [sx0 + 0.2, iz0 + sw / 2], [sx0 - run, iz0 + sw / 2]]);
  F.loot(-w / 2 + 1.1, fy, -d / 2 + 1.0, 'chest', [[0, d / 2 + 2.4], [0, d / 2 - 1.4]]);
}

function well(F, lx, lz) {
  const K = mats(), G = F.sub(lx, 0, lz);
  for (let k = 0; k < 10; k++) { const a = (k / 10) * TAU; G.put(tintGeo(stoneBlock(1.05, 0.9, 0.5, rng, { chip: 0.08, seg: 1 }), rng), K.wallDark, Math.cos(a) * 1.35, 0.45, Math.sin(a) * 1.35, -a + Math.PI / 2); }
  for (const s of [-1, 1]) G.box(s * 1.35, 0.9, 0, 0.18, 2.1, 0.18, K.timber, { solid: false });
  G.box(0, 3.0, 0, 3.0, 0.16, 0.16, K.timber, { solid: false });
  roof(G, 0, 0, 1.6, 2.4, 3.05, 0.9, pickR(K.roofs), { ov: 0.2, solid: false, gable: K.timber });
  G.obst(0, 0, 1.7, 1.2);
}

function crate(F, lx, lz, ly = 0, s = 1) { const K = mats(); F.box(lx, ly, lz, s, s, s, K.plank, { ry: rr(-0.3, 0.3), tint: 0.12 }); }
function barrel(F, lx, lz, ly = 0) { const K = mats(); F.put(tintGeo(new THREE.CylinderGeometry(0.42, 0.38, 1.05, 12), rng, 0.1), K.plank, lx, ly + 0.52, lz); F.put(new THREE.TorusGeometry(0.41, 0.03, 4, 16), K.iron, lx, ly + 0.8, lz, 0, Math.PI / 2); F.obst(lx, lz, 0.45, 1.1, ly); }
function hay(F, lx, lz) { const K = mats(); F.put(tintGeo(new THREE.CylinderGeometry(0.75, 0.75, 1.3, 14), rng, 0.1), K.hay, lx, 0.75, lz, rr(0, TAU), 0, Math.PI / 2); F.obst(lx, lz, 0.8, 1.5); }
function stall(F, lx, lz, ry) {
  const K = mats(), G = F.sub(lx, 0, lz, ry);
  G.box(0, 0, 0, 2.6, 0.95, 1.0, K.plank);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) G.box(sx * 1.25, 0, sz * 0.55, 0.12, 2.6, 0.12, K.timber, { solid: false });
  G.box(0, 2.45, 0.2, 3.0, 0.08, 1.9, pickR(K.cloths), { solid: false, rx: 0.22 });
  for (let k = 0; k < 3; k++) G.put(new THREE.SphereGeometry(0.16, 8, 6), toon([0xe04a3a, 0xf0b030, 0x7ac040][k]), -0.7 + k * 0.7, 1.08, 0);
  G.loot(0, 0.95, 0, 'floor', [], 'item');
}
function fence(F, x0, z0, x1, z1) {
  const K = mats(), L = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.round(L / 2.4)), yaw = Math.atan2(x1 - x0, z1 - z0);
  for (let k = 0; k <= n; k++) { const t = k / n, x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t; F.box(x, -0.2, z, 0.16, 1.35, 0.16, K.timber, { solid: false }); }
  for (const y of [0.45, 0.9]) { const [cx, cz] = [(x0 + x1) / 2, (z0 + z1) / 2]; F.box(cx, y, cz, 0.08, 0.12, L, K.timber, { solid: false, ry: yaw }); }
  F.solid((x0 + x1) / 2, -0.2, (z0 + z1) / 2, 0.12, 1.15, L, yaw);
}

// ------------------------------------------------------------------ landmarks
function faceCentre(S) { return Math.atan2(-S.x, -S.z); } // yaw whose local +z points back toward the arena

// Highcrown Keep: a walled castle on a hill. Curtain walls you can walk (two stairways), four corner towers, a gatehouse
// facing the arena, and a three-level keep (stairs inside) with a vault room and a roof you can fight from.
function castle(W, S) {
  const K = mats(), F = new Frame(W, S.x, S.h, S.z, faceCentre(S)), H = 30, WH = 7.5, WT = 2.6, TS = 8;
  const wallSeg = (x0, z0, x1, z1) => { // one straight stretch of curtain wall with merlons on its outer edge
    const along = Math.abs(x1 - x0) > Math.abs(z1 - z0), L = Math.hypot(x1 - x0, z1 - z0), cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    F.box(cx, -1, cz, along ? L : WT, WH + 1, along ? WT : L, K.wall, { tint: 0.04 });
    const out = along ? Math.sign(cz) : Math.sign(cx);
    if (along) merlons(F, x0, cz + out * (WT / 2 - 0.35), x1, cz + out * (WT / 2 - 0.35), WH, K.wall); else merlons(F, cx + out * (WT / 2 - 0.35), z0, cx + out * (WT / 2 - 0.35), z1, WH, K.wall);
    F.box(cx - (along ? 0 : out * (WT / 2 + 0.02)), WH - 1.2, cz - (along ? out * (WT / 2 + 0.02) : 0), along ? L : 0.1, 0.25, along ? 0.1 : L, K.wallDark, { solid: false }); // string course
  };
  const inner = H - TS / 2; // walls run between the corner towers
  wallSeg(-inner, -H, inner, -H); wallSeg(-H, -inner, -H, inner); wallSeg(H, -inner, H, inner);
  wallSeg(-inner, H, -4.5, H); wallSeg(4.5, H, inner, H);
  // gate: an arch lintel carrying the wall-walk across, a half-raised portcullis
  F.box(0, 4.6, H, 9, WH - 4.6, WT, K.wall); merlons(F, -4.5, H + WT / 2 - 0.35, 4.5, H + WT / 2 - 0.35, WH, K.wall);
  F.box(0, 3.3, H + 0.2, 6.2, 1.3, 0.25, K.iron, { solid: false });
  for (let k = -5; k <= 5; k++) F.box(k * 0.55, 3.0, H + 0.2, 0.08, 1.8, 0.1, K.iron, { solid: false });
  for (const s of [-1, 1]) { // gatehouse towers
    F.box(s * 6.5, -1, H + 0.6, 5, WH + 4.5, 5, K.wall);
    merlons(F, s * 6.5 - 2.2, H + 3.0, s * 6.5 + 2.2, H + 3.0, WH + 3.5, K.wall, 1.5, [0.8, 1.0, 0.6]);
    F.box(s * 6.5, WH + 1.6, H + 3.12, 0.5, 1.3, 0.14, K.glass, { solid: false });
    banner(F, s * 4.2, H + 2.2, 0, s < 0 ? 0x2b4a9a : 0x9a2b3c, 6.5);
  }
  // corner towers: taller than the walls, a prize on top for whoever can get up there (runes)
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const tx = sx * H, tz = sz * H, th = WH + 4;
    F.box(tx, -1, tz, TS, th + 1, TS, K.wall, { tint: 0.04 });
    F.box(tx, th - 0.3, tz, TS + 0.6, 0.5, TS + 0.6, K.wallDark);
    merlons(F, tx - TS / 2, tz - TS / 2 + 0.3, tx + TS / 2, tz - TS / 2 + 0.3, th + 0.2, K.wall, 1.6);
    merlons(F, tx - TS / 2, tz + TS / 2 - 0.3, tx + TS / 2, tz + TS / 2 - 0.3, th + 0.2, K.wall, 1.6);
    merlons(F, tx - TS / 2 + 0.3, tz - TS / 2 + 1, tx - TS / 2 + 0.3, tz + TS / 2 - 1, th + 0.2, K.wall, 1.6);
    merlons(F, tx + TS / 2 - 0.3, tz - TS / 2 + 1, tx + TS / 2 - 0.3, tz + TS / 2 - 1, th + 0.2, K.wall, 1.6);
    for (const y of [3.2, 7.2]) F.box(tx + sx * (TS / 2 + 0.02), y, tz, 0.12, 1.4, 0.45, K.glass, { solid: false });
    F.loot(tx, th + 0.2, tz, 'iron', [], 'item');
  }
  // stairways up to the side wall-walks
  for (const s of [-1, 1]) stairs(F, s * (H - WT / 2 - 1.0), 12, 0, -1, 2.0, 0, WH, K.wallDark, 0.52);
  // the keep
  const KX = 0, KZ = -9, kw = 20, kd = 16, kt = 1.2, f2 = 5, f3 = 10, G = F.sub(KX, 0, KZ);
  G.box(0, -0.6, 0, kw + 1, 0.9, kd + 1, K.wallDark);
  const kH = f3 + 0.4;
  G.box(0, 0, -kd / 2 + kt / 2, kw, kH, kt, K.wall, { tint: 0.04 });
  for (const s of [-1, 1]) G.box(s * (kw / 2 - kt / 2), 0, 0, kt, kH, kd - 2 * kt, K.wall, { tint: 0.04 });
  for (const s of [-1, 1]) G.box(s * (1.3 + (kw / 2 - 1.3) / 2), 0, kd / 2 - kt / 2, kw / 2 - 1.3, kH, kt, K.wall, { tint: 0.04 });
  G.box(0, 3.6, kd / 2 - kt / 2, 2.6, kH - 3.6, kt, K.wall);
  G.box(0, 3.5, kd / 2 + 0.05, 3.2, 0.35, 0.3, K.wallDark, { solid: false });
  const ix = kw / 2 - kt, iz = kd / 2 - kt;
  // stairs A (west wall) ground → floor 2; stairs B (east wall) floor 2 → roof
  const runA = stairs(G, -ix + 1.0, iz - 1.0, 0, -1, 2.0, 0.3, f2 + 0.4, K.wallDark);
  G.box(1.0, f2, 0, 2 * ix - 2.0, 0.4, 2 * iz, K.plank); // floor 2 (open over stairs A)
  G.box(-ix + 1.0, f2, (-iz + (iz - 1.0 - runA - 0.4)) / 2, 2.0, 0.4, (iz - 1.0 - runA - 0.4) + iz, K.plank);
  const runB = stairs(G, ix - 1.0, -iz + 1.0, 0, 1, 2.0, f2 + 0.4, f3 + 0.4, K.wallDark);
  G.box(-1.0, f3, 0, 2 * ix - 2.0, 0.4, 2 * iz, K.wallDark); // roof (open over stairs B)
  G.box(ix - 1.0, f3, (iz + (-iz + 1.0 + runB + 0.4)) / 2, 2.0, 0.4, iz - (-iz + 1.0 + runB + 0.4), K.wallDark);
  G.box(0, -0.05, 0, 2 * ix, 0.35, 2 * iz, K.plank); // ground floor boards
  merlons(G, -kw / 2, -kd / 2 + 0.35, kw / 2, -kd / 2 + 0.35, kH, K.wall, 1.8);
  merlons(G, -kw / 2, kd / 2 - 0.35, kw / 2, kd / 2 - 0.35, kH, K.wall, 1.8);
  merlons(G, -kw / 2 + 0.35, -kd / 2 + 1, -kw / 2 + 0.35, kd / 2 - 1, kH, K.wall, 1.8);
  merlons(G, kw / 2 - 0.35, -kd / 2 + 1, kw / 2 - 0.35, kd / 2 - 1, kH, K.wall, 1.8);
  for (const y of [2.2, 6.6]) for (let k = -2; k <= 2; k++) if (k || y > 5) G.box(k * 3.6, y, kd / 2 + 0.02, 0.5, 1.6, 0.14, K.glass, { solid: false });
  for (const y of [2.2, 6.6]) for (const s of [-1, 1]) for (let k = -1; k <= 1; k++) G.box(s * (kw / 2 + 0.02), y, k * 4.5, 0.14, 1.6, 0.5, K.glass, { solid: false });
  // a turret with a slate cap on the keep's corner, the royal standard on the roof
  G.box(-kw / 2 + 1.5, kH, -kd / 2 + 1.5, 3, 4, 3, K.wall);
  const cap = new THREE.ConeGeometry(2.4, 3.6, 4); cap.rotateY(Math.PI / 4); tintGeo(cap, rng, 0.08);
  G.put(cap, K.slate, -kw / 2 + 1.5, kH + 4 + 1.8, -kd / 2 + 1.5);
  banner(G, 3, -2, kH, 0xe0b040, 7.5);
  const via = [[0, H + 5], [0, H - 3], [KX, KZ + kd / 2 + 2.5], [KX, KZ + kd / 2 - 2.5]];
  G.loot(3.5, 0.3, -iz + 1.3, 'iron', via);
  G.loot(-5, f2 + 0.4, -iz + 1.3, 'vault', via);
  G.loot(-3, f3 + 0.4, 3, 'floor', [], 'item');
  // the ward: a well, stores, a smithy lean-to, training posts
  well(F, 12, 8);
  for (let k = 0; k < 5; k++) crate(F, -18 + rr(-2, 2), -2 + k * 1.1 + rr(-0.2, 0.2), 0, rr(0.8, 1.1));
  crate(F, -18, 0, 1.0, 0.9); barrel(F, -15.5, 3); barrel(F, -15.8, 4.2); barrel(F, 16.5, -4);
  const sm = F.sub(17, 0, -1, -Math.PI / 2);
  for (const sx of [-1, 1]) sm.box(sx * 3, 0, 1.5, 0.25, 3.1, 0.25, K.timber, { solid: false });
  sm.box(0, 3.0, 0.4, 7, 0.16, 3.4, pickR(K.roofs), { solid: false, rx: 0.3 });
  sm.box(0, 0, -0.6, 1.2, 0.8, 0.6, K.iron); sm.box(-2, 0, -0.5, 1.6, 1.1, 1.2, K.wallDark);
  F.loot(-14, 0, 12, 'chest', [[0, H + 5], [0, H - 3]]); F.loot(14, 0, 14, 'chest', [[0, H + 5], [0, H - 3]]);
  for (let k = 0; k < 3; k++) { F.box(-8 + k * 3, 0, 18, 0.3, 1.8, 0.3, K.timber); F.box(-8 + k * 3, 1.2, 18, 1.1, 0.14, 0.14, K.timber, { solid: false }); }
  F.loot(0, 0, 4, 'floor', [], 'item'); F.loot(-10, 0, -22, 'floor', [], 'item'); F.loot(10, 0, -22, 'floor', [], 'item');
}

// Millbrook: cottages round a market square with a well, a two-storey town hall and a windmill on the far side.
function village(W, S) {
  const K = mats(), F = new Frame(W, S.x, S.h, S.z, faceCentre(S));
  well(F, 0, 0);
  for (let k = 0; k < 4; k++) { const a = (k / 4) * TAU + 0.4; stall(F, Math.cos(a) * 8, Math.sin(a) * 8, -a + Math.PI / 2); }
  hall(F.sub(0, 0, -20, 0), 12, 9, { roof: K.roofs[0] });
  // cottages on a ring, doors to the square, the road in (local +z) left open
  const n = 10, taken = [];
  for (let k = 0; k < n; k++) {
    const a = (k / n) * TAU + rr(-0.12, 0.12) + 0.3;
    const lx = Math.sin(a) * rr(24, 34), lz = Math.cos(a) * rr(24, 34);
    if (lz > 14 && Math.abs(lx) < 9) continue; // the road
    if (lz < -12 && Math.abs(lx) < 12) continue; // the hall
    if (taken.some(([x, z]) => Math.hypot(x - lx, z - lz) < 11)) continue;
    taken.push([lx, lz]);
    const G = F.sub(lx, 0, lz, Math.atan2(-lx, -lz)), w = rr(6, 8.2), d = rr(5, 6.2);
    house(G, w, d, { chimney: 1 });
    if (rng() < 0.6) barrel(G, w / 2 + 0.7, d / 2 + 0.3);
    if (rng() < 0.5) crate(G, -w / 2 - 0.8, d / 2 - 0.2);
  }
  // windmill beyond the hall
  const mx = 16, mz = -36, [wx, wz] = F.at(mx, mz), my = W.heightAt(wx, wz);
  const prof = [[3.3, 0], [3.0, 3], [2.6, 7], [2.3, 10.5]].map(([r, y]) => new THREE.Vector2(r, y));
  const tower = new THREE.LatheGeometry(prof, 16); tintGeo(tower, rng, 0.06);
  const mt = new THREE.Mesh(tower, K.plaster); mt.position.set(wx, my - 0.3, wz); W.statics.add(mt);
  const capG = new THREE.ConeGeometry(2.8, 3.2, 16); tintGeo(capG, rng, 0.08);
  const cm = new THREE.Mesh(capG, K.roofs[1]); cm.position.set(wx, my + 10.2 + 1.6, wz); W.statics.add(cm);
  W.obstacles.push({ x: wx, z: wz, r: 3.3, y0: my - 0.3, h: 13 });
  const sails = new THREE.Group(), out = new THREE.Vector3(wx - S.x, 0, wz - S.z).normalize();
  sails.position.set(wx + out.x * 2.9, my + 9.2, wz + out.z * 2.9); sails.lookAt(sails.position.clone().add(out));
  const spar = new THREE.BoxGeometry(0.2, 7.2, 0.2), sailG = new THREE.PlaneGeometry(1.5, 5.6); sailG.translate(0.85, 3.9, 0);
  const sailM = toon(0xf2ead8, { side: THREE.DoubleSide }), sparM = toon(0x6a472b);
  for (let k = 0; k < 4; k++) { const arm = new THREE.Group(); arm.rotation.z = (k / 4) * TAU; const sp = new THREE.Mesh(spar, sparM); sp.position.y = 3.6; arm.add(sp, new THREE.Mesh(sailG, sailM)); sails.add(arm); }
  sails.add(new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.6, 10).rotateX(Math.PI / 2), sparM));
  sails.traverse((m) => { if (m.isMesh) m.castShadow = true; });
  W.scene.add(sails); W.anim.push((dt) => { sails.rotation.z -= dt * 0.35; });
  const [dx, dz] = F.at(mx, mz + 3.4), G = new Frame(W, dx, my, dz, faceCentre(S));
  G.box(0, 0, 0, 1.4, 2.4, 0.3, K.plank, { solid: false });
  F.loot(mx - 5, 0, mz + 5, 'floor', [], 'item');
  // fences and hay at the edges, banners at the road in
  fence(F, -40, -6, -40, 14); fence(F, 40, -6, 40, 14);
  hay(F, 38, 22); hay(F, 35.5, 24); hay(F, -38, -22);
  banner(F, -5, 20, 0, 0x2b4a9a); banner(F, 5, 20, 0, 0x2f7a4a);
  F.loot(0, 0, 10, 'floor', [], 'item');
}

// Ashen Colosseum: a ring of two-storey arcades round tiered stone seating and a sand floor; half of it has fallen.
function colosseum(W, S) {
  const K = mats(), F = new Frame(W, S.x, S.h, S.z, faceCentre(S)), N = 28, R0 = 21, tiers = 6, dep = 1.35, rise = 0.55, RO = R0 + tiers * dep + 0.8;
  for (let k = 0; k < N; k++) {
    const a = (k / N) * TAU, gate = Math.min(...[0, 1, 2, 3].map((q) => Math.abs(((a - q * Math.PI / 2 + Math.PI) % TAU + TAU) % TAU - Math.PI))) < 0.16;
    if (gate) continue; // four gangways cut through the seating
    for (let t = 0; t < tiers; t++) {
      if (rng() < 0.06 * t) continue; // crumbled seats high up
      const ri = R0 + t * dep, rc = (ri + RO) / 2, len = (TAU * rc) / N * 1.04;
      F.box(Math.sin(a) * rc, 0, Math.cos(a) * rc, len, 0.3 + rise * (t + 1), RO - ri, K.sand, { ry: a, tint: 0.06 });
    }
  }
  // outer arcade: piers with arches between, two storeys, broken on the side away from the arena
  const P = 32, RA = RO + 2.2;
  for (let k = 0; k < P; k++) {
    const a = ((k + 0.5) / P) * TAU, broken = Math.cos(a - Math.PI) > 0.2 && rng() < 0.65, h = broken ? rr(2, 7) : 9.5; // piers straddle the gangways
    const x = Math.sin(a) * RA, z = Math.cos(a) * RA;
    F.box(x, 0, z, 1.7, h, 2.3, K.wall, { ry: a, tint: 0.05 });
    if (!broken) {
      const a2 = ((k + 1) / P) * TAU, x2 = Math.sin(a2) * RA, z2 = Math.cos(a2) * RA, span = (TAU * RA) / P;
      for (const y of [3.8, 8.4]) if (rng() > 0.15) F.box(x2, y, z2, span + 0.4, 1.1, 2.1, K.wall, { ry: a2 });
      F.box(x, 9.5, z, 1.9, 0.4, 2.5, K.wallDark, { ry: a });
    } else for (let q = 0; q < 3; q++) { const d = rr(1, 5), b = a + rr(-0.1, 0.1), s = rr(0.5, 1.1); F.put(tintGeo(stoneBlock(s * 1.8, s, s * 1.2, rng, { chip: 0.14, seg: 1 }), rng, 0.12), K.rough, Math.sin(b) * (RA + d), s * 0.3, Math.cos(b) * (RA + d), rr(0, TAU), rr(-0.4, 0.4), rr(-0.4, 0.4)); }
  }
  // the podium wall round the sand, a broken champion's statue on a plinth
  F.box(0, 0, 0, 3.4, 1.4, 3.4, K.wallDark);
  const st = new THREE.Mesh(tintGeo(stoneBlock(1.2, 3.4, 0.9, rng, { chip: 0.12, seg: 2 }), rng), K.plaster); const [sx, sz] = F.at(0, 0); st.position.set(sx, S.h + 1.4 + 1.6, sz); st.rotation.set(0.05, F.yaw, -0.08); W.statics.add(st);
  F.obst(0, 0, 1.2, 5, 1.4);
  F.loot(0, 0, 3.2, 'iron', [[0, RO + 6], [0, R0 - 1]]);
  F.loot(0, 0, -12, 'chest', [[0, -RO - 6], [0, -R0 + 1]]);
  for (let k = 0; k < 3; k++) { const a = (k / 3) * TAU + 0.5; F.loot(Math.sin(a) * 13, 0, Math.cos(a) * 13, 'floor', [], 'item'); }
  for (const s of [-1, 1]) banner(F, s * 2.8, RA + 3, 0, 0x9a2b3c, 7);
}

// Starcaller Spire: a slender stone tower with a spiral stair inside, an open crown with a vault, and a floating
// star-crystal beacon over it that you can see from anywhere on the island.
function spire(W, S) {
  const K = mats(), F = new Frame(W, S.x, S.h, S.z, faceCentre(S)), R = 5.2, t = 0.9, sides = 14, top = 24, TH = top + 1.3, FT = 0.5;
  F.box(0, -1, 0, 13.5, 1.5, 13.5, K.wallDark, { block: true, chip: 0.04 });
  const segL = (TAU * R) / sides + 0.15;
  for (let k = 0; k < sides; k++) {
    const a = (k / sides) * TAU, x = Math.sin(a) * R, z = Math.cos(a) * R, door = k === 0;
    F.box(x, door ? 3.1 : 0.5, z, segL, TH - (door ? 3.1 : 0.5), t, K.wall, { ry: a, tint: 0.05 });
    if (k % 2 === 0) F.box(x, TH, z, segL * 0.8, 1.0, t, K.wall, { ry: a, block: true }); // crenellations
    if (!door && k % 3 === 1) for (const y of [6, 13, 20]) F.box(Math.sin(a) * (R + 0.02), y, Math.cos(a) * (R + 0.02), 0.45, 1.5, t + 0.06, K.glass, { ry: a, solid: false });
  }
  for (let k = 0; k < 4; k++) { const a = (k / 4) * TAU + Math.PI / 4; F.box(Math.sin(a) * (R + 0.9), -0.5, Math.cos(a) * (R + 0.9), 1.4, 7, 1.6, K.wallDark, { ry: a, block: true, chip: 0.04 }); } // buttresses
  F.box(0, 2.9, R + 0.5, 2.6, 0.4, 1.0, K.wallDark, { solid: false });
  // central newel and a spiral of stair treads, 16 to a turn
  F.obst(0, 0, 1.1, top + 0.5);
  F.put(tintGeo(new THREE.CylinderGeometry(1.1, 1.2, top + 0.5, 12), rng, 0.05), K.wallDark, 0, (top + 0.5) / 2, 0);
  const steps = Math.round((top - FT) / 0.3), da = TAU / 16, a0 = 0.4;
  for (let k = 0; k < steps; k++) { // tread k: top at FT + 0.3 (k + 1)
    const a = a0 + k * da, rc = (1.1 + R - t / 2) / 2, y = FT + 0.3 * (k + 1);
    F.box(Math.sin(a) * rc, y - 0.35, Math.cos(a) * rc, 1.95, 0.35, R - t / 2 - 1.1, K.wallDark, { ry: a, tint: 0.05 });
  }
  // the crown: floor wedges wherever the last turn of the stair is not coming up through
  const aEnd = a0 + (steps - 1) * da;
  for (let k = 0; k < 16; k++) {
    const a = aEnd + (k + 1) * da, ahead = k; // sectors after the stair's end, going round
    if (ahead > 8) continue; // the stair's last turn rises through the other sectors
    const rc = (1.1 + R - t / 2) / 2;
    F.box(Math.sin(a) * rc, top - 0.35, Math.cos(a) * rc, 2.0, 0.4, R - t / 2 - 1.1, K.plank, { ry: a });
  }
  F.box(0, top - 0.35, 0, 2.2, 0.4, 2.2, K.plank);
  const aV = aEnd + 5 * da, rV = 3.1;
  F.loot(Math.sin(aV) * rV, top + 0.05, Math.cos(aV) * rV, 'vault', [], 'chest', aV + Math.PI);
  F.loot(0, FT, 3.2, 'floor', [], 'item');
  // the beacon
  const gm = gemMaterial(0x9fd8ff), beacon = new THREE.Group(), [bx, bz] = F.at(0, 0);
  beacon.add(new THREE.Mesh(crystalSpire(0.9, 4.2, 0.45), gm), new THREE.Mesh(crystalSpire(0.9, 2.2, 0.6).rotateX(Math.PI), gm));
  beacon.position.set(bx, S.h + TH + 5.5, bz); W.scene.add(beacon);
  W.anim.push((dt) => { beacon.rotation.y += dt * 0.6; beacon.position.y = S.h + TH + 5.5 + Math.sin(TIME.value * 0.9) * 0.5; });
  W.beacons = [...(W.beacons || []), beacon.position];
  banner(F, -3.2, R + 2.6, 0, 0x2b4a9a, 5.5); banner(F, 3.2, R + 2.6, 0, 0x2b4a9a, 5.5);
}

// Mirrormere: a shallow lake below the spire, a fishing hut and a plank jetty
function lake(W, S) {
  const K = mats(), sp = SITES.find((q) => q.id === 'spire');
  const dir = Math.atan2(sp.x - S.x, sp.z - S.z), F = new Frame(W, S.x, SEA_Y, S.z, dir + Math.PI);
  // jetty from the shore (away from the spire) out over the water: it starts where the bank meets the waterline
  let shoreD = S.R + 16;
  while (shoreD > S.R - 4) { const [x, z] = F.at(0, shoreD); if (W.gridH(x, z) < SEA_Y + 0.6) break; shoreD -= 0.5; }
  const J = new Frame(W, S.x, SEA_Y, S.z, dir + Math.PI);
  for (let k = 0; k < 9; k++) {
    const lz = shoreD + 1 - k * 2.2;
    J.box(0, 0.55, lz, 2.4, 0.25, 2.25, K.plank, { tint: 0.1 });
    if (k % 2 === 0) for (const s of [-1, 1]) J.box(s * 1.1, -1.8, lz, 0.22, 2.9, 0.22, K.timber, { solid: false });
  }
  J.loot(0, 0.8, shoreD + 1 - 8 * 2.2, 'floor', [], 'item');
  const [hx, hz] = F.at(0, S.R + S.fall + 5), hy = W.gridH(hx, hz), H = new Frame(W, hx, hy, hz, dir);
  house(H, 5.5, 4.6, { loot: 'chest', chimney: 0 });
  // a rowing boat pulled up on the shore
  const boat = new THREE.LatheGeometry([[0, 0], [0.55, 0.05], [0.72, 0.35], [0.75, 0.55]].map(([r, y]) => new THREE.Vector2(r, y)), 12); boat.scale(1, 1, 2.6); tintGeo(boat, rng, 0.08);
  const [bx, bz] = F.at(4, shoreD + 2.5); const bm = new THREE.Mesh(boat, K.plank); bm.position.set(bx, W.heightAt(bx, bz) - 0.1, bz); bm.rotation.set(0.1, dir + 0.6, 0.15); W.statics.add(bm);
}

// Moonstone Henge: a ring of standing stones (some trilithons), an altar and a slowly turning moon crystal
function henge(W, S) {
  const K = mats(), F = new Frame(W, S.x, S.h, S.z, faceCentre(S)), n = 14, R = 12;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * TAU, x = Math.sin(a) * R, z = Math.cos(a) * R, fallen = rng() < 0.15, h = rr(4.2, 5.4);
    if (fallen) { F.put(tintGeo(stoneBlock(1.4, h, 0.9, rng, { chip: 0.1, seg: 2 }), rng), K.rough, x * 1.1, 0.5, z * 1.1, a + 0.4, Math.PI / 2 - 0.1, 0); F.obst(x * 1.1, z * 1.1, 1.2, 1.2); continue; }
    F.box(x, -0.4, z, 1.4, h + 0.4, 0.95, K.rough, { ry: a, block: true, chip: 0.1, tint: 0.14 });
    if (k % 2 === 0 && rng() < 0.7) { const a2 = ((k + 0.5) / n) * TAU; F.box(Math.sin(a2) * R, h - 0.1, Math.cos(a2) * R, (TAU * R) / n + 1.3, 0.8, 1.0, K.rough, { ry: a2, block: true, chip: 0.1 }); }
  }
  F.box(0, 0, 0, 3.2, 0.9, 1.8, K.wallDark, { block: true });
  const gm = gemMaterial(0xcfe4ff), moon = new THREE.Mesh(new THREE.IcosahedronGeometry(0.9, 0), gm), [mx, mz] = F.at(0, 0);
  moon.position.set(mx, S.h + 3.4, mz); W.scene.add(moon);
  W.anim.push((dt) => { moon.rotation.y += dt * 0.4; moon.rotation.x += dt * 0.15; moon.position.y = S.h + 3.4 + Math.sin(TIME.value * 0.7) * 0.25; });
  F.loot(0, 0.9, 0, 'iron', [], 'chest', Math.PI);
  F.loot(6, 0, -3, 'floor', [], 'item'); F.loot(-6, 0, 3, 'floor', [], 'item');
}

// Thornfield Farm: farmhouse, a big barn with a hay loft, fenced fields, hay bales
function farm(W, S) {
  const K = mats(), F = new Frame(W, S.x, S.h, S.z, faceCentre(S));
  house(F.sub(-7, 0, 4, 0), 8, 6, { roof: K.roofs[2], chimney: 1 });
  hall(F.sub(8, 0, -4, 0), 11, 9, { roof: K.roofs[4], wall: K.plank, upper: 'iron' });
  for (let k = 0; k < 6; k++) hay(F, rr(-12, 14), rr(-16, -10) + (k % 2) * 26);
  fence(F, -20, -18, 20, -18); fence(F, -20, 18, -4, 18); fence(F, 4, 18, 20, 18); fence(F, -20, -18, -20, 18); fence(F, 20, -18, 20, 18);
  F.loot(0, 0, 10, 'floor', [], 'item'); F.loot(-14, 0, -12, 'floor', [], 'item');
  // a scarecrow in the field
  const sc = F.sub(26, 0, 10); sc.box(0, 0, 0, 0.14, 2.2, 0.14, K.timber, { solid: false }); sc.box(0, 1.6, 0, 1.5, 0.12, 0.12, K.timber, { solid: false }); sc.box(0, 1.2, 0, 0.6, 0.8, 0.3, K.cloths[0], { solid: false });
  sc.put(new THREE.ConeGeometry(0.45, 0.5, 8), K.hay, 0, 2.45, 0);
}

// Hollowmere Ruins: a burnt-out hamlet round a roofless chapel with a stump of a bell tower and a graveyard
function hollow(W, S) {
  const K = mats(), F = new Frame(W, S.x, S.h, S.z, faceCentre(S));
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * TAU + 0.5, lx = Math.sin(a) * rr(20, 28), lz = Math.cos(a) * rr(20, 28);
    if (lz > 12 && Math.abs(lx) < 8) continue;
    house(F.sub(lx, 0, lz, Math.atan2(-lx, -lz)), rr(5.5, 7.5), rr(4.5, 6), { ruined: true, loot: rng() < 0.6 ? 'chest' : false });
  }
  // the chapel: long nave, apse end, broken walls, altar
  const C = F.sub(0, 0, -6, 0), L = 16, w = 8, t = 0.6;
  C.box(0, -0.8, 0, w + 0.8, 1.1, L + 0.8, K.wallDark);
  for (const s of [-1, 1]) for (let q = 0; q < 5; q++) { const h = rr(2.5, 7.5); C.box(s * (w / 2 - t / 2), 0.3, -L / 2 + 1.6 + q * 3.2, t, h, 3.0, K.wall); if (h > 5.5) C.box(s * (w / 2 - t / 2), 3.6, -L / 2 + 1.6 + q * 3.2 + 1.5, t + 0.06, 1.8, 0.7, K.glass, { solid: false }); }
  C.box(0, 0.3, -L / 2 + t / 2, w, 8.5, t, K.wall);
  for (const s of [-1, 1]) C.box(s * (w / 4 + 0.7), 0.3, L / 2 - t / 2, w / 2 - 1.4, rr(4, 7), t, K.wall);
  C.box(0, 0.3, -L / 2 + 2, 2.4, 1.0, 1.2, K.plaster);
  C.box(w / 2 + 1.8, 0.3, L / 2 - 2, 3.4, 11, 3.4, K.wall); // bell tower stump
  C.loot(0, 1.3, -L / 2 + 2, 'iron', [[0, L / 2 + 3], [0, L / 2 - 2]], 'chest', 0);
  for (let k = 0; k < 14; k++) { const gx = -15 + (k % 7) * 2.2, gz = 10 + Math.floor(k / 7) * 2.4; F.box(gx, -0.2, gz, 0.7, rr(0.8, 1.2), 0.2, K.rough, { block: true, chip: 0.12, rx: rr(-0.12, 0.12), solid: false }); }
  F.loot(0, 0, 14, 'floor', [], 'item'); F.loot(12, 0, 2, 'floor', [], 'item');
}

// Elderwood Lodge: a hunter's lodge in the deep forest, a camp with tents and a fire pit
function elder(W, S) {
  const K = mats(), F = new Frame(W, S.x, S.h, S.z, faceCentre(S));
  house(F.sub(0, 0, -5, 0), 8.5, 6.5, { roof: K.roofs[3], wall: K.plank, chimney: 1, loot: 'iron' });
  for (const [lx, lz, a] of [[-8, 5, 0.6], [8, 6, -0.7]]) {
    const T = F.sub(lx, 0, lz, a), g = new THREE.CylinderGeometry(0.01, 2.0, 2.4, 3, 1, true); g.rotateY(Math.PI / 6); tintGeo(g, rng, 0.08);
    T.put(g, pickR(K.cloths), 0, 1.2, 0); T.obst(0, 0, 1.4, 2.4);
  }
  for (let k = 0; k < 8; k++) { const a = (k / 8) * TAU; F.put(tintGeo(stoneBlock(0.5, 0.35, 0.4, rng, { chip: 0.14, seg: 1 }), rng), K.rough, Math.sin(a) * 1.0, 0.15, 4 + Math.cos(a) * 1.0, a); }
  for (let k = 0; k < 3; k++) F.put(new THREE.CylinderGeometry(0.18, 0.18, 2.2, 8), K.timber, 0, 0.3 + k * 0.06, 4, k * 1.1, 0, Math.PI / 2 - 0.2);
  const ember = new THREE.Mesh(new THREE.IcosahedronGeometry(0.45, 1), toon(0xff7a2a, { emissive: 0xff5a10, emissiveIntensity: 1.5 })); const [ex, ez] = F.at(0, 4); ember.position.set(ex, S.h + 0.25, ez); ember.scale.y = 0.5; W.scene.add(ember);
  W.anim.push(() => { ember.material.emissiveIntensity = 1.2 + Math.sin(TIME.value * 9) * 0.3 + Math.sin(TIME.value * 23) * 0.2; });
  W.fires = [...(W.fires || []), ember.position];
  for (let k = 0; k < 4; k++) { const a = rr(0, TAU); F.put(new THREE.CylinderGeometry(0.3, 0.3, 3.5, 8), K.timber, 5 + k * 0.1, 0.3 + k * 0.5, -1, a, 0, Math.PI / 2); }
  F.obst(5, -1, 1.6, 1.6);
  F.loot(-4, 0, 4, 'floor', [], 'item');
}

// coastal watchtowers: square stone towers (a prize on top for rune users) with a lean-to camp and a chest at the foot
function watchtower(W, x, z, yaw) {
  const K = mats(), y = W.gridH(x, z), F = new Frame(W, x, y, z, yaw), h = 13;
  F.box(0, -2, 0, 5.4, h + 2, 5.4, K.wall, { tint: 0.05 });
  F.box(0, h - 0.4, 0, 6.2, 0.5, 6.2, K.wallDark);
  for (const [x0, z0, x1, z1] of [[-3, -2.8, 3, -2.8], [-3, 2.8, 3, 2.8], [-2.8, -2, -2.8, 2], [2.8, -2, 2.8, 2]]) merlons(F, x0, z0, x1, z1, h + 0.1, K.wall, 1.5, [0.8, 1.0, 0.55]);
  for (const yy of [4, 9]) F.box(0, yy, 2.72, 0.4, 1.4, 0.1, K.glass, { solid: false });
  F.loot(0, h + 0.1, 0, 'iron', [], 'item');
  const L = F.sub(5.5, 0, 1.5, 0), gy = W.gridH(...L.at(0, 0));
  L.y = gy;
  for (const sx of [-1, 1]) L.box(sx * 1.5, -0.3, 1.2, 0.18, 2.6, 0.18, K.timber, { solid: false });
  L.box(0, 2.1, 0.3, 3.6, 0.12, 2.4, pickR(K.cloths), { solid: false, rx: 0.35 });
  L.loot(0, 0, -0.2, 'chest', [[0, 3]]);
  banner(F, -3.6, 3.6, 0, pickR([0x2b4a9a, 0x9a2b3c, 0x2f7a4a]), 6);
}

// broken walls across the uplands: cover for the long crossings between landmarks
function ruinWalls(W) {
  const K = mats();
  for (let i = 0, tries = 0; i < 26 && tries < 600; tries++) {
    const a = rng() * TAU, r = 140 + rng() * 180, x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (W.gridH(x, z) < SEA_Y + 1.5 || W.gridUp(x, z) < 0.9 || onRoad(x, z, 5) || siteAt(x, z, 10) || W.blocked(x, z, 5)) continue;
    i++;
    const F = new Frame(W, x, W.gridH(x, z) - 0.15, z, rng() * TAU), L = rr(5, 9);
    for (let u = -L / 2; u < L / 2; u += 1.2) { const h = rr(0.8, 2.6); F.box(u + 0.6, 0, 0, 1.18, h, 0.8, K.rough, { block: true, chip: 0.1, tint: 0.14 }); }
    if (rng() < 0.5) for (let u = 0; u < rr(2, 5); u += 1.2) F.box(L / 2 - 0.4, 0, u + 1, 0.8, rr(0.8, 2.2), 1.18, K.rough, { block: true, chip: 0.1, tint: 0.14 });
    if (rng() < 0.5) F.loot(0, 0, 1.6, 'floor', [], 'item');
  }
}

export function buildLands(W) {
  rng = mulberry32(2024);
  const S = Object.fromEntries(SITES.map((s) => [s.id, s]));
  castle(W, S.castle); village(W, S.village); colosseum(W, S.colosseum); spire(W, S.spire); lake(W, S.lake);
  henge(W, S.henge); farm(W, S.farm); hollow(W, S.hollow); elder(W, S.elder);
  for (const a of [0.42, 1.2, 2.0, 2.72, 3.55, 4.3, 5.08, 5.9]) {
    for (let r = ISLAND_R - 38; r > 240; r -= 6) {
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (W.gridH(x, z) > SEA_Y + 3 && W.gridUp(x, z) > 0.9 && !siteAt(x, z, 12)) { watchtower(W, x, z, Math.atan2(-x, -z)); break; }
    }
  }
  ruinWalls(W);
}
