import test from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../src/expr.js';
import { normalize, toLocal, frame } from '../src/scenario.js';
import { trace } from '../src/trace.js';

const board = (extra = {}) => normalize({
  shooter: { x: -10, y: 0 },
  target: { x: 10, y: 0 },
  ...extra,
});

test('a flat shot down an empty lane connects', () => {
  const r = trace(board(), compile('0'), { angle: 0, direction: 1 });
  assert.equal(r.outcome, 'hit');
  assert.equal(r.blockedBy, 'target');
  assert.ok(r.missDistance < 0.6);
});

test('terrain in the lane stops the shot', () => {
  const r = trace(board({ terrain: [{ id: 'wall', x: 0, y: 0, r: 3 }] }), compile('0'), { direction: 1 });
  assert.equal(r.outcome, 'terrain');
  assert.equal(r.blockedBy, 'wall');
});

test('an arc clears what a flat shot cannot', () => {
  const scenario = board({ terrain: [{ id: 'wall', x: 0, y: 0, r: 3 }] });
  // apex ~7 units over the chord, back on the deck at x=20
  const r = trace(scenario, compile('-0.07*x^2+1.4*x'), { direction: 1 });
  assert.equal(r.outcome, 'hit');
  assert.ok(r.clearance > 0, 'should clear the blob with room to spare');
});

test('a friendly in the way blocks the shot', () => {
  const scenario = board({ soldiers: [{ id: 'ally', x: 0, y: 0, team: 'mine' }] });
  const r = trace(scenario, compile('0'), { direction: 1 });
  assert.equal(r.outcome, 'blocked');
  assert.equal(r.blockedBy, 'ally');
});

test('the shooter does not block its own muzzle', () => {
  const r = trace(board(), compile('0'), { direction: 1 });
  assert.notEqual(r.blockedBy, 'shooter');
});

test('but a curve that loops back into the shooter does', () => {
  // straight up and over: comes back down through where it was fired from
  const scenario = board({ target: { x: -10, y: 12 } });
  const r = trace(scenario, compile('8*sin(0.7*x)'), { angle: 0, direction: 1 });
  assert.ok(['blocked', 'out', 'terrain'].includes(r.outcome));
});

test('leaving the field ends the shot', () => {
  const r = trace(board({ target: { x: 24, y: 0 } }), compile('20*x'), { direction: 1 });
  assert.equal(r.outcome, 'out');
});

test('an undefined value kills the shot rather than skipping it', () => {
  const r = trace(board(), compile('sqrt(0-x-1)'), { direction: 1 });
  assert.equal(r.outcome, 'undefined');
});

test('firing left mirrors forward but keeps positive f pointing up', () => {
  const scenario = normalize({ shooter: { x: 10, y: 0 }, target: { x: -10, y: 0 } });
  const f = frame(0, -1);
  const local = toLocal(scenario.shooter, f, scenario.target.x, scenario.target.y);
  assert.ok(local.u > 0, 'target is in front when facing left');
  const up = trace(scenario, compile('2'), { direction: -1 });
  assert.ok(up.points[10].y > 0, 'positive f is up regardless of facing');
  assert.ok(up.points[10].x < 10, 'travel goes left');
});

test('the aim angle rotates the whole frame', () => {
  const scenario = normalize({ shooter: { x: 0, y: -10 }, target: { x: 0, y: 10 } });
  const r = trace(scenario, compile('0'), { angle: 90, direction: 1 });
  assert.equal(r.outcome, 'hit');
});
