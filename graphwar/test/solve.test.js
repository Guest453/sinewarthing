import test from 'node:test';
import assert from 'node:assert/strict';
import { solve, check } from '../src/solve.js';
import { compile } from '../src/expr.js';
import { trace } from '../src/trace.js';
import { normalize } from '../src/scenario.js';

const OPEN = { shooter: { x: -18, y: 0 }, target: { x: 16, y: 4 } };

const WALL = {
  shooter: { x: -18, y: -6 },
  target: { x: 16, y: -6 },
  terrain: [{ id: 'wall', x: 0, y: -6, r: 6 }],
};

const CORRIDOR = {
  shooter: { x: -20, y: 0 },
  target: { x: 20, y: 0 },
  terrain: [
    { id: 'upper', x: 0, y: 7, r: 6 },
    { id: 'lower', x: 0, y: -7, r: 6 },
    { id: 'mid', x: -8, y: 0, r: 2.5 },
    { id: 'mid2', x: 8, y: 0, r: 2.5 },
  ],
};

test('open ground is solved by the straight shot', () => {
  const { shots } = solve(OPEN, { top: 3 });
  assert.ok(shots.length > 0);
  assert.equal(shots[0].family, 'line');
  assert.equal(shots[0].outcome, 'hit');
});

test('every returned shot really connects when re-flown from its printed text', () => {
  for (const board of [OPEN, WALL, CORRIDOR]) {
    const { shots, scenario } = solve(board, { top: 5 });
    assert.ok(shots.length > 0, 'expected at least one solution');
    for (const shot of shots) {
      // re-parse the exact string a player would type — no closures carried over
      const replay = trace(scenario, compile(shot.function), {
        angle: shot.angle,
        direction: shot.direction === 'left' ? -1 : 1,
      });
      assert.equal(replay.outcome, 'hit', `${shot.function} should hit, got ${replay.outcome}`);
    }
  }
});

test('a wall in the lane forces a curve, not a line', () => {
  const { shots } = solve(WALL, { top: 5 });
  assert.ok(shots.length > 0);
  assert.ok(!shots.some((s) => s.family === 'line'), 'no straight shot should survive');
  assert.ok(shots[0].clearance > 0.2, 'the best shot should have room for error');
});

test('a narrow corridor is still solvable', () => {
  const { shots } = solve(CORRIDOR, { top: 3 });
  assert.ok(shots.length > 0, 'expected a way through');
});

test('shots are ranked by room for error', () => {
  const { shots } = solve(WALL, { top: 5 });
  for (let i = 1; i < shots.length; i++) {
    assert.ok(shots[i - 1].score >= shots[i].score, 'scores must be non-increasing');
  }
});

test('a target sealed inside terrain reports the nearest miss instead of lying', () => {
  const sealed = {
    shooter: { x: -18, y: 0 },
    target: { x: 10, y: 0 },
    terrain: [{ id: 'tomb', x: 10, y: 0, r: 4 }],
  };
  const { shots, nearest } = solve(sealed, { top: 5 });
  assert.equal(shots.length, 0);
  assert.ok(nearest, 'should still report the closest attempt');
  assert.ok(nearest.missDistance > 0);
});

test('a target directly overhead is solved by rotating the aim', () => {
  const overhead = { shooter: { x: 0, y: -10 }, target: { x: 0, y: 8 } };
  const { shots } = solve(overhead, { top: 3 });
  assert.ok(shots.length > 0);
  assert.notEqual(shots[0].angle, 0, 'a target overhead cannot be solved at a flat aim');
});

test('friendlies are treated as obstacles, not scenery', () => {
  const withAlly = {
    shooter: { x: -18, y: 0 },
    target: { x: 16, y: 0 },
    soldiers: [{ id: 'ally', x: -2, y: 0, team: 'mine' }],
  };
  const { shots, scenario } = solve(withAlly, { top: 3 });
  assert.ok(shots.length > 0);
  const flat = trace(scenario, compile('0'), { direction: 1 });
  assert.equal(flat.blockedBy, 'ally');
  assert.ok(shots.every((s) => s.outcome === 'hit'));
});

test('check() reports what a hand-written function would do', () => {
  const straight = check(WALL, '0');
  assert.equal(straight.outcome, 'terrain');
  assert.equal(straight.blockedBy, 'wall');

  const arc = check(WALL, '-0.05*x^2+1.7*x');
  assert.ok(['hit', 'terrain', 'out'].includes(arc.outcome));
});

test('check() surfaces a syntax error rather than silently missing', () => {
  assert.throws(() => check(OPEN, '2*x^'), SyntaxError);
});

test('scenario validation rejects a board it cannot reason about', () => {
  assert.throws(() => normalize({ shooter: { x: 0, y: 0 } }), TypeError);
  assert.throws(() => normalize({ shooter: { x: 0, y: 0 }, target: { x: 'over there', y: 0 } }), TypeError);
  assert.throws(() => normalize({
    shooter: { x: 0, y: 0 }, target: { x: 1, y: 1 }, field: { xMin: 10, xMax: -10 },
  }), RangeError);
});
