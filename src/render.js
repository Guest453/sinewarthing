// sine-wars :: renderer
// the signature of this thing is the belief overlay: every dashed ring is one
// faction's guess, and the hairline tether shows how wrong it is right now.

import { WORLD, FACTIONS } from './sim.js';

export const view = {
  showBeliefs: true,
  showTethers: true,
  showBearings: false,
  focusFaction: null, // null = all factions' beliefs
};

export function fitCanvas(canvas) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  return { dpr, cssW: rect.width, cssH: rect.height };
}

function backdrop(ctx, w, h, t) {
  ctx.fillStyle = '#080d1a';
  ctx.fillRect(0, 0, w, h);

  // lattice
  ctx.strokeStyle = 'rgba(120,160,220,0.055)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x <= WORLD.w; x += 64) { ctx.moveTo(x, 0); ctx.lineTo(x, WORLD.h); }
  for (let y = 0; y <= WORLD.h; y += 64) { ctx.moveTo(0, y); ctx.lineTo(WORLD.w, y); }
  ctx.stroke();

  // a slow carrier wave across the floor, because the whole sim runs on one
  ctx.strokeStyle = 'rgba(120,160,220,0.10)';
  ctx.beginPath();
  for (let x = 0; x <= WORLD.w; x += 6) {
    const y = WORLD.h / 2 + Math.sin(x * 0.006 + t * 0.7) * 120 * Math.sin(t * 0.21 + x * 0.0012);
    x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.stroke();
}

function chevron(ctx, a, color) {
  ctx.save();
  ctx.translate(a.x, a.y);
  ctx.rotate(a.heading || a.dir);
  ctx.beginPath();
  ctx.moveTo(11, 0);
  ctx.lineTo(-7, 7);
  ctx.lineTo(-3.5, 0);
  ctx.lineTo(-7, -7);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 12;
  ctx.fill();
  ctx.restore();
}

export function draw(ctx, world, layout) {
  const { dpr, cssW, cssH } = layout;
  const scale = Math.min(cssW / WORLD.w, cssH / WORLD.h);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);
  ctx.fillStyle = '#080d1a';
  ctx.fillRect(0, 0, cssW, cssH);
  ctx.save();
  ctx.translate((cssW - WORLD.w * scale) / 2, (cssH - WORLD.h * scale) / 2);
  ctx.scale(scale, scale);

  backdrop(ctx, WORLD.w, WORLD.h, world.t);

  // emission rings
  for (const p of world.pings) {
    ctx.strokeStyle = FACTIONS[p.faction].color;
    ctx.globalAlpha = Math.max(0, p.life) * (p.heal ? 0.5 : 0.28);
    ctx.lineWidth = p.heal ? 2 : 1.2;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // sine trails
  for (const a of world.agents) {
    if (!a.alive || a.trail.length < 2) continue;
    const c = FACTIONS[a.faction].color;
    ctx.strokeStyle = c;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    a.trail.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.globalAlpha = 0.22;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // raw bearing lines (optional, gets busy fast)
  if (view.showBearings) {
    for (const fid of Object.keys(FACTIONS)) {
      if (view.focusFaction && fid !== view.focusFaction) continue;
      ctx.strokeStyle = FACTIONS[fid].color;
      ctx.globalAlpha = 0.10;
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      for (const list of Object.values(world.fixes[fid])) {
        for (const f of list) {
          ctx.moveTo(f.ox, f.oy);
          ctx.lineTo(f.ox + Math.cos(f.bearing) * 900, f.oy + Math.sin(f.bearing) * 900);
        }
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  // belief overlay — the point of the whole project
  if (view.showBeliefs) {
    ctx.setLineDash([5, 6]);
    for (const fid of Object.keys(FACTIONS)) {
      if (view.focusFaction && fid !== view.focusFaction) continue;
      const c = FACTIONS[fid].color;
      for (const [id, b] of Object.entries(world.beliefs[fid])) {
        const truth = world.agents.find((a) => a.id === id);
        const conf = Math.max(0.12, 1 - b.sigma / 340);
        ctx.strokeStyle = c;
        ctx.globalAlpha = 0.20 + conf * 0.45;
        ctx.lineWidth = 1.1;
        ctx.beginPath();
        ctx.arc(b.x, b.y, Math.max(10, b.sigma), 0, Math.PI * 2);
        ctx.stroke();

        ctx.globalAlpha = 0.5 + conf * 0.4;
        ctx.beginPath();
        ctx.moveTo(b.x - 6, b.y); ctx.lineTo(b.x + 6, b.y);
        ctx.moveTo(b.x, b.y - 6); ctx.lineTo(b.x, b.y + 6);
        ctx.stroke();

        if (view.showTethers && truth && truth.alive) {
          ctx.globalAlpha = 0.30;
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 0.7;
          ctx.beginPath();
          ctx.moveTo(b.x, b.y);
          ctx.lineTo(truth.x, truth.y);
          ctx.stroke();
        }
      }
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  // tracers
  for (const s of world.shots) {
    const c = FACTIONS[s.faction].color;
    if (s.warning) {
      // deliberately wide. drawn thin so you can see them sail past.
      ctx.strokeStyle = c;
      ctx.globalAlpha = s.done ? 0 : 0.32;
      ctx.setLineDash([3, 5]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(s.cx, s.cy);
      ctx.lineTo(s.x, s.y);
      ctx.stroke();
      ctx.setLineDash([]);
      continue;
    }
    if (!s.done) {
      const tail = 26;
      const ang = Math.atan2(s.ty - s.y, s.tx - s.x);
      ctx.strokeStyle = c;
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.moveTo(s.cx, s.cy);
      ctx.lineTo(s.cx - Math.cos(ang) * tail, s.cy - Math.sin(ang) * tail);
      ctx.stroke();
    } else {
      ctx.strokeStyle = c;
      ctx.globalAlpha = Math.max(0, s.impact) * 2;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(s.tx, s.ty, s.blast * (1.4 - s.impact * 2), 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;

  // agents
  for (const a of world.agents) {
    const c = FACTIONS[a.faction].color;
    if (!a.alive) {
      ctx.globalAlpha = 0.22;
      ctx.strokeStyle = c;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(a.x - 6, a.y - 6); ctx.lineTo(a.x + 6, a.y + 6);
      ctx.moveTo(a.x + 6, a.y - 6); ctx.lineTo(a.x - 6, a.y + 6);
      ctx.stroke();
      ctx.globalAlpha = 1;
      continue;
    }
    if (a.ascended) {
      // LAST LIGHT
      const pulse = 20 + Math.sin(world.t * 5) * 5;
      ctx.strokeStyle = '#ffffff';
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.arc(a.x, a.y, pulse, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 0.18;
      ctx.beginPath(); ctx.arc(a.x, a.y, pulse * 2.1, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;
      chevron(ctx, a, '#ffffff');
      chevron(ctx, a, c);
      continue;
    }
    chevron(ctx, a, c);

    // hp arc
    const frac = a.hp / a.maxHp;
    ctx.strokeStyle = frac > 0.4 ? c : '#ff4d6d';
    ctx.globalAlpha = 0.8;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(a.x, a.y, 15, -Math.PI * 0.5, -Math.PI * 0.5 + Math.PI * 2 * frac);
    ctx.stroke();
    ctx.globalAlpha = 1;

    ctx.fillStyle = 'rgba(226,236,255,0.55)';
    ctx.font = '9px "IBM Plex Mono", monospace';
    ctx.fillText(a.tag, a.x + 17, a.y + 3);
  }

  ctx.restore();
}
