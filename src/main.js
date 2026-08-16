// sine-wars :: entry point

import { createWorld, step, FACTIONS, alive, pushLog } from './sim.js';
import { draw, fitCanvas, view } from './render.js';
import { requestOrders, settings, saveSettings, listModels } from './brains.js';

const $ = (id) => document.getElementById(id);
const canvas = $('field');
const ctx = canvas.getContext('2d');

let world = createWorld();
let layout = fitCanvas(canvas);
let running = true;
let speed = 1;
let last = performance.now();
const nextOrders = { peace: 1.5, rogue: 2.5, pro: 3.5 };
const pending = {};
const sources = { peace: 'local', rogue: 'local', pro: 'local' };

addEventListener('resize', () => { layout = fitCanvas(canvas); });

// ---- loop ----
function frame(now) {
  const raw = Math.min((now - last) / 1000, 0.05);
  last = now;
  if (running) {
    const dt = raw * speed;
    step(world, dt);
    scheduleOrders(dt);
    if (world.over) endMatch();
  }
  draw(ctx, world, layout);
  paintCards();
  requestAnimationFrame(frame);
}

function scheduleOrders(dt) {
  for (const fid of Object.keys(FACTIONS)) {
    if (alive(world, fid).length === 0) continue;
    nextOrders[fid] -= dt;
    if (nextOrders[fid] > 0 || pending[fid]) continue;
    nextOrders[fid] = settings.enabled && settings.key ? 6.5 : 3;
    pending[fid] = true;
    requestOrders(world, fid)
      .then(({ orders, source, error }) => {
        world.orders[fid] = orders;
        sources[fid] = error ? `local · ${error}` : source;
        if (orders.line) pushLog(world, fid, orders.line);
      })
      .finally(() => { pending[fid] = false; });
  }
}

function endMatch() {
  const el = $('verdict');
  const w = world.winner;
  el.hidden = false;
  if (w === 'peace' && world.ascension) {
    el.style.color = '#ffffff';
    el.textContent = `LAST LIGHT — ${world.ascension.tag} STANDS ALONE`;
  } else if (w) {
    el.style.color = FACTIONS[w].color;
    el.textContent = `${FACTIONS[w].name} STANDS`;
  } else if (world.outcome === 'stalemate') {
    el.style.color = '#7f8fb0';
    el.textContent = 'STALEMATE — CONTACT LOST';
  } else if (world.outcome === 'ceasefire') {
    el.style.color = '#7f8fb0';
    el.textContent = `CEASEFIRE — ${world.standing.map((f) => FACTIONS[f].name).join(' + ')}`;
  } else {
    el.style.color = '#7f8fb0';
    el.textContent = 'MUTUAL BLACKOUT';
  }
}

// ---- rail ----
let lastPaint = 0;
function paintCards() {
  if (performance.now() - lastPaint < 220) return;
  lastPaint = performance.now();

  $('cards').innerHTML = Object.values(FACTIONS).map((f) => {
    const units = alive(world, f.id);
    const o = world.orders[f.id];
    const ascended = f.id === 'peace' && world.ascension;
    const contacts = Object.keys(world.beliefs[f.id]).length;
    const avgErr = contacts
      ? Math.round(Object.values(world.beliefs[f.id]).reduce((s, b) => s + b.sigma, 0) / contacts)
      : null;
    const bars = Array.from({ length: 6 }, (_, i) => `<i class="${i < units.length ? 'on' : ''}"></i>`).join('');
    return `<article class="card" style="border-left-color:${f.color};color:${f.color}">
      <h3>${f.name}</h3>
      <div class="row"><span>${units.length} standing</span><span>${ascended ? 'LAST LIGHT' : o.stance.toUpperCase()}</span></div>
      <div class="row"><span>${contacts} contacts</span><span>${ascended ? 'EXACT' : avgErr !== null ? `±${avgErr}u` : 'no fix'}</span></div>
      <div class="bars">${bars}</div>
      <p class="line" style="color:var(--text)">${escapeHtml(o.line || '')}</p>
      <div class="src">${escapeHtml(sources[f.id])}</div>
    </article>`;
  }).join('');

  $('log').innerHTML = world.log.slice(0, 26).map((e) =>
    `<li style="color:${FACTIONS[e.faction].color}"><b>${FACTIONS[e.faction].name}</b> <span>${escapeHtml(e.text)}</span></li>`
  ).join('');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---- controls ----
$('playBtn').onclick = (e) => {
  running = !running;
  e.target.textContent = running ? 'Pause' : 'Resume';
};

$('resetBtn').onclick = () => {
  world = createWorld();
  Object.assign(nextOrders, { peace: 1.5, rogue: 2.5, pro: 3.5 });
  $('verdict').hidden = true;
  running = true;
  $('playBtn').textContent = 'Pause';
};

$('speed').oninput = (e) => {
  speed = +e.target.value;
  $('speedOut').textContent = `${speed.toFixed(1)}×`;
};

$('tglBeliefs').onchange = (e) => (view.showBeliefs = e.target.checked);
$('tglTethers').onchange = (e) => (view.showTethers = e.target.checked);
$('tglBearings').onchange = (e) => (view.showBearings = e.target.checked);
$('focusSel').onchange = (e) => (view.focusFaction = e.target.value || null);

// ---- commander config ----
const cfg = $('cfg');
const openCfg = () => { cfg.hidden = false; $('cfgBtn').setAttribute('aria-expanded', 'true'); $('keyIn').focus(); };
const closeCfg = () => { cfg.hidden = true; $('cfgBtn').setAttribute('aria-expanded', 'false'); };

$('cfgBtn').onclick = openCfg;
$('cfgClose').onclick = closeCfg;
cfg.onclick = (e) => { if (e.target === cfg) closeCfg(); };
addEventListener('keydown', (e) => { if (e.key === 'Escape' && !cfg.hidden) closeCfg(); });

$('keyIn').value = settings.key;
$('enableIn').checked = settings.enabled;

const FALLBACK_MODELS = ['openai-fast', 'openai', 'mistral', 'gemini-fast', 'claude-fast', 'deepseek', 'nova-fast'];
function fillModels(list) {
  const sel = $('modelIn');
  sel.innerHTML = list.map((m) => `<option value="${escapeHtml(m)}"${m === settings.model ? ' selected' : ''}>${escapeHtml(m)}</option>`).join('');
  if (!list.includes(settings.model)) sel.value = list[0];
}
fillModels(FALLBACK_MODELS);
listModels()
  .then((m) => fillModels([...new Set([...m])].sort()))
  .catch(() => { $('modelNote').textContent = 'Model list unreachable — showing known-good defaults.'; });

$('cfgSave').onclick = () => {
  const key = $('keyIn').value.trim();
  const enabled = $('enableIn').checked;
  saveSettings({ key, model: $('modelIn').value, enabled });
  const status = $('cfgStatus');
  if (enabled && !key) status.textContent = 'Saved. Field left empty — falling back to the shared key that ships with the page.';
  else if (enabled && !key.startsWith('pk_')) status.textContent = 'Saved. That key does not look publishable — a pk_ key is safer in a browser.';
  else if (enabled) status.textContent = `Saved. ${$('modelIn').value} takes command on the next order cycle.`;
  else status.textContent = 'Saved. Running on local heuristics.';
  Object.assign(nextOrders, { peace: 0.2, rogue: 0.5, pro: 0.8 });
};

requestAnimationFrame((t) => { last = t; frame(t); });
