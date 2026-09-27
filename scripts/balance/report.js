const round = n => Math.round(n * 100) / 100;
const mean = xs => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;

export function summarize(matches) {
  const profiles = new Map(), matchups = new Map();
  for (const m of matches) {
    const names = [...m.profiles].sort();
    const key = names.join(' vs ');
    if (!matchups.has(key)) matchups.set(key, { profiles: names, matches: 0, wins: [0, 0], draws: 0, timeouts: 0, durations: [], pairScores: new Map() });
    const row = matchups.get(key); row.matches++; row.durations.push(m.duration);
    if (m.winner === null) { row.draws++; if (m.outcome === 'timeout') row.timeouts++; }
    else row.wins[names.indexOf(m.profiles[m.winner])]++;
    // Group whole seed pairs; swapped games are not independent observations.
    const pair = row.pairScores.get(m.options.seed) || [];
    pair.push(m.winner === null ? 0.5 : m.profiles[m.winner] === names[0] ? 1 : 0);
    row.pairScores.set(m.options.seed, pair);
    for (const [side, name] of m.profiles.entries()) {
      if (!profiles.has(name)) profiles.set(name, { profile: name, games: 0, wins: 0, draws: 0, timeouts: 0, totals: {}, duration: 0 });
      const p = profiles.get(name); p.games++; p.duration += m.duration;
      if (m.winner === side) p.wins++;
      if (m.winner === null) { p.draws++; if (m.outcome === 'timeout') p.timeouts++; }
      for (const [k, v] of Object.entries(m.stats[side])) if (typeof v === 'number') p.totals[k] = (p.totals[k] || 0) + v;
    }
  }
  return {
    matches: matches.length,
    timeouts: matches.filter(m => m.outcome === 'timeout').length,
    profiles: [...profiles.values()].map(p => ({ profile: p.profile, games: p.games, wins: p.wins, draws: p.draws,
      timeouts: p.timeouts, winRate: round(100 * p.wins / p.games), scoreRate: round(100 * (p.wins + p.draws / 2) / p.games),
      meanSeconds: round(p.duration / p.games), hpDps: round(p.totals.hpDamage / p.duration),
      damagePerMana: round(p.totals.hpDamage / (p.totals.manaSpent || 1)),
      means: Object.fromEntries(Object.entries(p.totals).map(([k, v]) => [k, round(v / p.games)])) })).sort((a, b) => b.scoreRate - a.scoreRate),
    matchups: [...matchups.values()].map(p => {
      const pairMeans = [...p.pairScores.values()].map(mean), n = pairMeans.length;
      const avg = mean(pairMeans);
      const se = n > 1 ? Math.sqrt(pairMeans.reduce((s, x) => s + (x - avg) ** 2, 0) / (n - 1) / n) : null;
      return { profiles: p.profiles, matches: p.matches, wins: p.wins, draws: p.draws, timeouts: p.timeouts,
        seedPairs: n, firstProfileScore: round(100 * avg), pairedScoreStandardError: se === null ? null : round(100 * se), meanSeconds: round(mean(p.durations)) };
    }),
    firstSlotWinRate: round(100 * matches.filter(m => m.winner === 0).length / (matches.length || 1)),
  };
}

export function markdownReport(report) {
  const { summary: s, config: c } = report;
  const lines = ['# Headless combat balance report', '',
    `Revision: ${report.revision}. ${s.matches} matches; ${s.timeouts} timeouts. Seed ${c.seed}, ${c.hz} Hz, ${c.seconds}s limit, ${c.arena} arena.`, '',
    `Source SHA-256: \`${report.sourceFingerprint}\`.`, '',
    '## Assumptions', '',
    '- Uses the actual BotBrain, SpellSystem (including extra forms), Combatant, reactions, hit interruptions, animated cast origins, movement and terrain collision methods.',
    '- No renderer or audio. FX callbacks and delayed gameplay effects still advance on simulation time. No Jev/network calls.',
    '- Terrain arena omits scenery obstacles; flat arena also removes terrain elevation; cover arena adds two solid pillars. No loot, storm, relics, revives, player input or speech latency.',
    `- Native profiles use the existing English offline parser and generated chant durations. Controlled profiles use synthetic completed spell parameters: power ${c.power}, tier ${c.tier}, other numeric axes 0.5, chant ${c.chantSeconds}s. Fixed form/element profiles retain normal movement and basic bolts but disable tactical spell selection. Tactical profiles use the same synthetic parameters and chant time, with barriers, blink, structure attacks and a chain offense. Native normal/hard bots also use counter decisions.`,
    `- Starting separation: ${c.distance} units, with seeded orientation. ${report.suite === 'replay' ? 'This report replays one saved match; it is not a paired comparison.' : 'Every seed is played twice with profiles swapped across spawn positions and update order. Games in a seed pair are correlated.'}`,
    '- A timeout is a draw, regardless of remaining HP. Score = win + half a draw. Damage counts effective enemy HP loss, caps overkill, and excludes decoys, shields and destructible structures. Structure damage/destruction is recorded separately; mana spent includes funnel upkeep.',
    '- These are strategy results under the stated inputs, not intrinsic spell rankings or measured human win rates. Low sample counts are exploratory.', '',
    '## Strategy results', '',
    '| Profile | Games | Wins | Draws | Win % | Score % | Mean seconds | HP DPS | HP / mana | CC seconds | Failed casts |',
    '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|'];
  for (const p of s.profiles) lines.push(`| ${p.profile} | ${p.games} | ${p.wins} | ${p.draws} | ${p.winRate} | ${p.scoreRate} | ${p.meanSeconds} | ${p.hpDps} | ${p.damagePerMana} | ${p.means.ccSeconds} | ${p.means.unaffordableCasts} |`);
  lines.push('', '## Matchups', '', '| First profile | Second profile | Wins first–second | Draws | Seed pairs | First score % | Paired SE (percentage points) | Mean seconds |', '|---|---|---:|---:|---:|---:|---:|---:|');
  for (const p of s.matchups) lines.push(`| ${p.profiles[0]} | ${p.profiles[1]} | ${p.wins.join('–')} | ${p.draws} | ${p.seedPairs} | ${p.firstProfileScore} | ${p.pairedScoreStandardError ?? 'n/a'} | ${p.meanSeconds} |`);
  lines.push('', 'SE is a descriptive standard error across seed-pair scores, not a confidence interval. A zero SE in a small sweep does not establish certainty.', '',
    '## Follow-up checks', '',
    'Compare suspicious matchups over more seeds, different ranges, flat/terrain arenas, power/tier levels and chant durations. Repeat at 120 Hz if projectile collision or timing may be involved. Inspect per-match JSON and event replays before changing combat values.', '');
  return lines.join('\n');
}
