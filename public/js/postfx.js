// Post stack: MSAA HDR render -> bloom -> distortion + cinematic grade -> output (ACES + sRGB)
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null }, tDistort: { value: null }, uCA: { value: 0 }, uVig: { value: 1 }, uSat: { value: 1.12 },
    uTint: { value: new THREE.Vector3(1, 1, 1) }, uTime: { value: 0 }, uGrain: { value: 0.035 }, uContrast: { value: 1.08 },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);} ',
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse, tDistort; uniform float uCA,uVig,uSat,uTime,uGrain,uContrast; uniform vec3 uTint; varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453); }
    void main(){
      vec2 uv=vUv+texture2D(tDistort,vUv).xy;
      vec2 d=uv-0.5; float r=length(d); vec2 off=d*uCA*0.02*r;
      vec3 c=vec3(texture2D(tDiffuse,uv+off).r, texture2D(tDiffuse,uv).g, texture2D(tDiffuse,uv-off).b);
      // split toning: cool shadows, warm highlights (painterly Spellbreak/Genshin grade)
      float l=dot(c,vec3(0.2126,0.7152,0.0722));
      vec3 shadowTint=vec3(0.88,0.95,1.12), hiTint=vec3(1.06,1.0,0.9);
      c*=mix(shadowTint,hiTint,smoothstep(0.05,0.9,l));
      c=mix(vec3(l),c,uSat);
      c=max(vec3(0.0),(c-0.18)*uContrast+0.18);
      c*=uTint;
      c*=1.0-smoothstep(0.45,1.0,r)*0.45*uVig;
      c+=(hash(vUv*vec2(1920.0,1080.0)+uTime)-0.5)*uGrain*(0.3+l);
      gl_FragColor=vec4(c,1.0);
    }`,
};

export class PostFX {
  constructor(renderer, scene, camera, distortScene, quality = 1) {
    this.renderer = renderer; this.scene = scene; this.camera = camera; this.distortScene = distortScene;
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: quality > 0 ? 4 : 0 });
    this.composer = new EffectComposer(renderer, rt);
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x >> 1, size.y >> 1), 0.55, 0.5, 0.95);
    this.composer.addPass(this.bloom);
    this.grade = new ShaderPass(GradeShader); this.composer.addPass(this.grade);
    this.composer.addPass(new OutputPass());
    this.distortRT = new THREE.WebGLRenderTarget(Math.max(1, size.x >> 1), Math.max(1, size.y >> 1), { type: THREE.HalfFloatType });
    this.grade.uniforms.tDistort.value = this.distortRT.texture;
  }
  get uniforms() { return this.grade.uniforms; }
  setSize(w, h) {
    this.composer.setSize(w, h);
    const s = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.distortRT.setSize(Math.max(1, s.x >> 1), Math.max(1, s.y >> 1));
    this.bloom.setSize(Math.max(1, s.x >> 1), Math.max(1, s.y >> 1)); // half-res bloom looks the same and costs a quarter
  }
  render(t) {
    const r = this.renderer;
    r.setRenderTarget(this.distortRT);
    r.setClearColor(0x000000, 0); r.clear();
    if (this.distortScene.children.length) r.render(this.distortScene, this.camera);
    r.setRenderTarget(null);
    this.grade.uniforms.uTime.value = t % 100;
    this.composer.render();
  }
}
