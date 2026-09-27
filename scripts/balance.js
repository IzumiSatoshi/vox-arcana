import { mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { DEFAULTS, validateOptions } from './balance/simulate.js';
import { runMatch } from './balance/run-match.js';
import { DEFAULT_PROFILES, ELEMENT_KEYS, SHAPE_KEYS, validateProfile } from './balance/profiles.js';
import { summarize, markdownReport } from './balance/report.js';

const HELP = `Headless bot-vs-bot balance simulation (no browser or API key)
  npm run balance -- [options]
  --suite default|ai|forms|elements    default: 6-profile round robin
  --profiles native:normal,form:chain override suite; round robin
  --pairs N          seed pairs per matchup; each pair swaps sides (default 3)
  --seed N           first uint32 seed (default 12345)
  --seconds N        maximum simulated match seconds (default 120)
  --hz N             simulation steps/second (default 60; range 20..240)
  --arena terrain|flat|cover  terrain, flat ground, or two cover pillars
  --power N --tier N  controlled spec power/tier, 0..1 (default 0.5)
  --chant-seconds N   controlled chant duration (default 2)
  --distance N       initial separation, 0..180 (default 32)
  --out PATH         empty output directory (default reports/balance/<timestamp>)
  --trace            include timed events in match JSON
  --replay PATH      rerun one saved match JSON with events
Profiles: native:easy|normal|hard, bolts, form:<shape>, element:<element>, combo:freeze-shatter, tactic:guard, tactic:adaptive
Forms/elements suites compare each controlled profile against native:normal.
Outputs: report.md, summary.json, matches.csv, matches/*.json`;

try {
  const args = process.argv.slice(2), flags = {};
  const allowed = new Set(['suite', 'profiles', 'pairs', 'seed', 'seconds', 'hz', 'arena', 'power', 'tier', 'chant-seconds', 'distance', 'out', 'replay']);
  for (let i = 0; i < args.length; i++) {
    const key = args[i].replace(/^--/, '');
    if (args[i] === '--help') { console.log(HELP); process.exit(0); }
    if (args[i] === '--trace') { flags.trace = true; continue; }
    if (!args[i].startsWith('--') || !allowed.has(key) || args[i + 1] === undefined || args[i + 1].startsWith('--')) throw new Error(`Invalid argument: ${args[i]}\n${HELP}`);
    flags[key] = args[++i];
  }
  const config = { ...DEFAULTS };
  for (const key of ['seed', 'seconds', 'hz', 'power', 'tier', 'distance']) if (flags[key] !== undefined) config[key] = Number(flags[key]);
  if (flags['chant-seconds'] !== undefined) config.chantSeconds = Number(flags['chant-seconds']);
  if (flags.arena) config.arena = flags.arena;
  validateOptions(config);
  const pairs = flags.pairs === undefined ? 3 : Number(flags.pairs);
  if (!Number.isSafeInteger(pairs) || pairs < 1) throw new Error('pairs must be a positive integer');
  const suite = flags.suite || 'default';
  if (!['default', 'ai', 'forms', 'elements'].includes(suite)) throw new Error(`Unknown suite: ${suite}`);
  let matchups;
  if (!flags.profiles && ['forms', 'elements'].includes(suite)) {
    const profiles = suite === 'forms' ? SHAPE_KEYS.map(s => `form:${s}`) : ELEMENT_KEYS.map(e => `element:${e}`);
    matchups = profiles.map(p => [p, 'native:normal']);
  } else {
    const profiles = flags.profiles ? flags.profiles.split(',') : suite === 'ai' ? ['native:easy', 'native:normal', 'native:hard', 'bolts'] : DEFAULT_PROFILES;
    if (profiles.length < 2 || new Set(profiles).size !== profiles.length) throw new Error('Provide at least two distinct profiles');
    profiles.forEach(validateProfile);
    matchups = profiles.flatMap((a, i) => profiles.slice(i + 1).map(b => [a, b]));
  }
  let revision = 'unknown';
  try { revision = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
    if (execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim()) revision += ' (working tree modified)';
  } catch { /* Usable outside a Git checkout. */ }
  const hash = createHash('sha256');
  for (const dir of ['public/js', 'scripts/balance']) {
    for (const file of (await readdir(dir)).filter(f => f.endsWith('.js')).sort()) {
      hash.update(`${dir}/${file}\n`); hash.update(await readFile(join(dir, file)));
    }
  }
  hash.update(await readFile('scripts/balance.js')); hash.update(await readFile('package-lock.json'));
  const sourceFingerprint = hash.digest('hex');
  const out = resolve(flags.out || join('reports/balance', new Date().toISOString().replace(/[:.]/g, '-')));
  const matches = [];
  await mkdir(out, { recursive: true });
  if ((await readdir(out)).length) throw new Error(`Output directory is not empty: ${out}. Use a new --out directory to preserve earlier reports.`);
  await mkdir(join(out, 'matches'), { recursive: true });
  const saveMatch = async match => {
    match.provenance = { revision, sourceFingerprint };
    matches.push(match);
    await writeFile(join(out, 'matches', `${String(matches.length).padStart(4, '0')}.json`), JSON.stringify(match, null, 2) + '\n');
  };
  const start = performance.now();
  if (flags.replay) {
    const saved = JSON.parse(await readFile(flags.replay, 'utf8'));
    const result = await runMatch(...saved.profiles, { ...saved.options, trace: true });
    const comparable = m => { const { events, provenance, ...rest } = m; const { trace, ...options } = rest.options; return { ...rest, options }; };
    const same = JSON.stringify(comparable(saved)) === JSON.stringify(comparable(result));
    if (saved.provenance?.sourceFingerprint === sourceFingerprint && !same) throw new Error('Replay diverged despite matching source fingerprint');
    console.log(`Replay ${same ? 'matches saved combat results' : 'differs from saved combat results (source changed or was not fingerprinted)'}.`);
    await saveMatch(result);
  } else {
    const total = matchups.length * pairs * 2;
    for (const [a, b] of matchups) for (let pair = 0; pair < pairs; pair++) for (let swap = 0; swap < 2; swap++) {
      const profiles = swap ? [b, a] : [a, b];
      const match = await runMatch(...profiles, { ...config, seed: (config.seed + pair) >>> 0, trace: !!flags.trace });
      await saveMatch(match);
      console.log(`[${matches.length}/${total}] ${profiles.join(' vs ')}: ${match.winner === null ? match.outcome : profiles[match.winner]} (${match.duration.toFixed(1)}s)`);
    }
  }
  const report = { schemaVersion: 1, revision, sourceFingerprint, config: flags.replay ? matches[0].options : config,
    suite: flags.replay ? 'replay' : suite, pairs, wallSeconds: (performance.now() - start) / 1000, summary: summarize(matches) };
  await writeFile(join(out, 'summary.json'), JSON.stringify(report, null, 2) + '\n');
  await writeFile(join(out, 'report.md'), markdownReport(report));
  const rows = [['match', 'seed', 'left', 'right', 'winner', 'outcome', 'seconds', 'left_hp', 'right_hp'], ...matches.map((m, i) => [i + 1, m.options.seed, ...m.profiles, m.winner === null ? '' : m.profiles[m.winner], m.outcome, m.duration, ...m.stats.map(s => s.hp)])];
  await writeFile(join(out, 'matches.csv'), rows.map(r => r.map(v => JSON.stringify(String(v))).join(',')).join('\n') + '\n');
  console.table(report.summary.profiles.map(({ profile, games, wins, draws, winRate, hpDps }) => ({ profile, games, wins, draws, winRate, hpDps })));
  console.log(`Report: ${join(out, 'report.md')} (${report.wallSeconds.toFixed(1)} wall seconds)`);
} catch (error) {
  console.error(error.stack || error); process.exitCode = 1;
}
