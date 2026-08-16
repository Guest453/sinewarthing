// graphwar-ai :: scenario
// the board as the solver sees it, plus the shooter-local coordinate frame that
// Graphwar plots functions in.
//
// Frame: a shot is plotted in a frame anchored on the firing soldier. `u` runs
// forward along the firing direction, `v = f(u)` runs perpendicular to it — the
// aim angle rotates that frame, and firing left mirrors the forward axis while
// leaving "up" alone (positive f still means up on screen).

import { toRadians } from './geometry.js';

export const FIELD = { xMin: -25, xMax: 25, yMin: -15, yMax: 15 };

// Graphwar units. Soldiers are small; terrain blobs are approximated as circles.
export const SOLDIER_RADIUS = 0.55;
// how far the trace ignores collisions, so you never shoot yourself point-blank
export const MUZZLE_CLEARANCE = 0.8;

export function normalize(raw) {
  if (!raw || typeof raw !== 'object') throw new TypeError('scenario must be an object');
  const field = { ...FIELD, ...(raw.field || {}) };
  if (field.xMax <= field.xMin || field.yMax <= field.yMin) throw new RangeError('field bounds are inverted');

  const shooter = point(raw.shooter, 'shooter');
  const target = point(raw.target, 'target');

  const soldiers = (raw.soldiers || []).map((s, i) => ({
    id: s.id || `soldier${i + 1}`,
    x: num(s.x, 'soldier.x'),
    y: num(s.y, 'soldier.y'),
    r: s.r == null ? SOLDIER_RADIUS : num(s.r, 'soldier.r'),
    team: s.team || 'enemy',
  }));

  const terrain = (raw.terrain || []).map((t, i) => ({
    id: t.id || `blob${i + 1}`,
    x: num(t.x, 'terrain.x'),
    y: num(t.y, 'terrain.y'),
    r: num(t.r, 'terrain.r'),
  }));

  return {
    field,
    shooter: { id: 'shooter', r: SOLDIER_RADIUS, ...shooter },
    target: { id: 'target', r: SOLDIER_RADIUS, ...target },
    soldiers,
    terrain,
    // Graphwar versions differ on whether a shot that leaves the top of the
    // field survives. Default to the pessimistic reading: leaving kills it.
    clipY: raw.clipY !== false,
  };
}

function point(p, what) {
  if (!p || typeof p !== 'object') throw new TypeError(`${what} is required`);
  return { x: num(p.x, `${what}.x`), y: num(p.y, `${what}.y`), r: p.r == null ? SOLDIER_RADIUS : num(p.r, `${what}.r`) };
}

function num(v, what) {
  const n = Number(v);
  if (!Number.isFinite(n)) throw new TypeError(`${what} must be a finite number`);
  return n;
}

/** Orthonormal basis of the firing frame: forward axis and "up" axis. */
export function frame(angleDeg, direction) {
  const t = toRadians(angleDeg);
  const d = direction < 0 ? -1 : 1;
  return {
    ax: d * Math.cos(t), ay: d * Math.sin(t), // forward (u)
    bx: -Math.sin(t), by: Math.cos(t), // up (v)
    direction: d,
  };
}

/** Local (u, v) -> world (x, y), anchored on the shooter. */
export function toWorld(shooter, f, u, v) {
  return {
    x: shooter.x + u * f.ax + v * f.bx,
    y: shooter.y + u * f.ay + v * f.by,
  };
}

/** World point -> local (u, v). The basis is orthonormal, so this is a dot product. */
export function toLocal(shooter, f, x, y) {
  const wx = x - shooter.x;
  const wy = y - shooter.y;
  return { u: wx * f.ax + wy * f.ay, v: wx * f.bx + wy * f.by };
}

/** Which way to face so the target is in front of us at this aim angle. */
export function directionToward(shooter, target, angleDeg) {
  const t = toRadians(angleDeg);
  const forward = (target.x - shooter.x) * Math.cos(t) + (target.y - shooter.y) * Math.sin(t);
  return forward >= 0 ? 1 : -1;
}
