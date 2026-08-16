// graphwar-ai :: preview
// an SVG of the board with the suggested shots drawn on it. seeing the arc is
// the fastest way to tell "that threads the gap" from "that is a coin flip".

const PX = 18; // pixels per field unit
const SHOT_COLORS = ['#ffd23f', '#4fd6c8', '#ff8fab', '#9d8cff', '#8fd694'];

export function toSvg(scenario, shots = [], { title = 'graphwar aim' } = {}) {
  const { field } = scenario;
  const w = (field.xMax - field.xMin) * PX;
  const h = (field.yMax - field.yMin) * PX;
  const X = (x) => (x - field.xMin) * PX;
  const Y = (y) => (field.yMax - y) * PX; // screen y grows downward

  const grid = [];
  for (let x = Math.ceil(field.xMin / 5) * 5; x <= field.xMax; x += 5) {
    grid.push(`<line x1="${X(x)}" y1="0" x2="${X(x)}" y2="${h}" class="grid${x === 0 ? ' axis' : ''}"/>`);
  }
  for (let y = Math.ceil(field.yMin / 5) * 5; y <= field.yMax; y += 5) {
    grid.push(`<line x1="0" y1="${Y(y)}" x2="${w}" y2="${Y(y)}" class="grid${y === 0 ? ' axis' : ''}"/>`);
  }

  const terrain = scenario.terrain.map(
    (t) => `<circle cx="${X(t.x)}" cy="${Y(t.y)}" r="${t.r * PX}" class="terrain"/>`
  );

  const paths = shots.map((s, i) => {
    const color = SHOT_COLORS[i % SHOT_COLORS.length];
    const d = s.points.map((p, j) => `${j ? 'L' : 'M'}${X(p.x).toFixed(1)} ${Y(p.y).toFixed(1)}`).join('');
    return `<path d="${d}" fill="none" stroke="${color}" stroke-width="${i === 0 ? 2.6 : 1.6}"
      opacity="${i === 0 ? 1 : 0.55}" stroke-linecap="round"/>`;
  });

  const soldiers = scenario.soldiers.map((s) => dot(X(s.x), Y(s.y), s.r * PX, s.team === 'mine' ? 'ally' : 'enemy', s.id));
  const marks = [
    ...soldiers,
    dot(X(scenario.shooter.x), Y(scenario.shooter.y), scenario.shooter.r * PX, 'shooter', 'you'),
    dot(X(scenario.target.x), Y(scenario.target.y), scenario.target.r * PX, 'target', 'target'),
  ];

  const legend = shots.map((s, i) => {
    const color = SHOT_COLORS[i % SHOT_COLORS.length];
    return `<text x="10" y="${20 + i * 16}" class="legend" fill="${color}">${escapeXml(
      `${i + 1}. y = ${s.function}   [angle ${s.angle}°, ${s.direction}]`
    )}</text>`;
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${escapeXml(title)}">
<style>
  .bg { fill: #0b1220; }
  .grid { stroke: rgba(126,156,210,0.12); stroke-width: 1; }
  .grid.axis { stroke: rgba(126,156,210,0.32); }
  .terrain { fill: #24422c; stroke: #3f6b4a; stroke-width: 1.5; }
  .shooter { fill: #4fd6c8; }
  .target { fill: #ff4d6d; }
  .ally { fill: #7f8fb0; }
  .enemy { fill: #ff9f45; }
  text { font-family: ui-monospace, "IBM Plex Mono", monospace; font-size: 11px; }
  .legend { font-size: 12px; }
  .tag { fill: #c9d6ee; }
</style>
<rect class="bg" width="${w}" height="${h}"/>
${grid.join('\n')}
${terrain.join('\n')}
${paths.join('\n')}
${marks.join('\n')}
${legend.join('\n')}
</svg>`;

  function dot(cx, cy, r, cls, label) {
    return `<circle cx="${cx}" cy="${cy}" r="${Math.max(r, 4)}" class="${cls}"/>
<text class="tag" x="${cx + 8}" y="${cy - 8}">${escapeXml(label)}</text>`;
  }
}

function escapeXml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
}
