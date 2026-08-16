// sine-wars :: commander layer
// every few seconds each faction sends its *beliefs* (never the truth) to a
// language model and gets orders back as JSON. no key? heuristics take over
// and the match runs exactly the same, just less mouthy.

import { FACTIONS, WORLD, alive, briefing, clamp } from './sim.js';

const BASE = 'https://gen.pollinations.ai';

const store = typeof localStorage !== 'undefined' ? localStorage : null;

export const settings = {
  key: store?.getItem('sw.key') || '',
  model: store?.getItem('sw.model') || 'openai-fast',
  enabled: store?.getItem('sw.enabled') === '1',
};

export function saveSettings(patch) {
  Object.assign(settings, patch);
  if (!store) return;
  store.setItem('sw.key', settings.key);
  store.setItem('sw.model', settings.model);
  store.setItem('sw.enabled', settings.enabled ? '1' : '0');
}

export async function listModels() {
  const r = await fetch(`${BASE}/v1/models`);
  if (!r.ok) throw new Error(`models ${r.status}`);
  const data = await r.json();
  return (data.data || data || []).map((m) => m.id || m.name).filter(Boolean);
}

const PERSONA = {
  peace:
    'You command CONCORD, a pacifist swarm. Your units are armed and put every ' +
    'round deliberately wide. You survive by scattering, screening wounded ' +
    'units and denying the enemy a clean fix. If you are ever reduced to one ' +
    'surviving unit, that unit stops missing and stops needing estimates.',
  rogue:
    'You command NULLSET, a hostile swarm. You are fast, loud and reckless. ' +
    'You win by collapsing on the nearest contact before it can be resolved.',
  pro:
    'You command MERIDIAN, an elite swarm. You are quiet and patient, you ' +
    'ignore CONCORD unless ordered otherwise, and you prioritise NULLSET.',
};

const SYSTEM = (fid) => `${PERSONA[fid]}
You see only triangulated position ESTIMATES with an error radius in units.
A large error_radius means the fix is untrustworthy. The field is ${WORLD.w}x${WORLD.h}.
Reply with ONLY a JSON object, no prose, no markdown fences:
{"stance":"hunt|hold|scatter|flank|shield|purge","rally":[x,y],"focus":"<contact id or null>","line":"<under 12 words, in character>"}`;

function heuristic(world, fid) {
  const contacts = Object.entries(world.beliefs[fid]);
  const me = alive(world, fid);
  const cx = me.reduce((s, a) => s + a.x, 0) / (me.length || 1);
  const cy = me.reduce((s, a) => s + a.y, 0) / (me.length || 1);
  const best = contacts.sort((a, b) => a[1].sigma - b[1].sigma)[0];
  const hurt = me.filter((a) => a.hp < a.maxHp * 0.5).length;

  if (fid === 'peace') {
    const threat = best ? best[1] : null;
    const rally = threat
      ? [clamp(cx - (threat.x - cx) * 0.6, 60, WORLD.w - 60), clamp(cy - (threat.y - cy) * 0.6, 60, WORLD.h - 60)]
      : [cx, cy];
    return { stance: hurt > 1 ? 'shield' : 'scatter', rally, focus: null, line: hurt ? 'closing ranks around the wounded.' : 'we drift, we do not answer.' };
  }
  if (fid === 'rogue') {
    return {
      stance: 'hunt',
      rally: best ? [best[1].x, best[1].y] : [WORLD.w / 2, WORLD.h / 2],
      focus: best ? best[0] : null,
      line: best ? 'contact resolved. collapse on it.' : 'nothing on the wire. spread out.',
    };
  }
  const rogueFix = contacts.find(([id]) => id.startsWith('rogue'));
  const pick = rogueFix || best;
  return {
    stance: pick && pick[1].sigma < 110 ? 'flank' : 'hold',
    rally: pick ? [pick[1].x, pick[1].y] : [WORLD.w / 2, WORLD.h / 2],
    focus: pick ? pick[0] : null,
    line: pick && pick[1].sigma < 110 ? 'fix is clean. take the shot.' : 'error radius too wide. we wait.',
  };
}

function sanitise(raw, world, fid) {
  const fb = heuristic(world, fid);
  if (!raw || typeof raw !== 'object') return fb;
  const rally = Array.isArray(raw.rally) && raw.rally.length === 2 && raw.rally.every((n) => Number.isFinite(+n))
    ? [clamp(+raw.rally[0], 40, WORLD.w - 40), clamp(+raw.rally[1], 40, WORLD.h - 40)]
    : fb.rally;
  const stances = ['hunt', 'hold', 'scatter', 'flank', 'shield', 'purge'];
  const focus = typeof raw.focus === 'string' && world.beliefs[fid][raw.focus] ? raw.focus : fb.focus;
  return {
    stance: stances.includes(raw.stance) ? raw.stance : fb.stance,
    rally,
    focus,
    line: typeof raw.line === 'string' ? raw.line.slice(0, 90) : fb.line,
    fromModel: true,
  };
}

export async function requestOrders(world, fid) {
  if (!settings.enabled || !settings.key) return { orders: heuristic(world, fid), source: 'local' };

  const body = {
    model: settings.model,
    messages: [
      { role: 'system', content: SYSTEM(fid) },
      { role: 'user', content: JSON.stringify(briefing(world, fid)) },
    ],
    temperature: 0.85,
    seed: -1,
    response_format: { type: 'json_object' },
  };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const r = await fetch(`${BASE}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.key}`,
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!r.ok) {
      const detail = r.status === 401 ? 'key rejected' : r.status === 402 ? 'out of pollen' : `http ${r.status}`;
      return { orders: heuristic(world, fid), source: 'local', error: detail };
    }
    const data = await r.json();
    const text = data?.choices?.[0]?.message?.content ?? '';
    const json = JSON.parse(text.replace(/```json|```/g, '').trim());
    return { orders: sanitise(json, world, fid), source: settings.model };
  } catch (e) {
    const why = e.name === 'AbortError' ? 'model timed out' : 'malformed reply';
    return { orders: heuristic(world, fid), source: 'local', error: why };
  } finally {
    clearTimeout(timer);
  }
}

export function factionColor(fid) {
  return FACTIONS[fid].color;
}
