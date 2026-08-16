#!/usr/bin/env node
// graphwar-ai :: cli
// usage:
//   gw-aim <scenario.json> [--top N] [--angles 0,20,-20] [--svg out.svg] [--json]
//   gw-aim <scenario.json> --check "0.2*x^2-1.1*x" [--angle 0]

import { readFileSync, writeFileSync } from 'node:fs';
import { solve, check, DEFAULT_ANGLES } from '../src/solve.js';
import { OPEN_LANE } from '../src/trace.js';
import { toSvg } from '../src/render.js';

const USAGE = `graphwar-ai — writes the function that hits

  gw-aim <scenario.json> [options]

  --top N            how many shots to print (default 5)
  --angles a,b,c     aim angles to search, in degrees (default ${DEFAULT_ANGLES.join(',')})
  --both-directions  also consider firing away from the target
  --step S           tracer resolution in field units (default 0.05)
  --svg PATH         write a preview of the board and the shots
  --json             print the result as JSON instead of a table
  --check "EXPR"     fly one function of your own instead of searching
  --angle A          aim angle for --check (default 0)

  A scenario is JSON: shooter, target, optional soldiers[] and terrain[].
  See examples/ for boards you can copy.`;

function parseArgs(argv) {
  const opts = { top: 5, angles: DEFAULT_ANGLES, json: false, svg: null, check: null, angle: 0, step: undefined, bothDirections: false };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) fail(`${a} needs a value`);
      return v;
    };
    if (a === '--top') opts.top = Number(next());
    else if (a === '--angles') opts.angles = next().split(',').map((s) => Number(s.trim()));
    else if (a === '--both-directions') opts.bothDirections = true;
    else if (a === '--step') opts.step = Number(next());
    else if (a === '--svg') opts.svg = next();
    else if (a === '--json') opts.json = true;
    else if (a === '--check') opts.check = next();
    else if (a === '--angle') opts.angle = Number(next());
    else if (a === '-h' || a === '--help') { console.log(USAGE); process.exit(0); }
    else if (a.startsWith('-')) fail(`unknown option ${a}`);
    else rest.push(a);
  }
  if (rest.length !== 1) fail('expected exactly one scenario file');
  if (!Number.isFinite(opts.top) || opts.top < 1) fail('--top must be a positive number');
  if (opts.angles.some((n) => !Number.isFinite(n))) fail('--angles must be a comma-separated list of numbers');
  opts.scenarioPath = rest[0];
  return opts;
}

function fail(message) {
  console.error(`gw-aim: ${message}\n\n${USAGE}`);
  process.exit(2);
}

const opts = parseArgs(process.argv.slice(2));

let raw;
try {
  raw = JSON.parse(readFileSync(opts.scenarioPath, 'utf8'));
} catch (e) {
  fail(`could not read ${opts.scenarioPath}: ${e.message}`);
}

const u = (n) => `${n.toFixed(1)}u`;
// a path that never came near anything reports a sentinel, not a real distance
const room = (n) => (n >= OPEN_LANE ? 'clear lane' : `clearance ${u(n)}`);

if (opts.check) {
  let result;
  try {
    result = check(raw, opts.check, { angle: opts.angle, step: opts.step });
  } catch (e) {
    fail(e.message);
  }
  if (opts.json) {
    console.log(JSON.stringify(strip(result), null, 2));
  } else {
    const verdict = result.outcome === 'hit'
      ? 'HIT'
      : `${result.outcome.toUpperCase()}${result.blockedBy ? ` on ${result.blockedBy}` : ''}`;
    console.log(`y = ${result.function}   [angle ${result.angle}°, facing ${result.direction}]`);
    console.log(`  ${verdict} — closest approach to target ${u(result.missDistance)}, travelled ${u(result.travel)}`);
  }
  if (opts.svg) writeSvg(result.scenario, result.outcome === 'hit' ? [result] : [{ ...result, function: opts.check }]);
  process.exit(result.outcome === 'hit' ? 0 : 1);
}

let out;
try {
  out = solve(raw, { angles: opts.angles, top: opts.top, step: opts.step, bothDirections: opts.bothDirections });
} catch (e) {
  fail(e.message);
}

if (opts.json) {
  console.log(JSON.stringify({ shots: out.shots.map(strip), tried: out.tried, nearest: out.nearest ? strip(out.nearest) : null }, null, 2));
} else if (out.shots.length === 0) {
  const { shooter, target } = out.scenario;
  console.log(`no shot found from (${shooter.x}, ${shooter.y}) onto (${target.x}, ${target.y}) — ${out.tried} candidates tried`);
  if (out.nearest) {
    console.log(`closest was y = ${out.nearest.function} [angle ${out.nearest.angle}°], ${u(out.nearest.missDistance)} short, ${out.nearest.outcome}${out.nearest.blockedBy ? ` on ${out.nearest.blockedBy}` : ''}`);
  }
  console.log('try --both-directions, a wider --angles list, or check the target is not sealed inside terrain.');
} else {
  const { shooter, target } = out.scenario;
  console.log(`${out.shots.length} shot${out.shots.length === 1 ? '' : 's'} from (${shooter.x}, ${shooter.y}) onto (${target.x}, ${target.y}) — ${out.tried} candidates tried\n`);
  out.shots.forEach((s, i) => {
    console.log(`${i + 1}. y = ${s.function}`);
    console.log(`   ${s.family} · angle ${s.angle}° · facing ${s.direction}`);
    console.log(`   ${room(s.clearance)} · peak slope ${s.maxSlope.toFixed(1)} · path ${u(s.travel)}\n`);
  });
}

if (opts.svg) writeSvg(out.scenario, out.shots.length ? out.shots : out.nearest ? [out.nearest] : []);

function writeSvg(scenario, shots) {
  writeFileSync(opts.svg, toSvg(scenario, shots));
  console.log(`preview written to ${opts.svg}`);
}

// the flown path is thousands of points — useful in the SVG, noise on stdout
function strip(shot) {
  const { points, scenario, signature, ...rest } = shot;
  return rest;
}
