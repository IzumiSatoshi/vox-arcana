import { fileURLToPath } from 'node:url';
import { ELEMENTS, SHAPES, TRAITS, SCORES } from './spell-ontology.js';

export const MODEL = 'Xenova/paraphrase-multilingual-MiniLM-L12-v2';
const clamp = x => Math.max(0, Math.min(1, x));
export const cosine = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0); // normalized vectors
const DEFAULTS = { power: 0.30, tier: 0.125, speed: 0.5, size: 0.4, temperature: 0.5, weight: 0.5, sharpness: 0.25, count: 0, duration: 0.25, chaos: 0.25, height: 0.5, width: 0.5, density: 0.5, luminosity: 0.5 };
const ELEMENT_WORDS = {
  fire: 'fire|flame|炎|火炎|火球', ice: 'ice|frost|氷|氷結', water: 'water|水|水流', lightning: 'lightning|thunder|雷|雷撃',
  wind: 'wind|風', earth: 'stone|earth|岩|大地', darkness: 'shadow|darkness|闇|影', light: 'holy light|光|聖なる光',
  nature: 'plants|vines|植物|蔓', poison: 'poison|毒|瘴気', arcane: 'arcane magic|魔力',
};
const SHAPE_EXAMPLES = {
  orb: 'fireball|ice ball|火球|氷の球', barrage: 'ice spear|fire arrows|氷の槍|炎の矢|矢の雨',
  funnels: 'homing drones|追尾する使い魔', beam: 'laser beam|光線', tornado: 'fire tornado|炎の竜巻|氷の竜巻',
  meteor: 'falling meteor|隕石', nova: 'explosion around me|周囲への爆発', spikes: 'spikes from the ground|大地の棘',
  wall: 'stone wall|defensive wall|石の壁|防壁', barrier: 'magic barrier|force field|バリア|結界', vortex: 'black hole|ブラックホール', chain: 'lightning strike|雷撃', storm: 'blizzard|吹雪',
  crescent: 'flying blade slash|飛ぶ斬撃', ward: 'heal me|protect me|回復|私を癒せ', field: 'poison pool|毒の沼',
  wave: 'tidal wave|津波', enhance: 'strengthen my body|身体強化', hand: 'summon a giant fist|巨大な拳を召喚',
  leap: 'jump high|高く跳べ', flight: 'let me fly|空を飛ぶ', blink: 'teleport|瞬間移動', construct: 'build stairs|階段を作る',
  whip: 'fire whip|lash|炎の鞭', prison: 'cage the enemy|prison of ice|氷の牢獄|檻', decoy: 'create clones of me|分身|幻影', drain: 'drain their life|吸収|ドレイン',
  beast: 'summon a fire dragon|serpent|炎の龍|召喚獣', halo: 'blades orbiting around me|光の円環', sword: 'giant sword from the sky|聖剣|天の大剣',
  rush: 'charge forward|突進|体当たり', totem: 'turret that shoots|totem|祭壇|砲台', mark: 'death mark|curse brand|呪印|刻印',
};
const TRAIT_DEFAULTS = { trajectory: 'straight', pattern: 'single', payload: 'explode', morph: 'orb', substance: 'native', construct: 'platform' };

// Encode reference descriptions once. Each chant needs only one encoder pass.
export function referenceGroups() {
  const groups = { element: ELEMENTS, shape: SHAPES };
  for (const [key, value] of Object.entries(TRAITS)) groups[key] = value.criteria;
  for (const [key, value] of Object.entries(SCORES)) groups[key] = Object.fromEntries(value.levels.map(level => [level, `${level} ${key} magic spell`]));
  groups.intent = {
    magic: 'Cast a magic spell. Fireball, ice spear, lightning attack, heal me, teleport, summon a magical shield.',
    chat: 'Hello, how are you? Thank you. What time is it? I want to eat lunch. This is ordinary conversation.',
  };
  return groups;
}

export class LocalSpellModel {
  constructor(createEncoder) {
    this.createEncoder = createEncoder; this.phase = 'unloaded'; this.error = null;
    this.cache = new Map(); this.pending = new Map(); this.queue = Promise.resolve();
  }
  status() { return { model: MODEL, phase: this.phase, error: this.error }; }
  async load() {
    if (this.loading) return this.loading;
    this.phase = 'loading'; this.error = null;
    this.loading = (async () => {
      this.encoder ||= await this.createEncoder();
      this.groups = referenceGroups(); this.refs = [];
      for (const [group, choices] of Object.entries(this.groups)) {
        for (const [label, description] of Object.entries(choices)) {
          this.refs.push({ group, label, text: description });
          if (group === 'element' || group === 'shape') this.refs.push({ group, label, text: `${label} magic spell` });
        }
      }
      for (const [label, words] of Object.entries(ELEMENT_WORDS)) {
        for (const text of words.split('|')) this.refs.push({ group: 'element', label, text });
      }
      for (const [label, words] of Object.entries(SHAPE_EXAMPLES)) {
        for (const text of words.split('|')) this.refs.push({ group: 'shape', label, text });
      }
      // Matched form templates keep a tornado from implying lightning by association.
      const enForms = ['ball', 'spears', 'drones', 'beam', 'tornado', 'meteor', 'explosion', 'spikes', 'wall', 'barrier', 'vortex', 'strike', 'storm', 'blade', 'shield', 'pool', 'wave', 'body enhancement', 'giant hand', 'jump', 'flight', 'teleport', 'stairs'];
      const jaForms = ['球', '槍', '使い魔', '光線', '竜巻', '隕石', '爆発', '棘', '壁', 'バリア', '渦', '一撃', '嵐', '刃', '盾', '沼', '波', '身体強化', '巨大な手', '跳躍', '飛行', '瞬間移動', '階段'];
      const jaElements = ['炎', '氷', '水', '雷', '風', '岩', '闇', '光', '植物', '毒', '魔力'];
      Object.keys(ELEMENTS).forEach((label, i) => {
        enForms.forEach(form => this.refs.push({ group: 'element', label, text: `${label} ${form}` }));
        jaForms.forEach(form => this.refs.push({ group: 'element', label, text: `${jaElements[i]}の${form}` }));
      });
      for (const text of ['heal me', 'protect me', 'teleport', 'let me fly', '私を癒せ', '回復', '空を飛ぶ', '瞬間移動']) this.refs.push({ group: 'element', label: 'arcane', text });
      for (const text of ['Hello', 'How are you?', 'Thank you', 'Thanks for helping me', 'What time is it?', 'I am hungry', 'How was your day?', 'I like ice cream', 'こんにちは', 'ありがとう', 'お元気ですか', 'お腹が空いた', '今日はいい天気ですね']) this.refs.push({ group: 'intent', label: 'chat', text });
      this.vectors = [];
      for (let i = 0; i < this.refs.length; i += 16) this.vectors.push(...await this.encoder(this.refs.slice(i, i + 16).map(r => r.text)));
      this.phase = 'ready';
    })().catch(e => { this.phase = 'error'; this.error = e.message; this.loading = null; throw e; });
    return this.loading;
  }
  async interpret(text) {
    if (this.phase !== 'ready') throw new Error('Local MiniLM is not ready. Use Load local model in Settings first.');
    const key = text.trim().toLowerCase();
    if (this.cache.has(key)) return { ...this.cache.get(key), cached: true, latency: 0 };
    if (this.pending.has(key)) return this.pending.get(key);
    if (this.pending.size >= 8) throw new Error('Local model busy; try again after the current chants finish.');
    const work = this.queue.then(async () => {
      const start = performance.now();
      const [vector] = await this.encoder([text]);
      const rankings = {};
      this.refs.forEach((r, i) => {
        const group = rankings[r.group] ||= {};
        group[r.label] = Math.max(group[r.label] ?? -1, cosine(vector, this.vectors[i]));
      });
      const sorted = key => Object.entries(rankings[key]).sort((a,b) => b[1] - a[1]);
      const [el, elScore] = sorted('element')[0], [shape, shapeScore] = sorted('shape')[0];
      // Similarity is not a calibrated probability. Conservative defaults for weak evidence.
      const params = { ...DEFAULTS, element: elScore >= 0.45 ? el : 'arcane', element2: null, elementConf: clamp(elScore), shape, shapeConf: clamp(shapeScore), homing: 0,
        isSpell: Math.max(elScore, shapeScore) >= 0.30 && Math.max(elScore, shapeScore, rankings.intent.magic) > rankings.intent.chat + 0.03 ? 1 : 0 };
      for (const [key, fallback] of Object.entries(TRAIT_DEFAULTS)) {
        const [[label, score], second] = sorted(key);
        params[key] = score >= 0.55 && score - second[1] >= 0.08 ? label : fallback;
      }
      for (const [key, { levels }] of Object.entries(SCORES)) {
        const [[label, score], second] = sorted(key);
        if (score >= 0.60 && score - second[1] >= 0.10) params[key] = levels.indexOf(label) / (levels.length - 1);
      }
      if (params.shape !== 'construct') params.construct = 'platform';
      params.homing = params.trajectory === 'homing' ? 1 : 0;
      const out = { params, model: MODEL, provider: 'local', latency: Math.round(performance.now() - start), cached: false };
      if (this.cache.size >= 300) this.cache.delete(this.cache.keys().next().value);
      this.cache.set(key, out); return out;
    });
    this.queue = work.catch(() => {});
    this.pending.set(key, work);
    try { return await work; } finally { this.pending.delete(key); }
  }
}

export const localModel = new LocalSpellModel(async () => {
  const { pipeline, env } = await import('@huggingface/transformers');
  env.cacheDir = fileURLToPath(new URL('./.cache/models/', import.meta.url));
  const extractor = await pipeline('feature-extraction', MODEL, { dtype: 'q8', device: 'cpu' });
  return async texts => (await extractor(texts, { pooling: 'mean', normalize: true, truncation: true })).tolist();
});
