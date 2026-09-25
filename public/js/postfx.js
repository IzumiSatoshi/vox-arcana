// Post stack: MSAA HDR render -> ambient occlusion (high quality) -> bloom -> distortion + cinematic grade -> output (ACES + sRGB)
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { CopyShader } from 'three/addons/shaders/CopyShader.js';
import { SUN_DIR } from './world.js';

// Only scene geometry needs MSAA. Resolve it before the single-sample post stack.
class ScenePass extends RenderPass {
  constructor(scene, camera, samples) {
    super(scene, camera);
    this.target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples });
    this.copy = new ShaderPass(CopyShader);
    this.copy.material.blending = THREE.NoBlending;
    this.copy.material.depthTest = this.copy.material.depthWrite = false;
  }
  setSize(w, h) { this.target.setSize(w, h); }
  render(renderer, writeBuffer, readBuffer) {
    super.render(renderer, writeBuffer, this.target);
    this.copy.render(renderer, readBuffer, this.target);
  }
  dispose() { this.target.dispose(); this.copy.dispose(); }
}

// Sun shafts: at quarter resolution, march from each pixel toward the sun's screen position accumulating open sky
// (from the AO pass's depth buffer, so ruins, cliffs and tree crowns cut dark bands through the light). Composited in the grade.
const ShaftShader = {
  uniforms: { tDepth: { value: null }, uSun: { value: new THREE.Vector2(0.5, 0.5) }, uAspect: { value: 1 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.0,1.0); }',
  fragmentShader: /* glsl */ `
    uniform sampler2D tDepth; uniform vec2 uSun; uniform float uAspect; varying vec2 vUv;
    float src(vec2 uv){
      if(uv.x<0.0||uv.y<0.0||uv.x>1.0||uv.y>1.0) return 0.0;
      float sky=step(0.99999,texture2D(tDepth,uv).x);
      vec2 d=(uv-uSun)*vec2(uAspect,1.0);
      return sky*(0.25+0.75*exp(-dot(d,d)*18.0));
    }
    void main(){
      vec2 delta=(vUv-uSun)*(0.85/28.0);
      vec2 uv=vUv; float s=0.0, w=1.0, ws=0.0;
      for(int i=0;i<28;i++){ s+=src(uv)*w; ws+=w; w*=0.96; uv-=delta; }
      vec2 d=(vUv-uSun)*vec2(uAspect,1.0);
      gl_FragColor=vec4(s/ws*exp(-length(d)*1.6),0.0,0.0,1.0);
    }`,
};
class ShaftPass {
  constructor(depthTexture) {
    this.enabled = true; this.needsSwap = false; this.clear = false; this.renderToScreen = false;
    this.rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
    this.mat = new THREE.ShaderMaterial({ ...ShaftShader, uniforms: THREE.UniformsUtils.clone(ShaftShader.uniforms), depthTest: false, depthWrite: false });
    this.mat.uniforms.tDepth.value = depthTexture;
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat); this.quad.frustumCulled = false;
    this.scene = new THREE.Scene(); this.scene.add(this.quad); this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.strength = 0;
  }
  setSize(w, h) { this.rt.setSize(Math.max(1, w >> 2), Math.max(1, h >> 2)); this.mat.uniforms.uAspect.value = w / Math.max(1, h); }
  render(renderer) {
    if (this.strength <= 0.001) return;
    const prev = renderer.getRenderTarget(); renderer.setRenderTarget(this.rt); renderer.render(this.scene, this.cam); renderer.setRenderTarget(prev);
  }
  dispose() { this.rt.dispose(); this.mat.dispose(); }
}

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null }, tDistort: { value: null }, uCA: { value: 0 }, uVig: { value: 0.45 }, uSat: { value: 1.06 },
    uTint: { value: new THREE.Vector3(1, 1, 1) }, uTime: { value: 0 }, uGrain: { value: 0 }, uContrast: { value: 1.04 },
    tShafts: { value: null }, uShaft: { value: 0 }, uShaftCol: { value: new THREE.Vector3(1.0, 0.86, 0.62) },
    uTexel: { value: new THREE.Vector2(1 / 1280, 1 / 720) }, uSharp: { value: 0.6 },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);} ',
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse, tDistort, tShafts; uniform float uCA,uVig,uSat,uTime,uGrain,uContrast,uShaft,uSharp; uniform vec3 uTint,uShaftCol; uniform vec2 uTexel; varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453); }
    void main(){
      vec2 uv=vUv+texture2D(tDistort,vUv).xy;
      vec2 d=uv-0.5; float r=length(d); vec2 off=d*uCA*0.02*r;
      vec3 c=vec3(texture2D(tDiffuse,uv+off).r, texture2D(tDiffuse,uv).g, texture2D(tDiffuse,uv-off).b);
      // contrast-adaptive sharpen (CAS-lite): crisper cel edges and grass after MSAA resolve, limited to the local range
      if(uSharp>0.0){
        vec3 n=texture2D(tDiffuse,uv+vec2(0.0,uTexel.y)).rgb, s=texture2D(tDiffuse,uv-vec2(0.0,uTexel.y)).rgb;
        vec3 e=texture2D(tDiffuse,uv+vec2(uTexel.x,0.0)).rgb, w=texture2D(tDiffuse,uv-vec2(uTexel.x,0.0)).rgb;
        vec3 mn=min(min(min(n,s),min(e,w)),c), mx=max(max(max(n,s),max(e,w)),c);
        vec3 amp=sqrt(clamp(min(mn,2.0-mx)/max(mx,1e-3),0.0,1.0));
        vec3 wgt=-amp*uSharp*0.2;
        c=clamp((c+(n+s+e+w)*wgt)/(1.0+4.0*wgt),mn,mx);
      }
      if(uShaft>0.0) c+=uShaftCol*texture2D(tShafts,vUv).r*uShaft;
      // split toning: cool shadows, warm highlights (gentle: the materials already carry coloured shadows)
      float l=dot(c,vec3(0.2126,0.7152,0.0722));
      vec3 shadowTint=vec3(0.95,0.99,1.05), hiTint=vec3(1.03,1.0,0.95);
      c*=mix(shadowTint,hiTint,smoothstep(0.05,0.9,l));
      c=mix(vec3(l),c,uSat);
      c=max(vec3(0.0),(c-0.18)*uContrast+0.18);
      c*=uTint;
      c*=1.0-smoothstep(0.45,1.0,r)*0.45*uVig;
      if(uGrain>0.0) c+=(hash(vUv*vec2(1920.0,1080.0)+uTime)-0.5)*uGrain*(0.3+l);
      gl_FragColor=vec4(c,1.0);
    }`,
};

export class PostFX {
  constructor(renderer, scene, camera, distortScene, quality = 1) {
    this.renderer = renderer; this.scene = scene; this.camera = camera; this.distortScene = distortScene;
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, depthBuffer: quality <= 0 });
    this.composer = new EffectComposer(renderer, rt);
    this.composer.addPass(quality > 0 ? new ScenePass(scene, camera, 4) : new RenderPass(scene, camera));
    if (quality > 0) { // contact shadows in crevices, under blocks and around grass roots
      this.ao = new GTAOPass(scene, camera, size.x >> 1, size.y >> 1, undefined, { radius: 1.2, distanceExponent: 1.4, thickness: 1.5, scale: 1.1, samples: 8, distanceFallOff: 1 }, { lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 4, samples: 8 });
      this.ao.blendIntensity = 0.85;
      // only solid, depth-writing geometry casts AO: sky dome, cloud sprites, particles and spell glow would smear dark boxes
      const base = this.ao.overrideVisibility.bind(this.ao), restore = this.ao.restoreVisibility.bind(this.ao);
      this.ao.restoreVisibility = () => { restore(); renderer.shadowMap.autoUpdate = true; };
      this.ao.overrideVisibility = () => {
        base();
        renderer.shadowMap.autoUpdate = false; // the normal pass must not redraw the (already current) shadow map
        scene.traverse((o) => { if (o.visible && (o.isSprite || o.userData.noAO || (o.material && (o.material.transparent || o.material.depthWrite === false)))) o.visible = false; });
        scene.traverse((o) => { if (o.userData.aoOnly) o.visible = true; }); // depth stand-ins (tree crowns) that only this pass sees
      };
      this.composer.addPass(this.ao);
      this.shafts = new ShaftPass(this.ao.depthTexture);
      this.composer.addPass(this.shafts);
    }
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x >> 1, size.y >> 1), 0.36, 0.4, 1.25);
    this.composer.addPass(this.bloom);
    // Run the unchanged grade immediately before OutputPass's tone mapping/color conversion.
    this.grade = new OutputPass();
    Object.assign(this.grade.uniforms, THREE.UniformsUtils.clone(GradeShader.uniforms));
    const gradeFunction = GradeShader.fragmentShader
      .replace('uniform sampler2D tDiffuse, tDistort, tShafts;', 'uniform sampler2D tDistort, tShafts;')
      .replace('varying vec2 vUv;', '')
      .replace('void main()', 'vec4 gradedColor()')
      .replace('gl_FragColor=vec4(c,1.0);', 'return vec4(c,1.0);');
    this.grade.material.fragmentShader = this.grade.material.fragmentShader
      .replace('void main()', gradeFunction + '\nvoid main()')
      .replace('gl_FragColor = texture2D( tDiffuse, vUv );', 'gl_FragColor = gradedColor();');
    this.composer.addPass(this.grade);
    this.distortRT = new THREE.WebGLRenderTarget(Math.max(1, size.x >> 1), Math.max(1, size.y >> 1), { type: THREE.HalfFloatType });
    this.grade.uniforms.tDistort.value = this.distortRT.texture;
    if (this.shafts) this.grade.uniforms.tShafts.value = this.shafts.rt.texture;
    this._sun = new THREE.Vector3(); this._fw = new THREE.Vector3();
  }
  get uniforms() { return this.grade.uniforms; }
  setSize(w, h) {
    this.composer.setSize(w, h);
    { const b = this.renderer.getDrawingBufferSize(new THREE.Vector2()); this.grade.uniforms.uTexel.value.set(1 / Math.max(1, b.x), 1 / Math.max(1, b.y)); }
    const s = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.distortRT.setSize(Math.max(1, s.x >> 1), Math.max(1, s.y >> 1));
    this.bloom.setSize(Math.max(1, s.x >> 1), Math.max(1, s.y >> 1)); // half-res bloom looks the same and costs a quarter
    this.ao?.setSize(Math.max(1, s.x >> 1), Math.max(1, s.y >> 1));
  }
  render(t) {
    const r = this.renderer;
    r.setRenderTarget(this.distortRT);
    r.setClearColor(0x000000, 0); r.clear();
    if (this.distortScene.children.length) r.render(this.distortScene, this.camera);
    r.setRenderTarget(null);
    this.grade.uniforms.uTime.value = t % 100;
    if (this.shafts) { // only while the sun is in (or near) view
      const cam = this.camera, face = cam.getWorldDirection(this._fw).dot(SUN_DIR);
      const k = THREE.MathUtils.smoothstep(face, 0.35, 0.8);
      this._sun.copy(cam.position).addScaledVector(SUN_DIR, 1000).project(cam);
      this.shafts.mat.uniforms.uSun.value.set(this._sun.x * 0.5 + 0.5, this._sun.y * 0.5 + 0.5);
      this.shafts.strength = k; this.grade.uniforms.uShaft.value = k * 0.55;
    }
    this.composer.render();
  }
}
