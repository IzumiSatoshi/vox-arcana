# First automated balance observations

Historical baseline, before the mana and counter changes. See [BALANCE_CHANGES.md](BALANCE_CHANGES.md) for the implemented follow-up.

## Main findings

**Chain spells deserve the first balance investigation.** In the six-strategy round robin, the arcane chain specialist won **42/50 matches (84%)**. It beat the arcane orb specialist **10/10** and the arcane beam specialist **10/10**. Against each native rival difficulty it won **6/10**, so it did not dominate every opponent equally.

The chain-vs-orb result persisted at **120 Hz: 10/10 chain wins**. These are the same five seeds with sides swapped, so this is a timing-sensitivity check, not ten new independent samples.

| Strategy | Wins / games | Draws | Effective HP damage / second |
|---|---:|---:|---:|
| Arcane chain specialist | 42 / 50 | 0 | 28.10 |
| Normal native rival | 36 / 50 | 0 | 17.42 |
| Hard native rival | 36 / 50 | 0 | 15.89 |
| Arcane beam specialist | 26 / 50 | 0 | 10.10 |
| Arcane orb specialist | 2 / 50 | 8 | 3.52 |
| Basic bolts only | 0 / 50 | 8 | 1.68 |

The form sweep also flagged **prison (6/6)** and **funnels (5/6)** against the normal native rival. This sweep has only three seed pairs per form; those results justify larger targeted tests, not a precise win-rate estimate.

All eleven element-specific orb specialists lost their six matches against the normal native rival. This baseline cannot separate element strength reliably: the shared orb strategy is already losing. A better follow-up is element-vs-element play, or several forms per element.

## What the replay explains

In [the recorded chain-vs-orb replay](reports/balance/chain-orb-replay/matches/0001.json), both bots paid **53 mana** per full spell. The first chain cast delivered four direct hits and a final explosion, each dealing about **45.55 HP**, for about **227.75 HP**. The chain caster eventually dealt 600 HP; the orb caster dealt about 10.28 HP including basic bolts.

The [chain implementation](public/js/spells.js) selects a target within its aim cone and 60-unit range for each strike, then checks terrain and barriers. Orbs travel through space and can miss moving targets. This makes hit reliability, total damage per cast, and the AI's dodging behavior useful next measurements. The replay supports that explanation for this match; it does not isolate each factor's contribution.

## Runs and artifacts

424 scheduled matches were completed with the final combat adapter, plus one replay. Some matchups and seeds repeat across suites; this is not 424 independent observations.

- [Six-strategy round robin: 150 matches](reports/balance/validated-baseline/report.md)
- [All 33 forms: 198 matches](reports/balance/forms-baseline/report.md)
- [All 11 elements: 66 matches](reports/balance/elements-baseline/report.md)
- [Chain vs orb at 120 Hz: 10 matches](reports/balance/chain-orb-120hz/report.md)
- [Exact replay with event log](reports/balance/chain-orb-replay/matches/0001.json)

The full result folders are local, ignored artifacts. Each contains Markdown, CSV, summary JSON and per-match JSON. This tracked summary preserves the initial findings. Reports include a source fingerprint; the Git base was `697cbce` with local changes.

## Conditions and limits

- Terrain collision with scenery obstacles omitted; initial separation 32 units and seeded orientation.
- 600 starting HP, 120 mana, 120-second timeout; 60 Hz except the explicit 120 Hz check.
- Controlled spells: power/tier 0.5, other numeric axes 0.5, two-second chants, normal AI movement, and basic bolts between chants. All form specialists use arcane.
- Native rivals use generated English chants and the existing offline parser. No live Jev, speech playback, microphone latency, storm or loot.
- The actual spell runtime, damage/reactions, timed effects, chant interruption, body physics and animated cast origins execute without rendering.
- The normal movement policy prefers roughly 18–22 units, which disadvantages short-range spells. Repeating a defensive or movement spell is not an intelligent use of that spell. These are strategy comparisons under fixed assumptions.
- Visual-only effects are suppressed and consume a different random sequence from the browser. Seeded headless runs reproduce each other; browser sessions are not expected to replay identically.
- No combat balance values were changed. Physics and bot hit interruption were extracted for shared use with the game.

## Re-run

```sh
npm run balance
npm run balance -- --profiles form:prison,form:funnels,native:normal --pairs 20
npm run balance -- --profiles element:fire,element:ice,element:poison --pairs 20
npm run balance -- --profiles form:chain,form:orb --pairs 20 --arena flat --distance 12
```

Use a fresh `--out` directory to keep comparable before/after reports. See [README](README.md#headless-balance-simulations) for all controls.

Validation: 135 tests passed; static build passed; all 33 forms exercised; seeded event replay matched exactly. Delayed reaction damage and chain expiration were checked against simulated time.
