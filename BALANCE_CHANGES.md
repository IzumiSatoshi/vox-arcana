# Mana and counter balance pass

## What changed

The first pass makes reliable attacks cost more and gives opponents actions that waste that investment. It is implemented in the browser game and the shared headless runtime. It is a playtest candidate, not a claim that every form is balanced.

### Mana

- Idle regeneration: **9 → 6 mana/second**. Regeneration while chanting: **4 → 2**.
- Basic shots cost **1 mana** for both players and bots. Spell discounts are applied once through a shared spending function; insufficient mana rejects a cast without changing its Jev parameters.
- At neutral parameters (power/tier and other numeric axes 0.5), costs are **orb 34, barrier 27, funnels 40, prison 60, chain 71**. Costs also account for count/duration where relevant, size, homing, secondary elements and special payloads.
- Base spell costs cap at 110 against the starting 120-mana pool. Debuffs can still make an effective cost higher. Light enhancement now multiplies regeneration instead of adding a large flat amount; total passive regeneration bonuses cap at twice base.
- Jev still determines spell characteristics. Chant duration and loudness do not increase a completed spell's strength. Chant time naturally affects how often actions can happen.

### Risk, reward and counters

| Form | Return | Commitment / counter |
|---|---|---|
| Chain | Retains its heavy direct-hit damage | 71 mana at neutral settings, 1.1-second visible warning, one locked target, sustained aim within 48 units. Cover/barriers block strikes; losing aim/range or becoming incapacitated wastes the paid attack. |
| Prison | Holds opponents in place for follow-up attacks | 0.9-second formation warning. Move out, shoot the bright core, or Blink out. Destroying the core releases victims and cancels its final burst. Longer cages have tougher cores but lower tick/burst damage. |
| Funnels | Autonomous sustained pressure | 2–4 mana/second upkeep (3 at neutral count), destructible drones, 60-unit targeting range, terrain and barrier blocking. Recasting replaces the swarm. Per-shot base damage reduced from 6.5 to 3.5 after trials still showed dominance. |
| Barrier | Cheap protection against direct attacks | Covers a direction and expires; opponents can flank or attack from above. |

The grimoire explains the counters in English/Japanese, chain/prison warnings tell the player what to do, and funnel cards/previews show upkeep. Normal/hard rivals now recognize these threats, seek nearby cover, prepare barriers, attack drones/cores, escape cages and flank opposing barriers. They still chant, pay, aim and move normally.

## Measured results

**270 final matches plus one exact replay**, using seeds 12345–12349 with both spawn positions/update orders. Each 10-game matchup is five correlated seed pairs, not ten independent observations. Most runs use 60 Hz, 120-second limits, 32-unit starting separation, neutral synthetic parameters and two-second controlled chants. No live Jev calls.

### Comparable six-strategy round robin (150 matches)

| Strategy | Original wins / 50 | New wins / 50 | New draws |
|---|---:|---:|---:|
| Chain | 42 | 38 | 0 |
| Native hard | 36 | 38 | 1 |
| Native normal | 36 | 32 | 0 |
| Beam | 26 | 30 | 1 |
| Orb | 2 | 1 | 9 |
| Basic bolts only | 0 | 0 | 11 |

Chain HP damage per second fell from **28.10 to 17.42**. This compares the whole patch, including native bot decisions; it does not isolate mana changes. Chain still beat orb and beam specialists 10/10 each. Simply charging more mana did not make inaccurate projectile strategies competitive.

### Counter strategies (100 matches)

- **Prepared barrier strategy beat chain 10/10.** The guard also uses chain to convert saved mana into damage.
- **Adaptive strategy beat guard 10/10**, using barrier flanking and alternative attacks.
- Adaptive versus chain split **5–5** on terrain. All five paired scores were 50%, so this split has a strong spawn/update-order effect; it is not proof of a stable 50% matchup.
- Funnels beat chain **6–4**, guard **7–3**, and adaptive **8–2**. They remain strong despite upkeep and destructible bodies.
- Prison-only lost **0/40**. This profile repeats cages and basic bolts; it does not test a prison-plus-burst combo. The cage's standalone offense may now be too weak or too easy to evade.
- No timeouts in the counter suite. The default suite had 11/150 timeouts.

### Sensitivity checks (20 matches)

- Guard versus chain at **120 Hz: 10–0**, matching the 60 Hz result on the same seeds.
- Adaptive versus chain with **two cover pillars: 8–2**, compared with 5–5 on terrain without scenery obstacles. This changes geometry and movement together; it does not isolate cover as the sole cause.
- Replaying a saved counter match reproduced all saved combat results exactly and generated a timed event log.

## Assessment and next balance questions

The new rules produce a working counter relationship: prepared defense defeats repeated chain, and flanking defeats stationary defense. They preserve a strong reward for an uncontested chain cast.

The next focused tests should measure **projectile hit rate and range**, **drone removal time**, and **prison followed by a different attack**. Broadly lowering regeneration again would also lengthen weak strategies' downtime. Prefer targeted changes based on those measurements. Human playtesting is still needed to judge warning visibility, core/drone aiming difficulty and whether the mana recovery periods feel good.

## Validation and artifacts

- **156 tests passed**, including actual spell-runtime checks for costs, discounts, capped regeneration, chain warning/cover/aim loss/interruption, prison formation/core destruction/Blink escape, funnel upkeep/cover/destruction/replacement, all 33 forms and seeded reproducibility.
- Production static build passed; `git diff --check` passed.
- Browser practice cast verified the funnel cost/upkeep display with no captured console errors. This was a UI smoke check, not a human balance test.
- No deployment performed.

Source fingerprint for all final sweeps: `ea4780d165d352508ce19400580eff779008ddf426150a12f57a149893477c30`.

Local generated reports (ignored by Git):

- [Default round robin](reports/balance/mana-final-default/report.md)
- [Counter round robin](reports/balance/mana-final-counters/report.md)
- [120 Hz](reports/balance/mana-final-120hz/report.md)
- [Cover arena](reports/balance/mana-final-cover/report.md)
- [Exact replay events](reports/balance/mana-final-replay/matches/0001.json)
- [UI screenshot](reports/balance/funnel-upkeep-ui.png)

Run another counter comparison:

```sh
npm run balance -- --profiles form:chain,tactic:guard,form:funnels,tactic:adaptive,form:prison --pairs 10 --out reports/balance/counter-followup
```

Use a fresh output directory to preserve prior reports. See [README](README.md#headless-balance-simulations) for the full CLI and simulation assumptions.
