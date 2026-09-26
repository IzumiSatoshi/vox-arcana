import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { VRMLoaderPlugin, VRMHumanoid, VRMUtils, VRMNodeConstraintManager } from '@pixiv/three-vrm';
import { toon } from './world.js';
import { addOutline, TIME } from './shaders.js';

// ------------------------------------------------------------------ anime mage (VRM)
// One VRM is loaded once; every mage clones its scene and gets its own normalized humanoid rig. Poses are written in
// VRM normalized space: the model faces +Z, identity rotations are a T-pose, left arm along +X. The rig root is turned
// half a revolution so the mage faces -Z like the rest of the game.
export const ANIME_MAGE_URL = 'models/mage.vrm';
const HEIGHT = 1.62; // eye line sits near the procedural mage's, under the hat
let template = null, loading = null;

export function loadAnimeMage(url = ANIME_MAGE_URL) {
  if (!loading) {
    const loader = new GLTFLoader(); loader.register((p) => new VRMLoaderPlugin(p));
    loading = loader.loadAsync(url).then((gltf) => {
      const vrm = gltf.userData.vrm;
      if (!vrm?.humanoid) throw new Error('not a VRM humanoid');
      if (vrm.meta?.metaVersion === '0') throw new Error('VRM 0.x is not supported; export VRM 1.0 from VRoid Studio');
      VRMUtils.removeUnnecessaryVertices(gltf.scene);
      vrm.scene.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(vrm.scene);
      const bones = {}; // humanoid bone name -> raw node name, re-found in each clone
      for (const [name, b] of Object.entries(vrm.humanoid.humanBones)) if (b?.node) bones[name] = b.node.name;
      const expr = {}; // preset -> [{ mesh name, morph index, weight }]
      for (const e of vrm.expressionManager?.expressions || []) {
        const binds = [];
        for (const b of e.binds || []) for (const p of b.primitives || []) if (b.index != null) binds.push({ mesh: p.name, index: b.index, weight: b.weight ?? 1 });
        if (binds.length) expr[e.expressionName] = binds;
      }
      // node constraints (twist bones that keep sleeves and wrists from candy-wrapping), rebuilt per clone by node name
      const constraints = [...(vrm.nodeConstraintManager?.constraints || [])].map((c) => ({ Ctor: c.constructor, dst: c.destination.name, src: c.source.name, weight: c.weight, rollAxis: c.rollAxis, aimAxis: c.aimAxis }));
      template = { scene: vrm.scene, bones, expr, constraints, scale: HEIGHT / Math.max(0.5, box.max.y - box.min.y) };
      return template;
    });
    loading.catch((e) => console.warn('Anime mage model unavailable; using the classic mage.', e));
  }
  return loading;
}
export const animeMageReady = () => template;

const lathe = (pts, seg = 32) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg);
const _e = new THREE.Euler(), _v = new THREE.Vector3();

export class AnimeRig {
  constructor(tpl, { trim = 0xe0b95a, accent = 0xff4a6a, hat = 0x1d1838 } = {}, glowMat) {
    this.root = new THREE.Group();
    const scene = (this.scene = SkeletonUtils.clone(tpl.scene));
    // own materials so hit flash stays per mage
    this.flashMats = []; const seen = new Map();
    scene.traverse((m) => {
      if (!m.isMesh) return;
      m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; // skinned bounds don't follow the pose
      const own = (mat) => { if (!seen.has(mat)) { const c = mat.clone(); seen.set(mat, c); if (c.emissive) this.flashMats.push({ m: c, base: c.emissive.clone() }); } return seen.get(mat); };
      m.material = Array.isArray(m.material) ? m.material.map(own) : own(m.material);
    });
    const raw = {};
    for (const [name, node] of Object.entries(tpl.bones)) { const n = scene.getObjectByName(node); if (n) raw[name] = { node: n }; }
    scene.updateMatrixWorld(true); // the normalized rig is built from the rest pose in the clone's own frame…
    this.humanoid = new VRMHumanoid(raw);
    scene.add(this.humanoid.normalizedHumanBonesRoot);
    if (tpl.constraints.length) {
      this.constraints = new VRMNodeConstraintManager();
      for (const c of tpl.constraints) {
        const dst = scene.getObjectByName(c.dst), src = scene.getObjectByName(c.src); if (!dst || !src) continue;
        const k = new c.Ctor(dst, src); k.weight = c.weight; if (c.rollAxis) k.rollAxis = c.rollAxis; if (c.aimAxis) k.aimAxis = c.aimAxis;
        this.constraints.addConstraint(k);
      }
      this.constraints.setInitState();
    }
    scene.rotation.y = Math.PI; scene.scale.setScalar(tpl.scale); this.root.add(scene); // …so turn and scale it only after
    this.bone = (n) => this.humanoid.getNormalizedBoneNode(n);
    this.morphs = {};
    for (const [name, binds] of Object.entries(tpl.expr)) {
      const list = [];
      for (const b of binds) { const m = scene.getObjectByName(b.mesh); if (m?.morphTargetInfluences) list.push({ m, i: b.index, w: b.weight }); }
      if (list.length) this.morphs[name] = list;
    }
    this.blinkT = 2 + Math.random() * 3; this.blink = 0; this.mouth = 0; this.hurt = 0;
    const inv = 1 / tpl.scale; // accessories hang off normalized bones, so they live in the model's own units
    // witch hat: wide drooping brim, crown bent back at the tip (the mage silhouette)
    const hatC = new THREE.Color(hat).lerp(new THREE.Color(0xffffff), 0.1), trimM = toon(trim, { emissive: new THREE.Color(trim).multiplyScalar(0.12) });
    const hood = toon(hatC), hatG = new THREE.Group();
    const brimGeo = lathe([[0.4, -0.04], [0.34, -0.018], [0.25, 0.004], [0.16, 0.012], [0.115, 0.014]], 40);
    { const P = brimGeo.attributes.position; for (let i = 0; i < P.count; i++) { const a = Math.atan2(P.getX(i), P.getZ(i)), r = Math.hypot(P.getX(i), P.getZ(i)); P.setY(i, P.getY(i) - Math.max(0, -Math.cos(a)) * (r - 0.115) * 0.18 + Math.sin(a * 3) * 0.008 * r); } brimGeo.computeVertexNormals(); }
    hatG.add(new THREE.Mesh(brimGeo, hood), new THREE.Mesh(brimGeo, toon(hatC.clone().multiplyScalar(0.7), { side: THREE.BackSide })));
    const crownGeo = lathe([[0.125, 0], [0.12, 0.08], [0.1, 0.18], [0.072, 0.3], [0.044, 0.42], [0.02, 0.52], [0, 0.58]], 28);
    { const P = crownGeo.attributes.position; for (let i = 0; i < P.count; i++) { const y = P.getY(i), k = Math.max(0, y - 0.18); P.setZ(i, P.getZ(i) - k * k * 1.3); P.setY(i, y - k * k * 0.35); } crownGeo.computeVertexNormals(); }
    const crown = new THREE.Mesh(crownGeo, hood); hatG.add(crown); addOutline(crown, 0.01);
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.122, 0.018, 8, 36), trimM); band.rotation.x = Math.PI / 2; band.position.y = 0.03; hatG.add(band);
    const charm = new THREE.Mesh(new THREE.OctahedronGeometry(0.028, 0), glowMat); charm.position.set(-0.08, 0.05, 0.1); hatG.add(charm);
    hatG.scale.setScalar(inv * 0.92); hatG.position.set(0, 0.155 * inv, -0.01 * inv); hatG.rotation.x = -0.12; this.bone('head')?.add(hatG);
    this.hat = hatG;
    // staff in the right hand; spells leave from its focus
    const staff = new THREE.Group(), wood = toon(0x5a3a24);
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.022, 1.5, 8), wood); shaft.position.y = 0.3; staff.add(shaft); addOutline(shaft, 0.008);
    const crook = new THREE.Mesh(new THREE.TorusGeometry(0.065, 0.011, 6, 20, Math.PI * 1.5), trimM); crook.position.y = 1.1; crook.rotation.z = -Math.PI * 0.25; staff.add(crook);
    const focus = (this.staffTip = new THREE.Mesh(new THREE.OctahedronGeometry(0.042, 0), glowMat)); focus.scale.y = 1.6; focus.position.y = 1.1; staff.add(focus);
    staff.scale.setScalar(inv); staff.position.set(-0.06 * inv, -0.015 * inv, 0.01 * inv);
    staff.rotation.set(0, 0, -Math.PI / 2 + 0.4); // staff up along the hand's +X, which points up when the arm hangs
    this.bone('rightHand')?.add(staff); this.staff = staff;
    // short cape from the shoulders, fluttering like the classic coat's
    const capeGeo = new THREE.PlaneGeometry(0.46, 0.95, 6, 12); capeGeo.translate(0, -0.475, 0);
    { const P = capeGeo.attributes.position; for (let i = 0; i < P.count; i++) { const x = P.getX(i), y = P.getY(i), t = -y / 0.95; P.setX(i, x * (0.8 + t * 0.55)); if (t > 0.99) P.setY(i, y + (Math.abs(Math.round(x / 0.0766)) % 2) * 0.08); } }
    this.capeBase = capeGeo.attributes.position.array.slice();
    this.cape = new THREE.Mesh(capeGeo, toon(new THREE.Color(accent).multiplyScalar(0.9), { side: THREE.DoubleSide }));
    this.cape.castShadow = true; this.cape.scale.setScalar(inv); this.cape.position.set(0, 0.14 * inv, -0.11 * inv);
    (this.bone('upperChest') || this.bone('chest'))?.add(this.cape);
    this.hat.traverse((m) => { if (m.isMesh) m.castShadow = true; });
    for (const mat of [hood, trimM, wood, this.cape.material]) this.flashMats.push({ m: mat, base: mat.emissive.clone() });
    this.frame = 0;
  }
  setMorph(name, v) { for (const b of this.morphs[name] || []) b.m.morphTargetInfluences[b.i] = v * b.w; }
  setFlash(k, color) { for (const f of this.flashMats) f.m.emissive.copy(f.base).lerp(color, k); }
  rot(name, x, y, z) { const b = this.bone(name); if (b) b.quaternion.setFromEuler(_e.set(x, y, z, 'XYZ')); }
  // walk: gait phase, sp: 0..1 run blend, chant: 0..1, cast: 0..1 flick, pitch: look up (+) / down (-)
  pose(dt, { walk, sp, chant, cast, pitch, hit, skip }) {
    const t = TIME.value;
    // face: blink, a determined brow while chanting, lip-flap on the incantation, a wince on hits
    this.blinkT -= dt; if (this.blinkT < 0) { this.blink = 1; this.blinkT = 2.5 + Math.random() * 3.5; }
    this.blink = Math.max(0, this.blink - dt * 7);
    this.hurt = Math.max(this.hurt - dt * 2.5, hit);
    this.mouth += ((chant > 0.3 ? 0.35 + 0.45 * Math.abs(Math.sin(t * 11) * Math.sin(t * 7.3)) : 0) - this.mouth) * Math.min(1, dt * 18);
    if (skip) return; // far mages hold the last pose for a frame
    this.setMorph('blink', Math.max(Math.sin(this.blink * Math.PI), this.hurt * 0.8));
    this.setMorph('aa', this.mouth); this.setMorph('angry', Math.min(1, chant * 0.6 + this.hurt * 0.4));
    const w = walk, idle = Math.sin(t * 2) * 0.02;
    for (const s of [1, -1]) { // s: +1 left (+X), -1 right
      const side = s > 0 ? 'left' : 'right', ph = w + (s > 0 ? 0 : Math.PI);
      this.rot(`${side}UpperLeg`, -Math.sin(ph) * 0.6 * sp, 0, 0);
      this.rot(`${side}LowerLeg`, Math.max(0, Math.sin(ph - 1.2)) * 1.0 * sp, 0, 0);
      this.rot(`${side}Foot`, -Math.max(0, Math.sin(ph - 1.2)) * 0.3 * sp, 0, 0);
      const swing = Math.sin(w + (s > 0 ? Math.PI : 0)) * 0.55 * sp, castR = s < 0 ? cast : 0;
      const fwd = swing * (1 - chant) + chant * 1.15 + castR * 1.3; // arm forward
      this.rot(`${side}UpperArm`, -fwd, 0, -s * (1.22 - idle + chant * 0.3));
      this.rot(`${side}LowerArm`, 0, -s * (0.25 + chant * 0.55 - castR * 0.2), 0);
      this.rot(`${side}Hand`, 0, 0, -s * chant * 0.3);
    }
    this.rot('spine', 0.1 * sp + chant * 0.05 - cast * 0.08, 0, 0);
    this.rot('chest', idle * 0.5, -chant * 0.12, 0);
    this.rot('neck', -pitch * 0.25, 0, 0);
    this.rot('head', -pitch * 0.3, 0, 0);
    this.scene.position.y = Math.abs(Math.sin(w)) * 0.04 * sp - sp * 0.02;
    this.humanoid.update(); this.constraints?.update();
    const cp = this.cape.geometry.attributes.position;
    for (let i = 0; i < cp.count; i++) { const y = this.capeBase[i * 3 + 1], x = this.capeBase[i * 3]; cp.setZ(i, this.capeBase[i * 3 + 2] - Math.sin(t * 4 + y * 4 + x * 3) * 0.04 * -y - -y * 0.35 * sp); }
    cp.needsUpdate = true;
  }
  tipWorld(out = _v) { return this.staffTip.getWorldPosition(out); }
}
