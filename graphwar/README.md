# GRAPHWAR AI

An aiming solver for [Graphwar](http://www.graphwar.com/). You describe the
board; it hands back the **function to type**.

```
$ node bin/gw-aim.js examples/wall.json --top 2

2 shots from (-18, -6) onto (16, -6) — 2044 candidates tried

1. y = -0.0277*x^2+0.9418*x
   parabola · angle 0° · facing right
   clearance 3.0u · peak slope 0.9 · path 38.0u

2. y = -0.0311*x^2+1.0574*x
   parabola · angle 0° · facing right
   clearance 3.9u · peak slope 1.1 · path 39.0u
```

No dependencies, no build. Node 18+.

---

## The idea

Blind search over coefficients is hopeless — almost every function misses, so
almost every trace is wasted. So nothing here searches for a hit.

Every candidate is **constructed to pass through the target already**. Take the
target's position in the shooter's frame, `(u, v)`, and a family with one free
shape parameter — say a parabola `a*x² + b*x`. Pick how high you want the arc to
bulge, that fixes `a`, and then `b = (v - a*u²)/u` is forced. The curve now ends
on the target for *any* bulge you chose.

That turns the question from *"which function hits?"* into *"which way do I go
around the terrain?"* — and that space is small enough to enumerate. A couple of
thousand candidates covers a board:

| Family | Shape | Good for |
|---|---|---|
| `line` | — | clear line of sight |
| `parabola` | apex height | lobbing over one obstacle |
| `cubic` | two bulges | under one blob, over the next |
| `sine` | half-waves, amplitude | weaving down a corridor |
| `bump` | position, width, height | hopping one wall, flat elsewhere |
| `step` | position, width, height | climbing a ridge and staying up |

Each survivor is flown through a tracer that mimics the game — step along the
local x-axis, connect samples with segments, stop at the first thing hit — and
what comes back is ranked by **room for error** first, then by how calm the curve
is. A shot that threads a 0.1-unit gap is worthless once anything moves.

### What you type is what was simulated

Candidates are emitted as Graphwar source text and then **parsed back** through
`src/expr.js` before being traced. The solver never flies an internal closure
that merely resembles the printed string, so rounding a coefficient for display
cannot silently change the shot. The test suite re-parses every returned function
from its printed text and re-flies it to confirm it still connects.

---

## Usage

```bash
node bin/gw-aim.js <scenario.json> [options]

  --top N            how many shots to print (default 5)
  --angles a,b,c     aim angles to search, in degrees
  --both-directions  also consider firing away from the target
  --step S           tracer resolution in field units (default 0.05)
  --svg PATH         write a picture of the board and the shots
  --json             machine-readable output
  --check "EXPR"     fly one function of your own instead of searching
  --angle A          aim angle for --check
```

Check your own idea before you commit to it — exits non-zero on a miss:

```
$ node bin/gw-aim.js examples/wall.json --check "0"
y = 0   [angle 0°, facing right]
  TERRAIN on wall — closest approach to target 21.9u, travelled 12.1u
```

### As a library

```js
import { solve, check } from './graphwar/src/solve.js';

const { shots } = solve({
  shooter: { x: -18, y: -6 },
  target: { x: 16, y: -6 },
  terrain: [{ x: 0, y: -7, r: 6 }],
});
console.log(shots[0].function); // "-0.0277*x^2+0.9418*x"
```

## Scenarios

```json
{
  "field":    { "xMin": -25, "xMax": 25, "yMin": -15, "yMax": 15 },
  "shooter":  { "x": -18, "y": -6 },
  "target":   { "x": 16, "y": -6 },
  "soldiers": [{ "id": "ally-scout", "x": -9, "y": 0, "team": "mine" }],
  "terrain":  [{ "id": "wall", "x": 0, "y": -7, "r": 6 }],
  "clipY": true
}
```

Only `shooter` and `target` are required. Terrain is approximated as circles —
overlap several to fence in a real Graphwar blob. Every soldier blocks, including
your own team, which is exactly how the game treats them.

## Reading the output

- **clearance** — how close the flown path came to anything it did not intend to
  touch. Your margin for error. `clear lane` means it never came near anything.
- **peak slope** — how vertical the curve gets. Steep shots are the ones most
  likely to behave differently in game than here.
- **path** — arc length travelled.

## Assumptions

These are modelled from how Graphwar plays, not read out of its source, and the
places where the real game may differ are the places a suggested shot can fail:

- The field defaults to x ∈ [-25, 25], y ∈ [-15, 15]. Override with `field`.
- Functions are plotted in a frame anchored on the firing soldier: `u` forward,
  `f(u)` perpendicular. The aim angle rotates that frame; firing left mirrors the
  forward axis while leaving "up" alone, so positive `f` is up either way.
- A shot leaving the field dies — including through the top. Some versions let a
  high shot come back down; set `"clipY": false` to allow it.
- Soldier hitboxes are 0.55 units. Collisions are tested against the straight
  segment between samples, so a discontinuity is *travel*: the shot crosses
  whatever lies in the jump.
- The shooter cannot block its own muzzle for the first 0.8 units, but a curve
  that loops back into it does get blocked.

Grid resolution is 0.05 units by default; `--step 0.01` is stricter and slower.

## Tests

```bash
cd graphwar && npm test
```

## License

MIT, same as the rest of the repo.
