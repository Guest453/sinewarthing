// sine-wars :: simulation core
// three factions of agents move on sine-modulated headings, listen for each
// other's emissions, and triangulate bearings into position estimates.
// nobody ever knows exactly where anyone is. that's the whole point.

export const WORLD = { w: 1280, h: 800 };

export const FACTIONS = {
  peace: {
    id: 'peace',
    name: 'CONCORD',
    role: 'peace',
    color: '#4fd6c8',
    dim: 'rgba(79,214,200,0.16)',
    sensorSkill: 0.85,   // lower = noisier bearings
    emitPeriod: 1.1,     // how often it leaks a detectable signal
    fireRate: 0.5,       // it fires. it just never aims at you.
    range: 340,
    blurb: 'stabilises allies, fires warning shots wide on purpose, leaks signal constantly',
  },
  rogue: {
    id: 'rogue',
    name: 'NULLSET',
    role: 'bad',
    color: '#ff4d6d',
    dim: 'rgba(255,77,109,0.16)',
    sensorSkill: 1.05,
    emitPeriod: 2.8,
    fireRate: 0.85,
    range: 300,
    blurb: 'fast, sloppy aim, jams every sensor in the field',
  },
  pro: {
    id: 'pro',
    name: 'MERIDIAN',
    role: 'pro',
    color: '#ffb03a',
    dim: 'rgba(255,176,58,0.16)',
    sensorSkill: 0.45,
    emitPeriod: 3.4,
    fireRate: 0.48,
    range: 330,
    blurb: 'quiet, patient, fuses four bearings before it commits',
  },
};

const CALLSIGNS = [
  'ARC', 'BLT', 'CYG', 'DLT', 'ECH', 'FRM', 'GLX', 'HLM',
  'ION', 'JNX', 'KLV', 'LMN', 'MRT', 'NVA', 'ORB', 'PXL',
];

const HP = { peace: 100, rogue: 126, pro: 104 };

let uid = 0;
const rand = (a, b) => a + Math.random() * (b - a);
const gauss = () => {
  // box-muller, because uniform noise looks fake on a radar
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function makeAgent(factionId, i) {
  const f = FACTIONS[factionId];
  const edge = { peace: 0.18, rogue: 0.82, pro: 0.5 }[factionId];
  return {
    id: `${factionId}-${uid++}`,
    tag: `${CALLSIGNS[(uid * 7) % CALLSIGNS.length]}-${(i + 1).toString().padStart(2, '0')}`,
    faction: factionId,
    x: WORLD.w * edge + rand(-90, 90),
    y: WORLD.h * (0.2 + 0.6 * (i / 5)) + rand(-40, 40),
    dir: rand(-Math.PI, Math.PI),
    speed: rand(52, 74) * (factionId === 'rogue' ? 1.22 : 1),
    hp: HP[factionId],
    maxHp: HP[factionId],
    // the sine part: heading is a carrier wave, not a straight line
    phase: rand(0, Math.PI * 2),
    freq: rand(0.35, 1.15),
    amp: rand(0.5, 1.5) * (f.role === 'pro' ? 0.6 : 1),
    emitAt: rand(0, f.emitPeriod),
    cooldown: rand(0, 2),
    trail: [],
    alive: true,
  };
}

export function createWorld(counts = { peace: 4, rogue: 6, pro: 4 }) {
  uid = 0;
  const agents = [];
  for (const fid of Object.keys(FACTIONS)) {
    for (let i = 0; i < counts[fid]; i++) agents.push(makeAgent(fid, i));
  }
  return {
    t: 0,
    tick: 0,
    agents,
    shots: [],
    pings: [],
    // beliefs[faction][targetId] = { x, y, sigma, seen, n }
    beliefs: { peace: {}, rogue: {}, pro: {} },
    // raw bearing measurements per faction, decayed over time
    fixes: { peace: {}, rogue: {}, pro: {} },
    orders: {
      peace: { stance: 'shield', rally: [WORLD.w * 0.2, WORLD.h * 0.5], focus: null, line: 'holding the line, hurting no one.' },
      rogue: { stance: 'hunt', rally: [WORLD.w * 0.8, WORLD.h * 0.5], focus: null, line: 'we find them by their noise.' },
      pro: { stance: 'hold', rally: [WORLD.w * 0.5, WORLD.h * 0.5], focus: null, line: 'four bearings or we do not fire.' },
    },
    log: [],
    stats: { shotsFired: 0, hits: 0, kills: 0 },
    lastShot: 0,
    over: false,
  };
}

export function alive(world, fid) {
  return world.agents.filter((a) => a.alive && a.faction === fid);
}

function jamLevel(world, x, y, observerFaction) {
  // NULLSET floods the band. it is deaf to its own noise; nobody else is.
  if (observerFaction === 'rogue') return 0;
  let j = 0;
  for (const a of world.agents) {
    if (!a.alive || a.faction !== 'rogue') continue;
    const d = Math.hypot(a.x - x, a.y - y);
    if (d < 430) j += (1 - d / 430) * 0.85;
  }
  return j;
}

// ---- sensing -------------------------------------------------------------
// an emitter leaks a signal. every listener gets a BEARING only, blurred by
// distance, jamming and its own sensor quality. no ranges, no free lunch.

function emit(world, src) {
  world.pings.push({ x: src.x, y: src.y, r: 0, faction: src.faction, life: 1 });
  for (const obs of world.agents) {
    if (!obs.alive || obs.faction === src.faction) continue;
    const dx = src.x - obs.x, dy = src.y - obs.y;
    const dist = Math.hypot(dx, dy);
    const reach = FACTIONS[obs.faction].range * 1.9;
    if (dist > reach) continue;

    const skill = FACTIONS[obs.faction].sensorSkill;
    const jam = jamLevel(world, obs.x, obs.y, obs.faction);
    // noise grows with distance, shrinks with skill
    const sd = (0.05 + 0.30 * (dist / reach)) * skill * (1 + jam);
    const bearing = wrapAngle(Math.atan2(dy, dx) + gauss() * sd);

    const store = world.fixes[obs.faction];
    (store[src.id] ||= []).push({
      ox: obs.x, oy: obs.y, bearing, sd, t: world.t,
    });
    if (store[src.id].length > 14) store[src.id].shift();
  }
}

// least-squares intersection of bearing lines.
// each line: n . (p - o) = 0 where n = (-sin b, cos b).
// stack them, solve the 2x2 normal equations. this is the "math sine shit".
function solveLines(fixes, ranges) {
  let a11 = 0, a12 = 0, a22 = 0, b1 = 0, b2 = 0;
  for (let i = 0; i < fixes.length; i++) {
    const f = fixes[i];
    const nx = -Math.sin(f.bearing), ny = Math.cos(f.bearing);
    // the perpendicular miss of a bearing line is range * angular error, so
    // the weight has to carry the range or far contacts look suspiciously good
    const s = f.sd * ranges[i];
    const w = 1 / (s * s);
    const c = nx * f.ox + ny * f.oy;
    a11 += w * nx * nx; a12 += w * nx * ny; a22 += w * ny * ny;
    b1 += w * nx * c;   b2 += w * ny * c;
  }
  const det = a11 * a22 - a12 * a12;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null;
  return {
    x: (a22 * b1 - a12 * b2) / det,
    y: (a11 * b2 - a12 * b1) / det,
    trace: (a11 + a22) / det, // trace of inv(AtWA), in world units squared
  };
}

// least-squares intersection of bearing lines.
// each line: n . (p - o) = 0 where n = (-sin b, cos b).
// two passes: the first guesses the ranges, the second uses them to weight
// properly. the covariance trace is the honest error estimate — when the
// observers bunch up, the bearings go parallel and it explodes. this is the
// whole reason a swarm has to spread out before it can shoot at anything.
function triangulate(fixes) {
  const flat = fixes.map(() => 1);
  const first = solveLines(fixes, flat);
  if (!first) return null;
  const ranges = fixes.map((f) => Math.max(50, Math.hypot(first.x - f.ox, first.y - f.oy)));
  const second = solveLines(fixes, ranges) || first;
  // 1.6x: the linear solution is optimistic about its own bias, measured against
  // ground truth over long runs. the agents still trust it slightly too much.
  const sigma = 1.6 * Math.sqrt(Math.max(second.trace, 0)) + 30 / Math.sqrt(fixes.length);
  if (!Number.isFinite(second.x) || !Number.isFinite(second.y) || !Number.isFinite(sigma)) return null;
  return {
    x: clamp(second.x, -400, WORLD.w + 400),
    y: clamp(second.y, -400, WORLD.h + 400),
    sigma: Math.min(sigma, 900),
  };
}

function updateBeliefs(world, dt) {
  if (world.ascension) {
    // the last one stops guessing. every enemy, exact, no error radius.
    const truth = {};
    for (const a of world.agents) {
      if (!a.alive || a.faction === 'peace') continue;
      const prev = world.beliefs.peace[a.id];
      const gap = prev ? Math.max(0.05, world.t - prev.t) : 1;
      truth[a.id] = {
        x: a.x, y: a.y,
        vx: prev ? (a.x - prev.x) / gap : 0,
        vy: prev ? (a.y - prev.y) / gap : 0,
        sigma: 1, n: 99, t: world.t, stale: false, exact: true,
      };
    }
    world.beliefs.peace = truth;
  }
  const MEMORY = 1.6; // seconds a bearing stays useful — older than this and the
                      // target has simply walked out of its own bearing line
  for (const fid of Object.keys(FACTIONS)) {
    if (fid === 'peace' && world.ascension) continue;
    const store = world.fixes[fid];
    const beliefs = world.beliefs[fid];
    for (const targetId of Object.keys(store)) {
      const fresh = store[targetId].filter((f) => world.t - f.t < MEMORY);
      store[targetId] = fresh;
      if (fresh.length === 0) {
        const b = beliefs[targetId];
        if (b) { b.sigma += 120 * dt; b.stale = true; if (b.sigma > 460) delete beliefs[targetId]; }
        continue;
      }
      // spread observers out so the lines actually cross
      const spread = [];
      for (const f of fresh) {
        if (!spread.some((s) => Math.hypot(s.ox - f.ox, s.oy - f.oy) < 22)) spread.push(f);
      }
      const fix = triangulate(spread.length >= 2 ? spread : fresh);
      if (!fix) continue;
      const prev = beliefs[targetId];
      // exponential smoothing, weighted toward the confident fix
      const k = prev ? clamp(0.55 * (prev.sigma / (prev.sigma + fix.sigma)) + 0.2, 0.2, 0.9) : 1;
      const nx = prev ? prev.x + (fix.x - prev.x) * k : fix.x;
      const ny = prev ? prev.y + (fix.y - prev.y) * k : fix.y;
      // a crude velocity track, so shooters can lead the estimate
      let vx = 0, vy = 0;
      if (prev) {
        const gap = Math.max(0.08, world.t - prev.t);
        vx = prev.vx + ((nx - prev.x) / gap - prev.vx) * 0.3;
        vy = prev.vy + ((ny - prev.y) / gap - prev.vy) * 0.3;
        const sp = Math.hypot(vx, vy);
        if (sp > 110) { vx *= 110 / sp; vy *= 110 / sp; }
      }
      beliefs[targetId] = {
        x: nx,
        y: ny,
        vx, vy,
        sigma: prev ? prev.sigma + (fix.sigma - prev.sigma) * k : fix.sigma,
        n: spread.length,
        t: world.t,
        stale: false,
      };
    }
  }
}

// ---- behaviour -----------------------------------------------------------

function targetFor(world, agent) {
  const beliefs = world.beliefs[agent.faction];
  const orders = world.orders[agent.faction];
  let best = null, bestScore = -Infinity;
  for (const [id, b] of Object.entries(beliefs)) {
    const target = world.agents.find((a) => a.id === id);
    if (!target || !target.alive) { delete beliefs[id]; continue; }
    if (agent.faction === 'pro' && target.faction === 'peace' && orders.stance !== 'purge') continue;
    const d = Math.hypot(b.x - agent.x, b.y - agent.y);
    let score = -d - b.sigma * 1.6;
    if (orders.focus === id) score += 700;
    if (target.faction === 'rogue' && agent.faction === 'pro') score += 260;
    // NULLSET goes for whoever shoots back first
    if (target.faction === 'pro' && agent.faction === 'rogue') score += 320;
    if (score > bestScore) { bestScore = score; best = { id, ...b, ref: target }; }
  }
  return best;
}

function steer(world, agent, dt) {
  const orders = world.orders[agent.faction];
  const [rx, ry] = orders.rally;
  const belief = targetFor(world, agent);
  agent.belief = belief;

  let gx = rx, gy = ry;
  const role = FACTIONS[agent.faction].role;

  // blind sweep: with nothing on the wire, orbit the rally point instead of
  // parking on it, or two swarms can sit 800 units apart and never meet
  if (!belief && role !== 'peace') {
    gx = rx + Math.cos(world.t * 0.22 + agent.phase) * 300;
    gy = ry + Math.sin(world.t * 0.22 + agent.phase) * 220;
  }

  if (role === 'bad' && belief) { gx = belief.x; gy = belief.y; }
  if (role === 'pro' && belief) {
    // hold at the edge of weapon range, don't rush in
    const d = Math.hypot(belief.x - agent.x, belief.y - agent.y) || 1;
    const keep = FACTIONS.pro.range * 0.82;
    gx = belief.x - ((belief.x - agent.x) / d) * keep;
    gy = belief.y - ((belief.y - agent.y) / d) * keep;
  }
  if (role === 'peace' && agent.ascended && belief) {
    // nothing left to protect. close the distance.
    gx = belief.x; gy = belief.y;
  } else if (role === 'peace') {
    // move away from anything it believes is hostile, toward hurt allies
    let ax = 0, ay = 0, n = 0;
    for (const b of Object.values(world.beliefs.peace)) {
      const d = Math.hypot(b.x - agent.x, b.y - agent.y) || 1;
      if (d < 320) { ax -= (b.x - agent.x) / d; ay -= (b.y - agent.y) / d; n++; }
    }
    const hurt = alive(world, 'peace')
      .filter((a) => a !== agent && a.hp < a.maxHp * 0.6)
      .sort((p, q) => p.hp - q.hp)[0];
    if (hurt && orders.stance !== 'scatter') { ax += (hurt.x - agent.x) / 200; ay += (hurt.y - agent.y) / 200; }
    if (n || hurt) { gx = agent.x + ax * 300; gy = agent.y + ay * 300; }
  }

  // separation so they don't stack into one pixel
  for (const o of world.agents) {
    if (o === agent || !o.alive) continue;
    const d = Math.hypot(o.x - agent.x, o.y - agent.y);
    if (d < 34 && d > 0.1) { gx -= (o.x - agent.x) * 2.5; gy -= (o.y - agent.y) * 2.5; }
  }

  const want = Math.atan2(gy - agent.y, gx - agent.x);
  let diff = wrapAngle(want - agent.dir);
  agent.dir = wrapAngle(agent.dir + clamp(diff, -2.4 * dt, 2.4 * dt));

  // THE SINE: heading is modulated by the agent's own carrier wave, so paths
  // are serpentine and a single bearing snapshot ages badly.
  const wobble = Math.sin(world.t * agent.freq * 2 * Math.PI * 0.35 + agent.phase) * agent.amp;
  const heading = agent.dir + wobble * 0.55;

  agent.x += Math.cos(heading) * agent.speed * dt;
  agent.y += Math.sin(heading) * agent.speed * dt;
  agent.heading = heading;

  if (agent.x < 24) { agent.x = 24; agent.dir = wrapAngle(Math.PI - agent.dir); }
  if (agent.x > WORLD.w - 24) { agent.x = WORLD.w - 24; agent.dir = wrapAngle(Math.PI - agent.dir); }
  if (agent.y < 24) { agent.y = 24; agent.dir = -agent.dir; }
  if (agent.y > WORLD.h - 24) { agent.y = WORLD.h - 24; agent.dir = -agent.dir; }

  agent.trail.push({ x: agent.x, y: agent.y });
  if (agent.trail.length > 46) agent.trail.shift();
}

function act(world, agent, dt) {
  const f = FACTIONS[agent.faction];
  agent.cooldown -= dt;

  if (f.role === 'peace' && !agent.ascended) {
    // harmony pulse: repairs nearby allies, costs it nothing but visibility
    if (agent.cooldown <= 0) {
      agent.cooldown = 2.2;
      for (const o of alive(world, 'peace')) {
        if (Math.hypot(o.x - agent.x, o.y - agent.y) < 165) o.hp = Math.min(o.maxHp, o.hp + 4);
      }
      world.pings.push({ x: agent.x, y: agent.y, r: 0, faction: 'peace', life: 1, heal: true });
    }
    // warning shots. CONCORD is armed and always has been — it just puts every
    // round deliberately wide, far enough out that no plausible aim error could
    // have produced it. the enemy can read that. it keeps reading it wrong.
    agent.shotCd = (agent.shotCd ?? 0) - dt;
    const wb = agent.belief;
    if (wb && agent.shotCd <= 0) {
      const wd = Math.hypot(wb.x - agent.x, wb.y - agent.y);
      if (wd < f.range) {
        agent.shotCd = 1 / f.fireRate;
        const base = Math.atan2(wb.y - agent.y, wb.x - agent.x);
        const side = Math.random() < 0.5 ? -1 : 1;
        const off = side * (0.16 + Math.random() * 0.10); // ~10-15 degrees wide
        world.shots.push({
          x: agent.x, y: agent.y,
          tx: agent.x + Math.cos(base + off) * wd,
          ty: agent.y + Math.sin(base + off) * wd,
          faction: 'peace', speed: 560, dmg: 0, blast: 0, warning: true, p: 0,
        });
      }
    }
    return;
  }

  if (agent.ascended) {
    // LAST LIGHT: no triangulation, no error radius, no restraint.
    if (agent.cooldown > 0) return;
    const target = world.agents
      .filter((a) => a.alive && a.faction !== 'peace')
      .sort((a, b2) => Math.hypot(a.x - agent.x, a.y - agent.y) - Math.hypot(b2.x - agent.x, b2.y - agent.y))[0];
    if (!target) return;
    agent.cooldown = 1 / 2.4;
    world.stats.shotsFired++;
    world.lastShot = world.t;
    const lead = Math.hypot(target.x - agent.x, target.y - agent.y) / 900;
    world.shots.push({
      x: agent.x, y: agent.y,
      tx: target.x + Math.cos(target.heading || target.dir) * target.speed * lead,
      ty: target.y + Math.sin(target.heading || target.dir) * target.speed * lead,
      faction: 'peace', speed: 900, dmg: 62, blast: 46, p: 0,
    });
    return;
  }

  const b = agent.belief;
  if (!b || agent.cooldown > 0) return;
  const d = Math.hypot(b.x - agent.x, b.y - agent.y);
  if (d > f.range) return;
  // pros refuse to fire on a fix they don't trust
  if (f.role === 'pro' && (b.sigma > 160 || b.n < 2)) return;
  if (f.role === 'bad' && b.sigma > 225) return;

  agent.cooldown = 1 / f.fireRate;
  world.stats.shotsFired++;
  world.lastShot = world.t;
  const muzzle = 560;
  const lead = (f.role === 'pro' ? 1 : 0.7) * (d / muzzle);
  const px = b.x + (b.vx || 0) * lead;
  const py = b.y + (b.vy || 0) * lead;
  const pd = Math.hypot(px - agent.x, py - agent.y);
  const aimErr = (f.role === 'pro' ? 0.02 : 0.05) * (1 + b.sigma / 240);
  const ang = Math.atan2(py - agent.y, px - agent.x) + gauss() * aimErr;
  world.shots.push({
    x: agent.x, y: agent.y,
    tx: agent.x + Math.cos(ang) * pd,
    ty: agent.y + Math.sin(ang) * pd,
    faction: agent.faction,
    speed: muzzle,
    dmg: f.role === 'pro' ? 30 : 15,
    blast: f.role === 'pro' ? 30 : 54,
    purge: world.orders[agent.faction].stance === 'purge',
    p: 0,
  });
}

function stepShots(world, dt) {
  for (const s of world.shots) {
    const total = Math.hypot(s.tx - s.x, s.ty - s.y) || 1;
    s.p += (s.speed * dt) / total;
    s.cx = s.x + (s.tx - s.x) * Math.min(1, s.p);
    s.cy = s.y + (s.ty - s.y) * Math.min(1, s.p);
    if (s.p >= 1 && !s.done) {
      s.done = true;
      let hitAny = false;
      for (const a of world.agents) {
        if (!a.alive || a.faction === s.faction) continue;
        // MERIDIAN spares CONCORD unless its commander explicitly orders a purge
        if (a.faction === 'peace' && s.faction === 'pro' && !s.purge) continue;
        const d = Math.hypot(a.x - s.tx, a.y - s.ty);
        if (d < s.blast) {
          a.hp -= s.dmg * (1 - d / s.blast / 2);
          hitAny = true;
          if (a.hp <= 0) {
            a.alive = false;
            world.stats.kills++;
            pushLog(world, s.faction, `${a.tag} went dark — ${FACTIONS[a.faction].name} down to ${alive(world, a.faction).length}`);
          }
        }
      }
      if (hitAny) world.stats.hits++;
      s.impact = 0.35;
    }
  }
  world.shots = world.shots.filter((s) => !s.done || (s.impact -= dt) > 0);
}

export function pushLog(world, faction, text) {
  world.log.unshift({ faction, text, t: world.t });
  if (world.log.length > 60) world.log.pop();
}

export function step(world, dt) {
  if (world.over) return;
  world.t += dt;
  world.tick++;

  for (const a of world.agents) {
    if (!a.alive) continue;
    a.emitAt -= dt;
    if (a.emitAt <= 0) {
      a.emitAt = FACTIONS[a.faction].emitPeriod * rand(0.75, 1.25);
      emit(world, a);
    }
    steer(world, a, dt);
  }
  updateBeliefs(world, dt);
  for (const a of world.agents) if (a.alive) act(world, a, dt);
  stepShots(world, dt);

  for (const p of world.pings) { p.r += (p.heal ? 150 : 260) * dt; p.life -= dt * 0.75; }
  world.pings = world.pings.filter((p) => p.life > 0);

  // LAST LIGHT — every other CONCORD unit is gone. the survivor stops missing.
  const concord = alive(world, 'peace');
  if (!world.ascension && concord.length === 1 && world.agents.some((a) => a.faction === 'peace' && !a.alive)) {
    const last = concord[0];
    world.ascension = { at: world.t, tag: last.tag };
    last.ascended = true;
    last.hp = last.maxHp;
    last.speed *= 1.35;
    last.amp *= 0.35;
    last.cooldown = 0.6;
    pushLog(world, 'peace', `${last.tag} is the last one. it stops missing.`);
  }

  const standing = Object.keys(FACTIONS).filter((f) => alive(world, f).length > 0);
  if (standing.length <= 1) {
    world.over = true;
    world.outcome = standing.length ? 'last-standing' : 'blackout';
    world.winner = standing[0] || null;
  } else if (world.t - world.lastShot > 40 && !standing.includes('rogue')) {
    // nobody left who is both willing and able to shoot
    world.over = true;
    world.outcome = 'ceasefire';
    world.winner = null;
    world.standing = standing;
  } else if (world.t - world.lastShot > 150) {
    // hostiles standing but nobody can find anybody. call it.
    world.over = true;
    world.outcome = 'stalemate';
    world.winner = null;
    world.standing = standing;
  }
}

// compact state for the commander models — bearings only, never ground truth
export function briefing(world, fid) {
  const mine = alive(world, fid).map((a) => ({
    id: a.tag,
    pos: [Math.round(a.x), Math.round(a.y)],
    hp: Math.round(a.hp),
  }));
  const contacts = Object.entries(world.beliefs[fid]).map(([id, b]) => {
    const ref = world.agents.find((a) => a.id === id);
    return {
      id,
      faction: ref ? FACTIONS[ref.faction].name : '?',
      estimate: [Math.round(b.x), Math.round(b.y)],
      error_radius: Math.round(b.sigma),
      bearings_used: b.n,
    };
  });
  return {
    you: FACTIONS[fid].name,
    doctrine: FACTIONS[fid].blurb,
    field: [WORLD.w, WORLD.h],
    clock: Math.round(world.t),
    my_units: mine,
    contacts,
    enemy_counts: Object.keys(FACTIONS)
      .filter((f) => f !== fid)
      .map((f) => ({ faction: FACTIONS[f].name, standing: alive(world, f).length })),
  };
}
