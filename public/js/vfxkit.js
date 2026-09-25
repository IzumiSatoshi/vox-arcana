// Element surface kit: one lit, alpha-blended surface shader shared by every large spell volume (tornado funnels, waves,
// walls of matter …). It blends four kinds of matter with weights that come continuously from the element and the look axes:
//   fluid  – glossy liquid with fresnel sky reflection, sun glints and broken foam
//   flame  – banded toon fire with licking tongues
//   gas    – soft sun-lit dust / cloud / smoke with helical streaks
//   solid  – opaque lumpy matter (rock, snow, crystal) with cel lighting
// plus an additive-looking energy term (plasma, holy light, runes). No per-combination presets: kitOf() only maps axes.
import * as THREE from 'three';
import { NOISE, TIME } from './shaders.js';
import { SUN_DIR } from './world.js';
import { clamp } from './util.js';
import { lookOf } from './look.js';
import { paletteFor } from './elements.js';
// default kit for an element with neutral axes (status effects, ambient uses)
const _elKits = {};
export function elementKit(el) {
  if (!_elKits[el]) { const T0 = { fire: 0.78, ice: 0.08, water: 0.35, lightning: 0.6, wind: 0.4, earth: 0.5, darkness: 0.3, light: 0.65, nature: 0.5, poison: 0.45, arcane: 0.5 }[el] ?? 0.5; const L = lookOf({ element: el, temperature: T0, seed: 7 }, paletteFor(el, T0)); _elKits[el] = kitOf(el, L); }
  return _elKits[el];
}

const C = (h) => new THREE.Color(h);
// element "signature": what the matter is made of when the axes are neutral (fluid, flame, gas, solid, energy)
const MATTER = {
  water: [1, 0, 0.25, 0, 0.1], fire: [0, 1, 0.12, 0, 0.12], ice: [0.15, 0, 0.35, 0.7, 0.2], lightning: [0, 0, 0.8, 0, 0.9],
  wind: [0, 0, 1, 0, 0.12], earth: [0, 0, 0.55, 0.8, 0], darkness: [0.1, 0.3, 0.9, 0, 0.4], light: [0, 0.35, 0.5, 0, 0.7],
  nature: [0.2, 0, 0.45, 0.5, 0.2], poison: [0.6, 0, 0.75, 0, 0.3], arcane: [0.1, 0, 0.5, 0, 0.85],
};
// body / highlight / shadow colours for the gas + solid terms (the fluid and flame terms use the spell palette)
const TONES = {
  water: [0x2f8fd8, 0xeaf8ff, 0x0b3a66], fire: [0x4a4240, 0xffc47a, 0x1c1818], ice: [0xa8dcff, 0xf4fdff, 0x3f78b0],
  lightning: [0x363a52, 0xe8e0ff, 0x12131e], wind: [0x86bfb2, 0xf4fffb, 0x3a625c], earth: [0xa88a62, 0xe8d3a8, 0x4a3a28],
  darkness: [0x20142c, 0xb46cff, 0x07030c], light: [0xffc24a, 0xfff4cc, 0xa8681a], nature: [0x5c9a3a, 0xd8ff9a, 0x1f4a1c],
  poison: [0x8ac820, 0xf0ff80, 0x3a1a4a], arcane: [0x6a2ab8, 0xd8a0ff, 0x1a0636],
};

// Resolve the kit for a spell: matter weights, colours and motion, all from element + look axes.
export function kitOf(el, look) {
  const G = look.g, P = look.pal, hot = clamp((G.temperature - 0.55) / 0.3);
  const M = (MATTER[el] || MATTER.arcane).slice();
  // axes move the mixture continuously: heat → flame, density → solid, low density → gas, liquid substance → fluid
  M[1] = clamp(M[1] + hot * 0.8 * (1 - G.density * 0.5));
  M[3] = clamp(M[3] + (G.density - 0.6) * 1.6 * (1 - hot));
  M[2] = clamp(M[2] + (0.45 - G.density) * 1.2) * (1 - hot * 0.8); // hot matter burns, it doesn't billow
  if (look.substance === 'liquid') M[0] = clamp(M[0] + 0.7);
  if (look.substance === 'mist' || look.substance === 'spectral') { M[2] = 1; M[3] *= 0.2; }
  if (look.substance === 'magma') { M[3] = Math.max(M[3], 0.75); M[1] = Math.max(M[1], 0.35); }
  M[4] = clamp(M[4] * (0.5 + G.luminosity) + smooth(0.8, 1, G.luminosity) * 0.4);
  const [tb, th, td] = TONES[el] || TONES.arcane;
  // energetic elements take more of the spell colour into their matter so they stay saturated instead of pastel
  const body = C(tb).lerp(P.color, 0.2 + M[4] * 0.35), hi = C(th).lerp(P.core, 0.2), dark = C(td).lerp(P.smoke || P.dark, 0.2).lerp(P.dark, M[4] * 0.3);
  if (look.substance === 'magma' || look.substance === 'smoke' || look.substance === 'corrupted') { body.copy(P.smoke).lerp(C(0x3a2e2a), 0.3); dark.copy(P.smoke).multiplyScalar(0.5); }
  return {
    mix: new THREE.Vector4(M[0], M[1], M[2], M[3]), energy: M[4], body, hi, dark,
    color: P.color.clone(), core: P.core.clone(),
    opacity: 0.74 + G.density * 0.22 + M[0] * 0.1,
    streak: 3 + G.sharpness * 7, turb: 0.4 + G.dispersion * 1.2, flow: 0.6 + hot * 1.5 + (1 - G.weight) * 0.8,
    heat: hot * (0.4 + G.luminosity * 0.6), crack: clamp(hot * G.density * 1.4),
    // toxic / corrupted matter: dark blotches and rising bubble rings on the surface, no clean-water turquoise
    // arcane matter carries sigils: glowing diamond glyphs that flicker on along the flow (radiant light a little)
    glyph: clamp((el === 'arcane' ? 1 : 0) + (look.substance === 'radiant' ? 0.5 : 0) + (el === 'light' ? 0.3 : 0)),
    mottle: clamp((el === 'poison' ? 1 : el === 'darkness' ? 0.35 : 0) + (look.substance === 'corrupted' ? 0.8 : 0)),
  };
}
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };

// The surface. Geometry supplies uv.x (around / across) and uv.y (up the volume or along the face).
// Vertex options: uBend (rope-like sway of a vertical axis), uBulge (noisy radius), used by funnels; waves pass 0.
export function surfaceMaterial(kit, { spin = 1, twist = 2, bend = 0, bulge = 0.1, opacity = 1, energyOnly = false, side = THREE.DoubleSide } = {}) {
  const u = {
    uTime: TIME, uMix: { value: kit.mix }, uEnergy: { value: energyOnly ? 1 : kit.energy }, uEnergyOnly: { value: energyOnly ? 1 : 0 },
    uBody: { value: kit.body }, uHi: { value: kit.hi }, uDark: { value: kit.dark }, uColor: { value: kit.color }, uCore: { value: kit.core },
    uStreak: { value: kit.streak }, uTurb: { value: kit.turb }, uFlow: { value: kit.flow }, uHeat: { value: kit.heat }, uCrack: { value: kit.crack },
    uSpin: { value: spin }, uTwist: { value: twist }, uBend: { value: bend }, uBulge: { value: bulge }, uPhase: { value: Math.random() * 10 },
    uAlpha: { value: kit.opacity * opacity }, uSun: { value: SUN_DIR }, uFade: { value: 1 }, uFoam: { value: 0 }, uCrest: { value: 0 }, uTopFade: { value: 1 }, uBands: { value: 0 }, uGap: { value: 1 }, uLow: { value: 0 }, uMottle: { value: kit.mottle || 0 }, uGlyph: { value: kit.glyph || 0 }, uFlameUp: { value: 0.4 },
  };
  return new THREE.ShaderMaterial({
    uniforms: u, transparent: true, depthWrite: false, side,
    blending: energyOnly ? THREE.AdditiveBlending : THREE.NormalBlending,
    vertexShader: NOISE + /* glsl */ `
      uniform float uTime,uBend,uBulge,uPhase,uSpin;
      varying vec2 vUv; varying vec3 vWN; varying vec3 vWP; varying vec3 vV;
      void main(){
        vUv=uv; vec3 p=position;
        float y=uv.y;
        // noisy bulges that travel up and around, so the silhouette churns
        float a=uv.x*6.2832;
        float b=snoise(vec3(cos(a)*1.3,y*3.0-uTime*uSpin*0.6,sin(a)*1.3+uPhase));
        p.xz*=1.0+b*uBulge;
        // rope sway: the axis bends more toward the top and meanders over time
        p.x+=uBend*(sin(y*2.4+uTime*0.9+uPhase)*y+sin(y*5.1-uTime*1.7)*0.25*y);
        p.z+=uBend*(cos(y*2.1+uTime*0.7+uPhase*1.3)*y*0.8);
        vec4 w=modelMatrix*vec4(p,1.0); vWP=w.xyz;
        vWN=normalize(mat3(modelMatrix)*normal);
        vV=normalize(cameraPosition-w.xyz);
        gl_Position=projectionMatrix*viewMatrix*w;
      }`,
    fragmentShader: NOISE + /* glsl */ `
      uniform float uTime,uEnergy,uEnergyOnly,uStreak,uTurb,uFlow,uHeat,uCrack,uSpin,uTwist,uAlpha,uFade,uFoam,uCrest,uPhase,uTopFade,uBands,uGap,uLow,uMottle,uGlyph,uFlameUp;
      uniform vec4 uMix; uniform vec3 uBody,uHi,uDark,uColor,uCore,uSun;
      varying vec2 vUv; varying vec3 vWN; varying vec3 vWP; varying vec3 vV;
      float cel(float x){ return smoothstep(0.0,0.18,x)*0.85+x*0.15; }
      void main(){
        vec3 N=normalize(vWN); if(!gl_FrontFacing) N=-N;
        vec3 V=normalize(vV);
        float facing=abs(dot(N,V)), fres=pow(1.0-facing,3.0);
        float ndl=dot(N,normalize(uSun));
        float lit=cel(max(ndl,0.0));
        vec3 amb=mix(vec3(0.42,0.46,0.4),vec3(0.62,0.72,0.9),N.y*0.5+0.5);
        // helical flow coordinates
        float h=vUv.x*uStreak+vUv.y*uTwist-uTime*uSpin*0.35;
        float fy=vUv.y*3.0-uTime*uFlow;
        float n1=snoise(vec3(h,fy,uPhase));
        float n2=snoise(vec3(h*2.3+3.0,fy*2.1,uPhase+2.0));
        float n3=snoise(vec3(h*5.0,fy*4.0,uPhase+5.0));
        float n=n1*0.6+n2*0.3+n3*0.1*uTurb;
        float streak=smoothstep(0.1,0.7,abs(snoise(vec3(h*2.0,vUv.y*0.6-uTime*uFlow*0.3,uPhase+9.0))));
        float ends=smoothstep(0.0,0.07,vUv.y)*mix(1.0,smoothstep(1.0,0.86,vUv.y),uTopFade);
        // ---- gas / dust: soft lit volume, darker and denser toward the base, bright streaks
        // broad billows for gas and flame (fibre-scale noise only for streaks/energy)
        vec3 qb=vec3(vUv.x*3.0+vUv.y*uTwist*0.5-uTime*uSpin*0.2, vUv.y*1.8-uTime*uFlow*1.2, uPhase+11.0);
        float nb=snoise(qb)*0.65+snoise(qb*2.1+1.7)*0.35;
        float gCov=smoothstep(-0.6,0.05,nb*0.8+n*0.2+0.25-vUv.y*0.2);
        vec3 gas=mix(uDark,uBody,smoothstep(0.0,0.8,vUv.y)*0.55+0.45*smoothstep(-0.4,0.6,n));
        gas=gas*(amb*0.5+lit*0.62)+uHi*streak*0.3*(0.4+lit);
        gas*=0.8+0.3*smoothstep(-0.5,0.5,n2);                                  // billowing light/dark lobes
        gas+=uHi*fres*0.25*lit;
        // ---- solid: lumpy opaque matter with cel light and glowing cracks when hot
        float sCov=smoothstep(-0.35,-0.2,n);
        vec3 solid=mix(uDark,uBody,smoothstep(-0.4,0.6,n2))*(amb*0.7+lit*0.7);
        solid=mix(solid,uHi,smoothstep(0.55,0.8,n3*0.5+N.y*0.6)*0.5);
        float crack=smoothstep(0.09,0.0,abs(n2))*uCrack;
        solid=mix(solid,uColor*2.2,crack);
        // ---- fluid: deep → shallow, fresnel sky, sun glints, broken foam streaks
        float fCov=smoothstep(-0.8,-0.5,n);
        vec3 deep=mix(uColor*vec3(0.12,0.22,0.38),uDark*0.8,uMottle), shallow=mix(uColor,mix(vec3(0.25,0.9,0.85),uColor*1.25,uMottle),0.45);
        vec3 fluid=mix(deep,shallow,smoothstep(0.15,0.95,vUv.y)*0.75);
        // thin crest lit from behind glows turquoise (fake subsurface scattering)
        float sss=pow(max(dot(-V,normalize(uSun)),0.0),2.0)*smoothstep(0.45,0.95,vUv.y);
        fluid+=mix(vec3(0.2,0.85,0.8),uColor,uMottle)*sss*0.8;
        fluid=mix(fluid,vec3(0.72,0.86,0.98),fres*0.15);
        vec3 R=reflect(-V,N); float spec=pow(max(dot(R,normalize(uSun)),0.0),60.0);
        fluid+=vec3(1.0,0.97,0.9)*(step(0.7,spec)*0.35+spec*0.12);
        fluid*=0.75+0.35*lit;
        float foam=smoothstep(0.45,0.8,n2*0.6+streak*0.45)*uFoam*2.0;                    // streaky foam lace on the face
        foam=max(foam,smoothstep(0.82,0.96,vUv.y+n*0.1)*uCrest);                         // white water on the crest / lip
        foam=max(foam,smoothstep(0.12,0.0,vUv.y+n*0.05)*uCrest*0.8);                    // churn at the toe
        fluid=mix(fluid,vec3(0.96,0.99,1.0)*(0.8+0.3*lit),clamp(foam,0.0,1.0));
        // ---- flame: banded toon fire tongues rising
        float fl=nb*0.8+n*0.25+0.2-vUv.y*uFlameUp;
        float flCov=smoothstep(-0.25,-0.18,fl);
        float k=clamp((fl+0.2)/0.6,0.0,1.0); float kb=floor(k*3.0+0.35)/3.0;
        vec3 flame=(kb<0.34? mix(uColor*0.75,vec3(0.78,0.1,0.02),0.4) : kb<0.67? uColor*1.1 : mix(uColor,uCore,0.6)*1.15)*(0.9+uHeat*0.6); // deep red → orange → white-gold
        flame=mix(flame,uCore*1.25,pow(facing,3.0)*0.55*uHeat);                           // hot core glows through the middle
        flCov*=smoothstep(0.0,0.25,fl+facing*1.3-0.15);                                      // tongues tear the silhouette
        // ---- blend by matter weights
        vec4 w=uMix; float ws=max(w.x+w.y+w.z+w.w,0.001);
        // coverage-weighted blend: where flame/solid/fluid actually cover the pixel they win over thin gas
        vec4 cw=w*vec4(fCov,flCov,gCov*0.6,sCov)+1e-4;
        vec3 col=(fluid*cw.x+flame*cw.y+gas*cw.z+solid*cw.w)/(cw.x+cw.y+cw.z+cw.w);
        float cov=(fCov*w.x+flCov*w.y+gCov*w.z+sCov*w.w)/ws;
        float opaque=(w.x*0.85+w.y+w.w)/ws;                                   // dense matter is nearly opaque, gas stays sheer
        float alpha=cov*ends*mix(uAlpha,1.0,opaque*0.8)*uFade;
        alpha*=mix(1.0,smoothstep(0.0,0.35,facing),w.z/ws);             // gas thins at grazing angles
        // ---- toxic mottling: slow-drifting dark blotches plus bubble rings that rise and pop
        if(uMottle>0.0){
          float mot=smoothstep(0.2,0.5,snoise(vec3(vUv.x*uStreak*0.9+n*0.3,vUv.y*4.0-uTime*uFlow*0.4,uPhase+21.0)));
          col=mix(col,uDark*(0.9+0.5*lit)+uColor*0.12,mot*uMottle*0.7);
          vec2 bg=vec2(vUv.x*uStreak*2.2,vUv.y*7.0-uTime*uFlow*0.8); vec2 bid=floor(bg), bf=fract(bg)-0.5;
          float bh=fract(sin(dot(bid,vec2(12.9898,78.233)))*43758.5453);
          float life=fract(uTime*0.5+bh*7.0), br=(0.12+0.25*bh)*life;
          float ring=smoothstep(0.07,0.0,abs(length(bf)-br))*step(0.55,bh)*(1.0-life*life);
          col=mix(col,uHi*(0.9+0.4*lit),ring*uMottle*0.85);
          alpha=max(alpha,ring*uMottle*0.8*ends*uFade*uAlpha);
        }
        // ---- helical band sheets (funnels): matter gathers into spiralling sheets with gaps and a bright leading edge
        if(uBands>0.5){
          float bs=sin((vUv.x+vUv.y*uTwist*0.22-uTime*uSpin*0.16)*6.2832*uBands+n*1.4);
          float bandM=smoothstep(-0.45,0.05,bs);
          float lead=smoothstep(-0.05,0.12,bs)*(1.0-smoothstep(0.18,0.42,bs));
          col=mix(col*mix(0.72,1.0,smoothstep(0.0,0.8,bs)),uHi*(0.85+0.5*lit),lead*0.8);
          alpha=max(alpha*mix(1.0-uGap,1.0,bandM),lead*0.9*ends*uFade*uAlpha);
        }
        // ---- energy: glowing streaks riding the flow (plasma, holy light, runes)
        float e=smoothstep(0.35,0.8,streak*0.7+n1*0.4)*uEnergy;
        col+=mix(uColor,uCore,streak)*e*1.6;
        alpha=max(alpha,e*ends*0.6*uFade);
        if(uGlyph>0.0){ // sigil lattice: diamonds and crosses light up cell by cell, pulse, fade
          vec2 rg=vec2(vUv.x*uStreak*0.9,vUv.y*3.5-uTime*uFlow*0.3); vec2 rid=floor(rg), rf=fract(rg)-0.5;
          float rh=fract(sin(dot(rid,vec2(41.3,289.1)))*15731.7);
          float on=step(0.62,rh)*smoothstep(0.0,0.3,sin(uTime*2.2+rh*40.0));
          float dm=abs(rf.x)+abs(rf.y);
          float gl=max(smoothstep(0.045,0.0,abs(dm-0.34)),smoothstep(0.03,0.0,min(abs(rf.x),abs(rf.y)))*step(dm,0.3)*step(0.8,rh));
          gl*=on*ends*uFade*uGlyph;
          col=mix(col,mix(uColor*2.0,uCore*1.5,0.5),gl*0.95);
          alpha=max(alpha,gl*0.85);
          e=max(e,gl);
        }
        if(uEnergyOnly>0.5){ gl_FragColor=vec4(mix(uColor,uCore,streak)*e*ends*uFade*1.5,1.0); return; }
        if(uLow>0.0) alpha*=smoothstep(uLow-0.25,uLow+0.15,vUv.y+n*0.12);               // matter only above a height (soot rising off flames)
        if(alpha<0.01) discard;
        gl_FragColor=vec4(col,alpha);
      }`,
  });
}
