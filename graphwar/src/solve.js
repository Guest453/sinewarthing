// graphwar-ai :: solver
// build target-exact candidates, fly each one, keep the ones that connect, and
// rank them by how much room for error they leave. what comes back is a list of
// functions you can type straight into the game.

import { compile } from './expr.js';
import { candidates } from './families.js';
import { trace, DEFAULT_STEP } from './trace.js';
import { normalize, frame, toLocal, directionToward } from './scenario.js';

export const DEFAULT_ANGLES = [0, 20, -20, 45, -45, 70, -70, 90, -90];

/**
 * @param {object} raw scenario
 * @param {object} [options]
 * @param {number[]} [options.angles] aim angles to try, in degrees
 * @param {number} [options.top] how many shots to return
 * @param {number} [options.step] tracer resolution
 * @param {boolean} [options.bothDirections] also try firing away from the target
 * @returns {{shots: Array, tried: number, scenario: object, nearest: object|null}}
 */
export function solve(raw, { angles = DEFAULT_ANGLES, top = 5, step = DEFAULT_STEP, bothDirections = false } = {}) {
  const scenario = normalize(raw);
  const shots = [];
  let nearest = null;
  let tried = 0;

  for (const angle of angles) {
    const dirs = bothDirections ? [1, -1] : [directionToward(scenario.shooter, scenario.target, angle)];
    for (const direction of dirs) {
      const f = frame(angle, direction);
      const { u, v } = toLocal(scenario.shooter, f, scenario.target.x, scenario.target.y);

      for (const cand of candidates(u, v)) {
        let fn;
        try {
          fn = compile(cand.source);
        } catch {
          continue; // a malformed source is a bug in the family, not a shot
        }
        tried++;
        const result = trace(scenario, fn, { angle, direction, step });
        const shot = {
          function: cand.source,
          angle,
          direction: direction < 0 ? 'left' : 'right',
          family: cand.family,
          shape: cand.shape,
          outcome: result.outcome,
          clearance: result.clearance,
          missDistance: result.missDistance,
          travel: result.travel,
          maxSlope: result.maxSlope,
          points: result.points,
          blockedBy: result.blockedBy,
        };
        if (result.outcome === 'hit') {
          shot.score = score(shot);
          shot.signature = pathSignature(result.points);
          shots.push(shot);
        } else if (!nearest || result.missDistance < nearest.missDistance) {
          nearest = shot;
        }
      }
    }
  }

  shots.sort((a, b) => b.score - a.score);
  return { shots: dedupe(shots).slice(0, top), tried, scenario, nearest: shots.length ? null : nearest };
}

/**
 * Room for error first: a shot that threads a 0.1-unit gap is worthless once
 * the board moves. After that, prefer calm curves over wild ones — a gentler
 * shot is likelier to survive small differences between this model and the game.
 */
const SIMPLICITY = { line: 5, parabola: 3, sine: 1, step: 1, bump: 1, cubic: 0 };

function score(shot) {
  // past ~2.5 units of clearance the shot is not going to fail for want of room,
  // so extra margin stops earning and the tie-breakers take over
  const room = Math.min(shot.clearance, 2.5) * 8;
  const calm = -Math.min(shot.maxSlope, 40) * 0.35;
  const direct = -shot.travel * 0.06;
  // a flat aim and a plain curve are the easiest to reproduce under time pressure
  const level = -Math.abs(shot.angle) * 0.06;
  return room + calm + direct + level + (SIMPLICITY[shot.family] ?? 0);
}

/**
 * One entry per *trajectory*. Two candidates that fly the same arc — a mirrored
 * angle/direction pair, or neighbouring shape parameters that round to the same
 * curve — are one answer, not several, so key on the flown path itself.
 */
function dedupe(shots) {
  const seen = new Set();
  return shots.filter((s) => {
    if (seen.has(s.signature)) return false;
    seen.add(s.signature);
    return true;
  });
}

/** Eight evenly spaced points along the flown path, rounded to half a unit. */
function pathSignature(points) {
  const n = 8;
  const out = [];
  for (let i = 0; i <= n; i++) {
    const p = points[Math.min(points.length - 1, Math.round((i / n) * (points.length - 1)))];
    out.push(`${Math.round(p.x * 2)},${Math.round(p.y * 2)}`);
  }
  return out.join(';');
}

/** Fly one function the user typed themselves, and say what it would do. */
export function check(raw, source, { angle = 0, direction = null, step = DEFAULT_STEP } = {}) {
  const scenario = normalize(raw);
  const fn = compile(source);
  const dir = direction ?? directionToward(scenario.shooter, scenario.target, angle);
  const result = trace(scenario, fn, { angle, direction: dir, step });
  return { function: source, angle, direction: dir < 0 ? 'left' : 'right', ...result, scenario };
}
