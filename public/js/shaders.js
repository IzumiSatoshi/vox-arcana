import * as THREE from 'three';

export const TIME = { value: 0 };

export const NOISE = /* glsl */ `
vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1.0/6.0,1.0/3.0);
  const vec4 D=vec4(0.0,0.5,1.0,2.0);
  vec3 i=floor(v+dot(v,C.yyy));
  vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz);
  vec3 l=1.0-g;
  vec3 i1=min(g.xyz,l.zxy);
  vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx;
  vec3 x2=x0-i2+C.yyy;
  vec3 x3=x0-D.yyy;
  i=mod289(i);
  vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
  float n_=0.142857142857;
  vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.0*floor(p*ns.z*ns.z);
  vec4 x_=floor(j*ns.z);
  vec4 y_=floor(j-7.0*x_);
  vec4 x=x_*ns.x+ns.yyyy;
  vec4 y=y_*ns.x+ns.yyyy;
  vec4 h=1.0-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy);
  vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.0+1.0;
  vec4 s1=floor(b1)*2.0+1.0;
  vec4 sh=-step(h,vec4(0.0));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy;
  vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x);
  vec3 p1=vec3(a0.zw,h.y);
  vec3 p2=vec3(a1.xy,h.z);
  vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;
  vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0);
  m=m*m;
  return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}
float fbm3(vec3 p){ float s=0.0,a=0.5; for(int i=0;i<4;i++){ s+=a*snoise(p); p*=2.03; a*=0.5; } return s; }
`;

const col = (c) => (c instanceof THREE.Color ? c : new THREE.Color(c));

// Glowing, noise-displaced fresnel orb. Used for projectile cores, flashes, drones, etc.
export function energyMaterial({ color, core = 0xffffff, intensity = 2.5, noiseAmp = 0.15, noiseFreq = 2.0, flow = 1.0, rimPower = 2.0, opacity = 1, additive = true, bands = 0.0 } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: TIME, uColor: { value: col(color) }, uCore: { value: col(core) }, uIntensity: { value: intensity },
      uAmp: { value: noiseAmp }, uFreq: { value: noiseFreq }, uFlow: { value: flow }, uRim: { value: rimPower },
      uOpacity: { value: opacity }, uBands: { value: bands }, uSeed: { value: Math.random() * 100 },
    },
    vertexShader: NOISE + /* glsl */ `
      uniform float uTime,uAmp,uFreq,uFlow,uSeed;
      varying vec3 vN; varying vec3 vV; varying float vNoise; varying vec3 vP;
      void main(){
        vec3 p=position;
        float n=snoise(normal*uFreq+vec3(0.0,uTime*uFlow,uSeed));
        vNoise=n;
        p+=normal*n*uAmp;
        vP=position;
        vec4 mv=modelViewMatrix*vec4(p,1.0);
        vN=normalize(normalMatrix*normal); vV=normalize(-mv.xyz);
        gl_Position=projectionMatrix*mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor,uCore; uniform float uIntensity,uRim,uOpacity,uBands,uTime;
      varying vec3 vN; varying vec3 vV; varying float vNoise; varying vec3 vP;
      void main(){
        float f=pow(1.0-abs(dot(normalize(vN),normalize(vV))),uRim);
        float inner=1.0-f;
        vec3 c=mix(uColor,uCore,smoothstep(0.35,1.0,inner)*0.85+vNoise*0.15);
        float b=uBands>0.0? 0.6+0.4*sin(vP.y*uBands*10.0-uTime*6.0+vNoise*3.0):1.0;
        float a=clamp(0.35+f*1.2+vNoise*0.2,0.0,1.0)*uOpacity;
        gl_FragColor=vec4(c*uIntensity*b*(0.6+f*1.2),a);
      }`,
    transparent: true, depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
}

// Solid-looking crystalline / rock material with glowing cracks (meteor rock, spikes, shards).
export function crystalMaterial({ color, glow, emissive = 1.6, crack = 0.5, rough = false } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: TIME, uColor: { value: col(color) }, uGlow: { value: col(glow) }, uEm: { value: emissive }, uCrack: { value: crack }, uRough: { value: rough ? 1 : 0 }, uFade: { value: 1 } },
    vertexShader: /* glsl */ `
      varying vec3 vN; varying vec3 vV; varying vec3 vP;
      void main(){ vP=position; vec4 mv=modelViewMatrix*vec4(position,1.0); vN=normalize(normalMatrix*normal); vV=normalize(-mv.xyz); gl_Position=projectionMatrix*mv; }`,
    fragmentShader: NOISE + /* glsl */ `
      uniform vec3 uColor,uGlow; uniform float uEm,uCrack,uTime,uRough,uFade;
      varying vec3 vN; varying vec3 vV; varying vec3 vP;
      void main(){
        vec3 n=normalize(vN); vec3 v=normalize(vV);
        vec3 L=normalize(vec3(0.4,0.8,0.3));
        float diff=max(dot(n,L),0.0)*0.7+0.3;
        float f=pow(1.0-max(dot(n,v),0.0),2.5);
        float cr=abs(snoise(vP*3.0+uTime*0.3));
        float crack=smoothstep(uCrack*0.25,0.0,cr);
        vec3 base=uColor*diff;
        if(uRough<0.5) base+=uGlow*f*0.9;
        vec3 c=base+uGlow*crack*uEm+uGlow*f*uEm*0.4;
        gl_FragColor=vec4(c,uFade);
      }`,
    transparent: true,
  });
}

// Expanding ground/air shockwave ring (plane geometry, uv based).
export function ringMaterial({ color, intensity = 3, thickness = 0.12 } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: col(color) }, uProg: { value: 0 }, uAlpha: { value: 1 }, uI: { value: intensity }, uThick: { value: thickness }, uTime: TIME },
    vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);} `,
    fragmentShader: NOISE + /* glsl */ `
      uniform vec3 uColor; uniform float uProg,uAlpha,uI,uThick,uTime; varying vec2 vUv;
      void main(){
        vec2 d=vUv-0.5; float r=length(d)*2.0;
        float ang=atan(d.y,d.x);
        float n=snoise(vec3(ang*3.0,r*4.0,uTime*2.0))*0.5+0.5;
        float band=smoothstep(uThick,0.0,abs(r-uProg))*(0.6+0.6*n);
        float fill=smoothstep(uProg,0.0,r)*0.12*(1.0-uProg);
        float a=(band+fill)*uAlpha;
        if(a<0.002) discard;
        gl_FragColor=vec4(uColor*uI*a,a);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
}

// Scrolling energy for beams and tornados (cylinder uv).
export function flowMaterial({ color, core = 0xffffff, intensity = 3, scroll = 3, twist = 0, stripes = 6, softEdge = true, opacity = 1 } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: TIME, uColor: { value: col(color) }, uCore: { value: col(core) }, uI: { value: intensity }, uScroll: { value: scroll }, uTwist: { value: twist }, uStripes: { value: stripes }, uAlpha: { value: opacity }, uSoft: { value: softEdge ? 1 : 0 } },
    vertexShader: `varying vec2 vUv; varying vec3 vN; varying vec3 vV; void main(){ vUv=uv; vec4 mv=modelViewMatrix*vec4(position,1.0); vN=normalize(normalMatrix*normal); vV=normalize(-mv.xyz); gl_Position=projectionMatrix*mv;} `,
    fragmentShader: NOISE + /* glsl */ `
      uniform vec3 uColor,uCore; uniform float uTime,uI,uScroll,uTwist,uStripes,uAlpha,uSoft;
      varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main(){
        float u=vUv.x+vUv.y*uTwist;
        float n=snoise(vec3(u*uStripes, vUv.y*4.0-uTime*uScroll, uTime*0.5));
        float n2=snoise(vec3(u*uStripes*2.3, vUv.y*9.0-uTime*uScroll*1.7, 3.0));
        float s=smoothstep(0.02,0.22,n*0.7+n2*0.5)*0.85+smoothstep(0.35,0.5,n*0.7+n2*0.5)*0.4;
        float facing=abs(dot(normalize(vN),normalize(vV)));
        float edge=uSoft>0.5? smoothstep(0.0,0.35,facing):1.0;
        float ends=smoothstep(0.0,0.08,vUv.y)*smoothstep(1.0,0.85,vUv.y);
        vec3 c=mix(uColor,uCore,s*facing);
        float a=s*edge*ends*uAlpha;
        gl_FragColor=vec4(c*uI*a,a);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
}

// Hex-pattern force field for walls and wards.
export function barrierMaterial({ color, intensity = 1.6 } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: TIME, uColor: { value: col(color) }, uI: { value: intensity }, uAlpha: { value: 0 }, uHit: { value: 0 } },
    vertexShader: `varying vec2 vUv; varying vec3 vN; varying vec3 vV; varying vec3 vW; void main(){ vUv=uv; vec4 w=modelMatrix*vec4(position,1.0); vW=w.xyz; vec4 mv=viewMatrix*w; vN=normalize(normalMatrix*normal); vV=normalize(-mv.xyz); gl_Position=projectionMatrix*mv;} `,
    fragmentShader: NOISE + /* glsl */ `
      uniform vec3 uColor; uniform float uTime,uI,uAlpha,uHit; varying vec2 vUv; varying vec3 vN; varying vec3 vV; varying vec3 vW;
      float hex(vec2 p){ p.x*=1.1547; p.y+=mod(floor(p.x),2.0)*0.5; p=abs(fract(p)-0.5); return abs(max(p.x*1.5+p.y,p.y*2.0)-1.0); }
      void main(){
        float f=pow(1.0-abs(dot(normalize(vN),normalize(vV))),2.0);
        float h=smoothstep(0.12,0.0,hex(vUv*vec2(14.0,7.0)));
        float n=snoise(vW*0.6+vec3(0.0,uTime*0.8,0.0))*0.5+0.5;
        float scan=smoothstep(0.02,0.0,abs(fract(vUv.y*1.5-uTime*0.4)-0.5)-0.47);
        float a=(0.08+f*0.7+h*0.35*n+scan*0.3+uHit*0.6)*uAlpha;
        gl_FragColor=vec4(uColor*uI*a*(1.0+uHit*2.0),a);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
}

// Camera-facing ribbon (trails, lightning bolts).
// fade: alpha ramps in along the ribbon (trails); off for bolts. normal: alpha-blended instead of additive (daylight contrast)
export function ribbonMaterial({ color, core = 0xffffff, intensity = 3, opacity = 1, wisp = 1, fade = true, normal = false } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: col(color) }, uCore: { value: col(core) }, uI: { value: intensity }, uAlpha: { value: opacity }, uTime: TIME, uSeed: { value: Math.random() * 40 }, uWisp: { value: wisp }, uFadeT: { value: fade ? 1 : 0 }, uNormal: { value: normal ? 1 : 0 } },
    vertexShader: `attribute float aT; attribute float aSide; varying float vT; varying float vS; void main(){ vT=aT; vS=aSide; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);} `,
    fragmentShader: NOISE + /* glsl */ `
      uniform vec3 uColor,uCore; uniform float uI,uAlpha,uTime,uSeed,uWisp,uFadeT,uNormal; varying float vT; varying float vS;
      void main(){
        float across=1.0-abs(vS);
        float core=smoothstep(0.55,1.0,across);
        float n=snoise(vec3(vT*5.0-uTime*5.0,vS*1.2,uSeed));
        float wisp=mix(1.0,smoothstep(-0.25,0.15,n+vT*0.9-0.35),uWisp);
        float ft=mix(1.0,vT,uFadeT);
        float a=smoothstep(0.0,0.6,across)*ft*uAlpha*wisp;
        vec3 c=mix(uColor,uCore,core*ft);
        if(uNormal>0.5){ gl_FragColor=vec4(c*uI,smoothstep(0.0,0.35,across)*ft*uAlpha*wisp); return; }
        gl_FragColor=vec4(c*uI*a,a);
      }`,
    transparent: true, depthWrite: false, blending: normal ? THREE.NormalBlending : THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
}

// ------------------------------------------------------------------ stylized erosion explosion
// Noise-displaced sphere that erodes away with a banded (toon) colour ramp: hot core -> element -> dark -> smoke.
export function blastMaterial({ hot, mid, cool, smoke, seed = Math.random() * 50, emissive = 2.2 } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: TIME, uProg: { value: 0 }, uSeed: { value: seed }, uEm: { value: emissive },
      uHot: { value: col(hot) }, uMid: { value: col(mid) }, uCool: { value: col(cool) }, uSmoke: { value: col(smoke) },
    },
    vertexShader: NOISE + /* glsl */ `
      uniform float uProg,uSeed,uTime; varying vec3 vObj; varying vec3 vN; varying vec3 vV; varying float vDisp;
      void main(){
        float d=fbm3(normal*1.05+vec3(uSeed,uSeed*0.7,uProg*1.2));
        vDisp=d;
        vec3 p=position+normal*d*(0.5+uProg*0.35);                      // big soft billows, not cauliflower
        vObj=p;
        vec4 mv=modelViewMatrix*vec4(p,1.0);
        vN=normalize(normalMatrix*normal); vV=normalize(-mv.xyz);
        gl_Position=projectionMatrix*mv;
      }`,
    fragmentShader: NOISE + /* glsl */ `
      uniform float uProg,uSeed,uEm; uniform vec3 uHot,uMid,uCool,uSmoke;
      varying vec3 vObj; varying vec3 vN; varying vec3 vV; varying float vDisp;
      void main(){
        float n=fbm3(vObj*1.4+vec3(uSeed*1.3,-uProg*1.5,uSeed))*0.5+0.5;
        float ero=smoothstep(0.55,1.0,uProg);
        if(n<ero*1.05-0.02) discard;
        vec3 N=normalize(vN);
        float face=max(dot(N,normalize(vV)),0.0);
        float heat=clamp(1.0-uProg*2.6+(n-0.5)*0.9+face*0.3+vDisp*0.4,0.0,1.0); // white-hot only in the first instant
        heat=floor(heat*5.0+0.5)/5.0;
        vec3 L=normalize(vec3(-0.4,0.8,0.3));
        float lit=step(0.1,dot(N,L)+(n-0.5)*0.5)*0.45+0.55;
        vec3 c;
        if(heat>0.75) c=mix(uMid,uHot,(heat-0.75)*4.0)*uEm*1.4;
        else if(heat>0.45) c=mix(uCool,uMid,(heat-0.45)/0.3)*uEm;
        else if(heat>0.2) c=mix(uSmoke*lit,uCool*1.2,(heat-0.2)/0.25);
        else c=uSmoke*lit;
        float edge=smoothstep(ero*1.05-0.02,ero*1.05+0.06,n);
        c*=mix(0.35,1.0,edge);
        gl_FragColor=vec4(c,1.0);
      }`,
  });
}

// ------------------------------------------------------------------ screen distortion (rendered to an offset buffer)
// Shockwave ring: pushes pixels radially away from the centre in a travelling band.
export function distortRingMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uProg: { value: 0 }, uStrength: { value: 1 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);} ',
    fragmentShader: `uniform float uProg,uStrength; varying vec2 vUv;
      void main(){ vec2 d=vUv-0.5; float r=length(d)*2.0; float band=smoothstep(0.18,0.0,abs(r-uProg))*uStrength*(1.0-uProg);
        vec2 dir=normalize(d+1e-5); gl_FragColor=vec4(dir*band*0.04,0.0,1.0); }`,
    transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
}
// Heat haze / shimmer (billboard sprite)
export function distortHazeMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: TIME, uStrength: { value: 1 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);} ',
    fragmentShader: NOISE + `uniform float uTime,uStrength; varying vec2 vUv;
      void main(){ vec2 d=vUv-0.5; float m=smoothstep(0.5,0.1,length(d));
        float nx=snoise(vec3(vUv*6.0,uTime*2.0)), ny=snoise(vec3(vUv*6.0+7.0,uTime*2.0+3.0));
        gl_FragColor=vec4(vec2(nx,ny)*m*uStrength*0.012,0.0,1.0); }`,
    transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
  });
}
// Gravitational lensing for black holes
export function distortLensMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uStrength: { value: 1 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);} ',
    fragmentShader: `uniform float uStrength; varying vec2 vUv;
      void main(){ vec2 d=vUv-0.5; float r=length(d)*2.0; float k=smoothstep(1.0,0.15,r)*uStrength;
        gl_FragColor=vec4(-normalize(d+1e-5)*k*0.06*(1.0-r*0.5),0.0,1.0); }`,
    transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
  });
}

// ------------------------------------------------------------------ ink outline (inverted hull)
export function outlineMaterial(thickness = 0.02, color = 0x1a1420) {
  return new THREE.ShaderMaterial({
    uniforms: { uT: { value: thickness }, uColor: { value: col(color) } },
    vertexShader: `uniform float uT; void main(){ vec4 mv=modelViewMatrix*vec4(position,1.0); float d=clamp(-mv.z*0.06,0.6,3.0);
      vec3 n=normalize(normalMatrix*normal); mv.xyz+=n*uT*d; gl_Position=projectionMatrix*mv; }`,
    fragmentShader: `uniform vec3 uColor; void main(){ gl_FragColor=vec4(uColor,1.0); }`,
    side: THREE.BackSide,
  });
}
const _outlineCache = new Map();
export function addOutline(mesh, thickness = 0.02, color = 0x1a1420) {
  const key = thickness + ':' + color;
  if (!_outlineCache.has(key)) _outlineCache.set(key, outlineMaterial(thickness, color));
  const o = new THREE.Mesh(mesh.geometry, _outlineCache.get(key));
  o.raycast = () => {};
  o.userData.noAO = true; // AO's override material drops the hull extrusion, so it would only redraw the parent's depth/normals
  mesh.add(o);
  return o;
}

// Rim light injected into standard/toon materials (stylized back-light silhouette)
export function addRim(material, color = 0xfff2d8, strength = 0.6, power = 3.0) {
  material.onBeforeCompile = (sh) => {
    sh.uniforms.uRimColor = { value: col(color) }; sh.uniforms.uRimStr = { value: strength }; sh.uniforms.uRimPow = { value: power };
    sh.fragmentShader = 'uniform vec3 uRimColor; uniform float uRimStr, uRimPow;\n' + sh.fragmentShader.replace('#include <opaque_fragment>',
      `float rimF = pow(1.0 - clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0), uRimPow);
       outgoingLight += uRimColor * rimF * uRimStr;
       #include <opaque_fragment>`);
  };
  material.customProgramCacheKey = () => 'rim' + strength + power;
  return material;
}

// Alpha-blended "matter" flow for volumes (tornados, columns, waves). Reads in daylight where additive glow washes out.
// Continuous inputs from the look: uHeat (luminous temperature) bands the body into toon flame (core → colour → deep edge),
// uCrust (density) turns it into dark lit matter with glowing veins, uEdge (sharpness) hardens the silhouette.
export function matterFlowMaterial({ color, core, dark, intensity = 2, scroll = 2, twist = 1, stripes = 4, heat = 0.5, crust = 0, edge = 0.5, density = 0.5, opacity = 1 } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: TIME, uColor: { value: col(color) }, uCore: { value: col(core) }, uDark: { value: col(dark) }, uI: { value: intensity }, uScroll: { value: scroll }, uTwist: { value: twist }, uStripes: { value: stripes }, uHeat: { value: heat }, uCrust: { value: crust }, uEdge: { value: edge }, uDens: { value: density }, uAlpha: { value: opacity } },
    vertexShader: `varying vec2 vUv; varying vec3 vN; varying vec3 vV; void main(){ vUv=uv; vec4 mv=modelViewMatrix*vec4(position,1.0); vN=normalize(normalMatrix*normal); vV=normalize(-mv.xyz); gl_Position=projectionMatrix*mv;} `,
    fragmentShader: NOISE + /* glsl */ `
      uniform vec3 uColor,uCore,uDark; uniform float uTime,uI,uScroll,uTwist,uStripes,uHeat,uCrust,uEdge,uDens,uAlpha;
      varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main(){
        float u=vUv.x+vUv.y*uTwist;
        // tongues: noise stretched along the flow, stretched more when hot (licking flames), rounder when dense
        vec3 q=vec3(u*uStripes, vUv.y*(2.0+uCrust*2.0-uHeat)-uTime*uScroll, uTime*0.25);
        float n=snoise(q)*0.62+snoise(q*2.2+4.0)*0.28+snoise(q*5.0+9.0)*0.1*(1.0-uEdge*0.5);
        float ends=smoothstep(0.0,0.12,vUv.y)*smoothstep(1.0,0.75,vUv.y);
        float th=mix(0.05,-0.6,uCrust)+(1.0-ends)*0.6;                           // coverage threshold
        float ew=mix(0.25,0.02,uEdge);                                           // edge softness
        float cover=smoothstep(th-ew,th+ew,n);
        vec3 N=normalize(vN); float facing=abs(dot(N,normalize(vV)));
        // toon flame ramp: depth inside the tongue picks the band
        float k=clamp((n-th)/0.55,0.0,1.0);
        float kb=mix(k,floor(k*3.0+0.35)/3.0,0.6+uEdge*0.4);
        vec3 flame=kb<0.34? uColor*0.55 : kb<0.67? uColor : mix(uColor,uCore,0.7);
        flame*=uI*(0.6+0.8*kb);
        // dense crust: lit dark matter + glowing cracks
        float vn=abs(snoise(q*1.7+11.0));
        float vein=smoothstep(0.14,0.0,vn)+smoothstep(0.4,0.0,vn)*0.2;
        float lit=0.55+0.45*smoothstep(-0.2,0.6,N.y+n*0.4);
        vec3 crust=uDark*lit*(0.75+0.25*facing);
        crust=mix(crust,uColor*uI*1.2,vein*(0.4+uHeat*0.6));
        vec3 c=mix(flame,crust,uCrust);
        c+=uColor*uI*0.3*pow(1.0-facing,2.0)*uHeat*(1.0-uCrust*0.5);           // hot rim
        float a=cover*uAlpha*(0.35+0.65*max(uDens,uHeat))*smoothstep(0.0,0.3,facing);
        if(a<0.02) discard;
        gl_FragColor=vec4(c,a);
      }`,
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
  });
}
