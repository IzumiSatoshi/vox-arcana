// Shader warm-up: the first cast of each spell form used to compile its programs mid-fight (a 50-500 ms hitch).
// This casts every form × element × grade in an invisible sandbox (own scene, FX, world colliders, dummy caster,
// no targets, no audio/HUD) and compiles whatever materials appear against the real scene's lights and fog.
// main.js keeps compiled programs alive after their materials are disposed, so real casts then reuse them.
import * as THREE from 'three';
import { SpellSystem } from './spells.js';
import { Combatant } from './combat.js';
import { finalizeSpec, localParse } from './spellbook.js';
import { SHAPES, ELEMENT_KEYS } from './elements.js';

const noop = new Proxy(function () {}, { get: (_, k) => (k === Symbol.toPrimitive ? undefined : noop), apply: () => noop });
const nullPool = { emit() {}, update() {} };
const STEP = 1 / 10, SIM = 3; // seconds simulated per cast: long enough for projectiles to land and explode

function sandbox(g) {
  const scene = new THREE.Scene();
  const world = Object.create(g.world, { boxes: { value: [], writable: true }, obstacles: { value: [...g.world.obstacles], writable: true }, gusts: { value: [], writable: true } });
  const fx = Object.assign(Object.create(g.fx), {
    scene, world, items: [], attractors: [], decals: [], shake: 0, distortScene: new THREE.Scene(),
    glow: nullPool, smoke: nullPool, sparks: nullPool, lights: { request() {}, flush() {} },
  });
  const sg = Object.assign(Object.create(g), {
    scene, fx, world, combatants: [], bots: [], audio: noop, hud: noop,
    screenFlash() {}, onHeal() {}, onEnhance() {}, domain() {},
  });
  sg.spells = new SpellSystem(sg);
  const caster = new Combatant({ id: 'warmup', name: '', isPlayer: true });
  caster.pos.set(0, world.heightAt(0, 20), 20);
  const origin = caster.eye(new THREE.Vector3()), dir = new THREE.Vector3(0, -0.25, -1).normalize();
  const aim = { origin, dir, point: origin.clone().addScaledVector(dir, 12) };
  caster.getAim = () => aim;
  return { sg, fx, scene, caster };
}

export async function warmSpellShaders(g, { budgetMs = 6, onProgress = () => {} } = {}) {
  const { sg, fx, scene, caster } = sandbox(g), r = g.renderer;
  // Program keys depend on the bound target (screen = tone-mapped sRGB, targets = linear) and on the light count:
  // the first-person hands carry a point light that is hidden in the menu and while dead. Compile as the post stack
  // renders, for both light counts, so no state the player reaches needs a new program.
  const vm = g.viewModel.group, drawn = new Set(), seen = new WeakSet();
  const hasNewMaterial = () => {
    let fresh = false;
    for (const s of [scene, fx.distortScene]) s.traverse((o) => { for (const m of [o.material].flat()) if (m && !seen.has(m)) { seen.add(m); fresh = true; } });
    return fresh;
  };
  const compile = (s = scene) => {
    if (s === scene && !hasNewMaterial()) return; // most sim steps add nothing; compile() itself is not free
    const prev = r.getRenderTarget(), vis = vm.visible;
    try {
      r.setRenderTarget(g.post.composer.readBuffer);
      for (const v of [true, false]) { vm.visible = v; r.compile(s, g.camera, g.scene); }
      if (s === scene && fx.distortScene.children.length) r.compile(fx.distortScene, g.camera);
    } finally { vm.visible = vis; r.setRenderTarget(prev); }
    if (s === scene) drawNew();
  };
  // ANGLE (Chrome on Windows) finishes the D3D shader for a program on its first draw, not at compile time, so a
  // compiled-but-never-drawn program still hitches once. Draw each new program off-screen into the scene target:
  // the sandbox is parented under the real scene (for its lights and fog) on a private layer the camera alone sees.
  const LAYER = 31;
  const drawNew = () => {
    let fresh = false;
    scene.traverse((o) => {
      for (const m of [o.material].flat()) {
        const id = m && r.properties.get(m).currentProgram?.id;
        if (id !== undefined && !drawn.has(id)) { drawn.add(id); fresh = true; }
      }
    });
    if (!fresh) return;
    const cam = g.camera, camMask = cam.layers.mask, auto = r.shadowMap.autoUpdate, prev = r.getRenderTarget(), vis = vm.visible, lights = [];
    g.scene.traverse((o) => { if (o.isLight) { lights.push([o, o.layers.mask]); o.layers.enable(LAYER); } });
    for (const s of [scene, fx.distortScene]) s.traverse((o) => { o.layers.set(LAYER); o.frustumCulled = false; });
    g.scene.add(scene); cam.layers.set(LAYER); r.shadowMap.autoUpdate = false;
    try {
      r.setRenderTarget(g.post.composer.passes[0].target || g.post.composer.readBuffer); // overwritten by the next frame
      for (const v of [true, false]) { vm.visible = v; r.render(g.scene, cam); }
      if (fx.distortScene.children.length) { r.setRenderTarget(g.post.distortRT); r.render(fx.distortScene, cam); }
    } finally {
      g.scene.remove(scene); cam.layers.mask = camMask; r.shadowMap.autoUpdate = auto; vm.visible = vis; r.setRenderTarget(prev);
      for (const [o, mask] of lights) o.layers.mask = mask;
    }
  };
  // the arena itself, lit as in a match (hands and their light shown): compile, then draw once for the same reason
  compile(g.scene);
  { const prev = r.getRenderTarget(), vis = vm.visible;
    try {
      vm.visible = true;
      r.setRenderTarget(g.post.composer.passes[0].target || g.post.composer.readBuffer); r.render(g.scene, g.camera);
    } finally { vm.visible = vis; r.setRenderTarget(prev); } }
  const jobs = [];
  // every form first, so the most common programs are ready within the first seconds
  for (const power of [0.45, 1]) for (const element of ELEMENT_KEYS) for (const shape of Object.keys(SHAPES)) jobs.push({ shape, element, power });
  const p0 = r.info.programs.length, t0 = performance.now();
  let sliceStart = performance.now(), completed = 0;
  const failures = [];
  onProgress(0, jobs.length + 1);
  const yieldIfDue = async () => { if (performance.now() - sliceStart > budgetMs) { await new Promise((res) => setTimeout(res)); sliceStart = performance.now(); } };
  for (const { shape, element, power } of jobs) {
    try {
      const spec = finalizeSpec({ text: `${element} ${shape}`, element, shape, power, tier: power, speed: 0.5, size: 0.5, temperature: localParse(element).temperature, weight: 0.4, sharpness: 0.5, count: 0.4, duration: 0.5, chaos: 0.3, homing: 0.2, isSpell: 1, source: 'local', seed: 1 }); // one seed: magic circles are drawn once, not per job
      caster.resetStats(); caster.channeling = false;
      sg.spells.cast(spec, caster);
      compile();
      for (let t = 0; t < SIM && (sg.spells.active.length || fx.items.length); t += STEP) {
        sg.spells.update(STEP); fx.update(STEP); compile();
        await yieldIfDue();
      }
    } catch (e) { failures.push(e); console.warn('shader warm-up:', shape, element, e); }
    sg.spells.clear(); fx.clear();
    onProgress(++completed, jobs.length + 1);
    await yieldIfDue();
  }
  if (failures.length) throw new AggregateError(failures, 'Spell preparation failed');
  // Exercise the complete post stack and particle pools with the first-person light enabled.
  const visible = vm.visible;
  try { vm.visible = true; g.post.render(0); }
  finally { vm.visible = visible; }
  await waitForGPU(r);
  onProgress(jobs.length + 1, jobs.length + 1);
  return { casts: jobs.length, programs: r.info.programs.length - p0, ms: Math.round(performance.now() - t0) };
}

// Submitting draws is not completion: keep their GPU work behind the loading screen too.
export async function waitForGPU(renderer) {
  const gl = renderer.getContext();
  if (gl.isContextLost()) throw new Error('Graphics context lost during preparation');
  const fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
  if (!fence) throw new Error('Could not finish graphics preparation');
  gl.flush();
  const start = performance.now();
  try {
    for (;;) {
      const status = gl.clientWaitSync(fence, 0, 0);
      if (status === gl.ALREADY_SIGNALED || status === gl.CONDITION_SATISFIED) return;
      if (status === gl.WAIT_FAILED || gl.isContextLost() || performance.now() - start > 30000) {
        throw new Error('Graphics preparation did not complete');
      }
      await new Promise(resolve => setTimeout(resolve, 16));
    }
  } finally { gl.deleteSync(fence); }
}
