import * as THREE from 'three';
import { ELEMENTS, SHAPES, tierName, shapeName, reactName } from './elements.js';
import { roman, clamp, TAU } from './util.js';
import { t } from './i18n.js';

const $ = (id) => document.getElementById(id);
const _html = new WeakMap(); // write innerHTML only when it actually changes
const setHTML = (el, h) => { if (_html.get(el) !== h) { _html.set(el, h); el.innerHTML = h; } };
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
    this.mm = $('minimap').getContext('2d');
  }
  show(v) { this.root.classList.toggle('hidden', !v); }
  setEl(el) { document.documentElement.style.setProperty('--el', el ? hex(ELEMENTS[el].color) : '#ffffff'); if (el && this._pel !== el) { this._pel = el; $('portrait-icon').innerHTML = elIcon(el, 34); } }

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
    const R = 90, img = g.createImageData(S, S);
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
    const g = this.mm, W = 180, scale = 2.0; // px per metre
    g.save(); g.clearRect(0, 0, W, W);
    g.beginPath(); g.arc(W / 2, W / 2, W / 2, 0, TAU); g.clip();
    g.fillStyle = '#28462a'; g.fillRect(0, 0, W, W);
    g.translate(W / 2, W / 2); g.rotate(p.yaw);
    if (this.mmBg) { const s = (2 * this.mmR * scale); g.drawImage(this.mmBg, -p.pos.x * scale - s / 2, -p.pos.z * scale - s / 2, s, s); }
    // threats (area spells)
    for (const th of this.g.spells.threatsFor(p)) if (th.area) { g.strokeStyle = 'rgba(255,90,90,0.9)'; g.lineWidth = 2; g.beginPath(); g.arc((th.pos.x - p.pos.x) * scale, (th.pos.z - p.pos.z) * scale, th.radius * scale, 0, TAU); g.stroke(); }
    for (const c of this.g.combatants) {
      if (c === p || !c.alive) continue;
      const x = (c.pos.x - p.pos.x) * scale, y = (c.pos.z - p.pos.z) * scale;
      g.save(); g.translate(x, y); g.rotate(-p.yaw + Math.PI / 4); g.fillStyle = c.chanting ? '#ff9ae0' : '#ff4a4a'; g.shadowColor = '#f00'; g.shadowBlur = 6; g.fillRect(-4, -4, 8, 8); g.restore();
    }
    g.restore();
    g.fillStyle = '#fff'; g.shadowColor = '#000'; g.shadowBlur = 4;
    g.beginPath(); g.moveTo(W / 2, W / 2 - 8); g.lineTo(W / 2 + 6, W / 2 + 6); g.lineTo(W / 2, W / 2 + 2); g.lineTo(W / 2 - 6, W / 2 + 6); g.closePath(); g.fill();
    g.shadowBlur = 0;
  }
  updateCompass(p) {
    const W = $('compass').clientWidth;
    const heading = ((-p.yaw * 180) / Math.PI % 360 + 360) % 360;
    $('compass-strip').style.transform = `translateX(${W / 2 - heading * this.ppd}px)`;
    let h = '';
    for (const c of this.g.combatants) {
      if (c === p || !c.alive) continue;
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
    $('self-hp').style.width = hpF * 100 + '%';
    $('self-lag').style.width = hpF * 100 + '%';
    $('self-shield').style.width = clamp(p.shield / 300) * 100 + '%';
    $('self-hp-num').textContent = `${Math.ceil(p.hp)}${p.shield > 0 ? ` +${Math.ceil(p.shield)}` : ''}`;
    $('self-mana').style.width = clamp(p.mana / p.maxMana) * 100 + '%';
    $('self-mana-num').textContent = Math.floor(p.mana);
    $('self-stam').style.width = p.stamina + '%';
    const cost = g.previewCost || 0, costEl = $('self-cost');
    if (cost > 0) { const l = clamp((p.mana - cost) / p.maxMana); costEl.style.left = l * 100 + '%'; costEl.style.width = Math.min(cost / p.maxMana, p.mana / p.maxMana) * 100 + '%'; }
    else costEl.style.width = 0;
    setHTML($('self-auras'), p.aura ? elChip(p.aura.el, 'aura-chip') : '');
    setHTML($('self-status'), this.statusTags(p));
    $('mic-lvl').style.height = (g.voice?.level || 0) * 100 + '%';
    const ch = g.chantProgress || 0;
    $('charge-ring').style.strokeDashoffset = 138.2 * (1 - ch);
    this.flash = Math.max(0, this.flash - dt * 2.5); $('screen-flash').style.opacity = this.flash;
    this.hurt = Math.max(0, this.hurt - dt * 1.5);
    const low = hpF < 0.3 && p.alive ? 0.35 + Math.sin(performance.now() / 250) * 0.15 : 0;
    $('hurt-vignette').style.opacity = Math.max(this.hurt, low);
    $('frost-overlay').style.opacity = p.frozen > 0 ? 1 : 0;
    this.hitm = Math.max(0, this.hitm - dt * 5); $('hitmarker').style.opacity = this.hitm;
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
  micState(on) { document.querySelector('.mic').classList.toggle('off', !on); }
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
    $('sc-shape').textContent = `${SHAPES[spec.shape].icon} ${shapeName(spec.shape)}`;
    const src = $('sc-src');
    src.className = 'src' + (spec.source === 'jev' ? '' : ' local');
    src.textContent = spec.source === 'jev' ? `JEV · ${spec.partial ? 'live' : spec.cached ? 'cached' : (spec.latency ?? '?') + 'ms'}` : 'LOCAL';
    $('sc-quote').textContent = `“${spec.text}”${casterName ? ' — ' + casterName : ''}`;
    const P = [['p.power', spec.power], ['p.rank', spec.tier], ['p.speed', spec.speed], ['p.size', spec.size], ['p.heat', spec.temperature], ['p.weight', spec.weight], ['p.edge', spec.sharpness], ['p.count', spec.count], ['p.duration', spec.duration], ['p.chaos', spec.chaos]];
    const box = $('sc-params');
    box.innerHTML = P.map(([k]) => `<span>${t(k)}</span><span class="pb"><i style="width:0"></i></span>`).join('');
    requestAnimationFrame(() => box.querySelectorAll('i').forEach((i, n) => (i.style.width = Math.round(P[n][1] * 100) + '%')));
    $('sc-cost').textContent = `${spec.cost} ${t('mana')}${spec.weakened ? ' · ' + t('weakened') : ''} · ×${spec.dmgMult.toFixed(2)} ${t('damage')}`;
    this.cardTimer = 6;
  }
  banner(a, b, dur = 3) {
    const el = $('banner'); el.classList.remove('hidden');
    el.querySelector('.b1').textContent = a; el.querySelector('.b2').textContent = b || '';
    el.querySelector('.b1').style.animation = 'none'; void el.offsetWidth; el.querySelector('.b1').style.animation = '';
    clearTimeout(this._bt); this._bt = setTimeout(() => el.classList.add('hidden'), dur * 1000);
  }
  jev(state, text) { const j = $('jev-status'); j.className = state; j.querySelector('.txt').textContent = text; }
  round(txt) { $('round-info').textContent = txt; }
  scoreboard(rows) {
    const el = $('scoreboard');
    if (!rows) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    el.innerHTML = rows.map((r) => `${r.name} — ${r.kills} / ${r.deaths}`).join('<br/>');
  }
}
