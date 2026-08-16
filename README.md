# SINE WARS

Three AI factions fight on a field where **nobody knows where anybody is.**

No unit ever gets an enemy's position handed to it. Agents leak signal, rivals
catch a noisy *bearing* — an angle, no range — and the swarm has to intersect
enough of those angles to guess where the contact actually is. Movement runs on
a sine carrier, so every path is serpentine and a two-second-old bearing is
already pointing at empty space.

Faction commanders are language models talking to the [Pollinations API](https://gen.pollinations.ai/docs).
They see the same estimates their units do, and never the truth.

**Live:** https://guest453.github.io/sinewarthing/

---

## The factions

| | Callsign | Doctrine |
|---|---|---|
| 🩵 | **CONCORD** | Pacifists — but armed. Every round goes deliberately 10–15° wide, far enough out that no plausible aim error could explain it. They repair each other, scatter from contacts, and leak signal constantly. See **Last Light** below. |
| ❤️ | **NULLSET** | Hostiles. Fast, numerous, sloppy aim. Jam every sensor in a 430-unit radius — and are deaf to their own noise. |
| 🧡 | **MERIDIAN** | Professionals. Quiet, patient, longest reach. Refuse to fire on a fix they don't trust, and spare CONCORD — *unless a commander orders a purge.* |

### Last Light

CONCORD's warning shots are readable. The enemy keeps reading them wrong.

The moment CONCORD is reduced to **one surviving unit**, that unit ascends:

- triangulation switches off entirely — it gets every enemy's **exact** position, every frame, no error radius
- rate of fire ×5, damage ×4, muzzle velocity 900, perfect lead
- speed ×1.35, sine amplitude cut to 0.35 — it stops weaving and comes straight at you

It has never once lost after that.

Baseline over 20 heuristic runs: **~15% end in Last Light** with the sole
CONCORD survivor wiping the field. The rest end in a CONCORD + MERIDIAN
ceasefire, pacifists usually untouched. Hand the commanders to a model and
that stops being reliable — MERIDIAN can order a `purge`, and killing three
CONCORD units instead of four is the worst possible outcome for everybody.

## The math

Each emission gives every listener one line, not a point:

```
n · (p − o) = 0        n = (−sin b, cos b)
```

Stack every fresh bearing, weight it, solve the 2×2 normal equations. Two
passes: the first guesses each observer's range to the contact, the second
re-weights by `range × angular_error`, because the perpendicular miss of a
bearing line grows with distance.

The interesting number is the covariance, not the fit:

```
Σ = (AᵀWA)⁻¹        error_radius ≈ √tr(Σ)
```

When observers bunch together the bearings go near-parallel, `det(AᵀWA)` goes
to zero and the error radius explodes — even though the residuals look
perfect. That's the whole tactical layer. A swarm that collapses on a contact
loses the ability to locate it. MERIDIAN spreads before it commits; NULLSET
piles in and shoots at ghosts.

Bearings expire after 1.6 seconds. Beliefs carry a velocity track so shooters
can lead the estimate. Reported error radius is scaled 1.6× and is *still*
optimistic against ground truth — the agents trust themselves slightly too
much, which felt right.

Turn on **Error tethers** to see the hairline between what a faction believes
and where the unit actually is.

## Running the commanders

Model commanders are **on by default** — a publishable key (`pk_…`) ships in
`src/brains.js`. That's the key type designed for client-side code: it grants no
account access and is rate limited per IP, so the page can carry one in the open.
Under load it can run dry, and the factions simply fall back to local heuristics —
the sim is identical, just quieter.

To spend your own pollen instead:

1. Grab your own publishable key at [enter.pollinations.ai](https://enter.pollinations.ai).
2. Open **Commanders**, paste it, pick a model, tick the switch.

Clear the field to fall back to the shared key, or untick the switch to run pure
heuristics.

Every ~6.5s each faction posts its briefing — own units, contact estimates,
error radii, bearing counts — to `POST /v1/chat/completions` and gets back:

```json
{"stance":"hunt|hold|scatter|flank|shield|purge","rally":[x,y],"focus":"<contact id>","line":"<under 12 words>"}
```

Every field is validated against the world before it's applied, so a model
can't teleport its units or invent a contact. `line` is what shows up in Comms.

`purge` is the one that matters: it's the only way MERIDIAN's guns unlock on
CONCORD. A model has to decide to do that on its own.

`openai-fast` is the cheapest model that reliably returns clean JSON.
`gemini-fast` and `mistral` also behave. The key lives in this device's
localStorage and goes nowhere else.

## Running it locally

Plain ES modules, no build step, no dependencies.

```bash
git clone https://github.com/Guest453/sinewarthing.git
cd sinewarthing
python3 -m http.server 8000   # or: npx serve
```

Then open `http://localhost:8000`. Opening `index.html` straight off the disk
won't work — ES modules need a real origin.

## Deploying

Push, then **Settings → Pages → Source: GitHub Actions**. The workflow in
`.github/workflows/pages.yml` publishes the repo root on every push to `main`.

## Files

```
index.html          shell
assets/style.css    tokens + layout
src/sim.js          agents, sine movement, triangulation, combat
src/brains.js       Pollinations commanders + heuristic fallback
src/render.js       canvas, belief overlay, tracers
src/main.js         loop, rail, controls
```

## Knobs worth turning

- `FACTIONS` in `sim.js` — sensor quality, emission period, rate of fire, reach.
- `MEMORY` in `updateBeliefs` — raise it and everyone shoots at the past.
- `amp` / `freq` in `makeAgent` — how hard the sine carrier whips the paths.
- `createWorld({ peace: 4, rogue: 6, pro: 4 })` — squad sizes.
- the Last Light block in `step()` — trigger condition and what the survivor gets.

MIT.
