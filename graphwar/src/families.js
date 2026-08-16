// graphwar-ai :: function families
// every candidate is built to pass through the target by construction — the
// free parameters only decide the *shape* of the detour on the way there. that
// turns aiming from a blind search into a search over how to dodge, which is
// why a few hundred candidates is enough to solve most boards.
//
// shape parameters are in field units (how high the arc bulges, how tall the
// step is), not raw coefficients, so the same grid behaves sensibly whether the
// target is 4 units away or 40.

import { fmt, round, joinTerms } from './expr.js';

/** Smallest forward distance worth solving for. Closer than this, rotate the aim instead. */
export const MIN_REACH = 1.5;

const term = (coefficient, rest) => {
  const c = round(coefficient);
  if (c === 0) return '';
  if (!rest) return fmt(c);
  if (c === 1) return rest;
  if (c === -1) return `-${rest}`;
  return `${fmt(c)}*${rest}`;
};

const range = (from, to, stepSize) => {
  const out = [];
  for (let v = from; v <= to + 1e-9; v += stepSize) out.push(round(v, 6));
  return out;
};

// bulge heights, in field units, tried on every arc-shaped family
const HEIGHTS = [...range(-14, -1, 1), ...range(1, 14, 1)];

/**
 * @param {number} u forward distance to the target in the firing frame
 * @param {number} v vertical offset to the target in the firing frame
 * @returns {Array<{family: string, source: string, shape: object}>}
 */
export function candidates(u, v) {
  if (!(u >= MIN_REACH)) return [];
  const slope = v / u;
  const chord = term(slope, 'x');
  const out = [];

  // 1. straight shot — the answer whenever line of sight is clear
  out.push({ family: 'line', source: chord || '0', shape: {} });

  // 2. parabola: one arc, parameterised by how high it bulges off the chord
  for (const h of HEIGHTS) {
    // deviation from the chord peaks at -a*u^2/4, so a = -4h/u^2
    const a = (-4 * h) / (u * u);
    const b = (v - round(a) * u * u) / u;
    out.push({
      family: 'parabola',
      source: joinTerms([term(a, 'x^2'), term(b, 'x')]) || '0',
      shape: { apex: h },
    });
  }

  // 3. cubic: two bulges, so it can duck under one blob and hop over the next
  for (const h1 of [-10, -6, -3, 3, 6, 10]) {
    for (const h2 of [-10, -6, -3, 3, 6, 10]) {
      // g(x) = x(x-u)(px+q) is the deviation from the chord: zero at both ends
      const k = (-2 * u * u) / 9;
      const p = (3 * (h2 - h1)) / (k * u);
      const q = (2 * h1 - h2) / k;
      const a = round(p);
      const b = round(q - p * u);
      const c = (v - a * u * u * u - b * u * u) / u;
      out.push({
        family: 'cubic',
        source: joinTerms([term(a, 'x^3'), term(b, 'x^2'), term(c, 'x')]) || '0',
        shape: { third: h1, twoThirds: h2 },
      });
    }
  }

  // 4. sine: weaves through gaps. n half-waves fit between the two soldiers, so
  //    the curve is back on the chord exactly at the target no matter the amplitude
  for (const n of [1, 2, 3, 4, 5]) {
    const k = (n * Math.PI) / u;
    for (const amp of [2, 4, 6, 8, 10]) {
      for (const sign of [1, -1]) {
        out.push({
          family: 'sine',
          source: joinTerms([chord, term(sign * amp, `sin(${fmt(k)}*x)`)]) || '0',
          shape: { halfWaves: n, amplitude: sign * amp },
        });
      }
    }
  }

  // 5. bump: a localised hop over one wall, flat everywhere else
  for (const at of [0.25, 0.4, 0.55, 0.7, 0.85]) {
    const c = round(u * at);
    for (const w of [1.5, 2.5, 4]) {
      for (const amp of [3, 6, 9, 12, -3, -6, -9]) {
        // the bump has not fully decayed at the target, so correct the slope for it
        const residual = amp * Math.exp(-(((u - c) / w) ** 2));
        const m = (v - residual) / u;
        out.push({
          family: 'bump',
          source: joinTerms([term(m, 'x'), term(amp, `exp(-((x-${fmt(c)})/${fmt(w)})^2)`)]) || '0',
          shape: { at: c, width: w, amplitude: amp },
        });
      }
    }
  }

  // 6. step: climb a ridge and stay up, or drop into a trench and stay down
  for (const at of [0.3, 0.5, 0.7]) {
    const c = round(u * at);
    for (const w of [0.6, 1.5, 3]) {
      for (const amp of [3, 6, 9, 12, -3, -6, -9, -12]) {
        const residual = amp * Math.tanh((u - c) / w);
        const m = (v - residual) / u;
        out.push({
          family: 'step',
          source: joinTerms([term(m, 'x'), term(amp, `tanh((x-${fmt(c)})/${fmt(w)})`)]) || '0',
          shape: { at: c, width: w, amplitude: amp },
        });
      }
    }
  }

  return out;
}
