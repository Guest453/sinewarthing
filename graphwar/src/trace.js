// graphwar-ai :: tracer
// walks a candidate curve the way the game flies the shot: step forward along
// the local x-axis, connect consecutive samples with a straight segment, and
// stop at the first thing that segment touches. a discontinuity is therefore
// still travel — the shot crosses whatever lies in the jump, exactly as in game.

import { frame, toWorld, MUZZLE_CLEARANCE } from './scenario.js';
import { pointSegmentDistance } from './geometry.js';

export const DEFAULT_STEP = 0.05;
/** Reported clearance when the path never came near anything at all. */
export const OPEN_LANE = 99;

/**
 * @returns {{
 *   outcome: 'hit'|'terrain'|'blocked'|'out'|'undefined'|'stalled',
 *   blockedBy: string|null, points: Array<{x:number,y:number,u:number}>,
 *   clearance: number, missDistance: number, travel: number, maxSlope: number
 * }}
 * `clearance` is how close the surviving path came to anything it did not mean
 * to touch — the margin for error. `missDistance` is the closest the curve came
 * to the target, which is what ranks near-misses against each other.
 */
export function trace(scenario, fn, { angle = 0, direction = 1, step = DEFAULT_STEP, maxU = null } = {}) {
  const { shooter, target, soldiers, terrain, field } = scenario;
  const f = frame(angle, direction);
  const span = maxU ?? (field.xMax - field.xMin) * 1.5;

  const points = [];
  let clearance = Infinity;
  let missDistance = Infinity;
  let travel = 0;
  let maxSlope = 0;

  let prev = null;
  let prevV = 0;
  for (let u = 0; u <= span + 1e-9; u += step) {
    const v = fn(u);
    if (!Number.isFinite(v)) {
      return done('undefined', null);
    }
    if (prev) {
      const slope = Math.abs((v - prevV) / step);
      if (slope > maxSlope) maxSlope = slope;
    }
    const p = { ...toWorld(shooter, f, u, v), u };
    points.push(p);

    if (prev) {
      travel += Math.hypot(p.x - prev.x, p.y - prev.y);

      // the target is checked first: touching it is the point of the exercise
      const dTarget = pointSegmentDistance(target.x, target.y, prev.x, prev.y, p.x, p.y);
      if (dTarget < missDistance) missDistance = dTarget;
      if (dTarget <= target.r) return done('hit', target.id);

      // everything else along the way is an obstruction
      for (const s of soldiers) {
        const d = pointSegmentDistance(s.x, s.y, prev.x, prev.y, p.x, p.y);
        if (d <= s.r) return done('blocked', s.id);
        if (d - s.r < clearance) clearance = d - s.r;
      }
      // the shooter blocks too, but not while the shot is still leaving the barrel.
      // it deliberately does not count toward clearance: every shot starts point
      // blank against its own hitbox, so scoring that as risk would punish them all.
      if (u > MUZZLE_CLEARANCE) {
        const d = pointSegmentDistance(shooter.x, shooter.y, prev.x, prev.y, p.x, p.y);
        if (d <= shooter.r) return done('blocked', shooter.id);
      }
      for (const t of terrain) {
        const d = pointSegmentDistance(t.x, t.y, prev.x, prev.y, p.x, p.y);
        if (d <= t.r) return done('terrain', t.id);
        if (d - t.r < clearance) clearance = d - t.r;
      }
    }

    if (outOfField(p, field, scenario.clipY)) return done('out', null);

    prev = p;
    prevV = v;
  }

  return done('stalled', null);

  function done(outcome, blockedBy) {
    return {
      outcome,
      blockedBy,
      points,
      clearance: Number.isFinite(clearance) ? clearance : OPEN_LANE,
      missDistance,
      travel,
      maxSlope,
    };
  }
}

function outOfField(p, field, clipY) {
  if (p.x < field.xMin || p.x > field.xMax) return true;
  return clipY && (p.y < field.yMin || p.y > field.yMax);
}
