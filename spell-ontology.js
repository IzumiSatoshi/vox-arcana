export const ELEMENTS = {
  fire: 'Fire: flame, heat, burning, magma, inferno, blaze, explosion of flame',
  ice: 'Ice: frost, snow, freezing cold, glacier, blizzard, frozen crystals',
  water: 'Water: waves, tide, ocean, rain, bubbles, torrent, flood',
  lightning: 'Lightning: thunder, electricity, plasma, sparks, thunderbolts',
  wind: 'Wind: air, gale, gust, cyclone, sky currents, blades of wind',
  earth: 'Earth: stone, rock, mountain, sand, metal, gems, crystal of the ground',
  darkness: 'Darkness: shadow, void, abyss, curse, death, night, black flame, demons',
  light: 'Light: holy, radiance, heaven, angels, sunlight, divine judgment',
  nature: 'Nature: plants, vines, thorns, roots, forest, flowers, leaves, life, growth',
  poison: 'Poison: venom, toxins, acid, miasma, plague, disease, corrosion, toxic gas (毒・瘴気・酸)',
  arcane: 'Pure arcane: mana, runes, stars, cosmos, space, time, raw magical force with no natural element',
};
export const SHAPES = {
  orb: 'A single ball projectile thrown at the enemy (fireball, orb, sphere, magic bullet).',
  barrage: 'A volley of many small projectiles fired in rapid succession: arrows, shards, spears, needles, missiles.',
  funnels: 'Summoned floating drones / familiars / wisps / bits that fly around the enemy and shoot it repeatedly (homing funnels).',
  beam: 'A continuous laser, ray, breath or cannon blast channeled in a straight line.',
  tornado: 'A tornado, cyclone, whirlwind or spinning column that travels along the ground.',
  meteor: 'Something crashing down from the sky onto the target: meteor, comet, falling star, sky hammer.',
  nova: 'An explosion or shockwave bursting outward all around the caster (nova, burst, ring blast).',
  spikes: 'Spikes, pillars, spires or eruptions bursting from the ground in a line toward the enemy.',
  barrier: 'A translucent magic barrier / force field raised in front of the caster that stops and absorbs enemy spells, while people can still walk through it (barrier, force field, 結界, バリア).',
  wall: 'A solid physical wall of stone, ice or other matter raised in front of the caster: blocks movement and attacks, can be climbed or stood on (wall, rampart, 壁, 城壁).',
  vortex: 'A black hole, gravity well, whirlpool or singularity that pulls enemies into a point.',
  chain: 'An instant strike that zaps the target directly: chain lightning, smite, thunderbolt, judgment strike.',
  storm: 'A cloud raining damage over an area for a while: rain, hail, blizzard, fire rain, thunderstorm.',
  crescent: 'A flying crescent slash or blade wave: wind cutter, sword arc, scythe slash.',
  ward: 'Healing or a protective shield bubble on the caster: heal, cure, protect me, shield around me.',
  field: 'A lingering zone left on the ground: poison pool, burning ground, glyph/rune circle, quagmire, electrified field, frozen floor.',
  wave: 'A huge advancing wave or wall that rolls forward along the ground: tidal wave, tsunami, avalanche, rolling wall of flame.',
  enhance: 'Empower or infuse the caster\'s own body with an element (speed, strength, armor, regeneration, elemental coating). Not a plain heal.',
  hand: 'Summon a persistent giant spectral hand, fist, arm or familiar weapon that floats beside the caster and attacks by itself.',
  leap: 'Launch the caster high into the air in one magical jump.',
  flight: 'Let the caster fly, levitate or hover for a while.',
  blink: 'Teleport, warp, dash through space or blink the caster to another spot.',
  construct: 'Build a solid physical structure to stand on or hide behind: platform, floor, bridge, stairs, box, pillar, tower, fortress rampart.',
};
export const TRAITS = {
  trajectory: {
    instructions: 'How does the magic travel? Pick the motion the words imply; default to straight when nothing is said.',
    criteria: {
      straight: 'Flies straight at the target.', arc: 'Lobbed in a high arc like a thrown grenade or catapult.', spiral: 'Corkscrews / spirals / twists around its path.',
      zigzag: 'Zigzags or jitters erratically like lightning.', boomerang: 'Flies out and comes back to the caster.', orbit: 'First circles around the caster, then launches.',
      serpentine: 'Snakes and slithers like a dragon or serpent.', homing: 'Seeks, chases or hunts the target.',
    },
  },
  pattern: {
    instructions: 'How many copies are emitted and in what arrangement? Default single.',
    criteria: {
      single: 'One instance.', fan: 'A spread / fan of several at once.', ring: 'All around the caster in every direction.', cascade: 'A rapid stream one after another.',
      crossfire: 'From both sides converging on the target.', rain: 'Falling down from the sky over the target.', spiral: 'A rotating spiral stream.', swarm: 'A chaotic swarm or flock.',
    },
  },
  payload: {
    instructions: 'What happens when the magic lands or ends? Default explode.',
    criteria: {
      explode: 'Explodes.', split: 'Bursts into many smaller fragments or shrapnel.', linger: 'Leaves a lingering pool, fire, cloud or zone behind.', erupt: 'Erupts upward as a pillar, geyser or column.',
      chain: 'Arcs or jumps onward to other targets.', implode: 'Collapses inward, pulling things in, then bursts.', echo: 'Repeats in aftershocks / echoes several times.',
      crystallize: 'Grows crystals, thorns or spikes out of the ground where it hits.', none: 'Nothing special, just hits.',
    },
  },
  morph: {
    instructions: 'What does the magic itself look like? Default orb.',
    criteria: {
      orb: 'A ball or sphere.', lance: 'A spear, lance, javelin, arrow or needle.', shard: 'Crystal shards or jagged fragments.', disc: 'A spinning disc, ring, wheel or chakram.',
      star: 'A star or glittering sparkle.', blade: 'A blade or sword.', dragon: 'A dragon, serpent, phoenix, wolf or other beast shape.', skull: 'A skull, ghost, spirit or wraith.',
      bubble: 'A bubble or droplet.', cube: 'A cube, block or geometric solid.',
    },
  },
  substance: {
    instructions: 'What is the magic made of, visually? Judge the imagery of the words, not just the element. Default native when the words only name the element.',
    criteria: {
      native: 'The ordinary look of its element (a plain fireball, a plain ice shard).',
      magma: 'Molten rock, lava, geothermal heat of the earth, volcanic (大地の地熱, 溶岩, マグマ).',
      flame: 'Raging, licking, blazing open flames (烈火, 業火, blazing inferno).',
      plasma: 'Blue or white-hot plasma, solar or stellar fire, crackling energy (蒼炎, 太陽).',
      smoke: 'Smoke, ash, soot, smouldering cinders (煙, 灰).',
      crystal: 'Crystal, gems, glass or prisms (結晶, 水晶).',
      liquid: 'Flowing liquid, dripping fluid.',
      mist: 'Mist, fog, steam, vapour (霧, 蒸気).',
      spectral: 'Ghostly, spectral, phantom, soul-like (幽霊, 亡霊).',
      radiant: 'Holy, golden, sacred radiance (聖なる, 黄金).',
      corrupted: 'Cursed, hellish, black or profane (呪い, 地獄, 黒炎).',
    },
  },
  construct: {
    instructions: 'If the incantation builds a structure, which kind? Otherwise platform.',
    criteria: { platform: 'A floor, platform or bridge.', stairs: 'Stairs or a staircase.', box: 'A box, cube or block.', pillar: 'A pillar, column or tower.', rampart: 'A thick fortress wall or rampart.' },
  },
};
export const SCORES = {
  power: {
    levels: ['feeble', 'weak', 'modest', 'standard', 'strong', 'powerful', 'devastating', 'cataclysmic', 'world-ending'],
    instructions: 'How much raw power does this incantation convey? A plain name like "Fireball" is standard. Grandiose, invoking incantations with superlatives (ultimate, supreme, gods, ancient, forbidden, all the power of...) are cataclysmic or world-ending. Diminutives (tiny, little, weak) lower it.',
  },
  tier: {
    levels: ['cantrip', 'novice', 'adept', 'expert', 'master', 'archmage', 'legendary', 'mythic', 'divine'],
    instructions: 'Rank of the spell judged by the ceremony of the incantation. One or two plain words = novice. Summoning spirits, invoking gods or elements, multi-clause chants, oaths and dramatic declarations push it toward legendary, mythic or divine.',
  },
  speed: { levels: ['glacial', 'slow', 'moderate', 'fast', 'lightning-fast'], instructions: 'How fast should the spell travel or act?' },
  size: { levels: ['tiny', 'small', 'medium', 'large', 'huge', 'colossal'], instructions: 'Physical size / area of effect of the spell.' },
  temperature: {
    levels: ['absolute zero', 'freezing', 'cold', 'cool', 'neutral', 'warm', 'hot', 'scorching', 'inferno', 'stellar core'],
    instructions: 'Temperature of the magic. Ice is freezing, ordinary fire is hot, blue/white/solar fire is stellar core, non-thermal magic is neutral.',
  },
  weight: { levels: ['weightless', 'light', 'medium', 'heavy', 'crushing'], instructions: 'How heavy / massive is the spell (rock and meteors are heavy, light and wind are weightless)?' },
  sharpness: { levels: ['blunt', 'rounded', 'edged', 'keen', 'razor-sharp'], instructions: 'How sharp / piercing is the spell (blades, lances, needles are sharp; orbs and hammers are blunt)?' },
  count: { levels: ['single', 'a pair', 'a few', 'many', 'countless'], instructions: 'How many projectiles or instances are described?' },
  duration: { levels: ['instant', 'brief', 'moderate', 'sustained', 'lingering'], instructions: 'How long does the spell persist?' },
  chaos: { levels: ['precise', 'controlled', 'unstable', 'chaotic'], instructions: 'How wild and unstable is the magic?' },
  height: {
    levels: ['flat', 'low', 'medium', 'tall', 'towering'],
    instructions: 'Vertical proportion of the spell. Ground-hugging, crawling or earth-bound imagery (大地, 地を這う) is flat or low; rising, soaring, heaven-piercing imagery (天高く立ち昇る, towering pillar) is tall or towering.',
  },
  width: {
    levels: ['needle-thin', 'narrow', 'medium', 'wide', 'vast'],
    instructions: 'Horizontal spread of the spell. Focused, slender or pinpoint = narrow; sweeping, spreading over the land, engulfing everything = wide or vast.',
  },
  density: {
    levels: ['ethereal', 'wispy', 'medium', 'dense', 'solid'],
    instructions: 'How much matter the magic has. Ghostly, misty, airy = ethereal; molten rock, thick smoke, heavy stone = dense or solid.',
  },
  luminosity: {
    levels: ['smouldering', 'dim', 'glowing', 'bright', 'blinding'],
    instructions: 'How brightly the magic shines. Embers, geothermal heat, shadow = smouldering or dim; raging flame is bright; holy or solar light is blinding.',
  },
};

