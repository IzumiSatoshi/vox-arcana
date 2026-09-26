// Battle royale loot art: a distinct model for every kind of item (an open grimoire under its element's sigil, an
// amulet, a ward mantle, winged boots, an alchemist's belt, a rune stone, potions), a rarity marker on the ground, and
// chests with hinged lids. Materials and geometry are cached per (kind, tier, element); items share them.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { crystalMaterial, flowMaterial } from './shaders.js';
import { toon } from './world.js';
import { ELEMENTS } from './elements.js';
import { TIERS } from './royale-rules.js';
import { TAU } from './util.js';

const cache = new Map();
const once = (k, f) => { if (!cache.has(k)) cache.set(k, f()); return cache.get(k); };
const tierCol = (t) => new THREE.Color(TIERS[t].color);
// trim in the tier colour (Common is a dull pewter so the rarer metals read as rarer)
const trim = (t) => once('trim' + t, () => toon(t ? TIERS[t].color : 0x9a9ea6, { emissive: new THREE.Color(TIERS[t].color).multiplyScalar(t ? 0.28 : 0.05) }));
const gem = (t, c) => once('gem' + t + ':' + c, () => crystalMaterial({ color: new THREE.Color(c).lerp(new THREE.Color(0xffffff), 0.25), glow: new THREE.Color(c), emissive: 1.1 + t * 0.25, crack: 0.25 }));
const flat = (c, k) => once('flat' + k + c, () => toon(c));

// glowing sigil textures: a runic ring with a glyph in the middle (element kanji, rune signs)
function sigilTex(glyph, key) {
  return once('sig' + key, () => {
    const S = 256, cv = document.createElement('canvas'); cv.width = cv.height = S; const g = cv.getContext('2d');
    g.strokeStyle = '#fff'; g.fillStyle = '#fff'; g.lineWidth = 6; g.shadowColor = '#fff'; g.shadowBlur = 12;
    g.beginPath(); g.arc(S / 2, S / 2, S * 0.44, 0, TAU); g.stroke();
    g.lineWidth = 3; g.beginPath(); g.arc(S / 2, S / 2, S * 0.37, 0, TAU); g.stroke();
    for (let i = 0; i < 12; i++) { const a = (i / 12) * TAU; g.save(); g.translate(S / 2 + Math.cos(a) * S * 0.405, S / 2 + Math.sin(a) * S * 0.405); g.rotate(a + Math.PI / 2); g.fillRect(-2, -7, 4, 14); if (i % 3 === 0) { g.beginPath(); g.arc(0, 0, 6, 0, TAU); g.fill(); } g.restore(); }
    g.font = `700 ${S * 0.4}px "Noto Serif JP", "Yu Mincho", serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(glyph, S / 2, S / 2 + 6);
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
  });
}
const sigilMat = (glyph, key, color) => once('sm' + key + color, () => new THREE.MeshBasicMaterial({ map: sigilTex(glyph, key), color: new THREE.Color(color).multiplyScalar(1.6), transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
const RUNE_GLYPH = { blink: 'ᛉ', flight: 'ᛗ', spring: 'ᛏ', haste: 'ᚱ', ward: 'ᛟ' };

// ------------------------------------------------------------ item models (about 0.6-0.9 m across)
function grimoire(t, el) {
  const g = new THREE.Group(), E = ELEMENTS[el], cover = flat(new THREE.Color(E.dark).lerp(new THREE.Color(E.color), 0.35).getHex(), 'cov'), page = flat(0xf3e8cc, 'pg');
  const coverG = once('bookCover', () => new RoundedBoxGeometry(0.42, 0.05, 0.58, 2, 0.02)), pageG = once('bookPage', () => { const p = new THREE.BoxGeometry(0.38, 0.06, 0.53, 4, 1, 1), a = p.attributes.position; for (let i = 0; i < a.count; i++) a.setY(i, a.getY(i) + Math.sin(((a.getX(i) + 0.19) / 0.38) * Math.PI) * 0.03); p.computeVertexNormals(); return p; });
  for (const s of [-1, 1]) { // two halves hinged at the spine, opened into a shallow V
    const half = new THREE.Group(); half.rotation.z = s * -0.32;
    const c = new THREE.Mesh(coverG, cover); c.position.x = s * 0.21; half.add(c);
    const p = new THREE.Mesh(pageG, page); p.position.set(s * 0.2, 0.05, 0); half.add(p);
    for (const z of [-1, 1]) { const cap = new THREE.Mesh(once('bookCap', () => new THREE.BoxGeometry(0.09, 0.07, 0.09)), trim(t)); cap.position.set(s * 0.385, 0, z * 0.255); half.add(cap); }
    if (t >= 2) { const band = new THREE.Mesh(once('bookBand', () => new THREE.BoxGeometry(0.035, 0.065, 0.6)), trim(t)); band.position.set(s * 0.3, 0, 0); half.add(band); }
    g.add(half);
  }
  const spine = new THREE.Mesh(once('bookSpine', () => new THREE.CylinderGeometry(0.045, 0.045, 0.6, 10).rotateX(Math.PI / 2)), trim(t)); spine.position.y = -0.02; g.add(spine);
  const sig = new THREE.Mesh(once('sigPlane', () => new THREE.PlaneGeometry(0.62, 0.62).rotateX(-Math.PI / 2)), sigilMat(E.glyph, el, E.color)); sig.position.y = 0.28; sig.userData.spin = 1.2; g.add(sig);
  g.rotation.x = 0.55; // tilted toward the viewer (+z) so the open pages and the sigil read
  return g;
}
function amulet(t) {
  const g = new THREE.Group();
  const chain = new THREE.Mesh(once('amChain', () => new THREE.TorusGeometry(0.2, 0.014, 6, 32)), trim(t)); chain.scale.y = 1.25; chain.position.y = 0.2; g.add(chain);
  const bez = new THREE.Mesh(once('amBez', () => new THREE.TorusGeometry(0.13, 0.03, 8, 24)), trim(t)); g.add(bez);
  const stone = new THREE.Mesh(once('amGem', () => new THREE.OctahedronGeometry(0.12, 0).scale(1, 1.35, 0.6)), gem(t, TIERS[t].color)); g.add(stone);
  for (let i = 0; i < 3; i++) { const b = new THREE.Mesh(once('amBead', () => new THREE.SphereGeometry(0.03, 8, 6)), trim(t)); b.position.set((i - 1) * 0.07, -0.17 - (i === 1 ? 0.05 : 0), 0); g.add(b); }
  g.scale.setScalar(1.7);
  return g;
}
const shieldShape = () => { const s = new THREE.Shape(); s.moveTo(-0.3, 0.32); s.lineTo(0.3, 0.32); s.lineTo(0.3, 0.02); s.quadraticCurveTo(0.29, -0.28, 0, -0.46); s.quadraticCurveTo(-0.29, -0.28, -0.3, 0.02); s.closePath(); return s; };
function mantle(t) {
  const g = new THREE.Group();
  const face = new THREE.Mesh(once('shFace', () => new THREE.ExtrudeGeometry(shieldShape(), { depth: 0.05, bevelEnabled: true, bevelSize: 0.015, bevelThickness: 0.015, bevelSegments: 2, curveSegments: 12 }).translate(0, 0, -0.025)), flat(0x243a66, 'shf'));
  const rim = new THREE.Mesh(once('shRim', () => new THREE.ExtrudeGeometry(shieldShape(), { depth: 0.03, bevelEnabled: false, curveSegments: 12 }).scale(1.13, 1.1, 1).translate(0, -0.005, -0.045)), trim(t));
  const cross = new THREE.Mesh(once('shCross', () => new THREE.BoxGeometry(0.05, 0.6, 0.02)), trim(t)); cross.position.set(0, -0.05, 0.045);
  const bar = new THREE.Mesh(once('shBar', () => new THREE.BoxGeometry(0.46, 0.05, 0.02)), trim(t)); bar.position.set(0, 0.12, 0.045);
  const boss = new THREE.Mesh(once('shBoss', () => new THREE.OctahedronGeometry(0.075, 0)), gem(t, TIERS[t].color)); boss.position.set(0, 0.12, 0.07);
  g.add(face, rim, cross, bar, boss); g.scale.setScalar(1.35);
  return g;
}
const wingShape = () => { const s = new THREE.Shape(); s.moveTo(0, 0); s.quadraticCurveTo(0.12, 0.14, 0.34, 0.22); s.lineTo(0.26, 0.14); s.lineTo(0.32, 0.12); s.lineTo(0.22, 0.06); s.lineTo(0.27, 0.03); s.quadraticCurveTo(0.12, 0.0, 0, 0); return s; };
function boots(t) {
  const g = new THREE.Group(), leather = flat(0x5a3a22, 'lea');
  const shaft = new THREE.Mesh(once('btShaft', () => new THREE.CylinderGeometry(0.11, 0.125, 0.36, 12)), leather); shaft.position.y = 0.08; g.add(shaft);
  const foot = new THREE.Mesh(once('btFoot', () => new RoundedBoxGeometry(0.21, 0.13, 0.38, 2, 0.05)), leather); foot.position.set(0, -0.14, 0.08); g.add(foot);
  const sole = new THREE.Mesh(once('btSole', () => new THREE.BoxGeometry(0.22, 0.03, 0.39)), flat(0x2a1a10, 'sole')); sole.position.set(0, -0.21, 0.08); g.add(sole);
  const cuff = new THREE.Mesh(once('btCuff', () => new THREE.TorusGeometry(0.125, 0.03, 6, 20).rotateX(Math.PI / 2)), trim(t)); cuff.position.y = 0.26; g.add(cuff);
  const wg = once('btWing', () => new THREE.ExtrudeGeometry(wingShape(), { depth: 0.01, bevelEnabled: false }));
  for (const s of [-1, 1]) { const w = new THREE.Mesh(wg, t >= 3 ? trim(t) : flat(0xf4f0e6, 'wing')); w.position.set(s * 0.125, 0.1, -0.06); w.rotation.set(0, Math.PI / 2, s * 0.2); g.add(w); }
  g.rotation.y = Math.PI / 2; g.scale.setScalar(1.6);
  const w = new THREE.Group(); w.add(g); return w;
}
function belt(t) {
  const g = new THREE.Group();
  const band = new THREE.Mesh(once('blBand', () => new THREE.TorusGeometry(0.26, 0.035, 6, 36).scale(1, 1, 2.2)), flat(0x6a4426, 'belt')); g.add(band);
  const buckle = new THREE.Mesh(once('blBuckle', () => new THREE.TorusGeometry(0.07, 0.022, 4, 4).rotateZ(Math.PI / 4)), trim(t)); buckle.position.set(0, -0.26, 0.02); g.add(buckle);
  const cols = [0xff4a5a, 0x3a8aff, 0xffc83a];
  for (let i = 0; i < 3; i++) {
    const a = -Math.PI / 2 + (i - 1) * 0.55 + (i === 1 ? 0.9 : 0), v = new THREE.Mesh(once('blVial', () => new THREE.CylinderGeometry(0.035, 0.04, 0.13, 8)), once('vial' + i, () => toon(cols[i], { emissive: new THREE.Color(cols[i]).multiplyScalar(0.5) })));
    v.position.set(Math.cos(a) * 0.29, Math.sin(a) * 0.29 - 0.06, 0.05); g.add(v);
  }
  g.scale.setScalar(1.6);
  return g;
}
function rune(t, id) {
  const g = new THREE.Group(), c = TIERS[t].color;
  const stone = new THREE.Mesh(once('rnStone', () => new THREE.CylinderGeometry(0.3, 0.32, 0.09, 7).rotateX(Math.PI / 2)), flat(0x7d8290, 'rune')); g.add(stone);
  for (const s of [-1, 1]) { const f = new THREE.Mesh(once('rnFace', () => new THREE.PlaneGeometry(0.5, 0.5)), sigilMat(RUNE_GLYPH[id] || 'ᛟ', 'rune' + id, c)); f.position.z = s * 0.052; f.rotation.y = s > 0 ? 0 : Math.PI; g.add(f); }
  const ring = new THREE.Mesh(once('rnRing', () => new THREE.TorusGeometry(0.42, 0.012, 4, 40)), trim(t)); ring.userData.orbit = 1; g.add(ring);
  g.scale.setScalar(1.25);
  return g;
}
const BOTTLE = () => once('bottle', () => { const pts = [[0, 0], [0.2, 0.02], [0.26, 0.12], [0.26, 0.3], [0.2, 0.42], [0.08, 0.5], [0.08, 0.62], [0.11, 0.66], [0, 0.68]].map(([r, y]) => new THREE.Vector2(r, y)); const g = new THREE.LatheGeometry(pts, 20); g.translate(0, -0.34, 0); return g; });
function potion(id, color) {
  const g = new THREE.Group();
  const glass = new THREE.Mesh(BOTTLE(), once('glass', () => new THREE.MeshStandardMaterial({ color: 0xdff4ff, roughness: 0.1, metalness: 0, transparent: true, opacity: 0.45, depthWrite: false })));
  const liquid = new THREE.Mesh(BOTTLE(), once('liq' + id, () => new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.8, roughness: 0.3 }))); liquid.scale.set(0.82, 0.7, 0.82); liquid.position.y = -0.06;
  const cork = new THREE.Mesh(once('cork', () => new THREE.CylinderGeometry(0.075, 0.065, 0.1, 10)), flat(0x8a5a30, 'cork')); cork.position.y = 0.36;
  g.add(liquid, glass, cork); g.scale.setScalar(1.7);
  return g;
}
// every model faces +z (toward the viewer, see Royale.update); boots show their side
export function itemModel(it, potionColor = 0xffffff) {
  if (it.type === 'focus') return grimoire(it.tier, it.el);
  if (it.type === 'amulet') return amulet(it.tier);
  if (it.type === 'mantle') return mantle(it.tier);
  if (it.type === 'boots') return boots(it.tier);
  if (it.type === 'belt') return belt(it.tier);
  if (it.type === 'rune') return rune(it.tier, it.id);
  return potion(it.id, potionColor);
}

// a soft glow behind an item in its rarity colour (how loot reads from across a field)
const glowTex = () => once('glowTex', () => {
  const S = 128, cv = document.createElement('canvas'); cv.width = cv.height = S; const g = cv.getContext('2d'), gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  gr.addColorStop(0, 'rgba(255,255,255,0.85)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, S, S);
  return new THREE.CanvasTexture(cv);
});
export function glowSprite(tier, color) {
  const c = new THREE.Color(color), sp = new THREE.Sprite(once('glowM' + c.getHex(), () => new THREE.SpriteMaterial({ map: glowTex(), color: c, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.55 })));
  sp.scale.setScalar(1.1 + tier * 0.3); sp.renderOrder = 2;
  return sp;
}

// ------------------------------------------------------------ rarity marker: a runic ring on the ground, a light beam for Rare+
const ringTex = () => once('ringTex', () => {
  const S = 256, cv = document.createElement('canvas'); cv.width = cv.height = S; const g = cv.getContext('2d');
  const gr = g.createRadialGradient(S / 2, S / 2, S * 0.1, S / 2, S / 2, S / 2); gr.addColorStop(0, 'rgba(255,255,255,0.35)'); gr.addColorStop(0.6, 'rgba(255,255,255,0.08)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, S, S);
  g.strokeStyle = '#fff'; g.lineWidth = 5; g.beginPath(); g.arc(S / 2, S / 2, S * 0.42, 0, TAU); g.stroke();
  g.lineWidth = 2; g.beginPath(); g.arc(S / 2, S / 2, S * 0.34, 0, TAU); g.stroke();
  g.fillStyle = '#fff'; for (let i = 0; i < 16; i++) { const a = (i / 16) * TAU; g.save(); g.translate(S / 2 + Math.cos(a) * S * 0.38, S / 2 + Math.sin(a) * S * 0.38); g.rotate(a); g.fillRect(-1.5, -5, 3, 10); g.restore(); }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
});
const RING_G = () => once('ringG', () => new THREE.PlaneGeometry(1.9, 1.9).rotateX(-Math.PI / 2));
const BEAM_G = () => once('beamG', () => { const g = new THREE.CylinderGeometry(0.1, 0.28, 1, 12, 1, true); g.translate(0, 0.5, 0); return g; });
export function rarityMarker(tier, color) {
  const c = new THREE.Color(color);
  const ring = new THREE.Mesh(RING_G(), once('ringM' + c.getHex(), () => new THREE.MeshBasicMaterial({ map: ringTex(), color: c, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false })));
  let beam = null;
  if (tier >= 2) {
    beam = new THREE.Mesh(BEAM_G(), once('beamM' + c.getHex(), () => flowMaterial({ color: c, core: 0xffffff, intensity: 1.3, scroll: -1.4, stripes: 2, opacity: 0.5 })));
    beam.scale.set(tier >= 4 ? 1.8 : tier >= 3 ? 1.3 : 1, tier >= 4 ? 34 : tier >= 3 ? 20 : 11, tier >= 4 ? 1.8 : tier >= 3 ? 1.3 : 1);
  }
  return { ring, beam };
}

// ------------------------------------------------------------ chests: wood (Common), iron-bound (Rare) and gilded vaults (Legendary)
export const CHEST = {
  chest: { en: 'Wooden Chest', ja: '木の宝箱', color: 0xc8a46a, band: 0x4a4038, glow: 0xffd48a, scale: 1 },
  iron: { en: 'Iron-bound Chest', ja: '鉄の宝箱', color: 0x6a5238, band: 0x8ea4c0, glow: 0x7fc4ff, scale: 1.1 },
  vault: { en: 'Arcane Vault', ja: '秘宝の櫃', color: 0x3a2a5a, band: 0xffc850, glow: 0xffb040, scale: 1.3 },
};
export function chestModel(kind) {
  const C = CHEST[kind] || CHEST.chest, g = new THREE.Group(), wood = flat(C.color, 'chw'), band = once('chb' + kind, () => toon(C.band, { emissive: new THREE.Color(C.band).multiplyScalar(kind === 'vault' ? 0.3 : 0.05) }));
  const base = new THREE.Mesh(once('chBase', () => new RoundedBoxGeometry(0.96, 0.5, 0.62, 2, 0.03)), wood); base.position.y = 0.25; g.add(base);
  const lid = new THREE.Group(); lid.position.set(0, 0.5, -0.31); g.add(lid);
  const top = new THREE.Mesh(once('chLid', () => new THREE.CylinderGeometry(0.31, 0.31, 0.96, 14, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).translate(0, 0, 0.31)), wood); lid.add(top);
  for (const x of [-0.36, 0, 0.36]) {
    const b = new THREE.Mesh(once('chBand', () => new THREE.BoxGeometry(0.07, 0.52, 0.64)), band); b.position.set(x, 0.25, 0); g.add(b);
    const lb = new THREE.Mesh(once('chLBand', () => new THREE.CylinderGeometry(0.325, 0.325, 0.07, 14, 1, true, 0, Math.PI).rotateZ(Math.PI / 2).translate(0, 0, 0.31)), band); lb.position.x = x; lid.add(lb);
  }
  const lock = new THREE.Mesh(once('chLock', () => new THREE.BoxGeometry(0.16, 0.2, 0.05)), band); lock.position.set(0, 0.46, 0.33); g.add(lock);
  const hole = new THREE.Mesh(once('chHole', () => new THREE.CircleGeometry(0.035, 10)), once('chGlow' + kind, () => new THREE.MeshBasicMaterial({ color: C.glow }))); hole.position.set(0, 0.45, 0.36); g.add(hole);
  if (kind === 'vault') { const gm = new THREE.Mesh(once('chGem', () => new THREE.OctahedronGeometry(0.1, 0)), gem(4, 0xffb040)); gm.position.set(0, 0.35, 0.31); lid.add(gm); }
  g.scale.setScalar(C.scale);
  g.traverse((m) => { if (m.isMesh) m.castShadow = true; });
  return { group: g, lid };
}

// ------------------------------------------------------------ HUD icons (24×24 SVG, currentColor)
export const ICONS = {
  focus: '<path d="M3 6c3-1.6 6-1.4 8.4.6V20c-2.4-1.8-5.4-2-8.4-.6z"/><path d="M21 6c-3-1.6-6-1.4-8.4.6V20c2.4-1.8 5.4-2 8.4-.6z"/>',
  amulet: '<path d="M6.5 3c.4 4.5 2.6 7 5.5 7s5.1-2.5 5.5-7" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M12 10l3.6 4.6L12 21l-3.6-6.4z"/>',
  mantle: '<path d="M12 2.5l8 2.8v6c0 5-3.6 8.8-8 10.7-4.4-1.9-8-5.7-8-10.7v-6z"/><path d="M12 6v12M7.5 10h9" stroke="#0008" stroke-width="1.6"/>',
  boots: '<path d="M8.5 3h5.2v9.4l5.8 3.6c.8.5 1.3 1.4 1.3 2.3V20H6v-4.2l2.5-2.3z"/><path d="M8.3 6.5L3 4.5l1.6 2.3L2.5 7.6l2.7.8L4 9.8l4.3-.3" />',
  belt: '<rect x="1.5" y="9" width="21" height="6" rx="2"/><rect x="8.8" y="7.6" width="6.4" height="8.8" rx="1.2" fill="none" stroke="#0009" stroke-width="1.8"/>',
  rune: '<path d="M12 2l8.5 5v10L12 22l-8.5-5V7z"/><path d="M12 6.5v11M12 10l3.2-2.6M12 13l-3.2-2.6" stroke="#0009" stroke-width="1.7" fill="none"/>',
};
export const icon = (k, cls = '') => `<svg class="ico ${cls}" viewBox="0 0 24 24" fill="currentColor">${ICONS[k] || ''}</svg>`;
