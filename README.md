# Vox Arcana: a voice-cast magic duel

A browser FPS magic PvP game where you fight by **speaking incantations**.
Your words go through the Web Speech API, then **Jev** (TypeSafe's System One decision model) turns them into a
procedurally generated spell: an element, a form, and a dozen continuous parameters.

> "Fireball!" → a Novice-rank fireball.
> "Summoning the spirit of fire, gathering the power of the earth, here I will cast the ultimate fireball!" →
> a Legendary **Stone-Fireball**: a gathered sun of flame with a sigil, 2.5× damage and a huge blast.

## Run

```bash
node server.js
```

Then open **http://localhost:8787** in **Chrome or Edge**, which have the Web Speech API. Allow the microphone.

- Node 18+ for Jev/keywords. Run `npm install` to install the optional local-model runtime (Three.js still loads from a CDN).
- The Jev key is read from `../api_key/jev_api.txt`. You can override this with the `JEV_API_KEY` env var, and the endpoint and model with
  `JEV_URL` / `JEV_MODEL` or a `jev.config.json` (`{ "url": "...", "model": "...", "keyFile": "..." }`).
- Set `JEV_DEBUG=1` to print Jev's raw answers in the server console.
- With Jev enabled, player casts use only Jev interpretation. A failed request shows an error; it does not cast via keywords. Disable Jev in Settings to use the local keyword parser. Browser offline speech recognition is a separate voice-to-text setting.

## Local MiniLM option (experimental)

1. Run `npm install`, then `npm start` (restart an already-running server after updating).
2. In **Settings → Spell interpretation model**, choose **Local MiniLM (CPU, experimental)**.
3. Click **Download / load local model** and wait for **MiniLM ready**. Keep **Use selected model** enabled.
   Disabling that checkbox selects the existing keyword parser. The rival's model toggle uses the same selected provider.

Model: [Xenova/paraphrase-multilingual-MiniLM-L12-v2](https://huggingface.co/Xenova/paraphrase-multilingual-MiniLM-L12-v2),
a quantized BERT-style multilingual sentence encoder, via Transformers.js on the **Node server's CPU**.
It supports English/Japanese matching, needs no API key, and has no per-cast API charge.
The first load downloads about **136 MB** of model/tokenizer files to `.cache/models/`.
Later loads reuse those files, but rebuilding the reference embeddings takes several seconds after each server restart.
If the game server is on another machine, inference runs on that machine.
This option only replaces spell interpretation; browser speech recognition and CDN game assets are separate.

The encoder compares a chant against cached spell descriptions and bilingual examples. It does not generate text
or follow Jev's question instructions. It selects element/form and uses conservative defaults where trait/score
similarity is weak. Similarity values are **not calibrated probabilities**. Secondary-element fusion is currently
omitted. Complex negation, multiple effects, metaphor, and finely graded power can be less reliable than Jev.
The existing gameplay bonuses still apply after interpretation. No cloud fallback occurs if the local model fails.

A local development smoke run measured **12–23 ms** per warm, uncached chant and about **6.6 seconds** to load
cached weights and build references. Hardware, chant length and concurrent requests affect latency; this is not
a general benchmark. Identical chants are cached, duplicate in-flight requests share work, and inference is serialized
with a bounded queue. Status and load errors appear in Settings. Jev remains the default for existing users.

Validation: `npm test` runs regression tests without downloading a model; `npm run test:local` loads the real model
(and downloads it if necessary) and checks English/Japanese reference examples plus chatter rejection. Those examples
are smoke checks, not a held-out accuracy evaluation.

## Language / 言語

Use the **EN / 日本語** toggle on the title screen, or go to Settings. Japanese mode localizes the UI, spell names (e.g. 「究極・岩・紅蓮の火球」),
reactions and statuses, and switches voice recognition to `ja-JP`. The rival also chants in Japanese
(e.g. 「天よ、裂けよ、雷の裁き！」) and speaks it with a Japanese voice.

## Controls

| | |
|---|---|
| **Hold F / Right-click** | chant (speak), release the latest Jev-recognized spell (instant mode defaults on) |
| **Enter** | type an incantation instead (a channel time scales with its length) |
| **Left-click** | mana bolt (uses your last element) |
| WASD / Space (hold to glide) / Shift / E / Ctrl | move / jump (ascend while flying) / sprint / dash / descend while flying |
| Esc | pause |

Optional **hands-free mode** (Settings) casts whenever you say something that contains a spell.

## How a spell is made

1. **Voice**: each chant owns an isolated Web Speech recognition session with live interim results. Normal browser
   microphone recognition is the default. Previous sessions and delayed corrections cannot reappear in a new chant.
   Offline recognition and next-session preparation are separate opt-ins in Settings. Preparation now starts ordinary
   microphone recognition between casts. Idle words are discarded; pause/menu stops listening. Each completed cast
   retires its recognizer before preparing a fresh one. No generated audio track is used for microphone gameplay.
   Existing settings migrate once to disable those previously automatic options. The orb, staff glow and charging
   particles respond to microphone volume before any text arrives. Previews use Jev results when enabled, or the
   keyword parser when Jev is disabled. STT punctuation is removed before display and interpretation. Hold the key before speaking; startup and transcription time depend on the browser.
2. **Speculative Jev**: instant cast is enabled by default. Each changed STT transcript goes directly to Jev,
   without the normal 160 ms throttle or three-request cap. Release casts the newest valid interpretation already
   received, ordered by transcript revision rather than reply arrival. The preview shows that spell. If no magic is
   ready, the game waits for interpretation. Disable instant cast to wait for the exact submitted text instead. If words are missing or still incomplete,
   a grace window of up to 1.8 seconds accepts delayed spell words; pressing again cancels it immediately.
   Direct microphone sessions call `SpeechRecognition.stop()` on release to request pending words. Synthetic
   audio-track test sessions receive silence until pending words arrive. Hands-free mode uses continuous final results.
3. **Jev** (`/api/spell` → `POST https://api.typesafe.ai/v1/systemone`): one request with typed questions:
   - `choice`: element (10), secondary element, form (14)
   - `score`: power, tier/rank, speed, size, temperature, weight, sharpness, count, duration, chaos
   - `noul`: is this actually a spell? should it home in?
4. **Player spell parameters** (`public/js/spellbook.js`): Jev alone when enabled, or keywords alone when disabled.
   Casting time and voice loudness never modify spell strength or characteristics and are not sent to Jev.
   Completed Jev interpretations are authoritative for both player and rival spells; keyword-derived values never override them.
   This gives magnitude, a damage multiplier, mana cost, rank I–IX and a generated name.
   Insufficient mana blocks the cast instead of weakening the interpreted spell.
5. **Procedural runtime** (`public/js/spells.js`, `public/js/spells-extra.js`): 33 forms, each driven by those parameters:
   - Attacks: orb · barrage · homing funnels · beam · tornado · meteor · nova · ground spikes · vortex/black hole · chain strike · storm · crescent · field (lingering pool) · wave (advancing surge)
   - Self: ward (heal/shield) · enhance (elemental buff) · hand (a summoned spectral hand that fights beside you)
   - Utility: leap · flight · blink (teleport) · construct (platform / stairs / box / pillar / rampart, which are solid, walkable and block spells)
   - Defense: wall (barrier)
   - Newer forms (`spells-extra.js`):
     - **whip** (鞭): a lash of the element's matter that sweeps in front of you and drags whatever it hits toward you. Sharp or solid matter grows thorns, and charged matter crackles along the lash.
     - **prison** (牢獄): a cage of bars erupts around the target and holds it inside, slowed and ticking damage, until the bars snap inward and burst.
     - **decoy** (分身): illusory doubles run off in different directions. Rivals target them and they pop when shot, and you blur for a moment.
     - **drain** (吸収): a curved tether that siphons life from the target back to you. It breaks on range or line of sight.
     - **beast** (召喚獣): a serpent dragon of the element rises from a sigil, hunts the nearest foe, makes one or more biting passes, then dives in to finish.
     - **halo** (円環): blades or orbs orbit you. They cut anyone who comes close, and each one can intercept one incoming projectile.
     - **sword** (大剣): a colossal blade forms in the sky above the target and plunges down, stays embedded for a moment, then shatters.
     - **rush** (突進): you become a comet of matter and ram through everything in a line.
     - **totem** (祭壇): a floating crystal obelisk on a stone plinth that fires at foes nearby for a while.
     - **mark** (刻印): a rune branded on the target that ticks faster and faster and then detonates. Damage the target takes while marked feeds the blast, and a counted mark leaps to the next foe.
6. **Composable genes**: Jev also picks four independent traits, and the missile engine combines them freely:
   - pattern: single, fan, ring, cascade, crossfire, rain, spiral, swarm
   - trajectory: straight, arc, spiral, zigzag, boomerang, orbit, serpentine, homing
   - morph: orb, lance, shard, disc/chakram, star, blade, dragon (element beast), skull, bubble, cube
   - payload: explode, split, linger, erupt, chain, implode, echo, crystallize, none

   Payloads also apply to meteors, beams, tornados, vortices and waves. Names are composed too, e.g.
   *"Superior Ring of Umbral Skulls Collapse"* or 「伝説の・追尾瘴気の龍・雨・分裂」.
   Size, speed, gravity (weight), homing, spread (chaos), projectile count, duration, piercing (sharpness),
   colour temperature (blue-white fire, violet absolute-zero ice), sigil complexity (rank) and dual-element fusion all come from the spec.

## The look genome: why two fireballs never look alike

Element and form decide *what* a spell does. A second layer decides how it *looks* (`public/js/look.js`). There are no
preset effects to pick from. Every visual is a function of a few continuous, abstract axes (0–1), and each axis has one
consistent meaning across shape, colour, fluctuation, launch speed and how the effect evolves over time:

| Axis | Drives |
|---|---|
| temperature | colour along a blackbody ramp (ember red → orange → white → blue), buoyancy (hot rises, cold sinks), flicker speed, fast bright bloom versus slow lingering |
| sharpness | soft puffs → flame tongues → shards/stars, low- versus high-frequency surface detail, orbiting rings, crystal debris |
| density | ethereal glow → opaque matter: a dark crust over glowing veins, smoke, rock/crystal cores, falling embers, opacity |
| weight | particle gravity, sluggish bursts, debris that falls and bounces, squat explosions |
| dispersion (chaos) | spread, turbulence, extra ragged shells and funnel layers, longer trails |
| luminosity | intensity, white-hot cores, light radius (`smouldering` … `blinding`) |
| height / width | proportions of every volume: tornado funnels, explosions (column versus pancake), beams, walls, waves, spikes, storms, fields |

Jev scores `height`, `width`, `density` and `luminosity` and picks a **substance** (`magma`, `flame`, `plasma`, `smoke`, `crystal`,
`liquid`, `mist`, `spectral`, `radiant`, `corrupted`, or `native`). A substance never selects an effect. It only *pulls* the axes
(magma = dense, heavy, dim, deep red; raging flame = thin, hot, bright, rising), so words blend continuously. The local
parser understands the same words, for example 地熱 · 溶岩 · 烈火 · 蒼炎 · 天高く · 立ち昇る · 大地 · 地を這う.

- 「大地の地熱トルネード」 → *Earthbound Magma Tornado*: a squat, wide whirl of dark lava crust with glowing cracks, carried rocks,
  heavy soot and lava bombs that fall back down.
- 「天高く立ち昇る炎のトルネード」 → *Towering Blazing Tornado*: a tall, slender column of banded toon flame licking upward.
- 「大地の地熱, ファイアーボール」 versus 「烈火の炎, ファイアーボール」: a flattened lava rock with glowing seams, versus a roaring
  bright fireball wrapped in flame tongues.

Volumes use an alpha-blended "matter flow" shader (toon flame bands ↔ lava crust, driven by heat and density), which stays
readable in daylight where additive glow washes out. The spell card shows the substance and the Height, Width, Density and Glow bars.

### One matter system for every element × form

Large volumes don't hand-paint each combination. `public/js/vfxkit.js` has one lit, alpha-blended **surface shader** that blends
fluid (glossy water with foam and backlit crests), flame (banded toon fire with a hot core and torn edges), gas (sun-lit dust or cloud) and
solid (rock or snow with glowing cracks when hot), plus an energy glow. The weights come continuously from the element and the look axes.
Tornado funnels, breaking waves, beam torrents, nova shells and shock walls, fire curtains and waterfall walls, geyser spikes, storm
cloud shelves, vortex accretion disks, pools, crescent blades, comet-shaped projectiles, missile sheaths, familiars, ward shells,
power-up auras, summoned hands, flight wings and character status auras all use it. So a new element or substance automatically
works in every form. The particle emitter follows the same rules: liquids throw spray streaks, airy matter draws speed lines,
charged matter crackles with arcs, living matter sheds leaves and petals, and dense hot matter spits falling embers.

Sounds follow the look too: weight lowers pitch, heat and brightness open the filters, dispersion jitters timing, dense matter adds rumble,
and sustained spells get LFO-swept beds (a howling double resonance for vortices) with crackle grains for fire, lightning and stone.

## Power grades: why an ultimate spell looks nothing like a normal one

Rank (I–IX, from Jev) and magnitude place every spell in one of four **grades**. Each grade adds new procedural layers
instead of just scaling numbers:

| Grade | Ranks | Adds |
|---|---|---|
| 0 Minor | I–III | 0.75× effective magnitude, plain impact |
| 1 Standard | IV–V | the baseline |
| 2 Greater | VI–VII | 1.35× magnitude, a ground sigil + pillar of light when cast, 3 orbiting escort projectiles, aftershock rings, glowing scars, energy strands spiraling around beams |
| 3 Ultimate | VIII–IX | 1.9× magnitude, **domain** (sky, sunlight and fog take on the element and a colossal sigil opens overhead), 8 escorts, and a multi-stage **cataclysm**: blast, arena-wide shockwave, ring of secondary detonations, erupting core, lingering field, raining debris. Beams erupt continuously where they land. |

Damage follows a steeper curve (a plain fireball ≈ ×0.8, an ultimate ≈ ×4). While you chant, stacked ground sigils
and rising motes appear around you as the previewed grade climbs, and the screen edge burns once you reach ultimate.

## Elements & reactions

Fire, Ice, Water, Lightning, Wind, Earth, Darkness, Light, Nature, **Poison**, Arcane. Hits leave an elemental **aura**, and the next
element reacts with it:

- **Frozen** (Water + Ice), then **Shatter** it with earth or heavy spells
- **Vaporize / Melt** (×2), **Overload** (explosion + launch), **Superconduct** (+40% damage taken), **Electro-Charged**
- **Swirl** (wind spreads the aura), **Crystallize** (earth gives you a shield), **Bloom**, **Wildfire**, **Quicken**
- **Eclipse** (Light + Darkness, ×3 true damage), **Hellfire**, **Solar Flare**, arcane **Resonance**
- Darkness aura = **curse** (attackers leech life). Poison stacks damage over time and halves healing.
- Nearly every element pair has its own reaction (47 in total): e.g. Toxic Blaze (poison + fire), Quagmire (water + earth, mired),
  Gravity Prison, Magnetic Crush, Judgment (sky strike), Purge (strips buffs), Sandstorm, Singularity (pull), Aurora Step (haste)…
  Statuses include mired, weakened, fractured (+damage taken), cursed, poisoned, stunned and frozen.
- **Combos**: three different spells from the same caster in sequence trigger a finisher: Winter's Judgment (water → ice → earth),
  Crown of the Storm (fire → wind → lightning), Worldbreaker (darkness → earth → fire), Cycle of Renewal (light → water → wind),
  Plaguebringer (poison → wind → fire), Void Tide (water → darkness → lightning). Chaining different spells also ramps damage.

## Modes

- **Duel the Archmage**: best of three against an AI that chants generated incantations out loud (speech synthesis),
  runs them through Jev, reads your aura to set up reactions, dodges, walls and heals.
- **Training Grounds**: a regenerating golem to test spells on.
- **Battle Royale** (`public/js/royale.js`): 4, 8 or 12 mages board a floating sky ferry that crosses the island.
  - Press **Space** to jump off wherever you like. Bots leave near the spot they want to land, and anyone still aboard is thrown off at the end of the line.
  - Steer the fall with WASD and hold Space to slow it.
  - The minimap shows rivals within 40 m, or within 80 m while they chant.
  - **Loot**: glowing relics with light beams are scattered across the map.
    - Element cores give +20% damage for that element and stack.
    - Passive relics: Mana Font (mana regen), Arcane Vessel (max mana), Troll Heart (max HP), Windstep Boots (speed) and Sage Focus (cheaper spells).
    - Potions go into slots **1** (heal), **2** (mana) and **3** (shield).
  - **Caches**: once per storm phase an arcane cache falls inside the next circle. It always contains a rare relic, either the Archmage Crown (+15% all damage) or the Phoenix Feather (revive once), plus extra loot.
  - **The storm**: a violet storm wall shrinks in five phases, and its damage grows each phase. The final storm keeps getting stronger until one mage is left.
  - **Bots** loot first, then fight whoever is nearest. They drink potions, run from the storm and drop their loot when eliminated.
  - **After you fall**, the camera spectates the leader. The last mage standing wins.

## Files

```
server.js             static server + Jev bridge
public/js/main.js     game loop, input, modes, casting flow, post-processing
public/js/spellbook.js  local parser, Jev client, spec merge, AI incantation generator
public/js/spells.js   23 procedural spell forms (plus the shared helpers)
public/js/spells-extra.js  10 more forms: whip, prison, decoy, drain, beast, halo, sword, rush, totem, mark
public/js/royale.js   battle royale: drop, loot, potions, caches, shrinking storm, spectating
public/js/look.js     look genome: continuous visual axes, substance biases, palette and particle recipes
public/js/vfxkit.js   element surface kit: one matter shader (fluid · flame · gas · solid · energy) for every spell volume
public/js/style.js    global art direction: soft cel terminator and rim light for all lit materials, chamfered stone and boulder geometry
public/js/combat.js   combatants, auras, reactions, shields, DoTs
public/js/fx.js       erosion-shaded flame/toon-smoke particles, mesh explosions, shockwaves, heat haze, ribbons, lightning, lights, cracks
public/js/postfx.js   MSAA HDR, ambient occlusion (GTAO, High and Ultra), bloom, screen distortion, cinematic grade
public/js/i18n.js     English / Japanese UI strings
public/js/audio.js    fully synthesized, spatialized SFX: air absorption and arrival delay by distance, a hall reverb, voice budget, choir chant, form/item/storm sweeteners, surface footsteps, ambience
public/js/world.js    sky, painterly terrain, wind-swept grass, fluffy trees, ridged mountain ranges with aerial haze, floating islands, weathered ruins, camera-following shadows
public/js/characters.js  outlined cel-shaded battlemages + first-person magic staff
public/js/voice.js    Web Speech API + mic level
public/js/bot.js      rival AI
public/js/hud.js      HUD, spell card, damage numbers
```

In the browser console, `VA.test('meteor', 'fire', { power: 1, tier: 1 })` casts a hand-made spec (debug).
`VA.chant('大地の地熱トルネード')` casts an incantation through the local parser, `VA.follow()` attaches an observer camera to the newest
spell, `VA.cam([x, y, z], [tx, ty, tz])` places it by hand, and `VA.cam()` returns to the player view.
`VA.gallery({ shape: 'wave', element: 'water' })` stages an empty field, casts, steps the simulation deterministically and frames the
spell (it works even in a background tab). `VA.sheet('tornado')` renders that form for all 11 elements in one labelled contact
sheet. `VA.sheet()` closes it, and `VA.step(seconds)` advances time by hand.

## Voice diagnostics

`VA.voiceStats()` returns the last 30 manual chant timings and prints them as a console table. It records no transcript or audio.
Timings include keypress to recognition start, audio ready, detected sound, first text, sound-to-text, and release-to-cast.
`readyOnPress` distinguishes a ready session from one still preparing. Sound detection uses an amplitude threshold, so background
noise can trigger it; this is not an acoustic speech-onset benchmark. History stays in this page's memory and is never uploaded.

Open **http://localhost:8787/voice-lab.html** for capability checks, a microphone test, quiet/loud visual previews and a repeatable
synthetic speech comparison. The comparison feeds two generated English phrases directly into Web Speech through Web Audio,
without opening the microphone or playing through speakers. Choose Automatic or Browser service to compare recognition modes.
Warm runs wait for capture readiness before the keypress; all runs include a 1.8-second silence tail before release. This checks
startup and transcript completeness, not immediate-release accuracy or human microphone latency. Fixtures were generated with
Windows Microsoft Zira Desktop at 16 kHz mono. Local language packs are checked but never downloaded automatically.

Open **http://localhost:8787/casting-lab.html** to test immediate release through the actual game with the same
synthetic English fixtures. It checks recognition, release handling, cast diagnostics and mana consumption using an
injected audio track; it does not validate physical microphone capture. Reload the lab before another run.

Run regression tests with `node --test tests/voice.test.js tests/voice-feedback.test.js tests/casting.test.js`.


## Reference-style menu and Vercel deployment

The main screen uses mode cards and a separate language/microphone panel. Duel difficulty is selected before entering. Settings groups casting, visuals, and audio, with interpretation options under an expandable section. See [DEPLOYMENT.md](DEPLOYMENT.md) for the existing `jev-spell` project link, preview/production commands, authentication, and hosted feature limits.
