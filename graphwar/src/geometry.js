// graphwar-ai :: geometry
// everything the tracer needs to decide what a segment of curve ran into.

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

export function hypot(dx, dy) {
  return Math.sqrt(dx * dx + dy * dy);
}

/** Shortest distance from point p to segment ab. */
export function pointSegmentDistance(px, py, ax, ay, bx, by) {
  const abx = bx - ax;
  const aby = by - ay;
  const len2 = abx * abx + aby * aby;
  if (len2 === 0) return hypot(px - ax, py - ay);
  const t = clamp(((px - ax) * abx + (py - ay) * aby) / len2, 0, 1);
  return hypot(px - (ax + t * abx), py - (ay + t * aby));
}

/** Does segment ab come within r of centre c? */
export function segmentHitsCircle(ax, ay, bx, by, cx, cy, r) {
  return pointSegmentDistance(cx, cy, ax, ay, bx, by) <= r;
}

export function toRadians(deg) {
  return (deg * Math.PI) / 180;
}
