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

- No dependencies. Node 18+ is enough (Three.js loads from a CDN).
- The Jev key is read from `../api_key/jev_api.txt`. You can override this with the `JEV_API_KEY` env var, and the endpoint and model with
  `JEV_URL` / `JEV_MODEL` or a `jev.config.json` (`{ "url": "...", "model": "...", "keyFile": "..." }`).
- Set `JEV_DEBUG=1` to print Jev's raw answers in the server console.
- With Jev enabled, player casts use only Jev interpretation. A failed request shows an error; it does not cast via keywords. Disable Jev in Settings to use the local keyword parser. Browser offline speech recognition is a separate voice-to-text setting.

## Language / 言語

Use the **EN / 日本語** toggle on the title screen, or go to Settings. Japanese mode localizes the UI, spell names (e.g. 「究極・岩・紅蓮の火球」),
reactions and statuses, and switches voice recognition to `ja-JP`. The rival also chants in Japanese
(e.g. 「天よ、裂けよ、雷の裁き！」) and speaks it with a Japanese voice.

## Controls

| | |
|---|---|
| **Hold F / Right-click** | chant (speak), release to cast (waits for Jev if needed) |
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
   keyword parser when Jev is disabled. Hold the key before speaking; startup and transcription time depend on the browser.
2. **Speculative Jev**: while you chant, each new transcript is sent to Jev (throttled). A recognized spell casts
   on release when its exact-text Jev interpretation is ready, otherwise it waits for that response. If words are missing or still incomplete,
   a grace window of up to 1.8 seconds accepts delayed spell words; pressing again cancels it immediately.
   Direct microphone sessions call `SpeechRecognition.stop()` on release to request pending words. Synthetic
   audio-track test sessions receive silence until pending words arrive. Hands-free mode uses continuous final results.
3. **Jev** (`/api/spell` → `POST https://api.typesafe.ai/v1/systemone`): one request with typed questions:
   - `choice`: element (10), secondary element, form (14)
   - `score`: power, tier/rank, speed, size, temperature, weight, sharpness, count, duration, chaos
   - `noul`: is this actually a spell? should it home in?
4. **Player spell parameters** (`public/js/spellbook.js`): Jev alone when enabled, or keywords alone when disabled.
   Voice loudness and chant length still supply gameplay bonuses; keyword-derived values never override Jev.
   This gives magnitude, a damage multiplier, mana cost, rank I–IX and a generated name.
5. **Procedural runtime** (`public/js/spells.js`): 22 forms, each driven by those parameters:
   - Attacks: orb · barrage · homing funnels · beam · tornado · meteor · nova · ground spikes · vortex/black hole · chain strike · storm · crescent · field (lingering pool) · wave (advancing surge)
   - Self: ward (heal/shield) · enhance (elemental buff) · hand (a summoned spectral hand that fights beside you)
   - Utility: leap · flight · blink (teleport) · construct (platform / stairs / box / pillar / rampart, which are solid, walkable and block spells)
   - Defense: wall (barrier)
6. **Composable genes**: Jev also picks four independent traits, and the missile engine combines them freely:
   - pattern: single, fan, ring, cascade, crossfire, rain, spiral, swarm
   - trajectory: straight, arc, spiral, zigzag, boomerang, orbit, serpentine, homing
   - morph: orb, lance, shard, disc/chakram, star, blade, dragon (element beast), skull, bubble, cube
   - payload: explode, split, linger, erupt, chain, implode, echo, crystallize, none

   Payloads also apply to meteors, beams, tornados, vortices and waves. Names are composed too, e.g.
   *"Superior Ring of Umbral Skulls Collapse"* or 「伝説の・追尾瘴気の龍・雨・分裂」.
   Size, speed, gravity (weight), homing, spread (chaos), projectile count, duration, piercing (sharpness),
   colour temperature (blue-white fire, violet absolute-zero ice), sigil complexity (rank) and dual-element fusion all come from the spec.

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
- **Online Duel**: free-for-all through the built-in WebSocket relay. Friends open `http://<your-ip>:8787`
  (voice needs `localhost` or HTTPS, but typing works everywhere). Each client decides its own damage (the victim is authoritative).
- **Training Grounds**: a regenerating golem to test spells on.

## Files

```
server.js             static server + Jev bridge + WebSocket relay
public/js/main.js     game loop, input, modes, casting flow, post-processing
public/js/spellbook.js  local parser, Jev client, spec merge, AI incantation generator
public/js/spells.js   14 procedural spell forms
public/js/combat.js   combatants, auras, reactions, shields, DoTs
public/js/fx.js       erosion-shaded flame/toon-smoke particles, mesh explosions, shockwaves, heat haze, ribbons, lightning, lights, cracks
public/js/postfx.js   MSAA HDR, bloom, screen distortion, cinematic grade
public/js/i18n.js     English / Japanese UI strings
public/js/audio.js    fully synthesized, spatialized SFX + generative music
public/js/world.js    sky, painterly terrain, wind-swept grass, fluffy trees, mountains, cumulus clouds, ruins
public/js/characters.js  outlined cel-shaded battlemages + first-person magic staff
public/js/voice.js    Web Speech API + mic level
public/js/bot.js      rival AI
public/js/hud.js      HUD, spell card, damage numbers
```

In the browser console, `VA.test('meteor', 'fire', { power: 1, tier: 1 })` casts a hand-made spec (debug).

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
