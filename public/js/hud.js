import * as THREE from 'three';
import { ELEMENTS, SHAPES, tierName, shapeName, reactName } from './elements.js';
import { roman, clamp, TAU } from './util.js';
import { t } from './i18n.js';

const $ = (id) => document.getElementById(id);
const _html = new WeakMap(); // write innerHTML only when it actually changes
const setHTML = (el, h) => { if (_html.get(el) !== h) { _html.set(el, h); el.innerHTML = h; } };
const _styles = new WeakMap();
const setStyle = (el, key, value) => {
  let cache = _styles.get(el);
  if (!cache) { cache = {}; _styles.set(el, cache); }
  if (cache[key] !== value) { cache[key] = value; el.style[key] = value; }
};
const setText = (el, value) => { const text = String(value); if (el.textContent !== text) el.textContent = text; };
const hex = (n) => '#' + new THREE.Color(n).getHexString();

// Hand-drawn element emblems (24×24)
const ICONS = {
  fire: '<path fill="currentColor" d="M12 2c.8 3.2-1.4 4.8-.2 7.4.6-1 1.2-1.9 1.1-3.1 3.2 2.1 5.6 5.2 5.6 8.6A6.5 6.5 0 0 1 12 21.5 6.5 6.5 0 0 1 5.5 15c0-2.9 1.7-4.7 3-6 .1 1.6.8 2.8 2 3.3C9.7 9 10.4 5.3 12 2z"/><path fill="#fff8" d="M12 13c1.8 1.3 2.6 2.6 2.6 3.8a2.6 2.6 0 0 1-5.2 0c0-1.2.9-2.4 2.6-3.8z"/>',
  ice: '<g stroke="currentColor" stroke-width="1.9" stroke-linecap="round" fill="none"><path d="M12 2.5v19M3.8 7.2l16.4 9.6M3.8 16.8l16.4-9.6"/><path d="M9.5 4.5 12 6.6l2.5-2.1M9.5 19.5 12 17.4l2.5 2.1M4.2 10.4l3.1-.7-.9-3M19.8 13.6l-3.1.7.9 3M4.2 13.6l3.1.7-.9 3M19.8 10.4l-3.1-.7.9-3"/></g>',
  water: '<path fill="currentColor" d="M12 2.5C9 7.2 5.5 10.6 5.5 14.5a6.5 6.5 0 0 0 13 0C18.5 10.6 15 7.2 12 2.5z"/><path fill="none" stroke="#fff9" stroke-width="1.6" stroke-linecap="round" d="M8.8 14.2a3.4 3.4 0 0 0 2.6 3.6"/>',
  lightning: '<path fill="currentColor" d="M13.8 1.8 4.4 13.6h6.1L9.2 22.2l10.4-12.4h-6.3z"/>',
  wind: '<g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 8.5h10.5a3 3 0 1 0-3-3"/><path d="M3 12.5h15a3 3 0 1 1-3 3"/><path d="M3 16.5h7"/></g>',
  earth: '<path fill="currentColor" d="M1.8 20.5 8.4 8.2l3.4 5.4 3.1-4.2 7.3 11.1z"/><path fill="#fff7" d="m8.4 8.2 1.9 3-1.9-.6-1.8 1.4z"/>',
  darkness: '<path fill="currentColor" d="M14.5 2.3a9.7 9.7 0 1 0 7.2 15.8A8.2 8.2 0 0 1 14.5 2.3z"/><circle cx="17.5" cy="7" r="1.1" fill="currentColor"/>',
  light: '<circle cx="12" cy="12" r="4.4" fill="currentColor"/><g stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 1.8v3M12 19.2v3M1.8 12h3M19.2 12h3M4.8 4.8l2.1 2.1M17.1 17.1l2.1 2.1M4.8 19.2l2.1-2.1M17.1 6.9l2.1-2.1"/></g>',
  nature: '<path fill="currentColor" d="M4.5 19.5C4.5 9.5 10.5 4 20 4c0 9.5-5.5 15.5-15.5 15.5z"/><path stroke="#0006" stroke-width="1.4" fill="none" d="M4.5 19.5 14.5 9.5"/>',
  poison: '<g fill="currentColor"><circle cx="9" cy="14.5" r="5.2"/><circle cx="16.3" cy="7.8" r="3.2"/><circle cx="17.8" cy="16.7" r="2.2"/><circle cx="11.5" cy="4.2" r="1.4"/></g><circle cx="7.4" cy="12.8" r="1.5" fill="#fff8"/>',
  arcane: '<path fill="currentColor" d="M12 1.5 14.6 9.4 22.5 12 14.6 14.6 12 22.5 9.4 14.6 1.5 12 9.4 9.4z"/><circle cx="12" cy="12" r="2" fill="#fff9"/>',
};
export const elIcon = (el, size = 18) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true">${ICONS[el] || ICONS.arcane}</svg>`;
export function elChip(el, cls = '') {
  if (!el || !ELEMENTS[el]) return '';
  const c = hex(ELEMENTS[el].color);
  return `<span class="el-chip ${cls}" style="--c:${c}" title="${ELEMENTS[el].name}">${elIcon(el, cls.includes('aura') ? 11 : 14)}</span>`;
}

export class Hud {
  constructor(game) {
    this.g = game;
    this.pops = []; this.plates = new Map();
    this.root = $('hud');
    this.cardTimer = 0; this.flash = 0; this.hurt = 0; this.hitm = 0;
    this.buildCompass();
    this.compassWidth = 0;
    this.compassObserver = new ResizeObserver(() => { this.compassWidth = $('compass').clientWidth; });
    this.compassObserver.observe($('compass'));
    this.mm = $('minimap').getContext('2d');
    this.wave = { cv: $('voice-wave-cv'), pts: new Float32Array(160), env: 0, t: 0, state: '' };
    this.jrRaw = false;
    $('jr-body').addEventListener('scroll', () => this.jrThumb());
  }
  show(v) { this.root.classList.toggle('hidden', !v); }
  setEl(el) { this.elColor = el ? hex(ELEMENTS[el].color) : '#ffffff'; document.documentElement.style.setProperty('--el', this.elColor); if (el && this._pel !== el) { this._pel = el; $('portrait-icon').innerHTML = elIcon(el, 34); } }

  // ---------------- compass / minimap
  buildCompass() {
    this.ppd = 3.2;
    const strip = $('compass-strip'); let h = '';
    const cards = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
    for (let d = -360; d <= 720; d += 15) {
      const n = ((d % 360) + 360) % 360;
      const x = d * this.ppd;
      if (cards[n]) h += `<span class="${n % 90 === 0 ? 'card' : ''}" style="left:${x}px">${cards[n]}</span>`;
      else h += `<span class="tick" style="left:${x}px"></span>`;
    }
    strip.innerHTML = h;
  }
  buildMinimapBg(world) {
    const S = 360, cv = document.createElement('canvas'); cv.width = cv.height = S; const g = cv.getContext('2d');
    const R = 135, img = g.createImageData(S, S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const wx = (x / S) * 2 * R - R, wz = (y / S) * 2 * R - R, h = world.heightAt(wx, wz), o = (y * S + x) * 4;
      let c;
      if (h < -2.8) c = [40, 110, 140]; else if (h < -1.2) c = [196, 180, 132];
      else if (Math.hypot(wx, wz) < 10.5) c = [150, 142, 124];
      else { const k = clamp((h + 1) / 10); c = [70 + k * 40, 120 + k * 20, 60 + k * 30]; }
      img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2]; img.data[o + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    g.fillStyle = 'rgba(40,36,30,0.85)';
    for (const o of world.obstacles) { g.beginPath(); g.arc(((o.x + R) / (2 * R)) * S, ((o.z + R) / (2 * R)) * S, Math.max(1.5, o.r * 2), 0, TAU); g.fill(); }
    g.strokeStyle = 'rgba(111,224,255,0.6)'; g.lineWidth = 2; g.beginPath(); g.arc(S / 2, S / 2, (8.5 / (2 * R)) * S, 0, TAU); g.stroke();
    this.mmBg = cv; this.mmR = R;
  }
  drawMinimap(p) {
    // px per metre; zoomed out to the whole island while riding the ferry or falling, so you can pick a landing spot
    const g = this.mm, W = 180, wide = this.g.royale && (p.onShip || p.dropping), scale = this._mmS = (this._mmS ?? 2) + ((wide ? 0.62 : 2) - (this._mmS ?? 2)) * 0.15;
    g.save(); g.clearRect(0, 0, W, W);
    g.beginPath(); g.arc(W / 2, W / 2, W / 2, 0, TAU); g.clip();
    g.fillStyle = '#28462a'; g.fillRect(0, 0, W, W);
    g.translate(W / 2, W / 2); g.rotate(p.yaw);
    if (this.mmBg) { const s = (2 * this.mmR * scale); g.drawImage(this.mmBg, -p.pos.x * scale - s / 2, -p.pos.z * scale - s / 2, s, s); }
    // threats (area spells)
    for (const th of this.g.spells.threatsFor(p)) if (th.area) { g.strokeStyle = 'rgba(255,90,90,0.9)'; g.lineWidth = 2; g.beginPath(); g.arc((th.pos.x - p.pos.x) * scale, (th.pos.z - p.pos.z) * scale, th.radius * scale, 0, TAU); g.stroke(); }
    this.g.royale?.drawMinimap(g, p, scale);
    for (const c of this.g.combatants) {
      if (c === p || !c.alive || this.hiddenFoe(c, p)) continue;
      const x = (c.pos.x - p.pos.x) * scale, y = (c.pos.z - p.pos.z) * scale;
      g.save(); g.translate(x, y); g.rotate(-p.yaw + Math.PI / 4); g.fillStyle = c.owner === p ? '#7fd0ff' : c.chanting ? '#ff9ae0' : '#ff4a4a'; g.shadowColor = c.owner === p ? '#08f' : '#f00'; g.shadowBlur = 6; g.fillRect(-4, -4, 8, 8); g.restore();
    }
    g.restore();
    g.fillStyle = '#fff'; g.shadowColor = '#000'; g.shadowBlur = 4;
    g.beginPath(); g.moveTo(W / 2, W / 2 - 8); g.lineTo(W / 2 + 6, W / 2 + 6); g.lineTo(W / 2, W / 2 + 2); g.lineTo(W / 2 - 6, W / 2 + 6); g.closePath(); g.fill();
    g.shadowBlur = 0;
  }
  // battle royale radar: foes show within 40 m, or within 80 m while they chant (your voice gives you away)
  hiddenFoe(c, p) { return !!this.g.royale && c.owner !== p && c.pos.distanceTo(p.pos) > (c.chanting ? 80 : 40); }
  updateCompass(p) {
    const W = this.compassWidth;
    const heading = ((-p.yaw * 180) / Math.PI % 360 + 360) % 360;
    $('compass-strip').style.transform = `translateX(${W / 2 - heading * this.ppd}px)`;
    let h = '';
    for (const c of this.g.combatants) {
      if (c === p || !c.alive || this.hiddenFoe(c, p)) continue;
      const b = (Math.atan2(c.pos.x - p.pos.x, -(c.pos.z - p.pos.z)) * 180) / Math.PI;
      let rel = ((b - heading + 540) % 360) - 180;
      if (Math.abs(rel) < 80) h += `<i style="left:${W / 2 + rel * this.ppd}px"></i>`;
    }
    setHTML($('compass-marks'), h);
  }

  // ---------------- per-frame
  update(dt, cam) {
    const g = this.g, p = g.player;
    if (!p) return;
    const hpF = clamp(p.hp / p.maxHp);
    setStyle($('self-hp'), 'width', hpF * 100 + '%');
    setStyle($('self-lag'), 'width', hpF * 100 + '%');
    setStyle($('self-shield'), 'width', clamp(p.shield / 300) * 100 + '%');
    setText($('self-hp-num'), `${Math.ceil(p.hp)}${p.shield > 0 ? ` +${Math.ceil(p.shield)}` : ''}`);
    setStyle($('self-mana'), 'width', clamp(p.mana / p.maxMana) * 100 + '%');
    setText($('self-mana-num'), Math.floor(p.mana));
    setStyle($('self-stam'), 'width', p.stamina + '%');
    const cost = g.previewCost || 0, costEl = $('self-cost');
    if (cost > 0) { const l = clamp((p.mana - cost) / p.maxMana); costEl.style.left = l * 100 + '%'; costEl.style.width = Math.min(cost / p.maxMana, p.mana / p.maxMana) * 100 + '%'; }
    else costEl.style.width = 0;
    setHTML($('self-auras'), p.aura ? elChip(p.aura.el, 'aura-chip') : '');
    setHTML($('self-status'), this.statusTags(p));
    this.flash = Math.max(0, this.flash - dt * 2.5); setStyle($('screen-flash'), 'opacity', this.flash);
    this.hurt = Math.max(0, this.hurt - dt * 1.5);
    const low = hpF < 0.3 && p.alive ? 0.35 + Math.sin(performance.now() / 250) * 0.15 : 0;
    setStyle($('hurt-vignette'), 'opacity', Math.max(this.hurt, low));
    setStyle($('frost-overlay'), 'opacity', p.frozen > 0 ? 1 : 0);
    this.hitm = Math.max(0, this.hitm - dt * 5); setStyle($('hitmarker'), 'opacity', this.hitm);
    this.updateDirs(dt);
    this.updateCompass(p);
    if ((this._mmT = (this._mmT || 0) + 1) % 2 === 0) this.drawMinimap(p); // 30 Hz is plenty
    this.updatePlates(cam);
    // chant bubble over the chanting enemy
    const bub = $('bubble');
    const chanter = g.combatants.find((c) => c !== p && c.chanting && c.chantText && c.alive);
    const sp = chanter && this.project(chanter.pos.clone().setY(chanter.pos.y + 2.9), cam);
    if (sp) { bub.classList.remove('hidden'); bub.style.left = sp.x + 'px'; bub.style.top = sp.y + 'px'; bub.textContent = '“' + chanter.chantText + '”'; }
    else bub.classList.add('hidden');
    for (let i = this.pops.length - 1; i >= 0; i--) {
      const o = this.pops[i]; o.t += dt;
      o.pos.y += dt * o.vy; o.vy *= 1 - dt * 1.5;
      const s2 = this.project(o.pos, cam), k = o.t / o.life;
      if (!s2 || k >= 1) { if (k >= 1) { o.el.remove(); this.pops.splice(i, 1); } else o.el.style.opacity = 0; continue; }
      const sc = o.t < 0.12 ? 1 + (1 - o.t / 0.12) * 0.9 : 1;
      o.el.style.transform = `translate(${s2.x}px, ${s2.y}px) translate(-50%,-50%) scale(${sc})`;
      o.el.style.opacity = k > 0.7 ? (1 - k) / 0.3 : 1;
    }
    if (this.cardTimer > 0) { this.cardTimer -= dt; if (this.cardTimer <= 0) $('spell-card').classList.add('hidden'); }
    if (this.replyTimer > 0) { this.replyTimer -= dt; if (this.replyTimer <= 0) $('jev-reply').classList.add('hidden'); }
  }
  updatePlates(cam) {
    const g = this.g, box = $('nameplates'), seen = new Set();
    for (const c of g.combatants) {
      if (c === g.player || !c.alive) continue;
      seen.add(c);
      let el = this.plates.get(c);
      if (!el) { el = document.createElement('div'); el.className = 'np'; el.innerHTML = '<div class="nm"></div><div class="hb"><i></i><u></u></div><div class="st"></div>'; box.appendChild(el); this.plates.set(c, el); }
      const top = c.pos.clone().setY(c.pos.y + 2.25), sp = this.project(top, cam);
      const d = cam.position.distanceTo(top);
      if (!sp || d > 90) { el.style.display = 'none'; continue; }
      el.style.display = '';
      const sc = clamp(1.3 - d / 70, 0.55, 1.1);
      el.style.transform = `translate(${sp.x}px, ${sp.y}px) translate(-50%,-100%) scale(${sc})`;
      setHTML(el.children[0], `${c.aura ? elChip(c.aura.el, 'aura-chip') : ''}<span>${c.name}</span>`);
      el.children[1].children[0].style.width = clamp(c.hp / c.maxHp) * 100 + '%';
      el.children[1].children[1].style.width = clamp(c.shield / 300) * 100 + '%';
      setHTML(el.children[2], this.statusTags(c) + (c.chanting ? `<span class="status-tag" style="color:#ff8fb0">${t('st.chanting')}</span>` : ''));
    }
    for (const [c, el] of this.plates) if (!seen.has(c)) { el.remove(); this.plates.delete(c); }
  }
  project(v, cam) {
    const p = v.clone().project(cam);
    if (p.z > 1 || p.z < -1) return null;
    return { x: (p.x * 0.5 + 0.5) * innerWidth, y: (-p.y * 0.5 + 0.5) * innerHeight };
  }
  // battle royale: show what the caster's relics add to this cast
  bonusTag(spec, who) {
    const c = who ? this.g.combatants.find((o) => o.name === who) : this.g.player;
    if (!c?.affinity) return '';
    const k = (1 + (c.affinity[spec.element] || 0)) * (c.allDmg || 1) - 1;
    return k > 0.001 ? `<span class="sc-dmg" style="color:#ffd46a">+<b>${Math.round(k * 100)}%</b> ${t('relics')}</span>` : '';
  }
  statusTags(c) {
    let s = '';
    if (c.frozen > 0) s += `<span class="status-tag" style="color:#9ff0ff">${t('st.frozen')}</span>`;
    if (c.defDown > 0) s += `<span class="status-tag" style="color:#c6b8ff">${t('st.super')}</span>`;
    if (c.stun > 0) s += `<span class="status-tag" style="color:#d59bff">${t('st.stun')}</span>`;
    for (const d of c.dots) s += `<span class="status-tag" style="color:${hex(ELEMENTS[d.el]?.color ?? 0xffffff)}">${t(d.el === 'fire' ? 'st.burn' : d.el === 'lightning' ? 'st.charged' : d.el === 'poison' ? 'st.poison' : 'st.afflicted')}</span>`;
    if (c.haste > 0) s += `<span class="status-tag" style="color:#7dffd6">${t('st.haste')}</span>`;
    if (c.mud > 0) s += `<span class="status-tag" style="color:#c0a070">${t('st.mud')}</span>`;
    if (c.weaken > 0) s += `<span class="status-tag" style="color:#b0a0c0">${t('st.weak')}</span>`;
    if (c.curse > 0) s += `<span class="status-tag" style="color:#c22cff">${t('st.curse')}</span>`;
    if (c.flying > 0) s += `<span class="status-tag" style="color:#bff0ff">${t('st.fly')} ${Math.ceil(c.flying)}</span>`;
    if (c.haloN > 0) s += `<span class="status-tag" style="color:#ffe6a0">◌ ${t('st.halo')} ×${c.haloN}</span>`;
    if (c.decoyN > 0 && c === this.g.player) s += `<span class="status-tag" style="color:#d8b8ff">⚇ ${t('st.decoy')} ×${c.decoyN}</span>`;
    for (const [e, v] of Object.entries(c.enh || {})) s += `<span class="status-tag" style="color:${hex(ELEMENTS[e].color)}">${elIcon(e, 11)} ${Math.ceil(v.t)}</span>`;
    return s;
  }

  // ---------------- events
  popup(pos, text, cls, color) {
    const el = document.createElement('div');
    el.className = 'pop ' + cls; el.textContent = text; el.style.color = color;
    $('popups').appendChild(el);
    this.pops.push({ el, pos: pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.6, 0.3, (Math.random() - 0.5) * 0.6)), t: 0, life: cls.includes('react') ? 1.6 : 1.1, vy: cls.includes('react') ? 1.2 : 2.2 });
    if (this.pops.length > 40) { this.pops[0].el.remove(); this.pops.shift(); }
  }
  damage(pos, amount, el, reaction) {
    const c = el && ELEMENTS[el] ? hex(ELEMENTS[el].color) : '#ffffff';
    this.popup(pos, Math.round(amount).toString(), 'dmg' + (reaction ? ' crit' : ''), reaction ? reaction.color : c);
    if (reaction) this.popup(pos.clone().add(new THREE.Vector3(0, 0.7, 0)), reactName(reaction.name), 'react', reaction.color);
  }
  feed(html) {
    const f = $('feed'), d = document.createElement('div');
    d.className = 'feed-line'; d.innerHTML = html; f.appendChild(d);
    while (f.children.length > 6) f.firstChild.remove();
    setTimeout(() => d.remove(), 9000);
  }
  chant(text, cls = '') { const el = $('chant-text'); if (el.textContent !== text) el.textContent = text; if (el.className !== cls) el.className = cls; }
  preview(spec) {
    const pv = $('chant-preview');
    if (!spec) { setHTML(pv, ''); return; }
    const S = SHAPES[spec.shape];
    setHTML(pv, `${elChip(spec.element)}${spec.element2 ? elChip(spec.element2) : ''}<span class="pv">${S.icon} ${shapeName(spec.shape)}</span><span class="pv">${t('rank')} ${roman(spec.tierInt)}</span><span class="pv" style="color:#7ab8ff">${spec.cost} ${t('mana')}</span>${spec.source === 'jev' ? '<span class="pv" style="color:#6dffa8">JEV</span>' : ''}`);
  }
  hint(key) { $('chant-hint-txt').innerHTML = t(key); }
  hintHTML(html) { $('chant-hint-txt').innerHTML = html; }
  tr(key) { return t(key); }
  // a red arc around the crosshair pointing at whoever hit you (merged per attacker, fades out)
  hitFrom(src, amount) {
    if (!src?.pos || !this.g.player) return;
    this.dirs ||= new Map();
    let d = this.dirs.get(src);
    if (!d) { const el = document.createElement('div'); el.className = 'dmg-dir'; $('dmg-dirs').appendChild(el); d = { el, t: 0, src }; this.dirs.set(src, d); }
    d.t = 1.4; d.k = Math.min(1, 0.45 + amount / 80);
  }
  updateDirs(dt) {
    if (!this.dirs) return;
    const p = this.g.player;
    for (const [src, d] of this.dirs) {
      d.t -= dt;
      if (d.t <= 0 || !p) { d.el.remove(); this.dirs.delete(src); continue; }
      const a = Math.atan2(src.pos.x - p.pos.x, src.pos.z - p.pos.z) - Math.atan2(-Math.sin(p.yaw), -Math.cos(p.yaw)); // bearing relative to where you look
      d.el.style.transform = `translate(-50%,-50%) rotate(${-a}rad)`; d.el.style.opacity = Math.min(1, d.t / 0.5) * d.k;
    }
  }
  micState(on) { this.micOn = on; }

  // ---------------- voice waveform: the one indicator for mic level + chant state
  // state: 'off' (no mic), 'idle' (mic open, not chanting: faint live line), 'listen' (chanting: bright, labelled)
  drawWave(dt, state) {
    const W = this.wave, box = $('voice-wave'), cv = W.cv, v = this.g.voice;
    if (W.state !== state) { W.state = state; box.className = state; setText($('voice-wave-state'), t(state === 'listen' ? 'wave.listen' : state === 'idle' ? 'wave.ready' : 'wave.off')); }
    const dpr = Math.min(devicePixelRatio || 1, 2), cw = Math.round(cv.clientWidth * dpr), ch = Math.round(cv.clientHeight * dpr);
    if (!cw || !ch) return;
    if (cv.width !== cw || cv.height !== ch) { cv.width = cw; cv.height = ch; }
    W.t += dt;
    const buf = v?.analyser ? v.buf : null, n = W.pts.length, lv = v?.level || 0;
    const target = state === 'listen' ? 1 : state === 'idle' ? 0.45 : 0.12;
    W.env += (target - W.env) * Math.min(1, dt * 8);
    const k = Math.min(1, dt * 28);
    for (let i = 0; i < n; i++) {
      const x = i / (n - 1);
      let y = 0;
      if (buf && state !== 'off') { const j = Math.floor(x * (buf.length - 2)); y = (buf[j] + buf[j + 1]) * 2.4; } // raw time-domain: a real zig-zag, not a fake sine
      y += Math.sin(x * 26 - W.t * 5.5) * (0.035 + lv * 0.12) * (state === 'listen' ? 1 : 0.4); // a live carrier so a silent listen still breathes
      y = Math.max(-1, Math.min(1, y));
      W.pts[i] += (y - W.pts[i]) * k;
    }
    const c = cv.getContext('2d'), mid = ch / 2, amp = ch * 0.44 * (0.35 + 0.65 * W.env);
    c.clearRect(0, 0, cw, ch);
    const col = state === 'off' ? '#8a8f9c' : this.elColor || '#ffffff';
    const path = () => {
      c.beginPath();
      for (let i = 0; i < n; i++) {
        const x = i / (n - 1), taper = Math.pow(Math.sin(Math.PI * x), 1.4);
        const px = x * cw, py = mid + W.pts[i] * amp * taper;
        i ? c.lineTo(px, py) : c.moveTo(px, py);
      }
    };
    c.lineJoin = 'round'; c.lineCap = 'round';
    path(); c.strokeStyle = col; c.globalAlpha = 0.18 * W.env + 0.05; c.lineWidth = 7 * dpr; c.shadowColor = col; c.shadowBlur = 18 * dpr; c.stroke();
    path(); c.globalAlpha = 0.55 + 0.45 * W.env; c.lineWidth = 2.4 * dpr; c.shadowBlur = 8 * dpr; c.stroke();
    path(); c.strokeStyle = '#ffffff'; c.globalAlpha = 0.35 + 0.5 * W.env; c.lineWidth = 1 * dpr; c.shadowBlur = 0; c.stroke();
    c.globalAlpha = 1;
    if (state === 'listen') setText($('voice-wave-db'), v?.analyser && Number.isFinite(v.dbfs) ? `${Math.max(-99, Math.round(v.dbfs))} dBFS` : '');
  }
  clearSpellInfo() {
    this.cardTimer = 0; this.replyTimer = 0;
    $('spell-card').classList.add('hidden');
    $('jev-reply').classList.add('hidden');
  }
  jevReply(raw, chant, persistent = false) {
    if (!raw) return;
    $('jr-chant').textContent = `“${chant}”`;
    $('jr-model').textContent = raw.model || '';
    $('jr-json').textContent = JSON.stringify(raw, null, 2);
    $('jr-readout').innerHTML = this.jevReadout(raw);
    $('jev-reply').classList.remove('hidden');
    this.jrView(this.jrRaw);
    this.replyTimer = persistent ? Infinity : 6;
  }
  jevPending(chant, persistent = false) {
    this.jevFailure(chant, persistent, t('chant.jevwait'));
  }
  jevFailure(chant, persistent = false, message = t('chant.jeverror')) {
    setText($('jr-chant'), `“${chant}”`);
    setText($('jr-model'), '');
    setText($('jr-readout'), message);
    setText($('jr-json'), message);
    $('jev-reply').classList.remove('hidden');
    this.replyTimer = persistent ? Infinity : 6;
  }
  // every Jev answer as one row: key, pick, confidence, and its top alternatives as a stacked probability strip
  jevReadout(raw) {
    const esc = (x) => String(x).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
    const answers = raw.answers && typeof raw.answers === 'object' ? raw.answers : {};
    const rows = Object.entries(answers).map(([key, a]) => {
      if (!a || typeof a !== 'object') return `<div class="jr-row"><span class="jr-k">${esc(key)}</span><span class="jr-v">${esc(JSON.stringify(a))}</span></div>`;
      const probs = a.probabilities && typeof a.probabilities === 'object'
        ? Object.entries(a.probabilities).filter(([, p]) => typeof p === 'number').sort((x, y) => y[1] - x[1]) : [];
      let pick = a.choice ?? a.value ?? a.score ?? a.noul ?? probs[0]?.[0] ?? '—';
      if (typeof pick === 'number') pick = Math.round(pick * 100) / 100;
      const conf = typeof a.confidence === 'number' ? a.confidence : probs[0]?.[1];
      const top = probs.slice(0, 3), rest = Math.max(0, 1 - top.reduce((s2, [, p]) => s2 + p, 0));
      const strip = top.map(([, p], i) => `<i class="t${i}" style="flex:${Math.max(0.001, p)}"></i>`).join('') + `<i style="flex:${rest}"></i>`;
      const alts = top.map(([k2, p]) => `<span>${esc(k2)} <b>${Math.round(p * 100)}</b></span>`).join('');
      return `<div class="jr-row"><span class="jr-k">${esc(key)}</span><span class="jr-v">${esc(pick)}</span>`
        + `<span class="jr-c">${conf != null ? Math.round(conf * 100) + '%' : ''}</span>`
        + (top.length ? `<div class="jr-strip">${strip}</div><div class="jr-alts">${alts}</div>` : '')
        + `</div>`;
    });
    return rows.join('') || '<div class="jr-row"><span class="jr-k">—</span></div>';
  }
  jrView(raw) {
    this.jrRaw = raw;
    $('jr-json').classList.toggle('hidden', !raw); $('jr-readout').classList.toggle('hidden', raw);
    $('jr-mode').textContent = t(raw ? 'jr.raw' : 'jr.readout');
    $('jr-body').scrollTop = 0; this.jrThumb();
  }
  toggleJevView() { if (!$('jev-reply').classList.contains('hidden')) this.jrView(!this.jrRaw); }
  // pointer lock sends the wheel to the canvas, so the game forwards it here while the panel is up
  scrollJev(dy) {
    if ($('jev-reply').classList.contains('hidden')) return false;
    $('jr-body').scrollBy({ top: dy, behavior: 'smooth' });
    if (this.replyTimer !== Infinity) this.replyTimer = Math.max(this.replyTimer, 8); // being read: don't yank it away
    return true;
  }
  jrThumb() {
    const b = $('jr-body'), th = $('jr-thumb'), f = Math.min(1, b.clientHeight / Math.max(1, b.scrollHeight)), h = Math.max(8, f * 100);
    th.parentElement.style.opacity = f >= 0.999 ? 0 : 1;
    th.style.height = h + '%';
    th.style.top = (b.scrollTop / Math.max(1, b.scrollHeight - b.clientHeight)) * (100 - h) + '%';
  }
  spellCard(spec, casterName) {
    const card = $('spell-card');
    card.classList.remove('hidden');
    card.style.animation = 'none'; void card.offsetWidth; card.style.animation = '';
    card.style.setProperty('--el', hex(ELEMENTS[spec.element].color));
    $('sc-tier-num').textContent = roman(spec.tierInt);
    $('sc-tier-name').textContent = tierName(spec.tierInt);
    $('sc-stars').textContent = '◆'.repeat(Math.max(1, Math.round(spec.mag * 4)));
    $('sc-name').textContent = spec.name;
    $('sc-el').innerHTML = elChip(spec.element);
    $('sc-el2').innerHTML = spec.element2 ? elChip(spec.element2) : '';
    $('sc-shape').textContent = `${SHAPES[spec.shape].icon} ${shapeName(spec.shape)}${spec.substance && spec.substance !== 'native' ? ' · ' + t('sub.' + spec.substance) : ''}`;
    const src = $('sc-src');
    src.className = 'src' + (spec.source === 'jev' ? '' : ' local');
    src.textContent = spec.source === 'jev' ? `JEV · ${spec.partial ? 'live' : spec.cached ? 'cached' : (spec.latency ?? '?') + 'ms'}` : spec.source === 'minilm' ? `MINILM · ${spec.cached ? 'cached' : (spec.latency ?? '?') + 'ms'}` : 'LOCAL';
    $('sc-quote').textContent = `“${spec.text}”${casterName ? ' — ' + casterName : ''}`;
    const P = [['p.power', spec.power], ['p.rank', spec.tier], ['p.speed', spec.speed], ['p.size', spec.size], ['p.heat', spec.temperature], ['p.weight', spec.weight], ['p.edge', spec.sharpness], ['p.count', spec.count], ['p.duration', spec.duration], ['p.chaos', spec.chaos], ['p.height', spec.height ?? 0.5], ['p.width', spec.width ?? 0.5]];
    if (spec.density != null) P.push(['p.density', spec.density]);
    if (spec.luminosity != null) P.push(['p.glow', spec.luminosity]);
    const box = $('sc-params');
    box.innerHTML = P.map(([k, v]) => `<div class="sp"><span class="sp-k">${t(k)}</span><span class="sp-n">${Math.round(v * 100)}</span><span class="pb"><i style="width:0"></i></span></div>`).join('');
    const bars = [...box.querySelectorAll('i')]; // bind now: a second card in the same frame must not mix bar lists
    requestAnimationFrame(() => bars.forEach((i, n) => (i.style.width = Math.round(P[n][1] * 100) + '%')));
    $('sc-cost').innerHTML = `<span class="sc-mana"><b>${spec.cost}</b> ${t('mana')}</span><span class="sc-dmg">×<b>${spec.dmgMult.toFixed(2)}</b> ${t('damage')}</span>${spec.weakened ? `<span class="sc-weak">${t('weakened')}</span>` : ''}${this.bonusTag(spec, casterName)}`;
    this.cardTimer = this.g.mode === 'practice' && !casterName ? Infinity : 6;
  }
  banner(a, b, dur = 3) {
    const el = $('banner'); el.classList.remove('hidden');
    el.querySelector('.b1').textContent = a; el.querySelector('.b2').textContent = b || '';
    el.querySelector('.b1').style.animation = 'none'; void el.offsetWidth; el.querySelector('.b1').style.animation = '';
    clearTimeout(this._bt); this._bt = setTimeout(() => el.classList.add('hidden'), dur * 1000);
  }
  jev(state, text) { const j = $('jev-status'); j.className = state; j.querySelector('.txt').textContent = text; }
  round(txt) { $('round-info').textContent = txt; }
}
